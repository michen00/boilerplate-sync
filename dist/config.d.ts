import type { ActionInputs, SourceConfig, NormalizedFileSyncConfig } from './sources/types';
/**
 * Validation error for configuration
 */
export declare class ConfigError extends Error {
    constructor(message: string);
}
/**
 * Parse the 'sources' input YAML into validated configs
 */
export declare function parseSourcesInput(sourcesYaml: string): SourceConfig[];
/**
 * Normalize sources configuration into flat file sync configs
 * This flattens the nested structure for use by sync logic
 */
export declare function normalizeSources(sources: SourceConfig[]): NormalizedFileSyncConfig[];
/**
 * Get and validate all action inputs
 */
export declare function getInputs(): ActionInputs;
/**
 * Log the parsed configuration (for debugging)
 */
export declare function logConfig(inputs: ActionInputs): void;
