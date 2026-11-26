# Budget Worker-Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End a `drive.js --budget` run with `ended: worker-stop` when implementer workers cannot launch for a cause every later record would meet, and settle that record's stop without the `<!-- express-driver: escalated -->` marker (record #6118).

**Architecture:** `worker.js` classifies one implementer envelope (shared cause, streak-counting) in one place; `steps.js` records the first implementer launch's verdict on `ctx.implementerLaunch`; `run.js` carries it into `driveRecord`'s facts and decides, per stop, whether settle posts the marker-free comment; `settle.js` posts it (or the ordinary escalation when the record already carries a trusted shared-cause comment) and returns the posted escalation comment's id; `budget.js` ends the run and, for the two-in-a-row rule, deletes the first record's escalation comment.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` through the injected `deps.gh`.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T064111-record-6118/work/6118-spec.md` (worktree copy). Read it in full before any task.

Scope keywords: launch-error, worker-stop, DRIVER_ESCALATION_MARKER, apiTarget, claim-stop

## Global Constraints

- Shared-cause settle comment marker, exact: `<!-- express-driver: shared-cause -->`. Escalation marker unchanged: `<!-- express-driver: escalated -->`.
- New `ended` value, exact: `worker-stop`; its `status` is `stop`; exit code 0.
- Envelope fields may be added, never renamed (`worker.js` header). Summary-line and final-line fields may be added, never renamed.
- The worker's free-text `result` string is never parsed. Forge-facing text comes from fixed templates only (`commentFor`'s closed-set path); the worker-stop `detail` names record numbers and closed `reason` values only.
- `run.js` spells no step-name literal (AC13.1 table-only contract): it reads result/ctx fields only.
- `settle.js` requires no model module (`worker`, `roles`): run.js passes it booleans and the record's comments.
- Only the implementer launch is classified, and only the first implementer launch of a record (the #5997/#6002 relaunch and the review fix round never overwrite it).
- Every test-running step uses the repo's runner: `node --test {file}` with `--test-name-pattern` where named.
- Commit subjects: `{Verb} {what} — {detail}` ending `— refs #6118`; body ends with `Claude-Session: https://claude.ai/code/session_01HkH7RWzu4PUNwdXS1Zs1Bu`.
- Commit tests only where a task names them; scratch checks stay scratch. Touch only what the task requires; a pre-existing bug noticed is a follow-up to report, not a fix to fold in. Don't reformat or "improve" adjacent code; edit in place.
- Project maturity is `established`: for any task modifying pre-existing behavior, write a characterization test covering edge cases before changing it.

## AC7 (revert-red) evidence — every task

AC7.1, AC7.2: each task's Step 2 runs its new tests against the not-yet-changed source, which is the reverted state. Save that run's full output with a plain Bash redirect to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-26T064111-record-6118/evidence/task{N}-red.txt` (create the directory first with `mkdir -p`), and after Step 4 save the green run to `task{N}-green.txt` beside it. Quote the red run's `# fail` count in the task report. The controller writes one `AC evidence` decision line per task from these files. Task 3's tests span three source files; its red run proves the tests depend on the change as a whole, and the whole-branch review re-checks per file.

## Governing project skills (quoted verbatim)

From `.claude/skills/headless-worker-launch/SKILL.md` ("What the consumer owes"):
> The run loop that consumes the envelope must treat every string in `result`, `detail` when it carries the worker's own text, and `denials[].tool_input` as untrusted, and neutralize it before it reaches a command, a commit message, a comment or a log line.

> Envelope `ok` means only that conforming structured output arrived; the worker's verdict is `result.status`, which may be `cannot-complete`.

From `.claude/skills/headless-worker-launch/SKILL.md` ("A probe speaks for one CLI version, one platform and one launch context"):
> Record each result in the module header with the CLI version, platform, date, login kind and whether a TTY was attached, and keep rights that rest on an unprobed cell off.

From `.claude/skills/driver-step-addition/SKILL.md` ("A loop above the record"):
> **stdout only.** The loop's event sink is never bound to a run directory, so its lines reach no record's `driver-events.jsonl`. A consumer in another repository (the hub) reads the summary line, so its fields are added and never renamed, and `docs/driver.md` lists them by hand.

> **Facts from the record's ctx, never parsed from its event lines.** `driveRecord` returns the final event plus `outcome`, `claimed` and `claimExit`. A fact a step records for the caller (`ctx.claimExit`, set by the claim step) starts as `null` in `newCtx` and gets no `interruptClass` rung: it is a recorded fact, not a side effect. Pin it per value in `run.test.js` (the claim step's exit table there covers 2-7 and a killed claim's `null`).

From `.claude/skills/driver-step-addition/SKILL.md` (Anti-Patterns):
> | A step-name literal in `run.js` | It breaks the table-only contract, and `AC13.1` fails on it |

> | Raw worker text in a `detail` | A `closes #N` or `@user` inside it reaches the forge (AC14.3) |

No other `.claude/skills/` skill names these files' rules that apply (bin-source-scan-conformance applies only if a task adds a source-scan test; none does).

## Plan-audit Check B hits (reviewed at plan time)

- `docs/journeys/launch-a-rights-limited-headless-worker-5217.md`: lists the envelope's `reason` values — Task 1 adds one sentence on `apiError` there.
- `plugin/bin/lib/driver/roles.js`, `tests/helpers/merge-check-envelopes.js`, `tests/bin-lib/driver/merge-check-eval-extract.test.js`, `tests/bin-lib/driver/admission.test.js`: name `launch-error` for other roles' envelopes; no change (only the implementer is classified).
- `tests/bin-lib/dispatch/queue-pull-*`: `F-claim-stop` is a queue-pull fixture id, unrelated.
- `docs/superpowers/specs/2026-11-18-pipeline-economy-design.md`, `docs/superpowers/plans/2026-11-22-lens-reviewer-worker-role.md`: historical design/plan text; no change.

## Return-shape widening hits (grep at plan time)

These existing assertions pin shapes this plan widens; update each in the task that widens it, adding the new key, never deleting the assertion:
- `tests/bin-lib/driver/worker.test.js:55` (`Object.keys(env)` equals `ENVELOPE_FIELDS`) and `:69` (the `ENVELOPE_FIELDS` literal) — Task 1 (`apiError` appended).
- `tests/bin-lib/driver/run.test.js:7347` (`driveRecord` facts deepEqual) — Tasks 2 and 3 (`implementerLaunch`, `sharedCause`, `escalationCommentId`).
- `tests/bin-lib/driver/run.test.js:982` and `:7025` (final-line `stop` object literals) — Task 3 (`sharedCause: false`).
- `tests/bin-lib/driver/budget.test.js:382` and `run.test.js:7767-7768` (`ENDED`/`STATUS_BY_ENDED` literals) — Task 4.
Re-grep each task's widened name before finishing it: any other deepEqual over the widened object is in scope too.

## Probe result (taken at plan time — Task 1 records it in the `worker.js` header)

Probed 2026-11-26 with Claude Code CLI 2.1.325 on macOS (darwin), launched from a process with no TTY, `env -i PATH HOME USER CLAUDE_CONFIG_DIR=<empty scratch dir>`, `claude -p --output-format json --safe-mode --model haiku`, stdin `/dev/null`:

- Not logged in: exit 1; result object `type: "result"`, `subtype: "success"`, `is_error: true`, `terminal_reason: "api_error"`, `api_error_status: null`, no `api_error_type`, `duration_api_ms: 0`, `result: "Not logged in · Please run /login"`. Today's classification: `fail`/`exit`.
- `ANTHROPIC_API_KEY=sk-ant-bogus-000`: exit 1; same shape with `api_error_status: 401`, `api_error_type: "authentication_error"`, `api_error_origin: "first_party"`, `result: "Invalid API key · Fix external API key"`. Today: `fail`/`exit`.
- Not probed: a usage/rate limit (no way to exhaust one on purpose); its field values are taken from the API's documented error types (`rate_limit_error`, HTTP 429) and the header says so. Linux and Windows not probed.

So (b) is kept: the structured fields are `terminal_reason`, `api_error_status`, `api_error_type`.

## Review Focus

1. A `terminal_reason: "api_error"` with a 5xx/`overloaded_error` status (a transient API outage) — expected: NOT shared-cause by (b) (only auth/permission/rate-limit), but it still counts toward two-in-a-row as `fail`/`exit`. Test in Task 1.
2. A record whose first launch fails and whose relaunch never happens (launch-error must not trigger #5997/#6002's relaunch) — expected: one launch, the facts are that launch's. Test in Task 2.
3. `gh issue comment` stdout that carries no `#issuecomment-<id>` (a fake, an older gh, a failed post) — expected: `escalationCommentId: null`, and the budget loop skips the delete, naming that on stderr and in `detail`. Tests in Tasks 3 and 4.
4. A `--no-settle` budget run that hits two-in-a-row — expected: still ends `worker-stop`; nothing was posted, so no delete is attempted and no delete-failure note is written. Test in Task 4.
5. A stop that is not a launch failure on a record whose launch envelope was ok (red tests, `cannot-complete`, a HEAD-moved stop) — expected: ordinary settle, streak reset. Tests in Tasks 3 and 4.

---

### Task 1: Classify an implementer envelope in `worker.js`

**Files:**
- Modify: `plugin/bin/lib/driver/worker.js` (header "What the launch rests on": add the probe bullet above; header classification paragraph; `ENVELOPE_FIELDS`; `classify`; exports)
- Modify: `docs/journeys/launch-a-rights-limited-headless-worker-5217.md` (line ~33: one sentence naming `apiError`)
- Test: `tests/bin-lib/driver/worker.test.js`

**Role:** integration

**Interfaces:**
- Produces:
  - Envelope field `apiError`, appended last to `ENVELOPE_FIELDS`: `{ status: number|null, type: string|null } | null` — non-null exactly when a result object exists and its `terminal_reason === 'api_error'`; `status` is `api_error_status` when a safe integer else null; `type` is `api_error_type` when a non-empty string else null. Set on every envelope `classify` builds.
  - `SHARED_CAUSE_API_TYPES = Object.freeze(['authentication_error', 'permission_error', 'rate_limit_error'])`, `SHARED_CAUSE_API_STATUSES = Object.freeze([401, 403, 429])`.
  - `sharedCauseOf(envelope) -> boolean`: true when `envelope.reason === 'launch-error'`; or when `envelope.status === 'fail'` and `envelope.apiError` is non-null and (its `type` is in `SHARED_CAUSE_API_TYPES`, or its `status` is in `SHARED_CAUSE_API_STATUSES`, or both `type` and `status` are null — the not-logged-in shape, no request made). False for a non-object.
  - `countsTowardLaunchStreak(envelope) -> boolean`: true when `envelope.reason === 'launch-error'`, or `envelope.status === 'fail' && envelope.reason === 'exit'`. False for `ok`, `timeout`, `spend-ceiling`, `wall-clock-ceiling`, `schema`, and a non-object.
  - All three exported from `worker.js`.

- [ ] **Step 1: Write the failing tests** in `worker.test.js`, through the existing fake-runner launch helpers (feed stdout/exit to `launchWorker`, never call `classify` directly if the file does not already):
  - `#6118 AC5.1, AC5.2: an api_error result object carries apiError and stays fail/exit`: stdout = the probe's 401 object (fields `type: 'result'`, `subtype: 'success'`, `is_error: true`, `terminal_reason: 'api_error'`, `api_error_status: 401`, `api_error_type: 'authentication_error'`, `result: 'Invalid API key · Fix external API key'`), code 1 → `status: 'fail'`, `reason: 'exit'`, `apiError: { status: 401, type: 'authentication_error' }`, `sharedCauseOf(env) === true`.
  - `#6118 AC5.1: the not-logged-in shape is shared-cause`: probe's first object (`api_error_status: null`, no type) → `apiError: { status: null, type: null }`, `sharedCauseOf === true`.
  - `#6118 AC5.1: a rate limit is shared-cause`: `api_error_status: 429`, `api_error_type: 'rate_limit_error'` → true.
  - `#6118 a 529 overloaded api_error is not shared-cause`: `api_error_status: 529`, `api_error_type: 'overloaded_error'` → `sharedCauseOf === false`, `countsTowardLaunchStreak === true`.
  - `#6118 launch-error is shared-cause and counts`: runner throws → `sharedCauseOf === true`, `countsTowardLaunchStreak === true`.
  - `#6118 no terminal_reason means apiError null`: an ordinary `is_error: true` exit object → `apiError: null`, `sharedCauseOf === false`; an `ok` envelope → `apiError: null`.
  - `#6118 the result text is never read`: an object with `result: 'Not logged in · Please run /login'` but no `terminal_reason` → `sharedCauseOf === false`.
  - `#6118 streak counting by reason`: table over envelopes `{status:'fail',reason:'exit'}` true, `{status:'fail',reason:'launch-error'}` true, `timeout/wall-clock-ceiling`, `fail/spend-ceiling`, `fail/schema`, `ok/null` all false; `null`/`undefined` false.
  - Extend whatever test pins `ENVELOPE_FIELDS` to end with `apiError`.
  - `#6118 AC5.3: the worker.js header records the probe`: read `worker.js` as text and assert it contains `2026-11-26`, `2.1.325` and `darwin` inside the shared-cause probe bullet (locate the bullet by its `Shared cause (#6118)` heading text).
- [ ] **Step 2: Run to verify they fail** (AC7.1, AC7.2 red evidence: save the output to `evidence/task1-red.txt`, per the AC7 section)
  Run: `node --test --test-name-pattern "#6118" tests/bin-lib/driver/worker.test.js`
  Expected: FAIL (`sharedCauseOf is not a function`).
- [ ] **Step 3: Implement** the Interfaces above in `worker.js`. `classify`'s `envelope(...)` builder sets `apiError` from `obj`. Update the header: the envelope field list gains `apiError`; a new paragraph "Shared cause (#6118)" stating the two functions' rules; the probe bullet from this plan's "Probe result" section verbatim in substance (date, CLI version, platform, login kind, TTY, both observed objects, and that a rate limit was not probed).
- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/driver/worker.test.js`
  Expected: PASS, no failures.
- [ ] **Step 5: Commit** `worker.js`, `worker.test.js` and the journey file: `Classify a shared-cause implementer envelope in worker.js — refs #6118`.

Proof(auth): Task 1's tests feed the two live-probed result objects (not logged in, invalid API key 401/authentication_error) plus a 429 rate_limit_error through launchWorker and assert sharedCauseOf is true, while a 529 overloaded api_error and a result string reading "Not logged in" without terminal_reason both stay false, so only structured auth/limit fields classify.

### Task 2: Record the first implementer launch's verdict and carry it into `driveRecord`'s facts

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js` (`launchImplementerAndCheck`)
- Modify: `plugin/bin/lib/driver/run.js` (`newCtx`, `driveRecord`)
- Test: `tests/bin-lib/driver/run.test.js`

**Role:** integration

**Interfaces:**
- Consumes: Task 1's `sharedCauseOf`, `countsTowardLaunchStreak` (import from `./worker` in steps.js).
- Produces:
  - `ctx.implementerLaunch`: `null` in `newCtx`; set once, in `launchImplementerAndCheck`, right after `hasEnvelope` is known and before the HEAD/flag checks, only while it is still `null`: `{ status, reason, sharedCause: sharedCauseOf(envelope), counts: countsTowardLaunchStreak(envelope) }` with `status`/`reason` the envelope's own (closed values). No envelope → left `null`. A recorded fact: no `interruptClass` rung.
  - The `envelope.status !== 'ok'` return in `launchImplementerAndCheck` gains `launchFailure: true` (a result field defineStep does not emit, like `cannotComplete`).
  - `driveRecord(...)` resolves to `{ final, outcome, claimed, claimExit, implementerLaunch, sharedCause }`: `implementerLaunch` = `{ status, reason }` from `ctx.implementerLaunch` or `null`; `sharedCause` = `ctx.implementerLaunch.sharedCause` or `null` when no launch ran.

- [ ] **Step 1: Write the failing tests** in `run.test.js`, with the file's existing harness (fake worker runner):
  - `#6118 driveRecord facts carry the first implementer launch`: a launch-error worker → facts `implementerLaunch: { status: 'fail', reason: 'launch-error' }`, `sharedCause: true`; an ok worker that completes → `{ status: 'ok', reason: null }`, `sharedCause: false`; a record refused at eligibility → `implementerLaunch: null`, `sharedCause: null`.
  - `#6118 a launch-error triggers no relaunch`: under `implementer-tier: record` and `model-effort: profile` (the #6002 ladder), a first launch returning launch-error → exactly one implementer launch, the worker step's stop, and facts from that launch.
  - `#6118 a relaunch never overwrites the first launch's facts`: first launch ok with `cannot-complete` (relaunch queued), relaunch returns launch-error → facts `implementerLaunch: { status: 'ok', reason: null }`, `sharedCause: false`.
- [ ] **Step 2: Run to verify they fail** (AC7.1, AC7.2 red evidence: save the output to `evidence/task2-red.txt`, per the AC7 section)
  Run: `node --test --test-name-pattern "#6118" tests/bin-lib/driver/run.test.js`
  Expected: FAIL (`implementerLaunch` undefined).
- [ ] **Step 3: Implement** the Interfaces above. Confirm while there that `relaunch.js`'s `TRIGGERS` hold only cannot-complete and failing tests (no change expected; if a launch-error trigger exists, stop and report NEEDS_CONTEXT).
- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/driver/run.test.js`
  Expected: PASS.
- [ ] **Step 5: Commit** `steps.js`, `run.js`, `run.test.js`: `Carry the first implementer launch's verdict into driveRecord's facts — refs #6118`.

### Task 3: Settle a shared-cause stop without the escalation marker

**Files:**
- Modify: `plugin/bin/lib/driver/settle.js`
- Modify: `plugin/bin/lib/driver/merge.js` (import `apiTarget` from `./settle` instead of defining it)
- Modify: `plugin/bin/lib/driver/run.js` (`newShared`, `stopObject`, `settleStop`, `driveRecord`)
- Test: `tests/bin-lib/driver/settle.test.js`, `tests/bin-lib/driver/run.test.js`

**Role:** judgment
**Review risk:** high

**Interfaces:**
- Consumes: Task 2's `ctx.implementerLaunch` and result `launchFailure`.
- Produces (settle.js, all exported):
  - `DRIVER_SHARED_CAUSE_MARKER = '<!-- express-driver: shared-cause -->'`.
  - `commentFor('shared-cause', fields)`: fixed text, no detail, no worker text: `The pipeline driver (drive.js) could not launch a worker for this record, at step ${step}. The driver releases the claim and removes the worktree and local branch this run created, and will try this record again on a later run.\n\n${DRIVER_SHARED_CAUSE_MARKER}` (`step` through `oneOf(STEP_NAMES, …)`).
  - `hasDriverSharedCauseMarker(comments) -> boolean|null`: same shape as `hasDriverEscalationMarker` (trusted comment whose trimmed body ends with the marker; `null` for a non-array).
  - `apiTarget(repo)` moved verbatim from merge.js.
  - `commentIdFromUrl(text) -> number|null`: the safe integer after `#issuecomment-` in the first such match of gh's stdout, else null.
  - `deleteRecordComment(id, ghRepo, deps) -> void`: `deps.gh(['api', '-X', 'DELETE', `repos/${slug}/issues/comments/${id}`, ...host])` via `apiTarget(ghRepo)`; refuses (throws) a non-safe-integer id before any call.
  - `settle(input, deps)`: new optional inputs `input.stop.sharedCause` (boolean) and `input.comments` (the record's comments). On the `pre-push` row, `settle-comment-record`'s body is `commentFor('shared-cause', …)` when `stop.sharedCause === true` and `hasDriverSharedCauseMarker(input.comments) !== true`; otherwise the existing `escalated` body. Every other step of the row is unchanged (escalate, release, remove worktree, delete branch, close). The `blocked` row (pushed or PR recorded) is unchanged whatever `sharedCause` says. Return value gains `escalationCommentId`: `commentIdFromUrl` of `settle-comment-record`'s gh stdout when the `escalated` body was posted, else `null`.
- Produces (run.js):
  - `newShared()` gains `launchStreak: 0` (the budget loop sets it, Task 4).
  - `stopObject` gains `sharedCause: boolean` — true when the stop's result has `launchFailure === true` and `ctx.implementerLaunch` is non-null and (`ctx.implementerLaunch.sharedCause === true`, or `shared.launchStreak >= 1 && ctx.implementerLaunch.counts === true`). False otherwise, including no stop.
  - `settleStop` passes `comments: ctx.issue && Array.isArray(ctx.issue.comments) ? ctx.issue.comments : null` and returns `escalationCommentId` (null on every path that did not run settle).
  - `driveRecord` facts gain `escalationCommentId` (from the settled result; `null` when none).

- [ ] **Step 1: Write the failing tests**
  - settle.test.js `#6118 AC2.1, AC2.2: a shared-cause pre-push stop posts the marker-free comment and keeps the row's cleanup`: `stop: { class: 'pre-push', step: 'worker', sharedCause: true, created: { worktree: true, branch: true } }`, `comments: []` → the one `gh issue comment` body contains `<!-- express-driver: shared-cause -->` and not `<!-- express-driver: escalated -->`; `calls` steps equal the ordinary pre-push row's (escalate, comment-record, release, remove-worktree, delete-branch, close); `release-claim.js`, `worktree remove --force --force` and `branch -D` calls are made; `escalationCommentId === null`.
  - settle.test.js `#6118 AC9.1, AC9.2: a repeat shared-cause stop escalates with the marker`: same input, `comments` holding one trusted comment ending `<!-- express-driver: shared-cause -->` → body ends with `<!-- express-driver: escalated -->`; fake gh stdout `https://github.com/o/r/issues/7#issuecomment-123\n` → `escalationCommentId === 123`.
  - settle.test.js `#6118 an untrusted shared-cause comment does not count`: an untrusted comment with the marker → marker-free body again.
  - settle.test.js `#6118 a pushed shared-cause stop is settled by the blocked row`: `pushed: true` → row `blocked`, no shared-cause body.
  - settle.test.js `#6118 commentIdFromUrl and deleteRecordComment`: `commentIdFromUrl('no url')` null; `deleteRecordComment(5, 'github.com/o/r', deps)` calls gh with `['api','-X','DELETE','repos/o/r/issues/comments/5','--hostname','github.com']`; `deleteRecordComment('5', …)` throws with no gh call.
  - run.test.js `#6118 a shared-cause worker stop settles marker-free in a named run`: launch-error worker on a named record → the record comment carries the shared-cause marker, not the escalation marker; final line's `stop.sharedCause === true`.
  - run.test.js `#6118 AC8.1: a streak-second launch failure settles marker-free`: `shared.launchStreak = 1`, worker `fail`/`exit` with no apiError → marker-free; same with `launchStreak = 0` → escalation marker and facts `escalationCommentId` parsed from the fake gh stdout.
  - run.test.js `#6118 red tests after an ok launch settle ordinarily`: `launchStreak = 1`, ok launch, red test step → escalation marker, `stop.sharedCause === false`.
- [ ] **Step 2: Run to verify they fail** (AC7.1, AC7.2 red evidence: save the output to `evidence/task3-red.txt`, per the AC7 section)
  Run: `node --test --test-name-pattern "#6118" tests/bin-lib/driver/settle.test.js`
  Expected: FAIL (`DRIVER_SHARED_CAUSE_MARKER` undefined / escalated body posted).
- [ ] **Step 3: Implement** the Interfaces above. Move `apiTarget` (body and comment) from merge.js to settle.js; merge.js imports it alongside `reduceDetail`.
- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/driver/settle.test.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/merge.test.js`
  Expected: PASS.
- [ ] **Step 5: Commit** the five files: `Settle a shared-cause worker stop without the escalation marker — refs #6118`.

### Task 4: End the budget run `worker-stop`

**Files:**
- Modify: `plugin/bin/lib/driver/budget.js` (header, `ENDED`, `STATUS_BY_ENDED`, the per-record loop)
- Modify: `plugin/bin/lib/driver/run.js` (`USAGE` exit-0 text names `worker-stop`)
- Test: `tests/bin-lib/driver/budget.test.js`, `tests/bin-lib/driver/run.test.js` (the pinned `ENDED` and `STATUS_BY_ENDED` assertions near line 7767)

**Role:** integration
**Review risk:** high

**Interfaces:**
- Consumes: Task 2's facts `implementerLaunch`, `sharedCause`; Task 3's facts `escalationCommentId`, `shared.launchStreak`, `deleteRecordComment` (from `./settle`); Task 1's `countsTowardLaunchStreak` (from `./worker`, applied to `facts.implementerLaunch`).
- Produces:
  - `ENDED.WORKER_STOP = 'worker-stop'`; `STATUS_BY_ENDED['worker-stop'] = 'stop'`; `finish` returns 0 for it.
  - Loop state per `runBudget` invocation: `streak` (0 or 1) and `streakFirst` (`{ n, reason, commentId }` or null). Before each `driveOne(n)`: `shared.launchStreak = streak`.
  - After the record is counted (`classifyFacts`), and after the permission/claim stop checks, before the budget check:
    - `facts.sharedCause === true` → `finish(WORKER_STOP, \`implementer launch on #${n} failed: ${reason} (shared cause)\`)`.
    - `facts.implementerLaunch` non-null and counts → if `streak === 1`: when `streakFirst.commentId` is a safe integer, `deleteRecordComment(streakFirst.commentId, shared.ghRepo, deps)` in a try/catch; then `finish(WORKER_STOP, \`implementer launches on #${a} and #${n} both failed: ${reasonA}, ${reasonN}\`)` with `; could not delete the escalation comment on #${a}: ${firstLine(errorText(err))}` appended on a failed delete, or `; no escalation comment id on #${a} to delete` when settle ran (`shared.settle === true`) but no id was returned; each such note is also written to stderr as `drive.js: …\n`. Else `streak = 1`, `streakFirst = { n, reason, commentId: facts.escalationCommentId }`.
    - `facts.implementerLaunch` non-null and does not count → `streak = 0`, `streakFirst = null`.
    - `facts.implementerLaunch` null → streak unchanged.
  - `reason` values are the envelope's closed `reason` passed through `neutralize` (events.js).

- [ ] **Step 1: Write the failing tests** in budget.test.js (add a `gh` recorder to `fake`'s deps and a `ghRepo` on the test's `shared`):
  - `#6118 AC1.1, AC1.2: a shared-cause launch ends the run worker-stop`: `--budget 5`, three admitted records, record 1's facts `{ ...DEFAULT_FACTS, implementerLaunch: { status: 'fail', reason: 'launch-error' }, sharedCause: true }` → summary `ended: 'worker-stop'`, `status: 'stop'`, `driven: 1`, exit 0, `driveOne` called once, `detail` names `#{n}` and `launch-error`.
  - `#6118 AC3.1, AC3.3, AC8.1, AC8.2: two fail/exit launches in a row end the run after the second`: facts `fail`/`exit`, `sharedCause: false`, record 1 `escalationCommentId: 991` → `ended: 'worker-stop'`, `driven: 2`; gh called once with `['api','-X','DELETE','repos/o/r/issues/comments/991', …]`; `shared.launchStreak` observed by `driveOne` is 0 then 1.
  - `#6118 AC3.2, AC3.3: one fail then an ok does not end it`: fail/exit then ok → run continues to the third record and ends `exhausted`/`budget`.
  - `#6118 AC4.1, AC4.2: cannot-complete and red tests neither count nor end the run`: facts with `implementerLaunch: { status: 'ok', reason: null }` and outcome `express-escalated` between two fail/exit records → no worker-stop.
  - `#6118 AC10.1, AC10.2: a timeout between two exit failures resets the streak`: exit, timeout, exit → no worker-stop.
  - `#6118 AC10.1, AC10.2: a record with no implementer launch leaves the streak unchanged`: exit, `implementerLaunch: null` (claimed, stopped before the worker), exit → `worker-stop` after the third.
  - `#6118 a failed delete is named and never changes the exit code`: gh throws on the DELETE → exit 0, `ended: 'worker-stop'`, `detail` contains `could not delete the escalation comment on #`, stderr names it.
  - `#6118 --no-settle two-in-a-row attempts no delete`: `shared.settle = false`, two fail/exit, no comment ids → `worker-stop`, no gh call, no delete note.
  - AC6.1, AC6.2: update the pinned `STATUS_BY_ENDED` assertion (budget.test.js `AC9.5` and run.test.js near 7767–7768) to include `worker-stop` → `stop` and `ENDED.WORKER_STOP`.
- [ ] **Step 2: Run to verify they fail** (AC7.1, AC7.2 red evidence: save the output to `evidence/task4-red.txt`, per the AC7 section)
  Run: `node --test --test-name-pattern "#6118" tests/bin-lib/driver/budget.test.js`
  Expected: FAIL (summary `ended` is not `worker-stop`).
- [ ] **Step 3: Implement** the Interfaces above in budget.js; extend its header's "Counting" paragraph with the worker-stop and two-in-a-row rules (the counter is per invocation, never carried across firings; the first record of a streak is settled ordinarily and its escalation comment deleted afterwards). Update run.js `USAGE`'s exit-0 line to list `worker-stop` beside the claim stops.
- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/driver/budget.test.js tests/bin-lib/driver/run.test.js`
  Expected: PASS.
- [ ] **Step 5: Commit** `budget.js`, `run.js`, both tests: `End a budget run worker-stop when implementer launches cannot launch — refs #6118`.

Proof(public-contract): the summary line's ended/status vocabulary gains worker-stop → stop with exit 0, pinned by run.test.js's ENDED and STATUS_BY_ENDED deepEqual assertions and budget.test.js AC9.5; git grep for claim-stop finds no exhaustive switch reader outside docs and tests, and docs/driver.md's ended/status table plus the exit-code row are updated in Task 5 with fields only added.

### Task 5: Document `worker-stop`, the shared-cause rule and the marker-free settle

**Files:**
- Modify: `docs/driver.md` (exit-code row 0 at line ~28; the budget loop paragraph near line ~80; the summary-line table `ended`/`status`/`detail` rows at ~130–132; the settle table section: the pre-push row's comment under a shared-cause stop, the repeat cap, and the two-in-a-row cost)
- Modify: `docs/journeys/let-the-driver-pick-records-under-a-budget-5229.md` (the claim-stop bullets near lines 59 and 77: add `worker-stop`)
- Modify: `docs/plugin-structure.md` (budget.js line: the `ends on …` list gains `worker-stop`; settle.js/worker.js lines if they enumerate exports)
- Modify: `plugin/bin/lib/driver/events.js` only if Tasks 1–4 introduced an event name (none planned: no new step, settle step or run-level line). If none, leave it untouched and say so in the task report.

- [ ] **Step 1: Write the failing check**
  Run: `git grep -n "worker-stop" -- docs/driver.md docs/journeys/let-the-driver-pick-records-under-a-budget-5229.md docs/plugin-structure.md`
  Expected: FAIL (no matches, exit 1).
- [ ] **Step 2: Edit the docs** to state: `worker-stop` (`status: stop`, exit 0, `detail` naming the record(s) and reason); the shared-cause rule (launch-error, or an api_error result for authentication/permission/rate limit or the not-logged-in shape; the free-text result is never read); the two-in-a-row rule (which envelopes count, which reset, a record with no launch neither); the marker-free settle and its `<!-- express-driver: shared-cause -->` marker, the repeat cap (a second shared-cause stop on a record already carrying a trusted shared-cause comment escalates with the marker); the documented cost (the first record of a two-in-a-row streak is escalated then has its escalation comment deleted; a cause (b) cannot see reaches worker-stop only through two-in-a-row).
- [ ] **Step 3: Verify**
  Run: `git grep -n "worker-stop" -- docs/driver.md docs/journeys/let-the-driver-pick-records-under-a-budget-5229.md docs/plugin-structure.md`
  Expected: matches in all three files.
  Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/budget.test.js tests/bin-lib/driver/settle.test.js tests/bin-lib/driver/worker.test.js`
  Expected: PASS.
- [ ] **Step 4: Commit** the docs: `Document the budget worker-stop and the marker-free settle — refs #6118`.
