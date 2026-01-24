import { describe, it, expect } from 'vitest';
import { generateStepSummary } from '../src/report';
import type { SyncSummary, SyncResult, NormalizedFileSyncConfig } from '../src/sources/types';

function createConfig(overrides: Partial<NormalizedFileSyncConfig> = {}): NormalizedFileSyncConfig {
  return {
    local_path: '.eslintrc.js',
    source_path: '.eslintrc.js',
    source: 'my-org/boilerplate',
    ...overrides,
  };
}

function createResult(
  status: 'updated' | 'created' | 'skipped' | 'failed',
  overrides: Partial<SyncResult> = {}
): SyncResult {
  return {
    config: createConfig(overrides.config),
    status,
    resolvedRef: 'main',
    ...overrides,
  };
}

function createSummary(overrides: Partial<SyncSummary> = {}): SyncSummary {
  return {
    updated: [],
    created: [],
    skipped: [],
    failed: [],
    total: 0,
    hasChanges: false,
    allFailed: false,
    ...overrides,
  };
}

describe('generateStepSummary', () => {
  it('generates summary table', () => {
    const summary = createSummary({
      updated: [createResult('updated')],
      created: [createResult('created')],
      skipped: [createResult('skipped')],
      failed: [createResult('failed')],
      total: 4,
      hasChanges: true,
    });

    const stepSummary = generateStepSummary(summary);

    expect(stepSummary).toContain('# Boilerplate Sync Results');
    expect(stepSummary).toContain('| ✅ Updated | 1 |');
    expect(stepSummary).toContain('| 🆕 Created | 1 |');
    expect(stepSummary).toContain('| ⏭️ Skipped | 1 |');
    expect(stepSummary).toContain('| ❌ Failed | 1 |');
    expect(stepSummary).toContain('| **Total** | **4** |');
  });

  it('shows changes detected message when changes detected', () => {
    const summary = createSummary({
      updated: [createResult('updated')],
      total: 1,
      hasChanges: true,
    });

    const stepSummary = generateStepSummary(summary);

    expect(stepSummary).toContain('✅ Changes detected');
  });

  it('shows all failed message when all failed', () => {
    const summary = createSummary({
      failed: [createResult('failed')],
      total: 1,
      allFailed: true,
    });

    const stepSummary = generateStepSummary(summary);

    expect(stepSummary).toContain('⚠️ All files failed');
  });

  it('shows no changes message when no changes', () => {
    const summary = createSummary({
      skipped: [createResult('skipped')],
      total: 1,
    });

    const stepSummary = generateStepSummary(summary);

    expect(stepSummary).toContain('ℹ️ No changes detected');
  });
});
