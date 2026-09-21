---
record: 769
origin: human
risk: low
size: low
ceremony: fast-lane
grants: [build]
surface: backend
---
# 769: flow/build should document deferring a live side-effecting verification AC to a Manual Step during autonomous runs

Surface: backend

## Current State

#683's AC4 asked for a live create-worktree/commit/PR/merge/teardown verification cycle against this actual repo. Executing it inline during an autonomous 6-record run — a real side-effecting PR/merge/branch-delete against the shared repo, concurrent with five other in-flight records sharing the same branch/PR state — was judged too risky and deferred to the closing Pipeline Summary's "Manual Steps Required" table instead. This judgment call came from the operator's own general risk-calibration instructions, not from any claude-tweaks-documented convention — nothing in `/claude-tweaks:build` or `/claude-tweaks:flow`'s own prose currently states when an AC requiring a live, hard-to-reverse, shared-state-affecting verification should be deferred rather than executed, so a future autonomous run has no documented rule to reach the same conclusion by, and might instead attempt the risky action inline.

## Deliverables

`/claude-tweaks:build`'s AC-verification step (or `_shared/auto-mode-contract.md`) names a class of AC — one whose verification is itself a real, side-effecting, hard-to-reverse action against shared state (a live PR/merge/delete cycle, an irreversible external API call) — that is never executed inline during an autonomous run, always deferred to the closing summary's Manual Steps table. Cite #683 as the worked example.

## Acceptance Criteria

- `/claude-tweaks:build`'s AC-verification step (or `_shared/auto-mode-contract.md`) documents the deferred-live-verification class of AC, with #683 as the worked example.
- An autonomous run encountering an AC in this class defers it to the Manual Steps table rather than executing the side-effecting action inline.
- The documented rule is general (any live, hard-to-reverse, shared-state-affecting verification), not scoped narrowly to worktree/PR/merge cycles specifically.

## Technical Approach

Add the convention to whichever of `/claude-tweaks:build`'s AC-verification step or `_shared/auto-mode-contract.md` already owns the "what gets deferred vs. executed during auto mode" distinction — this is a documentation addition describing a judgment class, not new executable logic.

## Gotchas

- This is a narrow, low-risk doc addition — the risk is entirely in getting the class definition precise enough to generalize past the worktree/PR/merge example that surfaced it.

## Original request

flow/build should document deferring a live side-effecting verification AC to a Manual Step during autonomous runs

# Reflect (batch) — staged finding 2

**Category:** tangential
**Severity:** low
**Reversibility:** high
**Source:** full mode, Tradeoff Review

## Finding

#683's AC4 asked for a live create-worktree/commit/PR/merge/teardown verification cycle against this actual repo. Executing it inline during this autonomous 6-record run — a real side-effecting PR/merge/branch-delete against the shared repo, concurrent with five other in-flight records sharing the same branch/PR state — was judged too risky and deferred to the closing Pipeline Summary's "Manual Steps Required" table instead. This judgment call came from the operator's own general risk-calibration instructions, not from any claude-tweaks-documented convention — nothing in `/claude-tweaks:build` or `/claude-tweaks:flow`'s own prose currently states when an AC requiring a live, hard-to-reverse, shared-state-affecting verification should be deferred rather than executed, so a future autonomous run has no documented rule to reach the same conclusion by, and might instead attempt the risky action inline.

## Suggested resolution

A small record: `/claude-tweaks:build`'s AC-verification step (or `_shared/auto-mode-contract.md`) should name a class of AC — one whose verification is itself a real, side-effecting, hard-to-reverse action against shared state (a live PR/merge/delete cycle, an irreversible external API call) — that is never executed inline during an autonomous run, always deferred to the closing summary's Manual Steps table. Cite #683 as the worked example.

## Decision-log reference

STAGED — batch reflect Step 3 (Tradeoff Review, full mode): backlog candidate, deferred-live-verification convention gap. Stage path: staged/reflect-2.md.

