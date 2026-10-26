# Staged: Propose digest cluster — wrap-up (6 entries)

**Source:** digest container #1426, 6 un-promoted entries sharing `{area}` = `wrap-up`.

**Proposed:** file one backlog record absorbing them; on approval append `→ #{new}` to each promoted entry line in #1426.

## Proposed record: Settle 6 below-floor digest findings in wrap-up

### Current State

Digest #1426 holds 6 below-materiality-floor findings in `wrap-up`, accumulated by review/reflect/wrap-up runs and never promoted.

### Deliverables

- [wrap-up] wrap-up-engine.js finish-console comment (~line 560) claims a re-run re-derives state instead of duplicating it, but decisions.md is append-only so a re-run duplicates the step-2 lines — plugin/bin/wrap-up-engine.js — Defer-reason: pre-existing-outside-diff — 2026-10-19T232504-record-3512
- [wrap-up] No claim recoverable (claim-empty): lens "3c" finding plugin/bin/lib/wrap-up/verify-results.js:35 not reproduced. — plugin/bin/lib/wrap-up/verify-results.js:35 — Defer-reason: console-backfill-no-claim — 2026-10-21T063157-spec-3783
- [wrap-up] sdd-ruling apply quotes user clause into Resolution without a pipe-rule cite — plugin/skills/wrap-up/review-console-appendix.md:76 — Defer-reason: console-backfill-confirmed-low — 2026-10-19T232504-record-3512
- [wrap-up] a cell ending in a literal backslash written with no padding space before the delimiter merges columns; writers always pad, so only hand-authored rows reach it — plugin/bin/lib/wrap-up/ledger-cells.js:9 — Defer-reason: console-backfill-confirmed-low — 2026-10-19T232504-record-3512
- [wrap-up] (low: resolveRiskFloor swallows every readFileSync error, not only ENOENT, so an unreadable policy.yml silently resolves to the default high floor) . Note: matches the house pattern (wrap-up/pack.js d — plugin/bin/lib/wrap-up/engine-verify.js:735 — Defer-reason: console-backfill-confirmed-low — 2026-10-17T202735-record-3222
- [wrap-up] (keyFiles = touched files only; no consumer-grep step per IL-132) . md. — plugin/skills/wrap-up/leftover-routing.md:40 — Defer-reason: console-backfill-confirmed-low — 2026-10-17T194123-record-2975

### Acceptance Criteria

- Each Deliverables entry is fixed, or explicitly dropped with a one-line reason in this record.
- Each promoted entry line in #1426 carries `→ #{this record}`.
