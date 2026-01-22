/**
 * Configuration for a single file sync operation
 */
export interface FileSyncConfig {
  /** Path in the target (current) repository */
  project: string;
  /** Source repository in 'owner/repo' format */
  source: string;
  /** Path to the file in the source repository */
  path: string;
  /** Git ref (branch, tag, SHA) - optional, uses default branch if not specified */
  ref?: string;
}

/**
 * Result of fetching a file from a source
 */
export interface FetchResult {
  /** File content as a string */
  content: string;
  /** SHA of the file (for GitHub sources) */
  sha?: string;
  /** ETag for HTTP caching (for future HTTP sources) */
  etag?: string;
  /** The actual ref used (resolved default branch) */
  resolvedRef: string;
}

/**
 * Interface for file sources (GitHub, HTTP, etc.)
 */
export interface FileSource {
  /** Type identifier */
  readonly type: 'github' | 'http';
  
  /** Fetch the file content */
  fetch(token?: string): Promise<FetchResult>;
  
  /** Human-readable string for logging and PR body */
  toString(): string;
  
  /** Get the source identifier (e.g., 'owner/repo') */
  getSourceId(): string;
  
  /** Get the ref used */
  getRef(): string | undefined;
}

/**
 * Status of a sync operation for a single file
 */
export type SyncStatus = 'updated' | 'created' | 'skipped' | 'failed';

/**
 * Result of syncing a single file
 */
export interface SyncResult {
  /** The original config for this file */
  config: FileSyncConfig;
  /** Status of the operation */
  status: SyncStatus;
  /** Error message if status is 'failed' */
  error?: string;
  /** The resolved ref that was used */
  resolvedRef?: string;
  /** Whether the file was newly created */
  isNew?: boolean;
}

/**
 * Summary of all sync operations
 */
export interface SyncSummary {
  /** Files that were updated */
  updated: SyncResult[];
  /** Files that were newly created */
  created: SyncResult[];
  /** Files that were skipped (no changes) */
  skipped: SyncResult[];
  /** Files that failed to sync */
  failed: SyncResult[];
  /** Total files processed */
  total: number;
  /** Whether any changes were made */
  hasChanges: boolean;
  /** Whether all files failed */
  allFailed: boolean;
}

/**
 * Parsed action inputs
 */
export interface ActionInputs {
  files: FileSyncConfig[];
  githubToken: string;
  sourceToken: string;
  createMissing: boolean;
  failOnError: boolean;
  prTitle: string;
  prLabels: string[];
  prBranch: string;
  commitMessage: string;
  schedule?: string;
}

/**
 * Action outputs
 */
export interface ActionOutputs {
  hasChanges: boolean;
  updatedCount: number;
  failedCount: number;
  skippedCount: number;
  prNumber?: number;
  prUrl?: string;
  summary: SyncSummary;
}
