---
description: >-
  Bundle working-tree changes into a series of atomic, self-consistent
  commits. Each commit addresses exactly one logical concern and passes
  verification.
---

<!-- This file uses manual wrapping at 72 characters; never split
formatting markup (e.g. keep `**bold**` or `_italic_` on one line). -->

# Atomic Commits

**Input:** Optional — the argument after `/atomic-commits` may describe
a grouping hint or scope constraint. If omitted, analyze all
uncommitted work.

## Critical Rules

1. Generated or derived files must be
   committed in the **same** commit as the source that produced them —
   never separately.
2. Present the planned commit sequence to the user before executing.
3. Use specific file paths for `git add` — **never** `git add -A` or
   `git add .`.
4. Every commit must be signed; do not use `--no-gpg-sign`.
5. If grouping is ambiguous or multiple concerns are intertwined,
   **ask the user** rather than guessing.

## Quick Check

Before proceeding, confirm the situation warrants multiple commits. If
only one logical change exists, make a single commit and say so.

## Gitlint Rules (Source of Truth)

All commits must satisfy the project's `.gitlint` configuration.

### Title Rules

| Rule          | Constraint                                     |
| ------------- | ---------------------------------------------- |
| Format        | `<type>(<scope>): <subject>` (Conventional     |
|               | Commits; scope is optional)                    |
| Length        | 5–50 characters (entire title line)            |
| Mood          | Imperative ("add", "fix" — not past tense)     |
| Allowed types | `feat`, `chore`, `docs`, `refactor`, `style`,  |
|               | `fix`, `build`, `test`, `ci`, `perf`, `revert` |

**Single concern:** A title that reads as "do X and do Y" (e.g. "align
X, clarify Y") is a smell for a non-atomic commit. Prefer splitting
into two commits, or use one overarching verb and object when the
change is truly one logical unit.

### Body Rules

| Rule        | Constraint                            |
| ----------- | ------------------------------------- |
| Presence    | Optional (body-is-missing is ignored) |
| Line length | 72 characters max per line            |

### Exemptions

- **`chore: merge ...` title:** body-is-missing, body-min-length, title-max-length

## Workflow

Execute these steps in order.
**Do not execute commits before the user approves the plan.**

### Step 1 — Analyze

Inventory all changes and group by logical concern.

```bash
git status
git diff
git diff --cached
git log --oneline -5
```

**Grouping criteria:** By concern, by coupling, by derivation (source +
generated output together).

### Step 2 — Plan

Order commits so every intermediate state is self-consistent.
Sequencing: infrastructure first, core logic, features/fixes, generated
with source, docs last.

**Dependency check:** "If I checked out this commit alone, would the codebase
build and behave correctly?"

**Present the plan.** For each planned commit list: proposed type and
title, files included, rationale. STOP here and
**wait for user approval before executing**.

### Step 3 — Write Messages

**Title formula:** `<type>(<scope>): <imperative-verb> <concise-object>`
— 5–50 chars, imperative, no trailing period. Scope is optional; use it
when the change is confined to a subsystem (e.g., `fix(auth): ...`).
Omit for cross-cutting changes.

**Body:** explain _why_, not _what_. Wrap commit message body at 72
chars; never split formatting markup (e.g. keep `**bold**` or
`_italic_` on one line). Optional for self-explanatory changes.

### Step 4 — Execute

For each commit in the approved sequence: stage only those changes
(`git add <file1> <file2>` or `git add -p` for hunks), verify staging,
commit with prepared message (signed), verify `git log --oneline -1`.

### Step 5 — Verify

After each commit, run relevant checks (script, build, `make check`,
etc.). If verification fails, offer to unstage, regroup, and re-commit.

## Examples

- Unscoped: `feat: add phase filter to viewer`
- Scoped: `fix(auth): prevent token refresh race`

## Common Patterns

| Pattern                     | Commits | Notes                         |
| --------------------------- | ------- | ----------------------------- |
| Script + regenerated output | 1       | Source and output same commit |
| Feature + related docs      | 2       | Feature first, then docs      |
| One file, multiple concerns | N       | Use `git add -p` for hunks    |

## Quality Checklist

Before executing:

- [ ] Each commit addresses exactly one logical concern
- [ ] No title is "do X and do Y" unless it's one logical unit (if so,
      consider splitting or use one overarching verb)
- [ ] Generated files paired with their source changes
- [ ] No commit leaves the codebase broken
- [ ] Sequence respects dependency order
- [ ] Titles: 5–50 chars (including scope if present), imperative,
      `<type>(<optional-scope>): <subject>`
- [ ] Commit message body lines wrap at 72 chars; don't split `**` or
      `_` markup (if present)
- [ ] No sensitive files staged
- [ ] `git add` uses specific paths, not `-A` or `.`
- [ ] Commits will be signed

After executing:

- [ ] `git log --oneline` shows clean, readable history
- [ ] Each message accurately describes its changes
- [ ] Verification passed where applicable
- [ ] All commits are signed

**Use the atomic-commits skill**
(`.cursor/skills/atomic-commits/SKILL.md`) for full workflow, examples,
and gitlint detail.
