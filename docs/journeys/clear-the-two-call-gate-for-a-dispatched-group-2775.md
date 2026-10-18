---
files:
  - plugin/bin/lib/claim-targets/claim-targets.js
  - plugin/bin/lib/dispatch/first-call-artifact-check.js
  - plugin/bin/lib/log-decision/claim-log.js
  - plugin/skills/flow/claim-targets.md
  - plugin/skills/dispatch/two-call-gate.md
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
- **Should understand:** The line is written per target, never as a combined `claimed #a, #b` line. Since #3012 the bookkeeping-stamps gate also recognises a paraphrased line (`paraphrasedClaimNumbers`, `plugin/bin/lib/log-decision/claim-log.js`), including a combined one, for every number it positively names as claimed. But the preflight fresh-mint reader (`isClaimLogEntry`) still recognises only the per-target canonical form, so a combined line reads as other content there. A write the CLI could not make — e.g. a worktree-local, unanchored `--run` path — comes back in the envelope's `claimLogFailures`; the claim itself still stands. This is the `gh` path only: in a `gh`-absent sandbox the manual MCP claim procedure runs instead of the CLI, and the `log-decision.js` call in `claim-targets.md`'s "Log the claim" paragraph is still required once per target it claimed.
- **Red flags:** A non-empty `claimLogFailures` ignored — the materialize-commit push is then denied by the bookkeeping-stamps gate exactly as before; hand-typing a grouped claim line instead of passing `--run`.

### 2. Materialize every member before building — `/flow` multi-spec per-record `/build`
- **URL:** `plugin/skills/flow/materialize.md` "Multi-record layout"
- **Action:** Each member's `/build` Spec Step 1 writes and commits `{run-dir}/spec-{n}/work/{n}-spec.md` inside the worktree (a singleton writes `{run-dir}/work/{n}-spec.md`) before any implementation.
- **Should feel:** Routine — the materialize commit is the branch's first commit per record, never an afterthought.
- **Should understand:** Skipping this (a hand-rolled group build) no longer slips through: step 3 checks for it from raw state.
- **Red flags:** A group that "built and passed test" with an empty `work/` tree.

### 3. Dispatching session runs the artifact check before the second call
- **URL:** `plugin/skills/dispatch/two-call-gate.md` §2 "Artifact check"; `plugin/bin/lib/dispatch/first-call-artifact-check.js`
- **Action:** **Dispatching session**, after a clean `STATUS`/`OUTCOME: build-test-ok` pair, calls `checkFirstCallArtifacts({ runDir, issueNumbers, repoSlug })`. Check 5 requires each member's header at `work/{n}-spec.md` or `spec-{n}/work/{n}-spec.md`, in the run dir or its worktree mirror — the same shapes `/wrap-up`'s record-resolution ladder reads.
- **Should feel:** Mechanical and quiet on the happy path — the self-report is confirmed against files, not trusted.
- **Should understand:** A `{ ok: false, reason: 'materialized-header-missing' }` names the unmaterialized member(s); it is gated exactly like a malformed status line — the second call is never dispatched and the group routes to §5's terminal path with one `REFUSED` decisions line.
- **Red flags:** A second call dispatched on a self-report alone; a header whose `record:` frontmatter names a different number being counted.

## Origin
- Created during #2775's build (multi-spec run 2026-10-16T172750-spec-2775-2733-2677): materialized-header check 5 in the two-call gate, and `claim-targets.js --run` writing the canonical Step 2.8 claim-log line.
- Updated during build of #3012: the bookkeeping-stamps gate now accepts a semantically equivalent paraphrased claim line, so a first call that logged a real claim in different prose no longer gets the second call denied at its first push.
- Related: #2837 (introduced the first-call artifact check), #2861 (claim-log line parser), #2391 (worktree-mirror rung of the record-resolution ladder).
