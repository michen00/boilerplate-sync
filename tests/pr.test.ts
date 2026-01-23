import { describe, it, expect } from 'vitest';
import { shouldCreatePr } from '../src/pr';
import type { SyncSummary, SyncResult } from '../src/sources/types';

describe('PR Logic', () => {
  describe('shouldCreatePr', () => {
    const mockResult: SyncResult = {
      config: {
        local_path: 'test.ts',
        source_path: 'src/test.ts',
        source: 'owner/repo',
      },
      status: 'updated',
      resolvedRef: 'main',
    };

    it('returns true when there are changes', () => {
      const summary: SyncSummary = {
        updated: [mockResult],
        created: [],
        skipped: [],
        failed: [],
        total: 1,
        hasChanges: true,
        allFailed: false,
      };

      expect(shouldCreatePr(summary)).toBe(true);
    });

    it('returns true when all files failed', () => {
      const failedResult: SyncResult = {
        config: {
          local_path: 'test.ts',
          source_path: 'src/test.ts',
          source: 'owner/repo',
        },
        status: 'failed',
        error: 'Network error',
      };

      const summary: SyncSummary = {
        updated: [],
        created: [],
        skipped: [],
        failed: [failedResult],
        total: 1,
        hasChanges: false,
        allFailed: true,
      };

      expect(shouldCreatePr(summary)).toBe(true);
    });

    it('returns false when no changes and no failures', () => {
      const skippedResult: SyncResult = {
        config: {
          local_path: 'test.ts',
          source_path: 'src/test.ts',
          source: 'owner/repo',
        },
        status: 'skipped',
        resolvedRef: 'main',
      };

      const summary: SyncSummary = {
        updated: [],
        created: [],
        skipped: [skippedResult],
        failed: [],
        total: 1,
        hasChanges: false,
        allFailed: false,
      };

      expect(shouldCreatePr(summary)).toBe(false);
    });

    it('returns true when files were created', () => {
      const createdResult: SyncResult = {
        config: {
          local_path: 'new.ts',
          source_path: 'src/new.ts',
          source: 'owner/repo',
        },
        status: 'created',
        resolvedRef: 'main',
        isNew: true,
      };

      const summary: SyncSummary = {
        updated: [],
        created: [createdResult],
        skipped: [],
        failed: [],
        total: 1,
        hasChanges: true,
        allFailed: false,
      };

      expect(shouldCreatePr(summary)).toBe(true);
    });

    it('returns true when there are partial failures', () => {
      const summary: SyncSummary = {
        updated: [mockResult],
        created: [],
        skipped: [],
        failed: [
          {
            config: {
              local_path: 'failed.ts',
              source_path: 'src/failed.ts',
              source: 'owner/repo',
            },
            status: 'failed',
            error: 'Not found',
          },
        ],
        total: 2,
        hasChanges: true,
        allFailed: false,
      };

      expect(shouldCreatePr(summary)).toBe(true);
    });
  });
});
