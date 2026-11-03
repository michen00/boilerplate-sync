import { describe, it, expect } from 'vitest';
import { generateStepSummary, serializeSummary } from '../src/report';
import type { SyncSummary, SyncResult, NormalizedFileSyncConfig } from '../src/sources/types';

function createConfig(overrides: Partial<NormalizedFileSyncConfig> = {}): NormalizedFileSyncConfig {
  return {
    local_path: '.eslintrc.js',
    source_path: '.eslintrc.js',
    source: 'my-org/boilerplate',
    origin: 'default_files',
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

describe('serializeSummary', () => {
  const withToken = (status: 'updated' | 'created' | 'skipped' | 'failed'): SyncResult =>
    createResult(status, {
      config: createConfig({ sourceToken: 'ghp_secret_token' }),
    });

  it('omits source tokens from every result', () => {
    const json = serializeSummary(
      createSummary({
        updated: [withToken('updated')],
        created: [withToken('created')],
        skipped: [withToken('skipped')],
        failed: [withToken('failed')],
        total: 4,
        hasChanges: true,
      })
    );

    expect(json).not.toContain('ghp_secret_token');
    expect(json).not.toContain('sourceToken');
  });

  it('keeps every other field of the summary', () => {
    const result = createResult('updated', {
      config: createConfig({
        local_path: 'docs/a.md',
        source_path: 'docs/a.md',
        ref: 'v2',
        sourceToken: 'ghp_secret_token',
        origin: 'default_files',
        expandedFrom: 'docs/*.md',
      }),
      resolvedRef: 'v2',
      isNew: false,
    });
    const failed = createResult('failed', { error: 'Not Found', resolvedRef: undefined });

    const parsed: unknown = JSON.parse(
      serializeSummary(
        createSummary({ updated: [result], failed: [failed], total: 2, hasChanges: true })
      )
    );

    expect(parsed).toEqual({
      updated: [
        {
          config: {
            local_path: 'docs/a.md',
            source_path: 'docs/a.md',
            source: 'my-org/boilerplate',
            ref: 'v2',
            origin: 'default_files',
            expandedFrom: 'docs/*.md',
          },
          status: 'updated',
          resolvedRef: 'v2',
          isNew: false,
        },
      ],
      created: [],
      skipped: [],
      failed: [
        {
          config: {
            local_path: '.eslintrc.js',
            source_path: '.eslintrc.js',
            source: 'my-org/boilerplate',
            origin: 'default_files',
          },
          status: 'failed',
          error: 'Not Found',
        },
      ],
      total: 2,
      hasChanges: true,
      allFailed: false,
    });
  });

  it('leaves out config fields that are not on its allowlist', () => {
    const config = { ...createConfig(), futureSecret: 'hunter2' } as NormalizedFileSyncConfig;

    const json = serializeSummary(createSummary({ skipped: [createResult('skipped', { config })] }));

    expect(json).not.toContain('hunter2');
  });
});
