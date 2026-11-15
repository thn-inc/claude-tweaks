# Tidy — staged digest cluster: `reflect` area (3 entries) → absorb into #4398

**Action:** Propose digest cluster, applied as an absorb into the existing open record rather than a new one
**Container:** digest #1426
**Target:** #4398 — "Settle 173 below-floor digest findings in reflect" (open, backlog)
**Reversibility:** med (outward GitHub body edit plus comment-line markers)

## Why absorb instead of filing a new record

`digest-sweep.md`'s cluster promotion files one new spec-shaped issue per area once 3+ un-promoted entries
share it. For `reflect`, #4398 already exists: it was filed 2026-10-26T11:40Z for every reflect-area entry up
to that point, and all of those carry `→ #4398` markers. A second "Settle 3 … in reflect" record would split
one area's settle work across two near-duplicate records. All three entries below were appended after #4398
was filed. Their materiality fingerprints do not appear in #4398's body (checked with `grep -c`, 0 hits).

## Entries (verbatim from #1426)

1. comment 6420862383 — `[reflect] reflect-1.md (no destination)`: after fix wave 43b8dfdb6, `skipUnderRoot` has no caller under `tests/`; the conformance scan now flags a file whose only guard is `skipUnderRoot(` — tests/helpers/root.js, tests/permission-sim-root-skip-conformance.test.js, docs/plugin-structure.md — `materiality-eb4fa613`
2. comment 6420862383 — `[reflect] reflect-1.md (no destination)`: scratchpad stub-skip-audit over the 6 installStub suites (22 MISMATCH skipped=false rows) — tests/reconcile.test.js, tests/bin-lib/reconcile/prune-remote.test.js, tests/bin-lib/reconcile/reap-merged.test.js — `materiality-b7b85f67`
3. comment 6423010174 — `[reflect] reflect-1.md (no destination)`: code-simplifier rewrote the new `countingWin32()` helper's comma-operator arrow during build Common Step 3 — tests/bin-lib/residue/probes-pipeline-runs.test.js — `materiality-96944e96`

## Mutation on approval

1. Re-read #4398 (still open) and the three entry lines (still un-marked).
2. Append the three entry lines verbatim as Deliverables bullets in #4398's `## Deliverables`, and update
   Current State's count from 173 to 176.
3. Append ` → #4398` to each of the three entry lines in their #1426 comments (per-line markers).

## Decision-log reference

STAGED — Step 6: digest cluster `reflect` (3 entries) proposed as an absorb into #4398 (an open settle record for the same area already exists). Stage path: staged/digest-promotion-1.md.
