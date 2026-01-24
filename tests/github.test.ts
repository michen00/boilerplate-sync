import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GitHubSource,
  clearBranchCache,
  createGitHubSource,
} from '../src/sources/github';

// Mock Octokit
const mockRepos = {
  get: vi.fn(),
  getContent: vi.fn(),
};

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    repos = mockRepos;
  },
}));

describe('GitHubSource', () => {
  beforeEach(() => {
    clearBranchCache();
    vi.clearAllMocks();
  });

  describe('createGitHubSource', () => {
    it('creates a GitHubSource instance', () => {
      const source = createGitHubSource('owner/repo', 'path/to/file.ts', 'main');
      expect(source).toBeInstanceOf(GitHubSource);
      expect(source.type).toBe('github');
    });
  });

  describe('toString', () => {
    it('formats without resolved ref', () => {
      const source = createGitHubSource('owner/repo', 'path/to/file.ts', 'main');
      expect(source.toString()).toBe('owner/repo@main:path/to/file.ts');
    });

    it('formats without specified ref', () => {
      const source = createGitHubSource('owner/repo', 'path/to/file.ts');
      expect(source.toString()).toBe('owner/repo@default:path/to/file.ts');
    });
  });

  describe('getSourceId', () => {
    it('returns owner/repo format', () => {
      const source = createGitHubSource('owner/repo', 'path/to/file.ts');
      expect(source.getSourceId()).toBe('owner/repo');
    });
  });

  describe('getRef', () => {
    it('returns the configured ref', () => {
      const source = createGitHubSource('owner/repo', 'path/to/file.ts', 'main');
      expect(source.getRef()).toBe('main');
    });

    it('returns undefined when no ref specified', () => {
      const source = createGitHubSource('owner/repo', 'path/to/file.ts');
      expect(source.getRef()).toBeUndefined();
    });
  });

  describe('fetch', () => {
    it('fetches file content successfully', async () => {
      mockRepos.get.mockResolvedValue({
        data: { default_branch: 'main' },
      });

      const fileContent = 'test file content';
      const base64Content = Buffer.from(fileContent).toString('base64');

      mockRepos.getContent.mockResolvedValue({
        data: {
          type: 'file',
          content: base64Content,
          sha: 'abc123',
        },
      });

      const source = createGitHubSource('owner/repo', 'path/to/file.ts', 'main');
      const result = await source.fetch('token');

      expect(result.content).toBe(fileContent);
      expect(result.sha).toBe('abc123');
      expect(result.resolvedRef).toBe('main');
    });

    it('uses default branch when ref not specified', async () => {
      mockRepos.get.mockResolvedValue({
        data: { default_branch: 'develop' },
      });

      mockRepos.getContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from('content').toString('base64'),
          sha: 'def456',
        },
      });

      const source = createGitHubSource('owner/repo', 'path/to/file.ts');
      const result = await source.fetch('token');

      expect(result.resolvedRef).toBe('develop');
      expect(mockRepos.get).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
      });
    });

    it('throws error when file not found', async () => {
      mockRepos.getContent.mockRejectedValue(new Error('Not Found'));

      const source = createGitHubSource('owner/repo', 'missing.ts', 'main');

      await expect(source.fetch('token')).rejects.toThrow(
        'File not found: missing.ts in owner/repo@main',
      );
    });

    it('throws error when path is a directory', async () => {
      mockRepos.getContent.mockResolvedValue({
        data: [
          { type: 'file', name: 'file1.ts' },
          { type: 'file', name: 'file2.ts' },
        ],
      });

      const source = createGitHubSource('owner/repo', 'directory/', 'main');

      await expect(source.fetch('token')).rejects.toThrow(
        "Path 'directory/' is a directory, not a file",
      );
    });

    it('throws error on authentication failure', async () => {
      mockRepos.getContent.mockRejectedValue(new Error('Bad credentials'));

      const source = createGitHubSource('owner/private-repo', 'file.ts', 'main');

      await expect(source.fetch('invalid-token')).rejects.toThrow(
        'Authentication failed for owner/private-repo. Check your token.',
      );
    });
  });

  describe('parseSource', () => {
    it('throws error for invalid source format', () => {
      expect(() => createGitHubSource('invalid', 'path', 'main')).toThrow(
        "Invalid source format: 'invalid'. Expected 'owner/repo' format.",
      );

      expect(() => createGitHubSource('owner/repo/extra', 'path', 'main')).toThrow(
        "Invalid source format: 'owner/repo/extra'. Expected 'owner/repo' format.",
      );
    });
  });
});
