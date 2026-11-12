@AGENTS.md

## Claude Code only

- Subagents live in `.claude/agents/` as `claude-<role>` and preload the persona skills from `.agents/skills/`
  (symlinked into `.claude/skills/`). Start the orchestrator with `claude --agent claude-architect`.
- Roles routed to Codex in the table above start as Orca workers; use your own subagent for the
  same role when `orca status` fails.
