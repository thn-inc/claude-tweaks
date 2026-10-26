# Staged: Propose digest cluster — [dispatch] (3 entries)

Finding: [digest] digest container #1426 holds 3 un-promoted entries sharing area `dispatch`. That clears the 3-entry threshold for cluster promotion.
Proposed: file one spec-shaped backlog record absorbing them, then append `→ #{new}` to each promoted entry line in #1426 (comment ids: 5443595236, 5889293448, 6261580042).

## Proposed record

**Title:** dispatch: resolve 3 accumulated below-floor digest findings

### Current State
The materiality-floor digest (#1426) has accumulated 3 below-floor findings in the `dispatch` area. Each was too small to file on its own, but together they make a coherent unit of work.

### Deliverables
- SKILL.md's Open-PR-exclusion coverage relies on "same convention... see queue-pull-notes.md" rather than inlining the literal report template, unlike the sibling Blocked-exclusion report two sentences earlier which embeds its template directly in SKILL.md — `plugin/skills/dispatch/SKILL.md:104` — Defer-reason: genuinely-larger — 2026-08-27T180803-record-1224
- queue-pull-script.md writes echo '[]' > "$DISPATCH_OPEN_PR_EXCLUDED" but that variable is never defined in the eval block (its per-reason file was consolidated into dispatch-exclusions.json in #1752), so every firing prints a spurious "line 276: : No such file or directory" to stderr — dead assignment to delete — plugin/skills/dispatch/queue-pull-script.md — Defer-reason: pre-existing-outside-diff — 2026-09-29T105522-dispatch-standalone
- merge-verdict.js PASS_ACTION_RE expects a bare [a-z/]+ Reversibility tier; widen it when a merge-verdict writer starts passing a qualified one (auto-merge-short-circuit.md and settle-and-merge.md pass bare n/a today) — plugin/bin/lib/dispatch/merge-verdict.js — Defer-reason: blocked-dependency — 2026-10-19T061314-record-2869

### Acceptance Criteria
- Each Deliverable above is fixed, or explicitly ruled won't-fix with a one-line reason in the closing PR.
- Each promoted digest entry line in #1426 carries `→ #{this record}`.

## Commands
gh issue create --repo thn-inc/claude-tweaks --title "dispatch: resolve 3 accumulated below-floor digest findings" --body-file <this proposal's Proposed record section>
