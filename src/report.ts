import type { SyncSummary } from './sources/types';

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
