import { describe, it, expect } from 'vitest';
import { parseFilesInput, ConfigError } from '../src/config';

describe('parseFilesInput', () => {
  describe('valid inputs', () => {
    it('parses a single file mapping', () => {
      const yaml = `
        - project: .github/workflows/ci.yml
          source: my-org/boilerplate
          path: workflows/ci.yml
      `;

      const result = parseFilesInput(yaml);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        project: '.github/workflows/ci.yml',
        source: 'my-org/boilerplate',
        path: 'workflows/ci.yml',
        ref: undefined,
      });
    });

    it('parses multiple file mappings', () => {
      const yaml = `
        - project: .eslintrc.js
          source: my-org/boilerplate
          path: configs/.eslintrc.js
        - project: tsconfig.json
          source: my-org/boilerplate
          path: configs/tsconfig.json
          ref: v2.0.0
      `;

      const result = parseFilesInput(yaml);

      expect(result).toHaveLength(2);
      expect(result[0].project).toBe('.eslintrc.js');
      expect(result[0].ref).toBeUndefined();
      expect(result[1].project).toBe('tsconfig.json');
      expect(result[1].ref).toBe('v2.0.0');
    });

    it('trims whitespace from values', () => {
      const yaml = `
        - project: "  .eslintrc.js  "
          source: "  my-org/boilerplate  "
          path: "  .eslintrc.js  "
          ref: "  main  "
      `;

      const result = parseFilesInput(yaml);

      expect(result[0]).toEqual({
        project: '.eslintrc.js',
        source: 'my-org/boilerplate',
        path: '.eslintrc.js',
        ref: 'main',
      });
    });

    it('accepts ref as branch name', () => {
      const yaml = `
        - project: file.js
          source: org/repo
          path: file.js
          ref: feature/branch-name
      `;

      const result = parseFilesInput(yaml);
      expect(result[0].ref).toBe('feature/branch-name');
    });

    it('accepts ref as commit SHA', () => {
      const yaml = `
        - project: file.js
          source: org/repo
          path: file.js
          ref: abc123def456
      `;

      const result = parseFilesInput(yaml);
      expect(result[0].ref).toBe('abc123def456');
    });
  });

  describe('invalid inputs', () => {
    it('throws on empty input', () => {
      expect(() => parseFilesInput('')).toThrow(ConfigError);
      expect(() => parseFilesInput('   ')).toThrow(ConfigError);
    });

    it('throws on non-array input', () => {
      expect(() => parseFilesInput('not-an-array')).toThrow(ConfigError);
      expect(() => parseFilesInput('project: file.js')).toThrow(ConfigError);
    });

    it('throws on empty array', () => {
      expect(() => parseFilesInput('[]')).toThrow(ConfigError);
    });

    it('throws on missing project field', () => {
      const yaml = `
        - source: org/repo
          path: file.js
      `;

      expect(() => parseFilesInput(yaml)).toThrow(ConfigError);
      expect(() => parseFilesInput(yaml)).toThrow("'project' is required");
    });

    it('throws on missing source field', () => {
      const yaml = `
        - project: file.js
          path: file.js
      `;

      expect(() => parseFilesInput(yaml)).toThrow(ConfigError);
      expect(() => parseFilesInput(yaml)).toThrow("'source' is required");
    });

    it('throws on missing path field', () => {
      const yaml = `
        - project: file.js
          source: org/repo
      `;

      expect(() => parseFilesInput(yaml)).toThrow(ConfigError);
      expect(() => parseFilesInput(yaml)).toThrow("'path' is required");
    });

    it('throws on invalid source format - no slash', () => {
      const yaml = `
        - project: file.js
          source: invalid-source
          path: file.js
      `;

      expect(() => parseFilesInput(yaml)).toThrow(ConfigError);
      expect(() => parseFilesInput(yaml)).toThrow("'owner/repo' format");
    });

    it('throws on invalid source format - too many slashes', () => {
      const yaml = `
        - project: file.js
          source: org/repo/extra
          path: file.js
      `;

      expect(() => parseFilesInput(yaml)).toThrow(ConfigError);
    });

    it('throws on invalid source format - empty parts', () => {
      const yaml = `
        - project: file.js
          source: /repo
          path: file.js
      `;

      expect(() => parseFilesInput(yaml)).toThrow(ConfigError);
    });

    it('throws on invalid YAML syntax', () => {
      const yaml = `
        - project: [invalid
      `;

      expect(() => parseFilesInput(yaml)).toThrow(ConfigError);
      expect(() => parseFilesInput(yaml)).toThrow('Failed to parse');
    });

    it('throws when ref is not a string', () => {
      const yaml = `
        - project: file.js
          source: org/repo
          path: file.js
          ref: 123
      `;

      // YAML will parse 123 as a number, which should fail validation
      expect(() => parseFilesInput(yaml)).toThrow(ConfigError);
      expect(() => parseFilesInput(yaml)).toThrow("'ref' must be a string");
    });

    it('includes entry number in error message', () => {
      const yaml = `
        - project: file1.js
          source: org/repo
          path: file1.js
        - project: file2.js
          source: invalid
          path: file2.js
      `;

      expect(() => parseFilesInput(yaml)).toThrow('Entry 2:');
    });
  });
});
