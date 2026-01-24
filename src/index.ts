import * as core from '@actions/core';
import { getInputs, logConfig, ConfigError } from './config';
import { syncFiles } from './sync';
import { generateStepSummary } from './report';
import type { ActionOutputs, SyncSummary } from './sources/types';

/**
 * Set action outputs
 */
function setOutputs(outputs: ActionOutputs): void {
  core.setOutput('has-changes', outputs.hasChanges.toString());
  core.setOutput('updated-count', outputs.updatedCount.toString());
  core.setOutput('failed-count', outputs.failedCount.toString());
  core.setOutput('skipped-count', outputs.skippedCount.toString());
  core.setOutput('summary', JSON.stringify(outputs.summary));
}

/**
 * Build outputs from sync summary
 */
function buildOutputs(summary: SyncSummary): ActionOutputs {
  return {
    hasChanges: summary.hasChanges,
    updatedCount: summary.updated.length + summary.created.length,
    failedCount: summary.failed.length,
    skippedCount: summary.skipped.length,
    summary,
  };
}

/**
 * Main action entry point
 */
async function run(): Promise<void> {
  try {
    // Parse and validate inputs
    core.info('Parsing configuration...');
    const inputs = getInputs();
    logConfig(inputs);

    // Sync files
    core.info('');
    core.info('Syncing files...');
    const summary = await syncFiles(inputs);

    // Write step summary
    await core.summary
      .addRaw(generateStepSummary(summary))
      .write();

    // Set outputs
    const outputs = buildOutputs(summary);
    setOutputs(outputs);

    if (summary.hasChanges) {
      core.info('');
      core.info('Changes detected - files have been updated in the workspace');
    } else {
      core.info('');
      core.info('No changes detected');
    }

    // Fail the action if there were failures and fail-on-error is true
    if (inputs.failOnError && summary.failed.length > 0) {
      core.setFailed(
        `${summary.failed.length} file(s) failed to sync`
      );
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      core.setFailed(`Configuration error: ${error.message}`);
    } else if (error instanceof Error) {
      core.setFailed(`Action failed: ${error.message}`);
      core.debug(error.stack ?? '');
    } else {
      core.setFailed(`Action failed: ${String(error)}`);
    }
  }
}

// Run the action
void run();
