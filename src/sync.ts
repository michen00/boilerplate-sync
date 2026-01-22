import * as core from '@actions/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createGitHubSource } from './sources/github';
import type {
  FileSyncConfig,
  SyncResult,
  SyncSummary,
  ActionInputs,
} from './sources/types';

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read file content, returns null if file doesn't exist
 */
async function readFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Write content to a file, creating directories as needed
 */
async function writeFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Sync a single file from source to project
 */
async function syncFile(
  config: FileSyncConfig,
  sourceToken: string,
  createMissing: boolean
): Promise<SyncResult> {
  const { project, source, path: sourcePath, ref } = config;

  core.info(`Syncing: ${project}`);

  try {
    // Check if project file exists
    const exists = await fileExists(project);
    
    if (!exists && !createMissing) {
      core.info(`  Skipped: file does not exist and create-missing is false`);
      return {
        config,
        status: 'skipped',
        error: 'Project file does not exist and create-missing is disabled',
      };
    }

    // Fetch from source
    const gitSource = createGitHubSource(source, sourcePath, ref);
    core.info(`  Fetching from ${gitSource.toString()}`);
    
    const fetchResult = await gitSource.fetch(sourceToken);
    const newContent = fetchResult.content;

    // Compare with existing content
    const existingContent = exists ? await readFile(project) : null;

    if (existingContent !== null && existingContent === newContent) {
      core.info(`  Skipped: no changes`);
      return {
        config,
        status: 'skipped',
        resolvedRef: fetchResult.resolvedRef,
      };
    }

    // Write the new content
    await writeFile(project, newContent);

    const isNew = existingContent === null;
    const status = isNew ? 'created' : 'updated';
    
    core.info(`  ${isNew ? 'Created' : 'Updated'}: ${project}`);

    return {
      config,
      status,
      resolvedRef: fetchResult.resolvedRef,
      isNew,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`  Failed: ${message}`);
    
    return {
      config,
      status: 'failed',
      error: message,
    };
  }
}

/**
 * Sync all files and return summary
 */
export async function syncFiles(inputs: ActionInputs): Promise<SyncSummary> {
  const { files, sourceToken, createMissing, failOnError } = inputs;

  const results: SyncResult[] = [];

  for (const config of files) {
    const result = await syncFile(config, sourceToken, createMissing);
    results.push(result);

    // If failOnError is true and this file failed, stop processing
    if (failOnError && result.status === 'failed') {
      core.error(`Stopping due to fail-on-error setting`);
      break;
    }
  }

  // Categorize results
  const updated = results.filter(r => r.status === 'updated');
  const created = results.filter(r => r.status === 'created');
  const skipped = results.filter(r => r.status === 'skipped');
  const failed = results.filter(r => r.status === 'failed');

  const hasChanges = updated.length > 0 || created.length > 0;
  const allFailed = failed.length === results.length && results.length > 0;

  const summary: SyncSummary = {
    updated,
    created,
    skipped,
    failed,
    total: results.length,
    hasChanges,
    allFailed,
  };

  // Log summary
  core.info('');
  core.info('Sync Summary:');
  core.info(`  Updated: ${updated.length}`);
  core.info(`  Created: ${created.length}`);
  core.info(`  Skipped: ${skipped.length}`);
  core.info(`  Failed: ${failed.length}`);
  core.info(`  Total: ${results.length}`);

  return summary;
}
