# Staged: Propose digest cluster — [tidy] (3 entries)

Finding: [digest] digest container #1426 holds 3 un-promoted entries sharing area `tidy`. That clears the 3-entry threshold for cluster promotion.
Proposed: file one spec-shaped backlog record absorbing them, then append `→ #{new}` to each promoted entry line in #1426 (comment ids: 6300498053, 6305940364).

## Proposed record

**Title:** tidy: resolve 3 accumulated below-floor digest findings

### Current State
The materiality-floor digest (#1426) has accumulated 3 below-floor findings in the `tidy` area. Each was too small to file on its own, but together they make a coherent unit of work.

### Deliverables
- SKILL.md Action Vocabulary table has no Archive or Backfill rows (nor Step 7.5 verify lines) — step-6-auto.md's routing rows now carry their only execution recipe — plugin/skills/tidy/SKILL.md — Defer-reason: pre-existing-outside-diff — 2026-10-20T194221-record-3291
- github-pr-scan repo-wide item 1 treats CANCELLED/ACTION_REQUIRED rollup conclusions as failing while bin/lib/pr-checks/classify.js FAILING_CONCLUSIONS does not, so display and merge-gate readers disagree on a non-green rollup — plugin/skills/_shared/github-pr-scan.md, plugin/bin/lib/pr-checks/classify.js — Defer-reason: needs-human-decision — 2026-10-21T011735-record-3658
- github-pr-scan repo-wide item 1 runs pr-checks.js serially once per rollup-green open PR (up to 100), a wall-clock cost on large PR queues — plugin/skills/_shared/github-pr-scan.md — Defer-reason: needs-human-decision — 2026-10-21T011735-record-3658

### Acceptance Criteria
- Each Deliverable above is fixed, or explicitly ruled won't-fix with a one-line reason in the closing PR.
- Each promoted digest entry line in #1426 carries `→ #{this record}`.

## Commands
gh issue create --repo thn-inc/claude-tweaks --title "tidy: resolve 3 accumulated below-floor digest findings" --body-file <this proposal's Proposed record section>
