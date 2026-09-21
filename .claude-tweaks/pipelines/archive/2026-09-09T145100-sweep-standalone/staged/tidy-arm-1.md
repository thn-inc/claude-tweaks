# Staged: Arm ready PR (record-linked) — PR #1908

**Finding:** `[pr-unarmed] PR #1908: plan-audit: Check C needs a "Step 2 present but unparseable" verdict` — non-draft, green (SUCCESS/SKIPPED), 0 unresolved threads, updated 2026-09-08T09:08Z (>24h), carries the `<!-- claude-tweaks-run: -->` marker, `autoMergeRequest` null. Linked record #1594 carries `auto:build,auto:merge` (granted).

**Proposed:** Arm PR #1908 for auto-merge (`_shared/pr-first-merge.md` Step 3).

**Why staged:** `step-6-auto.md`'s record-linked Arm ready PR row is Stage at every tier — an already-granted, already-green PR that never armed is itself an anomaly the dispatch pipeline should have caught.

**Re-verify before writing (`tidy/actions-github-issues.md` § Arm ready PR):** re-fetch `isDraft`, `statusCheckRollup`, `autoMergeRequest`, unresolved thread count, and #1594's `auto:merge` label fresh; any gate no longer holding → silent no-op.

**Command:**
gh pr merge 1908 --auto --repo thomasholknielsen/claude-tweaks
