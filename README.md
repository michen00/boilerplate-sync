# Boilerplate Sync

A GitHub Action that keeps your project boilerplate files in sync with another repository.

## Features

- 🔄 **Automatic syncing** - Keep project files up-to-date with boilerplate sources
- 🆕 **Create missing files** - Optionally create new files when boilerplate adds them
- 📊 **Detailed reports** - Step summary shows what changed, what was skipped, and what failed
- 🔐 **Private repo support** - Use separate tokens for source repositories
- 🔧 **Composable** - Pairs with [peter-evans/create-pull-request](https://github.com/peter-evans/create-pull-request) for PR creation

## Quick Start

```yaml
name: Sync Boilerplate
on:
  schedule:
    - cron: '0 9 * * 1' # Every Monday at 9am
  workflow_dispatch: # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write

    steps:
      - uses: actions/checkout@v6

      - name: Sync boilerplate files
        uses: michen00/boilerplate-sync@v1
        id: sync
        with:
          sources: |
            - source: my-org/boilerplate
              ref: main
              default_files:
                - .eslintrc.js
                - .prettierrc
              file_pairs:
                - local_path: .github/workflows/ci.yml
                  source_path: workflows/ci.yml
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Create Pull Request
        if: steps.sync.outputs.has-changes == 'true'
        uses: peter-evans/create-pull-request@v8
        with:
          branch: boilerplate-sync/${{ github.run_id }}
          delete-branch: true
          title: 'chore: sync boilerplate files'
          body: |
            ## Boilerplate Sync

            Updated: ${{ steps.sync.outputs.updated-count }}
            Skipped: ${{ steps.sync.outputs.skipped-count }}
            Failed: ${{ steps.sync.outputs.failed-count }}
          labels: |
            boilerplate
            automated
```

## Inputs

| Input            | Required | Default               | Description                                   |
| ---------------- | -------- | --------------------- | --------------------------------------------- |
| `sources`        | ✅       | -                     | YAML array of source repositories (see below) |
| `github-token`   | ✅       | `${{ github.token }}` | Token for accessing source repos              |
| `create-missing` | ❌       | `true`                | Create project files that don't exist yet     |
| `fail-on-error`  | ❌       | `false`               | Fail the action if any file sync fails        |

### Sources Configuration Format

The `sources` array groups files by their source repository. Each source contains:

| Field           | Required | Description                                                                                                      |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `source`        | ✅       | Source repository in `owner/repo` format                                                                         |
| `ref`           | ❌       | Git ref (branch, tag, SHA) - applies to all files from this source. Defaults to the source repo's default branch |
| `source-token`  | ❌       | Token for private source repos (falls back to `github-token`)                                                    |
| `default_files` | ❌\*     | Simple list of files where local path equals source path                                                         |
| `file_pairs`    | ❌\*     | Array of file mappings with explicit paths (see below)                                                           |

\*At least one of `default_files` or `file_pairs` is required per source.

Each file mapping in `file_pairs`:

| Field         | Required | Description                                                                          |
| ------------- | -------- | ------------------------------------------------------------------------------------ |
| `local_path`  | ✅       | Path in your repository to update                                                    |
| `source_path` | ❌       | Path to the file in the source repository. Defaults to `local_path` if not specified |

```yaml
sources: |
  # Sync files with same paths in both repos
  - source: my-org/boilerplate
    ref: main
    default_files:
      - .eslintrc.js
      - .prettierrc

  # Sync files with different paths
  - source: my-org/boilerplate
    ref: v2.0.0
    file_pairs:
      - local_path: .github/workflows/ci.yml
        source_path: workflows/ci.yml
      - local_path: tsconfig.json
        source_path: configs/tsconfig.strict.json

  # Mix both formats + private repo with custom token
  - source: my-org/private-templates
    source-token: ${{ secrets.PRIVATE_PAT }}
    default_files:
      - config.json
    file_pairs:
      - local_path: .env.example
        source_path: templates/.env.example
```

## Outputs

| Output          | Type     | Description                                                                     |
| --------------- | -------- | ------------------------------------------------------------------------------- |
| `has-changes`   | `string` | `"true"` if any files were updated or created, `"false"` otherwise. Always set. |
| `updated-count` | `string` | Number of files updated or created. Always set.                                 |
| `failed-count`  | `string` | Number of files that failed to sync. Always set.                                |
| `skipped-count` | `string` | Number of files skipped (no changes detected). Always set.                      |
| `summary`       | `JSON`   | Full sync summary with details on each file. Always set.                        |

## Examples

### Real Working Example

This repository includes a real, working example workflow at [`.github/workflows/sync-template.yml`](.github/workflows/sync-template.yml) that syncs multiple files from a [template repository for Python projects](https://github.com/michen00/template):

You can copy this workflow file and adapt it for your own needs. Simply modify the `sources` configuration to point to your template repository and add or remove files as needed.

### Basic Usage

Sync a few config files on a weekly schedule:

```yaml
name: Sync Boilerplate
on:
  schedule:
    - cron: '0 9 * * 1' # Every Monday at 9am
  workflow_dispatch: # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write

    steps:
      - uses: actions/checkout@v4

      - name: Sync boilerplate files
        uses: your-org/boilerplate-sync@v1
        id: sync
        with:
          sources: |
            - source: my-org/boilerplate
              default_files:
                - .eslintrc.js
              file_pairs:
                - local_path: .github/workflows/ci.yml
                  source_path: workflows/ci.yml
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Create Pull Request
        if: steps.sync.outputs.has-changes == 'true'
        uses: peter-evans/create-pull-request@v8
        with:
          branch: boilerplate-sync/${{ github.run_id }}
          title: 'chore: sync boilerplate files'
```

### Private Source Repository

Use a PAT to access private boilerplate repos by specifying `source-token` per source:

```yaml
- uses: your-org/boilerplate-sync@v1
  with:
    sources: |
      - source: my-org/private-boilerplate
        source-token: ${{ secrets.BOILERPLATE_PAT }}
        default_files:
          - .github/workflows/deploy.yml
      - source: my-org/public-boilerplate
        # No source-token needed - uses github-token
        default_files:
          - .eslintrc.js
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Strict Mode

Fail the workflow if any file fails to sync:

```yaml
- uses: your-org/boilerplate-sync@v1
  with:
    sources: |
      - source: my-org/boilerplate
        default_files:
          - .eslintrc.js
    github-token: ${{ secrets.GITHUB_TOKEN }}
    fail-on-error: true
```

### Don't Create Missing Files

Only update files that already exist:

```yaml
- uses: your-org/boilerplate-sync@v1
  with:
    sources: |
      - source: my-org/boilerplate
        file_pairs:
          - local_path: .github/workflows/ci.yml
            source_path: workflows/ci.yml
    github-token: ${{ secrets.GITHUB_TOKEN }}
    create-missing: false
```

### Using Outputs

```yaml
- name: Sync boilerplate files
  uses: your-org/boilerplate-sync@v1
  id: sync
  with:
    sources: |
      - source: my-org/boilerplate
        default_files:
          - .eslintrc.js
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Create Pull Request
  if: steps.sync.outputs.has-changes == 'true'
  uses: peter-evans/create-pull-request@v8
  id: cpr
  with:
    branch: boilerplate-sync/${{ github.run_id }}
    title: 'chore: sync boilerplate files'
    body: |
      Updated: ${{ steps.sync.outputs.updated-count }}
      Skipped: ${{ steps.sync.outputs.skipped-count }}
      Failed: ${{ steps.sync.outputs.failed-count }}

- name: Log PR URL
  if: steps.cpr.outputs.pull-request-url
  run: echo "PR created at ${{ steps.cpr.outputs.pull-request-url }}"
```

## How It Works

1. **Parse Configuration** - Validates the `sources` input YAML
2. **Fetch Source Files** - Downloads each file from its source repository using the GitHub API
3. **Compare & Update** - Compares with existing project files, writes changes to the workspace
4. **Output Results** - Sets outputs (`has-changes`, counts, summary) for use by subsequent steps

The action writes files directly to the workspace. Use [peter-evans/create-pull-request](https://github.com/peter-evans/create-pull-request) or similar to create a PR from the changes.

## Permissions

When using with `peter-evans/create-pull-request`, your workflow needs these permissions:

```yaml
permissions:
  contents: write # To write files and push branches
  pull-requests: write # To create PRs (for peter-evans/create-pull-request)
```

If using a custom `source-token` for private source repositories, ensure the token has `repo` scope.

## Limitations

- Only supports GitHub repositories as sources (raw HTTP URLs planned for future)
- Files are replaced entirely (no merge/diff support)
- **No dependency analysis** - The action does not understand relationships between files or detect when syncing one file requires changes to other files
- **No context awareness** - Project-specific customizations may be overwritten without warning

## ⚠️ Important Warning

**Do not use this action for critical files.**

This action performs direct file replacement without understanding:

- Dependencies between files
- Required configuration changes in other files
- Breaking changes that might affect your project
- Context-specific customizations your project may need

**Recommended use cases:**

- Non-critical configuration files (e.g., `.eslintrc.js`, `.prettierrc`)
- Workflow files that are truly boilerplate
- Documentation templates
- Shared tooling configurations

**Not recommended for:**

- Build configuration files (e.g., `package.json`, `tsconfig.json`) that may have project-specific dependencies
- Deployment configurations
- Environment-specific settings
- Files that require coordination with other files
- Any file where changes could break your build or deployment

## Development

```bash
# Set up for development (installs dependencies and enables pre-commit hooks)
make develop

# Build
make build

# Run all checks (lint, type-check, tests)
make check

# Individual commands
make test          # Run tests once
make test-watch    # Run tests in watch mode
make lint          # Run ESLint
make type-check    # Run TypeScript type checking

# Clean and rebuild
make clean         # Remove build artifacts
make rebuild       # Clean and build from scratch

# Pre-commit hooks
make enable-pre-commit  # Enable pre-commit hooks
make run-pre-commit     # Run pre-commit checks manually
```

Or use npm directly:

```bash
npm install
npm run build
npm test
npm run type-check
npm run lint
```
