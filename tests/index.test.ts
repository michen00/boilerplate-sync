import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@actions/core';
import { ConfigError, getInputs } from '../src/config';
import { HookError } from '../src/hooks';
import { runPostSync, syncFiles } from '../src/sync';
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

// A pass-through mock: mocked modules survive vi.resetModules(), so the
// entry point and these tests share one HookError class for instanceof.
vi.mock('../src/hooks', async (importOriginal) => importOriginal<typeof import('../src/hooks')>());

vi.mock('../src/sync', () => ({
  syncFiles: vi.fn(),
  runPostSync: vi.fn(),
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
    vi.mocked(runPostSync).mockResolvedValue(false);
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
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('runs post-sync after the step summary and outputs are written', async () => {
    await runAction(() => expect(runPostSync).toHaveBeenCalled());

    expect(runPostSync).toHaveBeenCalledWith(inputs, summary);
    const postSyncOrder = vi.mocked(runPostSync).mock.invocationCallOrder[0];
    expect(postSyncOrder).toBeGreaterThan(Math.max(...vi.mocked(core.setOutput).mock.invocationCallOrder));
    expect(postSyncOrder).toBeGreaterThan(stepSummary.write.mock.invocationCallOrder[0]);
  });

  it('fails after setting outputs when post-sync fails', async () => {
    vi.mocked(runPostSync).mockRejectedValue(
      new HookError('post-sync command 1 of 1 exited with code 1: npm test')
    );

    await runAction(() => expect(core.setFailed).toHaveBeenCalled());

    expect(core.setFailed).toHaveBeenCalledWith(
      'Hook failed: post-sync command 1 of 1 exited with code 1: npm test'
    );
    expect(core.setOutput).toHaveBeenCalledWith('has-changes', 'true');
  });

  it('reports a pre-sync failure without setting outputs', async () => {
    vi.mocked(syncFiles).mockRejectedValue(
      new HookError('pre-sync command 1 of 1 exited with code 1: test -f lock')
    );

    await runAction(() => expect(core.setFailed).toHaveBeenCalled());

    expect(core.setFailed).toHaveBeenCalledWith(
      'Hook failed: pre-sync command 1 of 1 exited with code 1: test -f lock'
    );
    expect(core.setOutput).not.toHaveBeenCalled();
    expect(runPostSync).not.toHaveBeenCalled();
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
