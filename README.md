# Boilerplate Sync

A GitHub Action that keeps your project boilerplate files in sync with another repository.

## Features

- 🔄 **Automatic syncing** - Keep project files up-to-date with boilerplate sources
- 🆕 **Create missing files** - Optionally create new files when boilerplate adds them
- 📊 **Detailed reports** - Step summary shows what changed, what was skipped, and what failed
- 🔐 **Private repo support** - Use separate tokens for source repositories
- 🔧 **Composable** - Pairs with `[peter-evans/create-pull-request](https://github.com/peter-evans/create-pull-request)` for PR creation
- 📁 **Glob patterns** - Sync multiple files with patterns like `*.md` or `**/*.yml`

## Inspiration

This project was inspired by `[kbrashears5/github-action-file-sync](https://github.com/kbrashears5/github-action-file-sync)`, which syncs files across repositories using a **push model** — the source repository pushes files to target repositories.

**Boilerplate Sync takes the opposite approach with a pull model:**

| Aspect        | Push Model (file-sync)                         | Pull Model (boilerplate-sync)               |
| ------------- | ---------------------------------------------- | ------------------------------------------- |
| Direction     | Source pushes to targets                       | Targets pull from source                    |
| Control       | Source repo decides what to sync               | Each target repo decides what to sync       |
| Access        | Source needs write access to all targets       | Targets only need read access to source     |
| Configuration | Centralized in source repo                     | Distributed in each target repo             |
| Review        | Changes applied directly or via PR from source | Changes go through PR review in target repo |

The pull model is ideal when:

- Target repos want full control over what they sync and when
- You don't want a central repo with write access to many repositories

The push model is ideal when:

- You want centralized control over what all repos should have
- You need to enforce consistency across many repositories at once

This action is designed as a simpler alternative to templating tools for targeted sets of stable files. It is not intended to be a comprehensive solution for all boilerplate needs. Be aware that it can introduce hidden or circular dependencies and may pose security risks, especially when source repositories are untrusted.

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
| `default_files` | ❌\*     | List of files where local path equals source path. Supports glob patterns (see below)                            |
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

### Glob Patterns

The `default_files` field supports glob patterns for syncing multiple files at once:

| Pattern | Description                        | Example                        |
| ------- | ---------------------------------- | ------------------------------ |
| `*`     | Match any characters except `/`    | `*.md` matches `README.md`     |
| `**`    | Match any characters including `/` | `**/*.ts` matches nested `.ts` |
| `?`     | Match single character             | `file?.ts` matches `file1.ts`  |
| `[abc]` | Match character class              | `[abc].ts` matches `a.ts`      |
| `{a,b}` | Match alternatives                 | `*.{js,ts}` matches both       |

```yaml
sources: |
  - source: my-org/boilerplate
    default_files:
      - .eslintrc.js                      # Exact file
      - .github/ISSUE_TEMPLATE/*.md       # All .md files in directory
      - .github/workflows/*.y{,a}ml       # All workflow YAML files
      - configs/**/*.json                 # Recursive JSON files
```

When a glob pattern matches multiple files, each matched file is synced with `local_path === source_path`.

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
      - uses: actions/checkout@v6
      - name: Sync boilerplate files
        uses: michen00/boilerplate-sync@v1
        id: sync
        with:
          sources: |
            - source: my-org/boilerplate
              default_files:
                - .eslintrc.js  # local and source paths are the same
                - .github/ISSUE_TEMPLATE/*.md  # glob patterns are supported
              file_pairs:  # glob patterns are NOT supported
                - local_path: .github/workflows/ci.yml
                  source_path: workflows/ci.yml
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Create pull request
        uses: peter-evans/create-pull-request@v8
        with:
          branch: boilerplate-sync/${{ github.run_id }}
          title: 'chore: sync boilerplate files'
```

### Private Source Repository

Use a PAT to access private boilerplate repos by specifying `source-token` per source:

```yaml
- uses: michen00/boilerplate-sync@v1
  with:
    sources: |
      - source: my-org/private-boilerplate
        source-token: ${{ secrets.BOILERPLATE_PAT }}
        default_files:
          - .github/workflows/deploy.yml
      - source: my-org/public-boilerplate
        # No source-token needed - uses github-token
        default_files:
          - .*.toml
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Strict Mode

Fail the workflow if any file fails to sync:

```yaml
- uses: michen00/boilerplate-sync@v1
  with:
    sources: |
      - source: my-org/boilerplate
        default_files:
          - .*.yml
    github-token: ${{ secrets.GITHUB_TOKEN }}
    fail-on-error: true
```

### Don't Create Missing Files

Only update files that already exist:

```yaml
- uses: michen00/boilerplate-sync@v1
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
  uses: michen00/boilerplate-sync@v1
  id: sync
  with:
    sources: |
      - source: my-org/boilerplate
        default_files:
          - .reusable-config.yml
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Create pull request
  id: cpr
  uses: peter-evans/create-pull-request@v8
  needs: sync
  with:
    branch: boilerplate-sync/${{ github.run_id }}
    title: 'chore: sync boilerplate files'
    body: |
      ## Boilerplate Sync

      Updated: ${{ steps.sync.outputs.updated-count }}
      Skipped: ${{ steps.sync.outputs.skipped-count }}
      Failed: ${{ steps.sync.outputs.failed-count }}

- name: Log PR URL
  if: steps.sync.outputs.has-changes == 'true'
  needs: sync
  run: echo "PR created at ${{ steps.cpr.outputs.pull-request-url }}"
```

## How It Works

1. **Parse Configuration** - Validates the `sources` input YAML
2. **Fetch Source Files** - Downloads each file from its source repository using the GitHub API
3. **Update or Create** - Updates or creates each file in the workspace
4. **Output Results** - Sets outputs (`has-changes`, counts, summary) for use by subsequent steps

The action writes files directly to the workspace. Use `[peter-evans/create-pull-request](https://github.com/peter-evans/create-pull-request)` or similar to create a PR from the changes.

## Permissions

When using with `[peter-evans/create-pull-request](https://github.com/peter-evans/create-pull-request)`, your workflow needs these permissions:

```yaml
permissions:
  contents: write # To write files and push branches
  pull-requests: write # To create PRs (for peter-evans/create-pull-request)
```

If using a custom `source-token` for private source repositories, ensure the token has `repo` scope.

## Limitations

- Only supports GitHub repositories as sources (other sources are planned for future versions depending on user interest)
- Files are replaced entirely (no partial merge support)
- **No dependency analysis** - The action does not understand relationships between files or detect when syncing one file requires changes to other files
- **No context awareness** - Project-specific customizations may be overwritten without warning

## ⚠️ Important Warning

**Do not use this action for critical files.**

This action performs direct file replacement without understanding:

- Dependencies between files
- Required configuration changes in other files
- Breaking changes that might affect your project
- Context-specific customizations your project may need

**Use with caution.**

Key risks to consider:

- **Hidden dependencies** - Synced files may depend on other files or configurations that aren't explicitly synced, leading to broken or incomplete setups
- **Circular references** - Source repositories that sync from each other can create circular dependencies, causing infinite loops or unexpected behavior
- **Supply chain risks** - Syncing from untrusted or compromised source repositories can introduce broken or malicious code into your project

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
