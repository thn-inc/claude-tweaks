# Tidy — staged digest cluster: `tests` area (3 entries) → absorb into #4400

**Action:** Propose digest cluster, applied as an absorb into the existing open record rather than a new one
**Container:** digest #1426
**Target:** #4400 — "Settle 61 below-floor digest findings in tests" (open)
**Reversibility:** med (outward GitHub body edit plus comment-line markers)

## Why absorb instead of filing a new record

`digest-sweep.md`'s cluster promotion files one spec-shaped issue per area once 3+ un-promoted entries share it. For `tests`, #4400 already exists as the open settle record for this area, and filing a second one would split one area's settle work across two near-duplicate records. None of the 3 entries' materiality fingerprints appear in #4400's body (checked at staging time).

## Entries (verbatim from #1426)

1. comment 6436927443 — `[tests]` Live owner-pid fixture precondition is guarded by if (owner.pidStartedAt), which is always false on win32, so the owner-pid positive arm runs unchecked there instead of being skipped with a reason — tests/bin-lib/flow/consolidated-pass.test.js, tests/hooks-resume-freshness.test.js — Defer-reason: pre-existing-outside-diff — 2026-10-27T074620-release-standalone — `materiality-b3378650`
2. comment 6436927443 — `[tests]` cloud-setup-drift-check stub tests skip via a per-file SH_STUB_SKIP constant (the last one under tests/) instead of STUB_SKIP from tests/helpers/path-stub.js; its local skip reason is also partly inaccurate — tests/cloud-setup-drift-check.test.js — Defer-reason: pre-existing-outside-diff — 2026-10-27T074620-release-standalone — `materiality-12c1f92f`
3. comment 6436927443 — `[tests]` run-liveness callers conformance scan hard-codes helper names classifyRunDir/lastOwnEventMs (info: deliberate anti-vacuity guard, rename fails loudly by design) — tests/run-liveness-callers-conformance.test.js — Defer-reason: pre-existing-outside-diff — 2026-10-27T074620-release-standalone — `materiality-f647e157`

## Mutation on approval

1. Re-read #4400 (still open) and the 3 entry lines (still un-marked).
2. Append the 3 entry lines verbatim as Deliverables bullets in #4400's `## Deliverables`, and update its title/Current State count from 61 to 64.
3. Append ` → #4400` to each of the 3 entry lines in their #1426 comments (per-line markers).

## Decision-log reference

STAGED — Step 6: digest cluster `tests` (3 entries) proposed as an absorb into #4400 (an open settle record for the same area already exists). Stage path: staged/digest-promotion-3.md.
