import * as core from '@actions/core';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { StringDecoder } from 'string_decoder';
import type { TransformRule } from './sources/types';

/**
 * The lifecycle points at which a hook can run
 */
export type HookName = 'pre-sync' | 'transform' | 'post-sync';

/**
 * A pre-sync or post-sync hook failed
 */
export class HookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HookError';
  }
}

/**
 * Result of running a transform: the content to keep, or why it failed
 */
export type TransformResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

/**
 * Environment variables a hook must never see. `INPUT_*` holds the action's
 * inputs, including github-token and any source-token inside `sources`.
 * `ACTIONS_*` holds the runner toolkit's credentials. `GITHUB_OUTPUT` and
 * `GITHUB_STATE` are this action's own files, which a hook could use to
 * forge its outputs.
 */
const REMOVED_PREFIXES = ['INPUT_', 'ACTIONS_'];
const REMOVED_NAMES = new Set(['GITHUB_OUTPUT', 'GITHUB_STATE']);

/** The flags `shell: bash` uses in an Actions `run:` step */
const BASH_FLAGS = ['--noprofile', '--norc', '-e', '-o', 'pipefail'];

/** How many lines of a failed transform's stderr go into its error */
const STDERR_TAIL_LINES = 5;

/**
 * Build a hook's environment: the action's environment without credentials,
 * plus the given context variables
 */
export function buildHookEnv(
  base: NodeJS.ProcessEnv,
  context: Record<string, string>
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) {
      continue;
    }
    // Windows treats variable names case-insensitively
    const upper = name.toUpperCase();
    if (REMOVED_NAMES.has(upper) || REMOVED_PREFIXES.some((prefix) => upper.startsWith(prefix))) {
      continue;
    }
    env[name] = value;
  }

  return { ...env, ...context };
}

/**
 * Find the bash to run hooks with. Outside Windows that is `bash` on PATH.
 * On Windows it is Git for Windows bash, as `shell: bash` uses, or else the
 * first bash.exe on PATH that is not the WSL launcher in System32. Returns
 * undefined when Windows has no usable bash.
 */
export function resolveBash(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (candidate: string) => boolean = fs.existsSync
): string | undefined {
  if (platform !== 'win32') {
    return 'bash';
  }

  const programFiles = env.ProgramFiles ?? env.PROGRAMFILES ?? 'C:\\Program Files';
  const gitBash = path.win32.join(programFiles, 'Git', 'bin', 'bash.exe');
  if (exists(gitBash)) {
    return gitBash;
  }

  const searchPath = env.Path ?? env.PATH ?? '';
  for (const dir of searchPath.split(';')) {
    if (!dir || /[\\/]system32[\\/]?$/i.test(dir)) {
      continue;
    }
    const candidate = path.win32.join(dir, 'bash.exe');
    if (exists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

interface BashResult {
  /** Exit code, or null when a signal ended the process */
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderrTail: string[];
}

/**
 * How a finished process ended, for error messages
 */
function describeExit(result: BashResult): string {
  return result.exitCode !== null
    ? `exited with code ${result.exitCode}`
    : `was stopped by ${result.signal ?? 'a signal'}`;
}

/**
 * Call onLine for each complete line of a byte stream, decoding UTF-8
 * characters that are split across chunks
 */
function lineReader(onLine: (line: string) => void): {
  write: (chunk: Buffer) => void;
  end: () => void;
} {
  const decoder = new StringDecoder('utf8');
  let pending = '';

  return {
    write(chunk: Buffer): void {
      pending += decoder.write(chunk);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        onLine(line);
      }
    },
    end(): void {
      pending += decoder.end();
      if (pending) {
        onLine(pending);
      }
      pending = '';
    },
  };
}

/**
 * Spawn bash on a script and wait for it to close. With `input`, stdin is a
 * pipe that receives it, and a process that exits without reading all of
 * it is not an error. Without `input`, stdin is the null device, so a
 * command that reads stdin sees end-of-file at once.
 */
function spawnBash(
  bash: string,
  script: string,
  env: Record<string, string>,
  input: Buffer | undefined,
  onStdoutLine: ((line: string) => void) | undefined,
  onStderrLine: (line: string) => void
): Promise<Omit<BashResult, 'stderrTail'>> {
  return new Promise((resolve, reject) => {
    const child = spawn(bash, [...BASH_FLAGS, script], {
      cwd: process.cwd(),
      env,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stdoutLines = onStdoutLine ? lineReader(onStdoutLine) : undefined;
    const stderrLines = lineReader(onStderrLine);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      stdoutLines?.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => stderrLines.write(chunk));

    // Fires when the process cannot start, such as ENOENT for a missing bash
    child.on('error', reject);

    child.on('close', (exitCode, signal) => {
      stdoutLines?.end();
      stderrLines.end();
      resolve({ exitCode, signal, stdout: Buffer.concat(stdoutChunks).toString('utf-8') });
    });

    if (input !== undefined && child.stdin) {
      child.stdin.on('error', (error: NodeJS.ErrnoException) => {
        // A hook may finish without reading all of its input, as
        // `cat overrides.json` does; the write then meets a closed pipe.
        if (error.code !== 'EPIPE') {
          reject(error);
        }
      });
      child.stdin.end(input);
    }
  });
}

/**
 * Run one command the way an Actions `run:` step with `shell: bash` does:
 * write it to a temporary script and run `bash --noprofile --norc -e -o
 * pipefail <script>` from the working directory. stderr is logged line by
 * line; stdout is logged only when `logStdout` is set.
 */
async function runBash(
  hook: HookName,
  command: string,
  context: Record<string, string>,
  input: Buffer | undefined,
  logStdout: boolean
): Promise<BashResult> {
  const bash = resolveBash();
  if (bash === undefined) {
    throw new Error('cannot find bash; install Git for Windows on this runner');
  }

  const env = buildHookEnv(process.env, { BOILERPLATE_SYNC_HOOK: hook, ...context });
  const prefix = hook === 'transform' ? '  | ' : '';
  const stderrTail: string[] = [];

  const tempRoot = process.env.RUNNER_TEMP || os.tmpdir();
  const scriptDir = await fsp.mkdtemp(path.join(tempRoot, 'boilerplate-sync-hook-'));
  const script = path.join(scriptDir, 'hook.sh');

  try {
    await fsp.writeFile(script, `${command}\n`, 'utf-8');

    const result = await spawnBash(
      bash,
      script,
      env,
      input,
      logStdout ? (line) => core.info(`${prefix}${line}`) : undefined,
      (line) => {
        core.info(`${prefix}${line}`);
        stderrTail.push(line);
        if (stderrTail.length > STDERR_TAIL_LINES) {
          stderrTail.shift();
        }
      }
    );

    return { ...result, stderrTail };
  } finally {
    await fsp.rm(scriptDir, { recursive: true, force: true });
  }
}

/**
 * Run a pre-sync or post-sync hook: each command in order, with an empty
 * stdin, stopping at the first failure. Throws HookError on failure.
 */
export async function runHookCommands(
  hook: 'pre-sync' | 'post-sync',
  commands: string[],
  context: Record<string, string>
): Promise<void> {
  for (const [index, command] of commands.entries()) {
    const position = `${index + 1} of ${commands.length}`;
    core.info(`Running ${hook} command ${position}: ${command}`);

    let result: BashResult;
    try {
      result = await runBash(hook, command, context, undefined, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HookError(`${hook} command ${position} could not start: ${message}`);
    }

    if (result.exitCode !== 0) {
      throw new HookError(`${hook} command ${position} ${describeExit(result)}: ${command}`);
    }
  }
}

/**
 * Run a transform: fetched content on stdin, content to keep on stdout.
 * A non-zero exit, a failure to start or empty stdout is a failure.
 */
export async function runTransform(
  rule: TransformRule,
  content: string,
  context: Record<string, string>
): Promise<TransformResult> {
  let result: BashResult;
  try {
    result = await runBash('transform', rule.command, context, Buffer.from(content, 'utf-8'), false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `transform '${rule.pattern}' could not start: ${message}` };
  }

  if (result.exitCode !== 0) {
    const tail = result.stderrTail.join('\n');
    return {
      ok: false,
      error: `transform '${rule.pattern}' ${describeExit(result)}${tail ? `: ${tail}` : ''}`,
    };
  }

  if (result.stdout === '') {
    return { ok: false, error: `transform '${rule.pattern}' produced no output` };
  }

  return { ok: true, content: result.stdout };
}
