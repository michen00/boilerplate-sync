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
 * Create a GitHubSource from a FileSyncConfig
 */
export declare function createGitHubSource(source: string, path: string, ref?: string): GitHubSource;
/**
 * Clear the default branch cache (useful for testing)
 */
export declare function clearBranchCache(): void;
//# sourceMappingURL=github.d.ts.map