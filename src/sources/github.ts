import { Octokit } from '@octokit/rest';
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
 * Create a GitHubSource from a FileSyncConfig
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
