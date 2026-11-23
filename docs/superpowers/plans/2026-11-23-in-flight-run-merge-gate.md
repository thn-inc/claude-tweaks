# In-Flight Run Merge Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop another session from marking a pipeline run's draft PR ready or merging it while the run is still in flight, and stop reconcile from settling such a mid-build ("hollow") merge as shipped.

**Architecture:** One shared predicate, `inFlightPhase` (`plugin/bin/lib/flow/inflight-run.js`), decides whether a run is in flight. It says yes when the run is non-terminal and its `build` or `test` phase has not finished. A phase has finished when its PR checklist row is checked, or the row is absent, or the run's own `decisions.md` holds the phase-exit entry. The checklist row is only a pre-filter. `bin/phase-exit.js` gains that entry: today it writes no line on a successful exit, so the spec's "the entry `bin/phase-exit.js` writes" does not exist yet and this plan adds it. A lazily loaded PreToolUse gate (`inflight-pr-gate.js`) applies the predicate to `gh pr ready|merge`. It fails open. On the reconcile side, `detectHollowMerges` (`post-merge.js`) runs before `release`. It holds every merged PR of an in-flight run through release, post-merge and archive, posts one comment per run, and is reported in the summary. It fails closed.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T162803-record-6143/work/6143-spec.md` (record #6143)

Scope keywords: hollow-merge, phaseRowStates, detectHollowMerges, inflight-pr, inFlightPhase, PHASE_EXIT_STEP

(The literal strings `gh pr merge` and `gh pr ready` appear in about 90 prose and test files that describe owner-side merges. Task 4 Step 6's prose sweep classifies them; they are not listed as planned edits.)

## Global Constraints

- **In flight** (verbatim from spec): "the run's `run-state.json` is non-terminal, and its `build` or `test` phase has not finished. A phase has finished when either of these holds: its row in the PR's phases checklist is checked; the run's own `decisions.md` records that phase's exit, as the entry `bin/phase-exit.js` writes under that phase's section. The checklist row is only a fast pre-filter. The phase-exit record decides."
- **Premise reversed:** the spec says `phase-exit.js` writes a local `decisions.md` entry in the same call that flips the row. It does not: on a successful exit it writes nothing (`lib/phase-exit/phase-exit.js` logs only SKIP, refused or failed-push lines; `pr-checklist.js` logs only exits 4 and 5). Task 2 adds the entry: one `AUTO` line, step `Phase exit`, text `{phase} phase exited at {head}`, under `PHASE_SECTIONS[phase]`, written at every phase-exit call before the push, in every route. Expand-contract: runs started on an older release write no such line. Their checked rows still count as finished, so they are judged exactly as the checklist judges them today.
- **A row absent from the span, or no span at all** (an express body from `composeExpressBody`, or a phase removed with `setPhaseRow --remove`), counts as finished. Only a present, unchecked row sends the predicate to `decisions.md`.
- "Non-terminal" means `run-state.json` `status !== 'clean'`, the only terminal status `closeRunState` writes.
- **Gate owner rule** (spec Deliverable 1, Decision follow-ups): the caller is allowed when its `session_id` equals the run-state's `sessionId`, or equals its `dispatchSessionId` (the dispatching session settles and merges a dispatched run, `dispatch/settle-and-merge.md`). **Every caller is allowed when the run-state has no `sessionId`.** The gate fails open when the PR body, the run state or the run's `decisions.md` cannot be read.
- **Reconcile fails closed** (Deliverable 2, Decision follow-ups): when the check cannot finish for a marker-bearing PR (an unreadable body, run state or `decisions.md`, or a throw while checking that run), the PR is held, not settled, and reported. When the whole hollow-merge check fails (setup failure or an uncaught throw), `release`, `post-merge` and `archive` are all skipped for this pass with `{ check: 'release,post-merge,archive', reason: 'hollow-merge-check-failed' }`. Empty hold sets are never passed after a failed check. A PR whose body has no `claude-tweaks-run:` first-line marker, or whose marker names another run, settles as today.
- Commit style: `{Verb} {what} — {detail}`, ending with `refs #6143` (never `closes` or `fixes`), plus the line `Claude-Session: https://claude.ai/code/session_019fFofVFgBteo3LWVg8iJ9W`.
- Project maturity is `established`: "For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it — published or external consumers may depend on them."
- Run tests with `node --test <file>` per file. Never run `git stash`. One plain command per Bash call. Use `git -C "<worktree>"` with absolute paths.

Governing project skills (quoted verbatim; read each named SKILL.md under `.claude/skills/` before starting the task that touches its file):

- `pre-tool-use-gate-exemptions` (Task 4): "**A deny about a run the tool input names reads that run from the main checkout, through neither `ctx.runDir` nor `ctx.ownedRun`.** `checkDispatchPromptGate` (`dispatch-prompt-gate.js`, #4589) is the shipped instance … Treat a named id as untrusted input. Require `ctxLib.RUN_ID_RE`; resolve `{mainCheckoutRoot}/.claude-tweaks/pipelines` through `canonicalRealpath` (a null or throwing `mainCheckoutRoot` allows); and read the run dir only when it canonicalizes, is a directory, and is a direct child of that pipelines dir … Read a run-state only for an entry the input names, and state which runs the gate reads in its header, as that file's "Runs read" paragraph does."
- `pre-tool-use-gate-exemptions` (Task 4): "**A deny on a call that skill prose prescribes fails OPEN on every unprovable answer, and the same change sweeps every prose route into that call.** … State the direction in the gate's header comment and give each fail-open condition its own test in `tests/hooks-pre-tool-use.test.js`. Then, because shipped prose tells the model to make the denied call, grep `plugin/skills/` for every route that reaches it … and either reroute or pin each one in the same change."
- `pre-tool-use-gate-exemptions` (Task 4): "**A gate that reads the shell scanner's targets decides what a `lost` target means for its own concern, and records that choice where the others are stated.**" This gate's reading: a call whose segment cwd differs from `ctx.cwd`, or is `lost`, is not checked (allow), because `gh` would resolve its repo from a cwd the hook cannot prove. Record it in `_shared/policy-schema-coverage.md`'s "Where a relative target resolves" paragraph.
- `pre-tool-use-gate-exemptions` (Task 4): "**Every new exemption needs a regression test proven to go red on revert.**"
- `hook-event-in-process-tests` (Task 4): "**Who calls a helper decides how it takes `env`.** A function only hook events reach takes `env` with no default and throws `TypeError` without it: `ctxLib.assertEnvObject` … Every call from an event module passes `env`." and "**Keep both guards green by fixing, never by widening.**"
- `shell-scanner-bash-differential` (Task 3): applies to the new parser in `git-command.js` and the prefilter that shares it. The prefilter rule from `bash-prefilter.js`'s header: "It must stay a SUPERSET of those predicates: a false "skip" silently drops enforcement, a false "run" costs only the full handler's module load."
- `gh-api-module-pattern` (Tasks 4, 5): "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.**" / "**Inside `plugin/bin/lib/reconcile/`, a runner spawns through `timing.js`'s `execFileSyncTimed` / `execFileAsyncTimed`, never `child_process` directly.**" / "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.**" / use the shared `GH_TIMEOUT_MS`, never a retyped literal. "**Text a module writes into a PR body names no record it does not mean to close.**" This applies to the record comment too.

## Review Focus

1. A PR whose `build` row is unchecked but whose run's `decisions.md` holds the `build` and `test` exits must be allowed by the gate and settled by reconcile. This is the failed-checklist-refresh owner merge. Task 4 test and Task 5 test.
2. `gh pr merge` with no selector, a URL selector or `-R owner/repo`: the gate reads the same PR `gh` would act on, or allows. Task 4.
3. `gh pr ready --undo`, `gh pr view 5` and `gh pr merge --help` are never denied. Task 3 parser test and Task 4 test.
4. A PR body whose marker is not on the first line, or names a run id containing `/` or `..`, or names a run absent from this checkout: the gate allows with no foreign read. Task 4.
5. A hollow merge seen on two reconcile passes gets exactly one comment in total and is held both times. Task 5.

---

### Task 1: Phase-row reader

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/flow/pr-checklist.js` (add exports)
- Test: `tests/bin-lib/flow/pr-checklist.test.js`

**Interfaces:**
- Produces: `phaseRowStates(body: string) -> { span: boolean, rows: { [phase: string]: 'checked' | 'unchecked' } }`. `span` is false when `locatePhasesSpan` finds no span. `rows` holds only rows present inside the span (`- [ ] build` gives `'unchecked'`; `- [x]` and `- [X]` give `'checked'`), with exact phase-name match per `CANONICAL_PHASES` and `\r` tolerated. Also produces `uncheckedBuildOrTest(body: string) -> string[]`: the subset of `['build','test']`, in that order, whose row is present and `'unchecked'`.

- [ ] **Step 1: Write the failing tests.**
  - `phaseRowStates reads checked and unchecked rows inside the span only`: a body from `composePrEarlyBody` (the real writer) has all five rows `'unchecked'`; after `setPhaseRow({phase:'build'})`, build is `'checked'`; a `- [ ] build` line outside the span is ignored; a CRLF body reads the same.
  - `phaseRowStates: no span gives span false, rows {}`: an express body from `composeExpressBody`.
  - `uncheckedBuildOrTest`:
    - a fresh body gives `['build','test']`;
    - after build is checked, it gives `['test']`;
    - after both are checked, it gives `[]`;
    - with the build row removed via `setPhaseRow({phase:'build', remove:true})` and test unchecked, it gives `['test']`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/flow/pr-checklist.test.js`. Expect FAIL (`phaseRowStates is not a function`).
- [ ] **Step 3: Implement** both functions in `pr-checklist.js`, reusing `locatePhasesSpan` and `bare`, and export them.
- [ ] **Step 4: Run** the same command. Expect PASS.
- [ ] **Step 5: Commit** `Add phase-row reader to pr-checklist — build/test unchecked detection, refs #6143`.

### Task 2: Phase-exit record and the shared in-flight predicate

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/phase-exit/exit-record.js`
- Modify: `plugin/bin/lib/phase-exit/phase-exit.js` (write the entry)
- Create: `plugin/bin/lib/flow/inflight-run.js`
- Modify: `docs/plugin-structure.md` (name the two new modules where `lib/phase-exit/` and `lib/flow/` are listed)
- Test: `tests/bin-lib/phase-exit/phase-exit.test.js`, `tests/bin-lib/phase-exit/exit-record.test.js` (create), `tests/bin-lib/flow/inflight-run.test.js` (create)

**Interfaces:**
- Consumes: Task 1 `uncheckedBuildOrTest`; `log-decision/append.js` `formatEntry`, `parseEntry`, `normalizeSection`; `pr-merge-state.js` `PHASE_SECTIONS`.
- Produces from `exit-record.js`:
  - `PHASE_EXIT_STEP = 'Phase exit'`;
  - `phaseExitText(phase: string, head: string|null) -> string`, which returns `` `${phase} phase exited at ${head || 'unknown HEAD'}` ``;
  - `phaseExitRecorded(decisionsText: string, phase: string) -> boolean`, which is true when, under the `## {PHASE_SECTIONS[phase]}` heading, some line parses via `parseEntry` with `status === 'AUTO'`, `location === PHASE_EXIT_STEP` and an action starting with `` `${phase} phase exited at ` ``. Every `## ` heading with that name counts. A line under another section, a hand-written line, or a `SKIP` line does not count.
- Produces from `inflight-run.js`: `inFlightPhase({ runState, body, readDecisions }) -> string | null`. It returns null when `runState` is not an object or `runState.status === 'clean'`. For each phase in `uncheckedBuildOrTest(body)`, in order, it returns that phase unless `phaseExitRecorded(readDecisions(), phase)` holds. `readDecisions` is called at most once, and only when some row is unchecked. Its throw propagates, because callers choose fail-open or fail-closed. Null means the run is not in flight.

- [ ] **Step 1: Characterize.** Run `node --test tests/bin-lib/phase-exit/phase-exit.test.js` and record it green. List which existing tests assert the exact set or count of `appendDecision` calls; they will need the new entry added to their expectations, never removed.
- [ ] **Step 2: Write the failing tests.**
  - `exit-record.test.js`: a line built with `formatEntry({status:'AUTO', step: PHASE_EXIT_STEP, text: phaseExitText('build','abc123'), now})` and placed with `appendEntry` under `/build` is recorded for `build`. The same line under `/test` is not recorded for `build`. A `test` exit under `/test` is recorded for `test`. A `SKIP` line with the same step is not recorded. Neither is a line whose text is `build phase exited` under `/review`. An empty text returns false.
  - `phase-exit.test.js`: `runPhaseExit` appends exactly one `AUTO` entry with location `Phase exit` and text `build phase exited at {head}` under `/build`, through `deps.appendDecision`. Cover the `pr-first`, `local-merge` and `current-branch` routes, and a pushed or failed push. The entry precedes any push line. An `appendDecision` throw on it lands in `logFailures` and does not stop the push.
  - `inflight-run.test.js`, with bodies from `composePrEarlyBody` plus `setPhaseRow`:
    - a non-terminal run with build unchecked and no record gives `'build'`;
    - the same run with a `build` exit recorded but test unchecked gives `'test'`;
    - both exits recorded with both rows unchecked gives `null` (AC: "settles exactly as today, even with those checklist rows unchecked");
    - both rows checked gives `null`, and `readDecisions` is never called;
    - an express body gives `null`;
    - status `clean` gives `null`;
    - a `readDecisions` throw propagates.
- [ ] **Step 3: Run** the three files. Expect FAIL.
- [ ] **Step 4: Implement.** Add `exit-record.js`. In `runPhaseExit`, directly after the worktree validation and the `env.head` read, call `log('AUTO', PHASE_EXIT_STEP, phaseExitText(phase, env.head))`. Add `inflight-run.js`. Add both modules to their file headers and to `docs/plugin-structure.md`.
- [ ] **Step 5: Run** the three files plus `node --test tests/phase-exit-call-sites-conformance.test.js tests/bin-lib/phase-exit/pr-stamp-release-parity.test.js`. Expect PASS.
- [ ] **Step 6: Commit** `Record each phase exit in decisions.md and share the in-flight predicate — refs #6143`.

### Task 3: `gh pr ready|merge` parser and prefilter reach

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (new parser and exported constant)
- Modify: `plugin/bin/lib/hooks/bash-prefilter.js` (a pre-tool-use-only reach rule)
- Test: `tests/hooks-gh-pr-lifecycle-parser.test.js` (create), `tests/hooks-bash-prefilter.test.js`

**Interfaces:**
- Produces, both exported from `git-command.js`:
  - `GH_PR_LIFECYCLE = Object.freeze({ program: 'gh', group: 'pr', verbs: Object.freeze(['merge', 'ready']) })`;
  - `ghPrLifecycleCalls(command: string, cwd: string) -> Array<{ verb: 'merge'|'ready', selector: string|null, repo: string|null, undo: boolean, cwd: string, lost: boolean }>`.

  Walk with `forEachShellSegment` and the module's own command-word resolution (`commandWord`, so `sudo`, `env` and assignment prefixes are read past). Match a segment whose program basename is `gh` (`.exe` stripped), whose next word is `pr`, and whose next is `merge` or `ready`.
  - `selector` is the first positional after the verb, skipping value flags and `--flag=value` forms. Value flags for merge: `-A --author-email -b --body -F --body-file --match-head-commit -t --subject -R --repo`. Value flags for ready: `-R --repo`.
  - `repo` is the `-R`/`--repo` value.
  - `undo` is true when `--undo` is present.
  - `cwd` and `lost` are the walk's segment cwd and lost marker.

- [ ] **Step 1: Write failing parser tests** in the new file:
  - `gh pr merge 123 --squash` gives `[{verb:'merge', selector:'123', repo:null, undo:false}]`.
  - `gh pr merge --squash -b "x y" 123` gives selector `'123'`.
  - `gh pr merge -R o/r https://github.com/o/r/pull/9 --auto` gives the URL as selector and repo `'o/r'`.
  - `gh pr merge --repo=o/r` gives selector null and repo `'o/r'`.
  - `gh pr ready 7` parses; `gh pr ready --undo 7` gives undo true.
  - `cd /x && gh pr merge 5` gives `cwd` `/x`.
  - `echo ok; /usr/local/bin/gh pr merge 5` is found.
  - `gh pr view 5`, `gh issue view 3` and `echo gh pr merge 5` each give `[]`.
- [ ] **Step 2: Add prefilter corpus lines** in `tests/hooks-bash-prefilter.test.js`. Pre-tool-use runs the full handler for `gh pr merge 123 --squash`, `gh pr ready 7` and `cd x && gh pr merge 5`. It still skips `gh issue view 3074` (the existing line, unchanged) and `gh pr view 5`.
- [ ] **Step 3: Run** both files. Expect FAIL.
- [ ] **Step 4: Implement** `ghPrLifecycleCalls` and `GH_PR_LIFECYCLE` in `git-command.js`. In `bash-prefilter.js`, for `pre-tool-use` only, return true when some reading's `commandWords` contains `GH_PR_LIFECYCLE.program`, `GH_PR_LIFECYCLE.group` and one of `GH_PR_LIFECYCLE.verbs`. That rule is a superset of the parser. Do not add `gh` to `GUARDED_PROGRAM_WORDS`, so other `gh` calls keep the skip path. Update the prefilter header comment to name the rule.
- [ ] **Step 5: Run** both files, plus every prefilter differential file (`ls tests | grep prefilter`). Expect PASS.
- [ ] **Step 6: Commit** `Parse gh pr ready/merge calls and reach them from the prefilter — refs #6143`.

### Task 4: In-flight PR gate

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/hooks/named-run.js`. Move `pipelinesDir` out of `dispatch-prompt-gate.js` and add `namedRunDir`.
- Modify: `plugin/bin/lib/hooks/dispatch-prompt-gate.js`. Import `pipelinesDir` and `namedRunDir` instead of its local copy; behavior is unchanged.
- Create: `plugin/bin/lib/hooks/inflight-pr-gate.js`
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js`. In `runInner`, lazy-require the gate inside a `try` for `tool_name === 'Bash'`, placed after `checkPowershellOpaqueCommand` and before `checkDispatchConfigGate`. Update `run()`'s `deps` comment.
- Modify: `docs/hooks.md` (a gate entry covering the trigger, the owner and no-owner exemptions, the fail-open list, and "Runs read") and `plugin/skills/_shared/policy-schema-coverage.md` (this gate's reading under "Where a relative target resolves").
- Modify: `tests/hooks-event-env-conformance.test.js`, only if its scan floors require it (raise, never lower).
- Test: `tests/hooks-inflight-pr-gate.test.js` (create). `tests/hooks-dispatch-prompt-gate.test.js` must stay green unchanged.

**Interfaces:**
- Consumes: Task 2 `inFlightPhase`; `pr-checklist.js` `firstLineRunId(body)`; Task 3 `ghPrLifecycleCalls(command, cwd)`.
- Produces from `named-run.js`:
  - `pipelinesDir(cwd, d) -> string|null`, moved verbatim;
  - `namedRunDir(cwd, runId, d) -> string|null`: requires `RUN_ID_RE`, canonicalizes, checks it is a directory and a direct child of pipelines. These are the checks `checkMismatch` does today; switch `checkMismatch` to use it.
- Produces from `inflight-pr-gate.js`: `checkInflightPrGate(ctx, deps = {}, deny) -> {} | denyResult`, exported with `GATE = 'inflight-pr'`. Its `deps` seams are:
  - `readPrBody(call, ctx) -> { body: string, number: number } | null`;
  - `mainCheckoutRoot`;
  - `readRunState`;
  - `readDecisions(runDir) -> string`, which throws when unreadable;
  - `fsImpl`.

  The default `readPrBody` runs `gh pr view [selector] [--repo repo] --json body,number` with `execFileSync('gh', args, ghOptions(args, { cwd: ctx.cwd, env: ctx.env, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: GH_TIMEOUT_MS, windowsHide: true }))`. It returns null on any throw or unparseable output.

Decision per call. Call `ctxLib.requireEnv(ctx)` before the `try`. Deny only when every step below is proven; any throw allows (`{}`):
1. Skip a call with `undo`.
2. Skip a call whose `lost` is true or whose `cwd` differs from `ctx.cwd`.
3. A null body allows.
4. A null `firstLineRunId` allows.
5. A null `namedRunDir` allows.
6. A null run-state allows.
7. A run-state with no non-empty string `sessionId` allows.
8. A caller `session_id` equal to `sessionId` or to `dispatchSessionId` allows.
9. `phase = inFlightPhase({ runState, body, readDecisions: () => readDecisions(runDir) })`. A throw from it allows; a null phase allows.
10. Otherwise, append a `gate-denial` event (`{ tool: 'Bash', gate: GATE, pr: number, phase, ...testTag }`) to the run dir and deny with this reason:

`claude-tweaks: PR #{number} is the draft PR of pipeline run {runId}, which is still in flight ({phase} phase not finished) and is owned by session {sessionId}. Marking it ready or merging it now would ship a half-built change (#6143). Leave it to that run's own wrap-up. If the run is abandoned, settle it first (/claude-tweaks:dispatch resume, or /claude-tweaks:wrap-up {target} cleanup-only), then retry.`

- [ ] **Step 1: Characterize.** Run `node --test tests/hooks-dispatch-prompt-gate.test.js` and record it green before moving `pipelinesDir`.
- [ ] **Step 2: Write failing tests** in `tests/hooks-inflight-pr-gate.test.js`. Drive them through `pre-tool-use.js`'s `run(ctx, deps)`, with ctx built as `tests/hooks-dispatch-prompt-gate.test.js` builds it. Write the run-state with the real `hooks.js record-worktree` writer via `runCli`, session `S`. Build the PR body with `composePrEarlyBody` (the real writer), and have `deps.readPrBody` return it. Write phase-exit lines into `decisions.md` with `formatEntry` and `appendEntry`, using `PHASE_EXIT_STEP` and `phaseExitText`.
  - `AC1.1: gh pr merge 123 --squash on an active run with build unchecked is denied`. Expect deny JSON whose reason names the run id and session `S`, and a `gate-denial` event in the run's `events.jsonl`.
  - `AC1.2: the same command from the owning session is allowed` (caller session `S`). Add a `dispatchSessionId` owner case (record-worktree `--dispatch`).
  - `AC1.3: an unreadable PR is allowed` (`readPrBody` returns null). Also cover the default runner path: `readPrBody` omitted, with `PATH` in the passed env pointing at a stub `gh` that exits 1, is allowed.
  - `AC2.1: gh pr ready 123 behaves the same way as the merge case`: deny for a foreign session, allow for the owner, allow for an unreadable PR.
  - `AC3.1: a run whose run-state has no sessionId is allowed`. Write the run-state fixture by hand with the `sessionId` key absent. Note this in the test as the one hand-written shape, since every real writer stamps it.
  - `AC3.2: an active run whose build and test rows are unchecked but whose decisions.md records both phase exits is allowed`.
  - The remaining cases:
    - test unchecked with build checked and no test exit: denied;
    - both rows checked: allowed;
    - an express body (no span): allowed;
    - `run-state` status `clean` (written by the real `close-run` writer, or by `closeRunState`): allowed;
    - an unreadable `decisions.md` (`readDecisions` throws) with build unchecked: allowed;
    - a marker on line 2 only: allowed;
    - a marker naming a missing run, `../x`, or a symlinked run dir: allowed;
    - `gh pr ready --undo 123`: allowed, and `readPrBody` is never called;
    - `cd /elsewhere && gh pr merge 5`: allowed, and `readPrBody` is never called;
    - selector-less `gh pr merge --squash`: `readPrBody` is called with `selector: null`;
    - `-R o/r 5`: `readPrBody` is called with `repo: 'o/r'`;
    - a load fault (a require-cache stub that throws): allowed.
  - Revert check: for the owner test, the `dispatchSessionId` test, the no-`sessionId` test, the phase-exit-recorded test and the `--undo` test, revert only that clause in `inflight-pr-gate.js` (or `inflight-run.js` for the phase-exit test). Confirm that only that test goes red, and record the observed failure in the commit message body.
- [ ] **Step 3: Run** the new file. Expect FAIL (module not found).
- [ ] **Step 4: Implement.** Add `named-run.js` and switch `dispatch-prompt-gate.js` to it. Implement `inflight-pr-gate.js` with a header comment stating the direction (fails OPEN), the fail-open list, and "Runs read: neither ctx.runDir nor ctx.ownedRun — the run the PR body's first-line marker names, in the main checkout (its run-state.json and decisions.md)". Then wire `runInner`.
- [ ] **Step 5: Run** `node --test tests/hooks-inflight-pr-gate.test.js tests/hooks-dispatch-prompt-gate.test.js tests/hooks-pre-tool-use.test.js tests/hooks-event-env-conformance.test.js tests/hooks-bash-prefilter.test.js`. Expect PASS. Then run the new file once more with `npx -y node@20 --test tests/hooks-inflight-pr-gate.test.js`.
- [ ] **Step 6: Prose sweep.** Run `grep -rn "gh pr merge\|gh pr ready" plugin/skills/`. For each hit, confirm the caller is the run's owner (its own wrap-up or dispatch settle) or a merge of a finished run. List every hit and its classification in the commit body. Reroute none unless a hit sends a non-owner session to merge an in-flight run.
- [ ] **Step 7: Update** `docs/hooks.md` and `_shared/policy-schema-coverage.md` as listed above.
- [ ] **Step 8: Commit** `Deny gh pr ready/merge on a PR whose run is still in flight — owner and ownerless allowed, fails open; refs #6143`.

### Task 5: Hollow-merge detection in reconcile post-merge

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/post-merge.js`. Add a new export, `detectHollowMerges`. `postMerge` gains `hollowRunDirs` and skips those runs.
- Test: `tests/bin-lib/reconcile/post-merge.test.js`

**Interfaces:**
- Consumes: Task 2 `inFlightPhase`; `firstLineRunId`.
- Produces: `detectHollowMerges({ cwd, prStates, dryRun = false, deps = {} }) -> Promise<{ entries: Array<{ runDir, runId, pr, action: 'held', reason: 'hollow-merge'|'hollow-check-failed', phase?: string, detail?: string, commented?: number[], records?: number[] }>, hollowRunDirs: string[], failure?: string }>`.
  - It uses the same `setupContext` as `postMerge`. On a setup failure it returns `{ entries: [], hollowRunDirs: [], failure }`, and the caller fails closed (Task 6).
  - The candidate set is `listRunDirsWithState(root)` (non-terminal runs only) whose state has an integer `pr.number`. Skip any candidate where `prStates.byNumberAsync(pr)` is not `MERGED`; it gets no entry.
  - For a MERGED PR, everything below runs inside a per-run `try`. A throw anywhere gives an entry `{ action:'held', reason:'hollow-check-failed', detail }` for that run, and adds the run dir to `hollowRunDirs` with no comment.
  - Read the body with `ctx.timedGh(['pr','view', String(pr), '--json', 'body,closingIssuesReferences,mergedAt'])` (a `deps.gh` fake in tests). A failed or unparseable read gives `hollow-check-failed`.
  - `firstLineRunId(body) !== basename(runDir)` gives no entry: the PR is not this run's, and it settles as today.
  - `phase = inFlightPhase({ runState: state, body, readDecisions: () => fs.readFileSync(path.join(runDir,'decisions.md'),'utf8') })`. A throw (including ENOENT) gives `hollow-check-failed`. A null phase gives no entry.
  - Otherwise the merge is hollow. `records` are the closing references in this repo (number plus owner/name match, as `prClosesIssue` does); failing that, the run's `config.yml` `spec:` single number (`readSpecNumber`).
  - Unless `decisions.md` already holds an entry whose location is `HOLLOW_STEP = 'reconcile hollow-merge'`, or `dryRun` is set: post one `gh issue comment {n} --body-file -` per record (body on stdin), then append one `AUTO` entry with step `HOLLOW_STEP` to the run's `decisions.md` via `appendEntry`, naming the PR, the merge time and the commented records.
  - Comment text: `Reconcile: PR #{pr} (run {runId}) was merged at {mergedAt} while the run's {phase} phase was unfinished — a hollow merge. The claim, the auto:build grant and the run directory are left in place; the code this record asked for may not have landed. Reopen this record if the merge closed it, then resume or settle the run.`
- `postMerge({..., hollowRunDirs = []})`: a candidate in that set yields the entry `{ action:'skipped', reason:'hollow-merge' }` and is deferred.

- [ ] **Step 1: Write failing tests** using the file's `mainCheckout`, `addRun` and `fakePrStates` builders (run-state status `in-progress`). One real-writer case uses `hooks.js record-worktree` for the run-state and `composePrEarlyBody` for the body.
  - `AC4.1 (detection): a merged PR whose marker names an active run with build unchecked and no build phase-exit record is held, commented once, and marked`. Expect one `issue comment` call on the closing record, one marker line, the entry `{action:'held', reason:'hollow-merge', phase:'build'}`, and the run dir in `hollowRunDirs`.
  - `AC4.2 (detection): build finished (exit recorded) but test unfinished is held with phase 'test'`.
  - A second `detectHollowMerges` call on the same fixture: held again, with zero new comments.
  - `AC5 (detection): a merged PR whose phases are all checked yields no entry`. Also, a `clean` run is never read (no `gh` call).
  - `AC6 (detection): a non-terminal run whose decisions.md records the build and test phase exits yields no entry, even with both rows unchecked`.
  - `AC7 (detection)` cases:
    - a body read that throws gives `hollow-check-failed`, held, with no comment and no marker;
    - a missing `decisions.md` with build unchecked gives `hollow-check-failed`, held;
    - a `deps` seam that throws mid-check (for example `readSpecNumber`) gives `hollow-check-failed`, held, and the other runs are still judged;
    - a body with no marker gives no entry.
  - `dryRun` gives held, with no comment and no marker. A marker naming another run gives no entry. An express body gives no entry. An OPEN PR gives no entry and no body read.
  - `postMerge` with `hollowRunDirs` containing the run: no Step 4.0/4.0b fake call, the entry `hollow-merge`, and the run in `deferred`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/reconcile/post-merge.test.js`. Expect FAIL.
- [ ] **Step 3: Implement** in `post-merge.js`. Spawn only through `ctx.timedGh`, that is `execFileSyncTimed` plus `ghOptions` plus `GH_TIMEOUT_MS`. Add a `detectHollowMerges` paragraph to the file header stating that it fails closed.
- [ ] **Step 4: Run** the file. Expect PASS. Also run `node --test tests/bin-lib/reconcile/subprocess-timing-conformance.test.js` (or the subprocess-timing conformance file under `tests/` if it lives there).
- [ ] **Step 5: Commit** `Detect hollow merges in reconcile post-merge — hold and comment once, fail closed; refs #6143`.

### Task 6: Hold hollow runs through release, archive and the summary

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/release-merged.js`. `releaseMerged({..., hollowRunIds = []})`: a candidate whose `runId` is listed is skipped with reason `hollow-merge` before `decideRelease`, with no tombstone, no `bot:in-progress` removal and no grant strip.
- Modify: `plugin/bin/lib/reconcile/index.js`. Call `detectHollowMerges` before the `release` block whenever `release`, `post-merge` or `archive` is in `checks`, wrapped in a `try`.
  - On `failure` or a throw, push `{ check: 'release,post-merge,archive', reason: 'hollow-merge-check-failed', detail }` to `result.skipped` and skip all three blocks this pass (fail closed).
  - Otherwise, pass `hollowRunIds` (basenames) to `releaseMerged` and `hollowRunDirs` to `postMerge`, and append `hollowRunDirs` to `postMergeDeferred` for `archiveMerged`.
  - Set `result.hollowMerges = entries`.
- Modify: `plugin/bin/lib/reconcile/format-summary.js`. `formatSummary(result)` is the summary `hooks.js reconcile` prints. Add one line per held run:
  - `hollow-merge`: `hollow merge held: PR #{pr} (run {runId}) — {phase} unfinished; claim, auto:build and run dir kept`, plus `; commented on #{n}` when commented.
  - `hollow-check-failed`: `hollow-merge check failed for run {runId}; held this pass`.
  - The `hollow-merge-check-failed` skip renders through the existing skipped-line path.
- Test: `tests/bin-lib/reconcile/release-merged.test.js`, plus the index-level file that drives `reconcile()` with stubbed checks (find it with `grep -ln "releaseMerged\|archiveMerged" tests/reconcile*.test.js`).

**Interfaces:**
- Consumes: Task 5 `detectHollowMerges` and `postMerge({ hollowRunDirs })`.
- Produces: `result.hollowMerges` on `reconcile()`'s result.

- [ ] **Step 1: Characterize** `releaseMerged`. Confirm an existing test (or add one) asserting that a MERGED+closing claim is released with a grant strip. This is the AC5 baseline.
- [ ] **Step 2: Write failing tests.**
  - release-merged: `hollow-merge: a listed runId is skipped, no tombstone write, no label edit`. Assert the fake `ghApi`/runner saw no write. An unlisted run releases exactly as before.
  - index level, `AC4.1: a merged PR whose marker names an active run with build unchecked leaves the claim, auto:build and the run directory in place, posts one comment, and appears in the summary`. Drive `reconcile()` with the existing stub seams so detection reports the run hollow. Assert that `releaseMerged` received `hollowRunIds`, that the run dir still exists unarchived, that `result.hollowMerges` has the entry, and that `formatSummary(result)` contains `hollow merge held: PR #`.
  - index level, `AC5: a merged PR whose run is clean and whose phases are all checked settles exactly as today`. Detection finds nothing; release, post-merge and archive receive empty hollow sets; the summary has no hollow line.
  - index level, `AC7: the whole hollow-merge check failing holds release, post-merge and archive`. Stub detection to return `failure`, then to throw. In both cases none of the three is called, `result.skipped` holds `hollow-merge-check-failed`, and the run dir is not archived.
- [ ] **Step 3: Run** the touched test files. Expect FAIL.
- [ ] **Step 4: Implement** the three modifications.
- [ ] **Step 5: Run** `node --test tests/bin-lib/reconcile/release-merged.test.js tests/bin-lib/reconcile/post-merge.test.js tests/reconcile-dispatch.test.js tests/reconcile.test.js tests/reconcile-archive-residue.test.js` plus the index-level file. Expect PASS.
- [ ] **Step 6: Commit** `Hold hollow-merged runs through release, archive and the reconcile summary — fail closed on a failed check; refs #6143`.

## Spec coverage

| Spec item | Task |
|---|---|
| In-flight definition (non-terminal; row is a pre-filter; phase-exit record decides) | Tasks 1-2 |
| Deliverable 1 / AC1 (merge deny, owner allow, unreadable allow) | Tasks 3-4 |
| AC2 (`gh pr ready`) | Tasks 3-4 |
| AC3 (no `sessionId` allows; recorded exits allow) | Tasks 2, 4 |
| Deliverable 2 / AC4 (hollow held, commented once, summarized; build done, test not) | Tasks 5-6 |
| AC5 (clean run, all checked, settles as today) | Tasks 5-6 |
| AC6 (non-terminal run with recorded exits settles as today) | Tasks 2, 5 |
| AC7 (check throws or unreadable: held and reported; no marker settles) | Tasks 5-6 |
