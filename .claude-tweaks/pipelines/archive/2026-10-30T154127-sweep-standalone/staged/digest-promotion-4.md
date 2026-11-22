# Staged: Propose digest cluster — worktree (3 entries)

**Proposed:** file one backlog record "Settle 3 below-floor digest findings in worktree" absorbing 3 un-promoted `[worktree]` entries from digest #1426, then append `→ #{new}` to each promoted entry line.

## Proposed record body

## Current State

3 below-floor findings in the `worktree` area sit un-promoted in the rolling digest (#1426). Each was deferred individually under the materiality floor; together they cross Step 5.6's 3-entry cluster threshold.

## Deliverables

- No claim recoverable (claim-empty): lens "3f" findings plugin/bin/lib/worktree/remote-branch-collision.js:168 and plugin/skills/build/adopted-branch-collision-check.md:43 not reproduced. (no real-git — `plugin/bin/lib/worktree/remote-branch-collision.js:168`
- The worktree catch-up CLI imports isValidBranchName from lib/init/release-bootstrap, while remote-branch-collision.js keeps a looser isSafeBranchName. — `plugin/bin/pre-review-catchup.js:33`
- The stripper now serves foreign JS/TS, but its header still justifies the regex-after-) misread by the shapes in plugin/bin and tests/, and test-only compiles, stripperVerdict and STRIPPER_VERDICT_MESSAGES (pointing at a non-shipping path) moved into the payload. — `plugin/bin/lib/strip-comments.js:34`

## Acceptance Criteria

- Each Deliverables bullet is either fixed (with a test where behaviour changes) or closed out with a one-line rationale in the PR body.
- Every promoted digest line in #1426 carries `→ #{this record}`.

## Source entries (digest #1426)

- materiality-0ec21adc — https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6382411143
- materiality-0490401b — https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6525082273
- materiality-ac0a0d8e — https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6525082273
