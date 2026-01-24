import { describe, it, expect } from 'vitest';
import { parseSourcesInput, normalizeSources, ConfigError } from '../src/config';

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
      });
      expect(normalized[1]).toEqual({
        local_path: 'file2.js',
        source_path: 'file2.js',
        source: 'org/repo1',
        ref: 'main',
        sourceToken: undefined,
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
      });
      expect(normalized[1]).toEqual({
        local_path: 'file2.js',
        source_path: 'file2.js', // defaults to local_path
        source: 'org/repo1',
        ref: 'main',
        sourceToken: undefined,
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
