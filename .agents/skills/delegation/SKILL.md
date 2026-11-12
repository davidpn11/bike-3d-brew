---
name: delegation
description: "How to hand work to subagents and Orca workers in this repo: which tool and model tier fits which role, the self-contained brief, and the response contract every worker returns. Use whenever you dispatch, fan out, spawn or delegate, or pick Claude vs Codex for a task."
---

# Delegation

Adapted from `davidpn11/ai-toolbox` (`skills/shared/delegation`), plus the Claude/Codex split for this repo.

A subagent or worker is a fresh context with one job. Delegate to keep the main context clean, to run
independent work in parallel, and to put cheap work on a cheap model. The user conversation, every
decision and the final synthesis stay in the main session.

## Pick the runtime

The role table in `AGENTS.md` ("Agents: who does what") gives each role's default runtime.

| Runtime | How to start it | Use it for |
|---------|-----------------|------------|
| Claude subagent | `Agent` tool with `claude-<role>` (`.claude/agents/claude-<role>.md`) | Roles routed to Claude; any role when Orca is down |
| Codex subagent | spawn `codex_<role>` from `.codex/agents/codex-<role>.toml` (underscores, e.g. `codex_ios_engineer`) | Roles routed to Codex, from a Codex main session |
| Orca worker (other family) | `orca orchestration worker-start --spec "<brief>" --agent codex\|claude --worktree new-child --name <slug>` | Roles routed to the other family; cross-family review |

- Check `orca status` once per session. If it fails, run every role as your own subagent.
- A writer that is an Orca worker gets its own worktree (`--worktree new-child`). Read-only workers
  (`reviewer`, `security-engineer`) may use `--worktree current`.
- Start every independent worker, then end your turn: Orca wakes you with each `worker_done`. Never poll.
- Merge a writer's child branch into your branch only after its checks pass; resolve conflicts by intent.

## Pick the tier

| Tier | Claude | Codex | Use it for |
|------|--------|-------|------------|
| Fast | `haiku`, `claude-scout` / `claude-runner` | `model_reasoning_effort = "low"`, `codex_scout` / `codex_junior_engineer` | Finding files and call sites, git history, running tests or builds and reporting output, mechanical edits |
| Standard | `sonnet` | `"medium"` | One well-specified task, one review axis, docs |
| Deep | `opus` / `inherit` | `"high"` | Planning, trade-offs, synthesis, lead judgment; usually the main session |

Fast-tier output is a lead, not a fact: open the cited file or rerun the command before it goes in a PR.

## Write the brief

The worker sees only the brief (and `AGENTS.md`). Write it so a stranger could do the job.

```
Task: <one sentence, the deliverable>
Role: <role>   Tier: fast | standard | deep
Why: <the decision or roadmap item this feeds, one line>

Context pointers:
- <path>: <what to take from it>

Do:
- <steps, numbered if order matters>

May edit: <paths>  (nothing else)
Done when:
- <checkable criteria, including the exact verify commands>

Report: the response contract below, summary under <N> words.
Do not ask the user anything, do not spawn subagents, and do not widen the task.
```

- Pointers, not pastes. One job per worker. No nesting: only the main session fans out.
- Two writers never touch the same files unless each has its own worktree.

## Response contract

Every worker ends with this block (Orca workers put it in `worker_done`). Role-specific numbers go in `extra`.

```json
{
  "status": "completed | failed | needs_revision",
  "task_id": "string, or null",
  "summary": "what was done or found, at most 3 sentences",
  "artifacts": ["paths written or changed"],
  "verified": ["command → result"],
  "failure_type": "transient | fixable | needs_replan | escalate | null",
  "extra": {}
}
```

- `transient`: retry the same brief. `fixable`: re-delegate with the error output added.
- `needs_replan`: the task is wrong; re-split it. `escalate`: needs the owner; record it in
  `docs/MANUAL-STEPS.md` and the PR, then move on (sessions run unattended).

Retry a task at most three times, then escalate.
