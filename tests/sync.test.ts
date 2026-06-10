import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as core from '@actions/core';
import { createGitHubSource, isGlobPattern, listFilesMatchingGlob } from '../src/sources/github';
import { syncFiles } from '../src/sync';
import { ConfigError } from '../src/config';
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

// Shared default for the createGitHubSource mock; vi.hoisted makes it
// visible to the hoisted vi.mock factory, and resetAllMocks in the suite
// hooks restores mocks to this factory default between tests.
const { makeDefaultGitHubSource } = vi.hoisted(() => ({
  makeDefaultGitHubSource: () => ({
    toString: () => 'owner/repo@main:path/file.ts',
    fetch: vi.fn(async () => ({
      content: 'mock content',
      resolvedRef: 'main',
    })),
    type: 'github' as const,
    getSourceId: () => 'owner/repo',
    getRef: () => 'main',
  }),
}));

// Mock the GitHub source
vi.mock('../src/sources/github', () => ({
  createGitHubSource: vi.fn(makeDefaultGitHubSource),
  isGlobPattern: vi.fn(() => false), // Default to not a glob pattern
  listFilesMatchingGlob: vi.fn(async () => []),
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
  };

  beforeEach(() => {
    // resetAllMocks restores each vi.fn(impl) to its factory default, so
    // per-test overrides cannot leak across tests or suites.
    vi.resetAllMocks();
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

  it('treats a file that vanishes after the existence check as newly created', async () => {
    // TOCTOU: fileExists sees the file, but it is gone by the time readFile
    // runs. readFile swallows ENOENT and returns null, so sync writes it as new.
    vi.mocked(fs.access).mockResolvedValue(undefined);
    const enoent = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    vi.mocked(fs.readFile).mockRejectedValue(enoent);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const summary = await syncFiles(mockInputs);

    expect(summary.created.length).toBe(1);
    expect(summary.created[0].isNew).toBe(true);
    expect(summary.failed.length).toBe(0);
  });

  it('marks the file failed when reading an existing file errors (non-ENOENT)', async () => {
    // File exists, but reading it raises a non-ENOENT error (e.g. EACCES).
    // readFile only short-circuits to null on ENOENT, so this rethrows and
    // the outer handler records the sync as failed rather than crashing.
    vi.mocked(fs.access).mockResolvedValue(undefined);
    const permissionError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    vi.mocked(fs.readFile).mockRejectedValue(permissionError);

    const summary = await syncFiles(mockInputs);

    expect(summary.failed.length).toBe(1);
    expect(summary.failed[0].error).toBe('permission denied');
    expect(summary.updated.length).toBe(0);
    expect(summary.created.length).toBe(0);
  });

  it('sets allFailed flag when all files fail', async () => {
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

describe('syncFiles glob expansion', () => {
  const globInputs: ActionInputs = {
    sources: [
      {
        source: 'owner/repo',
        ref: 'main',
        default_files: ['.github/**'],
      },
    ],
    githubToken: 'gh-token',
    createMissing: true,
    failOnError: false,
  };

  beforeEach(() => {
    // resetAllMocks restores factory defaults; only the glob predicate
    // needs a suite-specific override on top.
    vi.resetAllMocks();
    vi.mocked(isGlobPattern).mockImplementation((pattern: string) => pattern.includes('*'));
  });

  it('fans out a glob pattern into one sync per matched file', async () => {
    vi.mocked(listFilesMatchingGlob).mockResolvedValue([
      '.github/workflows/ci.yml',
      '.github/dependabot.yml',
    ]);

    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const summary = await syncFiles(globInputs);

    // Pattern resolved through the Tree API with the per-source ref and token fallback
    expect(listFilesMatchingGlob).toHaveBeenCalledWith(
      'owner',
      'repo',
      '.github/**',
      'main',
      'gh-token'
    );
    // One concrete config per match, with local_path mirroring source_path
    expect(summary.total).toBe(2);
    expect(summary.created.map(r => r.config.local_path)).toEqual([
      '.github/workflows/ci.yml',
      '.github/dependabot.yml',
    ]);
  });

  it('keeps the original pattern config when nothing matches', async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const summary = await syncFiles(globInputs);

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('No files matched pattern')
    );
    // The unexpanded config still flows through sync so the miss is visible
    expect(summary.total).toBe(1);
  });

  it('keeps the original pattern config when expansion fails', async () => {
    vi.mocked(listFilesMatchingGlob).mockRejectedValue(new Error('tree API unavailable'));

    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const summary = await syncFiles(globInputs);

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to expand glob pattern')
    );
    expect(summary.total).toBe(1);
  });

  it('rejects a glob in a file_pairs source instead of silently expanding it', async () => {
    // A glob in file_pairs would lose its explicit local_path if expanded
    // (the README forbids globs here); fail fast rather than silently remap.
    const filePairsGlobInputs: ActionInputs = {
      ...globInputs,
      sources: [
        {
          source: 'owner/repo',
          ref: 'main',
          file_pairs: [
            { local_path: 'local-dir/', source_path: '.github/ISSUE_TEMPLATE/*.md' },
          ],
        },
      ],
    };

    // Throw a ConfigError (not a generic Error) so the action entrypoint
    // reports it as a configuration problem rather than an action failure.
    const syncPromise = syncFiles(filePairsGlobInputs);
    await expect(syncPromise).rejects.toThrow(ConfigError);
    await expect(syncPromise).rejects.toThrow(
      "Glob patterns are not supported in `file_pairs` (source: '.github/ISSUE_TEMPLATE/*.md'); use `default_files` for globs."
    );
    // The remapped glob must never reach the tree-listing path.
    expect(listFilesMatchingGlob).not.toHaveBeenCalled();
  });

  it('still expands globs originating from default_files', async () => {
    // Guard above must not regress the supported default_files glob path.
    vi.mocked(listFilesMatchingGlob).mockResolvedValue([
      '.github/workflows/ci.yml',
      '.github/dependabot.yml',
    ]);

    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const summary = await syncFiles(globInputs);

    expect(summary.total).toBe(2);
    expect(summary.created.map(r => r.config.local_path)).toEqual([
      '.github/workflows/ci.yml',
      '.github/dependabot.yml',
    ]);
  });
});
