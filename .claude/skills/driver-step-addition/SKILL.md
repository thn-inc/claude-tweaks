---
name: driver-step-addition
description: Use when adding a step to the pipeline driver's table (`STEPS` in `plugin/bin/lib/driver/steps.js`, walked by `plugin/bin/drive.js`), changing a step's stop class, giving a step a new side effect, or adding a loop above the record (such as `drive.js --budget`) that emits its own event line or reads a record's facts. Lists every site the step lands in across `events.js`, `steps.js`, `run.js` and `tests/bin-lib/driver/run.test.js`, plus the decisions it owes: its default stop class, a per-result override, the ctx flag and interruptClass rung for a new durable side effect, the interrupt check after an await, neutralizing worker text, and the one-retry rule. Keywords - drive.js, driver, STEPS, STEP_NAMES, defineStep, stop class, STOP_CLASSES, OUTCOME_BY_CLASS, interruptClass, ctx flag, newCtx, finalEvent, settle unit, event vocabulary, BUDGET_STEP, run-level event, driveRecord, express-lane port, harness, defaultScript.
---

# Driver step addition

## Overview

`plugin/bin/drive.js` takes each named record from admission to a draft PR, and, when the record carries `auto:merge` and `auto:build` and the judgment supplier clears it (`plugin/bin/lib/driver/judgments.js`'s merge-check and acceptance workers, which `mergeStep` builds from `realDeps.createJudgments`, #5228), on through the merge step (`plugin/bin/lib/driver/merge.js`) to a merged or auto-merge-armed PR. It walks `plugin/bin/lib/driver/steps.js`'s frozen `STEPS` table once per record. `run.js` owns only event emission, stop handling and interrupts, and it names no step, so most of a new step is one table entry.

Not all of it, though. The loop classifies an interrupted record by the side effects the record holds, and it sees only the effects a step records on `ctx`. #5218 shipped with run.js's header saying "adding a step is a table entry, never a change here". Review then found that `interruptClass`, `finalEvent` and `reportInterrupt` read flags that steps set. A step with a new durable side effect would therefore get the wrong interrupt class, and the header was narrowed (`8bcc7eef5`).

## Sites

| Site | What lands there |
|---|---|
| `plugin/bin/lib/driver/events.js` `STEP_NAMES` | The step's name, at its table position. This list is the pipeline-step vocabulary. Event lines also carry `FINAL_STEP`, the settle and merge sub-step names, and the run-level `BUDGET_STEP`, each kept in a list or constant of its own (see "A loop above the record"). Event fields may be added but never renamed, because the settle unit reads the final line's `stop` |
| `plugin/bin/lib/driver/steps.js` | A `defineStep(STEP.{camelName}, STOP_CLASSES.{X}, fn)` entry, placed in `STEPS` at the same index as its name. A step that ports a section of `plugin/skills/_shared/express-lane.md` names that section in its comment. No test reads that prose, so the two are kept in step by hand |
| `plugin/bin/lib/driver/run.js` `newCtx` and `interruptClass` | Needed only for a new durable side effect. Initialize its flag in `newCtx`, and set it in the step once the effect exists. Then add a rung to `interruptClass` where its class falls in the ladder (`configWritten`, then `pushed`, then `runDir`, then `claimed`, else refused). Never add a step-name literal: `AC13.1` scans run.js's comment-stripped code for one. A step whose result is `skip: true` emits no event line and does not halt; use it for a step a policy turns off, so an off step leaves the event stream as it was |
| `realDeps` in `run.js` | Each new external call, as a `deps` member with its own bound (see `gh-api-module-pattern`). A new gh-shaped kind states its reason beside it, as `ghBatch` and `ghCreate` do |
| `tests/bin-lib/driver/run.test.js` | A happy-path reply in `defaultScript` for every call the step makes, because the harness throws `unexpected {kind} …` on anything else — except `git rev-parse`, which a catch-all `[onGit('rev-parse'), exitOne]` answers as absent (the leftover and settle probes rely on it). A new `rev-parse` read gets its own default reply placed before that catch-all, matched narrowly enough (its cwd, its flags) that the main checkout's `--quiet` probes keep their absent answer, as #5458's `isBranchRead` does. A new gh-shaped dep kind joins the kind list in `dispatch` that refuses `pr merge` and `pr ready` (AC8). Add a `SCENARIOS` entry and a row in `AC7.1, AC7.7: outcome and stop class for every stop (table-driven)` for each new stop. A new flag also gets a case in `interruptClass keys on the side effect held` |
| `plugin/bin/lib/driver/settle.js` `selectRow`, `SETTLE_ROWS`, `CLASS_BY_ROW` | Needed for a new stop class: a `selectRow` case, a `SETTLE_ROWS` row and a `CLASS_BY_ROW` entry. Without the case, `selectRow`'s default settles the stop by the `blocked` row and flags it `unclassified`, and no test fails, because `selectRow`'s test lists the known classes by hand. A new pre-push `reason` must be one of `ESCALATION_REASONS`: `stopObject` passes it through `toEscalationReason`, which turns anything else into `express-error`. A new durable side effect that a pre-push stop must undo also needs a field in `stopObject`'s `created` and a settle call on the `pre-push` row |
| `docs/driver.md` | Copied by hand. A few tests in `run.test.js` pin named rules in it (the `AC9.1` docs tests, and #5454's tree-stop test), so a change to a pinned rule's wording updates its test too; nothing checks the rest. For a new step: the `step` list under "Event lines". For a new stop class: the "Outcome words" table, the `stop` object's class list, `settleRow`'s row list and the "When a run stops" table |

## Decisions each step owes

### Default class: what the record holds if this step fails

A step's class is the stop class of a failure inside it. It is keyed on what has been written by that point, never on the step's name or position. This is `driver-skill-outcome-taxonomy`'s rule of picking the word from the world, applied in code. `events.js`'s `OUTCOME_BY_CLASS` maps each class to an outcome word: refused to refused, claim to blocked, pre-push to express-escalated, blocked to blocked, and none to pending-review.

### Override per result when a failure still leaves a side effect

A step whose failure can still land something returns its own `stopClass` with the result:
- The push step re-reads `git ls-remote` after a failed `git push`. If origin's branch is at the checked HEAD, the step sets `ctx.pushed = true` and returns `blocked`, because the push landed.
- The run-dir step returns `pre-push` when its claim-log write fails, because the run directory already exists.
- The check step returns `blocked` on a non-zero `express-lane.js check` exit.

A `halt: false` result, like the summary step's, reports a failure on its own event without ending the record.

### Interrupts at await points

The loop yields to the event loop before every step and then checks `ctx.shared.interrupted`. A signal that arrives inside an awaiting step is reported at once by run.js's handler. So a step that awaits (`deps.sleep`, the worker) checks `ctx.shared.interrupted` after each await and stops before its next side effect: the pr step does this after its retry wait, and the ci step after each poll sleep. If the handler can report a step mid-flight, that step keeps on `ctx` whatever the interrupted line must carry, as the ci step does with `ctx.ci` and `ctx.ciWaitStartedAt`.

### Worker-controlled text is neutralized before it leaves

The worker can shape strings such as its summary, a path it named, or CLI stderr that may echo either. Each such string goes through `events.js`'s `neutralize` before it reaches an event `detail`, a commit message, a PR body or a log line (AC14.3). The rule itself is `headless-worker-launch`'s "What the consumer owes"; this is where each step applies it.

### A step that runs worker-authored code passes an allow-listed env

The test step runs the worker's test files through `verify.js`. It spawns that child with `buildEnv(deps.env, deps.platform)` from `worker.js` plus `GH_CONFIG_DIR` set to an empty directory, never bare `deps.env`, so the driver's `GH_TOKEN` and `GITHUB_TOKEN` stay out of the child (#5267). A new step that spawns a child which executes worker-written code does the same. The containment is best effort, and the header comment in `steps.js` lists what it does not cover (the git credential helper, a keyring under `HOME`, client hooks in the commit and push steps).

### One retry, and only after a read-back

`AC6.6: no other step is retried` pins that the claim, push, record-pr and set-config calls each run once. Only the pr step retries. A new retry follows the same shape:
1. Classify the failure on stderr and a timeout kill, never `err.message` (`gh-api-module-pattern`'s `batching-failure-posture.md`).
2. Read back whether the first attempt landed.
3. Retry once.

### A step that waits on time

The ci step polls until a settle window measured from the push has passed (`CI_SETTLE_WINDOW_MS`, #5277), and until a bound measured from its own start. A step that measures time follows the same shape:
- A start time set by an earlier step travels on `ctx` (the push step sets `ctx.pushedAt = deps.now()`), starts as `null` in `newCtx`, and the reading step falls back when it is unset (`ctx.pushedAt ?? started`). A timestamp is not a side effect, so it gets no `interruptClass` rung.
- The step's time constants are exported from the module that defines the step, and each is pinned by value in a test. For a step defined in `steps.js` that is `steps.js`, as `CI_WAIT_BOUND_MS`, `CI_POLL_INTERVAL_MS` and `CI_SETTLE_WINDOW_MS` are. A step implemented in its own module exports them from that module, because `steps.js` requires it and the reverse import would be a require cycle: `merge.js` exports `MERGE_WATCH_BOUND_MS` and `MERGE_WATCH_POLL_MS`, pinned in `tests/bin-lib/driver/merge.test.js`. Poll and call counts in tests are derived from those constants (`WINDOW_POLLS`, `WATCH_POLLS`), never written as numbers, so a changed window changes the expectation with it.
- The harness clock advances 1 per `now()` call and `ms` per `sleep(ms)`, and nowhere else. A test that records sleeps wraps the harness's own: `const tick = h.deps.sleep; h.deps.sleep = (ms) => { sleeps.push(ms); return tick(ms); };`. To place time at a point in the run, a scripted reply calls `h.deps.sleep(ms)` itself (the two `the settle window is measured from the push` tests move it inside `gh pr create` and inside `verify.js`).

### A step that re-runs other steps

The review step's fix round (#5222, `plugin/bin/lib/driver/review.js`) is the first step that re-runs others: a second implementer launch, then commit, test and check. A step of this shape follows the same rules:
- Reach the re-run steps through a wiring object that `steps.js` builds and passes in. The new module never requires `steps.js`.
- Launch workers through `plugin/bin/lib/driver/launch.js` (`readCeilings`, `launchTracked`, `WIN32_CLAUDE_BIN`). Never copy the launch wiring.
- Say which `ctx` fields the re-run merges (`ctx.worker`), extends (`ctx.changedFiles`) or overwrites (`ctx.check`). The push guard reads the last check's head.
- Propagate a re-run step's own status and class unchanged, and list each re-run step's stops in the new module's header.
- The worker had write access between the steps, so judge its output again before using it: the fix round re-checks each evidence path's canonical location and reads its bytes from disk before running it, never through git status.

### A step that queues steps after itself

The implementer relaunch (#5997, `plugin/bin/lib/driver/relaunch.js` decides and writes the prompt; `steps.js` wires it) is the first trigger that adds steps to a record's walk instead of re-running them inside one step. A step of this shape follows the same rules:
- Return the queued steps through the result's `then: Step[]`. `defineStep` keeps it only on a non-halting result, and `run.js` walks the queue under the steps' own names before the rest of the table. An element that is not a `{ name, run }` step makes the result a `fail` (`step returned an invalid continuation`).
- Put a bounded guard on `ctx` (`ctx.relaunch`, set before the queue is returned; under the effort ladder, #6002, its `escalations` count is compared with `MAX_ESCALATIONS` in `relaunchOrStop`, so a queued worker or test step may queue one further relaunch and no more; with `model-effort: inherit` the guard is one-shot, #5997), so a queued step never queues without bound. A refused plan queues a single step that returns the refusal with `noLine: true`, so it writes no event line.
- The table's later entries for the re-run steps skip once the queue has run them (`tableCommitStep`, `tableTestStep` return `skip: true`), while the core `commitStep` and `testStep` stay what the review fix round runs, so the fix round never skips or relaunches.
- A queued step's non-ok result keeps its own status, reason and class and gains a note naming the queue (`withRelaunchNote`); list each queued step's stops in the header comment.
- Every reader of the event the queue repeats (`worker`, `commit`, `test`) is checked to tolerate a second line per record, and the pull request lists the readers.

### A check of git state around a worker launch

The worker step and the review fix round both launch through `steps.js`'s `runImplementer`, which reads HEAD on both sides of the launch (#5414, `headOf` and `headFail`) and then, if HEAD has not moved, the index flags (#5415; the method is `headless-worker-launch`'s "What the consumer owes"). A new check of git state around a launch follows the same shape:
- Read immediately before `launchTracked` (after the settings directory's `mkdirSync`, so nothing sits between the read and the `worker` call) and again as soon as the launch settles. A before-read that fails stops the step with no launch. A launcher that throws gets the after-read too: a failed check is returned in place of the throw, and a clean one rethrows it.
- Judge the after-read before the envelope. A moved HEAD outranks a missing or failed envelope, and the envelope's `extra` (usage, turns, denials) still rides on the stop.
- The stop is `fail`, and its detail names only values the check validated: `headOf` returns a sha only when it matches `FULL_SHA_RE` and `null` otherwise, so neither git nor worker text reaches the detail. A read that cannot be made is its own `fail`, never a pass.
- An interrupt during the launch is still reported as the interrupt (run.js's handler writes it at once; see "Interrupts at await points"). At an evidence run the order is the interrupt, then the flag check, then the tree check. At the test step the order is the flag check, then the red-tests stop (a red run's tree is not read), then the tree check (`testTreeStop`, #5454), then the verdict-less detail, which a tree stop keeps after `; `. A new check of the tree or the index reuses `treeDelta` (called with `steps.js`'s `isRunArtifact`), `readIndexFlags` and the `namedPaths` detail formatter (`NAMED_PATHS_SHOWN` paths, each through `neutralize`, plus the count), never a copy.
- Never recover by resetting HEAD or clearing a flag. A baseline the check keeps on `ctx` (`ctx.indexFlags`) starts as `null` in `newCtx` and gets no `interruptClass` rung: it is a read, not a side effect. The review module gets the check through the wiring object (`indexFlagCheck`), and `reviewPass` throws without it.
- Pin each new read's position and leave the rest of the run as it was. Capture the happy path's call signatures, event `[step, status]` pairs and per-line key sets on the unmodified code as literal constants (`BASE_CALLS_PLAIN`, `BASE_CALLS_FIX`, `BASE_LINES_*`, `BASE_KEYS_*` in `run.test.js`). Then assert the new run equals them with the new reads filtered out, and that a read sits right before and right after each launch. Fault the n-th read with `nthCall(isHeadRead, n, reply)`. Every comparison with those captures goes through `baselineCalls`, which drops #5415's flag reads, #5414's launch-side HEAD reads, #5454's test-step status read and #5458's push-guard branch read (`isBranchRead`). A later check adds its own reads' filter there, never a new filter chain at each comparison, and pins their count and order in its own test, as `AC8.1 (#5415)` and `AC2.1 (#5454)` do.

### An answer more than one step reads

The reviewer on-or-off answer (#5224, `review.js`'s `reviewRequired`) is read by admission, by the worker prompt and check's `--max-lines` (`driverLineBound`), and by the review step. A decision of this shape follows the same rules:
- Ask it once per record, in the earliest step that reads it: the eligibility step sets `ctx.reviewer`. It starts as `null` in `newCtx` and gets no `interruptClass` rung, because it is a read, not a side effect.
- Later steps read the `ctx` field and never call again, so two steps cannot act on different answers. A reader that needs it fails closed on a missing or malformed value: `reviewRecord` returns a `pre-push` `fail` (`reviewer-on answer missing`), and admission refuses a non-boolean `on` as unreadable.
- A predicate two steps both apply is exported by the module that owns it and called by both, never re-derived. Admission's first `reviewerGateReason` restated the bound comparisons eligibility refuses on, and review moved both onto `eligibility.js`'s `isInsideLaneBounds` (`b338f4b74`).
- In `run.test.js` the call goes through a `deps` member whose harness default is the real function, and the harness records it outside `calls` (`reviewerCalls`), so the `BASE_CALLS_*` captures stay as they were. A test pins one call per record.

### A stop that writes no line, and a launch value a later line names

A step that stops before it has started anything returns `noLine: true` with its non-ok result, as the worker step does for a launch-time model refusal (#5917, `launch.js`'s `MODEL_REFUSED_CODE`). `defineStep` keeps the flag only when `status !== 'ok'`, and run.js's loop then writes no event line for the step while the result still halts and becomes the record's stop. It is a generic result flag, like `skip: true`, so no step name enters run.js (`AC13.1`); `noLine: only a non-ok result can suppress its line` in `run.test.js` pins that an ok result still writes its line.

`defineStep` rebuilds the step result from a fixed key set, so a new result field that run.js must read about a halting step (#6118's `launchFailure`, read by `stopObject` for settle's shared-cause body) is dropped silently until `defineStep` copies it. Add the passthrough in the same change, keep it only on a halting result as `noLine` is, and pin it with a test that drives the real step table, not a hand-built result.

A value resolved at launch that an event line must name travels on the thrown error as well as on the result: `launchTracked` resolves `{ envelope, model }`, and a launcher throw after the model resolved carries `err.model`. Every catch of a launch keeps it on the stop it returns (`steps.js`'s `runImplementer` and `workerStep`, `review.js`'s reviewer launch, `judgment-io.js`'s `launchJudge`). #5917's first reviewer and judgment catches dropped it, so those lines lost `model` on a throw, and only the whole-branch review caught it. A refusal thrown before the value resolved carries none.

### A second line under an existing step name

The review fix round's implementer relaunch writes its own `worker` line through `ctx.events.emit`, marked `fix: true` (#5942, `steps.js`'s `fixWorkerLaunch`), just before the `review` line, whose `ms` already spans it. It reuses the step name with a marker field rather than adding a name, because `STEP_NAMES` is pinned and the `worker` row is meant to count every implementer launch. Every reader keyed on the step name now sees two lines, so a second line of an existing name owes three things:
- **A station-mirror decision.** `plugin/bin/lib/station-events/driver-mirror.js` turns each `worker` line into a work segment and a `session_bound`. Either map the new line to nothing, as the fix line is (the `review` line already binds the fix session through `fixSessionId`), or say which of the first line's events it replaces. Pin it in `tests/bin-lib/station-events/driver-mirror.test.js` with a control line that lacks the marker. A step that gets a station also needs an entry in `driver-mirror.js`'s `DRIVER_STEP_ACTORS` (`agent` for a model session, `script` for the driver's own code), or its `exited` line carries no `actor`.
- **A step-yield reading.** `tools/step-yield-report.js`'s `driverStepsOf` folds every line of a name into one row. State and pin how the new line counts: the fix line counts in the `worker` row (its `ms` and `usage` added), overlapping the `review` row's minutes as merge sub-step lines overlap the `merge` row, and a failed fix launch counts once in each row (`#5942 (fix round): step-yield counts the fix worker line in the worker row`). #5942's plan named only the mirror until plan review raised step-yield.
- **The baseline captures.** The line shifts `BASE_LINES_FIX`, `BASE_KEYS_FIX` and `BASE_CALLS_FIX` in `run.test.js` by one entry each (its `[step, status]` pair, its key set, and its `appendFile`), while the `*_PLAIN` captures stay as they were. Say both in the commit body.

## Adding a settle step

A settle call is not a `STEPS` entry; it is a handler in one of `settle.js`'s `SETTLE_ROWS` rows (#5219). The rules for adding one:
- Add it in four places: the row in `SETTLE_ROWS`, its name in `events.js`'s `SETTLE_STEP_NAMES`, and the hand-copied settle tables in `docs/driver.md` and the design document.
- Settle handlers run under `step()`'s catch-all, so a failing call becomes a `fail` event and the row continues (AC7). A test fake that signals a forbidden call by throwing is swallowed the same way and the test stays green. Fakes for settle deps record their calls into an array that the test asserts on, and never throw. AC6.2 passed with a launcher call inside a handler until its fake was changed this way.
- A row that removes the run's worktree ends with `hooks.js close-run --run`. Otherwise `run-state.json` stays `active` and names a worktree that no longer exists (`settle-close`, IL-116).

## A step implemented in its own module

The merge step (#5226) runs a procedure with sub-steps of its own, so its body lives in `plugin/bin/lib/driver/merge.js`. Its `STEPS` entry in `steps.js` only builds the module's input, awaits `merge(mctx, mdeps)`, and copies the result back onto `ctx`. A step built this way owes:
- **A sub-step vocabulary of its own.** The sub-step event names are a frozen list in `events.js` kept apart from `STEP_NAMES`, as `SETTLE_STEP_NAMES` is, because the pipeline-step list is pinned (`MERGE_STEP_NAMES`). The module's `emit` throws on a name not in it, `tests/bin-lib/driver/merge.test.js` asserts every emitted event's step is in it, and `docs/driver.md`'s "Event lines" paragraph lists the names by hand.
- **Live seams, never copied values.** The entry passes `emit: ctx.events.emit` and `rebindEvents: ctx.events.rebind` (built in run.js's `driveRecord`; `rebind(null)` goes stdout-only and sets `ctx.eventsStdoutOnly`), `interrupted: () => ctx.shared.interrupted`, and `watchClock`, which sets `ctx.ciWaitStartedAt` so the interrupted line can carry the wait. A copied `ctx.shared.interrupted` is read once and never sees the signal.
- **An interrupt check after every await.** The module calls `deps.interrupted()` after each await and makes no further call once it is set: merge.js does so after the supplier call and after each watch sleep. `docs/driver.md`'s "The merge step" section names those yield points, so a new await adds one there.
- **No import from `steps.js`.** `steps.js` requires the module, so the reverse import is a require cycle. The module keeps its own copies of the helpers it needs (merge.js's `logDecision` and `bin`, which diverge from `steps.js`'s `logDecisionFile` and `binScript`) and exports its own time constants (see "A step that waits on time").
- **A result for every stop, never a throw.** `merge()` turns an unexpected throw into `pending-review` / `unclassified` naming the sub-step, so the step never halts and its class (`none`) covers only a throw in the entry itself. `finalEvent` takes the record's outcome from `ctx.merge` when nothing stopped. A wait the module measures goes on its sub-step events (`extra.ciWaitMs` on each `merge-watch` event, summed by `finalEvent`), never on the step's own line, so it is counted once.
- **One deps namespace with the driver.** The entry passes `{ ...deps, … }`, so a seam the module adds is a new member of run.js's `realDeps`. Grep `realDeps` for the name before choosing it: #5432's spec named merge.js's policy seam `deps.resolvePolicy`, which is already the keys-only express resolver `steps.js` calls (`deps.resolvePolicy(POLICY_KEYS.slice())`), so the seam became `deps.resolvePolicyCore`. Add the member to `realDeps`, to `run.test.js`'s `harness` and to `merge.test.js`'s `mergeHarness`, then route one test through `realDeps`' own member (`merge.test.js`'s `real core:` test passes `deps: { resolvePolicyCore: realDeps.resolvePolicyCore }`). Every harness replaces the member, so without that test a broken `realDeps` wiring stays green (#5432 review).

## A loop above the record: run-level event lines and record facts

`drive.js --budget` (#5229, `plugin/bin/lib/driver/budget.js`'s `runBudget`) is not a `STEPS` entry: it picks records and drives each one through run.js's `driveRecord`. A caller of this shape owes:
- **An event name outside every step list.** Its summary line's `step` is `events.js`'s `BUDGET_STEP` (`'budget'`), a constant of its own, as `FINAL_STEP` is. It is in none of `STEP_NAMES` (pinned at 19 names), `SETTLE_STEP_NAMES` or `MERGE_STEP_NAMES`, and the line carries `run: null` and `record: null`. `run.test.js`'s `constants: step vocabulary, camelCase map and frozen shapes` asserts the name is disjoint from all three lists and from `FINAL_STEP`; a new run-level name joins that assertion and the `events.js` header comment that names `FINAL_STEP` and `BUDGET_STEP`.
- **stdout only.** The loop's event sink is never bound to a run directory, so its lines reach no record's `driver-events.jsonl`. A consumer in another repository (the hub) reads the summary line, so its fields are added and never renamed, and `docs/driver.md` lists them by hand.
- **The step's own question when it asks one ahead of the step.** The pre-screen calls `deps.evaluateRecordEligibility` with `steps.js`'s exported `eligibilityOptions(policy)`, the builder the eligibility step uses, never a copied options object. A pre-screen may skip a record, never admit one: an input it cannot judge passes through to the full per-record path.
- **Facts from the record's ctx, never parsed from its event lines.** `driveRecord` returns the final event plus `outcome`, `claimed` and `claimExit`. A fact a step records for the caller (`ctx.claimExit`, set by the claim step) starts as `null` in `newCtx` and gets no `interruptClass` rung: it is a recorded fact, not a side effect. Pin it per value in `run.test.js` (the claim step's exit table there covers 2-7 and a killed claim's `null`).

## A read-only head and an adopted run: `--check` and `--run`

`drive.js --check` and `drive.js #N --run <dir> --no-settle` (#5232) walk the same table, so a new step or settle handler answers for both:
- **`--check` walks the table's head.** `steps.js`'s `CHECK_STEPS` is the policy, fetch, eligibility and admission steps, and `#5232 CHECK_STEPS is the head of STEPS` pins it to `STEPS.slice(0, 4)`. A step placed before admission joins `CHECK_STEPS` and writes nothing: `AC1.2`'s `assertWriteFree` fails any call outside `isCheckRead`'s allow-list, so a new read there also joins that list. A step that writes goes after admission.
- **Under `--run` the caller owns the run directory and the worktree.** `adopt.js`'s `adoptRun` result rides on `ctx.shared.adopted`. The claim step takes its run id, the run-dir step its directory and the worktree step its worktree and branch from it instead of minting `drive-{n}` or creating `drive-record-{n}`, and the merge step keeps the adopted worktree and local branch (`mctx.adopted`). A new step that creates or removes something branches on the same field, and `ctx.created` (the stop object's `created`) stays false for what the driver did not create.
- **A refusal adoption needs but `adopt.js` cannot see goes in the step that first resolves the fact, before the claim.** `adopt.js` refuses before writing anything (its one write, after every check passes, is the best-effort `lane: 'driver'` fill of the run's `manifest.json`, #5903, which never changes the adoption) and has no integration ref, so `policyStep` refuses an adopted worktree on the integration branch (`fatal`, exit 1, `refused`), and `adopt.js`'s header names that check beside its own five.
- **A settle handler under `--run --no-settle`.** run.js's `settleStop` still runs one handler for an adopted run's `pre-push` row, `settle({ ...input, only: [ESCALATE_STEP] })`. `ESCALATE_STEP` is exported from `settle.js` so run.js never spells the name, and `settle` throws on an `only` name outside its handlers. It runs because it writes only the escalation line into the caller's run directory, which the caller's next `/build` reads (`hasEscalation`); it is not teardown. A failed escalate turns the row, and so the outcome, `blocked`. A new settle handler decides which it is: a write into the caller's run directory that the caller reads next joins `only` there, with a test beside `#5232 a --run --no-settle pre-push stop writes one escalation line the real hasEscalation matches`; anything that tears down stays the caller's.

## Anti-Patterns

| Pattern | Why it fails here |
|---|---|
| Adding a step with a new durable side effect as a table entry only | `interruptClass` cannot see the effect, so a signal after it reports the rung below, and the settle unit settles the wrong state (#5218 review, `8bcc7eef5`) |
| Choosing a stop class from the step's name or position | A failed push that landed is `blocked`, not `pre-push`: the class follows what was written |
| A step-name literal in `run.js` | It breaks the table-only contract, and `AC13.1` fails on it |
| Retrying outside the pr step, or retrying a create blind | `AC6.6` fails, and a lost response may already have landed, so a blind retry opens a duplicate PR |
| Raw worker text in a `detail` | A `closes #N` or `@user` inside it reaches the forge (AC14.3) |
| Passing `deps: { sleep }` to the harness to record sleeps | The replacement stops the harness clock, so a loop bounded on time only ends once `now()`'s one-per-call ticks cover the window or the bound. Two tests did this, and had to wrap the harness's `sleep` once the ci step waited on time (#5277) |
| Keeping every intermediate read on `ctx` for the interrupt handler | The interrupted line reports it as the record's word, though the loop would not have ended on it. The ci step keeps `ctx.ci` at `pending` until a read is final (`AC14: an interrupt after an unsettled early read reports pending, never that read`) |
| A new stop class added to `STOP_CLASSES` and `OUTCOME_BY_CLASS` only | `selectRow` has no case for it, so settle runs the `blocked` row: the record is labelled `bot:blocked`, the final line's outcome reads `blocked` whatever the class maps to, and `unclassified` is the only sign |
| Adding a second call of a shape existing tests script as `[match, reply]` | The harness answers every call an entry matches, so the new call gets the old reply: #5454's test-step `git status` read got `AC3.1`'s commit-step porcelain and stopped the run on the tree. Move such entries to `nthCall(match, 1, reply)` |
| Guarding a remote write on HEAD alone when the write names a ref | `git push origin {branch}` sends `refs/heads/{branch}`, not HEAD. A switch to another branch, or a detached HEAD, at the same commit before the driver commits passes a HEAD check, while the commit lands off the pushed branch. The push step also reads `refs/heads/{branch}` and stops pre-push when it is not the checked head or cannot be read (#5458) |

## Reference

- Code: `plugin/bin/drive.js`; `plugin/bin/lib/driver/run.js` (`newCtx`, `interruptClass`, `finalEvent`, `reportInterrupt`, `realDeps`); `plugin/bin/lib/driver/steps.js` (`defineStep`, `STEPS`); `plugin/bin/lib/driver/events.js` (`STEP_NAMES`, `STOP_CLASSES`, `OUTCOME_BY_CLASS`, `neutralize`)
- Tests: `tests/bin-lib/driver/run.test.js` (`harness`, `defaultScript`, `SCENARIOS`)
- Journey: `docs/journeys/drive-a-named-record-to-a-draft-pr-5218.md`
- Related skills: `headless-worker-launch` (the worker step's rights and envelope), `driver-skill-outcome-taxonomy` (outcome words keyed on what landed), `gh-api-module-pattern` (the `deps` seam and its bounds)
