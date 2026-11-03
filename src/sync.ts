import * as core from '@actions/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  createGitHubSource,
  isGlobPattern,
  listFilesMatchingGlob,
} from './sources/github';
import {
  assignTransforms,
  checkHookReferences,
  ConfigError,
  isUnexpandedGlob,
  normalizeSources,
} from './config';
import { runHookCommands, runTransform } from './hooks';
import type {
  NormalizedFileSyncConfig,
  SyncResult,
  SyncSummary,
  ActionInputs,
  TransformRule,
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
 * Sync a single file from source to project. When a transform rule applies,
 * its output replaces the fetched content before the unchanged check.
 */
async function syncFile(
  config: NormalizedFileSyncConfig,
  fallbackToken: string,
  createMissing: boolean,
  transform?: TransformRule
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
    let newContent = fetchResult.content;

    // Compare with existing content
    const existingContent = exists ? await readFile(local_path) : null;

    if (transform) {
      core.info(`  Transforming with hooks.transform['${transform.pattern}']`);
      const transformed = await runTransform(transform, fetchResult.content, {
        BOILERPLATE_SYNC_LOCAL_PATH: local_path,
        BOILERPLATE_SYNC_SOURCE: source,
        BOILERPLATE_SYNC_SOURCE_PATH: source_path,
        BOILERPLATE_SYNC_REF: ref ?? '',
        BOILERPLATE_SYNC_RESOLVED_REF: fetchResult.resolvedRef,
        BOILERPLATE_SYNC_FILE_EXISTS: String(existingContent !== null),
      });

      if (!transformed.ok) {
        // Nothing has been written yet, so the local file is untouched
        core.warning(`  Failed: ${transformed.error}`);
        return {
          config,
          status: 'failed',
          error: transformed.error,
          resolvedRef: fetchResult.resolvedRef,
        };
      }
      newContent = transformed.content;
    }

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

    // Globs are only supported in `default_files`, where local_path mirrors
    // source_path. In `file_pairs` the explicit local_path would be silently
    // discarded by expansion, so fail fast instead of remapping silently.
    if (config.origin === 'file_pairs') {
      throw new ConfigError(
        `Glob patterns are not supported in \`file_pairs\` ` +
          `(source: '${config.source_path}'); use \`default_files\` for globs.`
      );
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
  const { sources, githubToken, createMissing, failOnError, hooks } = inputs;

  // Normalize sources into flat file configs
  const normalizedConfigs = normalizeSources(sources);

  // Expand any glob patterns
  const expandedConfigs = await expandGlobPatterns(normalizedConfigs, githubToken);

  // Check every hook against every synced path, glob-expanded ones included,
  // before any hook runs: an earlier sync may have left a source-controlled
  // copy of such a file in the workspace for pre-sync to run.
  let transforms: Array<TransformRule | undefined> = [];
  if (hooks) {
    // A glob that failed to expand, or matched nothing, hides which files it
    // syncs, and copies from an earlier sync may still be in the workspace.
    // Fail closed rather than run hooks that cannot be checked against them.
    const unexpanded = expandedConfigs
      .filter(isUnexpandedGlob)
      .map((config) => `'${config.source_path}'`);
    if (unexpanded.length > 0) {
      throw new ConfigError(
        `hooks: ${unexpanded.join(', ')} did not expand to any file, so hook ` +
          'commands cannot be checked against the paths it syncs; no hook was run'
      );
    }

    checkHookReferences(
      hooks,
      expandedConfigs.map((config) => config.local_path)
    );
    transforms = assignTransforms(expandedConfigs, hooks.transform);

    // pre-sync runs before any file content is fetched
    if (hooks.preSync.length > 0) {
      await runHookCommands('pre-sync', hooks.preSync, {});
    }
  }

  const results: SyncResult[] = [];

  for (const [index, config] of expandedConfigs.entries()) {
    // githubToken is used as fallback when no per-source token is specified
    const result = await syncFile(config, githubToken, createMissing, transforms[index]);
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

/**
 * Run the post-sync hook, if configured. It is skipped when fail-on-error
 * is true and any file failed, because the sync then stopped early and the
 * action fails anyway. Returns whether it ran; throws HookError on failure.
 */
export async function runPostSync(
  inputs: ActionInputs,
  summary: SyncSummary
): Promise<boolean> {
  const commands = inputs.hooks?.postSync ?? [];
  if (commands.length === 0) {
    return false;
  }

  if (inputs.failOnError && summary.failed.length > 0) {
    core.info('Skipping post-sync: fail-on-error stopped the sync');
    return false;
  }

  await runHookCommands('post-sync', commands, {
    BOILERPLATE_SYNC_HAS_CHANGES: String(summary.hasChanges),
  });
  return true;
}
