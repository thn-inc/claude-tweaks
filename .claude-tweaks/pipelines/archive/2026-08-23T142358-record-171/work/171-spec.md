---
record: 171
origin: human
risk: medium
size: medium
ceremony: standard
grants: [build, merge]
surface: backend
---
# 171: code-health lacks the durable wontfix slice its three siblings got in 6.51.1 — close the fork or document it

Surface: backend

## Current State

code-health's dedup engine (`bin/lib/code-health/dedup.js`) runs its own `decide()` rather than `health-core`'s, because it needs a `threshold`/`risk` comparison and a `remember` action the shared propose-then-approve vocabulary has no equivalent for. It also constructs `createDurableState('code-health', { includeRemembered: true })` without `includeDeclined`, unlike harness-health, journey-health, and docs-health — which received the durable-`wontfix` fix in #163/#164 (6.51.1, `health-core/mark.js`'s `mergeWontfixIntoDeclined`, fed by `validate-findings-dispatch.js`'s `wontfixSuppressed` hand-off).

code-health persists `status: 'wontfix'` to its own local, gitignored cache (`code-health/SKILL.md:86`), which is sufficient for repeat local runs but explicitly not durable across a scheduled cloud-Routine firing's container recycling (`bin/lib/code-health/cache.js:6-14` states this in its own header comment). In an unattended Routine firing — the exact environment #163 targets — the cache is empty on every firing, so a `wontfix` label applied before the container existed, or applied while GitHub is unreachable, contributes nothing to suppression. code-health received the MCP transport fix in 6.51.1 (covers `gh` being absent) but not the durability half (covers GitHub being unreachable outright, or a pre-existing `wontfix`).

## Deliverables

Decide, and act on, exactly one of the following:

- **Close the fork** — add `includeDeclined: true` to code-health's `createDurableState('code-health', ...)` call; add the cache-level `wontfix` check's durable twin to `decide()` (`bin/lib/code-health/dedup.js`); route `wontfixSuppressed` through code-health's own equivalent of `buildValidateFindingsUpdate` the way harness-health/journey-health/docs-health already do.
- **Accept the fork** — record in `code-health/SKILL.md` and `_shared/health-issue-index.md` that code-health's headless suppression rests on the MCP transport fix alone (not the durable-`declined`-slice mechanism its three siblings use), so the asymmetry reads as a deliberate, documented design choice rather than an oversight nobody noticed.

## Acceptance Criteria

- [ ] One of the two options above is chosen and implemented in full — not a partial application of either.
- [ ] If closing the fork: `bin/lib/code-health/cache.js`'s `createDurableState` call includes `includeDeclined: true`; `dedup.js`'s `decide()` has a durable-`wontfix` check parallel to its existing cache-level check; a `wontfix` label applied to an issue survives a simulated cold-container firing (empty local cache) and still suppresses the corresponding finding.
- [ ] If accepting the fork: `code-health/SKILL.md` and `_shared/health-issue-index.md` both state explicitly that code-health's headless `wontfix` suppression is MCP-transport-only, distinct from the durable-`declined`-slice mechanism used by harness-health/journey-health/docs-health, and name the tradeoff (a `wontfix` applied before a container existed, or during a GitHub outage, is not honored).
- [ ] Existing code-health dedup tests continue to pass; if closing the fork, new test coverage exercises the durable-suppression path the way the three siblings' `mergeWontfixIntoDeclined` coverage does.

## Technical Approach

Read `bin/lib/code-health/dedup.js`'s and `bin/lib/code-health/cache.js`'s header comments in full before choosing — they already document why `decide()` diverges from `health-core`'s shared vocabulary. If closing: mirror the #163/#164 fix pattern (`health-core/mark.js`'s `mergeWontfixIntoDeclined`, `validate-findings-dispatch.js`'s `wontfixSuppressed` hand-off) but adapt it to code-health's `threshold`/`risk`/`remember` vocabulary rather than copying the shared propose-then-approve shape verbatim — that mismatch is exactly why #163/#164 scoped code-health out in the first place. If accepting: the documentation lives in two places (`code-health/SKILL.md` and `_shared/health-issue-index.md`) and both need the same statement, not just one.

## Gotchas

- This decision has no default — the record's own author states "Either is defensible. What is not defensible is the current state." Resolving it silently in one direction without recording the reasoning re-creates the exact problem this record exists to close.
- Widening `decide()`'s durable-state handling risks re-introducing the scope creep #163/#164 deliberately avoided (that fix was scoped to three skills specifically to avoid touching code-health's more divergent contract) — if closing the fork, keep the change additive to `decide()`'s existing shape rather than restructuring it toward `health-core`'s.

## Original request

code-health lacks the durable wontfix slice its three siblings got in 6.51.1 — close the fork or document it

**Origin:** `/claude-tweaks:wrap-up` reflection on the #163/#164 fix (6.51.1). Surfaced while verifying #163's premise; deliberately left out of that fix's scope, which the issue scoped to three skills.

## The gap

#163 established that a `wontfix` label read off the live issue index is lost on any later firing that cannot rebuild the index. It was fixed for `harness-health`, `journey-health` and `docs-health` by persisting label-derived suppressions to the durable `declined` slice on the `health-state` branch (`health-core/mark.js`'s `mergeWontfixIntoDeclined`, fed by `validate-findings-dispatch.js`'s `wontfixSuppressed` hand-off).

`code-health` was excluded from that issue on the grounds that it already persists `status: 'wontfix'` to its local cache (`code-health/SKILL.md:86`). That is true, and it is sufficient for repeat **local** runs. It is not sufficient headless — from `bin/lib/code-health/cache.js:6-14`, the module's own header:

> Local, gitignored: cache.json only … rebuildable from `gh issue list`, so it's fine to stay local/ephemeral … local disk doesn't survive a scheduled cloud-routine firing's container recycling between runs.

So in an unattended Routine firing — the environment #163 is about — code-health's cache is empty on every firing and its wontfix fallback contributes nothing. By #163's own criterion code-health is affected too; it is only unaffected locally.

6.51.1 gave it the MCP transport fix (which covers `gh` being absent). What it still lacks is the durability half, which covers GitHub being unreachable outright, or a `wontfix` applied before this container existed.

## Why it wasn't just done

`code-health` runs its own `decide()` (`bin/lib/code-health/dedup.js`) rather than `health-core`'s, because it needs a `threshold`/`risk` comparison and a `remember` action that the shared propose-then-approve vocabulary has no equivalent for — see both files' header comments. It also constructs `createDurableState('code-health', { includeRemembered: true })` **without** `includeDeclined`, unlike its three siblings. So this is not a one-line change, and widening it inside a fix scoped to three other skills would have been scope creep on the engine with the most divergent contract.

## Ask

Decide whether to close the fork or accept it:

- **Close it** — add `includeDeclined: true` to code-health's durable state, add the cache-level `wontfix` check's durable twin to its `decide()`, and route `wontfixSuppressed` through its `buildValidateFindingsUpdate` the way the other three now do.
- **Accept it** — record in `code-health/SKILL.md` and `_shared/health-issue-index.md` that code-health's headless suppression rests on the MCP transport alone, so the asymmetry is deliberate and documented rather than an oversight nobody noticed.

Either is defensible. What is not defensible is the current state, where the asymmetry exists and only this record says so.

