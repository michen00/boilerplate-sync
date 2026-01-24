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
 * Validate default_files array (simple string list)
 */
function validateDefaultFiles(
  files: unknown,
  sourceIndex: number
): string[] {
  if (!Array.isArray(files)) {
    throw new ConfigError(
      `Source ${sourceIndex + 1}: 'default_files' must be an array`
    );
  }

  const validated: string[] = [];
  const fileArray = files as unknown[];
  for (let i = 0; i < fileArray.length; i++) {
    const file: unknown = fileArray[i];
    if (typeof file !== 'string' || !file.trim()) {
      throw new ConfigError(
        `Source ${sourceIndex + 1}, default_files[${i}]: must be a non-empty string`
      );
    }
    validated.push(file.trim());
  }

  return validated;
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

  // Validate optional 'source-token' field
  if (obj['source-token'] !== undefined && typeof obj['source-token'] !== 'string') {
    throw new ConfigError(
      `Source ${index + 1}: 'source-token' must be a string if provided`
    );
  }

  // Validate optional 'default_files' array
  let defaultFiles: string[] | undefined;
  if (obj.default_files !== undefined) {
    defaultFiles = validateDefaultFiles(obj.default_files, index);
  }

  // Validate optional 'file_pairs' array
  let filePairs: FileMapping[] | undefined;
  if (obj.file_pairs !== undefined) {
    if (!Array.isArray(obj.file_pairs)) {
      throw new ConfigError(
        `Source ${index + 1}: 'file_pairs' must be an array`
      );
    }
    filePairs = obj.file_pairs.map((file, fileIndex) =>
      validateFileMapping(file, index, fileIndex)
    );
  }

  // Require at least one of default_files or file_pairs
  const hasDefaultFiles = defaultFiles && defaultFiles.length > 0;
  const hasFilePairs = filePairs && filePairs.length > 0;

  if (!hasDefaultFiles && !hasFilePairs) {
    throw new ConfigError(
      `Source ${index + 1}: at least one of 'default_files' or 'file_pairs' is required`
    );
  }

  return {
    source: obj.source.trim(),
    ref: typeof obj.ref === 'string' ? obj.ref.trim() : undefined,
    'source-token': typeof obj['source-token'] === 'string' ? obj['source-token'] : undefined,
    default_files: defaultFiles,
    file_pairs: filePairs,
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
    // Process default_files (local_path === source_path)
    if (source.default_files) {
      for (const filePath of source.default_files) {
        normalized.push({
          local_path: filePath,
          source_path: filePath,
          source: source.source,
          ref: source.ref,
          sourceToken: source['source-token'],
        });
      }
    }

    // Process file_pairs (mapped paths)
    if (source.file_pairs) {
      for (const file of source.file_pairs) {
        normalized.push({
          local_path: file.local_path,
          source_path: file.source_path ?? file.local_path,
          source: source.source,
          ref: source.ref,
          sourceToken: source['source-token'],
        });
      }
    }
  }

  return normalized;
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

  const createMissing = core.getBooleanInput('create-missing');
  const failOnError = core.getBooleanInput('fail-on-error');

  return {
    sources,
    githubToken,
    createMissing,
    failOnError,
  };
}

/**
 * Log the parsed configuration (for debugging)
 */
export function logConfig(inputs: ActionInputs): void {
  const totalFiles = inputs.sources.reduce(
    (sum, source) =>
      sum + (source.default_files?.length ?? 0) + (source.file_pairs?.length ?? 0),
    0
  );

  core.info(`Configuration:`);
  core.info(`  Sources: ${inputs.sources.length}`);
  core.info(`  Files to sync: ${totalFiles}`);
  core.info(`  Create missing: ${inputs.createMissing}`);
  core.info(`  Fail on error: ${inputs.failOnError}`);

  core.startGroup('Sources configuration');
  for (const source of inputs.sources) {
    const hasCustomToken = source['source-token'] ? ' (custom token)' : '';
    core.info(`  ${source.source}@${source.ref ?? '(default)'}${hasCustomToken}:`);

    // Log default_files
    if (source.default_files) {
      for (const filePath of source.default_files) {
        core.info(`    ${filePath}`);
      }
    }

    // Log file_pairs
    if (source.file_pairs) {
      for (const file of source.file_pairs) {
        const sourcePath = file.source_path ?? file.local_path;
        core.info(`    ${file.local_path} <- ${sourcePath}`);
      }
    }
  }
  core.endGroup();
}
