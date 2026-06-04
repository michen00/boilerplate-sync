---
name: investigate-thread
description: Investigate a single PR review thread. Read the relevant code, understand the concern, and classify it as fix, wontfix, or needs-discussion. Produce an action plan or rationale. Designed to run as a subagent for parallel investigation.
---

# Investigate Thread

Given one review thread's data, investigate the concern and classify it.

## Inputs

A single thread object from `fetch-threads.md`:

```json
{
  "thread_id": "...",
  "author": "...",
  "is_bot": true,
  "is_outdated": false,
  "path": "src/module.py",
  "line": 42,
  "diff_hunk": "@@ ... (original diff context)",
  "comment_body": "...",
  "replies": [{ "author": "...", "body": "..." }],
  "suggestion": "... or null",
  "pre_triage": "... or null"
}
```

## Procedure

**Note:** If `pre_triage` is present in the input, do NOT read it until step 8. Investigate the code independently first to avoid anchoring bias.

### 1. Read the Relevant Code

Read the file at `path`. If `line` is available, focus on a window of ~50 lines centered on that line to understand the surrounding context. If the comment references other files or symbols, read those too.

### 2. Understand the Concern

Read `comment_body` (the root comment) and all `replies` to understand the full conversation context. For human reviewers, prior back-and-forth may contain agreements, revised asks, or partial resolutions that affect classification.

Consider:

- Is this a legitimate issue in the code?
- Is the reviewer correct about the behavior they describe?
- Is this already handled elsewhere?
- Is this based on a misunderstanding of the design or framework?
- If there is a code suggestion, is it correct and appropriate?

### 3. Challenge the Premise

Before classifying, apply healthy skepticism — especially for automated reviewers. Reviewers can be wrong, and accepting bad suggestions degrades the code.

**Verify the claim.** Does the reviewer's assertion about behavior actually hold? Trace the relevant code path and confirm or refute. Automated reviewers frequently misread control flow, miss null guards upstream, or flag intentional design choices as bugs.

**Net-improvement test.** Even if the concern is technically valid, would the suggested fix actually improve the code? "Correct but not better" is a legitimate wontfix. A change that trades one form of complexity for another, adds indirection without payoff, or obscures intent is not an improvement.

_Exception — trivial objective fixes:_ Skip the net-improvement test for changes that are objectively, unambiguously better with zero tradeoff: fixing typos, removing dead whitespace, correcting off-by-one in comments, etc. These are always worth taking.

If either check fails, classify as **wontfix** with the specific evidence for why the premise doesn't hold or why the fix isn't a net improvement.

### 4. Locate the Right Fix Site

The comment points to `path:line`, but the fix may belong elsewhere. Consider:

- **Is this a symptom?** Where is the root cause? (e.g., comment flags a missing check in a handler, but the check belongs in a shared validator)
- **Is there a shared abstraction** (validator, helper, base class) where the fix would cover this case and others?
- **Should the fix be applied in multiple places?** (e.g., the same pattern is repeated across files)

If the fix site differs from the comment location, search the codebase to confirm your hypothesis before classifying. Note the divergence in `rationale_or_approach` and ensure `files_touched` reflects the actual files to modify, not the commented file.

### 5. Check if Outdated

If `is_outdated` is true, the code has changed since the comment was posted. Check whether the concern still applies to the current code. Note this in the output.

### 6. Classify

**For bot authors (`is_bot: true`)** — choose one:

- **fix**: The concern is legitimate and actionable. Draft a description of what to change, which files to modify, and why this remediates the concern.
- **wontfix**: The concern is not applicable, already handled, based on a misunderstanding, or not a net improvement. Draft a rationale with evidence: doc links, spec references, framework documentation, or code pointers.

**For human authors (`is_bot: false`)** — choose one:

- **fix**: Same as above.
- **wontfix**: Same as above.
- **needs-discussion**: The comment is ambiguous, asks a question, or requires back-and-forth to resolve. Draft a clarifying question with context from your investigation. Use this classification judiciously — prefer fix or wontfix when the answer is clear.

### 7. Assess Confidence

Rate your confidence in the classification:

- **high**: Clear-cut case, strong evidence
- **medium**: Reasonable classification but some ambiguity
- **low**: Uncertain, would benefit from human review

### 8. Compare Against Pre-Triage (if available)

If `pre_triage` is not null, compare your classification against it. You have already committed to your own analysis in steps 1–7. If your classification differs from the pre-triage, set `pre_triage_overridden: true` and note the reason. Do not change your classification to match the pre-triage — trust your own investigation of the current code.

### 9. Return Result

Return a structured result:

```json
{
  "thread_id": "...",
  "classification": "fix | wontfix | needs-discussion",
  "plan": {
    "description": "What to do and why",
    "files_touched": ["src/module.py"],
    "rationale_or_approach": "Detailed approach or rationale"
  },
  "confidence": "high | medium | low",
  "is_outdated": false,
  "outdated_note": "null or note about current relevance",
  "pre_triage_overridden": false,
  "pre_triage_override_reason": "null or brief reason",
  "fix_site_differs": false,
  "fix_site_rationale": "null or explanation of why the fix belongs elsewhere"
}
```

**Per classification:**

- **fix**: `files_touched` lists files to modify;
  `rationale_or_approach` describes the fix.
  If `fix_site_differs` is true, `files_touched` reflects the actual fix location(s) — not the commented file — and `fix_site_rationale` explains why (e.g., "Comment is on the handler but the validation belongs in the shared schema validator, which covers all handlers").
- **wontfix**: `files_touched` is `[]`;
  `rationale_or_approach` contains the evidence-backed rationale.
  `fix_site_differs` is always `false`.
- **needs-discussion**: `files_touched` is `[]`;
  `rationale_or_approach` contains the clarifying question and investigation context.
  `fix_site_differs` is always `false`.
