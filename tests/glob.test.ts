import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearBranchCache,
  isGlobPattern,
  listFilesMatchingGlob,
} from '../src/sources/github';

// Mock @octokit/rest
vi.mock('@octokit/rest', () => ({
  Octokit: class {
    repos = {
      get: vi.fn().mockResolvedValue({
        data: { default_branch: 'main' },
      }),
    };
    git = {
      getRef: vi.fn().mockResolvedValue({
        data: { object: { sha: 'abc123' } },
      }),
      getTree: vi.fn().mockResolvedValue({
        data: {
          tree: [
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
          ],
        },
      }),
    };
  },
}));

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
});
