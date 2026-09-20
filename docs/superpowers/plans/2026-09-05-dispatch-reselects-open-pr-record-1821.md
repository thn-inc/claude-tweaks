# Plan: dispatch can re-select an issue that already has an open PR (#1821)

## For agentic workers

This plan was authored directly by the implementer (not via `/superpowers:writing-plans`) after
research established that a complete, already-reviewed fix for this exact gap exists on an
unmerged branch. `/build` controls execution — see below for why this plan skips straight to
"what was done" rather than a task breakdown.

## Diagnosis (Deliverable 1)

Investigated why the 2026-09-04 rebuild of #1058 didn't stop at
`_shared/pr-early-run-lifecycle.md` Step 1.6 (or an equivalent guard) despite PR #1602 already
being open for the same record:

- Dispatch's own eligibility filter (`queue-pull-script.md`'s `eligiblePreDep`) only checks
  `facets.grants.build && !facets.bot.inProgress && !facets.bot.blocked` — it has **no
  awareness of open PRs at all**. The only PR-aware code path at dispatch time
  (`grouping.js`'s `detectCrossPRFileOverlap`, refs #1579) is explicitly informational —
  "never removes anything from `dispatch-groups.json`" — and only fires for a *different*
  record's PR overlapping this candidate's files, not the candidate's own linked PR.
- Comments in `grouping.js` (line ~148) and `cross-pr-overlap-report.md` both assert, as
  settled fact, that "PR #1572 (fixing #1224) already excludes a candidate from eligibility
  when its OWN linked PR is still open." That PR does not exist in `main`'s history
  (`git merge-base --is-ancestor 1893db5b7 HEAD` fails) — **`gh pr view 1572` shows it was
  reviewed, passed (full suite green, live-verified against the real queue), parked at
  `pending-review` for a human merge decision, and then closed without merging.** Issue #1224
  itself is still open today, still carrying `bot:in-progress`.
- This is the same failure mode #1821 itself describes, caught in the act: a fully-built,
  reviewed, tested fix for "dispatch re-selects a record with an open PR" sat at
  `pending-review` and was abandoned — so when #1058 was re-dispatched on 2026-09-04, the
  eligibility filter had no linked-PR check to catch it, because the record documenting and
  fixing exactly this gap (#1224) had itself fallen victim to it.
- Root cause, concretely: **dispatch's selection query never checked linked PRs** (Deliverable
  option (a) in #1821's own body) — not a `worktree-setup.md` Step 1.6 defect. Step 1.6 (the
  remote-only stale-branch check) is a second, narrower layer that only helps once a build has
  already started on a colliding branch name; the real gap is one layer up, at selection time.

## Fix (Deliverable 2, option (a))

Rather than re-implement, ported the already-reviewed, already-tested fix from the abandoned
branch (`origin/worktree-record-1224`, commit `1893db5b7`) via
`git cherry-pick --no-commit -x 1893db5b7`. It applied cleanly (auto-merged, no conflicts)
against current `HEAD` (137 commits ahead of the fix's own merge-base) and all 170 of its own
tests plus the surrounding dispatch test files pass unmodified:

- `plugin/bin/lib/issues/record.js` — `buildLinkedPRQuery` / `partitionByOpenLinkedPR`: one
  batched, aliased GraphQL query over `closedByPullRequestsReferences`, excluding a candidate
  whose own linked PR is still `OPEN`.
- `plugin/bin/lib/issues/linked-prs.js` — `fetchLinkedPRs`, the injectable-runner GraphQL
  executor (mirrors `native-dependencies.js`'s fetchNativeDependencies posture exactly).
- `plugin/bin/resolve-linked-prs.js` — CLI wrapper (mirrors `resolve-blockers.js`).
- `plugin/skills/dispatch/queue-pull-script.md` — wires the linked-PR check into the
  eligibility pipeline unconditionally (runs on both cache-hit and cache-miss queue-order
  paths, since PR state isn't covered by the freshness signal), writing
  `dispatch-open-pr-excluded.json` and removing excluded candidates from
  `dispatch-groups.json` before any selection form reads it.
- `plugin/skills/dispatch/SKILL.md` — updates the queue definition line and cites the new
  Open-PR exclusion report.
- `plugin/skills/dispatch/open-pr-exclusion-report.md` — new report file (Step 3 output).
- `plugin/skills/dispatch/mcp-transport.md` — documents the `gh`-absent fail-open gap.
- Tests: `tests/bin-lib/issues/linked-prs.test.js`, `tests/resolve-linked-prs-cli.test.js`,
  additions to `tests/bin-lib/issues/record.test.js`.

## Acceptance criteria mapping

"A record with an existing open PR from a prior run cannot be silently re-claimed and rebuilt
from scratch on a colliding branch name" — satisfied structurally: the record is now excluded
from `dispatch-groups.json` at Step 2, before any selection form (bare, `next`, `#N`,
`#N,#M,...`) can pick it, so it is never re-claimed in the first place. This is a stronger
guarantee than "stop before building" (Step 1.6's job) — the record never reaches build.

## Not done (explicitly out of scope for this record)

- Deliverable option (b) — the `worktree-setup.md` Step 1.6 gap — is not touched. Option (a)
  alone satisfies the acceptance criteria (the record is filtered before dispatch, so Step 1.6
  never needs to catch it for this failure mode). Filing a follow-up for the *meta*-problem
  this diagnosis surfaced (a reviewed, passing, `needs-human`-parked PR silently closed without
  merging or escalating) is a separate concern from this record's own scope — noted for
  wrap-up's Follow-up ideas step, not fixed here.
- Issue #1224 itself is left as-is (still open, still `bot:in-progress`) — this build reuses
  its already-reviewed diff but does not touch #1224's own lifecycle/labels; that's a decision
  for whoever resumes or closes #1224, not for #1821's build.
