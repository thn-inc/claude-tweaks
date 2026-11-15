# Tidy — staged digest cluster: `run-liveness` area (3 entries) → new record

**Action:** Propose digest cluster — file one new spec-shaped record
**Container:** digest #1426
**Proposed title:** Settle 3 below-floor digest findings in run-liveness
**Proposed labels:** by:capture, type:task, priority:low (matching the existing per-area settle records #4398–#4416)
**Reversibility:** med (creates a GitHub issue plus comment-line markers)

No open settle record exists for `run-liveness` (searched open issues titled "Settle … below-floor digest findings").

## Proposed body

## Current State

Digest #1426 holds 3 un-promoted below-floor findings in the `run-liveness` area (`plugin/bin/lib/run-liveness/` and its resume-path callers), each deferred as pre-existing-outside-diff by a release-gate review.

## Deliverables

- death-witness predicate conjunction and the 72h LEGACY_DEAD_MS threshold carry no stated rationale — plugin/bin/lib/run-liveness/index.js:193, plugin/bin/lib/run-liveness/constants.js:10 — Defer-reason: pre-existing-outside-diff — 2026-10-24T152958-release-standalone (release v6.153.0 gate, staged/review-9.md)
- Resume paths (parentLiveDetail, checkResumeFreshness) run all five runLiveness probes but read only lock and last-commit; the owner-pid ps spawn and events.jsonl reads are discarded (bounded cost) — plugin/bin/lib/flow/consolidated-pass.js, plugin/bin/lib/hooks/resume-freshness.js — Defer-reason: pre-existing-outside-diff — 2026-10-27T074620-release-standalone
- ownEventAt reads and parses events.jsonl twice per call; with classifyRunDir's own ownEventRecency a stale interrupted run dir parses it three times per reconcile pass — plugin/bin/lib/run-liveness/probes.js — Defer-reason: pre-existing-outside-diff — 2026-10-27T074620-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is either fixed (with a test where behavior changes) or explicitly ruled won't-fix with a one-line reason in this record.

## Release Note

Internal cleanup in run-liveness; no user-visible change.

## Entries (verbatim from #1426)

1. comment 6386645770 — `[run-liveness]` death-witness predicate conjunction and the 72h LEGACY_DEAD_MS threshold carry no stated rationale — plugin/bin/lib/run-liveness/index.js:193, plugin/bin/lib/run-liveness/constants.js:10 — Defer-reason: pre-existing-outside-diff — 2026-10-24T152958-release-standalone (release v6.153.0 gate, staged/review-9.md) — `materiality-6a210b66`
2. comment 6436927443 — `[run-liveness]` Resume paths (parentLiveDetail, checkResumeFreshness) run all five runLiveness probes but read only lock and last-commit; the owner-pid ps spawn and events.jsonl reads are discarded (bounded cost) — plugin/bin/lib/flow/consolidated-pass.js, plugin/bin/lib/hooks/resume-freshness.js — Defer-reason: pre-existing-outside-diff — 2026-10-27T074620-release-standalone — `materiality-17f623f5`
3. comment 6436927443 — `[run-liveness]` ownEventAt reads and parses events.jsonl twice per call; with classifyRunDir's own ownEventRecency a stale interrupted run dir parses it three times per reconcile pass — plugin/bin/lib/run-liveness/probes.js — Defer-reason: pre-existing-outside-diff — 2026-10-27T074620-release-standalone — `materiality-d0bf65d0`

## Mutation on approval

1. Re-read the 3 entry lines (still un-marked) and re-check that no open settle record for `run-liveness` has appeared since staging.
2. File the record with the body above via `/claude-tweaks:capture`'s write path.
3. Append ` → #{new}` to each of the 3 entry lines in their #1426 comments (per-line markers).

## Decision-log reference

STAGED — Step 6: digest cluster `run-liveness` (3 entries) proposed as a new settle record. Stage path: staged/digest-promotion-4.md.
