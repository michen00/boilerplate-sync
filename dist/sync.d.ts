import type { SyncSummary, ActionInputs } from './sources/types';
/**
 * Sync all files and return summary
 */
export declare function syncFiles(inputs: ActionInputs): Promise<SyncSummary>;
