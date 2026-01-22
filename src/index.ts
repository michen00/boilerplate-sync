import * as core from '@actions/core';
import { getInputs, logConfig, ConfigError } from './config';
import { syncFiles } from './sync';
import { createOrUpdatePr, shouldCreatePr } from './pr';
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
  
  if (outputs.prNumber !== undefined) {
    core.setOutput('pr-number', outputs.prNumber.toString());
  }
  
  if (outputs.prUrl !== undefined) {
    core.setOutput('pr-url', outputs.prUrl);
  }
  
  core.setOutput('summary', JSON.stringify(outputs.summary));
}

/**
 * Build outputs from sync summary and PR result
 */
function buildOutputs(
  summary: SyncSummary,
  prNumber?: number,
  prUrl?: string
): ActionOutputs {
  return {
    hasChanges: summary.hasChanges,
    updatedCount: summary.updated.length + summary.created.length,
    failedCount: summary.failed.length,
    skippedCount: summary.skipped.length,
    prNumber,
    prUrl,
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

    // Determine if we need to create a PR
    if (shouldCreatePr(summary)) {
      core.info('');
      core.info('Creating pull request...');
      
      const prResult = await createOrUpdatePr(inputs, summary);
      
      const outputs = buildOutputs(summary, prResult.number, prResult.url);
      setOutputs(outputs);

      if (prResult.isDraft) {
        core.warning(
          `Created draft PR #${prResult.number} because all files failed to sync`
        );
      } else {
        core.info(`PR #${prResult.number} ready for review: ${prResult.url}`);
      }
    } else {
      core.info('');
      core.info('No changes detected and no failures - skipping PR creation');
      
      const outputs = buildOutputs(summary);
      setOutputs(outputs);
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
