import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as core from '@actions/core';
import { createGitHubSource, isGlobPattern, listFilesMatchingGlob } from '../src/sources/github';
import { syncFiles, runPostSync } from '../src/sync';
import { ConfigError } from '../src/config';
import { HookError, runHookCommands, runTransform } from '../src/hooks';
import type { ActionInputs, HooksConfig, SyncSummary } from '../src/sources/types';

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

// Mock the hook runner: these tests cover when hooks run and what their
// results do, and tests/hooks.test.ts covers the processes themselves.
vi.mock('../src/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/hooks')>()),
  runHookCommands: vi.fn(),
  runTransform: vi.fn(),
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

const withHooks = (overrides: Partial<HooksConfig>): HooksConfig => ({
  preSync: [],
  transform: [],
  postSync: [],
  ...overrides,
});

describe('syncFiles with a transform', () => {
  const rule = { pattern: 'package.json', command: 'jq -s ".[0] * .[1]" - overrides.json' };
  const inputs: ActionInputs = {
    sources: [{ source: 'owner/repo', ref: 'main', default_files: ['package.json'] }],
    githubToken: 'gh-token',
    createMissing: true,
    failOnError: false,
    hooks: withHooks({ transform: [rule] }),
  };

  const fetchReturning = (content: string, resolvedRef = 'main') => {
    vi.mocked(createGitHubSource).mockImplementation(() => ({
      toString: () => 'owner/repo@main:package.json',
      fetch: vi.fn(async () => ({ content, resolvedRef })),
      type: 'github',
      getSourceId: () => 'owner/repo',
      getRef: () => 'main',
    }));
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    fetchReturning('upstream');
  });

  it('reports skipped and writes nothing when the output equals the local file', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('upstream + overlay');
    vi.mocked(runTransform).mockResolvedValue({ ok: true, content: 'upstream + overlay' });

    const summary = await syncFiles(inputs);

    expect(summary.skipped).toHaveLength(1);
    expect(summary.hasChanges).toBe(false);
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(runTransform).toHaveBeenCalledWith(rule, 'upstream', {
      BOILERPLATE_SYNC_LOCAL_PATH: 'package.json',
      BOILERPLATE_SYNC_SOURCE: 'owner/repo',
      BOILERPLATE_SYNC_SOURCE_PATH: 'package.json',
      BOILERPLATE_SYNC_REF: 'main',
      BOILERPLATE_SYNC_RESOLVED_REF: 'main',
      BOILERPLATE_SYNC_FILE_EXISTS: 'true',
    });
  });

  it('writes the output when it differs from the local file', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('old');
    vi.mocked(runTransform).mockResolvedValue({ ok: true, content: 'new' });

    const summary = await syncFiles(inputs);

    expect(summary.updated).toHaveLength(1);
    expect(fs.writeFile).toHaveBeenCalledWith('package.json', 'new', 'utf-8');
  });

  it('creates a missing file from the output, telling the transform it does not exist', async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(runTransform).mockResolvedValue({ ok: true, content: 'new' });

    const summary = await syncFiles(inputs);

    expect(summary.created).toHaveLength(1);
    expect(fs.writeFile).toHaveBeenCalledWith('package.json', 'new', 'utf-8');
    expect(vi.mocked(runTransform).mock.calls[0][2]).toMatchObject({
      BOILERPLATE_SYNC_FILE_EXISTS: 'false',
    });
  });

  it('passes an empty ref when none is configured', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('same');
    vi.mocked(runTransform).mockResolvedValue({ ok: true, content: 'same' });
    fetchReturning('upstream', 'develop');

    await syncFiles({
      ...inputs,
      sources: [{ source: 'owner/repo', default_files: ['package.json'] }],
    });

    expect(vi.mocked(runTransform).mock.calls[0][2]).toMatchObject({
      BOILERPLATE_SYNC_REF: '',
      BOILERPLATE_SYNC_RESOLVED_REF: 'develop',
    });
  });

  it('does not run the transform when the file is missing and create-missing is false', async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

    const summary = await syncFiles({ ...inputs, createMissing: false });

    expect(summary.skipped).toHaveLength(1);
    expect(runTransform).not.toHaveBeenCalled();
  });

  it('marks the file failed and leaves it untouched when the transform fails', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('old');
    vi.mocked(runTransform).mockResolvedValue({
      ok: false,
      error: "transform 'package.json' exited with code 3: bad input",
    });

    const summary = await syncFiles(inputs);

    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].error).toBe(
      "transform 'package.json' exited with code 3: bad input"
    );
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('stops after a failed transform when fail-on-error is true', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('old');
    vi.mocked(runTransform).mockResolvedValue({ ok: false, error: 'boom' });

    const summary = await syncFiles({
      ...inputs,
      failOnError: true,
      sources: [{ source: 'owner/repo', default_files: ['package.json', 'README.md'] }],
    });

    expect(summary.total).toBe(1);
    expect(summary.failed).toHaveLength(1);
  });

  it('leaves files that no key matches alone', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('old');
    vi.mocked(runTransform).mockResolvedValue({ ok: true, content: 'new' });

    const summary = await syncFiles({
      ...inputs,
      sources: [{ source: 'owner/repo', default_files: ['package.json', 'README.md'] }],
    });

    expect(runTransform).toHaveBeenCalledTimes(1);
    expect(summary.updated).toHaveLength(2);
    expect(fs.writeFile).toHaveBeenCalledWith('README.md', 'upstream', 'utf-8');
  });
});

describe('syncFiles with pre-sync', () => {
  const inputs: ActionInputs = {
    sources: [{ source: 'owner/repo', ref: 'main', default_files: ['test.ts'] }],
    githubToken: 'gh-token',
    createMissing: true,
    failOnError: false,
    hooks: withHooks({ preSync: ['test -f lock'], postSync: ['npm test'] }),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('mock content');
  });

  it('runs pre-sync once, before fetching any content, and not post-sync', async () => {
    await syncFiles(inputs);

    expect(runHookCommands).toHaveBeenCalledTimes(1);
    expect(runHookCommands).toHaveBeenCalledWith('pre-sync', ['test -f lock'], {});
    expect(vi.mocked(runHookCommands).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createGitHubSource).mock.invocationCallOrder[0]
    );
  });

  it('aborts before fetching any content or writing when pre-sync fails', async () => {
    vi.mocked(runHookCommands).mockRejectedValue(
      new HookError('pre-sync command 1 of 1 exited with code 1: test -f lock')
    );

    await expect(syncFiles(inputs)).rejects.toThrow(HookError);
    expect(createGitHubSource).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('runs no hook when none is configured', async () => {
    await syncFiles({ ...inputs, hooks: undefined });

    expect(runHookCommands).not.toHaveBeenCalled();
    expect(runTransform).not.toHaveBeenCalled();
  });
});

describe('syncFiles hook checks after glob expansion', () => {
  const globInputs = (hooks: HooksConfig): ActionInputs => ({
    sources: [{ source: 'owner/repo', ref: 'main', default_files: ['scripts/**', 'docs/*.md'] }],
    githubToken: 'gh-token',
    createMissing: true,
    failOnError: false,
    hooks,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isGlobPattern).mockImplementation((pattern: string) => pattern.includes('*'));
    vi.mocked(listFilesMatchingGlob).mockImplementation(async (_o, _r, pattern) =>
      pattern === 'scripts/**' ? ['scripts/fmt.sh'] : ['docs/a.md', 'docs/b.md']
    );
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('old');
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  it('runs pre-sync after glob expansion and the hook checks', async () => {
    await syncFiles(globInputs(withHooks({ preSync: ['test -f lock'] })));

    const preSync = vi.mocked(runHookCommands).mock.invocationCallOrder[0];
    expect(preSync).toBeGreaterThan(vi.mocked(listFilesMatchingGlob).mock.invocationCallOrder[1]);
    expect(preSync).toBeLessThan(vi.mocked(createGitHubSource).mock.invocationCallOrder[0]);
  });

  it('rejects a pre-sync command that names a glob-expanded path before it runs', async () => {
    // A previous sync left scripts/fmt.sh, matched by scripts/**, in the workspace
    const sync = syncFiles(globInputs(withHooks({ preSync: ['bash scripts/fmt.sh'] })));

    await expect(sync).rejects.toThrow(/hooks\.pre-sync.*'scripts\/fmt\.sh'/);
    expect(runHookCommands).not.toHaveBeenCalled();
    expect(createGitHubSource).not.toHaveBeenCalled();
  });

  it('fails closed, running no hook, when a glob fails to expand', async () => {
    vi.mocked(listFilesMatchingGlob).mockRejectedValue(new Error('tree API unavailable'));

    const sync = syncFiles(globInputs(withHooks({ preSync: ['bash scripts/fmt.sh'] })));

    await expect(sync).rejects.toThrow(ConfigError);
    await expect(sync).rejects.toThrow(/'scripts\/\*\*'.*did not expand/);
    expect(runHookCommands).not.toHaveBeenCalled();
    expect(createGitHubSource).not.toHaveBeenCalled();
  });

  it('fails closed when a glob matches no file', async () => {
    vi.mocked(listFilesMatchingGlob).mockImplementation(async (_o, _r, pattern) =>
      pattern === 'scripts/**' ? [] : ['docs/a.md']
    );

    await expect(
      syncFiles(globInputs(withHooks({ postSync: ['npm test'] })))
    ).rejects.toThrow(/'scripts\/\*\*'.*did not expand/);
    expect(createGitHubSource).not.toHaveBeenCalled();
  });

  it('rejects a hook whose unquoted glob would expand to a synced path', async () => {
    const sync = syncFiles(globInputs(withHooks({ postSync: ['bash scripts/*.sh'] })));

    await expect(sync).rejects.toThrow(/hooks\.post-sync.*'scripts\/fmt\.sh'/);
  });

  it('rejects a hook that names an expanded path, before fetching any content', async () => {
    const sync = syncFiles(globInputs(withHooks({ postSync: ['./scripts/fmt.sh'] })));

    await expect(sync).rejects.toThrow(ConfigError);
    await expect(sync).rejects.toThrow(/hooks\.post-sync.*'scripts\/fmt\.sh'/);
    expect(createGitHubSource).not.toHaveBeenCalled();
  });

  it('rejects a file matched by two transform keys, before fetching any content', async () => {
    const hooks = withHooks({
      transform: [
        { pattern: 'docs/*.md', command: 'cat' },
        { pattern: 'docs/a.md', command: 'cat' },
      ],
    });

    await expect(syncFiles(globInputs(hooks))).rejects.toThrow(/more than one key/);
    expect(createGitHubSource).not.toHaveBeenCalled();
    expect(runTransform).not.toHaveBeenCalled();
  });

  it('transforms each file a glob key matches', async () => {
    const rule = { pattern: 'docs/*.md', command: 'sed s/a/b/' };
    vi.mocked(runTransform).mockResolvedValue({ ok: true, content: 'new' });

    await syncFiles(globInputs(withHooks({ transform: [rule] })));

    expect(runTransform).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runTransform).mock.calls.map((call) => call[2].BOILERPLATE_SYNC_LOCAL_PATH)).toEqual([
      'docs/a.md',
      'docs/b.md',
    ]);
  });
});

describe('runPostSync', () => {
  const summary = (overrides: Partial<SyncSummary>): SyncSummary => ({
    updated: [],
    created: [],
    skipped: [],
    failed: [],
    total: 0,
    hasChanges: false,
    allFailed: false,
    ...overrides,
  });
  const failedResult = {
    config: { local_path: 'a', source_path: 'a', source: 'o/r', origin: 'default_files' as const },
    status: 'failed' as const,
    error: 'boom',
  };
  const inputs = (failOnError: boolean, postSync: string[]): ActionInputs => ({
    sources: [],
    githubToken: 'gh-token',
    createMissing: true,
    failOnError,
    hooks: withHooks({ postSync }),
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('runs post-sync with BOILERPLATE_SYNC_HAS_CHANGES', async () => {
    await expect(runPostSync(inputs(false, ['npm test']), summary({ hasChanges: true }))).resolves.toBe(true);
    expect(runHookCommands).toHaveBeenCalledWith('post-sync', ['npm test'], {
      BOILERPLATE_SYNC_HAS_CHANGES: 'true',
    });

    await runPostSync(inputs(false, ['npm test']), summary({ hasChanges: false }));
    expect(runHookCommands).toHaveBeenLastCalledWith('post-sync', ['npm test'], {
      BOILERPLATE_SYNC_HAS_CHANGES: 'false',
    });
  });

  it('runs post-sync after failed files when fail-on-error is false', async () => {
    await runPostSync(inputs(false, ['npm test']), summary({ failed: [failedResult] }));

    expect(runHookCommands).toHaveBeenCalledTimes(1);
  });

  it('skips post-sync when fail-on-error is true and a file failed', async () => {
    await expect(
      runPostSync(inputs(true, ['npm test']), summary({ failed: [failedResult] }))
    ).resolves.toBe(false);
    expect(runHookCommands).not.toHaveBeenCalled();
  });

  it('does nothing when post-sync is not configured', async () => {
    await expect(runPostSync(inputs(false, []), summary({}))).resolves.toBe(false);
    await expect(
      runPostSync({ ...inputs(false, []), hooks: undefined }, summary({}))
    ).resolves.toBe(false);
    expect(runHookCommands).not.toHaveBeenCalled();
  });

  it('propagates a post-sync failure', async () => {
    vi.mocked(runHookCommands).mockRejectedValue(new HookError('post-sync failed'));

    await expect(runPostSync(inputs(false, ['npm test']), summary({}))).rejects.toThrow(HookError);
  });
});
