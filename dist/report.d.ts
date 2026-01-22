import type { SyncSummary } from './sources/types';
/**
 * Generate the PR body markdown
 */
export declare function generatePrBody(summary: SyncSummary, schedule?: string): string;
/**
 * Generate a summary for GitHub Actions step summary
 */
export declare function generateStepSummary(summary: SyncSummary): string;
/**
 * Generate commit message based on summary
 */
export declare function generateCommitMessage(summary: SyncSummary, baseMessage: string): string;
