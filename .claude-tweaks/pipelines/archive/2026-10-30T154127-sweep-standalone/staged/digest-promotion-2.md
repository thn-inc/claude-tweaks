# Staged: Propose digest cluster — wrap-up (4 entries)

**Proposed:** file one backlog record "Settle 4 below-floor digest findings in wrap-up" absorbing 4 un-promoted `[wrap-up]` entries from digest #1426, then append `→ #{new}` to each promoted entry line.

## Proposed record body

## Current State

4 below-floor findings in the `wrap-up` area sit un-promoted in the rolling digest (#1426). Each was deferred individually under the materiality floor; together they cross Step 5.6's 3-entry cluster threshold.

## Deliverables

- review-followup- record proposals wait for console approval at trusted, where ledger/leftover/reflect proposals auto-file — `whether they join the trusted-tier queue-write auto-file scope is a lever-scope call shared with _shared/autonomy-ceiling.md (#4484 review, lens 3e)`
- skip detail "closes after the merge lands (Step 4.0b)" false on a non-default integration branch or local-files — `plugin/bin/lib/wrap-up/engine-verify.js`
- idempotence check-then-act with no lock; concurrent sessions both comment and close, duplicate listing comment — `plugin/skills/wrap-up/verification-brief-parent-gate.md`
- A sub-issue closed with a null stateReason lands in the not-planned branch, though line 383 claims parity with needsBackstop, which treats null as shipped. — `plugin/skills/wrap-up/verification-brief-parent-gate.md:375`

## Acceptance Criteria

- Each Deliverables bullet is either fixed (with a test where behaviour changes) or closed out with a one-line rationale in the PR body.
- Every promoted digest line in #1426 carries `→ #{this record}`.

## Source entries (digest #1426)

- materiality-5d998e46 — https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6518866799
- materiality-2967ef53 — https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6520335226
- materiality-3d215292 — https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6520335226
- materiality-df5aa567 — https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6525082273
