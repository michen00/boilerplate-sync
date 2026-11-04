import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as core from '@actions/core';

import {
  parseSourcesInput,
  normalizeSources,
  getInputs,
  logConfig,
  ConfigError,
  parseHooksInput,
  splitShellWords,
  findSyncedPathReferences,
  validateHooks,
  assignTransforms,
  checkHookReferences,
  normalizeLocalPath,
} from '../src/config';
import type { HooksConfig, NormalizedFileSyncConfig } from '../src/sources/types';

// Mock @actions/core so getInputs/logConfig run without a real Actions
// runtime; mirrors the factory style in sync.test.ts.
vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  getBooleanInput: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  startGroup: vi.fn(),
  endGroup: vi.fn(),
}));

describe('parseSourcesInput', () => {
  describe('valid inputs with default_files', () => {
    it('parses a single source with default_files', () => {
      const yaml = `
        - source: my-org/boilerplate
          default_files:
            - .eslintrc.js
            - .prettierrc
      `;

      const result = parseSourcesInput(yaml);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        source: 'my-org/boilerplate',
        ref: undefined,
        'source-token': undefined,
        default_files: ['.eslintrc.js', '.prettierrc'],
        file_pairs: undefined,
      });
    });

    it('parses source with ref and default_files', () => {
      const yaml = `
        - source: my-org/boilerplate
          ref: main
          default_files:
            - .eslintrc.js
      `;

      const result = parseSourcesInput(yaml);

      expect(result[0].ref).toBe('main');
      expect(result[0].default_files).toEqual(['.eslintrc.js']);
    });
  });

  describe('valid inputs with file_pairs', () => {
    it('parses a single source with file_pairs', () => {
      const yaml = `
        - source: my-org/boilerplate
          file_pairs:
            - local_path: .github/workflows/ci.yml
              source_path: workflows/ci.yml
      `;

      const result = parseSourcesInput(yaml);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        source: 'my-org/boilerplate',
        ref: undefined,
        'source-token': undefined,
        default_files: undefined,
        file_pairs: [
          {
            local_path: '.github/workflows/ci.yml',
            source_path: 'workflows/ci.yml',
          },
        ],
      });
    });

    it('file_pairs source_path defaults to local_path in normalization', () => {
      const yaml = `
        - source: org/repo
          file_pairs:
            - local_path: file.js
      `;

      const result = parseSourcesInput(yaml);
      expect(result[0].file_pairs![0].source_path).toBeUndefined();

      // Test normalization
      const normalized = normalizeSources(result);
      expect(normalized[0].source_path).toBe('file.js');
    });
  });

  describe('valid inputs with both default_files and file_pairs', () => {
    it('parses source with both default_files and file_pairs', () => {
      const yaml = `
        - source: my-org/boilerplate
          ref: main
          default_files:
            - .eslintrc.js
            - .prettierrc
          file_pairs:
            - local_path: .github/workflows/ci.yml
              source_path: workflows/ci.yml
      `;

      const result = parseSourcesInput(yaml);

      expect(result[0].default_files).toEqual(['.eslintrc.js', '.prettierrc']);
      expect(result[0].file_pairs).toEqual([
        {
          local_path: '.github/workflows/ci.yml',
          source_path: 'workflows/ci.yml',
        },
      ]);
    });
  });

  describe('valid inputs with source-token', () => {
    it('parses source with source-token', () => {
      const yaml = `
        - source: my-org/private-repo
          source-token: my-secret-token
          default_files:
            - config.json
      `;

      const result = parseSourcesInput(yaml);

      expect(result[0]['source-token']).toBe('my-secret-token');
    });

    it('source-token is optional', () => {
      const yaml = `
        - source: my-org/public-repo
          default_files:
            - .eslintrc.js
      `;

      const result = parseSourcesInput(yaml);

      expect(result[0]['source-token']).toBeUndefined();
    });
  });

  describe('multiple sources', () => {
    it('parses multiple sources with different configurations', () => {
      const yaml = `
        - source: my-org/boilerplate
          default_files:
            - .eslintrc.js
        - source: my-org/other-boilerplate
          ref: v2.0.0
          file_pairs:
            - local_path: .prettierrc
              source_path: configs/.prettierrc
        - source: my-org/private-repo
          source-token: secret-token
          default_files:
            - config.json
      `;

      const result = parseSourcesInput(yaml);

      expect(result).toHaveLength(3);
      expect(result[0].source).toBe('my-org/boilerplate');
      expect(result[1].source).toBe('my-org/other-boilerplate');
      expect(result[1].ref).toBe('v2.0.0');
      expect(result[2]['source-token']).toBe('secret-token');
    });
  });

  describe('whitespace handling', () => {
    it('trims whitespace from values', () => {
      const yaml = `
        - source: "  my-org/boilerplate  "
          ref: "  main  "
          default_files:
            - "  .eslintrc.js  "
      `;

      const result = parseSourcesInput(yaml);

      expect(result[0]).toMatchObject({
        source: 'my-org/boilerplate',
        ref: 'main',
        default_files: ['.eslintrc.js'],
      });
    });
  });

  describe('ref formats', () => {
    it('accepts ref as branch name', () => {
      const yaml = `
        - source: org/repo
          ref: feature/branch-name
          default_files:
            - file.js
      `;

      const result = parseSourcesInput(yaml);
      expect(result[0].ref).toBe('feature/branch-name');
    });

    it('accepts ref as commit SHA', () => {
      const yaml = `
        - source: org/repo
          ref: abc123def456
          default_files:
            - file.js
      `;

      const result = parseSourcesInput(yaml);
      expect(result[0].ref).toBe('abc123def456');
    });
  });

  describe('invalid inputs', () => {
    it('throws on empty input', () => {
      expect(() => parseSourcesInput('')).toThrow(ConfigError);
      expect(() => parseSourcesInput('   ')).toThrow(ConfigError);
    });

    it('throws on non-array input', () => {
      expect(() => parseSourcesInput('not-an-array')).toThrow(ConfigError);
      expect(() => parseSourcesInput('source: org/repo')).toThrow(ConfigError);
    });

    it('throws on empty array', () => {
      expect(() => parseSourcesInput('[]')).toThrow(ConfigError);
    });

    it('throws on missing source field', () => {
      const yaml = `
        - default_files:
            - file.js
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow("'source' is required");
    });

    it('throws when neither default_files nor file_pairs is provided', () => {
      const yaml = `
        - source: org/repo
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow(
        "at least one of 'default_files' or 'file_pairs' is required"
      );
    });

    it('throws on missing local_path in file_pairs', () => {
      const yaml = `
        - source: org/repo
          file_pairs:
            - source_path: file.js
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow("'local_path' is required");
    });

    it('throws on invalid source format - no slash', () => {
      const yaml = `
        - source: invalid-source
          default_files:
            - file.js
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow("'owner/repo' format");
    });

    it('throws on invalid source format - too many slashes', () => {
      const yaml = `
        - source: org/repo/extra
          default_files:
            - file.js
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
    });

    it('throws on invalid source format - empty parts', () => {
      const yaml = `
        - source: /repo
          default_files:
            - file.js
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
    });

    it('throws on invalid YAML syntax', () => {
      const yaml = `
        - source: [invalid
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow('Failed to parse');
    });

    it('throws when ref is not a string', () => {
      const yaml = `
        - source: org/repo
          ref: 123
          default_files:
            - file.js
      `;

      // YAML will parse 123 as a number, which should fail validation
      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow("'ref' must be a string");
    });

    it('throws when source_path is not a string', () => {
      const yaml = `
        - source: org/repo
          file_pairs:
            - local_path: file.js
              source_path: 123
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow("'source_path' must be a string");
    });

    it('throws when source-token is not a string', () => {
      const yaml = `
        - source: org/repo
          source-token: 123
          default_files:
            - file.js
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow("'source-token' must be a string");
    });

    it('throws when default_files contains non-string', () => {
      const yaml = `
        - source: org/repo
          default_files:
            - 123
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow('must be a non-empty string');
    });

    it('throws when default_files is not an array', () => {
      const yaml = `
        - source: org/repo
          default_files: not-an-array
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow("'default_files' must be an array");
    });

    it('throws when file_pairs is not an array', () => {
      const yaml = `
        - source: org/repo
          file_pairs: not-an-array
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow("'file_pairs' must be an array");
    });

    it('includes source number in error message', () => {
      const yaml = `
        - source: org/repo
          default_files:
            - file1.js
        - source: invalid
          default_files:
            - file2.js
      `;

      expect(() => parseSourcesInput(yaml)).toThrow('Source 2:');
    });

    it('throws when a source entry is not an object', () => {
      const yaml = `
        - just-a-string
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow('Expected an object');
    });

    it('throws when a file_pairs entry is not an object', () => {
      const yaml = `
        - source: org/repo
          file_pairs:
            - just-a-string
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow('Expected an object');
    });
  });

  describe('normalizeSources', () => {
    it('flattens default_files into normalized configs', () => {
      const sources = [
        {
          source: 'org/repo1',
          ref: 'main',
          default_files: ['file1.js', 'file2.js'],
        },
      ];

      const normalized = normalizeSources(sources);

      expect(normalized).toHaveLength(2);
      expect(normalized[0]).toEqual({
        local_path: 'file1.js',
        source_path: 'file1.js',
        source: 'org/repo1',
        ref: 'main',
        sourceToken: undefined,
        origin: 'default_files',
      });
      expect(normalized[1]).toEqual({
        local_path: 'file2.js',
        source_path: 'file2.js',
        source: 'org/repo1',
        ref: 'main',
        sourceToken: undefined,
        origin: 'default_files',
      });
    });

    it('flattens file_pairs into normalized configs', () => {
      const sources = [
        {
          source: 'org/repo1',
          ref: 'main',
          file_pairs: [
            { local_path: 'file1.js', source_path: 'src/file1.js' },
            { local_path: 'file2.js' },
          ],
        },
      ];

      const normalized = normalizeSources(sources);

      expect(normalized).toHaveLength(2);
      expect(normalized[0]).toEqual({
        local_path: 'file1.js',
        source_path: 'src/file1.js',
        source: 'org/repo1',
        ref: 'main',
        sourceToken: undefined,
        origin: 'file_pairs',
      });
      expect(normalized[1]).toEqual({
        local_path: 'file2.js',
        source_path: 'file2.js', // defaults to local_path
        source: 'org/repo1',
        ref: 'main',
        sourceToken: undefined,
        origin: 'file_pairs',
      });
    });

    it('combines default_files and file_pairs', () => {
      const sources = [
        {
          source: 'org/repo1',
          default_files: ['default.js'],
          file_pairs: [{ local_path: 'mapped.js', source_path: 'src/mapped.js' }],
        },
      ];

      const normalized = normalizeSources(sources);

      expect(normalized).toHaveLength(2);
      expect(normalized[0].local_path).toBe('default.js');
      expect(normalized[1].local_path).toBe('mapped.js');
    });

    it('includes sourceToken in normalized configs', () => {
      const sources = [
        {
          source: 'org/private-repo',
          'source-token': 'secret-token',
          default_files: ['config.json'],
        },
        {
          source: 'org/public-repo',
          default_files: ['public.json'],
        },
      ];

      const normalized = normalizeSources(sources);

      expect(normalized[0].sourceToken).toBe('secret-token');
      expect(normalized[1].sourceToken).toBeUndefined();
    });

    it('flattens multiple sources', () => {
      const sources = [
        {
          source: 'org/repo1',
          ref: 'main',
          default_files: ['file1.js'],
        },
        {
          source: 'org/repo2',
          'source-token': 'token',
          file_pairs: [{ local_path: 'file2.js' }],
        },
      ];

      const normalized = normalizeSources(sources);

      expect(normalized).toHaveLength(2);
      expect(normalized[0].source).toBe('org/repo1');
      expect(normalized[0].sourceToken).toBeUndefined();
      expect(normalized[1].source).toBe('org/repo2');
      expect(normalized[1].sourceToken).toBe('token');
    });
  });
});

describe('getInputs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns validated inputs from the action environment', () => {
    const sourcesYaml = `
      - source: org/repo
        default_files:
          - .eslintrc.js
    `;
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === 'sources') return sourcesYaml;
      if (name === 'github-token') return 'ghp_token';
      return '';
    });
    vi.mocked(core.getBooleanInput).mockImplementation(
      (name: string) => name === 'create-missing'
    );

    const inputs = getInputs();

    expect(inputs.githubToken).toBe('ghp_token');
    expect(inputs.createMissing).toBe(true);
    expect(inputs.failOnError).toBe(false);
    expect(inputs.sources).toHaveLength(1);
    expect(inputs.sources[0].source).toBe('org/repo');
  });

  it('throws when github-token is empty', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) =>
      name === 'sources'
        ? `
          - source: org/repo
            default_files:
              - file.js
        `
        : ''
    );
    vi.mocked(core.getBooleanInput).mockReturnValue(false);

    expect(() => getInputs()).toThrow(ConfigError);
    expect(() => getInputs()).toThrow('github-token is required');
  });

  it('propagates parse errors from an invalid sources input', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) =>
      name === 'sources' ? 'not-an-array' : 'ghp_token'
    );
    vi.mocked(core.getBooleanInput).mockReturnValue(false);

    expect(() => getInputs()).toThrow(ConfigError);
  });
});

describe('logConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const loggedLines = (): string =>
    vi.mocked(core.info).mock.calls.map((call) => String(call[0])).join('\n');

  it('logs counts and per-source details for default_files and file_pairs', () => {
    logConfig({
      sources: [
        {
          source: 'org/repo',
          ref: 'main',
          'source-token': 'secret',
          default_files: ['.eslintrc.js'],
          file_pairs: [
            { local_path: 'a.js', source_path: 'src/a.js' },
            { local_path: 'b.js' },
          ],
        },
      ],
      githubToken: 'ghp_token',
      createMissing: true,
      failOnError: false,
    });

    const logged = loggedLines();
    expect(logged).toContain('Sources: 1');
    expect(logged).toContain('Files to sync: 3');
    expect(logged).toContain('org/repo@main');
    expect(logged).toContain('(custom token)');
    expect(logged).toContain('.eslintrc.js');
    expect(logged).toContain('a.js <- src/a.js');
    // source_path falls back to local_path when omitted
    expect(logged).toContain('b.js <- b.js');
    expect(core.startGroup).toHaveBeenCalledWith('Sources configuration');
    expect(core.endGroup).toHaveBeenCalledTimes(1);
  });

  it('omits the custom-token marker and shows (default) ref when absent', () => {
    logConfig({
      sources: [{ source: 'org/repo', default_files: ['only.js'] }],
      githubToken: 'ghp_token',
      createMissing: false,
      failOnError: true,
    });

    const logged = loggedLines();
    expect(logged).toContain('org/repo@(default)');
    expect(logged).not.toContain('(custom token)');
  });
});

const noHooks = (): HooksConfig => ({ preSync: [], transform: [], postSync: [] });

describe('parseHooksInput', () => {
  it('returns undefined for an empty or comment-only input', () => {
    expect(parseHooksInput('')).toBeUndefined();
    expect(parseHooksInput('   \n  ')).toBeUndefined();
    expect(parseHooksInput('# no hooks yet')).toBeUndefined();
    expect(parseHooksInput('{}')).toBeUndefined();
  });

  it('accepts the string form of pre-sync and post-sync', () => {
    const hooks = parseHooksInput(`
      pre-sync: ./scripts/check.sh
      post-sync: npx prettier --write .
    `);

    expect(hooks).toEqual({
      preSync: ['./scripts/check.sh'],
      transform: [],
      postSync: ['npx prettier --write .'],
    });
  });

  it('accepts the list form of pre-sync and post-sync, in order', () => {
    const hooks = parseHooksInput(`
      pre-sync:
        - test -f a
        - test -f b
      post-sync:
        - npx prettier --write .
        - npm test
    `);

    expect(hooks?.preSync).toEqual(['test -f a', 'test -f b']);
    expect(hooks?.postSync).toEqual(['npx prettier --write .', 'npm test']);
  });

  it('parses the transform map and normalises its keys', () => {
    const hooks = parseHooksInput(`
      transform:
        ./package.json: jq -s '.[0] * .[1]' - overrides.json
        docs/**/*.md: sed 's/a/b/'
    `);

    expect(hooks?.transform).toEqual([
      { pattern: 'package.json', command: "jq -s '.[0] * .[1]' - overrides.json" },
      { pattern: 'docs/**/*.md', command: "sed 's/a/b/'" },
    ]);
  });

  it('rejects an unknown key such as post-file-sync, naming the allowed keys', () => {
    const parse = () => parseHooksInput('post-file-sync:\n  package.json: ./merge.sh');

    expect(parse).toThrow(ConfigError);
    expect(parse).toThrow(/'post-file-sync'.*pre-sync, transform, post-sync/);
  });

  it('rejects invalid YAML', () => {
    expect(() => parseHooksInput('pre-sync: [unclosed')).toThrow(ConfigError);
  });

  it('rejects a hooks input that is not a mapping', () => {
    expect(() => parseHooksInput('- npm test')).toThrow(/must be a YAML mapping/);
  });

  it('rejects a post-sync mapping', () => {
    expect(() => parseHooksInput('post-sync:\n  run: npm test')).toThrow(
      /hooks\.post-sync/
    );
  });

  it('rejects empty commands and empty lists', () => {
    expect(() => parseHooksInput("pre-sync: ''")).toThrow(/hooks\.pre-sync/);
    expect(() => parseHooksInput('pre-sync: []')).toThrow(/hooks\.pre-sync/);
    expect(() => parseHooksInput('post-sync:\n  - npm test\n  - ""')).toThrow(
      /hooks\.post-sync\[1\]/
    );
    expect(() => parseHooksInput('pre-sync:')).toThrow(/hooks\.pre-sync/);
  });

  it('rejects a transform that is not a non-empty mapping', () => {
    expect(() => parseHooksInput('transform: ./merge.sh')).toThrow(/hooks\.transform/);
    expect(() => parseHooksInput('transform: {}')).toThrow(/hooks\.transform/);
  });

  it('rejects a transform key mapped to a list', () => {
    expect(() =>
      parseHooksInput('transform:\n  package.json:\n    - ./a.sh\n    - ./b.sh')
    ).toThrow(/hooks\.transform\['package\.json'\]/);
  });

  it('rejects transform keys that collide after normalisation', () => {
    expect(() =>
      parseHooksInput('transform:\n  ./a.json: cat\n  a.json: cat')
    ).toThrow(/duplicate key 'a\.json'/);
  });
});

describe('splitShellWords', () => {
  it('splits on whitespace', () => {
    expect(splitShellWords('npx  prettier\t--write .')).toEqual([
      'npx',
      'prettier',
      '--write',
      '.',
    ]);
  });

  it('honours single quotes, double quotes and backslash escapes', () => {
    expect(splitShellWords(`bash 'a b.sh' "c d" e\\ f`)).toEqual([
      'bash',
      'a b.sh',
      'c d',
      'e f',
    ]);
    expect(splitShellWords(`echo "x\\"y" 'it''s'`)).toEqual(['echo', 'x"y', 'its']);
    expect(splitShellWords(`pre'fix'"ed"`)).toEqual(['prefixed']);
  });

  it('treats shell operators as separators', () => {
    expect(splitShellWords('a;b|c&&d>e<f (g)')).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
    ]);
  });

  it('joins a backslash-newline continuation', () => {
    expect(splitShellWords('npm \\\n  test')).toEqual(['npm', 'test']);
  });
});

describe('findSyncedPathReferences', () => {
  it('finds a synced path named directly or through ./', () => {
    const synced = new Set(['scripts/merge.sh']);

    expect(findSyncedPathReferences('scripts/merge.sh', synced)).toEqual([
      'scripts/merge.sh',
    ]);
    expect(findSyncedPathReferences('bash ./scripts/merge.sh', synced)).toEqual([
      'scripts/merge.sh',
    ]);
    expect(findSyncedPathReferences('cat scripts//merge.sh | sh', synced)).toEqual([
      'scripts/merge.sh',
    ]);
  });

  it('finds the value of an option or assignment', () => {
    const synced = new Set(['scripts/x.js']);

    expect(
      findSyncedPathReferences('node --require=./scripts/x.js main.js', synced)
    ).toEqual(['scripts/x.js']);
    expect(findSyncedPathReferences('FILE=scripts/x.js make', synced)).toEqual([
      'scripts/x.js',
    ]);
  });

  it('ignores options without a value and unrelated words', () => {
    const synced = new Set(['prettier.config.js', '--write']);

    expect(findSyncedPathReferences('npx prettier --write .', synced)).toEqual([]);
  });

  it('reports each path once', () => {
    const synced = new Set(['a.sh']);

    expect(findSyncedPathReferences('./a.sh && bash a.sh', synced)).toEqual(['a.sh']);
  });
});

describe('validateHooks', () => {
  const sources = parseSourcesInput(`
    - source: org/repo
      default_files:
        - package.json
        - docs/**/*.md
      file_pairs:
        - local_path: ./scripts/merge.sh
          source_path: templates/merge.sh
  `);

  it('accepts hooks that name no synced path', () => {
    const hooks: HooksConfig = {
      preSync: ['test -f .github/lock'],
      transform: [
        { pattern: 'package.json', command: "jq -s '.[0] * .[1]' - overrides.json" },
      ],
      postSync: ['npx prettier --write .'],
    };

    expect(() => validateHooks(hooks, sources)).not.toThrow();
  });

  it('accepts a literal transform key matched by a default_files glob', () => {
    const hooks = noHooks();
    hooks.transform.push({ pattern: 'docs/guide/a.md', command: 'cat' });

    expect(() => validateHooks(hooks, sources)).not.toThrow();
  });

  it('accepts a literal transform key equal to a file_pairs local path written with ./', () => {
    const hooks = noHooks();
    hooks.transform.push({ pattern: 'scripts/merge.sh', command: 'cat' });

    expect(() => validateHooks(hooks, sources)).not.toThrow();
  });

  it('accepts a glob transform key without checking it against the sources', () => {
    const hooks = noHooks();
    hooks.transform.push({ pattern: 'nothing/**/*.yml', command: 'cat' });

    expect(() => validateHooks(hooks, sources)).not.toThrow();
  });

  it('rejects a literal transform key that is never synced', () => {
    const hooks = noHooks();
    hooks.transform.push({ pattern: 'tsconfig.json', command: 'cat' });

    expect(() => validateHooks(hooks, sources)).toThrow(ConfigError);
    expect(() => validateHooks(hooks, sources)).toThrow(/'tsconfig\.json'/);
  });

  it('rejects a hook command that names a file_pairs local path', () => {
    const hooks = noHooks();
    hooks.transform.push({ pattern: 'package.json', command: 'bash scripts/merge.sh' });

    expect(() => validateHooks(hooks, sources)).toThrow(
      /hooks\.transform.*'scripts\/merge\.sh'/
    );
  });

  it('rejects a pre-sync command that names a literal default_files path', () => {
    const hooks = noHooks();
    hooks.preSync.push('node ./package.json');

    expect(() => validateHooks(hooks, sources)).toThrow(/hooks\.pre-sync.*'package\.json'/);
  });

  it('leaves paths under a default_files glob to the check after expansion', () => {
    const hooks = noHooks();
    hooks.postSync.push('./docs/build.md');

    expect(() => validateHooks(hooks, sources)).not.toThrow();
  });
});

describe('assignTransforms', () => {
  const config = (local_path: string): NormalizedFileSyncConfig => ({
    local_path,
    source_path: local_path,
    source: 'org/repo',
    origin: 'default_files',
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('assigns exact and glob keys to the files they match', () => {
    const exact = { pattern: 'package.json', command: 'jq .' };
    const glob = { pattern: 'docs/**/*.md', command: 'cat' };

    const assigned = assignTransforms(
      [config('package.json'), config('docs/a.md'), config('docs/guide/b.md'), config('README.md')],
      [exact, glob]
    );

    expect(assigned).toEqual([exact, glob, glob, undefined]);
  });

  it('matches a local path written with ./', () => {
    const rule = { pattern: 'package.json', command: 'jq .' };

    expect(assignTransforms([config('./package.json')], [rule])).toEqual([rule]);
  });

  it('rejects a file matched by more than one key', () => {
    const assign = () =>
      assignTransforms(
        [config('docs/a.md')],
        [
          { pattern: 'docs/*.md', command: 'cat' },
          { pattern: 'docs/a.md', command: 'cat' },
        ]
      );

    expect(assign).toThrow(ConfigError);
    expect(assign).toThrow(/'docs\/a\.md'.*'docs\/\*\.md', 'docs\/a\.md'/);
  });

  it('warns about a glob key that matches no file', () => {
    assignTransforms([config('README.md')], [{ pattern: 'docs/**', command: 'cat' }]);

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("'docs/**'"));
  });

  it('assigns nothing to a glob that failed to expand', () => {
    const unexpanded = config('docs/**');

    expect(
      assignTransforms([unexpanded], [{ pattern: 'docs/**', command: 'cat' }])
    ).toEqual([undefined]);
  });
});

describe('checkHookReferences', () => {
  it('rejects a hook command that names an expanded local path', () => {
    const hooks = noHooks();
    hooks.postSync.push('./scripts/fmt.sh');

    expect(() => checkHookReferences(hooks, ['scripts/fmt.sh', 'README.md'])).toThrow(
      /hooks\.post-sync.*'scripts\/fmt\.sh'/
    );
  });

  it('accepts hooks that name no expanded local path', () => {
    const hooks = noHooks();
    hooks.postSync.push('npx prettier --write .');

    expect(() => checkHookReferences(hooks, ['scripts/fmt.sh'])).not.toThrow();
  });
});

describe('getInputs with hooks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const mockInputs = (hooksYaml: string) => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === 'sources') {
        return `
          - source: org/repo
            default_files:
              - package.json
              - scripts/merge.sh
        `;
      }
      if (name === 'github-token') return 'ghp_token';
      if (name === 'hooks') return hooksYaml;
      return '';
    });
    vi.mocked(core.getBooleanInput).mockReturnValue(false);
  };

  it('leaves hooks undefined when the input is empty', () => {
    mockInputs('');

    expect(getInputs().hooks).toBeUndefined();
  });

  it('parses and validates the hooks input', () => {
    mockInputs('transform:\n  package.json: jq .');

    expect(getInputs().hooks).toEqual({
      preSync: [],
      transform: [{ pattern: 'package.json', command: 'jq .' }],
      postSync: [],
    });
  });

  it('rejects hooks that name a synced path', () => {
    mockInputs('post-sync: bash scripts/merge.sh');

    expect(() => getInputs()).toThrow(ConfigError);
  });
});

describe('logConfig with hooks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('logs hook commands', () => {
    logConfig({
      sources: [{ source: 'org/repo', default_files: ['package.json'] }],
      githubToken: 'ghp_token',
      createMissing: true,
      failOnError: false,
      hooks: {
        preSync: ['test -f lock'],
        transform: [{ pattern: 'package.json', command: 'jq .' }],
        postSync: ['npm test'],
      },
    });

    const logged = vi.mocked(core.info).mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('pre-sync: test -f lock');
    expect(logged).toContain('transform package.json: jq .');
    expect(logged).toContain('post-sync: npm test');
  });
});

describe('findSyncedPathReferences through globs and nested shells', () => {
  const synced = new Set(['scripts/merge.sh', 'package.json', '.envrc']);
  const find = (command: string) => findSyncedPathReferences(command, synced);

  it('finds a synced path that an unquoted glob would expand to', () => {
    expect(find('bash scripts/merge*.sh')).toEqual(['scripts/merge.sh']);
    expect(find('./scripts/m?rge.sh')).toEqual(['scripts/merge.sh']);
    expect(find('bash scripts/{merge,other}.sh')).toEqual(['scripts/merge.sh']);
    expect(find('cat *.json')).toEqual(['package.json']);
    expect(find('node --require=scripts/*.sh')).toEqual(['scripts/merge.sh']);
  });

  it('treats quoted and escaped glob characters as literal, as bash does', () => {
    expect(find("bash 'scripts/merge*.sh'")).toEqual([]);
    expect(find('bash "scripts/merge?.sh"')).toEqual([]);
    expect(find('bash scripts/merge\\*.sh')).toEqual([]);
    expect(find("jq -s '.[0] * .[1]' - .github/package.overrides.json")).toEqual([]);
  });

  it('does not let * match dotfiles, or give ! or # a glob meaning', () => {
    expect(find('ls *rc')).toEqual([]);
    expect(find('[ ! -f lock ] # comment')).toEqual([]);
  });

  it('checks the command string of a nested shell', () => {
    expect(find("bash -c 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
    expect(find('sh -ec "./scripts/merge.sh"')).toEqual(['scripts/merge.sh']);
    expect(find("env FOO=1 /bin/bash -lc 'scripts/m*.sh'")).toEqual(['scripts/merge.sh']);
    expect(find(`bash -c "bash -c 'bash scripts/merge.sh'"`)).toEqual(['scripts/merge.sh']);
  });

  it('checks the joined arguments of eval', () => {
    expect(find("eval 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
    expect(find("eval bash 'scripts/m*.sh'; true")).toEqual(['scripts/merge.sh']);
  });

  it('leaves -c alone outside a shell, and handles a missing command string', () => {
    expect(find("jq -c '.[0] * .[1]' overrides.json")).toEqual([]);
    expect(find('bash -c')).toEqual([]);
    expect(find('bash -c; echo done')).toEqual([]);
    expect(find('eval; true')).toEqual([]);
  });
});

describe('splitShellWords edge cases', () => {
  it('drops a trailing backslash', () => {
    expect(splitShellWords('a b\\')).toEqual(['a', 'b']);
  });

  it('separates commands on newlines', () => {
    expect(splitShellWords('npm ci\nnpm test')).toEqual(['npm', 'ci', 'npm', 'test']);
  });
});

describe('parseHooksInput edge cases', () => {
  it('rejects an empty transform key', () => {
    expect(() => parseHooksInput('transform:\n  "": cat')).toThrow(/keys must be non-empty/);
  });
});

describe('findSyncedPathReferences through command substitutions', () => {
  const synced = new Set(['scripts/merge.sh']);
  const find = (command: string) => findSyncedPathReferences(command, synced);

  it('checks $(...) and backtick bodies, inside double quotes too', () => {
    expect(find('echo "$(bash scripts/merge.sh)"')).toEqual(['scripts/merge.sh']);
    expect(find('x=`bash scripts/merge.sh`')).toEqual(['scripts/merge.sh']);
    expect(find('echo "`./scripts/merge.sh`"')).toEqual(['scripts/merge.sh']);
    expect(find('x=`echo \\`; bash scripts/merge.sh`')).toEqual(['scripts/merge.sh']);
    expect(find('echo $(cat "$(echo scripts/merge.sh)")')).toEqual(['scripts/merge.sh']);
    expect(find('echo "$(printf %s ")"; bash scripts/m*.sh)"')).toEqual(['scripts/merge.sh']);
    expect(find("echo $(printf %s ')'; bash scripts/merge.sh)")).toEqual(['scripts/merge.sh']);
    expect(find('echo $(printf %s \\); bash scripts/merge.sh)')).toEqual(['scripts/merge.sh']);
  });

  it('checks an unterminated substitution to the end of the command', () => {
    expect(find('echo "$(bash scripts/merge.sh')).toEqual(['scripts/merge.sh']);
    expect(find('echo `bash scripts/merge.sh')).toEqual(['scripts/merge.sh']);
  });

  it('leaves quoted or escaped substitution syntax alone, as bash does', () => {
    expect(find("echo '$(bash scripts/merge.sh)'")).toEqual([]);
    expect(find('echo "\\$(bash scripts/merge.sh)"')).toEqual([]);
    expect(find('echo "$((1 + 2))"')).toEqual([]);
  });
});

describe('assignTransforms with concrete bracketed paths', () => {
  it('transforms a file whose name contains glob characters', () => {
    const rule = { pattern: 'docs/*.md', command: 'cat' };
    const expanded: NormalizedFileSyncConfig = {
      local_path: 'docs/a[ab].md',
      source_path: 'docs/a[ab].md',
      source: 'org/repo',
      origin: 'default_files',
      expandedFrom: 'docs/*.md',
    };

    expect(assignTransforms([expanded], [rule])).toEqual([rule]);
  });
});

describe('Windows path separators', () => {
  it('normalises backslashes in local paths, but not in glob patterns', () => {
    expect(normalizeLocalPath('scripts\\merge.sh')).toBe('scripts/merge.sh');
    expect(normalizeLocalPath('.\\scripts\\\\merge.sh')).toBe('scripts/merge.sh');
  });

  it('matches a synced path written with backslashes against a hook using slashes', () => {
    const hooks: HooksConfig = { preSync: [], transform: [], postSync: ['bash scripts/merge.sh'] };

    expect(() => checkHookReferences(hooks, ['scripts\\merge.sh'])).toThrow(
      /hooks\.post-sync.*'scripts\/merge\.sh'/
    );
  });

  it('matches a quoted backslash path in a hook against a synced path', () => {
    expect(
      findSyncedPathReferences("bash 'scripts\\merge.sh'", new Set(['scripts/merge.sh']))
    ).toEqual(['scripts/merge.sh']);
  });

  it('rejects a hook naming a file_pairs path written with backslashes', () => {
    const sources = parseSourcesInput(`
      - source: org/repo
        file_pairs:
          - local_path: 'scripts\\merge.sh'
    `);
    const hooks: HooksConfig = { preSync: ['./scripts/merge.sh'], transform: [], postSync: [] };

    expect(() => validateHooks(hooks, sources)).toThrow(/'scripts\/merge\.sh'/);
  });

  it('assigns a transform to a local path written with backslashes', () => {
    const rule = { pattern: 'docs/a.md', command: 'cat' };
    const config: NormalizedFileSyncConfig = {
      local_path: 'docs\\a.md',
      source_path: 'docs/a.md',
      source: 'org/repo',
      origin: 'file_pairs',
    };

    expect(assignTransforms([config], [rule])).toEqual([rule]);
  });

  it('still matches a literal backslash filename by glob, as bash on Linux would', () => {
    const hooks: HooksConfig = { preSync: [], transform: [], postSync: ['bash scripts?merge.sh'] };

    expect(() => checkHookReferences(hooks, ['scripts\\merge.sh'])).toThrow(/hooks\.post-sync/);
  });

  it('keeps the raw backslash form of a file_pairs path for glob matching', () => {
    const sources = parseSourcesInput(`
      - source: org/repo
        file_pairs:
          - local_path: 'scripts\\merge.sh'
    `);
    const hooks: HooksConfig = { preSync: ['bash scripts?merge.sh'], transform: [], postSync: [] };

    expect(() => validateHooks(hooks, sources)).toThrow(/hooks\.pre-sync/);
  });

  it('keeps backslash escapes in glob patterns', () => {
    expect(findSyncedPathReferences('bash scripts/merge\\*.sh', new Set(['scripts/merge.sh']))).toEqual([]);
  });
});

describe('case-insensitive synced-path matching', () => {
  const synced = new Set(['scripts/merge.sh']);
  const find = (command: string) => findSyncedPathReferences(command, synced);

  it('matches a synced path named with different case, as on Windows and macOS', () => {
    expect(find('bash SCRIPTS/merge.sh')).toEqual(['scripts/merge.sh']);
    expect(find('./Scripts/Merge.SH')).toEqual(['scripts/merge.sh']);
  });

  it('matches a differently cased glob', () => {
    expect(find('bash Scripts/M*.sh')).toEqual(['scripts/merge.sh']);
  });

  it('rejects a differently cased hook through checkHookReferences', () => {
    const hooks: HooksConfig = { preSync: ['bash SCRIPTS\\\\MERGE.sh'], transform: [], postSync: [] };

    expect(() => checkHookReferences(hooks, ['scripts/merge.sh'])).toThrow(
      /hooks\.pre-sync.*'scripts\/merge\.sh'/
    );
  });
});

describe('transform key normalisation', () => {
  it('normalises an exact key like a local path', () => {
    expect(parseHooksInput('transform:\n  scripts\\merge.sh: cat')?.transform).toEqual([
      { pattern: 'scripts/merge.sh', command: 'cat' },
    ]);
  });

  it('keeps backslash escapes in a glob key', () => {
    expect(parseHooksInput("transform:\n  'docs/*\\[1\\].md': cat")?.transform).toEqual([
      { pattern: 'docs/*\\[1\\].md', command: 'cat' },
    ]);
  });

  it('accepts an exact Windows-style key for a synced path', () => {
    const sources = parseSourcesInput(`
      - source: org/repo
        file_pairs:
          - local_path: scripts/merge.sh
    `);
    const hooks = parseHooksInput('transform:\n  scripts\\merge.sh: cat') as HooksConfig;

    expect(() => validateHooks(hooks, sources)).not.toThrow();
  });
});

describe('redirections do not start a new command', () => {
  const synced = new Set(['scripts/merge.sh']);
  const find = (command: string) => findSyncedPathReferences(command, synced);

  it('keeps tracking a shell across redirections before -c', () => {
    expect(find("bash >/dev/null -c 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
    expect(find("bash 2>&1 -c 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
    expect(find("sh &>/dev/null -c 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
    expect(find("bash >|out.log -c 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
    expect(find("bash </dev/null -ec 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
  });

  it('still ends a command at real separators', () => {
    expect(find("echo x >log; jq -c '.[0] * .[1]' a.json")).toEqual([]);
    expect(splitShellWords('a 2>&1 b')).toEqual(['a', '2', '1', 'b']);
  });
});

describe('a quote in a comment or here-document does not hide later lines', () => {
  const synced = new Set(['scripts/merge.sh']);
  const find = (command: string) => findSyncedPathReferences(command, synced);

  it('checks the lines after a comment with an apostrophe or a lone double quote', () => {
    expect(find("# Don't run this on forks\nbash scripts/merge.sh")).toEqual(['scripts/merge.sh']);
    expect(find("echo hi # it's fine\nbash scripts/merge.sh")).toEqual(['scripts/merge.sh']);
    expect(find('# 5" display\nbash scripts/merge.sh')).toEqual(['scripts/merge.sh']);
  });

  it('keeps cross-line context after such a comment', () => {
    expect(find("# Don't\nbash -c \\\n  'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
  });

  it('checks commands inside a substitution after a comment with a quote', () => {
    expect(find("echo $(\n# it's\nbash scripts/merge.sh\n)")).toEqual(['scripts/merge.sh']);
  });

  it('does not treat # inside a word as a comment', () => {
    expect(find('echo a#b; bash scripts/merge.sh')).toEqual(['scripts/merge.sh']);
    expect(find('[ ! -f lock ] # comment')).toEqual([]);
  });

  it('checks here-document bodies, and the commands after them, line by line', () => {
    expect(
      find("cat > notes.txt <<'EOF'\nDon't edit\nEOF\nbash -c \\\n  'bash scripts/merge.sh'")
    ).toEqual(['scripts/merge.sh']);
    expect(find("bash <<'EOF'\nbash scripts/merge.sh\nEOF")).toEqual(['scripts/merge.sh']);
    expect(find('cat <<-EOF\n\t# $(bash scripts/merge.sh)\n\tEOF')).toEqual([
      'scripts/merge.sh',
    ]);
    expect(find("cat <<'EOF'\nDon't edit\nEOF\necho done")).toEqual([]);
    expect(find("cat <<\\EOF >notes.txt\nDon't edit\nEOF\nbash scripts/merge.sh")).toEqual([
      'scripts/merge.sh',
    ]);
  });

  it('treats the word after a here-string as an ordinary word', () => {
    expect(find("xargs -I{} bash -c 'bash {}' <<< scripts/merge.sh")).toEqual([
      'scripts/merge.sh',
    ]);
  });
});

describe('ANSI-C and locale quoting', () => {
  const synced = new Set(['scripts/merge.sh']);
  const find = (command: string) => findSyncedPathReferences(command, synced);

  it('reads $\'...\' and $"..." as quotes, without the $', () => {
    expect(find("bash $'scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
    expect(find('bash $"scripts/merge.sh"')).toEqual(['scripts/merge.sh']);
    expect(splitShellWords("echo $'don\\'t'")).toEqual(['echo', "don't"]);
    expect(splitShellWords(String.raw`printf '%s' $'a\tb\nc\\d'`)).toEqual([
      'printf', '%s', 'a\tb\nc\\d',
    ]);
  });

  it('rejects ANSI-C escapes it cannot safely interpret', () => {
    for (const command of [
      String.raw`bash $'scripts/\x6derge.sh'`,
      String.raw`bash $'scripts/\155erge.sh'`,
      String.raw`bash $'scripts/\u006derge.sh'`,
      String.raw`bash $'scripts/\U0000006derge.sh'`,
      String.raw`bash $'scripts/merge.sh\0ignored'`,
      String.raw`bash $'scripts/merge\c?.sh'`,
    ]) {
      expect(() => checkHookReferences(
        { ...noHooks(), postSync: [command] }, ['scripts/merge.sh']
      )).toThrow(/hooks\.post-sync:.*unsupported ANSI-C escape/);
    }
  });

  it("does not let an escaped quote in $'...' hide the rest of the command", () => {
    expect(find("echo $'don\\'t'; bash scripts/merge.sh")).toEqual(['scripts/merge.sh']);
    expect(find("echo $(echo $'it\\'s'); bash scripts/merge.sh")).toEqual(['scripts/merge.sh']);
  });

  it('removes a line continuation inside double quotes, as bash does', () => {
    expect(find('bash "scripts/merge\\\n.sh"')).toEqual(['scripts/merge.sh']);
  });
});

describe('the command string of a nested shell', () => {
  const synced = new Set(['scripts/merge.sh']);
  const find = (command: string) => findSyncedPathReferences(command, synced);

  it('checks +c and option bundles that bash also treats as command strings', () => {
    expect(find("bash +c 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
    expect(find("bash +ec 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
    expect(find("bash +c -- 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
  });

  it('is found after further options, -- and redirections following -c', () => {
    expect(find("bash -c -- 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
    expect(find('sh -c -- "./scripts/merge.sh"')).toEqual(['scripts/merge.sh']);
    expect(find("bash -c -e 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
    expect(find("bash -co pipefail 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
    expect(find("bash -c 2>/dev/null 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
    expect(find("bash -c >/dev/null 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
  });

  it('is found for a shell named in any case or as a Windows executable', () => {
    expect(find("BASH -c 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
    expect(find("bash.exe -c 'bash scripts/merge.sh'")).toEqual(['scripts/merge.sh']);
    expect(find("'C:\\Program Files\\Git\\bin\\bash.exe' -c 'bash scripts/merge.sh'")).toEqual([
      'scripts/merge.sh',
    ]);
  });

  it('ends with the command that ran the shell', () => {
    expect(find("bash -c 'true'; jq -c '.[0] * .[1]' a.json")).toEqual([]);
  });
});

describe('deeply nested hook commands', () => {
  const synced = new Set(['scripts/merge.sh']);

  it('rejects nesting deeper than the check follows, without overflowing the stack', () => {
    const command = `${'$('.repeat(5000)}true${')'.repeat(5000)}`;
    expect(() => findSyncedPathReferences(command, synced)).toThrow(ConfigError);
    expect(() => findSyncedPathReferences(`${'eval '.repeat(10000)}true`, synced)).toThrow(
      /more than 32 levels deep/
    );
  });

  it('names the hook when it rejects deep nesting', () => {
    const hooks: HooksConfig = {
      preSync: [`${'eval '.repeat(40)}true`],
      transform: [],
      postSync: [],
    };
    expect(() => checkHookReferences(hooks, ['scripts/merge.sh'])).toThrow(
      /^hooks\.pre-sync: command 'eval .* more than 32 levels deep$/
    );
  });

  it('follows nesting up to the limit', () => {
    const command = `${'eval '.repeat(30)}bash scripts/merge.sh`;
    expect(findSyncedPathReferences(command, synced)).toEqual(['scripts/merge.sh']);
  });
});
