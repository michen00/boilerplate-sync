import type {
  NormalizedFileSyncConfig,
  SyncResult,
  SyncSummary,
} from './sources/types';

/**
 * Copy the config fields that may appear in the `summary` output. This is an
 * allowlist, not a denylist, so that `sourceToken`, and any credential added
 * to the config later, can never reach an output that workflows log, parse
 * and paste into pull request bodies.
 */
function publicConfig(config: NormalizedFileSyncConfig) {
  return {
    local_path: config.local_path,
    source_path: config.source_path,
    source: config.source,
    ref: config.ref,
    origin: config.origin,
    expandedFrom: config.expandedFrom,
  };
}

function publicResult(result: SyncResult) {
  return {
    config: publicConfig(result.config),
    status: result.status,
    error: result.error,
    resolvedRef: result.resolvedRef,
    isNew: result.isNew,
  };
}

/**
 * Serialize the summary for the `summary` output, without credentials
 */
export function serializeSummary(summary: SyncSummary): string {
  return JSON.stringify({
    updated: summary.updated.map(publicResult),
    created: summary.created.map(publicResult),
    skipped: summary.skipped.map(publicResult),
    failed: summary.failed.map(publicResult),
    total: summary.total,
    hasChanges: summary.hasChanges,
    allFailed: summary.allFailed,
  });
}

/**
 * Generate a summary for GitHub Actions step summary
 */
export function generateStepSummary(summary: SyncSummary): string {
  const lines: string[] = [];

  lines.push('# Boilerplate Sync Results');
  lines.push('');

  lines.push('| Status | Count |');
  lines.push('|--------|-------|');
  lines.push(`| ✅ Updated | ${summary.updated.length} |`);
  lines.push(`| 🆕 Created | ${summary.created.length} |`);
  lines.push(`| ⏭️ Skipped | ${summary.skipped.length} |`);
  lines.push(`| ❌ Failed | ${summary.failed.length} |`);
  lines.push(`| **Total** | **${summary.total}** |`);
  lines.push('');

  if (summary.hasChanges) {
    lines.push('✅ Changes detected');
  } else if (summary.allFailed) {
    lines.push('⚠️ All files failed');
  } else {
    lines.push('ℹ️ No changes detected');
  }

  return lines.join('\n');
}
