# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development setup
make develop              # Install deps + enable pre-commit hooks
make install              # Just install npm dependencies

# Building
npm run build             # Bundle with ncc to dist/
make rebuild              # Clean and build from scratch

# Testing
npm run test              # Run tests once
npm run test:watch        # Run tests in watch mode
npx vitest run src/config.test.ts           # Run single test file
npx vitest run -t "pattern"                 # Run tests matching pattern

# Quality checks
npm run lint              # ESLint
npm run type-check        # TypeScript type checking
make check                # All checks: pre-commit, lint, type-check, test

# Pre-commit
make run-pre-commit       # Run pre-commit hooks manually
make enable-pre-commit    # Enable hooks
make disable-pre-commit   # Disable hooks
```

## Architecture

This is a GitHub Action that syncs boilerplate files from source repositories to target repositories using a **pull model** (targets pull from sources, not sources pushing to targets).

### Data Flow

```text
YAML sources input
       ↓
  parseSourcesInput() [config.ts]     → Validates YAML, source format, file mappings
       ↓
  normalizeSources() [config.ts]      → Flattens nested config to NormalizedFileSyncConfig[]
       ↓
  expandGlobPatterns() [sync.ts]      → Expands glob patterns via GitHub Tree API
       ↓
  syncFile() [sync.ts]                → For each file: fetch → compare → write
       ↓
  SyncSummary                         → Categorized results (updated/created/skipped/failed)
```

### Key Types (src/sources/types.ts)

- `SourceConfig` - User-facing YAML config with `source`, `ref`, `default_files`, `file_pairs`
- `NormalizedFileSyncConfig` - Flattened internal config with resolved `local_path`/`source_path`
- `FileSource` - Interface for file sources (only GitHub implemented; HTTP planned)
- `SyncResult` / `SyncSummary` - Operation results

### Module Responsibilities

- **config.ts** - YAML parsing, validation (ConfigError for user errors), normalization
- **sync.ts** - Orchestrates file sync, glob expansion, file I/O, result aggregation
- **sources/github.ts** - GitHub Contents API for fetching, Git Tree API for glob expansion, default branch caching
- **report.ts** - Generates GitHub step summary markdown
- **index.ts** - Action entry point, wires everything together, sets outputs

### GitHub API Usage (sources/github.ts)

- `Octokit.repos.getContent()` - Fetch individual files
- `Octokit.repos.get()` - Resolve default branch (cached per repo)
- `Octokit.git.getTree()` - List all files for glob matching (recursive tree)
- `minimatch` - Glob pattern matching against tree results

## Code Conventions

- Single quotes (Prettier configured)
- Strict TypeScript (`strict: true` in tsconfig)
- `ConfigError` class for user-facing validation errors
- Per-source tokens: `sourceToken` field allows different credentials per source repo
