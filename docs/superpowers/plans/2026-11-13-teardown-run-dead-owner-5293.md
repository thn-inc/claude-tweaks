# teardown-run Dead-Owner Merged Teardown Implementation Plan (#5293)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `teardown-run --merged` call from a later session tears down a run whose recorded owner is provably dead, and still refuses a run whose owner is alive or whose liveness cannot be judged.

**Architecture:** `teardownRun` (`plugin/bin/lib/hooks/teardown-run.js`) today returns a refusal whenever `closeRunState` reports `refused-foreign`. On that branch, when `mode === 'merged'`, it asks the sanctioned run-liveness verdict (`runLiveness(runDir, opts.liveness)` from `plugin/bin/lib/run-liveness/index.js`) and proceeds only on `verdict === 'dead'`: it re-calls `closeRunState` with `explicit: true` and continues the unchanged Steps 1-5, with one leading line naming the dead owner. Every other verdict (`live`, `unknown`) and every other mode keeps the whole-teardown refusal, whose line now names the verdict. Docs name the path in `merge-mode.md` and Section C.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T003948-spec-5293/work/5293-spec.md`

**Scope keywords:** teardown-run, another session

## Global Constraints

- Liveness is judged only through `runLiveness` (the three-valued `live | dead | unknown` verdict, "built from POSITIVE evidence over injectable probes"; "Precedence (decideVerdict): any positive among the four live probes -> live; else any error -> unknown; else any death witness -> dead; else unknown"). Never add a private probe (`isPidAlive`, `process.kill`, `probeOwnerPid` called directly, a commit-recency read) to `teardown-run.js` — `tests/run-liveness-callers-conformance.test.js` states the house rule: "Each now answers 'is this run live?' through a sanctioned path, not a probe of its own."
- Only `verdict === 'dead'` proceeds. `unknown` is never treated as dead (the module's own rule: "an unanswered probe can only ever push the verdict toward `unknown`"). Decided by the user at plan review: "dead" in AC1 means this verdict (spec `## Plan Review Clarifications`).
- Decided by the user at plan review: on the dead-owner path only, a worktree whose lock is orphaned (`worktree-reap.js`'s `lockVerdict(entry) === 'orphaned'`, the lock reader `isWorktreeLocked` already uses — a lock check, not a run-liveness probe) is unlocked with `git worktree unlock` before `git worktree remove`, as the reaper does (`worktree-reap.js`: `if (verdict === 'orphaned') runGit(['worktree', 'unlock', real], root)`). An `in-use` lock still skips; an `unknown` lock (no pid in its reason) is left locked.
- The override applies only when `mode === 'merged'`. `--abandoned` and no mode keep the refusal unchanged in behavior.
- The refusal stays whole-teardown: nothing removed, no branch or ref deleted, no `ghApiDelete` call.
- The refusal line keeps the shape `state: refused — run recorded by another session…` (existing AC5 asserts `/refused .* another session/`).
- Production callers pass no liveness options: `hooks.js`'s `teardownRun(runDir, { mode, sessionId, cwd })` call is unchanged.
- From `.claude/skills/driver-skill-outcome-taxonomy/SKILL.md` (governs `merge-mode.md`): "| Reporting an engine's refusal by its exit code or reason word alone, when only its message names the remedy the user must act on | Relay the engine's own text beside the code. …" — merge-mode's report relays teardown-run's refusal line verbatim.
- From `.claude/skills/removal-condition-execution/SKILL.md`: "Other files cite steps by number." — add no step numbers to, and remove none from, Section C or merge-mode's Procedure.
- `plugin/skills/wrap-up/cleanup-procedures-execution.md` is 47,138 B against the 52,500 B `RAIL_BYTES` rail (5,362 B headroom); its addition stays under 400 B. `merge-mode.md` is 15,121 B (ample headroom).
- Hand-written commit style: `{Verb} {what} — {detail}`, ending with the `Claude-Session:` trailer line given in the dispatch prompt.

Other project skills checked for these files and found not to apply: `gh-api-module-pattern` (no new `gh`/`git` call), `windows-checkout-test-parity` (no new path comparison), `hooks-js-verb-registration` (no new flag), `bin-source-scan-conformance` (no source-scan suite added).

## Review Focus

1. A recently-died owner (heartbeat inside `LIVE_WINDOW_MS`, 10 min) reads `live` and is refused — expected and conservative; the next merge-mode re-run or the reconciler finishes it. Pinned by the live-owner test's mechanics, not a separate test.
2. An owner on another host (`other-host`) reads `unknown` and must be refused, never treated as dead — Task 1 test `#5293: unknown liveness`.
3. A dead owner under `--abandoned` must still be refused — Task 1 test `#5293: dead owner, abandoned`.
4. A legacy run with no owner block can read `dead` through run-liveness's legacy witness (72 h of silence); that is the project's single definition of dead and is accepted here, not special-cased.
5. The proceed path's `closeRunState(…, explicit: true)` write must still close the run (`state: closed` line) — asserted in the dead-owner test.

---

### Task 1: Dead-owner override in teardown-run

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/teardown-run.js` (imports near line 16-22; the refusal branch at lines 172-200, including its comment block)
- Test: `tests/hooks-teardown-run.test.js` (append after AC5, line ~162)

**Interfaces:**
- Consumes: `runLiveness(runDir, { now, probes })` → `{ verdict: 'live'|'dead'|'unknown', evidence }` from `plugin/bin/lib/run-liveness/index.js`; `closeRunState(runDir, { explicit, callerIdentity, checkLiveWorktree })` from `./close-run-state`; `ownerBlock({ sessionId, now, deps })` from `plugin/bin/lib/hooks/context.js` (tests only — the real owner-block writer).
- Produces: `teardownRun(runDir, opts)` gains optional `opts.liveness` (`{ now?: number, probes?: object }`), passed verbatim as `runLiveness`'s second argument. Return shape unchanged (`{ lines: string[] }`).

Output lines (exact):
- Proceed path, first line: `owner: session {owner} is not running (run-liveness: dead) — merged teardown proceeds from this session`, where `{owner}` is the run-state's `sessionId` (or `unknown` when absent); then the existing Step 1-5 lines.
- Refusal: `state: refused — run recorded by another session (run-liveness: {verdict}); teardown-run overrides this only for a --merged teardown of a run whose owner is dead`. For a non-merged mode, `{verdict}` is the literal `not checked` (liveness is not asked).

- [ ] **Step 1: Write the failing tests**

Append six tests to `tests/hooks-teardown-run.test.js` (covers AC1.1 — the three dead-owner merged tests; AC2.1 — the live-owner test). Each uses `fixtureRepo()`, writes an empty `events.jsonl` into `runDir` (run-liveness's owner-events probe throws on a missing file, which reads `unknown`; every real run carries one — the incident run `2026-11-02T065743-record-4811` has 169 lines), then writes run-state with the file's local `writeRunState` helper as `{ status: 'active', worktree: wt, sessionId: 'someone-else', owner: ownerBlock({ sessionId: 'someone-else', deps: { resolveOwnerPid: () => ({ pid: P, pidSource: 'env' }) } }) }` — `ownerBlock` (from `plugin/bin/lib/hooks/context.js`) is the real writer of the owner-block shape, so `host` and `pidStartedAt` are what production stamps. Every test except the abandoned one (whose liveness is never asked) passes `liveness: { now: Date.now() + 2 * LIVE_WINDOW_MS, probes: {...} }` (import `LIVE_WINDOW_MS` from `plugin/bin/lib/run-liveness/constants.js`) so the fresh heartbeat and the fixture's fresh commit both read stale. Probe injection, so verdicts are platform- and pid-reuse-independent: a dead-owner test passes `probes: { pidAlive: () => false }`; the live-owner test injects one `pidStartTime` function (returning a fixed string) both as `ownerBlock`'s `deps.pidStartTime` and as `probes.pidStartTime`, with `probes.pidAlive: () => true` (real `pidStartTime` returns null on win32, which reads `alive-no-start-time`, not `live`). All other probes stay real.

Real-input probe (authoring time): `runLiveness` on the incident run `2026-11-02T065743-record-4811` returns `verdict: dead` (owner-pid `negative/gone`, heartbeat `stale`, worktree-lock and last-commit `no-worktree`), so the override fires on the reported case.

- `#5293: dead owner, merged — a later session tears the run down` — `P` = the pid of a child that has already exited (`spawnSync(process.execPath, ['-e', ''])`'s `.pid`). Assert: `lines[0]` matches `/^owner: session someone-else is not running \(run-liveness: dead\)/`; some line is `state: closed` or starts with it; the worktree is gone from `git worktree list`; `git branch --list feat-branch` is empty; `calls.length === 1` (the remote-ref delete).
- `#5293: dead owner, merged, worktree locked by the dead session — unlocks then removes` — dead `P` as above; after `fixtureRepo()`, lock the worktree with `git worktree lock --reason "claude session someone-else (pid {P})" {wt}` (the reason shape real locks carry, so `lockVerdict` parses the pid and reads `orphaned`). Assert: the `owner:` line; the worktree is gone from `git worktree list`; the branch is gone; `calls.length === 1`.
- `#5293: live owner, merged — still refused` — `P` = `process.pid`. Assert: `lines.length === 1`, `lines[0]` matches `/refused .* another session \(run-liveness: live\)/`; worktree still listed; branch still present; `calls.length === 0`.
- `#5293: dead owner, abandoned — still refused` — dead `P` as above, `mode: 'abandoned'`. Assert: one line matching `/refused .* another session \(run-liveness: not checked\)/`; worktree still listed; `calls.length === 0`.
- `#5293: unknown liveness, merged — still refused` — dead `P`, but the block's `host` overwritten to `'some-other-host'` before writing. Assert: one line matching `/refused .* another session \(run-liveness: unknown\)/`; worktree still listed; `calls.length === 0`.

- `#5293: dead owner, merged, run already closed by Section C step 3.6` — the shape merge mode actually hands teardown-run (the incident run's): run-state `{ status: 'clean', worktree: null, worktreeAtClose: wt, sessionId: 'someone-else', pr: { number: 1, branch: 'feat-branch' }, owner: <dead block> }`. Assert: `lines[0]` is the `owner:` line; the worktree is gone from `git worktree list` (recovered from `pr.branch`); the branch is gone; `calls.length === 1`.

The live, abandoned and unknown tests already refuse under today's code; they fail only on the new `(run-liveness: …)` text, so all six fail until Step 3.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern "#5293" tests/hooks-teardown-run.test.js`
Expected: FAIL — 6 failing (the three dead-owner merged tests on their `owner:` line, the other three on the `(run-liveness: …)` text).

- [ ] **Step 3: Implement the override in `teardownRun(runDir, opts)`**

On `state.status === 'refused-foreign'`: if `mode !== 'merged'`, return the refusal with `not checked`. Otherwise compute `runLiveness(runDir, opts.liveness)`; any verdict but `dead` returns the refusal naming it. On `dead`, re-call `closeRunState` with the same options plus `explicit: true`, push the `owner:` line, and fall through to the existing Step 1 handling with that second result as `state`. In Step 3 (worktree removal), on this dead-owner path only, read the worktree's `git worktree list --porcelain` entry (`findWorktreeEntry`, already imported) and, when `lockVerdict(entry) === 'orphaned'`, run `git worktree unlock {path}` before the existing removal; report an unlock failure in the worktree line with `describeGitFailure` and skip the removal. Rewrite the comment block above the call (lines 172-181) to state the new rule and cite #5293. Leave the `refused-live-worktree` branch as is.

Guard discrimination: deleting the `mode === 'merged'` check turns the abandoned test red; weakening `verdict === 'dead'` to `verdict !== 'live'` turns the unknown test red; deleting the liveness check entirely turns the live test red; deleting the orphaned-lock unlock turns the locked-worktree test red; reverting the whole change turns both dead-owner merged tests red (Step 5).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-teardown-run.test.js`
Expected: PASS, every test including the existing AC5.

- [ ] **Step 5: Verify the dead-owner test discriminates**

Covers AC3.1. After committing (Step 6), run the dispatch prompt's "Discrimination checks in a scratch checkout" procedure (never `git stash`, never an in-place revert in the shared worktree): in the scratch checkout, `git checkout {base-sha} -- plugin/bin/lib/hooks/teardown-run.js` (the pre-task version), then run the new tests file there — Expected: the dead-owner merged tests FAIL, while the unmutated scratch run passed first. Quote both raw outputs in the report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/teardown-run.js tests/hooks-teardown-run.test.js
git commit -m "Tear down a merged run whose owner is dead — teardown-run asks run-liveness before refusing another session's run (#5293)"
```

### Task 2: Name the later-session teardown path in the wrap-up docs

**Role:** integration

**Files:**
- Modify: `plugin/skills/wrap-up/merge-mode.md` (Procedure step 3, after its Section C sentence)
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md` (Section C step 5, after the paragraph ending "…for the transition (removal condition: `bin/hooks.js`'s `KNOWN_FLAGS` comment).")

**Interfaces:**
- Consumes: Task 1's two output lines (exact text above).

- [ ] **Step 1: Edit `merge-mode.md` Procedure step 3**

Add: the parked run is recorded by the session that parked it, so Section C step 5's `teardown-run --merged` tears it down from this session only when run-liveness reads that owner `dead`. While the owner is `live` or `unknown`, the call removes nothing; report it in merge-mode's existing Outcomes vocabulary as `cleanup: teardown-run failed — {teardown-run's refusal line}` (relaying the engine's own text; no new outcome word) and leave the worktree and branches to the owning session or the reconciler, naming a later `/claude-tweaks:wrap-up #{n} merge` re-run.

- [ ] **Step 2: Edit Section C step 5 (≤400 B added)**

Add one sentence: a run recorded by another session (a parked run under `merge-mode.md`) is torn down only under `--merged`, and only when run-liveness's verdict for it is `dead`; otherwise the whole call refuses, naming the verdict, and removes nothing (#5293).

- [ ] **Step 3: Verify size and pins**

Covers AC4.1: `grep -n "run-liveness" plugin/skills/wrap-up/merge-mode.md` — Expected: the Procedure step 3 sentence naming the teardown path.
Run: `wc -c plugin/skills/wrap-up/cleanup-procedures-execution.md` — Expected: under 47,540.
Run: `node --test tests/skill-size-single-source.test.js` and every test file that reads either skill file (`grep -rl "merge-mode.md\|cleanup-procedures-execution.md" tests`) — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/wrap-up/merge-mode.md plugin/skills/wrap-up/cleanup-procedures-execution.md
git commit -m "Name the later-session teardown path — merge mode and Section C cite teardown-run's dead-owner rule (#5293)"
```
