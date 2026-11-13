'use strict';
// The pipeline driver's run loop (drive.js, record #5218): run(argv, deps) parses the
// record references, probes gh and git, then walks steps.js's STEPS table once per named
// record, in order. The loop owns only event emission and stop handling between steps:
// it names no step, so adding a step is a table entry, never a change here — with one
// exception: a step that leaves a new durable side effect must also set a ctx flag for it
// and add a rung for that flag to interruptClass (the ladder in the Interrupts paragraph).
//
// Per record: one event line per step ({ ts, run, record, step, status, ms, ...extra,
// detail? }) on stdout, held in memory until a step first sets ctx.runDir and from then
// on appended to {run-dir}/driver-events.jsonl as well (events.js's sink). A step whose
// result halts ends the record. Every record ends with a final line carrying the outcome
// word for the stop's class (events.js's outcomeFor; `none` when nothing stopped), the
// totals with and without the CI wait, the PR, the CI word, the worker's cost, turns and
// denial count, and the structured stop the settle unit reads. A record that sets
// ctx.shared.fatal (the policy, the run's repository or its integration branch cannot be
// resolved) ends the run with exit 1.
//
// Every side effect goes through `deps` (gh-api-module-pattern's CLI wrapper contract);
// realDeps below is the real set. #5216's admission module and eligibility option are
// required lazily inside realDeps, so --help, a malformed invocation and the tests never
// load them.
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
const { createEventSink, outcomeFor, FINAL_STEP, STOP_CLASSES } = require('./events');
const { STEPS } = require('./steps');
const { ghAvailable, remoteUrl, ghOptions } = require('../repo-resolve');
const { lstatType } = require('../path-guard');
const { defaultResolvePolicy } = require('../express/policy');
// Read through the module at call time: GH_TIMEOUT_MS is a lazy getter (a policy read).
const sharedPrimitives = require('../shared-primitives');

const USAGE = [
  'Usage: drive.js #N [#M…]',
  '       drive.js --help | -h   (prints this text; exit 0, before any probe)',
  'Takes each named record, one at a time and in order, from admission to a draft PR with',
  'CI read. Prints one JSON event line per step on stdout (and, once the run directory',
  'exists, to {run-dir}/driver-events.jsonl); each record ends with a final line carrying',
  'its outcome: pending-review, express-escalated, blocked or refused. Nothing merges.',
  'Exit codes (Combined-2):',
  '  0  every named record reached its final event, whatever its outcome',
  '  1  when the policy, or the run\'s repository or integration branch, cannot be resolved and no further record is attempted',
  '  2  malformed invocation (no record reference, a non-numeric one) or gh or git absent, or an internal error (run itself failed)',
  '',
].join('\n');

const RECORD_RE = /^#?(\d+)$/;
const GIT_PROBE_TIMEOUT_MS = 10000;
const MAX_BUFFER = sharedPrimitives.LARGE_MAX_BUFFER_BYTES;

// argv -> { records } | { help: true } | { error }. `#N` or `N`, positive integers only,
// de-duplicated in the order given. --help (or -h) anywhere wins.
function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  if (argv.length === 0) return { error: 'at least one record reference (#N) is required' };
  const records = [];
  for (const a of argv) {
    const m = RECORD_RE.exec(String(a));
    const n = m ? Number(m[1]) : NaN;
    if (!Number.isSafeInteger(n) || n <= 0) {
      return { error: String(a).startsWith('-') && !m ? `unknown option: ${a}` : `not a record reference: ${JSON.stringify(a)}` };
    }
    if (!records.includes(n)) records.push(n);
  }
  return { records };
}

// `current` is the record being driven, `{ ctx, sink, started, step, inStep, stepStarted,
// final }`, set for the length of one driveRecord and cleared after it, so the signal
// handler can reach that record's context, event sink and clocks: `step` is the table
// entry running or last run (null before the first), `inStep` is true while it is pending,
// and `final` holds the final line an interrupt wrote. `interrupted` is the signal's name
// once the handler has run, else false.
function newShared() {
  return { policy: null, ref: null, mainRoot: null, repo: null, ghRepo: null, fatal: false, activeWorker: null, current: null, interrupted: false };
}

function newCtx(record, shared) {
  return {
    record, runId: null, runDir: null, wt: null, branch: null, claimed: false,
    created: { worktree: false, branch: false }, pushed: false, configWritten: false,
    pr: null, ci: null, ciWaitStartedAt: null, checkLogged: undefined, worker: null,
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

function finalEvent(ctx, stop, sink, msTotal, deps) {
  const stopClass = stop ? stop.result.stopClass : STOP_CLASSES.NONE;
  const ciWaitMs = sink.events().reduce((sum, e) => sum + (Number.isFinite(e.ciWaitMs) ? e.ciWaitMs : 0), 0);
  const { worker } = ctx;
  const orNull = (v) => (v === undefined ? null : v);
  const event = {
    ts: deps.date().toISOString(),
    run: ctx.runDir ? ctx.runId : null,
    record: ctx.record,
    step: FINAL_STEP,
    status: stop ? stop.result.status : 'ok',
    ms: msTotal,
    outcome: outcomeFor(stopClass),
    msTotal,
    msWithoutCi: msTotal - ciWaitMs,
    pr: ctx.pr ? orNull(ctx.pr.number) : null,
    // Null is reserved for no PR: once a PR exists, a CI state never read is `pending`.
    ci: ctx.pr ? (typeof ctx.ci === 'string' ? ctx.ci : 'pending') : orNull(ctx.ci),
    costUsd: worker ? orNull(worker.costUsd) : null,
    turns: worker ? orNull(worker.turns) : null,
    denialCount: worker && Array.isArray(worker.denials) ? worker.denials.length : null,
    stop: {
      step: stop ? stop.name : null,
      class: stopClass,
      pushed: ctx.pushed === true,
      created: { worktree: ctx.created.worktree === true, branch: ctx.created.branch === true },
      reason: stop ? stop.result.reason : null,
      detail: stop ? orNull(stop.result.detail) : null,
      checkLogged: orNull(ctx.checkLogged),
    },
  };
  const fileError = sink.fileError();
  if (fileError !== null) event.eventsFileError = fileError;
  return event;
}

// Lets the event loop deliver a pending signal before the next step: every step before the
// worker makes only synchronous calls, and an await that settles on microtasks alone never
// turns the loop, so without this a SIGINT during the claim would wait for the worker.
function yieldToEventLoop() {
  return new Promise((resolve) => { setImmediate(resolve); });
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
    if (ctx.runDir) sink.bindRunDir(ctx.runDir);
    const extra = Number.isFinite(ctx.ciWaitStartedAt) ? { ciWaitMs: Math.max(0, deps.now() - ctx.ciWaitStartedAt) } : {};
    const result = { status: 'fail', detail, halt: true, stopClass: interruptClass(ctx), reason: 'fail', extra };
    sink.emit(eventFor(ctx, step.name, result, ms, deps));
    current.final = finalEvent(ctx, { name: step.name, result }, sink, deps.now() - current.started, deps);
    sink.emit(current.final);
  } finally {
    deps.terminate(shared.interrupted);
  }
}

// One record through the table; returns its final event (null when an interrupt landed
// before its first step). `steps` is a test seam.
async function driveRecord(record, shared, deps, steps = STEPS) {
  const sink = createEventSink({ stdout: deps.stdout, appendFile: deps.appendFile });
  const ctx = newCtx(record, shared);
  const current = { ctx, sink, started: null, step: null, inStep: false, stepStarted: null, final: null };
  shared.current = current;
  try {
    const started = deps.now();
    current.started = started;
    let bound = false;
    let stop = null;
    for (const step of steps) {
      await yieldToEventLoop();
      if (shared.interrupted) {
        // Before the first step the handler has already terminated; after one, the
        // interrupt is reported at the step about to start.
        if (current.step !== null) {
          reportInterrupt(shared, current, step, `interrupted by ${shared.interrupted} before ${step.name}`, 0, deps);
        }
        return current.final;
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
      if (shared.interrupted) return current.final;
      const ms = deps.now() - t0;
      if (!bound && ctx.runDir) {
        sink.bindRunDir(ctx.runDir);
        bound = true;
      }
      sink.emit(eventFor(ctx, step.name, result, ms, deps));
      if (result.halt) {
        stop = { name: step.name, result };
        break;
      }
    }
    const final = finalEvent(ctx, stop, sink, deps.now() - started, deps);
    sink.emit(final);
    return final;
  } finally {
    shared.current = null;
  }
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
  const shared = newShared();
  const unsubscribe = deps.onSignal((signal) => interrupt(shared, signal, deps));
  try {
    for (const record of parsed.records) {
      await driveRecord(record, shared, deps);
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
  // `gh pr create` writes to GitHub and takes longer than a read, so it gets the batched bound too.
  ghCreate: (args) => execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: sharedPrimitives.GH_BATCH_TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true,
  })),
  // The shared git bounds, read at call time (env, then policy, then the default): a call that
  // writes to the remote passes `remoteWrite: true` for GIT_PUSH_TIMEOUT_MS, every other call
  // gets GIT_TIMEOUT_MS.
  git: (args, { cwd, remoteWrite } = {}) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: remoteWrite === true ? sharedPrimitives.GIT_PUSH_TIMEOUT_MS : sharedPrimitives.GIT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER, windowsHide: true,
  }),
  // A plugin/bin CLI under this Node; never throws on a non-zero exit.
  // The child gets the env the caller passes (steps pass deps.env); a call that omits `env`
  // falls back to process.env.
  node: (script, args, { cwd, timeout, env = process.env } = {}) => {
    const r = spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8', timeout, maxBuffer: MAX_BUFFER, windowsHide: true });
    const stderr = r.stderr || '';
    return { code: r.status, stdout: r.stdout || '', stderr: r.error ? `${stderr}${r.error.message}\n` : stderr };
  },
  resolvePolicy: (keys) => defaultResolvePolicy(keys),
  evaluateRecordEligibility: (issue, opts) => require('../express/eligibility').evaluateRecordEligibility(issue, opts),
  evaluateAdmission: (input) => require('./admission').evaluateAdmission(input),
  fetchNativeDependencies: (opts) => require('../issues/native-dependencies').fetchNativeDependencies(opts),
  fetchLinkedPRs: (opts) => require('../issues/linked-prs').fetchLinkedPRs(opts),
  launchWorker: (opts, d) => require('./worker').launchWorker(opts, d),
  runner: (call) => require('./worker').defaultRunner(call),
  resolveRunDir: (opts) => require('../hooks/run-dir-resolve').resolve(opts),
  lstatType: (p) => lstatType(p),
  readdir: (p) => fs.readdirSync(p),
  writeFile: (p, s) => fs.writeFileSync(p, s),
  appendFile: (p, s) => fs.appendFileSync(p, s),
  mkdirSync: (p, opts) => fs.mkdirSync(p, opts),
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

module.exports = { run, parseArgs, USAGE, realDeps, driveRecord, newShared, interruptClass, reraiseAfterFlush };
