# Staged: Propose digest cluster — review (5 entries)

**Container:** #1426 (digest)
**Proposed record title:** Settle 5 below-floor digest findings in review

## Current State

5 un-promoted digest entries in #1426 share the area `review`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- tiebreak can't-tell (3f): the 'wrote no background status' assertion in the reconcile-background/reconcile-summary refusal test cannot discriminate for reconcile-summary (only reconcile-background writes the status file); HEAD-unchanged is that verb's real check — tests/hooks-js-flag-strict.test.js:194 — Defer-reason: tiebreak-cant-tell — 2026-11-01T073629-spec-4777
- tiebreak can't-tell (3f): the reconcile --dryrun refusal test asserts cache absence and HEAD unchanged but not the plan-named run-dir-still-present / nothing-archived effects (likely non-discriminating in that fixture) — tests/hooks-js-flag-strict.test.js:138 — Defer-reason: tiebreak-cant-tell — 2026-11-01T073629-spec-4777
- github-pr-scan.md item 10 builds PR_NOTE from OLDEST_PR, which assumes gh pr list returns the newest-created PRs first; the fence carries no comment naming that ordering or why createdAt is the key (tiebreak could not settle whether the note is worth a fix; the cited Math.min makes the computation order-independent) — plugin/skills/_shared/github-pr-scan.md — Defer-reason: tiebreak-cant-tell — 2026-11-01T231622-record-4820
- tiebreak could not verify a test-scoping note: the in-process unusable-stderr test stubs fs.writeSync and the verb run() globally, restored in finally (judge read it as sound; evidence quote too short to verify) — tests/hooks-verb-exception-exit.test.js:105 — Defer-reason: tiebreak-cant-tell — 2026-11-02T063216-spec-4932
- the Step 2 merge-provenance git commands substitute {branch} and {integration-branch} into the shell line unquoted, and git ref names can carry shell metacharacters (shared quoting rule needed across the Step 2 fences) — plugin/skills/review/merge-provenance-check.md — Defer-reason: genuinely-larger — 2026-11-02T111211-record-4639

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #1426 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-0519809e (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6561637844)
- materiality-f4f4a545 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6561637844)
- materiality-3d60b6e6 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6566896366)
- materiality-94a2b12b (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6572371283)
- materiality-854208e4 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6577529331)
