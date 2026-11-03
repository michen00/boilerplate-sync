# Boilerplate Sync

[![Build Status](https://github.com/michen00/boilerplate-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/michen00/boilerplate-sync/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/michen00/boilerplate-sync?style=plastic)](https://codecov.io/gh/michen00/boilerplate-sync)
[![Release](https://img.shields.io/github/v/release/michen00/boilerplate-sync?style=plastic)](https://github.com/michen00/boilerplate-sync/releases)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=plastic)](CONTRIBUTING.md)
[![License](https://img.shields.io/badge/License-MIT-blue?style=plastic)](LICENSE)

A GitHub Action that keeps your project boilerplate files in sync with another repository.

## Features

- 🔄 **Automatic syncing** - Keep project files up-to-date with boilerplate sources
- 🆕 **Create missing files** - Optionally create new files when boilerplate adds them
- 📊 **Detailed reports** - Step summary shows what changed, what was skipped, and what failed
- 🔐 **Private repo support** - Use separate tokens for source repositories
- 🔧 **Composable** - Pairs with [`peter-evans/create-pull-request`](https://github.com/peter-evans/create-pull-request) for PR creation
- 📁 **Glob patterns** - Sync multiple files with patterns like `*.md` or `**/*.yml`
- 🪝 **Lifecycle hooks** - Check the workspace before a sync, keep local changes to synced files with transforms, and run formatters or tests afterwards

_Note: This action currently cannot sync `.github/workflows/*.y{,a}ml` files without additional permissions ([e.g.](https://github.com/actions/create-github-app-token)) and configuration (see [discussion](https://github.com/orgs/community/discussions/35410))._

In **this repository**, scheduled boilerplate sync workflows use reserved head branch prefixes—`chore/sync-boilerplate/<run_id>` for non-workflow files and `chore/sync-boilerplate-workflows/<run_id>` for workflow copies—so automation can supersede older open PRs in the same stream. Do not use those prefixes for manual branches.

## Inspiration

This project was inspired by [`kbrashears5/github-action-file-sync`](https://github.com/kbrashears5/github-action-file-sync), which syncs files across repositories using a **push model** — the source repository pushes files to target repositories.

**Boilerplate Sync takes the opposite approach with a pull model:**

| Aspect | Push Model (file-sync) | Pull Model (boilerplate-sync) |
| --- | --- | --- |
| Direction | Source pushes to targets | Targets pull from source |
| Control | Source repo decides what to sync | Each target repo decides what to sync |
| Access | Source needs write access to all targets | Targets only need read access to source |
| Configuration | Centralized in source repo | Distributed in each target repo |
| Review | Changes applied directly or via PR from source | Changes go through PR review in target repo |

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
      - uses: actions/checkout@v7

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

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `sources` | ✅ | - | YAML array of source repositories (see below) |
| `github-token` | ✅ | `${{ github.token }}` | Token for accessing source repos |
| `create-missing` | ❌ | `true` | Create project files that don't exist yet |
| `fail-on-error` | ❌ | `false` | Fail the action if any file sync fails |
| `hooks` | ❌ | - | YAML mapping of lifecycle hooks (see [Hooks](#hooks)) |

### Sources Configuration Format

The `sources` array groups files by their source repository. Each source contains:

| Field | Required | Description |
| --- | --- | --- |
| `source` | ✅ | Source repository in `owner/repo` format |
| `ref` | ❌ | Git ref (branch, tag, SHA) - applies to all files from this source. Defaults to the source repo's default branch |
| `source-token` | ❌ | Token for private source repos (falls back to `github-token`) |
| `default_files` | ❌\* | List of files where local path equals source path. Supports glob patterns (see below) |
| `file_pairs` | ❌\* | Array of file mappings with explicit paths (see below) |

\*At least one of `default_files` or `file_pairs` is required per source.

Each file mapping in `file_pairs`:

| Field | Required | Description |
| --- | --- | --- |
| `local_path` | ✅ | Path in your repository to update |
| `source_path` | ❌ | Path to the file in the source repository. Defaults to `local_path` if not specified |

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

| Pattern | Description | Example |
| --- | --- | --- |
| `*` | Match any characters except `/` | `*.md` matches `README.md` |
| `**` | Match any characters including `/` | `**/*.ts` matches nested `.ts` |
| `?` | Match single character | `file?.ts` matches `file1.ts` |
| `[abc]` | Match character class | `[abc].ts` matches `a.ts` |
| `{a,b}` | Match alternatives | `*.{js,ts}` matches both |

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

### Hooks

The optional `hooks` input runs your own commands at three points in a sync. Like `sources`, it is YAML:

```yaml
hooks: |
  pre-sync: test -f .github/boilerplate.lock
  transform:
    package.json: jq -s '.[0] * .[1]' - .github/package.overrides.json
    'docs/*.md': sed 's/upstream-org/our-org/g'
  post-sync:
    - npx prettier --write .
    - npm test
```

| Key | Value | When it runs |
| --- | --- | --- |
| `pre-sync` | A command, or a list of commands | Once, after globs are expanded and every hook is checked, and before any file is fetched |
| `transform` | A map of local path or glob to one command | For each matching file, after the file is fetched and before it is compared with the local file |
| `post-sync` | A command, or a list of commands | Once, after every file has been processed |

Each command runs in bash from the workspace root, the way a `run:` step with `shell: bash` runs it: `bash --noprofile --norc -e -o pipefail`. On Windows the action uses Git for Windows bash, which GitHub-hosted runners include. `pre-sync` and `post-sync` get an empty stdin. A list runs in order and stops at the first command that fails. Quote a key that starts with `*`, as in `'*.md'`, because YAML reads a bare `*` as an alias.

#### Transforms

A transform rewrites a synced file before the action decides whether the file changed:

1. The action fetches the file from its source.
2. The transform command reads the fetched content on stdin and prints the content to keep on stdout.
3. The action compares that output with the local file. If they match, the file is skipped; otherwise the action writes the output.

This lets a repository keep its own changes to a synced file and still receive upstream updates. Once the transformed file is committed, later runs skip it until upstream changes.

A transform:

- runs on every fetch of its file, so it must be deterministic and idempotent: the same input must always give the same output;
- can read the current local file at `$BOILERPLATE_SYNC_LOCAL_PATH`, which has not been overwritten yet; for a file that does not exist yet, `$BOILERPLATE_SYNC_FILE_EXISTS` is `false`;
- fails when it exits non-zero or prints nothing. The file is then reported as failed and left untouched, and `fail-on-error` decides what happens next.

Keys match files by local path, either exactly or as a glob matched the same way as `default_files` globs. A file can match only one key. An exact key that no source syncs is a configuration error, which catches typos.

#### Hook environment variables

| Variable | Set for | Value |
| --- | --- | --- |
| `BOILERPLATE_SYNC_HOOK` | All hooks | `pre-sync`, `transform` or `post-sync` |
| `BOILERPLATE_SYNC_LOCAL_PATH` | `transform` | Path of the file in this repository |
| `BOILERPLATE_SYNC_SOURCE` | `transform` | Source repository, as `owner/repo` |
| `BOILERPLATE_SYNC_SOURCE_PATH` | `transform` | Path of the file in the source repository |
| `BOILERPLATE_SYNC_REF` | `transform` | The configured `ref`, or empty |
| `BOILERPLATE_SYNC_RESOLVED_REF` | `transform` | The ref the file was fetched at |
| `BOILERPLATE_SYNC_FILE_EXISTS` | `transform` | `true` or `false` |
| `BOILERPLATE_SYNC_HAS_CHANGES` | `post-sync` | `true` or `false`, so that `post-sync` can skip work when nothing changed |

#### Hook failures

- **`pre-sync` fails:** the action fails before fetching any file. No file is written and no output is set.
- **A transform fails:** the file is reported as failed and left untouched (see [Transforms](#transforms)).
- **`post-sync` fails:** the action fails, whatever `fail-on-error` is set to. The step summary and outputs are written first, so a later step with `if: always()`, or a step marked `continue-on-error`, can still use them. `post-sync` does not run when `fail-on-error` is `true` and a file failed.

`has-changes` and the counts describe synced files after transforms. They do not include changes that `post-sync` makes, such as files a formatter rewrites. To detect those, run `git status --porcelain` in a later step.

#### Hook security

Hooks run arbitrary commands, so only the workflow that uses this action can configure them; synced content cannot. The action also:

- removes every `INPUT_*` and `ACTIONS_*` variable, and `GITHUB_OUTPUT` and `GITHUB_STATE`, from each hook's environment, so no hook receives `github-token`, any `source-token` or the runner's own tokens through it;
- rejects a hook command that names a file this action syncs, because the source repository would then control code that runs in this step. With `scripts/merge.sh` synced, that rejects `bash scripts/merge.sh`, an unquoted glob that expands to it such as `bash scripts/*.sh`, and the same commands inside a `bash -c` or `eval` string. The check runs against every synced path, glob-expanded ones included, before any hook runs, `pre-sync` included. When hooks are set, a `default_files` glob that fails to expand or matches no file stops the action before any hook runs, because the hooks cannot be checked against the files it syncs.

The second check covers what a command names, not what it runs indirectly. It does not resolve variables, and a command can still run synced code through another program: `npm test` runs scripts from a synced `package.json`, and `make` reads a synced `Makefile`. That code runs before anyone reviews the pull request. When synced files define your tests, run the tests in the pull request's CI instead of in `post-sync`. Never put a token in the step's `env:` when you use hooks, because hooks inherit it.

The action controls only the hook's environment, not the workspace it runs in. By default `actions/checkout` saves its token in the repository's `.git/config`, where any hook, or synced code a hook runs, can read it with `git config --get-regex extraheader`. When you use hooks, set `persist-credentials: false` on the checkout step, and give any later step that pushes its own token:

```yaml
- uses: actions/checkout@v7
  with:
    persist-credentials: false
```

## Outputs

| Output | Type | Description |
| --- | --- | --- |
| `has-changes` | `string` | `"true"` if any files were updated or created, `"false"` otherwise. Always set. |
| `updated-count` | `string` | Number of files updated or created. Always set. |
| `failed-count` | `string` | Number of files that failed to sync. Always set. |
| `skipped-count` | `string` | Number of files skipped (unchanged, or missing when create-missing is disabled). Always set. |
| `summary` | `JSON` | Full sync summary with details on each file. Always set. |

## Examples

### Real Working Example

This repository includes real, working example workflows that sync multiple files from a [template repository for Python projects](https://github.com/michen00/template):

- [`.github/workflows/sync-template-non-workflow.yml`](.github/workflows/sync-template-non-workflow.yml) — syncs non-workflow files.
- [`.github/workflows/sync-template-github-workflows.yml`](.github/workflows/sync-template-github-workflows.yml) — syncs `.github/workflows/*` files (requires additional permissions, as noted above).

You can copy a workflow file and adapt it for your own needs. Simply modify the `sources` configuration to point to your template repository and add or remove files as needed. Note that these workflows also include repo-local steps (for example, the `./.github/actions/supersede-boilerplate-prs` action) that do not exist outside this repository — remove or replace those steps when adapting a workflow for your own project.

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
      - uses: actions/checkout@v7
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
  if: steps.sync.outputs.has-changes == 'true'
  uses: peter-evans/create-pull-request@v8
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
  run: echo "PR created at ${{ steps.cpr.outputs.pull-request-url }}"
```

## How It Works

1. **Parse Configuration** - Validates the `sources` and `hooks` inputs
2. **Run `pre-sync`** - Runs the `pre-sync` hook, if configured
3. **Fetch Source Files** - Downloads each file from its source repository using the GitHub API
4. **Transform** - Runs the matching `transform` hook, if any, on each fetched file
5. **Update or Create** - Updates or creates each file whose content differs from the workspace
6. **Output Results** - Sets outputs (`has-changes`, counts, summary) for use by subsequent steps
7. **Run `post-sync`** - Runs the `post-sync` hook, if configured

The action writes files directly to the workspace. Use [`peter-evans/create-pull-request`](https://github.com/peter-evans/create-pull-request) or similar to create a PR from the changes.

## Permissions

When using with [`peter-evans/create-pull-request`](https://github.com/peter-evans/create-pull-request), your workflow needs these permissions:

```yaml
permissions:
  contents: write # To write files and push branches
  pull-requests: write # To create PRs (for peter-evans/create-pull-request)
```

If using a custom `source-token` for private source repositories, ensure the token has `repo` scope.

## Security

Release tags (`vX.Y.Z`) are protected by a tag ruleset covering `refs/tags/v*.*.*`: `update` and `deletion` are blocked, so once published they are immutable. They are annotated but **unsigned**. The `v1` alias is deliberately outside that ruleset and movable (it tracks the latest `v1.x` release) and is created by the release automation, not by hand. Integrity for the consumed artifact comes from SLSA build provenance, verifiable with `gh attestation verify dist/index.js --repo michen00/boilerplate-sync`. Pin the action to a full commit SHA if your threat model includes compromise of this repository:

```yaml
- uses: michen00/boilerplate-sync@71ae697d460e162da329f3d9b8b35e747db11fb4 # v1.0.5
```

Report vulnerabilities privately via [GitHub security advisories](https://github.com/michen00/boilerplate-sync/security/advisories/new) — see [SECURITY.md](SECURITY.md). This is a personal project maintained on a best-effort basis.

## Limitations

- Only supports GitHub repositories as sources (other sources are planned for future versions depending on user interest)
- Files are replaced entirely, unless a [`transform` hook](#transforms) rewrites them
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

## Documentation [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/michen00/boilerplate-sync)

- [CONTRIBUTING.md](CONTRIBUTING.md) — asking a question, reporting a bug, suggesting an enhancement, and making a first code contribution
- [SECURITY.md](SECURITY.md) — supported versions, reporting a vulnerability privately, and guidance for consumers
- [CHANGELOG.md](CHANGELOG.md) — release history
