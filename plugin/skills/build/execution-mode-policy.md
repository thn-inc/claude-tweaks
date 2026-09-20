# Execution Mode Policy — No Licensed Third Path (record #491)

`/claude-tweaks:build` Common Step 2 offers exactly two execution strategies: `subagent`
(the default — Task-tool dispatch via `/superpowers:subagent-driven-development`) and
`batched` (human-paced 3-task batches via `/superpowers:executing-plans`). An interactive
session executing the plan's substance directly — Edit/Bash/Write in the main thread,
skipping Task dispatch entirely — is not a licensed third mode, regardless of how capable
the session judges itself, and regardless of whether it also streamlines the
Manifesto/ledger/`decisions.md`/Review Console apparatus alongside skipping dispatch.

## Why this was an open question

A precedent run (`/claude-tweaks:flow #473,#474,#475,#476`) executed this way: tests stayed
green throughout, a `/code-review high` pass caught real issues, and all four records shipped
cleanly. Neither `flow/SKILL.md` nor `build/SKILL.md` stated whether this divergence was
licensed or forbidden — the plugin's own skill files were silent either way. Record #491 named
this gap.

## The decision

**Never licensed**, in either policy configuration:

- **A locked `execution-strategy: subagent-only`/`batched-only`** (`_shared/policy-schema.md`)
  forbids the *other offered value* — it says nothing about a third, undocumented "skip
  dispatch entirely" option, and silence is not a license. The lock's own definition
  ("the other strategy is not offered and a contradicting explicit argument is substituted")
  presumes exactly two candidates; direct execution was never one of them.
- **An unlocked `execution-strategy`** (plain `subagent`/`batched`, an overridable default)
  still resolves to one of the two dispatch-based strategies by default. Nothing in the
  existing contract offers "run it inline instead" as an override value, the way
  `current-branch` is an explicit, documented override of the `worktree` git-strategy
  default. Absent that kind of explicit opt-in mechanism, the safe default holds.

**Why, mechanically:** the same reason `_shared/subagent-output-contract.md`'s own header
states for the dispatch contract generally — a clean room is what makes a Task-tool dispatch
independent evidence rather than the orchestrating session's own echo. Direct in-session
execution has no clean room: the same context that wrote the plan also writes the code and
judges its own review, collapsing the independence the dispatch contract exists to buy.

**This project's own `.claude-tweaks/policy.yml` sets `execution-strategy: subagent-only`** —
this decision is consistent with that existing project-level lock, not a supersession of it.

## What this does not mean

A run that already shipped this way (the #473-#476 precedent, or any other) is not
retroactively invalid — tests passing and review catching real issues are real evidence of
correctness for that run's actual code. It was **non-compliant**, not a second sanctioned
mode, and its clean outcome is not license to repeat the pattern. "It worked last time" is
not a standing exception.

## Schema impact

`resolve-policy.js`'s `execution-strategy` schema key (`_shared/policy-schema.md`) needs no
new enum value — the existing `subagent`/`batched`/`subagent-only`/`batched-only` set already
covers every licensed choice; this decision closes an undocumented gap between those values,
not a missing one among them.
