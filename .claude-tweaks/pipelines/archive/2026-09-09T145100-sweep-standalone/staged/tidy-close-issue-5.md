# Staged: Close (GitHub) — dispatch headless self-reports already fixed upstream

**Finding:** `[gh-issue]` records auto-filed by `/claude-tweaks:dispatch`'s headless self-report (`by:dispatch`, markers `flow-step-2.8-claim-in-flight` / `flow-step-2.8-claim-contest`) from plugin build 6.111.0, each reporting that the queue pull re-dispatched a record whose claim tombstone named a still-open PR. That gap shipped as #1224 (closed 2026-09-06): `dispatch/queue-pull-script.md` now runs `record.js`'s `partitionByOpenLinkedPR` unconditionally and removes any candidate with an open linked PR from `dispatch-groups.json` before selection. Each row's subject record is closed and its PR merged.

**Proposed:** Close each as completed — implemented by #1224.

**Why staged:** closing a `github-issues` record is an outward-facing write, Stage at every tier.

**Rows:**
- #1740 — subject #833 (CLOSED), PR #1727 MERGED 2026-08-31
- #1805 — subjects #976/#1012/#1099/#1431 (all CLOSED 2026-09-04), PR #1799 MERGED 2026-09-04; same-marker #1772/#1773 CLOSED 2026-09-04
- #1866 — subject #1484 (CLOSED 2026-09-05), PR #1857 MERGED 2026-09-05; the stale-claim-plus-open-PR variant is covered by #1224's open-linked-PR exclusion, which runs regardless of claim-blob state

**Commands:**
gh issue comment 1740 --body "Closing as implemented: #1224 (2026-09-06) added the open-linked-PR exclusion to dispatch's queue pull; #833 is closed and PR #1727 merged. Filed by /claude-tweaks:sweep (run 2026-09-09T145100)."
gh issue close 1740 --reason completed
gh issue comment 1805 --body "Closing as resolved: PR #1799 merged 2026-09-04 (all four subject records closed) and #1224 (2026-09-06) added the open-linked-PR exclusion to dispatch's queue pull, the gap this report named; #1772/#1773 (same marker) were closed the same way. Filed by /claude-tweaks:sweep (run 2026-09-09T145100)."
gh issue close 1805 --reason completed
gh issue comment 1866 --body "Closing as resolved: PR #1857 merged 2026-09-05 (#1484 closed) and #1224 (2026-09-06) made dispatch's queue pull exclude any record with an open linked PR before selection, independent of the claim blob's state — the mechanical signal this report said was missing. Filed by /claude-tweaks:sweep (run 2026-09-09T145100)."
gh issue close 1866 --reason completed
