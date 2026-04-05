---
name: atomic-commits
description: >-
  Analyzes current unstaged and staged work, groups changes by logical
  concern, plans a dependency-aware commit sequence, writes
  gitlint-compliant messages, and executes atomic commits that each
  leave the codebase in a good state.
---

<!-- This file uses manual wrapping at 72 characters; never split
formatting markup (e.g. keep `**bold**` or `_italic_` on one line). -->

# Atomic Commits

Bundle working-tree changes into a series of atomic, self-consistent
commits. Each commit addresses exactly one logical concern and passes
verification, so the history reads as a clean narrative.

**Critical rules:** (1) Generated or derived files must be committed in the _same_ commit as
the source that produced them — never separately. (2) Present the
planned commit sequence to the user before executing. (3) Use specific
file paths for `git add` — never `git add -A` or `git add .`. (4)
Every commit must be signed; do not use `--no-gpg-sign`. (5) If
grouping is ambiguous or multiple concerns are intertwined, ask the
user rather than guessing.

## When to Use

- Multiple unrelated changes accumulated in the working tree (feature +
  fix + docs, etc.)
- Generated/derived files changed alongside their source files
- Work spans several concerns and a single commit would conflate them
- You want a reviewable, bisectable history

## When NOT to Use

- Only one logical change exists — use a simple single commit instead
- All changes are part of the same atomic concern (e.g., one bug fix
  touching three files)
- Work is incomplete and you just need a WIP save — commit with
  `chore: wip` on a feature branch instead

## Gitlint Rules (Source of Truth)

All commits must satisfy the project's `.gitlint` configuration.

**Commit signing (required):** Every commit must be signed (GPG or SSH).
The remote rejects unsigned commits. Never use `--no-gpg-sign` or
disable `commit.gpgsign`. When running `git commit`, do not add flags or
config that skip signing. See repo root [AGENTS.md](../../../AGENTS.md).

### Title Rules

| Rule          | Constraint                                     |
| ------------- | ---------------------------------------------- |
| Format        | `<type>(<scope>): <subject>` (Conventional     |
|               | Commits; scope is optional)                    |
| Length        | 5–50 characters (entire title line)            |
| Mood          | Imperative ("add", "fix" — not past tense)     |
| Allowed types | `feat`, `chore`, `docs`, `refactor`, `style`,  |
|               | `fix`, `build`, `test`, `ci`, `perf`, `revert` |

### Body Rules

| Rule        | Constraint                                            |
| ----------- | ----------------------------------------------------- |
| Presence    | Optional (body-is-missing is ignored)                 |
| Line length | 72 characters max per line (commit message body only) |
| Min length  | Ignored                                               |

### Exemptions

| Pattern                  | Exempted rules   |
| ------------------------ | ---------------- |
| `chore: merge ...` title | body-is-missing, |
|                          | body-min-length, |
|                          | title-max-length |

## Workflow

### Step 1: Analyze Current Work

Inventory all changes and group them by logical concern.

**Commands to run:**

```bash
git status            # Modified, staged, and untracked files
git diff              # Unstaged changes
git diff --cached     # Staged changes
git log --oneline -5  # Recent commits for style reference
```

**Grouping criteria:**

- **By concern:** Feature code, bug fix, configuration, documentation,
  generated output, test
- **By coupling:** Files that must change together to keep the codebase
  consistent
- **By derivation:** Source files and their generated/derived outputs
  belong together

**Key rule:** Generated or derived files must be
committed alongside the source change that produced them — never in a
separate commit.

### Step 2: Plan Commit Sequence

Order commits so every intermediate state is self-consistent.

**Sequencing rules:**

1. Infrastructure/config changes first (build tools, linter config,
   dependencies)
2. Core logic changes next (library code, scripts, processing pipelines)
3. Features and fixes that depend on core changes
4. Generated/derived output alongside its source change (same commit)
5. Documentation and standalone cleanups last

**Dependency check:** For each planned commit, ask: "If I checked out
this commit alone, would the codebase build and behave correctly?" If
not, merge it with its dependency or reorder.

**Present the plan to the user before executing.** List each planned
commit with:

- Proposed type and title
- Files included
- Rationale for grouping

### Step 3: Write Commit Messages

Follow gitlint rules exactly.

**Title formula:**

```text
<type>(<scope>): <imperative-verb> <concise-object>
```

The scope is optional. Use it when the change is clearly confined to a
subsystem, module, or area of the project (e.g., `ci`, `api`, `core`,
`cli`). Omit it for cross-cutting or general changes.

**Constraints checklist:**

- Total title length: 5–50 characters (including scope if present)
- Imperative mood: "add", "fix", "update", "remove", "refactor" (not
  "added", "fixes")
- No trailing period
- Lowercase after the colon
- **Single concern:** A title that reads as "do X and do Y" (e.g. "align
  X, clarify Y") is a smell for a non-atomic commit. Prefer splitting
  into two commits, or use one overarching verb and object (e.g. "update
  decisions log and D7/D31/D35 notes") only when the change is truly
  one logical unit.

**Body guidelines:**

- Explain _why_, not _what_ (the diff shows what)
- Wrap commit message body at 72 characters; never split formatting
  markup (e.g. keep `**bold**` or `_italic_` on one line)
- Separate from title with a blank line
- Optional — omit for self-explanatory changes

**Footer:**

- Optionally include a co-author line
- Separate from body (or title if no body) with a blank line

**Message format:**

```text
<type>(<optional-scope>): <subject>

<optional body explaining why>
```

### Step 4: Execute Commits

For each commit in the planned sequence:

1. Stage only the changes for this commit
   - **Whole files:** `git add <file1> <file2> ...`
   - **Partial files:** `git add -p <file>` to stage individual hunks
     when a single file contains changes belonging to different logical
     concerns
2. Verify staging is correct (`git diff --cached --stat`)
3. Commit with the prepared message (ensure signing is enabled — no
   `--no-gpg-sign`)
4. Verify the commit succeeded (`git log --oneline -1`)

**Use specific file paths** — never `git add -A` or `git add .` during
atomic commits, as this defeats the purpose of selective grouping.

**When to stage hunks (`git add -p`):**

- A file has changes for two or more unrelated concerns (e.g., a typo
  fix near a logic change)
- Config files where independent settings were changed together (e.g.,
  `.editorconfig` glob fix + new section)
- Documentation files with edits to multiple unrelated sections

**When NOT to bother with partial staging:**

- All changes in the file serve the same concern
- Hunks are interleaved so tightly that splitting them would leave an
  inconsistent intermediate state

### Step 5: Verify Each Commit

After each commit, run relevant verification if applicable:

- **Script changes:** Run the script to confirm it works
- **Verification scripts:** Run `make check` if requirements changed
- **Linter config:** Run `gitlint` on the commit message

If verification fails, offer to restructure: unstage, regroup files,
and re-commit.

## Commit Message Examples

### Feature with generated output

```text
feat: add phase filter to viewer

Files: `scripts/build-requirements-viewer.js`,
`product-docs/requirements-viewer.html`
```

### Scoped feature

```text
feat(api): add pagination to list endpoint
```

### Bug fix

```text
fix: correct phase range expansion

Phases like "1-3" were not expanding to individual phase numbers during
filtering.
```

### Scoped bug fix

```text
fix(auth): prevent token refresh race condition

Concurrent refresh requests could invalidate each other's tokens.
```

### Documentation only

```text
docs: update summary report findings
```

### Configuration change

```text
chore: add gitlint config
```

### Scoped CI change

```text
ci(github): add concurrency to workflow
```

### Refactoring

```text
refactor: simplify transcript cleanup
```

### Scoped refactoring

```text
refactor(cli): extract arg parsing helpers
```

### Build/tooling

```text
build: add requirements viewer script
```

## Common Patterns

### Pattern: Script change + regenerated output

**Commits:** 1 commit containing both the script and its output.

```text
feat: add expandPhases for phase ranges
```

### Pattern: Feature + related documentation

**Commits:** 2 commits — feature first, then docs.

1. `feat: add lease abstraction export` — code files
2. `docs: document lease export workflow` — markdown files

### Pattern: Bug fix + verification script

**Commits:** 1 commit if the script is needed to verify the fix; 2 if
the script is independently useful.

### Pattern: Config + code that uses it

**Commits:** 1 commit — config and code together so neither commit is
broken in isolation.

### Pattern: Multiple independent fixes

**Commits:** 1 commit per fix, ordered by dependency (or alphabetically
if independent).

### Pattern: One file, multiple concerns

**Commits:** Use `git add -p` to stage hunks separately.

Example: `CLAUDE.md` has both a prefix list update and a new guide
reference added — two unrelated concerns.

1. `fix: synchronize requirement ID prefix list` — stage only the
   prefix-list hunk
2. `docs: add disfluency annotation guide ref` — stage only the
   guide-list hunk

### Pattern: Partially complete work

If work is incomplete and you still need to commit:

- Commit the complete portions as proper atomic commits
- Leave incomplete work uncommitted, or commit on a feature branch with
  `chore: wip <description>`
- Never mix complete and incomplete work in one commit

## Workflow Order

Complete in order: Step 1 (Analyze) → Step 2 (Plan; present plan to
user) → Step 3 (Write messages) → Step 4 (Execute) → Step 5
(Verify each commit). Do not execute commits before the user has seen
the plan.

## Quality Checklist

Before executing the commit sequence:

- [ ] Each commit addresses exactly one logical concern
- [ ] No title is "do X and do Y" unless it's one logical unit (if so,
      consider splitting or use one overarching verb)
- [ ] Generated files are paired with their source changes
- [ ] No commit leaves the codebase in a broken state
- [ ] Commit sequence respects dependency order
- [ ] All titles are 5–50 characters, imperative mood
- [ ] All titles follow `<type>: <subject>` format
- [ ] Commit message body lines wrap at 72 characters; markup like
      `**` or `_` not split across lines (if body present)
- [ ] No sensitive files (.env, credentials) are staged
- [ ] `git add` uses specific file paths, not `-A` or `.`
- [ ] Commits will be signed (no `--no-gpg-sign`; signing must remain
      enabled)

After executing:

- [ ] `git log --oneline` shows clean, readable history
- [ ] Each commit message accurately describes its changes
- [ ] Verification passed for commits
- [ ] All commits are signed (remote rejects unsigned commits)

**Before you finish:** Reconfirm that generated files were committed
with their source (same commit), and that you did not use `git add -A`
or `git add .` for atomic grouping.
