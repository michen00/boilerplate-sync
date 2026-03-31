import type { FileSource, FetchResult } from './types';
/**
 * GitHub repository file source
 * Fetches files using the GitHub Contents API
 */
export declare class GitHubSource implements FileSource {
    private readonly source;
    private readonly path;
    private readonly ref?;
    readonly type: "github";
    private readonly owner;
    private readonly repo;
    private resolvedRef?;
    constructor(source: string, path: string, ref?: string | undefined);
    /**
     * Parse 'owner/repo' format into components
     */
    private parseSource;
    /**
     * Get the default branch for a repository
     */
    private getDefaultBranch;
    /**
     * Fetch the file content from GitHub
     */
    fetch(token?: string): Promise<FetchResult>;
    /**
     * Human-readable representation for logging and PR body
     */
    toString(): string;
    /**
     * Get the source identifier
     */
    getSourceId(): string;
    /**
     * Get the configured ref (not resolved)
     */
    getRef(): string | undefined;
    /**
     * Get the resolved ref (after fetch)
     */
    getResolvedRef(): string | undefined;
}
/**
 * Create a GitHubSource from source repository, path, and optional ref
 */
export declare function createGitHubSource(source: string, path: string, ref?: string): GitHubSource;
/**
 * Clear the default branch cache (useful for testing)
 */
export declare function clearBranchCache(): void;
/**
 * Check if a path contains glob pattern characters
 */
export declare function isGlobPattern(path: string): boolean;
/**
 * Get the default branch for a repository (standalone function for use outside GitHubSource)
 */
export declare function getDefaultBranch(owner: string, repo: string, token: string): Promise<string>;
/**
 * List all files in a repository matching a glob pattern
 */
export declare function listFilesMatchingGlob(owner: string, repo: string, pattern: string, ref: string | undefined, token: string): Promise<string[]>;
//# sourceMappingURL=github.d.ts.map