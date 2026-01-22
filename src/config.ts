import * as core from '@actions/core';
import { parse as parseYaml } from 'yaml';
import type { ActionInputs, FileSyncConfig } from './sources/types';

/**
 * Validation error for configuration
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Validate a single file sync config entry
 */
function validateFileSyncConfig(
  entry: unknown,
  index: number
): FileSyncConfig {
  if (typeof entry !== 'object' || entry === null) {
    throw new ConfigError(
      `Entry ${index + 1}: Expected an object, got ${typeof entry}`
    );
  }

  const obj = entry as Record<string, unknown>;

  // Validate required 'project' field
  if (typeof obj.project !== 'string' || !obj.project.trim()) {
    throw new ConfigError(
      `Entry ${index + 1}: 'project' is required and must be a non-empty string`
    );
  }

  // Validate required 'source' field
  if (typeof obj.source !== 'string' || !obj.source.trim()) {
    throw new ConfigError(
      `Entry ${index + 1}: 'source' is required and must be a non-empty string`
    );
  }

  // Validate source format (owner/repo)
  const sourceParts = obj.source.split('/');
  if (sourceParts.length !== 2 || !sourceParts[0] || !sourceParts[1]) {
    throw new ConfigError(
      `Entry ${index + 1}: 'source' must be in 'owner/repo' format, got '${obj.source}'`
    );
  }

  // Validate required 'path' field
  if (typeof obj.path !== 'string' || !obj.path.trim()) {
    throw new ConfigError(
      `Entry ${index + 1}: 'path' is required and must be a non-empty string`
    );
  }

  // Validate optional 'ref' field
  if (obj.ref !== undefined && typeof obj.ref !== 'string') {
    throw new ConfigError(
      `Entry ${index + 1}: 'ref' must be a string if provided`
    );
  }

  return {
    project: obj.project.trim(),
    source: obj.source.trim(),
    path: obj.path.trim(),
    ref: typeof obj.ref === 'string' ? obj.ref.trim() : undefined,
  };
}

/**
 * Parse the 'files' input YAML into validated configs
 */
export function parseFilesInput(filesYaml: string): FileSyncConfig[] {
  if (!filesYaml.trim()) {
    throw new ConfigError("'files' input is required and cannot be empty");
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(filesYaml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Failed to parse 'files' YAML: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new ConfigError(
      `'files' must be a YAML array, got ${typeof parsed}`
    );
  }

  if (parsed.length === 0) {
    throw new ConfigError("'files' array cannot be empty");
  }

  return parsed.map((entry, index) => validateFileSyncConfig(entry, index));
}

/**
 * Parse comma-separated labels into array
 */
function parseLabels(labelsInput: string): string[] {
  if (!labelsInput.trim()) {
    return [];
  }
  return labelsInput
    .split(',')
    .map(label => label.trim())
    .filter(label => label.length > 0);
}

/**
 * Get and validate all action inputs
 */
export function getInputs(): ActionInputs {
  const filesYaml = core.getInput('files', { required: true });
  const files = parseFilesInput(filesYaml);

  const githubToken = core.getInput('github-token', { required: true });
  if (!githubToken) {
    throw new ConfigError('github-token is required');
  }

  // source-token defaults to github-token
  const sourceToken = core.getInput('source-token') || githubToken;

  const createMissing = core.getBooleanInput('create-missing');
  const failOnError = core.getBooleanInput('fail-on-error');

  const prTitle = core.getInput('pr-title') || 'chore: sync boilerplate files';
  const prLabels = parseLabels(core.getInput('pr-labels'));
  const prBranch = core.getInput('pr-branch') || 'boilerplate-sync';
  const commitMessage = core.getInput('commit-message') || 'chore: sync boilerplate files';
  const schedule = core.getInput('schedule') || undefined;

  return {
    files,
    githubToken,
    sourceToken,
    createMissing,
    failOnError,
    prTitle,
    prLabels,
    prBranch,
    commitMessage,
    schedule,
  };
}

/**
 * Log the parsed configuration (for debugging)
 */
export function logConfig(inputs: ActionInputs): void {
  core.info(`Configuration:`);
  core.info(`  Files to sync: ${inputs.files.length}`);
  core.info(`  Create missing: ${inputs.createMissing}`);
  core.info(`  Fail on error: ${inputs.failOnError}`);
  core.info(`  PR branch: ${inputs.prBranch}`);
  core.info(`  PR labels: ${inputs.prLabels.join(', ') || '(none)'}`);
  
  core.startGroup('Files configuration');
  for (const file of inputs.files) {
    core.info(`  ${file.project} <- ${file.source}:${file.path}@${file.ref ?? '(default)'}`);
  }
  core.endGroup();
}
