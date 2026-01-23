import * as core from '@actions/core';
import { parse as parseYaml } from 'yaml';
import type {
  ActionInputs,
  SourceConfig,
  FileMapping,
  NormalizedFileSyncConfig,
} from './sources/types';

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
 * Validate a single file mapping entry
 */
function validateFileMapping(
  entry: unknown,
  sourceIndex: number,
  fileIndex: number
): FileMapping {
  if (typeof entry !== 'object' || entry === null) {
    throw new ConfigError(
      `Source ${sourceIndex + 1}, file ${fileIndex + 1}: Expected an object, got ${typeof entry}`
    );
  }

  const obj = entry as Record<string, unknown>;

  // Validate required 'local_path' field
  if (typeof obj.local_path !== 'string' || !obj.local_path.trim()) {
    throw new ConfigError(
      `Source ${sourceIndex + 1}, file ${fileIndex + 1}: 'local_path' is required and must be a non-empty string`
    );
  }

  // Validate optional 'source_path' field
  if (obj.source_path !== undefined && typeof obj.source_path !== 'string') {
    throw new ConfigError(
      `Source ${sourceIndex + 1}, file ${fileIndex + 1}: 'source_path' must be a string if provided`
    );
  }

  return {
    local_path: obj.local_path.trim(),
    source_path:
      typeof obj.source_path === 'string' ? obj.source_path.trim() : undefined,
  };
}

/**
 * Validate a single source config entry
 */
function validateSourceConfig(
  entry: unknown,
  index: number
): SourceConfig {
  if (typeof entry !== 'object' || entry === null) {
    throw new ConfigError(
      `Source ${index + 1}: Expected an object, got ${typeof entry}`
    );
  }

  const obj = entry as Record<string, unknown>;

  // Validate required 'source' field
  if (typeof obj.source !== 'string' || !obj.source.trim()) {
    throw new ConfigError(
      `Source ${index + 1}: 'source' is required and must be a non-empty string`
    );
  }

  // Validate source format (owner/repo)
  const sourceParts = obj.source.split('/');
  if (sourceParts.length !== 2 || !sourceParts[0] || !sourceParts[1]) {
    throw new ConfigError(
      `Source ${index + 1}: 'source' must be in 'owner/repo' format, got '${obj.source}'`
    );
  }

  // Validate optional 'ref' field
  if (obj.ref !== undefined && typeof obj.ref !== 'string') {
    throw new ConfigError(
      `Source ${index + 1}: 'ref' must be a string if provided`
    );
  }

  // Validate required 'files' array
  if (!Array.isArray(obj.files)) {
    throw new ConfigError(
      `Source ${index + 1}: 'files' is required and must be an array`
    );
  }

  if (obj.files.length === 0) {
    throw new ConfigError(
      `Source ${index + 1}: 'files' array cannot be empty`
    );
  }

  // Validate each file mapping
  const files = obj.files.map((file, fileIndex) =>
    validateFileMapping(file, index, fileIndex)
  );

  return {
    source: obj.source.trim(),
    ref: typeof obj.ref === 'string' ? obj.ref.trim() : undefined,
    files,
  };
}

/**
 * Parse the 'sources' input YAML into validated configs
 */
export function parseSourcesInput(sourcesYaml: string): SourceConfig[] {
  if (!sourcesYaml.trim()) {
    throw new ConfigError("'sources' input is required and cannot be empty");
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(sourcesYaml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Failed to parse 'sources' YAML: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new ConfigError(
      `'sources' must be a YAML array, got ${typeof parsed}`
    );
  }

  if (parsed.length === 0) {
    throw new ConfigError("'sources' array cannot be empty");
  }

  return parsed.map((entry, index) => validateSourceConfig(entry, index));
}

/**
 * Normalize sources configuration into flat file sync configs
 * This flattens the nested structure for use by sync logic
 */
export function normalizeSources(
  sources: SourceConfig[]
): NormalizedFileSyncConfig[] {
  const normalized: NormalizedFileSyncConfig[] = [];

  for (const source of sources) {
    for (const file of source.files) {
      normalized.push({
        local_path: file.local_path,
        source_path: file.source_path ?? file.local_path,
        source: source.source,
        ref: source.ref,
      });
    }
  }

  return normalized;
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
  const sourcesYaml = core.getInput('sources', { required: true });
  const sources = parseSourcesInput(sourcesYaml);

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
    sources,
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
  const totalFiles = inputs.sources.reduce(
    (sum, source) => sum + source.files.length,
    0
  );

  core.info(`Configuration:`);
  core.info(`  Sources: ${inputs.sources.length}`);
  core.info(`  Files to sync: ${totalFiles}`);
  core.info(`  Create missing: ${inputs.createMissing}`);
  core.info(`  Fail on error: ${inputs.failOnError}`);
  core.info(`  PR branch: ${inputs.prBranch}`);
  core.info(`  PR labels: ${inputs.prLabels.join(', ') || '(none)'}`);
  
  core.startGroup('Sources configuration');
  for (const source of inputs.sources) {
    core.info(`  ${source.source}@${source.ref ?? '(default)'}:`);
    for (const file of source.files) {
      const sourcePath = file.source_path ?? file.local_path;
      core.info(`    ${file.local_path} <- ${sourcePath}`);
    }
  }
  core.endGroup();
}
