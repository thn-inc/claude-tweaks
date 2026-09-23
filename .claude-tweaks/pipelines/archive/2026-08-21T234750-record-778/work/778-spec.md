---
record: 778
origin: human
risk: medium
size: medium
ceremony: standard
grants: [build]
surface: backend
---
# 778: Dispatched /flow run silently skipped both the Step 2.8 claim and the pr-first early-PR bootstrap (no degrade trace)

Surface: backend

Defer-reason: discovered-during — surfaced while settling dispatched run for #600; fixing the pipeline machinery is outside that record's docs-only scope.

## Current State

A dispatched `/flow` run for #600 (run dir `2026-08-17T070310-record-600`, dispatched 2026-08-17 via `/claude-tweaks:dispatch` explicit-list form) silently skipped **two** mandatory early-run procedures, with no degrade log line for either:

1. **`_shared/pr-early-run-lifecycle.md` bootstrap never ran** — `integration-model` resolves `pr-first` and the build phase landed a materialize commit (`173aa1df`), which per `build/worktree-setup.md` Step 6 should have triggered push-then-open-draft-PR immediately after. Observed: branch never pushed (`git ls-remote origin worktree-flow-record-600` empty), no PR, no `run-state.json` ever written, and `decisions.md` carries no "PR-early run lifecycle" line at all — not even the degrade-and-continue entry the procedure requires on failure. The dispatching session repaired this by hand at park time (pushed the branch, opened draft PR #775).
2. **`flow/claim-targets.md` Step 2.8 claim never ran** — the run's first Task call executed `/claude-tweaks:flow #600 build,test` (claim skip-guard does not apply: step list contains build+test, github-issues backend, record mode). Observed after the run: no `bot:in-progress` label on #600, zero claim comments, no claim refs on origin. The record sat in the eligible queue looking unclaimed for the entire build.

Both skips are silent divergences from declared contracts, discovered only because a human resumed the parked run. The full evidence trail is in `staged/reflect-1.md` of the (archived) run dir and the dispatching session's standalone run dir `2026-08-17T063856-dispatch-standalone/decisions.md`.

Possibly related context: the run was invoked by a dispatch Task subagent with `PIPELINE_RUN_DIR` set to a dispatch-minted (empty) run dir, under `worktree-always`, with the dispatching session having pre-entered the worktree — i.e. `/flow`'s adopt-inherited-run-dir path (case 2), not its create-fresh path.

## Deliverables

- Determine why `/flow`'s Step 2.8 claim and `build/worktree-setup.md` Step 6's pr-first bootstrap both short-circuited on the adopt-inherited-run-dir path, and fix the short-circuit(s) at the source.
- Whatever the cause, make silent skip impossible: both procedures must leave either a success trace or the contractually-required degrade log line in `decisions.md`.

## Acceptance Criteria

- [ ] A dispatched `/flow #N build,test` run under `pr-first` with an inherited minted run dir produces: a claim (`bot:in-progress` + claim comment/ref) before the first build commit, and a pushed branch + draft PR + `run-state.json` `pr` object after the materialize commit.
- [ ] Forcing either procedure to fail (e.g. simulated push failure) produces the documented degrade log line in `decisions.md` — absence of both success trace and degrade line is impossible on the tested path.
- [ ] A regression test (or live-probe conformance test per repo convention) pins whichever mechanism caused the skip.

## Technical Approach

Trace both procedures' entry guards against the adopt-inherited-run-dir path specifically (`/flow`'s case-2 branch, per this record's own Current State) — the create-fresh path is not implicated since the run dir being pre-minted-but-empty is the distinguishing condition. Likely candidates: a guard that treats a pre-existing (even empty) run dir as "already handled," or a state check keyed on `run-state.json`/claim markers that a dispatch-minted dir hasn't yet populated. Once the short-circuit is found, the fix is at that guard, not a new wrapper around it; pair it with a `decisions.md` write on both the success and degrade paths so a future silent skip is structurally impossible rather than merely less likely.

## Gotchas

- Both mandatory procedures failed the same run at the same time — treat that as a signal they may share one root cause (the adopt-inherited-run-dir guard) rather than two independent bugs to fix separately.
- The dispatching session's manual repair (pushing the branch, opening draft PR #775 by hand) is not itself part of this fix — it's evidence the pipeline should have produced automatically.

## Original request

Dispatched /flow run silently skipped both the Step 2.8 claim and the pr-first early-PR bootstrap (no degrade trace)

## Current State

A dispatched `/flow` run for #600 (run dir `2026-08-17T070310-record-600`, dispatched 2026-08-17 via `/claude-tweaks:dispatch` explicit-list form) silently skipped **two** mandatory early-run procedures, with no degrade log line for either:

1. **`_shared/pr-early-run-lifecycle.md` bootstrap never ran** — `integration-model` resolves `pr-first` and the build phase landed a materialize commit (`173aa1df`), which per `build/worktree-setup.md` Step 6 should have triggered push-then-open-draft-PR immediately after. Observed: branch never pushed (`git ls-remote origin worktree-flow-record-600` empty), no PR, no `run-state.json` ever written, and `decisions.md` carries no "PR-early run lifecycle" line at all — not even the degrade-and-continue entry the procedure requires on failure. The dispatching session repaired this by hand at park time (pushed the branch, opened draft PR #775).
2. **`flow/claim-targets.md` Step 2.8 claim never ran** — the run's first Task call executed `/claude-tweaks:flow #600 build,test` (claim skip-guard does not apply: step list contains build+test, github-issues backend, record mode). Observed after the run: no `bot:in-progress` label on #600, zero claim comments, no claim refs on origin. The record sat in the eligible queue looking unclaimed for the entire build.

Both skips are silent divergences from declared contracts, discovered only because a human resumed the parked run. The full evidence trail is in `staged/reflect-1.md` of the (archived) run dir and the dispatching session's standalone run dir `2026-08-17T063856-dispatch-standalone/decisions.md`.

Possibly related context: the run was invoked by a dispatch Task subagent with `PIPELINE_RUN_DIR` set to a dispatch-minted (empty) run dir, under `worktree-always`, with the dispatching session having pre-entered the worktree — i.e. `/flow`'s adopt-inherited-run-dir path (case 2), not its create-fresh path.

## Deliverables

- Determine why `/flow`'s Step 2.8 claim and `build/worktree-setup.md` Step 6's pr-first bootstrap both short-circuited on the adopt-inherited-run-dir path, and fix the short-circuit(s) at the source.
- Whatever the cause, make silent skip impossible: both procedures must leave either a success trace or the contractually-required degrade log line in `decisions.md`.

## Acceptance Criteria

- [ ] A dispatched `/flow #N build,test` run under `pr-first` with an inherited minted run dir produces: a claim (`bot:in-progress` + claim comment/ref) before the first build commit, and a pushed branch + draft PR + `run-state.json` `pr` object after the materialize commit.
- [ ] Forcing either procedure to fail (e.g. simulated push failure) produces the documented degrade log line in `decisions.md` — absence of both success trace and degrade line is impossible on the tested path.
- [ ] A regression test (or live-probe conformance test per repo convention) pins whichever mechanism caused the skip.

Defer-reason: discovered-during — surfaced while settling dispatched run for #600; fixing the pipeline machinery is outside that record's docs-only scope.


**Related:** #1145
