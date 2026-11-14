import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import { parse } from 'yaml';

interface Step {
  name?: string;
  if?: string;
  env?: Record<string, string>;
  run?: string;
}

interface Workflow {
  jobs: Record<string, { steps: Step[] }>;
}

const workflow = parse(
  fs.readFileSync(
    new URL('../.github/workflows/bot-automerge.yml', import.meta.url),
    'utf-8'
  )
) as Workflow;

/** Collapses whitespace and backslash-newline continuations to single spaces. */
function flatten(text: string | undefined): string {
  return (text ?? '').replace(/\\\n/g, ' ').split(/\s+/).join(' ').trim();
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
});
