import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import { syncFiles } from '../src/sync';
import type { ActionInputs } from '../src/sources/types';

// Mock fs/promises
vi.mock('fs/promises');

// Mock @actions/core
vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  startGroup: vi.fn(),
  endGroup: vi.fn(),
}));

// Mock the GitHub source
vi.mock('../src/sources/github', () => ({
  createGitHubSource: vi.fn(() => ({
    toString: () => 'owner/repo@main:path/file.ts',
    fetch: vi.fn(async () => ({
      content: 'mock content',
      resolvedRef: 'main',
    })),
  })),
}));

describe('syncFiles', () => {
  const mockInputs: ActionInputs = {
    files: [
      {
        project: 'test.ts',
        source: 'owner/repo',
        path: 'src/test.ts',
        ref: 'main',
      },
    ],
    githubToken: 'gh-token',
    sourceToken: 'source-token',
    createMissing: true,
    failOnError: false,
    prTitle: 'Test PR',
    prLabels: ['test'],
    prBranch: 'test-branch',
    commitMessage: 'Test commit',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates existing file when content differs', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('old content');
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const summary = await syncFiles(mockInputs);

    expect(summary.updated.length).toBe(1);
    expect(summary.created.length).toBe(0);
    expect(summary.skipped.length).toBe(0);
    expect(summary.failed.length).toBe(0);
    expect(summary.hasChanges).toBe(true);
  });

  it('creates new file when it does not exist', async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const summary = await syncFiles(mockInputs);

    expect(summary.created.length).toBe(1);
    expect(summary.updated.length).toBe(0);
    expect(summary.hasChanges).toBe(true);
  });

  it('skips file when content is identical', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('mock content');

    const summary = await syncFiles(mockInputs);

    expect(summary.skipped.length).toBe(1);
    expect(summary.updated.length).toBe(0);
    expect(summary.hasChanges).toBe(false);
  });

  it('skips file when it does not exist and create-missing is false', async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

    const inputs = { ...mockInputs, createMissing: false };
    const summary = await syncFiles(inputs);

    expect(summary.skipped.length).toBe(1);
    expect(summary.created.length).toBe(0);
    expect(summary.hasChanges).toBe(false);
  });

  it('handles multiple files with mixed results', async () => {
    const inputs: ActionInputs = {
      ...mockInputs,
      files: [
        {
          project: 'updated.ts',
          source: 'owner/repo',
          path: 'src/updated.ts',
        },
        {
          project: 'created.ts',
          source: 'owner/repo',
          path: 'src/created.ts',
        },
        {
          project: 'skipped.ts',
          source: 'owner/repo',
          path: 'src/skipped.ts',
        },
      ],
    };

    let callCount = 0;
    vi.mocked(fs.access).mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error('ENOENT');
      }
    });

    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      if (path === 'updated.ts') {
        return 'old content';
      }
      return 'mock content';
    });

    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const summary = await syncFiles(inputs);

    expect(summary.updated.length).toBe(1);
    expect(summary.created.length).toBe(1);
    expect(summary.skipped.length).toBe(1);
    expect(summary.total).toBe(3);
  });

  it('stops processing on first failure when fail-on-error is true', async () => {
    const { createGitHubSource } = await import('../src/sources/github');

    vi.mocked(createGitHubSource).mockImplementationOnce(() => ({
      toString: () => 'owner/repo@main:failing.ts',
      fetch: vi.fn(async () => {
        throw new Error('Network error');
      }),
      type: 'github',
      getSourceId: () => 'owner/repo',
      getRef: () => 'main',
    }));

    const inputs: ActionInputs = {
      ...mockInputs,
      failOnError: true,
      files: [
        {
          project: 'failing.ts',
          source: 'owner/repo',
          path: 'src/failing.ts',
        },
        {
          project: 'should-not-process.ts',
          source: 'owner/repo',
          path: 'src/should-not-process.ts',
        },
      ],
    };

    const summary = await syncFiles(inputs);

    expect(summary.failed.length).toBe(1);
    expect(summary.total).toBe(1); // Second file should not be processed
  });

  it('sets allFailed flag when all files fail', async () => {
    const { createGitHubSource } = await import('../src/sources/github');

    vi.mocked(createGitHubSource).mockImplementation(() => ({
      toString: () => 'owner/repo@main:failing.ts',
      fetch: vi.fn(async () => {
        throw new Error('Network error');
      }),
      type: 'github',
      getSourceId: () => 'owner/repo',
      getRef: () => 'main',
    }));

    const summary = await syncFiles(mockInputs);

    expect(summary.allFailed).toBe(true);
    expect(summary.failed.length).toBe(1);
  });
});
