---
record: 491
origin: human
risk: low
size: medium
ceremony: standard
grants: []
surface: infra
---
# 491: /flow: clarify whether/when an interactive session may run the pipeline's substance directly instead of via Task dispatch

Surface: infra

## Current State

`/claude-tweaks:flow #473,#474,#475,#476` was run in an interactive session that executed the pipeline's actual build/test/review work directly (Edit/Bash/Write in the main thread) rather than dispatching to Task-tool subagents per `/build`'s own `execution-strategy` contract, and skipped the Manifesto/ledger-config/`decisions.md`/Review-Console apparatus in favor of a streamlined worktree + commit + code-review + merge flow. Tests stayed green throughout, a `/code-review high` pass caught real issues, and the four records shipped cleanly — but this is a real divergence from what "running `/flow`" is documented to mean (subagent execution, full ceremony, PR-first lifecycle machinery). Neither `flow/SKILL.md` nor `build/SKILL.md` currently states whether this divergence is licensed or forbidden — the plugin's own skill files are silent on the question either way.

## Deliverables

Decide, and document in `/flow`'s `SKILL.md` (and `/build`'s `SKILL.md` where the `execution-strategy` contract lives), whether a sufficiently capable interactive session is licensed to execute a pipeline's substance directly instead of Task-dispatching it. If licensed: state which parts of the ceremony (Manifesto, ledger, `decisions.md`, Review Console) remain mandatory versus safely streamlined in that mode. If not licensed: state that explicitly too, since the plugin's own skill files currently forbid or license neither path.

## Acceptance Criteria

- `flow/SKILL.md` and/or `build/SKILL.md` state an explicit, unambiguous policy on direct-in-session execution vs. Task dispatch — never a silent gap that leaves the question open to per-session interpretation.
- If the answer is "sometimes licensed," the record's ceremony-streamlining rules (which of Manifesto/ledger/`decisions.md`/Review Console stay mandatory) are stated as concretely as the existing `execution-strategy` contract states subagent-vs-inline today.
- `resolve-policy.js`'s `execution-strategy` schema key (`_shared/policy-schema.md`) is checked for whether it needs a new value or clarifying language to express the decided policy — extend it if the decision requires a new enum value, leave it alone if the existing values already cover the decided policy.
- `npm test` passes (skill-prose conformance suites re-verify the updated `SKILL.md` text still parses correctly).

## Technical Approach

This is a policy decision, not a mechanical change — read `execution-strategy`'s current schema and every existing consumer (`_shared/policy-schema.md`, `build/SKILL.md`'s own `**subagent** (default):` paragraph) before deciding, so the new policy language is additive to an existing contract rather than a parallel, conflicting one. Land the decision as prose in `flow/SKILL.md` (and `build/SKILL.md` if the `execution-strategy` contract itself needs a new value), following this project's existing convention of stating a policy once and citing it from elsewhere rather than restating it per consumer.

### Key Files

- `plugin/skills/flow/SKILL.md` — state the decided policy on interactive direct-execution vs. Task dispatch
- `plugin/skills/build/SKILL.md` — the `**subagent** (default):` paragraph and `execution-strategy` contract this decision extends or clarifies
- `plugin/skills/_shared/policy-schema.md` — check whether `execution-strategy`'s schema needs a new enum value to express the decided policy

## Gotchas

- This project's own `.claude-tweaks/policy.yml` currently sets `execution-strategy: subagent-only` — whatever policy this record lands must be consistent with (or deliberately supersede) that existing project-level setting, not silently contradict it.
- The precedent run (#473-#476) shipped cleanly with tests green and a real `/code-review high` catch — avoid writing a policy that reads as "interactive sessions did something wrong" when the actual open question is simply that the plugin never stated a rule either way.

## Original request

/flow: clarify whether/when an interactive session may run the pipeline's substance directly instead of via Task dispatch

**Related:** none

Context: /claude-tweaks:flow #473,#474,#475,#476 was run in an interactive session that executed the pipeline's actual build/test/review work directly (Edit/Bash/Write in the main thread) rather than dispatching to Task-tool subagents per /build's own execution-strategy contract, and skipped the Manifesto/ledger-config/decisions.md/Review-Console apparatus in favor of a streamlined worktree + commit + code-review + merge flow. Tests stayed green throughout, a /code-review high pass caught real issues, and the four records shipped cleanly — but this is a real divergence from what "running /flow" is documented to mean (subagent execution, full ceremony, PR-first lifecycle machinery).

Scope: Decide, and document in /flow's SKILL.md, whether a sufficiently capable interactive session is licensed to execute a pipeline's substance directly instead of Task-dispatching it, and if so, which parts of the ceremony (Manifesto, ledger, decisions.md, Review Console) remain mandatory versus safely streamlined in that mode. If the answer is "never, always dispatch," state that explicitly too, since the plugin's own skill files don't currently forbid or license this path either way.

Trigger: Next time a multi-spec /flow run is executed by an interactive session rather than a scheduled/headless dispatch.


