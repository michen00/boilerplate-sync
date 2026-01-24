import * as core from '@actions/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  createGitHubSource,
  isGlobPattern,
  listFilesMatchingGlob,
} from './sources/github';
import { normalizeSources } from './config';
import type {
  NormalizedFileSyncConfig,
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
  config: NormalizedFileSyncConfig,
  fallbackToken: string,
  createMissing: boolean
): Promise<SyncResult> {
  const { local_path, source_path, source, ref, sourceToken } = config;

  // Use per-source token if specified, otherwise fall back to github-token
  const token = sourceToken ?? fallbackToken;

  core.info(`Syncing: ${local_path}`);

  try {
    // Check if project file exists
    const exists = await fileExists(local_path);

    if (!exists && !createMissing) {
      core.info(`  Skipped: file does not exist and create-missing is false`);
      return {
        config,
        status: 'skipped',
        error: 'Project file does not exist and create-missing is disabled',
      };
    }

    // Fetch from source
    const gitSource = createGitHubSource(source, source_path, ref);
    core.info(`  Fetching from ${gitSource.toString()}`);

    const fetchResult = await gitSource.fetch(token);
    const newContent = fetchResult.content;

    // Compare with existing content
    const existingContent = exists ? await readFile(local_path) : null;

    if (existingContent !== null && existingContent === newContent) {
      core.info(`  Skipped: no changes`);
      return {
        config,
        status: 'skipped',
        resolvedRef: fetchResult.resolvedRef,
      };
    }

    // Write the new content
    await writeFile(local_path, newContent);

    const isNew = existingContent === null;
    const status = isNew ? 'created' : 'updated';

    core.info(`  ${isNew ? 'Created' : 'Updated'}: ${local_path}`);

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
 * Expand glob patterns in normalized configs into concrete file paths
 */
async function expandGlobPatterns(
  configs: NormalizedFileSyncConfig[],
  githubToken: string
): Promise<NormalizedFileSyncConfig[]> {
  const expanded: NormalizedFileSyncConfig[] = [];

  for (const config of configs) {
    // Check if the source_path contains glob patterns
    if (!isGlobPattern(config.source_path)) {
      // Not a glob pattern, keep as-is
      expanded.push(config);
      continue;
    }

    // It's a glob pattern - expand it
    core.info(`Expanding glob pattern: ${config.source_path}`);

    const [owner, repo] = config.source.split('/');
    const token = config.sourceToken ?? githubToken;

    try {
      const matchingFiles = await listFilesMatchingGlob(
        owner,
        repo,
        config.source_path,
        config.ref,
        token
      );

      if (matchingFiles.length === 0) {
        // No matches - keep the original config (will fail during sync)
        core.warning(`  No files matched pattern: ${config.source_path}`);
        expanded.push(config);
      } else {
        core.info(`  Found ${matchingFiles.length} matching file(s)`);

        // Create a config for each matching file
        for (const filePath of matchingFiles) {
          expanded.push({
            ...config,
            local_path: filePath, // For default_files, local_path === source_path
            source_path: filePath,
            expandedFrom: config.source_path,
          });
        }
      }
    } catch (error) {
      // If glob expansion fails, keep the original config (will fail during sync)
      const message = error instanceof Error ? error.message : String(error);
      core.warning(`  Failed to expand glob pattern: ${message}`);
      expanded.push(config);
    }
  }

  return expanded;
}

/**
 * Sync all files and return summary
 */
export async function syncFiles(inputs: ActionInputs): Promise<SyncSummary> {
  const { sources, githubToken, createMissing, failOnError } = inputs;

  // Normalize sources into flat file configs
  const normalizedConfigs = normalizeSources(sources);

  // Expand any glob patterns
  const expandedConfigs = await expandGlobPatterns(normalizedConfigs, githubToken);

  const results: SyncResult[] = [];

  for (const config of expandedConfigs) {
    // githubToken is used as fallback when no per-source token is specified
    const result = await syncFile(config, githubToken, createMissing);
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
