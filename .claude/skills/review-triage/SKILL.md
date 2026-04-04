---
name: review-triage
description: Orchestrates PR review triage: fetches unresolved threads, investigates each in parallel, presents a batch plan for approval, executes fixes as atomic commits, pushes, posts reply comments, resolves threads, and re-requests review.
---

# Review Triage

Triage unresolved PR review comments from any reviewer through an interactive pipeline: fetch, investigate, plan, fix, push, comment, resolve, and re-request review.

## Configuration

| Variable                 | Default                         | Purpose                                                                                                            |
| ------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `VERIFY_CMD`             | `make check`                    | Verification command run before each commit                                                                        |
| `RE_REQUEST`             | `true`                          | If `false`, skip re-request at the end of the pipeline                                                             |
| `BOT_LOGINS`             | `copilot-pull-request-reviewer` | Known bot logins (for `--bots` filter)                                                                             |
| `COPILOT_THREAD_AUTHORS` | `copilot-pull-request-reviewer` | Thread `author.login` values for Copilot code review in Step 8 (not the same string as REST `requested_reviewers`) |
| `GEMINI_THREAD_AUTHORS`  | `gemini-code-assist`            | Thread `author.login` values for Gemini Code Assist in Step 8; REST uses `gemini-code-assist[bot]`                 |
| `AUTO_TRIAGE_TAG`        | `[Auto-triage]`                 | Prefix to detect gh-aw pre-triage replies (synced with `.github/workflows/review-triage.md` — update both)         |

**Thread author vs review request:** GraphQL review-comment `author.login` identifies who started the thread; it is **not** always valid for [`POST .../pulls/{pull_number}/requested_reviewers`](https://docs.github.com/en/rest/pulls/review-requests). Copilot threads use `copilot-pull-request-reviewer`, but re-requesting Copilot uses **`gh pr edit ... --add-reviewer '@copilot'`** (or REST `copilot-pull-request-reviewer[bot]`). Gemini threads use `gemini-code-assist`; re-request via REST **`gemini-code-assist[bot]`** (there is no documented `gh pr edit` alias like `@copilot`). For any other bot, map thread `author` to a documented CLI or REST reviewer identity—**never** pass thread authors blindly into `reviewers[]`.

## Inputs

- **reviewer** (optional): GitHub login to filter by, or `--bots` for bot authors only. Passed from the command's `$ARGUMENTS`.
- **--no-re-request** (optional): If present in `$ARGUMENTS`, set `RE_REQUEST` to `false`.

## Prerequisites

Before running the pipeline, confirm:

- `gh` is installed and authenticated with permission to read/write PR comments and review threads. For Copilot re-request via `--add-reviewer '@copilot'`, **GitHub CLI 2.88+** is required ([changelog](https://github.blog/changelog/2026-03-11-request-copilot-code-review-from-github-cli/)).
- `jq` is available for parsing JSON in shell steps.
- The current branch is associated with an open pull request (`gh pr view` succeeds).
- `VERIFY_CMD` dependencies are available in the current environment (default: `make check`).
- Fix execution (Step 5 onward) runs in a writable git worktree; a clean tree is enforced at Step 5.

## Pipeline

Execute these steps in order. **Do not skip steps.**

### Step 1 — Detect PR Context

Derive PR number, owner, and repo from a single `gh pr view` call. `gh` does not expose `baseRepository` in `--json`; use the PR `url` instead — its path is always the **base** repository (where the PR and review threads live), including for PRs opened from forks. `headRepository` points at the fork and must not be used for `repository(owner, name) { pullRequest(number) }` or REST `/repos/{owner}/{repo}/pulls/{n}`. These variables are used throughout the pipeline (Steps 2, 6, 7, 8):

```bash
PR_JSON=$(gh pr view --json number,url)
eval "$(echo "$PR_JSON" | jq -r '
  (.url | sub("#.*$"; "") | sub("\\?.*$"; "") | split("/") as $s | ($s | index("pull")) as $i
    | if ($i != null) and ($i >= 2) then {owner: $s[$i - 2], repo: $s[$i - 1]}
      else error("unparsable PR url")
      end) as $loc
  | @sh "PR_NUMBER=\(.number) OWNER=\($loc.owner) REPO=\($loc.repo)"
')"
```

If `gh pr view` fails, stop: "No PR found for the current branch. Push and open a PR first."

### Step 2 — Fetch Unresolved Threads

Read and follow [fetch-threads.md](fetch-threads.md).

Pass `OWNER`, `REPO`, and `PR_NUMBER` from Step 1 as inputs so fetch-threads skips its own PR detection. Also pass the reviewer filter (if any) from the inputs.

If zero threads found, stop: "No unresolved threads found. Nothing to triage."

### Step 3 — Parallel Investigation

Preferred path: for each thread from step 2, spawn a subagent to investigate it. Each subagent reads and follows [investigate-thread.md](investigate-thread.md) with the thread data as input.

Run all subagents in parallel (they are read-only investigations).

Fallback: if subagents are unavailable, investigate threads sequentially in the main agent by applying [investigate-thread.md](investigate-thread.md) to each thread in order.

After all investigations complete, collect results and flag:

- [ ] **File overlaps** — two or more fix-classified threads touch the same file. They must be sequenced during execution; the second fix is re-validated after the first commits.
- [ ] **Fix-site-differs** — any fix where `fix_site_differs` is true (fix applies to different file(s) than the comment's `path`). Surfaced in the batch plan for user verification.
- [ ] **Pre-triage overrides** — any result where `pre_triage_overridden` is true (agent disagrees with gh-aw auto-triage). Surfaced in the batch plan for user review.

### Step 4 — Present Batch Plan

Present the consolidated plan and wait for explicit approval before making any edits.

If your environment supports plan mode tooling, use it (for example, in Claude Code use `EnterPlanMode`). In environments without plan mode tooling (for example, Cursor), present the plan in chat and wait for approval before acting.

Any thread classified with `confidence: low` is excluded from the batch entirely — not displayed in the plan, no action taken. If any threads were excluded, report the count before the plan: "Excluded N low-confidence thread(s) from the batch."

Display a consolidated plan grouped by classification:

**Fixes:**

For each fix-classified thread, show as a numbered list item (`1.`, `2.`, ...):

- Thread summary (file, line, one-line description of concern)
- What will change and which file(s)
- Confidence level
- If `fix_site_differs`: flag prominently — "Comment on `{path}:{line}` but fix applied in `{files_touched}`" with the `fix_site_rationale`

**Wontfix:**

For each wontfix-classified thread, show:

- Thread summary
- Rationale (abbreviated)
- Confidence level

**Needs-discussion** (human reviewers only):

For each needs-discussion thread, show:

- Thread summary
- Proposed question

**File overlaps** (if any):

- Note which fixes will be sequenced due to touching the same file

**Outdated threads** (if any):

- Flag with: "This thread is outdated — the code has changed since the comment. Investigation based on current code."

**Pre-triage overrides** (if any):

- Flag any thread where the agent's conclusion disagrees with the gh-aw pre-triage, with the override reason

**Approval gate:**

- High-confidence wontfix threads on **bot-authored comments** are **auto-approved** — they do not require user confirmation and will be resolved automatically.
- All other threads (fixes, medium-confidence wontfix, needs-discussion, and all human-authored threads) require explicit approval.
- If the plan consists _only_ of high-confidence wontfix bot threads, skip the approval wait entirely and proceed directly to Step 7.

Otherwise, **wait for user approval.** The user may:

- Approve the plan as-is
- Reclassify specific threads (e.g., change a fix to wontfix)
- Modify fix approaches
- Remove threads from the batch (skip them)

If plan mode was used, exit it after approval.

### Step 5 — Execute Fixes

**Prerequisite:** Verify the working tree is clean before starting (`git status` shows no uncommitted changes). If dirty, prompt the user to stash or commit unrelated work first.

For each approved fix, **sequentially**:

1. Apply the change described in the investigation result
2. Run `VERIFY_CMD` (default: `make check`) **before committing**
3. **On failure:** pause, show the error, and offer:
   - Fix the issue manually and retry verification
   - Skip this fix (discard changes: `git restore <file>...` for modified files in `plan.files_touched`, plus `git clean -f <file>...` for any new files the fix added)
   - Abort remaining fixes (keep prior commits)
4. **On success:** create an atomic commit following the conventions from the atomic-commits skill (reference its conventions for message format, signing, and staging only — do NOT invoke the full multi-commit workflow):
   - Signed commit (per project policy in `atomic-commits`)
   - Conventional commit message (`fix`, `docs`, `refactor`, etc. as appropriate)
   - Specific file paths for `git add` (never `-A` or `.`)
   - Title 5–50 characters, imperative mood
5. Record the commit hash (short form, 7 chars) for use in reply comments

**Overlapping files** (two fixes touching the same file, flagged in step 3):

1. Order by line number (lowest first). If equal or unavailable, preserve the order the user approved in the plan.
2. Execute and commit the first fix.
3. Re-read the file to pick up the committed changes.
4. Re-validate that the second fix still makes sense against the updated code before applying it.

### Step 6 — Push

```bash
git push
```

If the branch has no upstream yet, use `git push -u origin HEAD`.

If push fails because the remote has new commits:

```bash
git pull --rebase && git push
```

If the rebase hits conflicts, abort and prompt the user:

```bash
git rebase --abort
```

Do not leave the repo in a mid-rebase state.

**Re-derive commit hashes after push.** A rebase rewrites hashes, and `git pull --rebase` can happen transparently above. To be safe, re-derive every time:

```bash
git log --oneline -n N   # N = number of fix commits
```

Match each recorded commit subject to a line in the output and update the stored hash. Commit subjects are unique (each addresses a different thread). Step 7 replies must reference hashes that exist on the remote.

### Step 7 — Post Replies & Resolve

For each thread **in the approved set** (skip any threads the user removed from the batch in step 4), read and follow [format-reply.md](format-reply.md) with:

- The original thread data from step 2
- The classification from step 3
- The investigation metadata: `fix_site_differs` and `fix_site_rationale` (from step 3)
- The execution result:
  - For fixes: `{ commit_hash, description }` from step 5
  - For wontfix: `{ rationale }` from step 3
  - For needs-discussion: `{ question, context }` from step 3

**Skipped fixes:** If a fix was approved but verification failed and the user chose to skip it in step 5, do NOT post a reply or use a bogus hash. Leave the thread untouched (no comment, no resolve). For step 8, treat skipped fixes as unresolved — they block re-request for that reviewer.

**Resolve policy:** Human-authored threads are never resolved by this workflow. Only bot-authored threads may be resolved.

If any reply post fails, log the error and continue with remaining threads. Report all failures at the end.

### Step 8 — Re-request Review

**Fresh fetch:** Re-run the `fetch-threads` query from step 2 to get the current state of unresolved threads. This accounts for threads skipped in step 4, new comments posted during execution, and resolve failures from step 7.

**Reviewer candidates:** The set of reviewers to consider is the **distinct** `author` values from all threads in the approved batch. If the command was filtered (e.g., `--bots`), only filtered reviewers are candidates.

**Re-request gate:** Only re-request from a reviewer when the fresh fetch shows **zero** unresolved threads from that reviewer on the PR. Threads skipped in step 4 (still unresolved on GitHub) block re-request. New comments arriving during execution also block re-request — the user should triage them first.

**Mechanism:**

- If `RE_REQUEST` is `false` (set via `--no-re-request`), skip re-request entirely.

- If `RE_REQUEST` is `true` (default), for each **distinct** reviewer candidate that passes the re-request gate, pick **one** path using that reviewer's thread `author` from the approved batch and `OWNER`, `REPO`, `PR_NUMBER` from Step 1.

**1. Human reviewers** (threads where `is_bot == false` for that author):

```bash
gh api --method POST \
  "/repos/$OWNER/$REPO/pulls/$PR_NUMBER/requested_reviewers" \
  -f "reviewers[]=$REVIEWER_LOGIN"
```

Use `$REVIEWER_LOGIN` equal to the author's `login`. Alternatively:

```bash
gh pr edit "$PR_NUMBER" --repo "$OWNER/$REPO" --add-reviewer "$REVIEWER_LOGIN"
```

**2. GitHub Copilot code review** (thread `author.login` is listed in `COPILOT_THREAD_AUTHORS`; default is `copilot-pull-request-reviewer`):

Do **not** pass that string to `reviewers[]` — GitHub returns **422** (“not a collaborator”). Prefer:

```bash
gh pr edit "$PR_NUMBER" --repo "$OWNER/$REPO" --add-reviewer '@copilot'
```

Quote `'@copilot'` for shell safety. Requires **GitHub CLI 2.88+**.

**Fallback** if that fails (e.g. older `gh`) or after a documented retry:

```bash
gh api --method POST \
  "/repos/$OWNER/$REPO/pulls/$PR_NUMBER/requested_reviewers" \
  -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```

Do **not** use bare `copilot-pull-request-reviewer` in `reviewers[]`.

**3. Gemini Code Assist** (thread `author.login` is listed in `GEMINI_THREAD_AUTHORS`; default is `gemini-code-assist`):

Do **not** pass that string to `reviewers[]` bare — GitHub may return **422** (“not a collaborator”). There is no documented `gh pr edit --add-reviewer '@gemini'` equivalent (unlike Copilot). Use REST:

```bash
gh api --method POST \
  "/repos/$OWNER/$REPO/pulls/$PR_NUMBER/requested_reviewers" \
  -f 'reviewers[]=gemini-code-assist[bot]'
```

If the POST returns **422**, confirm the reviewer slug with `GET /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers` on a pull request where Gemini Code Assist has already reviewed. As a **human** fallback, contributors can post `/gemini review` on the PR conversation.

Do **not** use bare `gemini-code-assist` in `reviewers[]`.

**4. Other bots** (e.g. `github-actions`, or any bot not covered above): **skip** re-request for that author and log that the login is not a requestable code-review identity. Do not POST to `requested_reviewers` with those logins (422).

**Extensibility:** Copilot and Gemini are documented above. For any other bot, add a mapping from thread `author` to a CLI alias or REST `reviewers[]` login (often `name[bot]`), following the same pattern—never pass thread `author` alone without verification.

**Errors:** Log failures. For Copilot, try the **`[bot]`** REST fallback above before giving up. For Gemini, verify the `gemini-code-assist[bot]` slug if POST fails. Do **not** “fall back” to `gh pr edit --add-reviewer` with the **thread author** string for Copilot or Gemini—that repeats the bug.

**Team reviewers:** use `team_reviewers[]` instead of `reviewers[]`. (v1: individual reviewers only.)

**Policy:** Human-authored threads are never resolved. Only bot-authored threads can be auto-resolved.

**Summary:** Report final results:

> Resolved N threads (X fixes, Y wontfix, Z needs-discussion).
> Re-requested review from: {reviewers}.
