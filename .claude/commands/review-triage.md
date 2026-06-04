---
description: Triage unresolved PR review comments. Investigates each thread, classifies as fix/wontfix/needs-discussion, presents a batch plan, executes fixes, pushes, posts replies, and resolves threads. Optionally re-requests review.
---

# Review Triage

**Usage:** `/review-triage [reviewer | --bots] [--no-re-request]`

- No arguments: triage all unresolved threads on the current PR
- `<login>`: triage only threads from a specific reviewer (e.g., `copilot-pull-request-reviewer`, `JiaxiangRen`)
- `--bots`: triage only threads from bot reviewers
- `--no-re-request`: do not re-request review at the end

Read and follow the review-triage skill at `.claude/skills/review-triage/SKILL.md`.

Pass `$ARGUMENTS` to the skill as the reviewer filter and flags.

When that skill references other skills or files via relative paths, resolve them relative to the SKILL.md file's directory and read those too.
