import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'yaml';

interface Step {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  with?: Record<string, string | boolean | number>;
  env?: Record<string, string>;
  run?: string;
  'working-directory'?: string;
}

interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
}

interface Workflow {
  jobs: Record<string, Job>;
}

function load(file: string): Workflow {
  return parse(
    fs.readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf-8')
  ) as Workflow;
}

const workflow = load('bot-automerge.yml');
const build = workflow.jobs['build-and-check'];
const privileged = workflow.jobs['bot-automerge'];

/** Collapses whitespace and backslash-newline continuations to single spaces. */
function flatten(text: string | undefined): string {
  return (text ?? '').replace(/\\\n/g, ' ').split(/\s+/).join(' ').trim();
}

function stepNamed(job: Job, name: string): Step {
  const step = job.steps.find((candidate) => candidate.name === name);
  if (!step) throw new Error(`no step named ${name}`);
  return step;
}

/** Dotted paths, within `value`, of every string that contains `needle`. */
function mentions(value: unknown, needle: string, at: string[] = []): string[] {
  if (typeof value === 'string') return value.includes(needle) ? [at.join('.')] : [];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    mentions(child, needle, [...at, key])
  );
}

describe('bot-automerge.yml', () => {
  // On `always()`, a run that failed or was cancelled before its verdict disarms too.
  // Eligibility is left out, so a held update that a person armed by hand stays armed
  // unless a later event from the same actor, a label change included, cancels the run.
  it('disarms auto-merge in its last step unless the run trusted the head', () => {
    const steps = workflow.jobs['bot-automerge'].steps;
    const disarm = steps[steps.length - 1];
    const condition = flatten(disarm.if);
    const script = flatten(disarm.run);

    expect(disarm.name).toBe('Disarm auto-merge unless this run vouched for the head');
    expect(condition).toBe("always() && steps.provenance.outputs.trusted != 'true'");
    expect(condition).not.toContain('eligible');
    // `|| ` would let a failed query or disable pass as "nothing to disarm".
    expect(script.startsWith('set -euo pipefail')).toBe(true);
    expect(script).not.toContain('|| ');
    expect(script).toContain('gh pr view "$PR_NUMBER" --json autoMergeRequest');
    expect(script).toContain('gh pr merge --disable-auto "$PR_NUMBER"');
    expect(disarm.env?.GH_TOKEN).toBe(
      '${{ steps.app-token.outputs.token || github.token }}'
    );
    expect(disarm.env?.GH_REPO).toBe('${{ github.repository }}');
  });

  // npm install scripts, the build, and pre-commit hooks come from the pull request.
  it('runs pull request code only in a job without secrets or write access', () => {
    const runs = build.steps.map((step) => step.run);

    expect(build.permissions).toEqual({ contents: 'read' });
    expect(build.env).toBeUndefined();
    expect(JSON.stringify(build)).not.toMatch(
      /secrets\.|github\.token|vars\.|GITHUB_TOKEN/
    );
    expect(build.steps[0].uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
    expect(build.steps[0].with?.['persist-credentials']).toBe(false);
    expect(runs).toContain('make build');
    expect(runs).toContain('make check');
  });

  // A pull request's runs share one cache scope, so a restored cache could hold what
  // the build job wrote.
  it('runs nothing from the pull request in the job that holds write access', () => {
    const { steps, ...job } = privileged;
    const touches = steps.flatMap((step) =>
      mentions(step, 'pull-request').map((at) => `${step.name ?? step.uses}: ${at}`)
    );

    expect(touches).toEqual([
      'Check out the pull request: with.path',
      'Stage the build in dist/: env.DIST',
      'Commit build changes: with.workspace',
    ]);
    expect(mentions(job, 'pull-request')).toEqual([]);
    for (const step of steps) {
      expect(step.uses ?? '').not.toMatch(/^\.\/|^actions\/cache[@/]/);
      for (const line of (step.run ?? '').split('\n')) {
        expect(line).not.toMatch(
          /(^|[;&|(])\s*(make|npm|npx|node|pre-commit|pip3?|python3?)\b/
        );
      }
      if (step.uses?.startsWith('actions/checkout@')) {
        expect(step.with?.['persist-credentials']).toBe(false);
      }
    }
  });

  // `needs` alone would skip the job, the disarm included, when the build fails.
  it('reaches the disarm after a failed build and skips everything else', () => {
    const [gate] = privileged.steps;

    expect(privileged.needs).toBe('build-and-check');
    expect(flatten(privileged.if)).toBe(`always() && ${flatten(build.if)}`);
    expect(flatten(gate.if)).toBe("needs.build-and-check.result != 'success'");
    expect(gate.run).toContain('exit 1');
    for (const step of privileged.steps.slice(0, -1)) {
      expect(step.if ?? '').not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
    }
  });

  it('commits the build from an artifact checked outside the checkout', () => {
    const upload = build.steps[build.steps.length - 1];
    const download = stepNamed(privileged, 'Download the build');
    const checkout = stepNamed(privileged, 'Check out the pull request');
    const stage = stepNamed(privileged, 'Stage the build in dist/');
    const commit = stepNamed(privileged, 'Commit build changes');
    const order = [download, checkout, stage, commit].map((step) =>
      privileged.steps.indexOf(step)
    );

    expect(upload.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
    expect(download.uses).toMatch(/^actions\/download-artifact@[0-9a-f]{40}$/);
    expect(download.with?.name).toBe(upload.with?.name);
    expect(upload.with?.path).toBe('dist/');
    expect(download.with?.path).toMatch(/^\$\{\{ runner\.temp \}\}\//);
    expect(checkout.with?.path).toBe('pull-request');
    expect(stage.env?.BUILD).toBe(download.with?.path);
    expect(stage.env?.DIST).toBe('pull-request/dist');
    expect(commit.with?.workspace).toBe('${{ github.workspace }}/pull-request');
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  // The workspace root holds no checkout for gh to infer the repository from.
  it('names the repository in every step that runs gh', () => {
    const gh = privileged.steps.filter((step) =>
      /\bgh (pr|api)\b/.test(step.run ?? '')
    );

    expect(gh.length).toBeGreaterThan(0);
    for (const step of gh) {
      expect(step.env?.GH_REPO).toBe('${{ github.repository }}');
    }
  });

  // main's ruleset requires ci.yml's checks by name, so a job here sharing one of those
  // names would report that check too.
  it("keeps its check names apart from ci.yml's", () => {
    const reported = (wf: Workflow) =>
      Object.entries(wf.jobs).map(([id, job]) => job.name ?? id);
    const required = new Set(reported(load('ci.yml')));

    for (const name of reported(workflow)) {
      expect(required.has(name)).toBe(false);
    }
  });
});

const hasBash = (() => {
  try {
    execFileSync('bash', ['-c', 'true']);
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasBash)('staging the build in dist/ (real bash)', () => {
  const script = stepNamed(privileged, 'Stage the build in dist/').run ?? '';
  let tempDir: string;
  let buildDir: string;
  let dist: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-automerge-test-'));
    buildDir = path.join(tempDir, 'build');
    dist = path.join(tempDir, 'pull-request', 'dist');
    fs.mkdirSync(buildDir);
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.js'), 'committed\n');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const stage = () =>
    spawnSync('bash', ['-c', script], {
      env: { ...process.env, BUILD: buildDir, DIST: dist },
      encoding: 'utf-8',
    });

  const listing = (dir: string) =>
    fs
      .readdirSync(dir, { recursive: true })
      .map((entry) => entry.toString())
      .sort();

  it("replaces dist/ with the build's files", () => {
    fs.writeFileSync(path.join(dist, 'stale.js'), 'stale\n');
    fs.writeFileSync(path.join(buildDir, 'index.js'), 'rebuilt\n');
    fs.mkdirSync(path.join(buildDir, 'chunks'));
    fs.writeFileSync(path.join(buildDir, 'chunks', 'a-1.js.map'), '{}\n');

    expect(stage().status).toBe(0);
    expect(listing(dist)).toEqual(['chunks', 'chunks/a-1.js.map', 'index.js']);
    expect(fs.readFileSync(path.join(dist, 'index.js'), 'utf-8')).toBe('rebuilt\n');
  });

  it('writes nothing through a symlink the pull request put in dist/', () => {
    const outside = path.join(tempDir, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(dist, 'chunks'));
    fs.mkdirSync(path.join(buildDir, 'chunks'));
    fs.writeFileSync(path.join(buildDir, 'chunks', 'a.js'), 'rebuilt\n');

    expect(stage().status).toBe(0);
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(fs.lstatSync(path.join(dist, 'chunks')).isDirectory()).toBe(true);
  });

  it('writes nothing through dist/ when the pull request made it a symlink', () => {
    const outside = path.join(tempDir, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'kept.js'), 'kept\n');
    fs.rmSync(dist, { recursive: true });
    fs.symlinkSync(outside, dist);
    fs.writeFileSync(path.join(buildDir, 'index.js'), 'rebuilt\n');

    expect(stage().status).toBe(0);
    expect(fs.readdirSync(outside)).toEqual(['kept.js']);
    expect(fs.readFileSync(path.join(outside, 'kept.js'), 'utf-8')).toBe('kept\n');
    expect(fs.lstatSync(dist).isDirectory()).toBe(true);
    expect(listing(dist)).toEqual(['index.js']);
  });

  // Each beside a file the build would be accepted with.
  it.each([
    ['a symlink', () => fs.symlinkSync('/etc/hosts', path.join(buildDir, 'hosts'))],
    ['a named pipe', () => execFileSync('mkfifo', [path.join(buildDir, 'pipe')])],
    ['a hidden file', () => fs.writeFileSync(path.join(buildDir, '.git'), '')],
    [
      'a name outside ASCII',
      () => fs.writeFileSync(path.join(buildDir, 'café.js'), ''),
    ],
    [
      'a name that could pass for a workflow command',
      () => fs.writeFileSync(path.join(buildDir, 'a\n::warning::injected'), ''),
    ],
  ])('refuses a build holding %s and leaves dist/ alone', (_, plant) => {
    fs.writeFileSync(path.join(buildDir, 'index.js'), 'rebuilt\n');
    plant();
    const result = stage();

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('injected');
    expect(listing(dist)).toEqual(['index.js']);
    expect(fs.readFileSync(path.join(dist, 'index.js'), 'utf-8')).toBe('committed\n');
  });

  it('refuses a build holding no file', () => {
    fs.mkdirSync(path.join(buildDir, 'empty'));

    expect(stage().status).toBe(1);
    expect(listing(dist)).toEqual(['index.js']);
  });
});
