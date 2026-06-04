---
name: fetch-threads
description: Fetch all unresolved PR review threads via GitHub GraphQL API. Filters by reviewer if specified. Detects bot vs. human authors. Returns structured thread data for downstream skills.
---

# Fetch Threads

Fetch all unresolved review threads on the current PR and return structured data for each thread.

## Inputs

- **owner** (optional): GitHub repo owner. If provided along with `repo` and `pr_number`, skip PR context detection (step 1). Enables the orchestrator to pass context down and avoid duplicate detection.
- **repo** (optional): GitHub repo name.
- **pr_number** (optional): PR number.
- **reviewer** (optional): A GitHub login to filter by, or `--bots` to filter to bot authors only.

## Configuration

- `BOT_LOGINS`: Known bot author logins (default: `copilot-pull-request-reviewer`). Comma-separated.
- `AUTO_TRIAGE_TAG`: Prefix for gh-aw pre-triage replies (default: `[Auto-triage]`).

## Procedure

### 1. Detect PR Context

If `owner`, `repo`, and `pr_number` were passed as inputs (the orchestrator always passes these), use them directly and skip detection.

Otherwise (standalone use), derive all three from `gh pr view`. Use the PR `url` to obtain the **base** repository owner and name (`gh` does not expose `baseRepository` in `--json`; do not use `headRepository`, which points at the fork for cross-repo PRs):

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

If `gh pr view` fails, stop and report: "No PR found for the current branch. Push and open a PR first."

Pass all three to the GraphQL query:

```bash
gh api graphql \
  -F owner="$OWNER" \
  -F repo="$REPO" \
  -F pr="$PR_NUMBER" \
  -f query='...'
```

### 2. Query Unresolved Threads

Run the following GraphQL query via `gh api graphql`. Substitute `$OWNER`, `$REPO`, and `$PR_NUMBER` from step 1. The query fetches up to 100 threads, which covers most PRs.

**Note:** Query field names (`path`, `line`, `originalLine`, `diffHunk`) match `PullRequestReviewComment` as of plan time. Verify against GitHub's GraphQL Explorer during implementation, same as for mutations.

```graphql
query ($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first: 50) {
            nodes {
              author {
                __typename
                login
              }
              body
              path
              line
              originalLine
              diffHunk
            }
          }
        }
      }
    }
  }
}
```

If the GraphQL query fails (network error, auth failure, rate limit), report the error and stop.

### 3. Filter to Unresolved

From the query results, keep only threads where `isResolved == false`.

### 4. Extract Thread Data

For each unresolved thread, extract:

- `thread_id`: the GraphQL `id` field
- `author`: `comments.nodes[0].author.login` (GitHub returns comments in chronological order; the first node is the thread root comment)
- `is_bot`: true if `author.__typename` is `"Bot"`, or if `author.login` is in the `BOT_LOGINS` list (fallback)
- `is_outdated`: the `isOutdated` field
- `path`: file path from the root comment
- `line`: prefer `line` (current position in file)
- `diff_hunk`: the `diffHunk` field — the diff context around the commented line. Essential for outdated threads where the current file may have changed.
- `comment_body`: the comment body text
- `replies`: all comments after the root — `comments.nodes[1..]`, each as `{ "author": login, "body": text }`. Preserves the full conversation for `investigate-thread` context.
- `suggestion`: extract the content between the first ` ```suggestion ` and ` ``` ` fences in `comment_body` if present, otherwise null.

**Edge cases:**

- **Null author** (deleted user): set `author` to `"unknown"` and `is_bot` to `false`. Still include the thread.
- **Null `line`** (outdated thread where code moved): fall back to `originalLine`.

### 5. Check for Pre-Triage Replies

For each thread:

1. Scan reply comments (index `1..` in `comments.nodes` — skip the root at index 0) for bodies that, after stripping leading whitespace, start with the `AUTO_TRIAGE_TAG` prefix.
2. If multiple replies match (repeated workflow runs), use the **latest** match.
3. Attach the matched body to the thread data as `pre_triage`.

The investigator in `investigate-thread.md` reads current code independently and flags when its conclusion disagrees with the pre-triage (`pre_triage_overridden`).

### 6. Apply Reviewer Filter

If a reviewer filter was provided:

- **Username string:** keep only threads where `author` matches the given login (case-insensitive)
- **`--bots`:** keep only threads where `is_bot` is true

### 7. Report Summary

Report to the user:

> Found N unresolved threads (X from copilot-pull-request-reviewer, Y from JiaxiangRen, ...)

If zero threads remain after filtering, stop and report:

> No unresolved threads found.

### 8. Return Thread Data

Return the list of thread objects. Each object has this shape:

```json
{
  "thread_id": "PRT_kwDO...",
  "author": "copilot-pull-request-reviewer",
  "is_bot": true,
  "is_outdated": false,
  "path": "src/module.py",
  "line": 42,
  "diff_hunk": "@@ -40,6 +40,8 @@ ...",
  "comment_body": "The full comment text...",
  "replies": [
    { "author": "michen00", "body": "Reply text..." },
    { "author": "copilot-pull-request-reviewer", "body": "..." }
  ],
  "suggestion": "suggested code or null",
  "pre_triage": "auto-triage text or null"
}
```

The `replies` field contains all comments after the root (index `1..` in `comments.nodes`), preserving the full conversation for `investigate-thread` context.
