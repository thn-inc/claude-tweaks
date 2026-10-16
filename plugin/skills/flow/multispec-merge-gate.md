# Multi-Spec — Merge-State Gate (#2733)

Loaded by `multi-spec.md`'s Validation step 4a, after dependency-aware ordering and before Step 2.8's claim.

## Decision

A target whose own `## Deliverables` or `## Prerequisites` text demands that one of its **in-run** `blocked-by` prerequisites already be **merged into the integration branch** cannot be satisfied inside a multi-spec run: every spec commits into one shared, unmerged branch, so that prerequisite is built there, never merged, before the dependent's build reads the demand. `/flow` therefore resolves the case itself — it never calls `AskUserQuestion` for it, in any mode — by splitting the target, and every in-run record that transitively depends on it, out of this run. The decision is derivable from record text, which is `_shared/auto-mode-contract.md`'s bar for resolving rather than asking.

Not split: the generic content-dependency phrasings — "must be merged first", "until #N is merged", "merged into this leaf's build base". Inside the shared branch the prerequisite's content lands ahead of the dependent's build, which is what those records need, and their builds re-verify by content. Splitting them would make decomposition families — multi-spec's main use — unrunnable as a batch.

Evidence (2087-record corpus, 2026-10-16): any ref-plus-"merged" line matched 75 records (state literals, titles, residue rows); merge-requirement verb forms 40, mostly decomposition-family rows; the strict class below 6, five genuine once restricted to in-run blockers — #2682 (the incident: "confirm #2670 and #2681 are actually merged (not merely CLOSED)"), #1989, #2466, #530, #595.

## Signal

`plugin/bin/lib/preflight-records/merge-gate.js`'s `MERGE_STATE_RE` — "actually merged", or "merge(s/d) to/into main / origin/main / the integration branch" — on a line inside the target's `## Deliverables` or `## Prerequisites` section that names one of the target's own `blocked-by` prerequisites that is also in this run.

## Procedure

1. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/preflight-records.js" {targets in run order} --merge-gate [--repo owner/name]` — the run's targets only, never the claim step's open-queue extras — and read `mergeGate`.
2. `deferred` empty → no-op, write nothing.
3. Otherwise, before Step 2.8 claims anything: continue with `kept` as the run's target list (one remaining record → an ordinary single-record run). Once the run directory exists, write one `AUTO` entry per `_shared/auto-decision-log.md`: `AUTO {time} — Step 1: merge-state gate split #{deferred…} out of the run (#{record} requires #{requires} merged to the integration branch). Re-run after the merge: {rerun}. Reversibility: high.`
4. Print the same re-run command as a Pipeline Preview footer line: `Deferred until #{requires} merges: {rerun}`.

A deferred record is never claimed, so nothing needs releasing.
