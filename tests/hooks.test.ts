import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@actions/core';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildHookEnv,
  HookError,
  resolveBash,
  runHookCommands,
  runTransform,
} from '../src/hooks';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

describe('buildHookEnv', () => {
  const base = {
    PATH: '/usr/bin',
    HOME: '/home/runner',
    GITHUB_WORKSPACE: '/work',
    GITHUB_ENV: '/tmp/env',
    'INPUT_GITHUB-TOKEN': 'ghs_secret',
    INPUT_SOURCES: '- source: o/r\n  source-token: ghp_secret',
    ACTIONS_RUNTIME_TOKEN: 'runtime',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc',
    GITHUB_OUTPUT: '/tmp/out',
    GITHUB_STATE: '/tmp/state',
    UNSET: undefined,
  };

  it('removes action inputs, runner tokens and the outputs and state files', () => {
    const env = buildHookEnv(base, {});

    expect(Object.keys(env).filter((name) => name.startsWith('INPUT_'))).toEqual([]);
    expect(Object.keys(env).filter((name) => name.startsWith('ACTIONS_'))).toEqual([]);
    expect(env).not.toHaveProperty('GITHUB_OUTPUT');
    expect(env).not.toHaveProperty('GITHUB_STATE');
    expect(env).not.toHaveProperty('UNSET');
  });

  it('removes inputs whatever the case of their names', () => {
    const env = buildHookEnv({ 'input_github-token': 'x', Actions_Runtime_Url: 'y' }, {});

    expect(env).toEqual({});
  });

  it('keeps the rest of the environment', () => {
    const env = buildHookEnv(base, {});

    expect(env).toMatchObject({
      PATH: '/usr/bin',
      HOME: '/home/runner',
      GITHUB_WORKSPACE: '/work',
      GITHUB_ENV: '/tmp/env',
    });
  });

  it('adds the context variables', () => {
    const env = buildHookEnv(base, {
      BOILERPLATE_SYNC_HOOK: 'transform',
      BOILERPLATE_SYNC_LOCAL_PATH: 'package.json',
    });

    expect(env.BOILERPLATE_SYNC_HOOK).toBe('transform');
    expect(env.BOILERPLATE_SYNC_LOCAL_PATH).toBe('package.json');
  });
});

describe('resolveBash', () => {
  it('uses bash from PATH outside Windows', () => {
    expect(resolveBash('linux', {}, () => false)).toBe('bash');
    expect(resolveBash('darwin', {}, () => false)).toBe('bash');
  });

  it('prefers Git for Windows bash on Windows', () => {
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
    const exists = (candidate: string) =>
      candidate === gitBash || candidate === 'C:\\Windows\\System32\\bash.exe';

    expect(
      resolveBash(
        'win32',
        { ProgramFiles: 'C:\\Program Files', Path: 'C:\\Windows\\System32' },
        exists
      )
    ).toBe(gitBash);
  });

  it('skips the WSL launcher in System32 when searching PATH', () => {
    const exists = (candidate: string) =>
      candidate === 'C:\\Windows\\System32\\bash.exe' ||
      candidate === 'D:\\tools\\msys\\bash.exe';

    expect(
      resolveBash(
        'win32',
        { ProgramFiles: 'C:\\Program Files', Path: 'C:\\Windows\\System32;D:\\tools\\msys' },
        exists
      )
    ).toBe('D:\\tools\\msys\\bash.exe');
  });

  it('falls back to the default Program Files and to PATH on Windows', () => {
    expect(
      resolveBash('win32', {}, (candidate) => candidate === 'C:\\Program Files\\Git\\bin\\bash.exe')
    ).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
    expect(
      resolveBash(
        'win32',
        { PATH: 'E:\\empty;;F:\\bin' },
        (candidate) => candidate === 'F:\\bin\\bash.exe'
      )
    ).toBe('F:\\bin\\bash.exe');
    expect(resolveBash('win32', {}, () => false)).toBeUndefined();
  });

  it('returns undefined on Windows when only the WSL launcher exists', () => {
    const exists = (candidate: string) => candidate === 'C:\\Windows\\System32\\bash.exe';

    expect(
      resolveBash('win32', { Path: 'C:\\Windows\\System32' }, exists)
    ).toBeUndefined();
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

describe.skipIf(!hasBash)('hook processes (real bash)', () => {
  let tempDir: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boilerplate-sync-test-'));
    process.env.RUNNER_TEMP = path.join(tempDir, 'runner-temp');
    fs.mkdirSync(process.env.RUNNER_TEMP);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const rule = (command: string) => ({ pattern: 'package.json', command });

  describe('runTransform', () => {
    it('passes content through stdin and returns stdout', async () => {
      const result = await runTransform(rule("tr 'a-z' 'A-Z'"), 'héllo\nworld\n', {});

      expect(result).toEqual({ ok: true, content: 'HéLLO\nWORLD\n' });
    });

    it('can read the existing local file through the context variables', async () => {
      const local = path.join(tempDir, 'package.json');
      fs.writeFileSync(local, 'local\n');

      const result = await runTransform(
        rule('cat - "$BOILERPLATE_SYNC_LOCAL_PATH"; echo "$BOILERPLATE_SYNC_HOOK"'),
        'upstream\n',
        { BOILERPLATE_SYNC_LOCAL_PATH: local }
      );

      expect(result).toEqual({ ok: true, content: 'upstream\nlocal\ntransform\n' });
    });

    it('never exposes action inputs or runner tokens', async () => {
      process.env['INPUT_GITHUB-TOKEN'] = 'ghs_secret';
      process.env.INPUT_SOURCES = 'source-token: ghp_secret';
      process.env.ACTIONS_RUNTIME_TOKEN = 'runtime';
      process.env.GITHUB_OUTPUT = path.join(tempDir, 'out');

      const result = await runTransform(
        rule("env | grep -E '^(INPUT_|ACTIONS_|GITHUB_OUTPUT=)' || echo clean"),
        '',
        {}
      );

      expect(result).toEqual({ ok: true, content: 'clean\n' });
    });

    it('reports a non-zero exit with the end of stderr', async () => {
      const result = await runTransform(rule('echo first >&2; echo bad input >&2; exit 3'), 'x', {});

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatch(
        /transform 'package\.json' exited with code 3: first\nbad input/
      );
    });

    it('survives a transform that exits without reading its input', async () => {
      // 1 MiB overflows the pipe buffer, so the write meets a closed pipe (EPIPE)
      const result = await runTransform(rule('echo replaced'), 'x'.repeat(1024 * 1024), {});

      expect(result).toEqual({ ok: true, content: 'replaced\n' });
    });

    it('reports a transform stopped by a signal', async () => {
      const result = await runTransform(rule('kill -KILL $$'), 'x', {});

      expect(result).toEqual({
        ok: false,
        error: "transform 'package.json' was stopped by SIGKILL",
      });
    });

    it('fails a pipeline whose first command fails', async () => {
      const result = await runTransform(rule('false | cat'), 'x', {});

      expect(result.ok).toBe(false);
    });

    it('treats empty stdout as a failure', async () => {
      const result = await runTransform(rule('cat > /dev/null'), 'x', {});

      expect(result).toEqual({
        ok: false,
        error: "transform 'package.json' produced no output",
      });
    });

    it('deletes its temporary script', async () => {
      await runTransform(rule('cat'), 'x', {});

      expect(fs.readdirSync(process.env.RUNNER_TEMP as string)).toEqual([]);
    });

    it('falls back to the OS temporary directory without RUNNER_TEMP', async () => {
      delete process.env.RUNNER_TEMP;

      await expect(runTransform(rule('cat'), 'x', {})).resolves.toEqual({
        ok: true,
        content: 'x',
      });
    });

    it('keeps only the last lines of stderr in the error', async () => {
      const result = await runTransform(
        rule('for i in 1 2 3 4 5 6 7; do echo "line $i" >&2; done; exit 1'),
        'x',
        {}
      );

      expect(!result.ok && result.error).toMatch(/: line 3\nline 4\nline 5\nline 6\nline 7$/);
    });

    it('strips a trailing carriage return from a final unterminated line', async () => {
      const result = await runTransform(rule("printf 'progress\\r' >&2; exit 2"), 'x', {});

      expect(result).toEqual({
        ok: false,
        error: "transform 'package.json' exited with code 2: progress",
      });
      const logged = vi.mocked(core.info).mock.calls.map((call) => String(call[0]));
      expect(logged).toContain('  | progress');
    });

    it('includes stderr that does not end in a newline', async () => {
      const result = await runTransform(rule("printf 'no newline' >&2; exit 2"), 'x', {});

      expect(result).toEqual({
        ok: false,
        error: "transform 'package.json' exited with code 2: no newline",
      });
    });

    it('logs stderr but never the content on stdout', async () => {
      await runTransform(rule('echo progress >&2; echo secret-content'), 'x', {});

      const logged = vi.mocked(core.info).mock.calls.map((call) => String(call[0]));
      expect(logged).toContain('  | progress');
      expect(logged.join('\n')).not.toContain('secret-content');
    });

    it('reports a transform that cannot start', async () => {
      process.env.PATH = '';

      const result = await runTransform(rule('cat'), 'x', {});

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatch(/transform 'package\.json' could not start: .*bash/);
    });

    it('reports a missing bash on Windows without trying WSL', async () => {
      const platform = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env.PATH = 'C:\\Windows\\System32';
      try {
        const result = await runTransform(rule('cat'), 'x', {});

        expect(!result.ok && result.error).toMatch(/cannot find bash; install Git for Windows/);
      } finally {
        Object.defineProperty(process, 'platform', platform);
      }
    });
  });

  describe('runHookCommands', () => {
    it('runs commands in order and stops at the first failure', async () => {
      const log = path.join(tempDir, 'log');
      const commands = [`echo one >> '${log}'`, 'false', `echo three >> '${log}'`];

      const run = runHookCommands('post-sync', commands, {});

      await expect(run).rejects.toThrow(HookError);
      await expect(run).rejects.toThrow(/post-sync command 2 of 3 exited with code 1/);
      expect(fs.readFileSync(log, 'utf-8')).toBe('one\n');
    });

    it('logs stdout and stderr', async () => {
      await runHookCommands(
        'post-sync',
        ["echo formatted; echo warned >&2; printf 'crlf\\r\\nno newline'"],
        {}
      );

      const logged = vi.mocked(core.info).mock.calls.map((call) => String(call[0]));
      expect(logged).toContain('crlf');
      expect(logged).toContain('formatted');
      expect(logged).toContain('warned');
      expect(logged).toContain('no newline');
    });

    it('throws HookError when bash cannot start', async () => {
      process.env.PATH = '';

      await expect(runHookCommands('pre-sync', ['true'], {})).rejects.toThrow(
        /pre-sync command 1 of 1 could not start/
      );
    });

    it('closes stdin so a command that reads it does not hang', async () => {
      await expect(runHookCommands('pre-sync', ['cat'], {})).resolves.toBeUndefined();
    });

    it('passes the context variables', async () => {
      const out = path.join(tempDir, 'out');

      await runHookCommands(
        'post-sync',
        [`printf '%s %s' "$BOILERPLATE_SYNC_HOOK" "$BOILERPLATE_SYNC_HAS_CHANGES" > '${out}'`],
        { BOILERPLATE_SYNC_HAS_CHANGES: 'true' }
      );

      expect(fs.readFileSync(out, 'utf-8')).toBe('post-sync true');
    });

    it('runs from the working directory', async () => {
      const out = path.join(tempDir, 'cwd');

      await runHookCommands('pre-sync', [`pwd -P > '${out}'`], {});

      expect(fs.readFileSync(out, 'utf-8').trim()).toBe(fs.realpathSync(process.cwd()));
    });
  });
});
