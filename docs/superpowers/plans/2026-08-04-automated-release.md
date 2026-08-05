<!-- markdownlint-configure-file { "no-duplicate-heading": false } -->

# Automated Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five-step manual release with release-please maintaining a single release PR, plus a workflow job that creates the annotated tag, moves the `v1` alias, and publishes the GitHub Release.

**Architecture:** `release-please-action@v4` runs on every push to `main` in PR-only mode (`skip-github-release: true`), maintaining one open `chore(main): release X.Y.Z` PR. Merging that PR is the only human step. A later step in the same workflow compares `.release-please-manifest.json` against existing tags; when the manifest is ahead, it creates an annotated tag, force-moves the major alias, and publishes the release with notes sliced out of `CHANGELOG.md`.

**Tech Stack:** GitHub Actions, `googleapis/release-please-action@v4`, `actions/create-github-app-token@v3`, `gh` CLI, `jq`, `awk`, pre-commit (prettier / markdownlint / actionlint / yamllint / gitlint).

**Spec:** `docs/superpowers/specs/2026-08-04-automated-release-design.md`

## Global Constraints

- **Repo:** `michen00/boilerplate-sync`. Default branch `main`.
- **Commit titles must be ≤50 characters.** gitlint enforces `title-max-length: 50` and it is a pre-commit hook — a 51-character title aborts the commit. Body lines must be ≤72 characters.
- **Conventional commits required.** gitlint validates the type.
- **Never bypass hooks.** Do not use `--no-verify` or `core.hooksPath=/dev/null`. If a hook modifies files, re-stage and re-commit.
- **App credentials already exist:** `vars.APP_ID` = `3959221`, `secrets.APP_PRIVATE_KEY`. Do not create new secrets.
- **`dist/` does not embed the version** and `action.yml` has no version field, so no release step rebuilds `dist/`.
- **Do not modify `michen00/template`.** Only `scripts/update-unreleased.sh` is synced from it; the fix is to stop syncing it, locally.
- **Do not alter existing tags or GitHub Releases.** `1.0.0`–`1.0.4` stay exactly as published.
- Work on a branch off `main`; never commit directly to `main`.

---

## File Structure

| File                                               | Responsibility                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `.github/workflows/release.yml`                    | The whole release pipeline: PR maintenance, tag, publish            |
| `release-please-config.json`                       | Which release type and packages release-please manages              |
| `.release-please-manifest.json`                    | Current released version; the tag job's source of truth             |
| `CHANGELOG.md`                                     | Regenerated in release-please format; also the release-notes source |
| `.prettierignore`                                  | Exempts `CHANGELOG.md` from prettier                                |
| `.github/workflows/sync-template-non-workflow.yml` | Stops pulling `update-unreleased.sh` from template                  |
| `Makefile`                                         | Loses the now-dead `release` target                                 |

Note on testing style: this change is workflow and configuration, not library code, so there is no unit-test harness to drive. Each task below still ends with a concrete, runnable verification — pre-commit hooks, `actionlint`, a `release-please --dry-run` against real history, or shell logic exercised locally against fixtures. Treat those as the test cycle.

---

### Task 1: Exempt `CHANGELOG.md` from formatting hooks and regenerate it

This must land before release-please runs, because otherwise its first PR fails the required `Pre-commit hooks` check.

**Files:**

- Modify: `.prettierignore`
- Modify: `CHANGELOG.md` (complete rewrite)

**Interfaces:**

- Consumes: nothing.
- Produces: `CHANGELOG.md` sections shaped `## [X.Y.Z](compare-url) (YYYY-MM-DD)`, which Task 4's `awk` slice matches via the literal prefix `## [X.Y.Z]`.

- [ ] **Step 1: Reproduce the failure first**

Confirm the hooks really do rewrite release-please's format, so you know the fix is load-bearing. Write a scratch file in release-please's style and run the hooks on it:

```bash
printf '# T\n\n## [1.0.5](https://example.com) (2026-08-05)\n\n\n### Bug Fixes\n\n* a thing ([abc1234](https://example.com))\n' > /tmp/rp-probe.md
cp /tmp/rp-probe.md /tmp/rp-probe.orig.md
npx --yes prettier@3 --write /tmp/rp-probe.md
diff /tmp/rp-probe.orig.md /tmp/rp-probe.md
```

Expected: `diff` reports changes — the two blank lines collapse to one and `*` becomes `-`. This is the blocker.

- [ ] **Step 2: Add `CHANGELOG.md` to `.prettierignore`**

The file currently contains only `dist`. Append the entry with a comment explaining why, since a bare filename in an ignore file invites someone to "tidy" it away later:

```text
dist

# release-please owns CHANGELOG.md and emits `*` bullets plus two blank lines
# after each heading. prettier collapses both, and a hook that modifies a file
# fails -- which would break the required Pre-commit hooks check on every
# release PR. prettier does not read markdownlint-configure-file directives, so
# the directive at the top of CHANGELOG.md does not cover this.
CHANGELOG.md
```

- [ ] **Step 3: Rewrite `CHANGELOG.md` in full**

Replace the entire file with exactly this. The markdownlint directive on line 1 gains two rules (`ul-style`, `no-multiple-blanks`) beyond the `no-duplicate-heading` it already suppressed.

Ordering within each section is scope-then-subject (unscoped entries first, then scopes alphabetically), matching conventional-changelog's default `commitsSort`. Byte-identical reproduction of a hypothetical release-please run is not the goal — format consistency going forward is.

```markdown
<!-- markdownlint-configure-file { "no-duplicate-heading": false, "ul-style": false, "no-multiple-blanks": false } -->

# Changelog

All notable changes will be documented in this file. See [conventional commits](https://www.conventionalcommits.org) for commit guidelines.

The format is based on [Keep a Changelog](https://keepachangelog.com) and this project adheres to [Semantic Versioning](https://semver.org).

## [1.0.4](https://github.com/michen00/boilerplate-sync/compare/v1.0.3...v1.0.4) (2026-06-10)

### Bug Fixes

- **sync:** reject globs in file_pairs sources ([#120](https://github.com/michen00/boilerplate-sync/issues/120)) ([8d0f88d](https://github.com/michen00/boilerplate-sync/commit/8d0f88d0b39b66b59500e14a3ef9f24268695a27))

## [1.0.1](https://github.com/michen00/boilerplate-sync/compare/v1.0.0...v1.0.1) (2026-06-09)

### Features

- **ci:** push dist commits via GitHub App token ([#96](https://github.com/michen00/boilerplate-sync/issues/96)) ([64750e0](https://github.com/michen00/boilerplate-sync/commit/64750e0e550788d1b4b59d8db80836140b41e645))

### Bug Fixes

- resolve post-merge review findings ([#109](https://github.com/michen00/boilerplate-sync/issues/109)) ([683564f](https://github.com/michen00/boilerplate-sync/commit/683564ff069e2f7b8d0434a151c3262ec69a0128))
- sweep unresolved review threads from #64-#96 ([#97](https://github.com/michen00/boilerplate-sync/issues/97)) ([9f7f96d](https://github.com/michen00/boilerplate-sync/commit/9f7f96d4244e4883ff4caf741b6e045bb9f55ed3))

## 1.0.0 (2026-06-04)

### ⚠ BREAKING CHANGES

- remove PR functions
- remove unused config
- simplify config

### Features

- add boilerplate ([02052a8](https://github.com/michen00/boilerplate-sync/commit/02052a800e1ad805bd986c0150d0919d41aec327))
- add glob pattern support for default_files ([c9359cd](https://github.com/michen00/boilerplate-sync/commit/c9359cd89d4bc296377815723c97b16374f07182))
- implement boilerplate-sync GitHub Action ([1ce78a6](https://github.com/michen00/boilerplate-sync/commit/1ce78a639458ca47e78eaf18755a93a616167a10))
- remove PR functions ([628239d](https://github.com/michen00/boilerplate-sync/commit/628239d6fe263590165b14e8fc66b6e78c8e19f4))
- remove unused config ([9a32aed](https://github.com/michen00/boilerplate-sync/commit/9a32aede9fb969fdac3ab165c48cfa661fc151cc))
- simplify config ([ec19e37](https://github.com/michen00/boilerplate-sync/commit/ec19e3794466d2b09949049b972cb63cb7501d58))
- supersede pending PRs ([#64](https://github.com/michen00/boilerplate-sync/issues/64)) ([d54489b](https://github.com/michen00/boilerplate-sync/commit/d54489b99eb0b0d9442aaaae1fa299bdd30485e4))

### Bug Fixes

- add missing composite ([de0b167](https://github.com/michen00/boilerplate-sync/commit/de0b1673b9c46e5c233c1c2a8a4e31ee16b98f25))
- **action.yml:** escape the dollar sign ([9e27ec9](https://github.com/michen00/boilerplate-sync/commit/9e27ec97afeb16eee93926fefebc1aca32aebcfa))
- **ci:** repair bot-automerge dist commit flow ([#92](https://github.com/michen00/boilerplate-sync/issues/92)) ([9e29a74](https://github.com/michen00/boilerplate-sync/commit/9e29a74ee26b003e0efe02ba0154f280bfe6c817))
- **ci:** tolerate check-run lag after CI dispatch ([#94](https://github.com/michen00/boilerplate-sync/issues/94)) ([e644bad](https://github.com/michen00/boilerplate-sync/commit/e644bad4059d0ceb22cef24d5e1d616ebf0b714a))
```

`1.0.2` and `1.0.3` are intentionally absent — those ranges contained only `chore`/`ci`/`docs` commits, so release-please would never have produced sections for them. Their tags and GitHub Releases are untouched.

`1.0.0` has no compare link because there is no prior tag to compare against.

- [ ] **Step 4: Verify the hooks now leave the file alone**

Run: `pre-commit run --files CHANGELOG.md .prettierignore`

Expected: every hook `Passed` or `Skipped`. Specifically `prettier` must not report "files were modified by this hook". If it does, `.prettierignore` is not taking effect — confirm the entry is `CHANGELOG.md` with no leading slash and that you are running from the repo root.

- [ ] **Step 5: Verify the file is unchanged on disk**

Run: `git diff --stat CHANGELOG.md`

Expected: the diff reflects only your rewrite. If line counts shifted beyond your edit, a hook rewrote it — go back to Step 4.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md .prettierignore
git commit -m "docs(changelog): adopt release-please format" -m "Regenerate CHANGELOG.md in release-please's format so future generated
sections match the existing ones, and exempt the file from prettier.

prettier collapses the two blank lines release-please emits after each
heading and rewrites its * bullets. A hook that modifies a file fails,
so without this every release PR breaks the required Pre-commit hooks
check. prettier ignores markdownlint directives, hence .prettierignore."
```

---

### Task 2: Add release-please configuration

**Files:**

- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`

**Interfaces:**

- Consumes: nothing.
- Produces: `.release-please-manifest.json` with a single `"."` key whose value is the released version string (e.g. `"1.0.4"`). Task 4 reads it with `jq -r '.["."] // empty'`.

- [ ] **Step 1: Create `release-please-config.json`**

Keep it minimal. `release-type: node` bumps `package.json` and `package-lock.json`. Author attribution is deliberately omitted so generated sections match the historical ones written in Task 1.

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "packages": {
    ".": {
      "release-type": "node"
    }
  }
}
```

- [ ] **Step 2: Create `.release-please-manifest.json`**

Seed at the current released version so release-please computes `1.0.5` next rather than restarting from zero:

```json
{
  ".": "1.0.4"
}
```

- [ ] **Step 3: Verify manifest mode reads the config**

This is the real test of this task. Run the dry run **without** `--release-type`, so it must load `release-please-config.json`:

```bash
npx --yes release-please@latest release-pr --dry-run \
  --repo-url=michen00/boilerplate-sync \
  --token="$(gh auth token)" 2>&1 | head -30
```

Expected: `Would open 1 pull requests`, title `chore(main): release 1.0.5`, and a body whose only entry is the undici fix (`#168`). If it instead proposes `1.0.0` or errors about a missing manifest, the config file is not being found — check the filenames are exactly as above at the repo root.

Why `--release-type` is omitted: in `release-please-action@v4`, setting `release-type` makes `loadOrBuildManifest` call `Manifest.fromConfig` and **never read the config file**. Passing it here would test the wrong code path.

- [ ] **Step 4: Verify the JSON is valid and formatted**

Run: `pre-commit run --files release-please-config.json .release-please-manifest.json`

Expected: `check-json` Passed, `prettier` Passed without modifying files. If prettier rewrites them, commit its version.

- [ ] **Step 5: Commit**

```bash
git add release-please-config.json .release-please-manifest.json
git commit -m "ci(release): add release-please config" -m "Manifest mode, seeded at the current released version so the next
computed release is 1.0.5 rather than a restart from zero.

release-type lives in the config file, not as an action input: setting
the input makes the action build config inline and never read the file."
```

---

### Task 3: Add the release workflow's PR-maintenance job

Split from Task 4 so a reviewer can accept the PR-maintenance half — which is safe and reversible — independently of the tag-and-publish half, which writes tags.

**Files:**

- Create: `.github/workflows/release.yml`

**Interfaces:**

- Consumes: `release-please-config.json` and `.release-please-manifest.json` from Task 2.
- Produces: a job named `release` with a step `id: app-token` exposing `steps.app-token.outputs.token`, which Task 4's steps reuse.

- [ ] **Step 1: Create the workflow**

```yaml
---
name: Release

# release-please maintains a single release PR (version bump + CHANGELOG +
# manifest). Merging that PR is the only human step in a release.
#
# Tagging and publishing live here rather than in release-please because it
# publishes via POST /releases, which mints a *lightweight* tag -- verified
# across googleapis/release-please, release-please-action and nodejs-storage.
# We want an annotated tag, and we need to move the vN alias in the same pass.
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write
  actions: write # to dispatch readme-action-versions.yml after publishing

# Never cancel in progress: a run killed between the tag push and the release
# creation would leave a tag with no release behind it. Queue instead.
concurrency:
  group: release
  cancel-in-progress: false

env:
  # secrets aren't allowed in if: expressions (actionlint enforces it);
  # hoist presence here.
  APP_KEY_SET: ${{ secrets.APP_PRIVATE_KEY != '' }}

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      # Fail loudly rather than falling back to GITHUB_TOKEN. Other workflows
      # here degrade gracefully because their PRs can still be merged by hand,
      # but a release PR opened by GITHUB_TOKEN gets no check runs at all, and
      # main-protect requires three -- so it could never be merged by anyone.
      # An immediate error beats a permanently stuck PR. Mirrors the guard in
      # app-token-check.yml.
      - name: Require the App credential
        env:
          APP_ID: ${{ vars.APP_ID }}
        run: |
          if [ -z "$APP_ID" ] || [ "$APP_KEY_SET" != "true" ]; then
            echo "::error::Set vars.APP_ID and secrets.APP_PRIVATE_KEY first."
            echo "::error::A release PR opened by GITHUB_TOKEN receives no"
            echo "::error::check runs and can never satisfy main-protect."
            exit 1
          fi

      # App token, not GITHUB_TOKEN. PRs opened by GITHUB_TOKEN do not trigger
      # workflows, and main-protect requires Pre-commit hooks / build /
      # test-action -- so a GITHUB_TOKEN release PR would sit with no checks
      # reported and could never be merged.
      # No `if:` guard and no GITHUB_TOKEN fallback below -- the step above
      # already failed the job if the credential is missing, so a fallback
      # would only be dead code that misleads the next reader.
      - name: Mint app token
        id: app-token
        uses: actions/create-github-app-token@v3
        with:
          app-id: ${{ vars.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}

      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # tags are needed by the idempotency check
          token: ${{ steps.app-token.outputs.token }}

      - name: Maintain the release PR
        uses: googleapis/release-please-action@v4
        with:
          token: ${{ steps.app-token.outputs.token }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
          # We tag and publish ourselves; see the header comment.
          skip-github-release: true
```

- [ ] **Step 2: Verify the workflow lints**

Run: `pre-commit run --files .github/workflows/release.yml`

Expected: `actionlint`, `yamllint`, `prettier`, `Validate GitHub Workflows` all Passed. Two failures to expect if you deviated: yamllint caps lines at 100 characters, and actionlint rejects `secrets.*` inside `if:` (which is why `APP_KEY_SET` is hoisted into `env`).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): maintain a release PR" -m "release-please in PR-only mode. Merging the PR it maintains becomes the
single human step in cutting a release.

Uses the App token rather than GITHUB_TOKEN: PRs opened by GITHUB_TOKEN
do not trigger workflows, and main-protect requires status checks, so
such a PR could never satisfy them."
```

---

### Task 4: Tag, publish, and refresh README pins

**Files:**

- Modify: `.github/workflows/release.yml` (append steps to the `release` job)

**Interfaces:**

- Consumes: `steps.app-token.outputs.token` from Task 3; `.release-please-manifest.json` from Task 2; the `## [X.Y.Z]` heading shape from Task 1.
- Produces: annotated tags `vX.Y.Z` and `vN`, plus a published GitHub Release. `release-provenance.yml` already listens for `release: published`.

- [ ] **Step 1: Verify the notes-extraction logic against the real changelog**

Prove the `awk` slice works before embedding it. Run this against the file Task 1 produced:

```bash
VERSION=1.0.4
awk -v needle="## [${VERSION}]" '
  index($0, needle) == 1 { inside = 1; next }
  inside && /^## / { exit }
  inside { print }
' CHANGELOG.md
```

Expected: the `### Bug Fixes` heading and the single `**sync:**` bullet for `#120`, and nothing from `1.0.1`. A literal `index(...) == 1` prefix test is used rather than a regex so the version's dots need no escaping.

- [ ] **Step 2: Verify it fails closed on a missing version**

```bash
VERSION=9.9.9
awk -v needle="## [${VERSION}]" '
  index($0, needle) == 1 { inside = 1; next }
  inside && /^## / { exit }
  inside { print }
' CHANGELOG.md | wc -c
```

Expected: `0`. The workflow step below turns that empty result into a hard failure rather than publishing an empty release.

- [ ] **Step 3: Append the tag and publish steps**

Add these to the end of the `release` job, after the "Maintain the release PR" step:

```yaml
- name: Decide whether a tag is due
  id: due
  run: |
    VERSION=$(jq -r '.["."] // empty' .release-please-manifest.json)
    if [ -z "$VERSION" ]; then
      echo "::error::no '.' version in .release-please-manifest.json"
      exit 1
    fi
    echo "version=$VERSION" >> "$GITHUB_OUTPUT"
    echo "major=${VERSION%%.*}" >> "$GITHUB_OUTPUT"
    # Keyed on manifest-vs-tag rather than the release PR's title, so
    # re-runs and workflow_dispatch are both safe and we do not depend on
    # release-please's "chore(main): release X" convention holding.
    if git rev-parse -q --verify "refs/tags/v${VERSION}" > /dev/null; then
      echo "::notice::v${VERSION} is already tagged; nothing to release."
      echo "due=false" >> "$GITHUB_OUTPUT"
    else
      echo "::notice::v${VERSION} is not tagged yet; releasing."
      echo "due=true" >> "$GITHUB_OUTPUT"
    fi

- name: Extract release notes
  if: steps.due.outputs.due == 'true'
  env:
    VERSION: ${{ steps.due.outputs.version }}
  run: |
    # Literal prefix match, so the version's dots need no escaping.
    awk -v needle="## [${VERSION}]" '
      index($0, needle) == 1 { inside = 1; next }
      inside && /^## / { exit }
      inside { print }
    ' CHANGELOG.md > release-notes.md
    if [ ! -s release-notes.md ]; then
      echo "::error::no '## [${VERSION}]' section found in CHANGELOG.md"
      exit 1
    fi
    echo '::group::release notes'
    cat release-notes.md
    echo '::endgroup::'

- name: Tag the release and move the major alias
  if: steps.due.outputs.due == 'true'
  env:
    VERSION: ${{ steps.due.outputs.version }}
    MAJOR: ${{ steps.due.outputs.major }}
  run: |
    git config user.name 'github-actions[bot]'
    git config user.email \
      '41898282+github-actions[bot]@users.noreply.github.com'
    git tag -a "v${VERSION}" -m "Release v${VERSION}"
    # The alias is a moving pointer by design. refs/tags/vN sits outside
    # release-tags-protect, which covers refs/tags/v*.*.* only -- two
    # literal dots, which vN can never match.
    git tag -f -a "v${MAJOR}" -m "Alias for v${VERSION}"
    git push origin "refs/tags/v${VERSION}"
    git push --force origin "refs/tags/v${MAJOR}"

- name: Publish the GitHub release
  if: steps.due.outputs.due == 'true'
  env:
    # App token, not GITHUB_TOKEN: a release created by GITHUB_TOKEN does
    # not emit release:published, so release-provenance.yml would silently
    # stop attesting dist/index.js with no error anywhere.
    GH_TOKEN: ${{ steps.app-token.outputs.token }}
    VERSION: ${{ steps.due.outputs.version }}
  run: |
    # --verify-tag refuses to invent a lightweight tag if the push above
    # did not land.
    gh release create "v${VERSION}" \
      --title "v${VERSION}" \
      --notes-file release-notes.md \
      --verify-tag

# README pins a release SHA in its Security example. That workflow runs on
# a Monday cron, so without this nudge the example lags a release by up to
# a week.
# Cosmetic, so never fail a published release over it: if the App lacks
# Actions:write this step errors and the release still stands.
- name: Refresh README version pins
  if: steps.due.outputs.due == 'true'
  continue-on-error: true
  env:
    GH_TOKEN: ${{ steps.app-token.outputs.token }}
  run: gh workflow run readme-action-versions.yml
```

- [ ] **Step 4: Verify the workflow still lints**

Run: `pre-commit run --files .github/workflows/release.yml`

Expected: all Passed. `shellcheck` does not inspect `run:` blocks, but `actionlint` does run shellcheck over them — if it complains about `SC2086` on `$VERSION`, note the values are already quoted; do not add braces-only changes that break the heredoc-free style.

- [ ] **Step 5: Confirm the idempotency guard reads correctly**

Simulate both branches locally against the real manifest and tags:

```bash
VERSION=$(jq -r '.["."] // empty' .release-please-manifest.json)
echo "manifest=$VERSION major=${VERSION%%.*}"
git rev-parse -q --verify "refs/tags/v${VERSION}" > /dev/null \
  && echo "due=false (expected: v1.0.4 exists)" \
  || echo "due=true"
```

Expected: `manifest=1.0.4 major=1` and `due=false`, because `v1.0.4` is already tagged. This is exactly the no-op path every non-release push takes.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): tag and publish releases" -m "Create the annotated tag, move the major alias, and publish the release
with notes sliced out of CHANGELOG.md.

Keyed on manifest-version-vs-tag-existence rather than the release PR's
title, so re-runs and workflow_dispatch are safe. Publishes with the App
token so release:published fires and release-provenance.yml still
attests dist/index.js."
```

---

### Task 5: Remove the git-cliff changelog machinery

**Files:**

- Delete: `cliff.toml`
- Delete: `.github/workflows/changelog-autoupdate.yml`
- Delete: `scripts/update-unreleased.sh`
- Modify: `.github/workflows/sync-template-non-workflow.yml` (drop one list entry)
- Modify: `Makefile` (drop the `release` target)

**Interfaces:**

- Consumes: nothing.
- Produces: nothing. This task only removes superseded code.

- [ ] **Step 1: Delete the three superseded files**

```bash
git rm cliff.toml .github/workflows/changelog-autoupdate.yml scripts/update-unreleased.sh
```

- [ ] **Step 2: Stop syncing the deleted script from template**

In `.github/workflows/sync-template-non-workflow.yml`, remove the single line from the `default_files` list:

```yaml
- scripts/update-unreleased.sh
```

Leave the other four entries (`.editorconfig`, `.gitlint`, `.markdownlint.yml`, `.prettierrc`) alone. **This edit is mandatory** — without it the next sync run re-creates the file you just deleted. `michen00/template` is not modified; its copy of the script and its 28-test suite stay where they are.

- [ ] **Step 3: Retire the `Makefile` release target**

Delete this block from `Makefile`:

```make
.PHONY: release
release: ## Create a GitHub release (VERSION=vX.Y.Z)
 @if [ -z "$(VERSION)" ]; then echo "Usage: make release VERSION=vX.Y.Z"; exit 1; fi
 @git rev-parse --verify refs/tags/$(VERSION) >/dev/null 2>&1 || { echo "Error: Tag $(VERSION) does not exist"; exit 1; }
 gh release create $(VERSION) --generate-notes
```

- [ ] **Step 4: Verify nothing still references the removed files**

```bash
grep -rn "cliff\|update-unreleased\|changelog-autoupdate" \
  --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist \
  --exclude-dir=docs . || echo "no references remain"
```

Expected: `no references remain`. `docs/` is excluded because the spec and this plan discuss the removal by name. If anything else matches — `README.md`, `CLAUDE.md`, another workflow — update it in this task.

- [ ] **Step 5: Verify `make release` is gone and the rest of the Makefile works**

```bash
make release 2>&1 | head -3
make help | grep -c release
```

Expected: the first reports no rule to make target `release`; the second prints `0`.

- [ ] **Step 6: Run the full check suite**

Run: `make check`

Expected: pre-commit, lint, type-check, and all 99 tests pass. Nothing in `src/` changed, so a test failure here means something unrelated broke — investigate before continuing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "ci: drop git-cliff changelog machinery" -m "release-please owns CHANGELOG.md now, so the weekly cliff autoupdate,
its config, and the update-unreleased helper are all dead code.

Also drops the script from the template sync list -- without that the
next sync run would re-create the file. michen00/template is unchanged.
The manual make release target goes too; releases are automated."
```

---

### Task 6: Rescope the tag ruleset and verify the first real release

The ruleset change is the one step automation cannot perform for itself, and nothing works until it lands.

**Files:** none — repository settings plus verification.

**Interfaces:**

- Consumes: everything from Tasks 1–5, merged to `main`.
- Produces: a published `v1.0.5` release.

- [ ] **Step 1: Open the PR and get it merged**

```bash
git push -u origin HEAD
gh pr create --fill --base main
```

Wait for `Pre-commit hooks`, `build`, and `test-action` to pass. The `Pre-commit hooks` check is the one that would have caught a `.prettierignore` mistake from Task 1.

- [ ] **Step 2: Rescope `release-tags-protect` (human step)**

This requires admin rights. `PUT` replaces a ruleset wholesale, so every field is restated:

```bash
gh api -X PUT repos/michen00/boilerplate-sync/rulesets/17255321 --input - <<'JSON'
{
  "name": "release-tags-protect",
  "target": "tag",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/v*.*.*"], "exclude": [] } },
  "rules": [ { "type": "update" }, { "type": "deletion" } ],
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ]
}
JSON
```

- [ ] **Step 3: Verify the ruleset took**

```bash
gh api repos/michen00/boilerplate-sync/rulesets/17255321 \
  --jq '{include: .conditions.ref_name.include, rules: [.rules[].type]}'
```

Expected exactly: `{"include":["refs/tags/v*.*.*"],"rules":["update","deletion"]}`. If `creation` or `required_signatures` still appear, the `PUT` did not apply and tag creation will fail in Step 5.

- [ ] **Step 4: Confirm release-please opens its PR**

After the branch merges, the `Release` workflow runs on the push to `main`.

```bash
gh run list --workflow=release.yml --limit 3
gh pr list --search 'chore(main): release'
```

Expected: one open PR titled `chore(main): release 1.0.5`, bumping `package.json` and `package-lock.json` to `1.0.5` and adding a `## [1.0.5]` section. Confirm its checks report — if they are absent, the App token did not mint and the PR was opened by `GITHUB_TOKEN`.

- [ ] **Step 5: Approve and merge the release PR**

This is the human touchpoint the whole design exists to preserve. Review the version and notes, then merge.

- [ ] **Step 6: Verify the release end to end**

```bash
gh release view v1.0.5 --json tagName,publishedAt,body
# annotated, not lightweight:
gh api repos/michen00/boilerplate-sync/git/ref/tags/v1.0.5 --jq .object.type
# alias moved to the same commit:
git fetch --tags --force
test "$(git rev-list -n1 v1)" = "$(git rev-list -n1 v1.0.5)" \
  && echo "v1 alias correct" || echo "v1 alias WRONG"
# provenance fired:
gh run list --workflow=release-provenance.yml --limit 2
```

Expected: the release exists with notes matching the changelog section; `object.type` is `tag` (annotated — `commit` would mean a lightweight tag slipped through, so `--verify-tag` did not protect you); the alias check prints `v1 alias correct`; and a `release-provenance` run was triggered by `release: published`.

- [ ] **Step 7: Verify the attestation**

```bash
gh attestation verify dist/index.js --repo michen00/boilerplate-sync
```

Expected: verification succeeds. This is the integrity property the design deliberately preserved in place of tag signatures — if it fails, the release was published by `GITHUB_TOKEN` and the `release: published` event never fired.

- [ ] **Step 8: Confirm the no-op path**

Push any `chore`/`ci`/`docs` change to `main` (or wait for a dependabot merge) and check that no release PR appears.

```bash
gh run list --workflow=release.yml --limit 1
gh pr list --search 'chore(main): release'
```

Expected: the run succeeds and no release PR exists. Verified in advance against 27 real commits — `chore`, `ci`, `build(deps)`, `docs`, and `test` are all non-releasable, so dependabot bumps will not prompt releases.

---

## Notes for the implementer

- **Task order matters for Tasks 1 → 2 → 3 → 4.** Task 1 must precede any release-please run, or the first release PR fails the required formatting check. Task 5 can move earlier if convenient; it has no dependencies.
- **The one thing you cannot do yourself** is Step 2 of Task 6. If you lack admin rights, stop and hand that step back.
- **If a commit is rejected by gitlint for title length,** shorten to ≤50 characters rather than reformatting the body. This happened repeatedly while writing the spec; 51 characters is a hard failure.
- **If prettier or markdownlint reports "files were modified by this hook,"** that is a failure, not a warning. Re-stage the modified file and commit again.
