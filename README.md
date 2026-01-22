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
    - cron: '0 9 * * 1'  # Every Monday at 9am
  workflow_dispatch:      # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: your-org/boilerplate-sync@v1
        with:
          files: |
            - project: .github/workflows/ci.yml
              source: my-org/boilerplate
              path: workflows/ci.yml
            - project: .eslintrc.js
              source: my-org/boilerplate
              path: configs/.eslintrc.js
              ref: v2.0.0
          schedule: '0 9 * * 1'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `files` | ✅ | - | YAML array of file sync mappings (see below) |
| `github-token` | ✅ | `${{ github.token }}` | Token for creating PRs |
| `source-token` | ❌ | Same as `github-token` | Token for accessing source repos (for private repos) |
| `create-missing` | ❌ | `true` | Create project files that don't exist yet |
| `fail-on-error` | ❌ | `false` | Fail the action if any file sync fails |
| `pr-title` | ❌ | `chore: sync boilerplate files` | PR title |
| `pr-labels` | ❌ | `boilerplate,automated` | Comma-separated labels |
| `pr-branch` | ❌ | `boilerplate-sync` | Branch name prefix |
| `commit-message` | ❌ | `chore: sync boilerplate files` | Commit message |
| `schedule` | ❌ | - | Cron expression for documentation (displayed in PR body) |

### File Mapping Format

Each entry in the `files` array requires:

| Field | Required | Description |
|-------|----------|-------------|
| `project` | ✅ | Path in your repository to update |
| `source` | ✅ | Source repository in `owner/repo` format |
| `path` | ✅ | Path to the file in the source repository |
| `ref` | ❌ | Git ref (branch, tag, SHA). Defaults to the source repo's default branch |

```yaml
files: |
  # Sync CI workflow from boilerplate's main branch
  - project: .github/workflows/ci.yml
    source: my-org/boilerplate
    path: workflows/ci.yml
  
  # Sync from a specific tag
  - project: tsconfig.json
    source: my-org/boilerplate
    path: configs/tsconfig.strict.json
    ref: v2.0.0
  
  # Sync from a specific commit
  - project: .prettierrc
    source: my-org/boilerplate
    path: .prettierrc
    ref: abc123def
```

## Outputs

| Output | Description |
|--------|-------------|
| `has-changes` | `true` if any files were updated |
| `updated-count` | Number of files updated or created |
| `failed-count` | Number of files that failed to sync |
| `skipped-count` | Number of files skipped (unchanged) |
| `pr-number` | PR number if created |
| `pr-url` | PR URL if created |
| `summary` | JSON summary of all operations |

## Examples

### Basic Usage

Sync a few config files on a weekly schedule:

```yaml
- uses: your-org/boilerplate-sync@v1
  with:
    files: |
      - project: .github/workflows/ci.yml
        source: my-org/boilerplate
        path: workflows/ci.yml
      - project: .eslintrc.js
        source: my-org/boilerplate
        path: .eslintrc.js
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Private Source Repository

Use a PAT to access private boilerplate repos:

```yaml
- uses: your-org/boilerplate-sync@v1
  with:
    files: |
      - project: .github/workflows/deploy.yml
        source: my-org/private-boilerplate
        path: workflows/deploy.yml
    github-token: ${{ secrets.GITHUB_TOKEN }}
    source-token: ${{ secrets.BOILERPLATE_PAT }}
```

### Strict Mode

Fail the workflow if any file fails to sync:

```yaml
- uses: your-org/boilerplate-sync@v1
  with:
    files: |
      - project: critical-config.json
        source: my-org/boilerplate
        path: critical-config.json
    github-token: ${{ secrets.GITHUB_TOKEN }}
    fail-on-error: true
```

### Don't Create Missing Files

Only update files that already exist:

```yaml
- uses: your-org/boilerplate-sync@v1
  with:
    files: |
      - project: .github/workflows/ci.yml
        source: my-org/boilerplate
        path: workflows/ci.yml
    github-token: ${{ secrets.GITHUB_TOKEN }}
    create-missing: false
```

### Custom PR Settings

```yaml
- uses: your-org/boilerplate-sync@v1
  with:
    files: |
      - project: .eslintrc.js
        source: my-org/boilerplate
        path: .eslintrc.js
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
    files: |
      - project: .eslintrc.js
        source: my-org/boilerplate
        path: .eslintrc.js
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

1. **Parse Configuration** - Validates the `files` input YAML
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
  contents: write       # To push branches
  pull-requests: write  # To create PRs
```

If using a custom `source-token` for private repositories, ensure it has `repo` scope.

## Limitations

- Only supports GitHub repositories as sources (raw HTTP URLs planned for future)
- Files are replaced entirely (no merge/diff support)
- One PR per workflow run (branch name includes run ID)

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type check
npm run type-check

# Lint
npm run lint
```

## License

MIT
