import { describe, it, expect } from 'vitest';
import { parseSourcesInput, normalizeSources, ConfigError } from '../src/config';

describe('parseSourcesInput', () => {
  describe('valid inputs', () => {
    it('parses a single source with one file', () => {
      const yaml = `
        - source: my-org/boilerplate
          files:
            - local_path: .github/workflows/ci.yml
              source_path: workflows/ci.yml
      `;

      const result = parseSourcesInput(yaml);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        source: 'my-org/boilerplate',
        ref: undefined,
        files: [
          {
            local_path: '.github/workflows/ci.yml',
            source_path: 'workflows/ci.yml',
          },
        ],
      });
    });

    it('parses multiple sources with multiple files', () => {
      const yaml = `
        - source: my-org/boilerplate
          files:
            - local_path: .eslintrc.js
              source_path: configs/.eslintrc.js
            - local_path: tsconfig.json
              source_path: configs/tsconfig.json
        - source: my-org/other-boilerplate
          ref: v2.0.0
          files:
            - local_path: .prettierrc
      `;

      const result = parseSourcesInput(yaml);

      expect(result).toHaveLength(2);
      expect(result[0].source).toBe('my-org/boilerplate');
      expect(result[0].ref).toBeUndefined();
      expect(result[0].files).toHaveLength(2);
      expect(result[1].source).toBe('my-org/other-boilerplate');
      expect(result[1].ref).toBe('v2.0.0');
      expect(result[1].files).toHaveLength(1);
    });

    it('trims whitespace from values', () => {
      const yaml = `
        - source: "  my-org/boilerplate  "
          ref: "  main  "
          files:
            - local_path: "  .eslintrc.js  "
              source_path: "  .eslintrc.js  "
      `;

      const result = parseSourcesInput(yaml);

      expect(result[0]).toEqual({
        source: 'my-org/boilerplate',
        ref: 'main',
        files: [
          {
            local_path: '.eslintrc.js',
            source_path: '.eslintrc.js',
          },
        ],
      });
    });

    it('accepts ref as branch name', () => {
      const yaml = `
        - source: org/repo
          ref: feature/branch-name
          files:
            - local_path: file.js
      `;

      const result = parseSourcesInput(yaml);
      expect(result[0].ref).toBe('feature/branch-name');
    });

    it('accepts ref as commit SHA', () => {
      const yaml = `
        - source: org/repo
          ref: abc123def456
          files:
            - local_path: file.js
      `;

      const result = parseSourcesInput(yaml);
      expect(result[0].ref).toBe('abc123def456');
    });

    it('defaults source_path to local_path when not provided', () => {
      const yaml = `
        - source: org/repo
          files:
            - local_path: file.js
      `;

      const result = parseSourcesInput(yaml);
      expect(result[0].files[0].source_path).toBeUndefined();
      
      // Test normalization
      const normalized = normalizeSources(result);
      expect(normalized[0].source_path).toBe('file.js');
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
        - files:
            - local_path: file.js
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow("'source' is required");
    });

    it('throws on missing files field', () => {
      const yaml = `
        - source: org/repo
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow("'files' is required");
    });

    it('throws on empty files array', () => {
      const yaml = `
        - source: org/repo
          files: []
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow("'files' array cannot be empty");
    });

    it('throws on missing local_path field', () => {
      const yaml = `
        - source: org/repo
          files:
            - source_path: file.js
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow("'local_path' is required");
    });

    it('throws on invalid source format - no slash', () => {
      const yaml = `
        - source: invalid-source
          files:
            - local_path: file.js
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow("'owner/repo' format");
    });

    it('throws on invalid source format - too many slashes', () => {
      const yaml = `
        - source: org/repo/extra
          files:
            - local_path: file.js
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
    });

    it('throws on invalid source format - empty parts', () => {
      const yaml = `
        - source: /repo
          files:
            - local_path: file.js
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
          files:
            - local_path: file.js
      `;

      // YAML will parse 123 as a number, which should fail validation
      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow("'ref' must be a string");
    });

    it('throws when source_path is not a string', () => {
      const yaml = `
        - source: org/repo
          files:
            - local_path: file.js
              source_path: 123
      `;

      expect(() => parseSourcesInput(yaml)).toThrow(ConfigError);
      expect(() => parseSourcesInput(yaml)).toThrow("'source_path' must be a string");
    });

    it('includes source number in error message', () => {
      const yaml = `
        - source: org/repo
          files:
            - local_path: file1.js
        - source: invalid
          files:
            - local_path: file2.js
      `;

      expect(() => parseSourcesInput(yaml)).toThrow('Source 2:');
    });
  });

  describe('normalizeSources', () => {
    it('flattens sources into normalized configs', () => {
      const sources = [
        {
          source: 'org/repo1',
          ref: 'main',
          files: [
            { local_path: 'file1.js', source_path: 'src/file1.js' },
            { local_path: 'file2.js' },
          ],
        },
        {
          source: 'org/repo2',
          files: [{ local_path: 'file3.js' }],
        },
      ];

      const normalized = normalizeSources(sources);

      expect(normalized).toHaveLength(3);
      expect(normalized[0]).toEqual({
        local_path: 'file1.js',
        source_path: 'src/file1.js',
        source: 'org/repo1',
        ref: 'main',
      });
      expect(normalized[1]).toEqual({
        local_path: 'file2.js',
        source_path: 'file2.js', // defaults to local_path
        source: 'org/repo1',
        ref: 'main',
      });
      expect(normalized[2]).toEqual({
        local_path: 'file3.js',
        source_path: 'file3.js',
        source: 'org/repo2',
        ref: undefined,
      });
    });
  });
});
