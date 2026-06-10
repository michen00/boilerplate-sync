import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearBranchCache,
  getDefaultBranch,
  isGlobPattern,
  listFilesMatchingGlob,
} from '../src/sources/github';

// Shared mock fns so individual tests can drive the ref-resolution fallbacks
// (per-instance vi.fn()s could not be reconfigured from inside a test).
const mockRepos = {
  get: vi.fn(),
};
const mockGit = {
  getRef: vi.fn(),
  getTree: vi.fn(),
  getCommit: vi.fn(),
};

const DEFAULT_TREE = [
  { type: 'blob', path: '.eslintrc.js' },
  { type: 'blob', path: '.prettierrc' },
  { type: 'blob', path: '.github/ISSUE_TEMPLATE/bug_report.md' },
  { type: 'blob', path: '.github/ISSUE_TEMPLATE/feature_request.md' },
  { type: 'blob', path: '.github/workflows/ci.yml' },
  { type: 'blob', path: '.github/workflows/release.yml' },
  { type: 'blob', path: 'src/index.ts' },
  { type: 'blob', path: 'src/utils/helpers.ts' },
  { type: 'blob', path: 'configs/tsconfig.json' },
  { type: 'blob', path: 'configs/nested/config.json' },
  { type: 'tree', path: 'src' }, // Directory, should be filtered out
  { type: 'tree', path: '.github' }, // Directory, should be filtered out
];

// Mock @octokit/rest
vi.mock('@octokit/rest', () => ({
  Octokit: class {
    repos = mockRepos;
    git = mockGit;
  },
}));

// Restore the happy-path defaults before each test; tests that exercise the
// fallback chain override getRef/getCommit with *Once variants on top.
function resetOctokitMocks(): void {
  mockRepos.get.mockReset().mockResolvedValue({
    data: { default_branch: 'main' },
  });
  mockGit.getRef.mockReset().mockResolvedValue({
    data: { object: { sha: 'abc123' } },
  });
  mockGit.getTree.mockReset().mockResolvedValue({
    data: { tree: DEFAULT_TREE },
  });
  mockGit.getCommit.mockReset();
}

describe('isGlobPattern', () => {
  beforeEach(() => {
    clearBranchCache();
  });

  it('returns false for regular file paths', () => {
    expect(isGlobPattern('.eslintrc.js')).toBe(false);
    expect(isGlobPattern('src/index.ts')).toBe(false);
    expect(isGlobPattern('.github/workflows/ci.yml')).toBe(false);
  });

  it('returns true for paths with asterisk wildcard', () => {
    expect(isGlobPattern('*.md')).toBe(true);
    expect(isGlobPattern('.github/ISSUE_TEMPLATE/*.md')).toBe(true);
    expect(isGlobPattern('src/*.ts')).toBe(true);
  });

  it('returns true for paths with double asterisk (globstar)', () => {
    expect(isGlobPattern('**/*.ts')).toBe(true);
    expect(isGlobPattern('src/**/*.ts')).toBe(true);
    expect(isGlobPattern('configs/**/*.json')).toBe(true);
  });

  it('returns true for paths with question mark wildcard', () => {
    expect(isGlobPattern('file?.ts')).toBe(true);
    expect(isGlobPattern('config?.json')).toBe(true);
  });

  it('returns true for paths with character classes', () => {
    expect(isGlobPattern('[abc].ts')).toBe(true);
    expect(isGlobPattern('file[0-9].ts')).toBe(true);
  });

  it('returns true for paths with brace expansion', () => {
    expect(isGlobPattern('{a,b}.ts')).toBe(true);
    expect(isGlobPattern('*.{js,ts}')).toBe(true);
  });
});

describe('listFilesMatchingGlob', () => {
  beforeEach(() => {
    clearBranchCache();
    vi.clearAllMocks();
    resetOctokitMocks();
  });

  it('matches files with single asterisk wildcard', async () => {
    const files = await listFilesMatchingGlob(
      'owner',
      'repo',
      '.github/ISSUE_TEMPLATE/*.md',
      'main',
      'token',
    );

    expect(files).toEqual([
      '.github/ISSUE_TEMPLATE/bug_report.md',
      '.github/ISSUE_TEMPLATE/feature_request.md',
    ]);
  });

  it('matches files with globstar pattern', async () => {
    const files = await listFilesMatchingGlob(
      'owner',
      'repo',
      '**/*.ts',
      'main',
      'token',
    );

    expect(files).toEqual(['src/index.ts', 'src/utils/helpers.ts']);
  });

  it('matches files with extension pattern', async () => {
    const files = await listFilesMatchingGlob(
      'owner',
      'repo',
      '.github/workflows/*.yml',
      'main',
      'token',
    );

    expect(files).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/release.yml',
    ]);
  });

  it('matches nested files with recursive pattern', async () => {
    const files = await listFilesMatchingGlob(
      'owner',
      'repo',
      'configs/**/*.json',
      'main',
      'token',
    );

    expect(files).toEqual(['configs/nested/config.json', 'configs/tsconfig.json']);
  });

  it('returns empty array when no files match', async () => {
    const files = await listFilesMatchingGlob(
      'owner',
      'repo',
      '*.nonexistent',
      'main',
      'token',
    );

    expect(files).toEqual([]);
  });

  it('filters out directories (type !== blob)', async () => {
    const files = await listFilesMatchingGlob('owner', 'repo', '**/*', 'main', 'token');

    // Should not include 'src' or '.github' which are directories (type: 'tree')
    expect(files).not.toContain('src');
    expect(files).not.toContain('.github');
  });

  it('returns sorted results', async () => {
    const files = await listFilesMatchingGlob(
      'owner',
      'repo',
      '**/*.ts',
      'main',
      'token',
    );

    // Results should be sorted alphabetically
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });

  it('resolves the default branch when no ref is given', async () => {
    const files = await listFilesMatchingGlob(
      'owner',
      'repo',
      'src/*.ts',
      undefined,
      'token',
    );

    // The repo's default branch is fetched and then looked up as a branch ref
    expect(mockRepos.get).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' });
    expect(mockGit.getRef).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      ref: 'heads/main',
    });
    expect(files).toEqual(['src/index.ts']);
  });

  it('falls back to a tag ref when the branch ref lookup fails', async () => {
    // First getRef (heads/v1.0.0) rejects; the tag getRef (tags/v1.0.0) succeeds
    mockGit.getRef
      .mockReset()
      .mockRejectedValueOnce(new Error('Not Found'))
      .mockResolvedValueOnce({ data: { object: { sha: 'tagsha' } } });

    const files = await listFilesMatchingGlob(
      'owner',
      'repo',
      'src/*.ts',
      'v1.0.0',
      'token',
    );

    expect(mockGit.getRef).toHaveBeenNthCalledWith(1, {
      owner: 'owner',
      repo: 'repo',
      ref: 'heads/v1.0.0',
    });
    expect(mockGit.getRef).toHaveBeenNthCalledWith(2, {
      owner: 'owner',
      repo: 'repo',
      ref: 'tags/v1.0.0',
    });
    expect(mockGit.getTree).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      tree_sha: 'tagsha',
      recursive: 'true',
    });
    expect(files).toEqual(['src/index.ts']);
  });

  it('falls back to a commit SHA when neither branch nor tag refs resolve', async () => {
    // Both branch and tag getRef calls reject, leaving the commit-SHA fallback
    mockGit.getRef.mockReset().mockRejectedValue(new Error('Not Found'));
    mockGit.getCommit.mockResolvedValue({
      data: { tree: { sha: 'commit-tree-sha' } },
    });

    const sha = 'a1b2c3d4e5f6';
    const files = await listFilesMatchingGlob(
      'owner',
      'repo',
      'src/*.ts',
      sha,
      'token',
    );

    expect(mockGit.getCommit).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      commit_sha: sha,
    });
    // The tree SHA threaded through to getTree comes from the resolved commit
    expect(mockGit.getTree).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      tree_sha: 'commit-tree-sha',
      recursive: 'true',
    });
    expect(files).toEqual(['src/index.ts']);
  });
});

describe('getDefaultBranch', () => {
  beforeEach(() => {
    clearBranchCache();
    vi.clearAllMocks();
    resetOctokitMocks();
  });

  it('fetches the default branch from the repo on a cache miss', async () => {
    mockRepos.get.mockResolvedValue({ data: { default_branch: 'develop' } });

    const branch = await getDefaultBranch('owner', 'repo', 'token');

    expect(branch).toBe('develop');
    expect(mockRepos.get).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' });
  });

  it('serves a cached default branch without a second API call', async () => {
    mockRepos.get.mockResolvedValue({ data: { default_branch: 'develop' } });

    const first = await getDefaultBranch('owner', 'repo', 'token');
    const second = await getDefaultBranch('owner', 'repo', 'token');

    expect(first).toBe('develop');
    expect(second).toBe('develop');
    // The second call is served from the shared branch cache
    expect(mockRepos.get).toHaveBeenCalledTimes(1);
  });
});
