import { Octokit } from '@octokit/rest';
import { minimatch } from 'minimatch';
import type { FileSource, FetchResult } from './types';

/**
 * Cache for default branch lookups to avoid redundant API calls
 */
const defaultBranchCache = new Map<string, string>();

/**
 * GitHub repository file source
 * Fetches files using the GitHub Contents API
 */
export class GitHubSource implements FileSource {
  readonly type = 'github' as const;

  private readonly owner: string;
  private readonly repo: string;
  private resolvedRef?: string;

  constructor(
    private readonly source: string,
    private readonly path: string,
    private readonly ref?: string
  ) {
    const [owner, repo] = this.parseSource(source);
    this.owner = owner;
    this.repo = repo;
  }

  /**
   * Parse 'owner/repo' format into components
   */
  private parseSource(source: string): [string, string] {
    const parts = source.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `Invalid source format: '${source}'. Expected 'owner/repo' format.`
      );
    }
    return [parts[0], parts[1]];
  }

  /**
   * Get the default branch for a repository
   */
  private async getDefaultBranch(octokit: Octokit): Promise<string> {
    const cacheKey = `${this.owner}/${this.repo}`;

    const cached = defaultBranchCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const { data: repo } = await octokit.repos.get({
      owner: this.owner,
      repo: this.repo,
    });

    defaultBranchCache.set(cacheKey, repo.default_branch);
    return repo.default_branch;
  }

  /**
   * Fetch the file content from GitHub
   */
  async fetch(token?: string): Promise<FetchResult> {
    const octokit = new Octokit({ auth: token });

    // Resolve ref if not provided
    const ref = this.ref ?? await this.getDefaultBranch(octokit);
    this.resolvedRef = ref;

    try {
      const { data } = await octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: this.path,
        ref,
      });

      // getContent can return array for directories
      if (Array.isArray(data)) {
        throw new Error(
          `Path '${this.path}' is a directory, not a file`
        );
      }

      if (data.type !== 'file') {
        throw new Error(
          `Path '${this.path}' is a ${data.type}, not a file`
        );
      }

      // Content is base64 encoded
      if (!('content' in data) || !data.content) {
        throw new Error(
          `No content returned for '${this.path}'`
        );
      }

      const content = Buffer.from(data.content, 'base64').toString('utf-8');

      return {
        content,
        sha: data.sha,
        resolvedRef: ref,
      };
    } catch (error) {
      if (error instanceof Error) {
        // Enhance error messages for common cases
        if (error.message.includes('Not Found')) {
          throw new Error(
            `File not found: ${this.path} in ${this.owner}/${this.repo}@${ref}`
          );
        }
        if (error.message.includes('Bad credentials')) {
          throw new Error(
            `Authentication failed for ${this.owner}/${this.repo}. Check your token.`
          );
        }
      }
      throw error;
    }
  }

  /**
   * Human-readable representation for logging and PR body
   */
  toString(): string {
    const ref = this.resolvedRef ?? this.ref ?? 'default';
    return `${this.owner}/${this.repo}@${ref}:${this.path}`;
  }

  /**
   * Get the source identifier
   */
  getSourceId(): string {
    return `${this.owner}/${this.repo}`;
  }

  /**
   * Get the configured ref (not resolved)
   */
  getRef(): string | undefined {
    return this.ref;
  }

  /**
   * Get the resolved ref (after fetch)
   */
  getResolvedRef(): string | undefined {
    return this.resolvedRef;
  }
}

/**
 * Create a GitHubSource from source repository, path, and optional ref
 */
export function createGitHubSource(
  source: string,
  path: string,
  ref?: string
): GitHubSource {
  return new GitHubSource(source, path, ref);
}

/**
 * Clear the default branch cache (useful for testing)
 */
export function clearBranchCache(): void {
  defaultBranchCache.clear();
}

/**
 * Check if a path contains glob pattern characters
 */
export function isGlobPattern(path: string): boolean {
  // Match glob special characters: *, ?, [, ], {, }
  return /[*?[\]{}]/.test(path);
}

/**
 * Get the default branch for a repository (standalone function for use outside GitHubSource)
 */
export async function getDefaultBranch(
  owner: string,
  repo: string,
  token: string
): Promise<string> {
  const cacheKey = `${owner}/${repo}`;

  const cached = defaultBranchCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.repos.get({ owner, repo });

  defaultBranchCache.set(cacheKey, data.default_branch);
  return data.default_branch;
}

/**
 * List all files in a repository matching a glob pattern
 */
export async function listFilesMatchingGlob(
  owner: string,
  repo: string,
  pattern: string,
  ref: string | undefined,
  token: string
): Promise<string[]> {
  const octokit = new Octokit({ auth: token });

  // Resolve ref to default branch if not provided
  const resolvedRef = ref ?? await getDefaultBranch(owner, repo, token);

  // Get the tree SHA for the ref
  const { data: refData } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${resolvedRef}`,
  }).catch(async () => {
    // If not a branch, try as a tag
    return octokit.git.getRef({
      owner,
      repo,
      ref: `tags/${resolvedRef}`,
    });
  }).catch(async () => {
    // If not a tag, assume it's a commit SHA and get the commit
    const { data: commit } = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: resolvedRef,
    });
    return { data: { object: { sha: commit.tree.sha } } };
  });

  // Fetch the full tree recursively
  const { data: tree } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: refData.object.sha,
    recursive: 'true',
  });

  // Filter to only blobs (files) and match against the pattern
  const matchingFiles: string[] = [];

  for (const item of tree.tree) {
    if (item.type === 'blob' && item.path) {
      if (minimatch(item.path, pattern, { matchBase: false })) {
        matchingFiles.push(item.path);
      }
    }
  }

  return matchingFiles.sort();
}
