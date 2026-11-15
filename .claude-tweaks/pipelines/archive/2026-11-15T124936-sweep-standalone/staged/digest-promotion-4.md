# Staged: Propose digest cluster — driver (6 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 6 below-floor digest findings in driver

## Current State

6 un-promoted digest entries in #5046 share the area `driver`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- The optional model value is passed after --model with no guard against a value beginning with -; the tiebreak could not tell whether the CLI reads such a value as an option (only trusted code sets it) — plugin/bin/lib/driver/roles.js:211 — Defer-reason: tiebreak-cant-tell — 2026-11-12T060404-spec-5217
- settle.js loads the whole express/cli module for one constant (ESCALATION_REASONS), so every steps.js load pulls the express CLI dependency tree; the clean fix moves the constant to express/policy.js and re-exports it from cli.js, which crosses record 5219's Non-Goal on express-lane code — plugin/bin/lib/driver/settle.js:17, plugin/bin/lib/express/cli.js:66 — Defer-reason: needs-human-decision — 2026-11-13T000400-spec-5219
- commitRuns dereferences ctx.check.head without the ctx.check guard pushStep and the config step use; a null ctx.check would turn a valid green/red CI read into read-failed with no error text (not reachable in the normal step order) — plugin/bin/lib/driver/steps.js — Defer-reason: needs-human-decision — 2026-11-13T064934-release-standalone
- driver-step-addition skill has no guidance for a step that re-runs other steps (commit, test, check and a second implementer launch) through a wiring object, as the review step's fix round does — plugin/bin/lib/driver/steps.js:1025, .claude/skills/driver-step-addition/SKILL.md — Defer-reason: tiebreak-cant-tell — 2026-11-13T093607-spec-5222
- The merge gate reads head-commit runs with gh run list --limit 100 and no truncation signal; a cut-off list can only miss runs on top of the rollup, and more than 100 runs on one head sha is not realistic — plugin/bin/lib/driver/merge.js:430, plugin/bin/ci-gate-record.js:163 — Defer-reason: pre-existing-outside-diff — 2026-11-14T210347-release-standalone
- MERGE_WATCH_BOUND_MS is defined as 15 * 60 * 1000 beside MERGE_GATE_WATCH_SECONDS, which calls itself the one code definition of the merge gate's watch; nothing ties the two, so derive one from the other — plugin/bin/lib/driver/merge.js:34, plugin/bin/lib/ci-health/constants.js:2 — Defer-reason: pre-existing-outside-diff — 2026-11-14T210347-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-8e5fc283 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6818591823
- materiality-fingerprint: materiality-2bf3c5eb — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6844459355
- materiality-fingerprint: materiality-5d026e4f — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6847524842
- materiality-fingerprint: materiality-fa79a8fd — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6872751167
- materiality-fingerprint: materiality-41362aac — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6885215314
- materiality-fingerprint: materiality-3c2428ef — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6885215314
