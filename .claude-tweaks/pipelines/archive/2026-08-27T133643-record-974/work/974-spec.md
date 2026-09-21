---
record: 974
origin: capture
risk: medium
size: medium
ceremony: standard
grants: [build]
surface: backend
---
# 974: In-flight-tombstone claim stop (#315) isn't wired into Settle's contest handling or the gh-absent MCP transport

Surface: backend

Defer-reason: pre-existing-outside-diff

## Current State

#315 added an in-flight-PR check to the CLI (`gh`) transport claim path in `plugin/bin/lib/claim-targets/claim-targets.js` / `claim-engine.js`, stopping a reclaim attempt when the target's tombstone links an open PR. Two gaps surfaced by the v6.98.1→tip whole-branch review (found while reviewing #944 alongside an unrelated batch merge):

1. `plugin/skills/dispatch/settle-and-merge.md`'s pre-existing "Claim-contest special case" (headless self-report trigger) only recognizes the literal claim-contest stop by name, not the new in-flight-tombstone stop — even though `flow/claim-targets.md` documents the two as behaving identically. A headless `next`-form dispatch hitting the new stop falls through to Settle's generic failure-check classifier instead, which isn't built for "this isn't a failure" cases.
2. The `gh`-absent MCP fallback path (`_shared/issue-claims.md` steps 1-6, referenced by `claim-targets.md`) still says to follow the pre-#315 steps "exactly as before this CLI existed" — no equivalent in-flight check exists on that path, so a `gh`-absent (cloud/Routine) session reclaiming a `pr-opened:` tombstone whose PR is still open reproduces the double-build race #315 was meant to prevent.

## Deliverables

- Extend the Claim-contest special case in `settle-and-merge.md` to also recognize the in-flight-tombstone stop, routing it to the same headless-self-report path instead of the generic failure-check classifier.
- Add the equivalent in-flight-PR check to the MCP transport path documented in `issue-claims.md` / `claim-targets.md`'s gh-absent fallback.

## Acceptance Criteria

- A headless `next`-form dispatch hitting the in-flight stop files a self-report trace, not a misleading `bot:blocked` after burning retry-ceiling attempts.
- A `gh`-absent session reclaiming a `pr-opened:` tombstone with an open linked PR is stopped the same way the `gh`-CLI path stops it.

## Technical Approach

Widen `settle-and-merge.md`'s "Claim-contest special case" trigger condition to match on either the original claim-contest stop or the new in-flight-tombstone stop from #315 — both route to the same headless self-report path, since `flow/claim-targets.md` already documents them as behaving identically; the generic failure-check classifier should never see either. Separately, port #315's in-flight-PR check into `issue-claims.md`'s gh-absent MCP fallback steps: before a reclaim on that path, inspect the tombstone for a `pr-opened:` marker and, if present, resolve whether the linked PR is still open via the MCP transport's own read call, stopping the reclaim the same way the CLI path does. The two deliverables are independent — either can land without the other, though both are needed to fully close the gap #315 opened for the `gh`-CLI-only case.

### Key Files

- `plugin/skills/dispatch/settle-and-merge.md` — Claim-contest special case trigger condition
- `plugin/skills/_shared/issue-claims.md` — gh-absent MCP fallback steps 1-6
- `plugin/skills/flow/claim-targets.md` — documents the two stops as behaving identically; cross-reference target
- `plugin/bin/lib/claim-targets/claim-targets.js`, `claim-engine.js` — #315's existing CLI-path implementation, the reference behavior both fixes should match

## Gotchas

- Both gaps were found incidentally during a whole-branch review (v6.98.1→tip, while reviewing #944 alongside an unrelated batch merge) — this record's Current State evidence predates any fresh reproduction; the file:line citations above are the review's own findings, not independently re-verified here.
- The MCP fallback fix (Deliverable 2) has no CLI precedent to copy verbatim — the MCP transport's read call shape for checking whether a linked PR is still open needs to be derived from `issue-claims.md`'s existing MCP steps, not assumed identical to the `gh api` shape #315 used.
- Deferred as pre-existing-outside-diff: this defect predates and is unrelated to whatever diff surfaced it — no urgency tied to a specific in-flight change.

## Original request

In-flight-tombstone claim stop (#315) isn't wired into Settle's contest handling or the gh-absent MCP transport

## Current State

#315 added an in-flight-PR check to the CLI (`gh`) transport claim path in `plugin/bin/lib/claim-targets/claim-targets.js` / `claim-engine.js`, stopping a reclaim attempt when the target's tombstone links an open PR. Two gaps surfaced by the v6.98.1→tip whole-branch review (found while reviewing #944 alongside an unrelated batch merge):

1. `plugin/skills/dispatch/settle-and-merge.md`'s pre-existing "Claim-contest special case" (headless self-report trigger) only recognizes the literal claim-contest stop by name, not the new in-flight-tombstone stop — even though `flow/claim-targets.md` documents the two as behaving identically. A headless `next`-form dispatch hitting the new stop falls through to Settle's generic failure-check classifier instead, which isn't built for "this isn't a failure" cases.
2. The `gh`-absent MCP fallback path (`_shared/issue-claims.md` steps 1-6, referenced by `claim-targets.md`) still says to follow the pre-#315 steps "exactly as before this CLI existed" — no equivalent in-flight check exists on that path, so a `gh`-absent (cloud/Routine) session reclaiming a `pr-opened:` tombstone whose PR is still open reproduces the double-build race #315 was meant to prevent.

## Deliverables

- Extend the Claim-contest special case in `settle-and-merge.md` to also recognize the in-flight-tombstone stop, routing it to the same headless-self-report path instead of the generic failure-check classifier.
- Add the equivalent in-flight-PR check to the MCP transport path documented in `issue-claims.md` / `claim-targets.md`'s gh-absent fallback.

## Acceptance Criteria

- A headless `next`-form dispatch hitting the in-flight stop files a self-report trace, not a misleading `bot:blocked` after burning retry-ceiling attempts.
- A `gh`-absent session reclaiming a `pr-opened:` tombstone with an open linked PR is stopped the same way the `gh`-CLI path stops it.

Defer-reason: pre-existing-outside-diff

