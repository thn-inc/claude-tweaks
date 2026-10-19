# Staged: Propose digest cluster — wrap-up (3 entries from #1426)

**Finding:** 3 un-promoted digest entries in #1426 share area `wrap-up` (Step 5.6 cluster promotion).
**Proposed:** File one spec-shaped backlog record absorbing them, then append `→ #{n}` to each of the
3 entry lines in #1426.

Premise check at staging time (2026-10-19): entry 2 (`CLOSING_KEYWORDS_PATTERN`,
`plugin/bin/lib/wrap-up/engine-verify.js:466`) and entry 3 (ceremony config divergence) are still
live. Entry 1's three named ledger files are already gone from `docs/plans/`; the process gap it
describes (Phase 4 not deleting the ledger before merge) is unverified — keep it as a deliverable
to confirm or drop at shaping time.

## Proposed record

**Title:** wrap-up: dispose three deferred digest findings (ledger cleanup, closing-keyword copy, ceremony config)

### Current State
Three below-floor findings about `/claude-tweaks:wrap-up` accumulated in the digest container (#1426).

### Deliverables
1. Confirm whether Wrap-Up Phase 4 cleanup still leaves `docs/plans/*-ledger.md` residue on main for closed records (seen on records 1350, 3088 and 3117); fix the cleanup ordering if it does, or drop the item with evidence if it doesn't.
2. `engine-verify.js` imports `CLOSING_KEYWORD_ALTERNATION` from `issue-branch-tracking.js` in place of its own `CLOSING_KEYWORDS_PATTERN` copy, pinned by one test (`Fixes #N` / `Closes: #N` match; `Refs #N` does not).
3. Decide which `config.yml` a spec-level ceremony downgrade writes in a multi-spec run (spec-level vs the run-level value `multispec-batch-curation.md` reads as uniform), and state it in `wrap-up/SKILL.md` and `flow/multispec-batch-curation.md`.

### Acceptance Criteria
- Deliverable 1 has either a fix with a regression test or a recorded no-repro.
- `grep -n CLOSING_KEYWORDS_PATTERN plugin/bin/lib/wrap-up/engine-verify.js` returns nothing, and the new test passes.
- Both files name the same `config.yml` as authoritative for a ceremony downgrade.

## Commands (on approval)
gh issue create --repo thn-inc/claude-tweaks --title "{title above}" --body-file {this proposal's record section}
then append ` → #{n}` to each of the 3 `[wrap-up]` entry lines in #1426 (comment edits).
