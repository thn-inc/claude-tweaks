'use strict';
// The pipeline driver's run loop (drive.js, record #5218): run(argv, deps) parses the
// record references, probes gh and git, then walks steps.js's STEPS table once per named
// record, in order (`--budget` instead hands off to budget.js's runBudget, after the probes and
// the signal subscription). The loop owns only event emission and stop handling between steps:
// it names no step, so adding a step is a table entry, never a change here — with one
// exception: a step that leaves a new durable side effect must also set a ctx flag for it
// and add a rung for that flag to interruptClass (the ladder in the Interrupts paragraph).
//
// Per record: one event line per step ({ ts, run, record, step, status, ms, ...extra,
// detail? }) on stdout, held in memory until a step first sets ctx.runDir and from then
// on appended to {run-dir}/driver-events.jsonl as well (events.js's sink). A step whose
// result halts ends the record; an ok result with skip: true (a step that did not apply)
// emits no line, and neither does a non-ok result with noLine: true (a step that started nothing,
// a launch-time model refusal), which still halts and becomes the record's stop. A result that does not
// halt may queue steps of its own (`then`, #5997's relaunch): they run next, under their own names, then
// the rest of the table. ctx.relaunch (#5997) is a record of that decision, not a side effect, so it
// gets no interruptClass rung. Every record ends with a final line carrying the outcome word, the totals
// with and without the CI wait, the PR, the CI word, the worker's cost, turns and denial
// count, and the structured stop. The outcome word is the merge result's own
// (ctx.merge.outcome: `merged`, `armed` or `pending-review`) when the merge step ran and
// nothing stopped; otherwise it is the word for the stop's class (events.js's outcomeFor;
// `none` when nothing stopped). A halted record is then settled by settle.js
// (comment, label, release the claim, remove what this run created), unless the run was
// started with --no-settle, which leaves the stop to the caller (under --run a pre-push stop's
// escalate still runs, writing only the escalation line); settle's events come before
// the final line, and the final line's `settle` word says what happened (`done`,
// `left-to-caller`, `none` or `interrupted`). An interrupted record settles nothing: a
// signal queued during the halting step's synchronous child is delivered at the loop's yield
// before settle, and one that lands during settle stops it before its next call (settle
// yields between calls and reads shared.interrupted); either way the final line says
// `interrupted` and the loop terminates. A record that sets ctx.shared.fatal (the policy,
// the run's repository or its integration branch cannot be resolved) ends the run with
// exit 1.
//
// Every side effect goes through `deps` (gh-api-module-pattern's CLI wrapper contract);
// realDeps below is the real set. #5216's admission module and eligibility option are
// required lazily inside realDeps, so --help, a malformed invocation and the tests never
// load them; station-events/emit.js and driver-mirror.js (#5902) load eagerly, since every
// sink emit mirrors through them.
//
// ASSUMPTION (spec #5218, Gotchas) — answered at build: a fresh unlocked worktree IS reap-eligible: bin/lib/hooks/worktree-reap.js reaps a `free` (unlocked) worktree under .claude/worktrees/ whose branch is merged into, or content-identical with, the integration branch and that holds no local-only content, which a new one cut from the integration branch is until the worker's first write. The driver therefore creates its worktree locked, with its own pid in the lock reason (steps.js, the worktree step), so the lock reads `in-use` while the driver lives. The reaper's 24h grace applies only to an `orphaned` verdict (the driver's pid is dead and the lock is still present). A cleared lock reads `free`, with no grace: a tree still content-identical with the integration branch and holding no local-only content is reaped at the next SessionStart. Unchanged: reconcile/archive-merged.js only counts ownerless runs (countOwnerlessNonClean); tidy/scan-procedures.md keeps unmerged worktrees and acts only after its Step 6 approval.
//
// Interrupts (AC14 F1, the spec's Plan Review Clarification, Reading B). run() subscribes
// once through deps.onSignal and unsubscribes before it resolves. Node delivers a signal
// only when the event loop turns, and the steps before the worker make only synchronous
// calls, so the loop yields to the event loop (setImmediate) before every step. On SIGINT
// or SIGTERM the handler sets shared.interrupted to the signal and signals the running
// worker's handle if there is one (shared.activeWorker, whose kill reaches the worker's
// process group on POSIX). Then:
//   - inside a step that is awaiting (the worker): at once, a `fail` event for that step
//     with detail `interrupted by {signal}`, the record's final line, deps.terminate(signal);
//   - between steps: driveRecord, at the next boundary, emits a `fail` event for the step
//     about to start with detail `interrupted by {signal} before {step}`, the final line,
//     and deps.terminate(signal);
//   - with no record running, or before a record's first step: deps.terminate only.
// The stop class (interruptClass) keys on what the record actually holds, never on the
// step named: `none` once the run's config is written (ctx.configWritten: the record is a
// complete pending-review, so a signal during the CI wait never reads as a failure), else
// `blocked` once the branch is pushed, else `pre-push` once the run directory exists, else
// class claim once the claim was obtained (ctx.claimed), else `refused`, because nothing was
// written.
// Nothing further is driven or emitted after an interrupt. deps.terminate re-raises the
// signal only once stdout has taken the queued lines (reraiseAfterFlush), so stdout and the
// jsonl end alike.
// Limit: every call but the worker is a synchronous child, and Node runs no handler until
// it returns, so a SIGTERM sent to drive.js alone waits for the running child: up to the
// verify bound (30 minutes) or the 2-minute bound of the other CLIs. Ctrl-C in a terminal
// signals the whole foreground process group, children included, so it is prompt. A
// supervisor should signal the process group, not the pid.
const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');
const { createEventSink, outcomeFor, neutralize, yieldToEventLoop, FINAL_STEP, STOP_CLASSES, OUTCOMES } = require('./events');
const { STEPS, CHECK_STEPS } = require('./steps');
const { toEscalationReason, planRow, SETTLE_ROWS, ESCALATE_STEP, CLASS_BY_ROW, settle } = require('./settle');
const { ghAvailable, remoteUrl, ghOptions } = require('../repo-resolve');
const { lstatType, canonicalRealpath } = require('../path-guard');
const { resolveAgainst } = require('../health-core/io');
const { defaultResolvePolicy } = require('../express/policy');
const { appendStationEvent, toRepoName } = require('../station-events/emit');
const { stationEventsFor } = require('../station-events/driver-mirror');
// Read through the module at call time: GH_TIMEOUT_MS is a lazy getter (a policy read).
const sharedPrimitives = require('../shared-primitives');

const USAGE = [
  'Usage: drive.js #N [#M…]',
  '       drive.js --help | -h   (prints this text; exit 0, before any probe)',
  '       drive.js --no-settle #N [#M…]   (the caller settles stops: the final line carries settle: left-to-caller and the stop object)',
  '       drive.js [--no-settle] --budget <n|all>   (picks records from the dispatch queue and drives up to n of them, or all that are admitted; --no-settle applies to each driven record)',
  '       drive.js --check #N   (prints the admission verdict as one JSON line; no write of any kind)',
  '       drive.js #N [--in-flight-prs <file>] [--near-dup-pairs <file>]   (holds the merge before mark-ready when a PR in the JSON list <file> shares a changed path, or closes a strong near-duplicate partner of the record from the pairs <file>; unreadable input holds too; with no --in-flight-prs no hold is applied; not with --budget or --check)',
  '       drive.js #N --run <dir> --no-settle   (adopts the run directory <dir> and the linked worktree it is run from, minting and creating neither; requires --no-settle and one record)',
  'Takes each named record, one at a time and in order, from admission to a draft PR with',
  'CI read. Prints one JSON event line per step on stdout (and, once the run directory',
  'exists, to {run-dir}/driver-events.jsonl); each record ends with a final line carrying',
  'its outcome: pending-review, express-escalated, blocked, refused, merged or armed. A record merges only when it carries auto:merge and auto:build and the merge-check and acceptance judgment workers both clear it.',
  'Exit codes (Combined-2):',
  '  0  every named record reached its final event, whatever its outcome; with --budget, the loop ended normally (budget spent, queue exhausted, a claim stop on claim-targets.js exit 2, 6 or 7, or express-driver off), whatever each record\'s outcome',
  '  1  when the policy, or the run\'s repository or integration branch, cannot be resolved and no further record is attempted; with --budget, also a failed queue pull',
  '  2  malformed invocation (no record reference, a non-numeric one) or gh or git absent, or an internal error (run itself failed); a bad or repeated --budget value, or --budget with a named record; a missing, empty or repeated --run value, or --run without --no-settle, with more than one record, or with --budget or --check; with --in-flight-prs or --near-dup-pairs, a missing, empty, flag-shaped or repeated value, --budget or --check beside either, or --near-dup-pairs without --in-flight-prs',
  '  3  --run refused: the run directory is missing or not a run directory under the main checkout, or the working directory is not a linked worktree of it, or the run directory\'s run-state.json does not name that worktree, or the worktree has no branch; nothing written',
  '  --check: 0 a verdict was printed (admitted or not); 1 no verdict could be computed (nothing on stdout); 2 malformed (anything but exactly one record reference)',
  '',
].join('\n');

const RECORD_RE = /^#?(\d+)$/;
const GIT_PROBE_TIMEOUT_MS = 10000;
const MAX_BUFFER = sharedPrimitives.LARGE_MAX_BUFFER_BYTES;

// argv -> { records, settle } | { budget, settle } | { help: true } | { error }. `#N` or `N`,
// positive integers only, de-duplicated in the order given. `--budget <n|all>` (n a positive
// integer without a leading zero) names a queue-pulled run instead of records and is exclusive
// with them. `--check` (anywhere) takes exactly one record reference and no other option: `{ check }`.
// `--run <dir>` (once, with exactly one record and --no-settle, never with --budget or --check)
// adds `runDir`, the raw value; run() resolves it. The key is present only when the flag was given.
// `--in-flight-prs <file>` and `--near-dup-pairs <file>` (once each, with records or --run, never with
// --budget or --check; --near-dup-pairs only beside --in-flight-prs) add `inFlightPrsFile` / `nearDupPairsFile`, the raw values, on the same terms;
// run() resolves them against deps.cwd(). They feed merge.js's drain-overlap hold.
// --help (or -h) anywhere wins. `--no-settle` anywhere sets settle false (the caller
// settles stops); any other option is an error.
const BUDGET_NEEDS_RECORD = 'a record reference (#N) or --budget <n|all> is required';
const CHECK_GRAMMAR = '--check takes exactly one record reference (#N) and no other option';
const CHECK_RUN_EXCLUSIVE = '--check and --run are exclusive';
// The value-taking-flag rule: a trailing bare flag reads undefined, and an empty or flag-shaped value is no value.
const isFlagValue = (v) => typeof v === 'string' && v.trim() !== '' && !v.startsWith('--');
function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  if (argv.length === 0) return { error: BUDGET_NEEDS_RECORD };
  if (argv.includes('--check')) {
    if (argv.includes('--run')) return { error: CHECK_RUN_EXCLUSIVE };
    const rest = argv.filter((a) => a !== '--check');
    const m = rest.length === 1 && argv.length === 2 ? RECORD_RE.exec(String(rest[0])) : null;
    const n = m ? Number(m[1]) : NaN;
    return Number.isSafeInteger(n) && n > 0 ? { check: n } : { error: CHECK_GRAMMAR };
  }
  const records = [];
  let budget;
  let runDir;
  let inFlightPrsFile;
  let nearDupPairsFile;
  let settleStops = true;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--no-settle') {
      settleStops = false;
      continue;
    }
    if (a === '--run') {
      if (runDir !== undefined) return { error: '--run given more than once' };
      const v = argv[i + 1];
      if (!isFlagValue(v)) return { error: '--run needs a value: the run directory to adopt' };
      runDir = v;
      i += 1;
      continue;
    }
    if (a === '--in-flight-prs' || a === '--near-dup-pairs') {
      const isPrs = a === '--in-flight-prs';
      if ((isPrs ? inFlightPrsFile : nearDupPairsFile) !== undefined) return { error: `${a} given more than once` };
      const v = argv[i + 1];
      if (!isFlagValue(v)) return { error: `${a} needs a value: ${isPrs ? 'a JSON file listing the in-flight drain PRs' : 'a JSON file of dispatch\'s strong near-duplicate pairs'}` };
      if (isPrs) inFlightPrsFile = v;
      else nearDupPairsFile = v;
      i += 1;
      continue;
    }
    if (a === '--budget') {
      if (budget !== undefined) return { error: '--budget given more than once' };
      if (i + 1 >= argv.length) return { error: '--budget needs a value: a positive integer or all' };
      const v = String(argv[i + 1]);
      i += 1;
      if (v === 'all') budget = 'all';
      else if (/^[1-9][0-9]*$/.test(v) && Number.isSafeInteger(Number(v))) budget = Number(v);
      else return { error: `--budget must be a positive integer or all, got: ${JSON.stringify(v)}` };
      continue;
    }
    const m = RECORD_RE.exec(String(a));
    const n = m ? Number(m[1]) : NaN;
    if (!Number.isSafeInteger(n) || n <= 0) {
      return { error: String(a).startsWith('-') && !m ? `unknown option: ${a}` : `not a record reference: ${JSON.stringify(a)}` };
    }
    if (!records.includes(n)) records.push(n);
  }
  if (nearDupPairsFile !== undefined && inFlightPrsFile === undefined) {
    return { error: '--near-dup-pairs requires --in-flight-prs (the pairs apply only to the in-flight PRs that list names)' };
  }
  const hold = {
    ...(inFlightPrsFile !== undefined ? { inFlightPrsFile } : {}),
    ...(nearDupPairsFile !== undefined ? { nearDupPairsFile } : {}),
  };
  if (runDir !== undefined) {
    if (budget !== undefined) return { error: '--run and --budget are exclusive' };
    if (records.length !== 1) return { error: '--run takes exactly one record reference (#N)' };
    if (settleStops) return { error: '--run requires --no-settle (the caller settles stops)' };
    return { records, settle: false, runDir, ...hold };
  }
  if (budget !== undefined) {
    if (records.length > 0) return { error: '--budget and a named record (#N) are exclusive' };
    if (Object.keys(hold).length > 0) return { error: '--in-flight-prs and --near-dup-pairs are exclusive with --budget' };
    return { budget, settle: settleStops };
  }
  if (records.length === 0) return { error: BUDGET_NEEDS_RECORD };
  return { records, settle: settleStops, ...hold };
}

// `current` is the record being driven, `{ ctx, sink, started, step, inStep, stepStarted,
// final }`, set for the length of one driveRecord and cleared after it, so the signal
// handler can reach that record's context, event sink and clocks: `step` is the table
// entry running or last run (null before the first), `inStep` is true while it is pending,
// and `final` holds the final line an interrupt wrote. `interrupted` is the signal's name
// once the handler has run, else false. `adopted` is adopt.js's ok result under --run, else null.
function newShared() {
  return { policy: null, ref: null, mainRoot: null, repo: null, ghRepo: null, fatal: false, activeWorker: null, current: null, interrupted: false, settle: true, adopted: null, inFlightPrsFile: null, nearDupPairsFile: null };
}

// `named` (#5584): the record was given on drive.js's command line, so a typed command may stand in
// for its `auto:build` grant at admission; a record the --budget loop picked never is.
function newCtx(record, shared, { named = false } = {}) {
  return {
    record, named: named === true, runId: null, runDir: null, wt: null, indexFlags: null, implementer: null, branch: null, claimed: false, claimExit: null,
    created: { worktree: false, branch: false }, pushed: false, configWritten: false, relaunch: null,
    pr: null, ci: null, ciWaitStartedAt: null, pushedAt: null, checkLogged: undefined, worker: null,
    workerTestCommand: undefined, workerTestMode: undefined,
    eligibilityReasons: null, admissionReasons: null, typedCommandNote: null,
    summaryLogged: false, merge: null, events: null, eventsStdoutOnly: false, reviewer: null, widenedBy: null,
    shared,
  };
}

function eventFor(ctx, name, result, ms, deps) {
  const event = {
    ts: deps.date().toISOString(),
    run: ctx.runDir ? ctx.runId : null,
    record: ctx.record,
    step: name,
    status: result.status,
    ms,
  };
  for (const [key, value] of Object.entries(result.extra || {})) {
    if (!Object.prototype.hasOwnProperty.call(event, key)) event[key] = value;
  }
  if (result.detail !== undefined && result.detail !== null) event.detail = result.detail;
  return event;
}

const orNull = (v) => (v === undefined ? null : v);

// The structured stop a settle (or a caller reading the final line) works from. Built here, once,
// for both settle's input and the final line, so it never depends on the outcome. A pre-push
// stop is one settle escalates, so its reason is the closed set escalate takes.
function stopObject(ctx, stop) {
  const stopClass = stop ? stop.result.stopClass : STOP_CLASSES.NONE;
  return {
    step: stop ? stop.name : null,
    class: stopClass,
    pushed: ctx.pushed === true,
    created: { worktree: ctx.created.worktree === true, branch: ctx.created.branch === true },
    reason: stop ? (stopClass === STOP_CLASSES.PRE_PUSH ? toEscalationReason(stop.result.reason) : stop.result.reason) : null,
    detail: stop ? orNull(stop.result.detail) : null,
    checkLogged: orNull(ctx.checkLogged),
  };
}

// What settle did for a record, as the final line reports it. `mode` is the `settle` word.
const SETTLE_NONE = Object.freeze({ mode: 'none', row: null, failed: [], settledClass: null, unclassified: false, note: null });
const SETTLE_INTERRUPTED = Object.freeze({ ...SETTLE_NONE, mode: 'interrupted' });

const KNOWN_CLASSES = new Set(Object.values(STOP_CLASSES));
// outcomeFor throws on an unknown class, and a final line must always be written: a class
// outside the set reads blocked (the same word settle's safety net gives it).
const outcomeOf = (stopClass) => (KNOWN_CLASSES.has(stopClass) ? outcomeFor(stopClass) : OUTCOMES.BLOCKED);

function finalEvent(ctx, stop, sink, msTotal, deps, settled = SETTLE_NONE) {
  const stopClass = stop ? stop.result.stopClass : STOP_CLASSES.NONE;
  const ciWaitMs = sink.events().reduce((sum, e) => sum + (Number.isFinite(e.ciWaitMs) ? e.ciWaitMs : 0), 0);
  const { worker } = ctx;
  const event = {
    ts: deps.date().toISOString(),
    run: ctx.runDir ? ctx.runId : null,
    record: ctx.record,
    step: FINAL_STEP,
    status: stop ? stop.result.status : 'ok',
    ms: msTotal,
    // When settle ran (or --no-settle planned a row), the outcome is the class of that row (a
    // failed escalate reads blocked).
    outcome: !stop && ctx.merge ? ctx.merge.outcome : outcomeOf(settled.settledClass || stopClass),
    msTotal,
    msWithoutCi: msTotal - ciWaitMs,
    pr: ctx.pr ? orNull(ctx.pr.number) : null,
    // Null is reserved for no PR: once a PR exists, a CI state never read is `pending`.
    ci: ctx.pr ? (typeof ctx.ci === 'string' ? ctx.ci : 'pending') : orNull(ctx.ci),
    costUsd: worker ? orNull(worker.costUsd) : null,
    turns: worker ? orNull(worker.turns) : null,
    denialCount: worker && Array.isArray(worker.denials) ? worker.denials.length : null,
    stop: stopObject(ctx, stop),
    settle: settled.mode,
    settleFailed: settled.failed,
    settleRow: settled.row,
  };
  if (settled.unclassified === true) event.unclassified = true;
  if (settled.note) event.settleNote = settled.note;
  if (worker && worker.spendOverrun === true) event.spendOverrun = true;
  if (ctx.merge) {
    event.merge = {
      outcome: ctx.merge.outcome, reason: ctx.merge.reason === null ? null : neutralize(String(ctx.merge.reason)),
      mergeCommit: ctx.merge.mergeCommit, postMerge: ctx.merge.postMerge,
    };
  }
  if (ctx.eventsStdoutOnly) event.eventsFile = 'stdout-only';
  const fileError = sink.fileError();
  if (fileError !== null) event.eventsFileError = fileError;
  return event;
}

// An interrupted record's stop class, from the side effects it holds: `none` once the run's
// config is written (the PR is created, recorded and configured: a complete pending-review),
// `blocked` once the branch is pushed, `pre-push` once the run directory exists (an escalation
// has somewhere to live), the claim class once the claim was obtained, else `refused`
// (nothing written).
function interruptClass(ctx) {
  if (ctx.configWritten === true) return STOP_CLASSES.NONE;
  if (ctx.pushed === true) return STOP_CLASSES.BLOCKED;
  if (ctx.runDir) return STOP_CLASSES.PRE_PUSH;
  if (ctx.claimed === true) return STOP_CLASSES.CLAIM;
  return STOP_CLASSES.REFUSED;
}

// Writes an interrupted record's stop at `step` and its final line, then terminates. The
// process ends by the signal whatever the emission does. A CI wait in progress is reported
// as the stop's ciWaitMs, so msWithoutCi still excludes it; the final line's ci field follows
// finalEvent's rule (the last polled state, `pending` when never read, null only with no PR).
function reportInterrupt(shared, current, step, detail, ms, deps) {
  const { ctx, sink } = current;
  try {
    // A step that set ctx.runDir may not have had its sink bound yet; binding twice is harmless.
    if (ctx.runDir && !ctx.eventsStdoutOnly) sink.bindRunDir(ctx.runDir);
    const extra = Number.isFinite(ctx.ciWaitStartedAt) ? { ciWaitMs: Math.max(0, deps.now() - ctx.ciWaitStartedAt) } : {};
    const result = { status: 'fail', detail, halt: true, stopClass: interruptClass(ctx), reason: 'fail', extra };
    sink.emit(eventFor(ctx, step.name, result, ms, deps));
    // An interrupted record settles nothing: its claim and what it created are the next session's.
    current.final = finalEvent(ctx, { name: step.name, result }, sink, deps.now() - current.started, deps, SETTLE_INTERRUPTED);
    sink.emit(current.final);
  } finally {
    deps.terminate(shared.interrupted);
  }
}

// Settles a halted record (settle.js) unless the run was started with --no-settle, which only
// names the row the caller will settle. `done` means the row had calls; a row with none is
// `none` either way. settle's events go to the sink as they happen, before the final line.
// A signal that lands during settle stops it before its next call (settle's `interrupted`
// predicate): the result is then `interrupted`, naming the calls that failed so far.
async function settleStop(ctx, stop, record, shared, sink, deps) {
  const stopObj = stopObject(ctx, stop);
  const pr = ctx.pr && ctx.pr.number;
  // A successful call has no detail: the line omits the field, like any other step line.
  const emit = (name, status, ms, detail) => { sink.emit(eventFor(ctx, name, { status, detail: detail || undefined, extra: {} }, ms, deps)); };
  const input = {
    stop: stopObj, record, runId: ctx.runId, runDir: ctx.runDir, wt: ctx.wt, branch: ctx.branch,
    pr, claimed: ctx.claimed, mainRoot: shared.mainRoot, ghRepo: shared.ghRepo, emit,
    interrupted: () => shared.interrupted,
  };
  const reported = (result, mode) => ({
    mode: result.interrupted ? 'interrupted' : mode, row: result.row, failed: result.failed,
    settledClass: result.settledClass, unclassified: result.unclassified, note: result.note,
  });
  if (shared.settle === true) {
    const result = await settle(input, deps);
    return reported(result, result.calls.length > 0 ? 'done' : 'none');
  }
  // The row settle would use, from the same run-state read.
  const plan = planRow({ stop: stopObj, runDir: ctx.runDir, pr }, deps);
  // Under --run (#5232) the pre-push row's escalate still runs: it writes only the escalation line
  // to dispatch's run directory, which the ordinary first call after `express-escalated` reads
  // (build's already-shipped check, `hasEscalation`); the rest of the row stays the caller's. Its
  // own precondition skips it when check already wrote the line. A failed escalate reads `blocked`.
  if (shared.adopted && plan.row === 'pre-push') {
    return reported(await settle({ ...input, only: [ESCALATE_STEP] }, deps), 'left-to-caller');
  }
  return {
    mode: SETTLE_ROWS[plan.row].length > 0 ? 'left-to-caller' : 'none', row: plan.row, failed: [],
    settledClass: CLASS_BY_ROW[plan.row], unclassified: plan.unclassified, note: plan.unreadableNote,
  };
}

// The sink with every emitted line also mirrored into station events (#5902) through the optional
// deps.stationEvent (absent = no emission). The mirror runs after the real emit and inside its own
// try/catch, so it never throws into a caller, never changes stdout or the jsonl, and never skips
// the final line or reportInterrupt's terminate.
function mirroredSink(sink, shared, deps) {
  if (typeof deps.stationEvent !== 'function') return sink;
  const emit = (event) => {
    sink.emit(event);
    let mirrored = [];
    try {
      mirrored = stationEventsFor(event, { repoName: toRepoName(shared.ghRepo), runId: event.run });
    } catch {
      // a station event is a report about the step, never part of it
    }
    for (const e of mirrored) {
      try {
        deps.stationEvent(e);
      } catch {
        // one failed station event drops only itself
      }
    }
  };
  return { ...sink, emit };
}

// One record through the table; resolves to `{ final, ctx }` — the final event (null when an
// interrupt landed before its first step) and the record's context. `steps` is a test seam.
async function driveWithCtx(record, shared, deps, steps, { named = false } = {}) {
  const sink = mirroredSink(createEventSink({ stdout: deps.stdout, appendFile: deps.appendFile }), shared, deps);
  const ctx = newCtx(record, shared, { named });
  // The writer a step uses to emit sub-step lines (before its own result line) and to follow the
  // run directory when it moves; rebind(null) goes stdout-only.
  ctx.events = {
    emit: (name, status, ms, detail, extra) => {
      sink.emit(eventFor(ctx, name, { status, detail: detail || undefined, extra: extra || {} }, ms, deps));
    },
    rebind: (dir) => {
      if (dir) {
        sink.bindRunDir(dir);
      } else {
        sink.unbind();
        ctx.eventsStdoutOnly = true;
      }
    },
  };
  const current = { ctx, sink, started: null, step: null, inStep: false, stepStarted: null, final: null };
  shared.current = current;
  try {
    const started = deps.now();
    current.started = started;
    let bound = false;
    let stop = null;
    // A non-halting result's `then` steps (defineStep validated them) run next, ahead of the rest of the table.
    const queue = [...steps];
    while (queue.length > 0) {
      const step = queue.shift();
      await yieldToEventLoop();
      if (shared.interrupted) {
        // Before the first step the handler has already terminated; after one, the
        // interrupt is reported at the step about to start.
        if (current.step !== null) {
          reportInterrupt(shared, current, step, `interrupted by ${shared.interrupted} before ${step.name}`, 0, deps);
        }
        return { final: current.final, ctx };
      }
      const t0 = deps.now();
      current.step = step;
      current.stepStarted = t0;
      current.inStep = true;
      let result;
      try {
        result = await step.run(ctx, deps);
      } finally {
        current.inStep = false;
      }
      // The handler already wrote this record's stop and final line.
      if (shared.interrupted) return { final: current.final, ctx };
      const ms = deps.now() - t0;
      if (!bound && ctx.runDir) {
        sink.bindRunDir(ctx.runDir);
        bound = true;
      }
      if (result.skip !== true && result.noLine !== true) sink.emit(eventFor(ctx, step.name, result, ms, deps));
      if (result.halt) {
        stop = { name: step.name, result };
        break;
      }
      if (Array.isArray(result.then) && result.then.length > 0) queue.unshift(...result.then);
    }
    let settled = SETTLE_NONE;
    if (stop) {
      // A signal that arrived during the halting step's synchronous child is delivered only when
      // the event loop turns, and the handler ignores it here (no step is running): settle
      // nothing if one is pending.
      await yieldToEventLoop();
      settled = shared.interrupted ? SETTLE_INTERRUPTED : await settleStop(ctx, stop, record, shared, sink, deps);
    }
    const final = finalEvent(ctx, stop, sink, deps.now() - started, deps, settled);
    sink.emit(final);
    // The handler did not terminate for a signal that landed here: do it once the final line is out.
    if (settled.mode === 'interrupted') {
      current.final = final;
      deps.terminate(shared.interrupted);
    }
    return { final, ctx };
  } finally {
    shared.current = null;
  }
}

// One record through the table; resolves to its final event (null when an interrupt landed
// before its first step) plus the claim facts the budget loop counts from: whether the claim
// was obtained and its run dir minted, and the claim step's exit code.
async function driveRecord(record, shared, deps, steps = STEPS, { named = false } = {}) {
  const { final, ctx } = await driveWithCtx(record, shared, deps, steps, { named });
  return {
    final,
    outcome: final ? final.outcome : null,
    claimed: ctx.claimed === true && typeof ctx.runDir === 'string' && ctx.runDir !== '',
    claimExit: ctx.claimExit,
  };
}

// `drive.js --check #N`: walks CHECK_STEPS (the read-only head of the table; it names no step) and
// prints the admission verdict as one JSON line. Exit 0 once a verdict printed, admitted or not;
// exit 1, nothing on stdout, when none could be computed: a step failed, or a step stopped before
// the eligibility and admission steps recorded their reasons (ctx.eligibilityReasons and
// ctx.admissionReasons stay null until then). An eligibility stop still runs admission, so every
// reason is reported. No claim, run directory, worktree or forge write is in CHECK_STEPS.
async function checkRecord(n, shared, deps, steps = CHECK_STEPS) {
  // The record is on drive.js's command line, so it is named (#5584), as the drive loop names its records.
  const ctx = newCtx(n, shared, { named: true });
  let admitted = true;
  let last = null;
  const noVerdict = (name, status, detail) => {
    deps.stderr(`drive.js --check: ${name} ${status}: ${detail}\n`);
    return 1;
  };
  for (const step of steps) {
    last = step;
    const result = await step.run(ctx, deps);
    if (result.status === 'fail') return noVerdict(step.name, result.status, result.detail);
    if (result.status === 'ok') continue;
    // A stop is a verdict only from a step that recorded its reasons.
    if (ctx.eligibilityReasons === null && ctx.admissionReasons === null) return noVerdict(step.name, result.status, result.detail);
    admitted = false;
  }
  if (!Array.isArray(ctx.eligibilityReasons) || !Array.isArray(ctx.admissionReasons)) {
    return noVerdict(last ? last.name : 'none', 'no-verdict', 'the eligibility and admission verdicts were not both read');
  }
  // A refused typed command's words follow the admission reasons as one more string (#5584).
  const typedNote = typeof ctx.typedCommandNote === 'string' ? [ctx.typedCommandNote] : [];
  deps.stdout(`${JSON.stringify({ record: n, admitted, reasons: [...ctx.eligibilityReasons, ...ctx.admissionReasons, ...typedNote], widenedBy: Array.isArray(ctx.widenedBy) ? ctx.widenedBy : [] })}\n`);
  return 0;
}

// The signal handler run() subscribes (see the header's Interrupts paragraph). A second
// signal is ignored: the first one's terminate already drops the subscription.
function interrupt(shared, signal, deps) {
  if (shared.interrupted) return;
  shared.interrupted = signal;
  const worker = shared.activeWorker;
  if (worker) {
    try {
      worker.kill('SIGTERM');
    } catch {
      // The worker is already gone.
    }
  }
  const { current } = shared;
  if (current && current.inStep) {
    reportInterrupt(shared, current, current.step, `interrupted by ${signal}`, deps.now() - current.stepStarted, deps);
  } else if (!current || current.step === null) {
    deps.terminate(signal);
  }
  // Otherwise the signal landed between two steps: driveRecord reports it at the next one.
}

// Re-raises `sig` once stdout has taken every queued line: to a pipe on macOS stdout is
// asynchronous, and a re-raise straight after the last write can drop lines the jsonl
// holds. The unref'd backstop raises anyway should the flush never call back.
const TERMINATE_FLUSH_BACKSTOP_MS = 500;
function reraiseAfterFlush(sig, { stdout, kill, setTimer }) {
  let raised = false;
  const raise = () => {
    if (raised) return;
    raised = true;
    kill(sig);
  };
  const backstop = setTimer(raise, TERMINATE_FLUSH_BACKSTOP_MS);
  if (backstop && typeof backstop.unref === 'function') backstop.unref();
  try {
    stdout.write('', raise);
  } catch {
    raise();
  }
}

// `--run <dir>`: the guard's ok result (adopt.js), or null once the refusal is on stderr. A relative
// <dir> is joined to deps.cwd() unnormalized (resolveAgainst), so a `..` after a symlink still
// reaches the guard's realpath. A throw (deps.cwd() of a deleted directory included) is a refusal
// naming the error. Nothing is written either way.
function adoptRunDir(runDir, deps) {
  let result;
  try {
    const cwd = deps.cwd();
    result = deps.adoptRun({ runDir: resolveAgainst(cwd, runDir), cwd }, deps);
  } catch (err) {
    result = { ok: false, why: (err && err.message) || String(err) };
  }
  if (result && result.ok === true) return result;
  deps.stderr(`drive.js: --run refused: ${(result && result.why) || 'no result'}\n`);
  return null;
}

async function run(argv, deps) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    deps.stdout(USAGE);
    return 0;
  }
  if (parsed.error) {
    deps.stderr(`drive.js: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  if (!deps.ghAvailable()) {
    deps.stderr('drive.js: gh is not available (gh --version failed); install and authenticate the GitHub CLI\n');
    return 2;
  }
  if (!deps.gitAvailable()) {
    deps.stderr('drive.js: git is not available (git --version failed)\n');
    return 2;
  }
  if (parsed.check !== undefined) return checkRecord(parsed.check, newShared(), deps);
  const shared = newShared();
  shared.settle = parsed.settle;
  if (parsed.inFlightPrsFile !== undefined || parsed.nearDupPairsFile !== undefined) {
    // Resolved against the caller's working directory, as --run's value is, before any step reads it.
    try {
      const cwd = deps.cwd();
      if (parsed.inFlightPrsFile !== undefined) shared.inFlightPrsFile = resolveAgainst(cwd, parsed.inFlightPrsFile);
      if (parsed.nearDupPairsFile !== undefined) shared.nearDupPairsFile = resolveAgainst(cwd, parsed.nearDupPairsFile);
    } catch (err) {
      deps.stderr(`drive.js: cannot resolve --in-flight-prs / --near-dup-pairs against the working directory: ${(err && err.message) || String(err)}\n`);
      return 2;
    }
  }
  if (parsed.runDir !== undefined) {
    const adopted = adoptRunDir(parsed.runDir, deps);
    if (!adopted) return 3;
    shared.adopted = adopted;
  }
  const unsubscribe = deps.onSignal((signal) => interrupt(shared, signal, deps));
  try {
    if (parsed.budget !== undefined) {
      const { runBudget } = require('./budget');
      return await runBudget(parsed.budget, shared, deps, { driveOne: (n) => driveRecord(n, shared, deps) });
    }
    for (const record of parsed.records) {
      await driveRecord(record, shared, deps, STEPS, { named: true });
      // A signal queued during the record's last synchronous call is delivered only when the
      // event loop turns; without this turn the unsubscribe below would drop it (exit 0).
      await yieldToEventLoop();
      if (shared.fatal) return 1;
    }
    return 0;
  } finally {
    if (typeof unsubscribe === 'function') unsubscribe();
  }
}

// The signal subscription onSignal made, so terminate can drop it before re-raising.
let unsubscribeSignals = null;

const realDeps = {
  cwd: () => process.cwd(),
  gh: (args) => execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: sharedPrimitives.GH_TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true,
  })),
  // One aliased GraphQL batch (#4815), so it gets the batched bound, not the single-call one.
  ghBatch: (args) => execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: sharedPrimitives.GH_BATCH_TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true,
  })),
  // Writes to GitHub (`gh pr create`, the merge step's `gh pr merge`) take longer than a read, so they get the batched bound too.
  ghCreate: (args) => execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: sharedPrimitives.GH_BATCH_TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true,
  })),
  // The shared git bounds, read at call time (env, then policy, then the default): a call that
  // writes to the remote passes `remoteWrite: true` for GIT_PUSH_TIMEOUT_MS, every other call
  // gets GIT_TIMEOUT_MS. `env` (the merge step's C-locale describe) replaces the inherited env
  // for that call only; a call that omits it inherits process.env as before.
  git: (args, { cwd, remoteWrite, env } = {}) => execFileSync('git', args, {
    cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: remoteWrite === true ? sharedPrimitives.GIT_PUSH_TIMEOUT_MS : sharedPrimitives.GIT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER, windowsHide: true,
  }),
  // The live GIT_TIMEOUT_MS (env, then policy, then the default), read at call time: the merge
  // step's park budget counts accept-park.js's own git calls, which run under this same bound.
  gitTimeoutMs: () => sharedPrimitives.GIT_TIMEOUT_MS,
  // A plugin/bin CLI under this Node; never throws on a non-zero exit.
  // The child gets the env the caller passes (steps pass deps.env); a call that omits `env`
  // falls back to process.env.
  node: (script, args, { cwd, timeout, env = process.env } = {}) => {
    const r = spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8', timeout, maxBuffer: MAX_BUFFER, windowsHide: true });
    const stderr = r.stderr || '';
    return { code: r.status, stdout: r.stdout || '', stderr: r.error ? `${stderr}${r.error.message}\n` : stderr };
  },
  resolvePolicy: (keys) => defaultResolvePolicy(keys),
  // The implementer's first profile under `implementer-tier: record` (#5997).
  recordImplementerProfile: (issue) => require('./launch').recordImplementerProfile(issue),
  resolvePolicyCore: (opts, coreDeps) => require('../../resolve-policy').resolvePolicy(opts, coreDeps),
  evaluateRecordEligibility: (issue, opts) => require('../express/eligibility').evaluateRecordEligibility(issue, opts),
  evaluateAdmission: (input) => require('./admission').evaluateAdmission(input),
  // The build grant at admission (#5584): the one rule, the transcript check it asks inside a
  // session, and whether stdin is a terminal (the rule's outside-a-session condition). The terminal
  // test is a getter, so requiring this module never opens process.stdin.
  resolveBuildAuthority: require('../issues/build-authority').resolveBuildAuthority,
  readTypedCommand: (opts) => require('../issues/typed-command').readTypedCommand(opts),
  get stdinIsTTY() { return process.stdin.isTTY === true; },
  // The record's one reviewer answer (#5224), asked by the eligibility step.
  reviewRequired: (opts) => require('./review').reviewRequired(opts),
  fetchNativeDependencies: (opts) => require('../issues/native-dependencies').fetchNativeDependencies(opts),
  fetchLinkedPRs: (opts) => require('../issues/linked-prs').fetchLinkedPRs(opts),
  // The queue-pull module bounds its own gh calls (isBatchGhCall), so these take no timeout here.
  queuePull: (options, d) => require('../dispatch/queue-pull').queuePull(options, d),
  rankNext: (groups, entries, opts) => require('../dispatch/queue-pull').rankNext(groups, entries, opts),
  launchWorker: (opts, d) => require('./worker').launchWorker(opts, d),
  // The merge step's judgment supplier (#5228): the merge-check and acceptance workers behind merge.js's `deps.judgments`.
  createJudgments: (opts) => require('./judgments').createJudgments(opts),
  runner: (call) => require('./worker').defaultRunner(call),
  resolveRunDir: (opts) => require('../hooks/run-dir-resolve').resolve(opts),
  // The --run guard (#5232): adopts dispatch's run directory and worktree, or refuses.
  adoptRun: (opts, d) => require('./adopt').adoptRun(opts, d),
  lstatType: (p) => lstatType(p),
  readdir: (p) => fs.readdirSync(p),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: (p, s) => fs.writeFileSync(p, s),
  appendFile: (p, s) => fs.appendFileSync(p, s),
  mkdirSync: (p, opts) => fs.mkdirSync(p, opts),
  // The review step's evidence files (review.js): created exclusively, removed one by one.
  writeFileExclusive: (p, s) => fs.writeFileSync(p, s, { flag: 'wx' }),
  rmFile: (p) => fs.unlinkSync(p),
  rmdir: (p) => fs.rmdirSync(p),
  canonicalRealpath: (p) => canonicalRealpath(p),
  execPath: process.execPath,
  timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (timer) => clearTimeout(timer) },
  platform: process.platform,
  env: process.env,
  pid: process.pid,
  now: Date.now,
  date: () => new Date(),
  sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  // Registers one handler for SIGINT and SIGTERM; returns its unsubscribe.
  onSignal: (handler) => {
    const signals = ['SIGINT', 'SIGTERM'];
    for (const sig of signals) process.on(sig, handler);
    unsubscribeSignals = () => {
      for (const sig of signals) process.removeListener(sig, handler);
      unsubscribeSignals = null;
    };
    return unsubscribeSignals;
  },
  // Drops the subscription, then re-raises the signal once stdout has flushed, so the
  // process ends by it.
  terminate: (sig) => {
    if (unsubscribeSignals) unsubscribeSignals();
    reraiseAfterFlush(sig, { stdout: process.stdout, kill: (s) => process.kill(process.pid, s), setTimer: setTimeout });
  },
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  // #5902: the driver's step lines mirrored into {main checkout}/.claude-tweaks/station-events.jsonl.
  stationEvent: (e) => appendStationEvent(e),
  ghAvailable: () => ghAvailable(),
  gitAvailable: () => {
    try {
      execFileSync('git', ['version'], { stdio: 'ignore', timeout: GIT_PROBE_TIMEOUT_MS, windowsHide: true });
      return true;
    } catch {
      return false;
    }
  },
  remoteUrl: () => remoteUrl(),
};

module.exports = { run, parseArgs, USAGE, realDeps, driveRecord, checkRecord, newShared, interruptClass, reraiseAfterFlush };
