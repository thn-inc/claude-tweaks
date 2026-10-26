# Staged: Open parent gate — #3944

**Finding:** Every sub-issue of #3944 is CLOSED (5/5) and the parent carries no acceptance disposition (`parentGateState` = `due`).

**Proposed:** compose #3944's Verification Brief, then add `demo:pending` (tidy/actions-github-issues.md `## Open parent gate`).

## Sub-issues

- #3945 CLOSED — Add the tiebreak verdict resolver and per-finding verdict coverage check
- #3946 CLOSED — Route every staged-item kind to a final outcome and refuse unknown kinds at staging
- #3947 CLOSED — Run a mandatory agent tiebreak on every unconfirmed and contested review finding
- #3949 CLOSED — Give the Review Console a final outcome for every finding and file can't-tell findings at unattended
- #3950 CLOSED — Settle the existing Review Console backlog once and retire the direct-verification override

## Commands

Re-verify `parentGateState` is still `due`, then run wrap-up/verification-brief.md's Parent-Gate Procedure for #3944 (comment first, then `gh issue edit 3944 --repo thn-inc/claude-tweaks --add-label demo:pending`).
