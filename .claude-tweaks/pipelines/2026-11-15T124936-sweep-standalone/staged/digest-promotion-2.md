# Staged: Propose digest cluster — review (12 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 12 below-floor digest findings in review

## Current State

12 un-promoted digest entries in #5046 share the area `review`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- Release-gate review coverage note: some modified test files outside the lens focus list were read only for test-count parity, not line by line (tiebreak can't-tell) — tests/bin-lib/express/eligibility.test.js — Defer-reason: tiebreak-cant-tell — 2026-11-12T134119-release-standalone
- SHARD_FACTS regex pins test.yml job key order and indentation instead of parsed YAML; a reorder of equivalent keys turns the conformance test red (loud false red only) — tests/verify-scope-declaration.test.js — Defer-reason: tiebreak-cant-tell — 2026-11-12T134119-release-standalone
- pre-tool-use.js teardown deny messages (lines 607, 639, 692-693) cite cleanup-procedures.md Section C, which lives in cleanup-procedures-execution.md — plugin/bin/lib/hooks/pre-tool-use.js, plugin/skills/wrap-up/cleanup-procedures.md — Defer-reason: pre-existing-outside-diff — 2026-11-12T134119-release-standalone
- driver/worker.js requires the generic Windows launchSpec from the impeccable-engine design module; move launchSpec to a neutral sibling module — plugin/bin/lib/driver/worker.js, plugin/bin/lib/impeccable-engine/index.js — Defer-reason: pre-existing-outside-diff — 2026-11-12T134119-release-standalone
- queue-pull module public surface is wide for the cutover (queuePull returns a re-read of two session files; makeContext, runPasses, defaultDeps and resolveOmit exported only for tests) — tiebreak could not verify its evidence — plugin/bin/lib/dispatch/queue-pull.js:1128 — Defer-reason: tiebreak-cant-tell — 2026-11-12T104256-spec-5227
- AC1.1 parity title says every other output matches the script while the matrix compares only the seven AC1_FILES (session intermediates compared on fault rows only) — tiebreak could not verify its evidence — tests/bin-lib/dispatch/queue-pull.test.js:2769 — Defer-reason: tiebreak-cant-tell — 2026-11-12T104256-spec-5227
- Tiebreak could not settle a positive observation: the whole-path-segment keyword branch in neutralize is pinned by a discriminating test (reported at the wrong line; the pin is run.test.js:91) — tests/bin-lib/driver/run.test.js:78 — Defer-reason: tiebreak-cant-tell — 2026-11-13T000404-record-5269
- Tiebreak could not settle: the driver neutralize linearity cases use absolute millisecond budgets, not ratio checks (reported at a line past the end of the file) — perf/driver-neutralize-linearity.test.js:313 — Defer-reason: tiebreak-cant-tell — 2026-11-13T000404-record-5269
- lens 3f: land.test.js bounded-remote-call loop iterates a filtered list with no non-emptiness floor (tiebreak cant-tell: vacuity claim not executed) — tests/bin-lib/learned-skills/land.test.js:702 — Defer-reason: tiebreak-cant-tell — 2026-11-13T005701-spec-5290
- Host-free owner/repo/issues/N form has no leftover-keyword pin: AC3's doesNotMatch uses LEFTOVER_KEYWORD_REFERENCE, which never matches /issues/N; the equality assertions still catch a regression — plugin/bin/lib/driver/events.js:123, tests/bin-lib/driver/run.test.js — Defer-reason: tiebreak-cant-tell — 2026-11-13T093429-spec-5352
- commondir is probed with statSync().isFile() and then read; a commondir removed between the two calls takes the ENOENT branch and uses the gitdir as the common dir (the tiebreak judged it harmless and matching git, but quoted a line outside the resolver's evidence band, so it stayed can't-tell) — plugin/bin/claude-tweaks-statusline.js:120 — Defer-reason: tiebreak-cant-tell — 2026-11-13T004054-spec-5266-5294/spec-5266
- ledger-write default-resolveBase env test supplies no gh fake, so the real gh repo view runs when policy and origin/HEAD are absent (tiebreak cant-tell: cited evidence outside the location band; the judge found the fixture repos have no remote, so the call always falls back) — tests/bin-lib/wrap-up/ledger-write.test.js — Defer-reason: tiebreak-cant-tell — 2026-11-15T070453-spec-5379

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-0741e675 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6825886345
- materiality-fingerprint: materiality-41677c9c — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6825886345
- materiality-fingerprint: materiality-d76aebf4 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6826003940
- materiality-fingerprint: materiality-e7d19105 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6826003940
- materiality-fingerprint: materiality-84574c4f — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6840625991
- materiality-fingerprint: materiality-a55fff64 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6840625991
- materiality-fingerprint: materiality-f1a1da37 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6842460241
- materiality-fingerprint: materiality-ca3ada4f — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6842460241
- materiality-fingerprint: materiality-93569b7e — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6849355078
- materiality-fingerprint: materiality-bfd7182f — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6860053564
- materiality-fingerprint: materiality-fbfc13c6 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6884664446
- materiality-fingerprint: materiality-d4e2a130 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6893913345
