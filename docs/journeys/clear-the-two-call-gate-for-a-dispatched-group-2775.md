---
files:
  - plugin/bin/lib/claim-targets/claim-targets.js
  - plugin/bin/lib/dispatch/first-call-artifact-check.js
  - plugin/bin/lib/log-decision/claim-log.js
  - plugin/skills/flow/claim-targets.md
  - plugin/skills/dispatch/two-call-gate.md
  - plugin/skills/dispatch/sequential-execution.md
  - plugin/skills/dispatch/task-prompt.md
---

# Clear the Two-Call Gate for a Dispatched Group

**Persona:** the dispatched first-call (`build,test`) Task agent running `/flow "#a,#b,..." build,test auto` for a fast-lane bundle — an internal tooling user — and the **dispatching session** that decides, from raw artifacts, whether the group's second (`review,polish,wrap-up`) call may run.
**Goal:** reach the second call with every record already claimed-and-logged and already materialized, so neither the bookkeeping-stamps gate nor `/wrap-up`'s fact pack needs a retroactive backfill.
**Entry point:** `/flow`'s Step 2.8 claim, inside the group's first Task call.
**Success state:** `decisions.md` carries one canonical `Step 2.8: claimed #n` line per member, written by the claim CLI itself; every member has a materialized header under its run's worktree mirror; the dispatching session's artifact check returns `{ ok: true }` and the second call is dispatched; that call's wrap-up fact pack resolves every record on its first read.

## Steps

### 1. Claim the group and let the CLI write the claim log — `/flow` Step 2.8
- **URL:** `plugin/skills/flow/claim-targets.md` "Claim every named target, all-or-abort"; the `claim-targets.js` row of `plugin/skills/dispatch/task-prompt.md`'s Context pack CLI table, which carries the `--run "{minted-run-dir}"` shape the dispatched agent copies
- **Action:** Run `claim-targets.js --run-id "$(basename "$PIPELINE_RUN_DIR")" --targets {n},{m} --run "$PIPELINE_RUN_DIR"`. On success the CLI appends one `- AUTO … — Step 2.8: claimed #n (bin/claim-targets.js, transport: …)` line per claimed target under `## /flow`, through `log-decision`'s own writer and its run-dir anchoring check.
- **Should feel:** One command, nothing to hand-type — the claim and its audit line land together.
- **Should understand:** The line is written per target, never as a combined `claimed #a, #b` line. Since #3012 the bookkeeping-stamps gate also recognises a paraphrased line (`paraphrasedClaimNumbers`, `plugin/bin/lib/log-decision/claim-log.js`), including a combined one, for every number it positively names as claimed. The preflight fresh-mint reader (`classifyDecisions`) is narrower: it accepts the per-target canonical line, or a complete paraphrased line whose entry location names the claim step (#3665), so a combined line written under `Step 2.8` still reads as a claim there, while a combined line written under any other step reads as other content. A write the CLI could not make — e.g. a worktree-local, unanchored `--run` path — comes back in the envelope's `claimLogFailures`; the claim itself still stands. This is the `gh` path only: in a `gh`-absent sandbox the manual MCP claim procedure runs instead of the CLI, and the `log-decision.js` call in `claim-targets.md`'s "Log the claim" paragraph is still required once per target it claimed.
- **Red flags:** A non-empty `claimLogFailures` ignored — the materialize-commit push is then denied by the bookkeeping-stamps gate exactly as before; hand-typing a grouped claim line instead of passing `--run`.

### 2. Materialize every member before building — `/flow` multi-spec per-record `/build`
- **URL:** `plugin/skills/flow/materialize.md` "Multi-record layout"
- **Action:** Each member's `/build` Spec Step 1 writes and commits `{run-dir}/spec-{n}/work/{n}-spec.md` inside the worktree (a singleton writes `{run-dir}/work/{n}-spec.md`) before any implementation.
- **Should feel:** Routine — the materialize commit is the branch's first commit per record, never an afterthought.
- **Should understand:** Skipping this (a hand-rolled group build) no longer slips through: step 3 checks for it from raw state.
- **Red flags:** A group that "built and passed test" with an empty `work/` tree.

### 3. Dispatching session runs the artifact check before the second call
- **URL:** `plugin/skills/dispatch/two-call-gate.md` §2 "Artifact check"; `plugin/bin/lib/dispatch/first-call-artifact-check.js`
- **Action:** **Dispatching session**, after a clean `STATUS`/`OUTCOME: build-test-ok` pair, calls `checkFirstCallArtifacts({ runDir, issueNumbers, repoSlug })`. Check 5 requires each member's header at `work/{n}-spec.md` or `spec-{n}/work/{n}-spec.md`, in the run dir or its worktree mirror — the same shapes `/wrap-up`'s record-resolution ladder reads. Check 6 (#3577) runs last: `{runDir}/decisions.md` must carry the canonical `Step 2.8: claimed #n` line for every member, read through `hasCanonicalClaimLogFor`, the same line `verify-run-bookends.js` enforces.
- **Should feel:** Mechanical and quiet on the happy path — the self-report is confirmed against files, not trusted.
- **Should understand:**
  - A `{ ok: false, reason: 'materialized-header-missing' }` names the unmaterialized member(s). It is gated exactly like a malformed status line: the second call is never dispatched, and the group routes to §5's terminal path with one `REFUSED` decisions line.
  - A `{ ok: false, reason: 'claim-log-missing' }` names the first member whose canonical line is absent, with the same gating. A batch-summary or paraphrased claim line does not satisfy it, even though the lenient stamps-gate reader accepts one. The `missing-config` repair branch (step 4) returns before check 6 runs.
  - The PR check (check 4) runs when the run's `config.yml` carries the `integration-model: pr-first` pin, which the Manifesto writes (#3350).
  - With no valid pin, the check emits one `first-call-artifact-check: degraded — … carries no valid integration-model pin` line on stderr and skips check 4; its result is unchanged. The dispatching session logs that line as a `SKIP` decision, never as a failure.
- **Red flags:**
  - A second call dispatched on a self-report alone.
  - A header whose `record:` frontmatter names a different number being counted.
  - A `degraded —` line treated as a failed artifact check.
  - A first call that skipped `verify-run-bookends.js` reaching the second call with no canonical claim line.

### 4. Dispatching session repairs a first call whose only defect is a missing config.yml
- **URL:** `plugin/skills/dispatch/two-call-gate.md` §2 "Repair branch"; `plugin/skills/dispatch/sequential-execution.md` "Artifact check, first call only"; `plugin/bin/lib/dispatch/first-call-artifact-check.js`
- **Action:** **Dispatching session**, on `{ ok: false, reason: 'missing-config', repairable: true }`, logs `AUTO {time} — Artifact check: config.yml missing, claim/PR intact — repairing via call 2's /flow case-3 adoption. Reversibility: high.` and dispatches the second call byte-identical to the normal one. That call's `/flow` adopts the run directory and rebuilds `config.yml` from `decisions.md`'s config snapshot.
- **Should feel:** Like a self-healing hiccup. A tested, correct PR keeps moving through review instead of being abandoned to the §5 teardown.
- **Should understand:**
  - `repairable` is `true` only when every member's claim is live under this run's `runId` AND the PR evidence holds: a recorded PR whose branch is on `origin`. The PR evidence is required when `integration-model` in `policy.yml` is `pr-first` or unset. Under `local-merge` the claim alone suffices.
  - Any other failure, `repairable: false`, or an unreadable/invalid policy still takes §5's teardown.
  - A malformed status line is `BLOCKED` before the artifact check is ever consulted. `resolveFirstCallGate` encodes that ordering.
- **Red flags:**
  - A repair dispatched with a missing claim or an unpushed branch under `pr-first`.
  - A repair flag or hint threaded into call 2's invocation.
  - The repair line logged after a malformed status line.

### 5. Dispatching session reads the first call's runner stamp before every call-2 dispatch
- **URL:** `plugin/skills/dispatch/two-call-gate.md` §2 "Stamp read, a note never a gate"; `plugin/skills/dispatch/sequential-execution.md` "Artifact check, first call only"; `plugin/bin/lib/dispatch/first-call-artifact-check.js`'s `checkFirstCallStamp`; the first-call CRITICAL paragraph in `plugin/skills/dispatch/task-prompt.md`
- **Action:** **First call:** runs its test phase through `/claude-tweaks:test`. The artifact it confirms before reporting is the runner's pass stamp verifying HEAD (`verify.js --stamp-status` → `verifiedHead: true`) plus its `report.json`, or a complete composed per-suite verdict (#4006). A raw `npm test` log no longer counts. If `--stamp-status` still does not report `verifiedHead: true` after one re-run, it reports `STATUS: DONE_WITH_CONCERNS`, naming the stamp state. **Dispatching session:** whenever call 2 is about to be dispatched, on a `{ ok: true }` artifact check or on the step-4 repair branch, it runs `checkFirstCallStamp({ runDir })`. That call runs `verify.js --stamp-status` in the worktree recorded in `run-state.json` and returns `{ verified, reason, status }`.
- **Should feel:** Silent when the first call did it right, and a single audit line when it did not. The stamp never costs a good build its second call.
- **Should understand:**
  - `verified: true` logs nothing and changes nothing (AC2). A complete composed per-suite verdict (`verifiedHead: true` with `suiteComposed.complete: true`, from chunked `--stamp-suite` runs) also reads `verified: true`, with no single stamp or `report.json` behind it (#4006).
  - Any other reason logs one `SKIP … — Artifact check stamp read (degraded): …` decisions line, and call 2 is still dispatched unchanged. The reasons are `stamp-absent`, `stamp-not-head`, `report-missing`, `stamp-read-failed` and `worktree-unrecorded`. Most often the cause is a test phase that bypassed the runner.
  - It is a note rather than a gate. Call 2's review Step 1.5 re-verifies an unstamped HEAD through the runner, so blocking would discard a build that will be checked anyway. Repairing here would only move the suite's cost.
  - The read must run with the recorded worktree as cwd, because the stamp lives under that worktree's git dir and HEAD is read live. Running it from the dispatching session's own checkout would read the wrong tree.
- **Red flags:**
  - A stamp note treated as a failed artifact check, routing a good build to §5's teardown.
  - The stamp read skipped on the repair branch.
  - A first call looping on `/claude-tweaks:test` because a dirty tree never verifies, instead of reporting `DONE_WITH_CONCERNS` after one re-run.
  - A first call reporting `build-test-ok` on a raw `npm test` log alone.
  - A `stamp-absent` note logged for a first call whose chunked suite composed complete at HEAD.

## Origin
- Created during #2775's build (multi-spec run 2026-10-16T172750-spec-2775-2733-2677): materialized-header check 5 in the two-call gate, and `claim-targets.js --run` writing the canonical Step 2.8 claim-log line.
- Updated during build of #3012: the bookkeeping-stamps gate now accepts a semantically equivalent paraphrased claim line, so a first call that logged a real claim in different prose no longer gets the second call denied at its first push.
- Updated during build of #3226: step 4. A `missing-config` result with intact claim/PR evidence is classified `repairable` and repaired via call 2's `/flow` adoption, not torn down.
- Updated during build of #3350: step 3. Check 4 now runs on a run pinned `pr-first`; an unpinned run emits a `degraded —` line that is logged as a `SKIP`.
- Updated during build of #3577: step 3. Check 6 confirms the canonical Step 2.8 claim line per member from `decisions.md`, so the dispatching session no longer relies on the first call's own `verify-run-bookends.js` self-check.
- Updated during build of #3661: step 5. The dispatching session reads the first call's `verify.js` pass stamp (`checkFirstCallStamp`) before every call-2 dispatch, as a logged note rather than a gate. The first-call template's artifact is now the runner stamp plus `report.json`, never a raw `npm test` log.
- Updated during build of #4006: step 5. Bare `verify.js --stamp-status` discovers `.claude-tweaks/verify-scope.json`, and `checkFirstCallStamp` accepts a complete composed per-suite verdict as verified, so a chunked first call no longer logs a degraded stamp note.
- Related: #2837 (introduced the first-call artifact check), #2861 (claim-log line parser), #2391 (worktree-mirror rung of the record-resolution ladder).
