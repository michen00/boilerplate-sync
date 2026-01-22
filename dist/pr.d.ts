import type { ActionInputs, SyncSummary } from './sources/types';
/**
 * Result of PR creation
 */
export interface PrResult {
    created: boolean;
    number?: number;
    url?: string;
    isDraft: boolean;
}
/**
 * Create or update a PR with the sync results
 */
export declare function createOrUpdatePr(inputs: ActionInputs, summary: SyncSummary): Promise<PrResult>;
/**
 * Determine if a PR should be created based on summary
 */
export declare function shouldCreatePr(summary: SyncSummary): boolean;
