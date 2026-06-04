---
name: format-reply
description: Format a reply comment for a PR review thread based on the classification and execution result. Post the reply via the GitHub API and resolve the thread.
---

# Format Reply

Given the original thread data, a classification, and an execution result, format and post a reply comment, then resolve the thread.

## Inputs

- **Original thread data** from `fetch-threads.md` (the full thread object including `thread_id`, `author`, `is_bot`, `comment_body`, `path`, `line`)
- **Classification**: `fix`, `wontfix`, or `needs-discussion`
- **Execution result**:
  - For `fix`: `{ commit_hash, description }` — the hash of the commit that fixed the issue and a brief description
  - For `wontfix`: `{ rationale }` — the rationale for not addressing the concern
  - For `needs-discussion`: `{ question, context }` — the clarifying question and investigation context
- **Investigation metadata**: `fix_site_differs` (bool) and `fix_site_rationale` (string or null) from `investigate-thread.md`

## Reply Format

Replies must match the project's established PR comment style: short, dense, evidence-backed, no boilerplate headers or markdown ceremony.

### Fix Reply

> Fixed in {hash} — {what changed}. {How/why it remediates the concern}. {Reference links if applicable}.

**Example:**

> Fixed in b2e2492 — replaced the dead `specs/` link with `docs/feature/`, which is the actual location of per-feature specs in the repository.

### Fix Reply (different location)

When `fix_site_differs` is true, the fix was applied in different file(s) than the one the comment is on. The reply must explain why the fix belongs elsewhere so the reviewer doesn't wonder why the diff doesn't touch the commented file.

> Fixed in {hash} — applied in `{actual_file(s)}` rather than here. {Why the fix belongs there}. {How it remediates the original concern}.

**Example:**

> Fixed in a1c3f07 — applied in `src/validators.py` rather than here. The email check belongs in the shared validator, which covers this handler and three others. Prevents the same gap from recurring in new endpoints.

### Wontfix Reply

> Investigated — not addressing. {Rationale with evidence — docs links, spec references, or code pointers that support the decision}.

**Example:**

> Investigated — not addressing. The docstring is used to supply the default `description` arg per [Pydantic docs](https://docs.pydantic.dev/latest/api/fields/#pydantic.fields.computed_field).

### Wontfix Reply (human reviewer)

> Investigated — this appears intentional as implemented. {Evidence and rationale}. Happy to discuss if you see it differently.

### Needs-Discussion Reply

> Investigating — {clarifying question or counterpoint}. {Context for what was investigated}. {Reference links}.

## Procedure

### 1. Format the Reply

Compose the reply text following the format above. Keep it concise — one to three sentences.

**Choose the reply format based on classification and author type:**

| Classification     | `is_bot` | `fix_site_differs` | Format                         |
| ------------------ | -------- | ------------------ | ------------------------------ |
| `fix`              | `true`   | `false`            | Fix Reply                      |
| `fix`              | `true`   | `true`             | Fix Reply (different location) |
| `fix`              | `false`  | `false`            | Fix Reply                      |
| `fix`              | `false`  | `true`             | Fix Reply (different location) |
| `wontfix`          | `true`   | —                  | Wontfix Reply                  |
| `wontfix`          | `false`  | —                  | Wontfix Reply (human reviewer) |
| `needs-discussion` | `false`  | —                  | Needs-Discussion Reply         |

**Include:**

- For fixes: the commit hash (short form, 7 chars), what changed, and why it addresses the concern
- For wontfix: evidence-backed rationale with links to relevant docs, specs, or code. Use the softer human template when `is_bot` is `false`.
- For needs-discussion: a focused question with context from the investigation

### 2. Post the Reply

Post the reply as a comment on the review thread using the GitHub GraphQL API. **Important:** Mutation and input field names (`addPullRequestReviewThreadReply`, `resolveReviewThread`) were verified against the live schema at plan time but have changed in the past. Verify against GitHub's GraphQL Explorer as part of this task's acceptance, not as optional polish.

Write the body to a temp file and pass it via `@` to handle newlines, quotes, and special characters safely:

```bash
TMPFILE=$(mktemp)
printf '%s' "$REPLY_BODY" > "$TMPFILE"
gh api graphql \
  -f query='
    mutation($threadId: ID!, $body: String!) {
      addPullRequestReviewThreadReply(input: {
        pullRequestReviewThreadId: $threadId
        body: $body
      }) {
        comment { url }
      }
    }
  ' \
  -f threadId="$THREAD_ID" \
  -F body=@"$TMPFILE"
rm -f "$TMPFILE"
```

If the API call fails, log the error and continue (do not abort the entire workflow). Report failed posts at the end.

### 3. Resolve the Thread (bot-only)

After successfully posting the reply, resolve the thread only when:

- `is_bot` is `true`, and
- classification is not `needs-discussion`.

For human-authored threads, post the reply and leave the thread open.

For bot-authored threads that should be resolved, run:

```bash
gh api graphql \
  -f query='
    mutation($threadId: ID!) {
      resolveReviewThread(input: {
        threadId: $threadId
      }) {
        thread { isResolved }
      }
    }
  ' \
  -f threadId="$THREAD_ID"
```

**Exceptions:** Do NOT resolve threads classified as `needs-discussion`, and do NOT resolve any human-authored thread.

**Partial failure handling:**

- Reply posted but resolve fails: report "reply posted, resolve failed — retry resolve manually or on next triage run"
- Resolve succeeds but reply failed: should not happen (resolve is only attempted after a successful reply post)
- Both fail: report and move on to the next thread

### 4. Return Result

Report success or failure for each thread:

- Posted reply URL (from the mutation response)
- Whether the thread was resolved
- Any errors encountered (with partial state noted)
