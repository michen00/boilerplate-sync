---
description: Run a Claude Code skill by name. Pass the skill directory name as the argument.
---

Read and follow the Claude Code skill at `.claude/skills/$ARGUMENTS/SKILL.md`.

When that skill references other skills or files via relative paths, resolve them relative to the SKILL.md file's directory and read those too.
