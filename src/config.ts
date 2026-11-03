import * as core from '@actions/core';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { parse as parseYaml } from 'yaml';
import { isGlobPattern } from './sources/github';
import type {
  ActionInputs,
  SourceConfig,
  FileMapping,
  NormalizedFileSyncConfig,
  HooksConfig,
  TransformRule,
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
          origin: 'default_files',
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
          origin: 'file_pairs',
        });
      }
    }
  }

  return normalized;
}

/** Keys allowed in the `hooks` input, in the order the hooks run */
const HOOK_KEYS = ['pre-sync', 'transform', 'post-sync'] as const;
type HookKey = (typeof HOOK_KEYS)[number];

/** The options `default_files` glob expansion uses (see sources/github.ts) */
const GLOB_OPTIONS = { matchBase: false } as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalise a local path for comparison: POSIX-normalised, with no leading
 * `./` and no trailing `/`
 */
export function normalizeLocalPath(localPath: string): string {
  const normalized = path.posix.normalize(localPath.trim());
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

/**
 * Validate `pre-sync` or `post-sync`: one command or a non-empty list
 */
function parseHookCommands(value: unknown, key: HookKey): string[] {
  const commands: unknown = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new ConfigError(
      `hooks.${key}: must be a command string or a non-empty list of command strings`
    );
  }

  return commands.map((command: unknown, index) => {
    if (typeof command !== 'string' || !command.trim()) {
      const where = typeof value === 'string' ? `hooks.${key}` : `hooks.${key}[${index}]`;
      throw new ConfigError(`${where}: must be a non-empty command string`);
    }
    return command.trim();
  });
}

/**
 * Validate `transform`: a non-empty map of local path or glob to one command
 */
function parseTransformRules(value: unknown): TransformRule[] {
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    throw new ConfigError(
      'hooks.transform: must map at least one local path or glob to a command'
    );
  }

  const rules: TransformRule[] = [];
  const seen = new Set<string>();
  for (const [key, command] of Object.entries(value)) {
    if (!key.trim()) {
      throw new ConfigError('hooks.transform: keys must be non-empty local paths or globs');
    }
    if (typeof command !== 'string' || !command.trim()) {
      throw new ConfigError(
        `hooks.transform['${key}']: must be a non-empty command string`
      );
    }

    const pattern = normalizeLocalPath(key);
    if (seen.has(pattern)) {
      throw new ConfigError(
        `hooks.transform: duplicate key '${pattern}' after removing './'`
      );
    }
    seen.add(pattern);
    rules.push({ pattern, command: command.trim() });
  }

  return rules;
}

/**
 * Parse the 'hooks' input YAML. Returns undefined when no hook is configured.
 */
export function parseHooksInput(hooksYaml: string): HooksConfig | undefined {
  if (!hooksYaml.trim()) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(hooksYaml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Failed to parse 'hooks' YAML: ${message}`);
  }

  if (parsed === null || parsed === undefined) {
    return undefined;
  }
  if (!isPlainObject(parsed)) {
    throw new ConfigError(
      `'hooks' must be a YAML mapping with the keys ${HOOK_KEYS.join(', ')}`
    );
  }

  const keys = Object.keys(parsed);
  for (const key of keys) {
    if (!(HOOK_KEYS as readonly string[]).includes(key)) {
      throw new ConfigError(
        `hooks: unknown key '${key}' (allowed: ${HOOK_KEYS.join(', ')})`
      );
    }
  }
  if (keys.length === 0) {
    return undefined;
  }

  return {
    preSync: 'pre-sync' in parsed ? parseHookCommands(parsed['pre-sync'], 'pre-sync') : [],
    transform: 'transform' in parsed ? parseTransformRules(parsed.transform) : [],
    postSync:
      'post-sync' in parsed ? parseHookCommands(parsed['post-sync'], 'post-sync') : [],
  };
}

/** Characters that end a shell word outside quotes */
const SHELL_SEPARATORS = new Set([';', '|', '&', '<', '>', '(', ')']);

/**
 * Split a command into shell words. This honours quotes and backslash
 * escapes and treats shell operators as separators. It does not expand
 * variables, globs or command substitutions, so it is good enough to find
 * literal paths but is not a shell parser.
 */
export function splitShellWords(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let inWord = false;
  let quote: "'" | '"' | null = null;

  const endWord = (): void => {
    if (inWord) {
      words.push(current);
      current = '';
      inWord = false;
    }
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1];

    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null;
      } else if (ch === '\\' && next !== undefined && '"\\$`'.includes(next)) {
        current += next;
        i++;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (ch === '\\') {
      if (next === '\n') {
        // Line continuation: joins lines without adding a character
        i++;
      } else if (next !== undefined) {
        current += next;
        inWord = true;
        i++;
      }
    } else if (/\s/.test(ch) || SHELL_SEPARATORS.has(ch)) {
      endWord();
    } else {
      current += ch;
      inWord = true;
    }
  }

  endWord();
  return words;
}

/**
 * The parts of a shell word that may name a file: an option's value
 * (`--config=path`), an assignment and its value (`NAME=path`), or the word
 */
function pathCandidates(word: string): string[] {
  const equals = word.indexOf('=');
  const value = equals >= 0 ? word.slice(equals + 1) : undefined;

  if (word.startsWith('-')) {
    return value ? [value] : [];
  }
  return value !== undefined ? [word, value] : [word];
}

/**
 * Find the synced local paths that a command names directly.
 * `synced` must hold normalised paths (see normalizeLocalPath).
 */
export function findSyncedPathReferences(
  command: string,
  synced: ReadonlySet<string>
): string[] {
  const found: string[] = [];

  for (const word of splitShellWords(command)) {
    for (const candidate of pathCandidates(word)) {
      const normalized = normalizeLocalPath(candidate);
      if (synced.has(normalized) && !found.includes(normalized)) {
        found.push(normalized);
      }
    }
  }

  return found;
}

/**
 * Every hook command with a label for error messages
 */
function labelledHookCommands(
  hooks: HooksConfig
): Array<{ label: string; command: string }> {
  return [
    ...hooks.preSync.map((command) => ({ label: 'hooks.pre-sync', command })),
    ...hooks.transform.map((rule) => ({
      label: `hooks.transform['${rule.pattern}']`,
      command: rule.command,
    })),
    ...hooks.postSync.map((command) => ({ label: 'hooks.post-sync', command })),
  ];
}

/**
 * Reject any hook command that names one of the given synced local paths,
 * so that a source repository cannot supply code that runs inside this step
 */
export function checkHookReferences(
  hooks: HooksConfig,
  localPaths: Iterable<string>
): void {
  const synced = new Set(Array.from(localPaths, normalizeLocalPath));

  for (const { label, command } of labelledHookCommands(hooks)) {
    const [first] = findSyncedPathReferences(command, synced);
    if (first !== undefined) {
      throw new ConfigError(
        `${label}: command '${command}' names synced path '${first}'; ` +
          'a hook must not run a file that a source repository controls'
      );
    }
  }
}

/**
 * Config-time hook checks, run before any hook or GitHub API call:
 * - a literal transform key must be a synced local path, or be matched by
 *   a `default_files` glob;
 * - no hook command may name a literal synced local path.
 * Paths that only glob expansion reveals are checked later in syncFiles().
 */
export function validateHooks(hooks: HooksConfig, sources: SourceConfig[]): void {
  const configs = normalizeSources(sources);

  const literalPaths = new Set(
    configs
      .filter((config) => !isGlobPattern(config.source_path))
      .map((config) => normalizeLocalPath(config.local_path))
  );
  const globs = configs
    .filter((config) => config.origin === 'default_files' && isGlobPattern(config.source_path))
    .map((config) => normalizeLocalPath(config.source_path));

  for (const rule of hooks.transform) {
    if (isGlobPattern(rule.pattern)) {
      continue;
    }
    const synced =
      literalPaths.has(rule.pattern) ||
      globs.some((glob) => minimatch(rule.pattern, glob, GLOB_OPTIONS));
    if (!synced) {
      throw new ConfigError(
        `hooks.transform: key '${rule.pattern}' does not match any synced local path`
      );
    }
  }

  checkHookReferences(hooks, literalPaths);
}

/**
 * Choose the transform rule for each expanded config, by index. Throws when
 * a file matches more than one key, and warns about keys that match nothing.
 */
export function assignTransforms(
  configs: NormalizedFileSyncConfig[],
  rules: TransformRule[]
): Array<TransformRule | undefined> {
  const used = new Set<TransformRule>();

  const assigned = configs.map((config) => {
    // A glob that failed to expand keeps its pattern as local_path and will
    // fail during sync; there is no file to transform.
    if (isGlobPattern(config.local_path)) {
      return undefined;
    }

    const localPath = normalizeLocalPath(config.local_path);
    const matches = rules.filter((rule) =>
      isGlobPattern(rule.pattern)
        ? minimatch(localPath, rule.pattern, GLOB_OPTIONS)
        : rule.pattern === localPath
    );

    if (matches.length > 1) {
      throw new ConfigError(
        `hooks.transform: '${localPath}' matches more than one key: ` +
          matches.map((rule) => `'${rule.pattern}'`).join(', ')
      );
    }
    if (matches.length === 1) {
      used.add(matches[0]);
    }
    return matches[0];
  });

  for (const rule of rules) {
    if (!used.has(rule)) {
      core.warning(`hooks.transform: key '${rule.pattern}' matches no synced file`);
    }
  }

  return assigned;
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

  const hooks = parseHooksInput(core.getInput('hooks'));
  if (hooks) {
    validateHooks(hooks, sources);
  }

  return {
    sources,
    githubToken,
    createMissing,
    failOnError,
    hooks,
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

  if (inputs.hooks) {
    core.startGroup('Hooks configuration');
    for (const command of inputs.hooks.preSync) {
      core.info(`  pre-sync: ${command}`);
    }
    for (const rule of inputs.hooks.transform) {
      core.info(`  transform ${rule.pattern}: ${rule.command}`);
    }
    for (const command of inputs.hooks.postSync) {
      core.info(`  post-sync: ${command}`);
    }
    core.endGroup();
  }
}
