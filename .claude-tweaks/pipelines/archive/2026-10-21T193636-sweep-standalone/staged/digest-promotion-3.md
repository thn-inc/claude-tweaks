# Staged: Propose digest cluster — [docs] (4 entries)

Finding: [digest] digest container #1426 holds 4 un-promoted entries sharing area `docs`. That clears the 3-entry threshold for cluster promotion.
Proposed: file one spec-shaped backlog record absorbing them, then append `→ #{new}` to each promoted entry line in #1426 (comment ids: 5644087195, 5692842653, 5966305862, 6209454099).

> Note: none of the four ledgers these entries cite still exists under `docs/plans/`. Today only three ledgers remain there, all dated 2026-10-20, so these entries are probably moot. Consider declining, and letting expiry roll them up, rather than promoting.

## Proposed record

**Title:** docs: resolve 4 accumulated below-floor digest findings

### Current State
The materiality-floor digest (#1426) has accumulated 4 below-floor findings in the `docs` area. Each was too small to file on its own, but together they make a coherent unit of work.

### Deliverables
- Ledger docs/plans/2026-09-06-skill-context-composer-ledger.md rows 10, 14, 16, 25, 26, 27 still show Status: open, but each row references a follow-up GitHub issue (#2017, #2020, #2018, #2015, #2016) that has since closed with a merged PR resolving the exact question the row left open — the ledger was never revisited after those closures. — docs/plans/2026-09-06-skill-context-composer-ledger.md — Defer-reason: direct-filing-sweep — /claude-tweaks:docs-health
- Ledger docs/plans/2026-09-12-record-2278-ledger.md row 1 still shows Status: open for PR #2305, but that PR merged on 2026-09-12T15:36:17Z resolving record #2278's only open item — the ledger was never revisited after the merge. — docs/plans/2026-09-12-record-2278-ledger.md — Defer-reason: direct-filing-sweep — /claude-tweaks:docs-health
- Ledger rows 2, 5, 8, 9 cite open/deferred issues and staged skill-update proposals that have since closed or shipped (#2768 merged via #2883; the three skill proposals shipped in #2864), but the ledger was never revisited after those closures — docs/plans/2026-09-30-flow-spec-2704-2709-ledger.md — Defer-reason: direct-filing-sweep — /claude-tweaks:docs-health
- Ledger row 1 (#1350 AC2) resolution text frames the item as an unresolved standing watch-item pointing to future conditions (#3128 shipping, #1350 closing) that have both since occurred (#1350 closed via PR #3135, #3128 closed via PR #3150), but the ledger was never revisited after those closures — docs/plans/2026-10-14-record-1350-ledger.md — Defer-reason: direct-filing-sweep — /claude-tweaks:docs-health

### Acceptance Criteria
- Each Deliverable above is fixed, or explicitly ruled won't-fix with a one-line reason in the closing PR.
- Each promoted digest entry line in #1426 carries `→ #{this record}`.

## Commands
gh issue create --repo thn-inc/claude-tweaks --title "docs: resolve 4 accumulated below-floor digest findings" --body-file <this proposal's Proposed record section>
