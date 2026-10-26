# Staged: Propose digest cluster — verify (7 entries)

**Source:** digest container #1426, 7 un-promoted entries sharing `{area}` = `verify`.

**Proposed:** file one backlog record absorbing them; on approval append `→ #{new}` to each promoted entry line in #1426.

## Proposed record: Settle 7 below-floor digest findings in verify

### Current State

Digest #1426 holds 7 below-materiality-floor findings in `verify`, accumulated by review/reflect/wrap-up runs and never promoted.

### Deliverables

- [verify] info: second hand-rolled porcelain parser beside lib/git-z.js; pre-existing, outside this delta — plugin/bin/lib/verify/changed-files.js:121 — Defer-reason: console-backfill-confirmed-low — 2026-10-16T222103-record-2987/spec-3002
- [verify] DECLARATION_PATH literal also at verify.js:840 and init-verify-scope.js:121 — plugin/bin/lib/verify/declaration.js:18 — Defer-reason: console-backfill-confirmed-low — 2026-10-16T222103-record-2987/spec-3002
- [verify] --untracked-files=all pinned by argv only — plugin/bin/lib/verify/report.js:29 — Defer-reason: console-backfill-confirmed-low — 2026-10-16T222103-record-2987/spec-3002
- [verify] runImpactFetch spawnSync shell timeout kills only the sh, not the fetch it spawned (unlike run.js runOne/killTree) — plugin/bin/verify.js:111 — Defer-reason: pre-existing-outside-diff — 2026-10-24T152958-release-standalone (release v6.153.0 gate, staged/review-17.md)
- [verify] unanchored selectScope reads ctx.problem only to name a fallback label, forcing the lazy map read, HEAD test listing and possibly the 120 s fetch — plugin/bin/lib/verify/scope.js:59 — Defer-reason: pre-existing-outside-diff — 2026-10-24T152958-release-standalone (release v6.153.0 gate, staged/review-21.md)
- [verify] the && !subset term that keeps an impact-subset run from being stamped full has no comment — plugin/bin/lib/verify/scope.js:106 — Defer-reason: pre-existing-outside-diff — 2026-10-24T152958-release-standalone (release v6.153.0 gate, staged/review-22.md)
- [verify] the "only a full run advances fullSha" invariant text is stale after #4024 (an unanchored impact run writes fullSha = merge-base) — plugin/bin/verify.js:1079, docs/plugin-structure.md — Defer-reason: pre-existing-outside-diff — 2026-10-24T152958-release-standalone (release v6.153.0 gate, staged/review-23.md)

### Acceptance Criteria

- Each Deliverables entry is fixed, or explicitly dropped with a one-line reason in this record.
- Each promoted entry line in #1426 carries `→ #{this record}`.
