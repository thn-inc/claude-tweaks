'use strict';
// The pipeline driver's run loop (drive.js, record #5218): run(argv, deps) parses the
// record references, probes gh and git, then walks steps.js's STEPS table once per named
// record, in order. The loop owns only event emission and stop handling between steps:
// it names no step, so adding a step is a table entry, never a change here.
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
// once through deps.onSignal and unsubscribes before it resolves. On SIGINT or SIGTERM the
// handler, for the record being driven (shared.current): signals the running worker's
// handle (shared.activeWorker, whose kill reaches the worker's process group on POSIX),
// emits a `fail` event for the running step with detail `interrupted by {signal}`, emits
// the record's final line with that step's own stop class (ctx.currentStopClass, which
// defineStep records), and then calls deps.terminate(signal). With no record running it
// only calls terminate. Nothing further is driven or emitted after an interrupt.
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
const GIT_TIMEOUT_MS = 120000;
const GIT_PROBE_TIMEOUT_MS = 10000;
const MAX_BUFFER = 64 * 1024 * 1024;

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

// `current` is the record being driven, `{ ctx, sink, started, stepStarted, final }`, set
// for the length of one driveRecord and cleared after it, so a signal handler can reach
// that record's context, event sink and clocks, and leave the final line it wrote in
// `final`. `interrupted` is set once by that handler.
function newShared() {
  return { policy: null, ref: null, mainRoot: null, repo: null, fatal: false, activeWorker: null, current: null, interrupted: false };
}

function newCtx(record, shared) {
  return {
    record, runId: null, runDir: null, wt: null, branch: null,
    created: { worktree: false, branch: false }, pushed: false,
    pr: null, ci: null, checkLogged: undefined, worker: null,
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
    ci: orNull(ctx.ci),
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

// One record through the table; returns its final event. `steps` is a test seam.
async function driveRecord(record, shared, deps, steps = STEPS) {
  const sink = createEventSink({ stdout: deps.stdout, appendFile: deps.appendFile });
  const ctx = newCtx(record, shared);
  const current = { ctx, sink, started: null, stepStarted: null, final: null };
  shared.current = current;
  try {
    const started = deps.now();
    current.started = started;
    let bound = false;
    let stop = null;
    for (const step of steps) {
      const t0 = deps.now();
      current.stepStarted = t0;
      const result = await step.run(ctx, deps);
      // The interrupt handler already wrote this record's stop and final line.
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

// The signal handler run() subscribes (see the header's Interrupts paragraph). It never
// throws past terminate: whatever the emission does, the process still ends by the signal.
function interrupt(shared, signal, deps) {
  const { current } = shared;
  try {
    if (!current || shared.interrupted || !current.ctx.currentStep) return;
    shared.interrupted = true;
    const { ctx, sink } = current;
    const worker = shared.activeWorker;
    if (worker) {
      try {
        worker.kill('SIGTERM');
      } catch {
        // The worker is already gone.
      }
    }
    // A step that set ctx.runDir has not had its sink bound yet; binding twice is harmless.
    if (ctx.runDir) sink.bindRunDir(ctx.runDir);
    const name = ctx.currentStep;
    const result = { status: 'fail', detail: `interrupted by ${signal}`, halt: true, stopClass: ctx.currentStopClass, reason: 'fail', extra: {} };
    sink.emit(eventFor(ctx, name, result, deps.now() - current.stepStarted, deps));
    current.final = finalEvent(ctx, { name, result }, sink, deps.now() - current.started, deps);
    sink.emit(current.final);
  } finally {
    deps.terminate(signal);
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
      if (shared.fatal) return 1;
      // The process ends by the signal (deps.terminate); this only keeps a slow re-raise
      // from driving another record.
      if (shared.interrupted) break;
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
  git: (args, { cwd } = {}) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, windowsHide: true,
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
  // Drops the subscription, then re-raises the signal so the process ends by it.
  terminate: (sig) => {
    if (unsubscribeSignals) unsubscribeSignals();
    process.kill(process.pid, sig);
  },
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  ghAvailable: () => ghAvailable(),
  gitAvailable: () => {
    try {
      execFileSync('git', ['--version'], { stdio: 'ignore', timeout: GIT_PROBE_TIMEOUT_MS, windowsHide: true });
      return true;
    } catch {
      return false;
    }
  },
  remoteUrl: () => remoteUrl(),
};

module.exports = { run, parseArgs, USAGE, realDeps, driveRecord, newShared };
