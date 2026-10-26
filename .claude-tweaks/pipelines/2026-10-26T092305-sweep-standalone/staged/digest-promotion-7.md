# Staged: Propose digest cluster — bin (15 entries)

**Source:** digest container #1426, 15 un-promoted entries sharing `{area}` = `bin`.

**Proposed:** file one backlog record absorbing them; on approval append `→ #{new}` to each promoted entry line in #1426.

## Proposed record: Settle 15 below-floor digest findings in bin

### Current State

Digest #1426 holds 15 below-materiality-floor findings in `bin`, accumulated by review/reflect/wrap-up runs and never promoted.

### Deliverables

- [bin] verify.js turns on continueSuitesAfterFailure for every failing --baseline run, even when adjudication is certain to refuse (failed check has no template, or the base already contains HEAD) — extra suite runtime for no verdict; predicting refusal up front means mirroring baseline.js eligibility — plugin/bin/verify.js, plugin/bin/lib/verify/run.js — Defer-reason: genuinely-larger — 2026-10-19T194624-record-3511
- [bin] tool-scoped --scope with --cmd-env tests=... and no --cmd tests is not picked up by envOf(tests); predates #3511 — plugin/bin/verify.js — Defer-reason: pre-existing-outside-diff — 2026-10-19T194624-record-3511
- [bin] No claim recoverable (claim-empty): lens "3a" finding plugin/bin/console-residue.js:107 not reproduced. — plugin/bin/console-residue.js:107 — Defer-reason: console-backfill-no-claim — 2026-10-21T063157-spec-3783
- [bin] No claim recoverable (claim-empty): lens "3b" finding plugin/bin/console-residue.js:118 not reproduced. — plugin/bin/console-residue.js:118 — Defer-reason: console-backfill-no-claim — 2026-10-21T063157-spec-3783
- [bin] No claim recoverable (claim-empty): lens "3f" finding plugin/bin/console-residue.js:178 not reproduced. — plugin/bin/console-residue.js:178 — Defer-reason: console-backfill-no-claim — 2026-10-21T063157-spec-3783
- [bin] No claim recoverable (claim-empty): lens "3f" finding plugin/bin/verify.js:241 (nonexistent --cwd untested) not reproduced. — plugin/bin/verify.js:241 — Defer-reason: console-backfill-no-claim — 2026-10-20T194242-record-3799
- [bin] info: the moved signal is absent from report.json — plugin/bin/verify.js:548 — Defer-reason: tiebreak-cant-tell — 2026-10-20T173132-record-3757
- [bin] gh pr diff on an over-limit PR exits 3 with no constant fallback — plugin/bin/lib/compose-subject.js:319 — Defer-reason: console-backfill-confirmed-low — 2026-10-17T184419-spec-3298
- [bin] (rawModel interpolated into a markdown table cell unescaped (also lens 3c info at :184)). — plugin/bin/phase-timing.js:182 — Defer-reason: console-backfill-confirmed-low — 2026-10-17T144508-spec-3375-3380/spec-3375
- [bin] 'no transcript resolved' dispatches branch untested — plugin/bin/phase-timing.js:223 — Defer-reason: console-backfill-confirmed-low — 2026-10-17T144508-spec-3375-3380/spec-3375
- [bin] (unmapped '(raw: ...)' row label not asserted). — plugin/bin/phase-timing.js:184 — Defer-reason: console-backfill-confirmed-low — 2026-10-17T144508-spec-3375-3380/spec-3375
- [bin] new require sits mid-file, not in the top require block. — plugin/bin/materialize.js:105 — Defer-reason: console-backfill-confirmed-low — 2026-10-17T101500-spec-3358
- [bin] AC1 "materialize.js no longer defines its own copy" has no test. — plugin/bin/materialize.js:105 — Defer-reason: console-backfill-confirmed-low — 2026-10-17T101500-spec-3358
- [bin] no test pins that `bin/preflight-records.js`'s `--records-json` path skips `deps.remoteUrl()` / repo resolution. The spec's Technical Approach says to skip it there, and a future `deps.remoteUrl()` ca — bin/preflight-records.js — Defer-reason: tiebreak-cant-tell — 2026-10-17T095806-spec-3351
- [bin] no test puts a directory at the default declaration path — plugin/bin/verify.js:212 — Defer-reason: console-backfill-confirmed-low — 2026-10-24T121315-spec-4006

### Acceptance Criteria

- Each Deliverables entry is fixed, or explicitly dropped with a one-line reason in this record.
- Each promoted entry line in #1426 carries `→ #{this record}`.
