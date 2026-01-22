import type { ActionInputs, FileSyncConfig } from './sources/types';
/**
 * Validation error for configuration
 */
export declare class ConfigError extends Error {
    constructor(message: string);
}
/**
 * Parse the 'files' input YAML into validated configs
 */
export declare function parseFilesInput(filesYaml: string): FileSyncConfig[];
/**
 * Get and validate all action inputs
 */
export declare function getInputs(): ActionInputs;
/**
 * Log the parsed configuration (for debugging)
 */
export declare function logConfig(inputs: ActionInputs): void;
