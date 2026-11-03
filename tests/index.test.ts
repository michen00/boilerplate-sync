import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@actions/core';
import { ConfigError, getInputs } from '../src/config';
import { syncFiles } from '../src/sync';
import type { ActionInputs, SyncResult, SyncSummary } from '../src/sources/types';

// The step summary builder is chained (addRaw(...).write()), so the mock
// returns itself; vi.hoisted makes it visible to the hoisted vi.mock factory.
const { stepSummary } = vi.hoisted(() => {
  const stepSummary = {
    addRaw: vi.fn((): unknown => stepSummary),
    write: vi.fn(async (): Promise<unknown> => stepSummary),
  };
  return { stepSummary };
});

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  debug: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  summary: stepSummary,
}));

vi.mock('../src/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/config')>()),
  getInputs: vi.fn(),
  logConfig: vi.fn(),
}));

vi.mock('../src/sync', () => ({
  syncFiles: vi.fn(),
}));

const inputs: ActionInputs = {
  sources: [{ source: 'org/private', 'source-token': 'ghp_secret_token', default_files: ['a.json'] }],
  githubToken: 'ghs_github_token',
  createMissing: true,
  failOnError: false,
};

const updated: SyncResult = {
  config: {
    local_path: 'a.json',
    source_path: 'a.json',
    source: 'org/private',
    sourceToken: 'ghp_secret_token',
    origin: 'default_files',
  },
  status: 'updated',
  resolvedRef: 'main',
  isNew: false,
};

const summary: SyncSummary = {
  updated: [updated],
  created: [],
  skipped: [],
  failed: [],
  total: 1,
  hasChanges: true,
  allFailed: false,
};

/**
 * Import the entry point, which runs the action, and wait until it settles
 */
async function runAction(settled: () => void): Promise<void> {
  vi.resetModules();
  await import('../src/index');
  await vi.waitFor(settled);
}

describe('action entry point', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getInputs).mockReturnValue(inputs);
    vi.mocked(syncFiles).mockResolvedValue(summary);
  });

  it('sets every output, with no token in the summary output', async () => {
    await runAction(() => expect(core.setOutput).toHaveBeenCalledWith('summary', expect.any(String)));

    const outputs = new Map(
      vi.mocked(core.setOutput).mock.calls.map(([name, value]) => [name, String(value)])
    );
    expect(outputs.get('has-changes')).toBe('true');
    expect(outputs.get('updated-count')).toBe('1');
    expect(outputs.get('failed-count')).toBe('0');
    expect(outputs.get('skipped-count')).toBe('0');

    const summaryOutput = outputs.get('summary') as string;
    expect(summaryOutput).not.toContain('ghp_secret_token');
    expect(summaryOutput).not.toContain('ghs_github_token');
    expect(JSON.parse(summaryOutput)).toMatchObject({
      updated: [{ config: { local_path: 'a.json', source: 'org/private' }, status: 'updated' }],
      total: 1,
    });
  });

  it('writes the step summary', async () => {
    await runAction(() => expect(stepSummary.write).toHaveBeenCalled());

    expect(stepSummary.addRaw).toHaveBeenCalledWith(expect.stringContaining('Boilerplate Sync Results'));
  });

  it('fails when fail-on-error is set and a file failed', async () => {
    vi.mocked(getInputs).mockReturnValue({ ...inputs, failOnError: true });
    vi.mocked(syncFiles).mockResolvedValue({
      ...summary,
      updated: [],
      failed: [{ ...updated, status: 'failed', error: 'Not Found' }],
      hasChanges: false,
      allFailed: true,
    });

    await runAction(() => expect(core.setFailed).toHaveBeenCalled());

    expect(core.setFailed).toHaveBeenCalledWith('1 file(s) failed to sync');
  });

  it('reports a configuration error without setting outputs', async () => {
    vi.mocked(getInputs).mockImplementation(() => {
      throw new ConfigError("'sources' input is required and cannot be empty");
    });

    await runAction(() => expect(core.setFailed).toHaveBeenCalled());

    expect(core.setFailed).toHaveBeenCalledWith(
      "Configuration error: 'sources' input is required and cannot be empty"
    );
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('reports any other error', async () => {
    vi.mocked(syncFiles).mockRejectedValue(new Error('network down'));

    await runAction(() => expect(core.setFailed).toHaveBeenCalled());

    expect(core.setFailed).toHaveBeenCalledWith('Action failed: network down');
  });
});
