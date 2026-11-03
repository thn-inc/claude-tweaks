# Tidy — staged digest cluster: `reconcile` area (3 entries) → absorb into #4403

**Action:** Propose digest cluster, applied as an absorb into the existing open record rather than a new one
**Container:** digest #1426
**Target:** #4403 — "Settle 15 below-floor digest findings in reconcile" (open)
**Reversibility:** med (outward GitHub body edit plus comment-line markers)

## Why absorb instead of filing a new record

`digest-sweep.md`'s cluster promotion files one spec-shaped issue per area once 3+ un-promoted entries share it. For `reconcile`, #4403 already exists as the open settle record for this area, and filing a second one would split one area's settle work across two near-duplicate records. None of the 3 entries' materiality fingerprints appear in #4403's body (checked at staging time).

## Entries (verbatim from #1426)

1. comment 6436927443 — `[reconcile]` archive-merged.js defines a seventh module-private isPlainObject copy; run-liveness/index.js and five other plugin/bin modules carry identical helpers with no shared export — plugin/bin/lib/reconcile/archive-merged.js — Defer-reason: pre-existing-outside-diff — 2026-10-27T074620-release-standalone — `materiality-45e8ad60`
2. comment 6436927443 — `[reconcile]` defaultRunVerdict spawns git worktree list per candidate interrupted run via the default lockInUse probe although archiveMerged already holds the worktree list; uncached and re-probed every pass — plugin/bin/lib/reconcile/archive-merged.js — Defer-reason: pre-existing-outside-diff — 2026-10-27T074620-release-standalone — `materiality-8e0d7113`
3. comment 6436927443 — `[reconcile]` countOwnerlessNonClean makes a second full iterRunDirsWithState pass after the archive loop (info: deliberate per the #4421 comment, count taken after archival) — plugin/bin/lib/reconcile/archive-merged.js — Defer-reason: pre-existing-outside-diff — 2026-10-27T074620-release-standalone — `materiality-6f39e54f`

## Mutation on approval

1. Re-read #4403 (still open) and the 3 entry lines (still un-marked).
2. Append the 3 entry lines verbatim as Deliverables bullets in #4403's `## Deliverables`, and update its title/Current State count from 15 to 18.
3. Append ` → #4403` to each of the 3 entry lines in their #1426 comments (per-line markers).

## Decision-log reference

STAGED — Step 6: digest cluster `reconcile` (3 entries) proposed as an absorb into #4403 (an open settle record for the same area already exists). Stage path: staged/digest-promotion-2.md.
