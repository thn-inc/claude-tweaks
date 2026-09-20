---
record: 873
origin: capture
risk: medium
size: medium
ceremony: standard
grants: [build]
surface: backend
---
# 873: reconcile: inline FAST_CHECKS + detached reconcile-background each run their own gh-health-check + git fetch

Surface: backend

## Current State

Pre-release whole-branch code review (2026-08-18) found that `session-start.js`'s own inline `FAST_CHECKS` `reconcile()` pass and the detached `reconcile-background` child process it spawns each run their own separate GitHub-health preflight and `git fetch`, doubling `gh api rate_limit` calls and fetch round-trips per session start — reversing `reconcile/index.js`'s own D2 shared-fetch dedup rationale (one fetch per pass). A prior fix (#820 Task 10 review fix-up) tried sharing freshness state between the two processes via `reconcile-cache.json`'s `lastRunAt` stamp, and was reverted — that stamp fires on ANY completed pr-first pass regardless of which checks subset ran, so it made the background-pass spawn gate see a false-fresh signal from the FAST_CHECKS-only pass and never spawn at all, silently starving the background checks. Deferred rather than fixed at discovery time: the residual cost is background CPU/network after the interactive session-start has already returned (not user-facing latency), and `gh api rate_limit` does not consume GitHub API rate-limit quota, so the real-world cost today is small; the highest-value fix (#872, filed alongside this record by the same review) already removes `gh` from the mirror-only inline fetch path. Related: #872.

## Deliverables

- [ ] Confirm #872's landing status and whether it changes the shape of this record's remaining scope (it removes `gh` from the mirror-only inline fetch path, per the original report).
- [ ] Design a freshness-sharing mechanism between the inline `FAST_CHECKS` pass and the detached `reconcile-background` process that distinguishes which checks subset ran — avoiding the exact failure mode #820's reverted `lastRunAt` stamp hit (a single timestamp that can't tell FAST_CHECKS-only from a full pass).
- [ ] Implement the fix so the background pass still spawns when its own checks haven't freshly run, even if a FAST_CHECKS-only pass completed recently.

## Acceptance Criteria

1. The inline `FAST_CHECKS` pass and the detached `reconcile-background` process no longer both perform a redundant GitHub-health preflight + `git fetch` on the same session start when the background pass's own checks genuinely need to run.
2. The background-pass spawn gate correctly distinguishes "a FAST_CHECKS-only pass just ran" from "a full pass (covering the background checks too) just ran" — reproducing and passing against #820's exact regression shape (background checks silently starved) as a test case.
3. `npm test` passes with new coverage, including a test that would have caught #820's reverted fix's starvation bug.

## Technical Approach

The prior #820 fix failed because `reconcile-cache.json`'s `lastRunAt` stamp was a single timestamp with no record of *which checks* ran. The fix here needs a per-checks-subset freshness record — e.g. `lastRunAt` becomes a map keyed by checks-subset (or a dedicated field per subset) rather than one scalar — so the background-pass spawn gate can ask "did *my* checks run recently" instead of "did *any* pass run recently." Given #872 already removes `gh` from the mirror-only inline fetch path (reducing but not eliminating the duplication), re-scope this record's remaining work after confirming #872's actual landed shape.

### Key Files

- `plugin/bin/lib/hooks/session-start.js` — inline FAST_CHECKS reconcile pass + background process spawn
- `plugin/bin/lib/reconcile/index.js` — `reconcile-cache.json`'s `lastRunAt` freshness stamp, needs to become checks-subset-aware
- `tests/` — new test reproducing #820's starvation regression shape

## Gotchas

- This record explicitly carries `Defer-reason: needs-human-decision` — the original filer judged the residual cost low today and deferred rather than immediately fixing; re-confirm that judgment still holds (has #872 changed the cost/benefit?) before investing in the freshness-sharing redesign.
- Must not reintroduce #820's exact regression (a single freshness stamp masking a checks-subset mismatch) — any new freshness mechanism needs an explicit test reproducing that shape.

## Original request

reconcile: inline FAST_CHECKS + detached reconcile-background each run their own gh-health-check + git fetch

**Related:** #872

Context: Pre-release whole-branch code review (2026-08-18) found that session-start.js own inline FAST_CHECKS reconcile() pass and the detached reconcile-background child process it spawns each run their own separate GitHub-health preflight and git fetch, doubling gh api rate_limit calls and fetch round-trips per session start. This reverses reconcile/index.js own D2 shared-fetch dedup rationale (one fetch per pass).

Scope: A prior fix (#820 Task 10 review fix-up) already tried sharing freshness state between the two processes via the reconcile-cache.json lastRunAt stamp, and reverted it — that stamp fires on ANY completed pr-first pass regardless of which checks subset ran, so it made the background-pass spawn gate see a false fresh from the FAST_CHECKS-only pass and never spawn at all, silently starving the background checks. Any future fix must avoid that exact failure mode. Deferred rather than fixed: the residual cost is background CPU/network after the interactive session-start has already returned (not user-facing latency), and gh api rate_limit does not consume GitHub API rate-limit quota, so the real-world cost today is small; the highest-value fix (#872, the sibling backlog item this review also filed) already removes gh from the mirror-only inline fetch path.

Defer-reason: needs-human-decision

