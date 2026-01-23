# Boilerplate Sync

A GitHub Action that keeps your project files in sync with boilerplate repositories. Automatically creates pull requests when boilerplate files are updated.

## Features

- 🔄 **Automatic syncing** - Keep project files up-to-date with boilerplate sources
- 📝 **Pull request workflow** - Changes are proposed via PR, not committed directly
- 🆕 **Create missing files** - Optionally create new files when boilerplate adds them
- 📊 **Detailed reports** - PR body shows what changed, what was skipped, and what failed
- ⚠️ **Error handling** - Failed syncs create draft PRs to surface issues
- 🔐 **Private repo support** - Use separate tokens for source repositories

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

      - uses: michen00/boilerplate-sync@v1
        with:
          sources: |
            - source: my-org/boilerplate
              ref: main
              files:
                - local_path: .github/workflows/ci.yml
                  source_path: workflows/ci.yml
                - local_path: .eslintrc.js
                  source_path: configs/.eslintrc.js
          schedule: '0 9 * * 1'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input            | Required | Default                         | Description                                              |
| ---------------- | -------- | ------------------------------- | -------------------------------------------------------- |
| `sources`        | ✅       | -                               | YAML array of source repositories (see below)            |
| `github-token`   | ✅       | `${{ github.token }}`           | Token for creating PRs                                   |
| `source-token`   | ❌       | Same as `github-token`          | Token for accessing source repos (for private repos)     |
| `create-missing` | ❌       | `true`                          | Create project files that don't exist yet                |
| `fail-on-error`  | ❌       | `false`                         | Fail the action if any file sync fails                   |
| `pr-title`       | ❌       | `chore: sync boilerplate files` | PR title                                                 |
| `pr-labels`      | ❌       | `boilerplate,automated`         | Comma-separated labels                                   |
| `pr-branch`      | ❌       | `boilerplate-sync`              | Branch name prefix                                       |
| `commit-message` | ❌       | `chore: sync boilerplate files` | Commit message                                           |
| `schedule`       | ❌       | -                               | Cron expression for documentation (displayed in PR body) |

### Sources Configuration Format

The `sources` array groups files by their source repository. Each source contains:

| Field     | Required | Description                                                              |
| --------- | -------- | ------------------------------------------------------------------------ |
| `source`  | ✅       | Source repository in `owner/repo` format                                 |
| `ref`     | ❌       | Git ref (branch, tag, SHA) - applies to all files from this source. Defaults to the source repo's default branch |
| `files`   | ✅       | Array of file mappings (see below)                                      |

Each file mapping in the `files` array:

| Field        | Required | Description                                                              |
| ------------ | -------- | ------------------------------------------------------------------------ |
| `local_path` | ✅       | Path in your repository to update                                        |
| `source_path`| ❌       | Path to the file in the source repository. Defaults to `local_path` if not specified |

```yaml
sources: |
  # Sync multiple files from boilerplate's main branch
  - source: my-org/boilerplate
    ref: main
    files:
      - local_path: .github/workflows/ci.yml
        source_path: workflows/ci.yml
      - local_path: .eslintrc.js
        source_path: configs/.eslintrc.js
  # Sync from a specific tag
  - source: my-org/boilerplate
    ref: v2.0.0
    files:
      - local_path: tsconfig.json
        source_path: configs/tsconfig.strict.json
      - local_path: .prettierrc
        # source_path defaults to .prettierrc
```

## Outputs

| Output          | Description                         |
| --------------- | ----------------------------------- |
| `has-changes`   | `true` if any files were updated    |
| `updated-count` | Number of files updated or created  |
| `failed-count`  | Number of files that failed to sync |
| `skipped-count` | Number of files skipped (unchanged) |
| `pr-number`     | PR number if created                |
| `pr-url`        | PR URL if created                   |
| `summary`       | JSON summary of all operations      |

## Examples

### Basic Usage

Sync a few config files on a weekly schedule:

```yaml
- uses: your-org/boilerplate-sync@v1
  with:
    sources: |
      - source: my-org/boilerplate
        files:
          - local_path: .github/workflows/ci.yml
            source_path: workflows/ci.yml
          - local_path: .eslintrc.js
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Private Source Repository

Use a PAT to access private boilerplate repos:

```yaml
- uses: your-org/boilerplate-sync@v1
  with:
    sources: |
      - source: my-org/private-boilerplate
        files:
          - local_path: .github/workflows/deploy.yml
            source_path: workflows/deploy.yml
    github-token: ${{ secrets.GITHUB_TOKEN }}
    source-token: ${{ secrets.BOILERPLATE_PAT }}
```

### Strict Mode

Fail the workflow if any file fails to sync:

```yaml
- uses: your-org/boilerplate-sync@v1
  with:
    sources: |
      - source: my-org/boilerplate
        files:
          - local_path: .eslintrc.js
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
        files:
          - local_path: .github/workflows/ci.yml
            source_path: workflows/ci.yml
    github-token: ${{ secrets.GITHUB_TOKEN }}
    create-missing: false
```

### Custom PR Settings

```yaml
- uses: your-org/boilerplate-sync@v1
  with:
    sources: |
      - source: my-org/boilerplate
        files:
          - local_path: .eslintrc.js
    github-token: ${{ secrets.GITHUB_TOKEN }}
    pr-title: 'deps: update boilerplate configs'
    pr-labels: 'dependencies,config'
    pr-branch: 'auto/boilerplate'
    commit-message: 'deps: sync boilerplate configs'
```

### Using Outputs

```yaml
- uses: your-org/boilerplate-sync@v1
  id: sync
  with:
    sources: |
      - source: my-org/boilerplate
        files:
          - local_path: .eslintrc.js
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Comment on PR
  if: steps.sync.outputs.pr-number
  uses: actions/github-script@v7
  with:
    script: |
      github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: ${{ steps.sync.outputs.pr-number }},
        body: 'Boilerplate sync completed! Updated ${{ steps.sync.outputs.updated-count }} files.'
      })
```

## How It Works

1. **Parse Configuration** - Validates the `sources` input YAML
2. **Fetch Source Files** - Downloads each file from its source repository using the GitHub API
3. **Compare & Update** - Compares with existing project files, writes changes
4. **Create PR** - Creates a pull request with all changes and a detailed summary

### PR Behavior

- **Changes detected**: Creates a normal PR with updated files
- **No changes**: No PR created
- **All files failed**: Creates a **draft** PR with an empty commit to surface the errors

## Permissions

The action requires these permissions:

```yaml
permissions:
  contents: write # To push branches
  pull-requests: write # To create PRs
```

If using a custom `source-token` for private repositories, ensure it has `repo` scope.

## Limitations

- Only supports GitHub repositories as sources (raw HTTP URLs planned for future)
- Files are replaced entirely (no merge/diff support)
- One PR per workflow run (branch name includes run ID)
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
