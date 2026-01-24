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
    sources: [
      {
        source: 'owner/repo',
        ref: 'main',
        default_files: ['test.ts'],
      },
    ],
    githubToken: 'gh-token',
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
      sources: [
        {
          source: 'owner/repo',
          default_files: ['updated.ts', 'created.ts', 'skipped.ts'],
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

  it('handles file_pairs with different source paths', async () => {
    const inputs: ActionInputs = {
      ...mockInputs,
      sources: [
        {
          source: 'owner/repo',
          file_pairs: [
            { local_path: 'local.ts', source_path: 'src/remote.ts' },
          ],
        },
      ],
    };

    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('old content');
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const summary = await syncFiles(inputs);

    expect(summary.updated.length).toBe(1);
    expect(summary.updated[0].config.local_path).toBe('local.ts');
    expect(summary.updated[0].config.source_path).toBe('src/remote.ts');
  });

  it('handles combined default_files and file_pairs', async () => {
    const inputs: ActionInputs = {
      ...mockInputs,
      sources: [
        {
          source: 'owner/repo',
          default_files: ['default.ts'],
          file_pairs: [
            { local_path: 'mapped.ts', source_path: 'src/mapped.ts' },
          ],
        },
      ],
    };

    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('old content');
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const summary = await syncFiles(inputs);

    expect(summary.updated.length).toBe(2);
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
      sources: [
        {
          source: 'owner/repo',
          default_files: ['failing.ts', 'should-not-process.ts'],
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

  it('uses per-source token when provided', async () => {
    const { createGitHubSource } = await import('../src/sources/github');
    const mockFetch = vi.fn(async () => ({
      content: 'mock content',
      resolvedRef: 'main',
    }));

    vi.mocked(createGitHubSource).mockImplementation(() => ({
      toString: () => 'owner/repo@main:file.ts',
      fetch: mockFetch,
      type: 'github',
      getSourceId: () => 'owner/repo',
      getRef: () => 'main',
    }));

    const inputs: ActionInputs = {
      ...mockInputs,
      sources: [
        {
          source: 'owner/private-repo',
          'source-token': 'private-token',
          default_files: ['file.ts'],
        },
      ],
    };

    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('old content');
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await syncFiles(inputs);

    // The fetch should be called with the source-specific token
    expect(mockFetch).toHaveBeenCalledWith('private-token');
  });

  it('falls back to github-token when no source-token is provided', async () => {
    const { createGitHubSource } = await import('../src/sources/github');
    const mockFetch = vi.fn(async () => ({
      content: 'mock content',
      resolvedRef: 'main',
    }));

    vi.mocked(createGitHubSource).mockImplementation(() => ({
      toString: () => 'owner/repo@main:file.ts',
      fetch: mockFetch,
      type: 'github',
      getSourceId: () => 'owner/repo',
      getRef: () => 'main',
    }));

    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('old content');
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await syncFiles(mockInputs);

    // The fetch should be called with the github-token as fallback
    expect(mockFetch).toHaveBeenCalledWith('gh-token');
  });
});
