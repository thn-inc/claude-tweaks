# Staged: Propose digest cluster — dispatch (8 entries)

**Container:** #1426 (digest)
**Proposed record title:** Settle 8 below-floor digest findings in dispatch

## Current State

8 un-promoted digest entries in #1426 share the area `dispatch`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- listRunDirsFailClosed re-derives the main-checkout pipelines-dir anchor that hooks/context.js already builds in iterRunDirsWithState and findNonCanonicalRunDirs, so the fail-closed probe and the listing it guards agree only while three copies of one expression stay identical (a shared anchor helper or a fail-closed option on the listing would remove the copy) — plugin/bin/dispatch-resume.js:119, plugin/bin/lib/hooks/context.js:251 — Defer-reason: genuinely-larger — 2026-11-02T024954-record-4809
- stuck-open-prs repeats the claim read, gh repo view and git worktree list per candidate with no shared cache — plugin/bin/stuck-open-prs.js — Defer-reason: pre-existing-outside-diff — 2026-11-02T063520-release-standalone
- stuck-open-prs consumes dispatch-resume in process by capturing stdout and re-parsing JSON instead of receiving the verdict as data — plugin/bin/stuck-open-prs.js — Defer-reason: pre-existing-outside-diff — 2026-11-02T063520-release-standalone
- NO_ROW_REASONS copies resume-eligibility refusal reasons with no test pinning it to REFUSAL_REASONS — plugin/bin/lib/dispatch/stuck-open-pr.js — Defer-reason: pre-existing-outside-diff — 2026-11-02T063520-release-standalone
- runVerdict relies on selected.ok implying a non-null prior with no comment stating the invariant — plugin/bin/dispatch-resume.js — Defer-reason: pre-existing-outside-diff — 2026-11-02T063520-release-standalone
- two more readers take the header `record:` from the whole file, so a spec body line quoting the key can name the wrong record (the same defect #4814 fixed in pack.js and the Section C fence) — plugin/bin/lib/dispatch/first-call-artifact-check.js:116, plugin/skills/tidy/issue-claims-backstops.md:105 — Defer-reason: pre-existing-outside-diff — 2026-11-02T075725-record-4814
- listRunDirsFailClosed copies iterRunDirsWithState's pipelines-dir anchor; a failClosed option on the shared iterator would remove the twin — plugin/bin/dispatch-resume.js:136, plugin/bin/lib/hooks/context.js:250 — Defer-reason: pre-existing-outside-diff — 2026-11-02T110901-release-standalone
- boundRunConflict skips a run dir with unreadable run-state.json (documented exception) where sibling branches refuse unknown-owner — plugin/bin/dispatch-resume.js:404 — Defer-reason: pre-existing-outside-diff — 2026-11-02T110901-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #1426 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-b40a0ed8 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6568865115)
- materiality-a7a1e322 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571133505)
- materiality-97e08c8a (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571133505)
- materiality-e13c7dc8 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571133505)
- materiality-cf09c5c9 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571133505)
- materiality-a47c7788 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6573251738)
- materiality-b5c9bb8c (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6576257391)
- materiality-f23f63eb (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6576257391)
