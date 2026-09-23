---
record: 759
origin: capture
risk: low
size: low
ceremony: fast-lane
grants: [build]
surface: backend
---
# 759: specify: comma-list batch shaping has no size cap or parallel-execution directive

Surface: backend

## Current State
`/claude-tweaks:specify #A,#B,...` (shipped by #702) loops `shaping-mode.md` once per record. Each iteration invokes two inline sub-skills (`assess-agent-autonomy ceremony-check` + `challenge framing-check`) and rewrites a full record body, so a batch of k records costs 2k sequential inline invocations plus k body rewrites in one context. `shaping-mode.md` carries no batch-size guidance and no `> **Parallel execution:**` directive, unlike `flow/materialize.md`'s Resolution (which parallelizes fetches) and `flow/multi-spec.md`.

## Deliverables
1. Decide and document a batch-size stance in `skills/specify/SKILL.md`'s `## Input` batch paragraph (a soft cap with a pointer to split, or an explicit "no cap — cost scales linearly" note).
2. Add a `> **Parallel execution:**` directive to `shaping-mode.md` naming which per-record reads are independent (Resolution fetches; the surface sniff) and which stay sequential (the write calls, the single batched design-intent question).

## Acceptance Criteria
- `skills/specify/SKILL.md`'s batch paragraph states the batch-size stance in one sentence.
- `skills/specify/shaping-mode.md` carries one Parallel-execution directive naming the parallelizable reads.
- `tests/argument-hint-input.test.js`, `tests/reference-card-argument-hint.test.js`, `tests/specify-batch-input.test.js` stay green.

## Gotchas
- Out of scope for #702 itself — surfaced by that spec's final whole-branch review Recommendations, filed as a follow-up via the Wrap-Up Review Console's Queue writes gate (autonomy: unattended, consoleAutoResolve).

## Original request

specify: comma-list batch shaping has no size cap or parallel-execution directive

Source: final whole-branch review of #702 (Recommendations). Not blocking; outside #702's scope.

