// bin/lib/timing/at-close.js — write a run's timing.json when the run closes (#5555).
//
// Every closing path calls this module in-process: hooks.js close-run and
// teardown-run, the reconciler's archiveRunDir (writePhaseTimingSync, which
// never reads a transcript), and bin/timing-at-close.js (the background token
// pass spawnTokenPass starts). Token totals come from the run's own transcript —
// {configDir}/projects/{slug of the run's worktree}/{sessionId}.jsonl (a non-dispatched run with none
// there: the slug of the checkout holding its run dir), never a newest-candidate pick — and, for a `dispatched: true` run, also from the depth-1 Task-call transcripts of its
// dispatching and resuming sessions whose dispatch prompt names exactly this run (#5647;
// transcript.js locateTaskTranscripts, a session-id lookup across every slug); its `dispatches`
// view is then scoped per subagents directory (run-timing.js scopeDirItems): the attributed Task
// calls are dropped (their rows are in the totals), the own-slug directory keeps its window view,
// a directory reached only through Task calls keeps just their descendants. Known
// edge: a resuming session's depth-1 agents that do not name the run, and the resumer's main rows
// when its transcript is not under the own slug, are not counted.
// A timing.json that already has token totals is kept byte-identical; a
// spec-N child of a multi-record run is never written (the parent's file
// covers the whole run). Token rows are clipped to the run's own lifetime
// (creation through close), so two runs of one session transcript never share
// them. The read-check-write runs under the run dir's .timing.lock; a run dir a
// concurrent archive moved away is followed to its archive twin, never
// recreated. The close also fills the run's manifest.json (#6009): closedAt and minutes on every
// closing path, the list-price cost group on the token paths (a kept close upgrades a partial or
// null-cost stored group, never rewrites timing.json). Nothing here throws: a failure is one SKIP line in the run's
// decisions.md (_shared/auto-decision-log.md's Degrade-trace rule).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lstatType } = require('../path-guard');
const { derivePhaseTiming, deriveTiming, hasTokenTotals, writeTimingFile, readEvents } = require('./run-timing');
const { fillRunManifest, MANIFEST_FILE } = require('../run-manifest/write');
const { costRowsFrom, deriveRunCost } = require('../run-manifest/cost');
const { priorWorktree } = require('../run-state-worktree');
const { acquireLock, releaseLock } = require('../file-lock');
const timingSkip = require('../log-decision/timing-skip');

// The one time bound on a close's transcript reads (ms). Spec #5555 Deliverable 6 caps the whole
// timing step at half the driver's 120 s close-run limit (lib/driver/merge.js, settle.js): raise it
// only together with that limit.
const TIMING_BOUND_MS = 60000;
// How long the synchronous phase-rows-only write waits for .timing.lock (ms). That write reads no
// transcript and holds the lock for milliseconds, so it never borrows the transcript bound.
// (Read through module.exports at call time, like TIMING_BOUND_MS, so a test can shorten it.)
const PHASE_LOCK_WAIT_MS = 2000;
// The cap on a kept close's cost re-derive (ms), inside the close deadline: the re-derive shares that
// deadline with finish's step-yield write, so an uncapped re-derive could spend the yield's time. The
// trade-off: a kept re-derive that needs longer than the cap fills no cost this close (the stored group
// stays partial; a later close retries), where an uncapped one would finish and drop the yield.
// (Read through module.exports at call time, like TIMING_BOUND_MS, so a test can shorten it.)
const KEPT_COST_BOUND_MS = 15000;

const PHASE_ONLY = 'timing.json phase rows written without token totals';
const NOTHING_WRITTEN = 'no timing.json written';

// One SKIP line in a run dir's decisions.md (log-decision/timing-skip.js, shared with the closing
// paths' own fallback catch); a run dir that is not a directory gets none.
const { errText, logTimingSkip } = timingSkip;

// runDir -> the checkout it lives under ({root}/.claude-tweaks/pipelines/{id}, or its archive twin
// .../pipelines/archive/{id}), else null.
function runRootOf(runDir) {
  let p = path.dirname(path.resolve(runDir));
  if (path.basename(p) === 'archive') p = path.dirname(p);
  if (path.basename(p) !== 'pipelines' || path.basename(path.dirname(p)) !== '.claude-tweaks') return null;
  return path.dirname(path.dirname(p));
}

// runState, { env, homeDir, runId, runRoot } -> { paths, taskCalls, reason }. paths: the own-slug
// transcript (if found) followed by taskCalls, the attributed Task-call transcripts (#5647):
// only for a `dispatched === true` run and a string runId, else []. reason is null when paths is non-empty.
// A non-dispatched run whose own slug has no {sid}.jsonl falls back to the slug of runRoot: a
// worktree-always /flow starts in the main checkout and enters its worktree, so its transcript stays
// under the launch slug (#5647 ledger row 1). Another worktree's slug is never read (AC9.2).
// homeDir (a function) is called only when env has no CLAUDE_CONFIG_DIR.
// Guard -> test (tests/bin-lib/timing/at-close.test.js): the `dispatched === true` check is
// decided by "AC1.1 gate"; the `typeof runId === 'string'` check by "AC1.1 runId guard"; the run-root
// fallback by "run root: a non-dispatched run ...".
function ownTranscripts(runState, { env = {}, homeDir = os.homedir, runId, runRoot = null } = {}) {
  try {
    const rs = runState && typeof runState === 'object' ? runState : {};
    const worktree = priorWorktree(rs);
    const sid = rs.sessionId;
    const dispatched = rs.dispatched === true && typeof runId === 'string';
    // Only the own-slug lookup needs a worktree and a sessionId; a dispatched run's Task-call lookup keys on session ids alone.
    let missing = null;
    if (!worktree) missing = 'no worktree or worktreeAtClose in run-state.json';
    else if (typeof sid !== 'string') missing = 'no sessionId in run-state.json';
    if (missing && !dispatched) return { paths: [], taskCalls: [], reason: missing };
    const configDir = (env && env.CLAUDE_CONFIG_DIR) || path.join(homeDir(), '.claude');
    // Looked up at call time so a test can stub it.
    const transcript = require('./transcript');
    const found = missing ? [] : transcript.locateTranscripts({ cwd: worktree, sessionId: sid, homeDir: null, configDir });
    const tryRoot = !found.length && !missing && !dispatched && typeof runRoot === 'string' && path.resolve(runRoot) !== path.resolve(worktree);
    const atRoot = tryRoot ? transcript.locateTranscripts({ cwd: runRoot, sessionId: sid, homeDir: null, configDir }) : [];
    const own = [...found, ...atRoot].slice(0, 1).map((t) => t.path);
    const sessionIds = [...new Set([rs.dispatchSessionId, rs.sessionId].filter((v) => typeof v === 'string'))];
    const task = dispatched ? transcript.locateTaskTranscripts({ sessionIds, runId, configDir }) : { paths: [], notes: [] };
    const paths = [...own, ...task.paths];
    if (paths.length) return { paths, taskCalls: task.paths, reason: null };
    const base = missing || `no ${sid}.jsonl under the slug of ${worktree}${tryRoot ? ` or of its run root ${runRoot}` : ''}`;
    if (!dispatched) return { paths: [], taskCalls: [], reason: base };
    if (!sessionIds.length) return { paths: [], taskCalls: [], reason: `${base}, and no dispatchSessionId or sessionId in run-state.json to look up Task-call transcripts of run ${runId}` };
    const notes = task.notes.length ? ` (${task.notes.join('; ')})` : '';
    return { paths: [], taskCalls: [], reason: `${base}, and no Task-call transcript of session(s) ${sessionIds.join(', ')} names run ${runId}${notes}` };
  } catch (err) {
    return { paths: [], taskCalls: [], reason: `transcript lookup failed (${errText(err)})` };
  }
}

// A multi-record run's spec-N child: its parent holds the run's own state.
function isSpecChildDir(runDir) {
  try {
    if (!/^spec-\d+$/.test(path.basename(runDir))) return false;
    const parent = path.dirname(runDir);
    return ['run-state.json', 'config.yml', 'manifest.yml'].some((f) => lstatType(path.join(parent, f)).type !== 'missing');
  } catch {
    return false;
  }
}

// The run dir's timing.json, parsed: null when absent (no file there to protect: ENOENT, or a
// directory / non-directory path component in its place) or not JSON (a corrupt file is replaced).
// Any other read failure (EACCES, EIO) throws — a file whose content is unknown is never
// overwritten on a guess, so a file that has token totals stays byte-identical.
function readExisting(runDir) {
  let text;
  try {
    text = fs.readFileSync(path.join(runDir, 'timing.json'), 'utf8');
  } catch (err) {
    if (err && ['ENOENT', 'EISDIR', 'ENOTDIR'].includes(err.code)) return null;
    throw err;
  }
  try { return JSON.parse(text); } catch { return null; }
}

const isDir = (p) => lstatType(p).type === 'directory';

// The steps both writers share before any transcript is read:
// -> { done: result } when nothing more is to be done, else { base }.
function prepare(runDir) {
  if (!isDir(runDir)) return { done: { status: 'failed', tokens: false, skip: `condition: run dir is missing or not a directory → fallback: ${NOTHING_WRITTEN}` } };
  if (isSpecChildDir(runDir)) return { done: { status: 'not-top-level', tokens: false, skip: null } };
  if (hasTokenTotals(readExisting(runDir))) return { done: { status: 'kept', tokens: true, skip: null } };
  const base = derivePhaseTiming(runDir);
  if (!base.ok) return { done: { status: 'failed', tokens: false, skip: `condition: timing could not be derived (${base.error}) → fallback: ${NOTHING_WRITTEN}` } };
  return { base };
}

// Where the reconciler's archive moves a run dir: {pipelines}/archive/{run-id}.
const archiveTwin = (runDir) => path.join(path.dirname(runDir), 'archive', path.basename(runDir));
const LOCK_NAME = '.timing.lock';

const vanished = () => ({ vanished: true });

// The lock protocol both writers share: one read-check-write in dir, under dir's timing lock, so a
// concurrent writer (a token pass, a second closer) never has its file overwritten between the check
// and the rename. The lock is waited for only until deadlineAt and never longer than capMs; a lock not
// acquired in time is onMiss(waitMs)'s result. The lock never creates dir. needRunState (the run had a
// run-state.json when derived): a dir whose run-state.json is gone is being archived — its entries are
// moving to the twin, and a file written now would strand in it after the straggler sweep — so it
// counts as vanished, checked once under the lock before body runs and handed to body as vacated() for
// a re-check right before its write. -> body's result, or { vanished: true } when dir is gone or vacated.
function underTimingLock(dir, { deadlineAt, capMs, needRunState, onMiss }, body) {
  if (!isDir(dir)) return vanished();
  const waitMs = Math.max(0, Math.floor(Math.min(capMs, deadlineAt - Date.now())));
  const held = acquireLock(path.join(dir, LOCK_NAME), { waitMs, env: {}, createParent: false });
  if (!held) return isDir(dir) ? onMiss(waitMs) : vanished();
  const vacated = () => needRunState && lstatType(path.join(dir, 'run-state.json')).type === 'missing';
  try {
    if (vacated()) return vanished();
    return body(vacated);
  } finally {
    releaseLock(held);
    // An archive's per-entry move can carry this lock dir to the twin, where the
    // release above misses it: compare-and-delete it there too (the token is ours alone).
    releaseLock({ lockPath: path.join(archiveTwin(dir), LOCK_NAME), token: held.token });
  }
}

// fn() is a write into dir. -> null when it succeeded; { vanished: true } when it failed because dir is
// gone; else onFail(err)'s result (by default the error is rethrown).
function writeUnlessGone(dir, fn, onFail = (err) => { throw err; }) {
  try {
    fn();
    return null;
  } catch (err) {
    return isDir(dir) ? onFail(err) : vanished();
  }
}

// timing.json's read-check-write in dir -> a result, or { vanished: true } when dir is gone. A lock not
// acquired in time is a failed result carrying its SKIP.
function writeIn(dir, timing, skip, deadlineAt, needRunState) {
  const withTokens = hasTokenTotals(timing);
  const onMiss = (waitMs) => ({ status: 'failed', tokens: false, skip: `condition: timing.json lock not acquired within ${waitMs} ms → fallback: ${NOTHING_WRITTEN}` });
  return underTimingLock(dir, { deadlineAt, capMs: TIMING_BOUND_MS, needRunState, onMiss }, () => {
    // A timing with no token totals never replaces a file that gained them while
    // this call derived (a concurrent token pass).
    if (!withTokens && hasTokenTotals(readExisting(dir))) return { status: 'kept', tokens: true, skip: null };
    const failed = writeUnlessGone(dir, () => writeTimingFile(dir, timing),
      (err) => ({ status: 'failed', tokens: false, skip: `condition: timing.json write failed (${errText(err)}) → fallback: ${NOTHING_WRITTEN}` }));
    return failed || { status: 'written', tokens: withTokens, skip };
  });
}

// timing, pending skip, deadline -> { dir, result }: dir is where the result's SKIP
// belongs. A write failure replaces the pending skip. When the run dir vanished
// (a concurrent archive moved it), the write is retried once at its archive twin.
function write(runDir, timing, skip, deadlineAt, needRunState) {
  const r = writeIn(runDir, timing, skip, deadlineAt, needRunState);
  if (!r.vanished) return { dir: runDir, result: r };
  const twin = archiveTwin(runDir);
  const t = writeIn(twin, { ...timing, runDir: twin }, skip, deadlineAt, needRunState);
  if (!t.vanished) return { dir: twin, result: t };
  return { dir: twin, result: { status: 'failed', tokens: false, skip: `condition: run dir and its archive twin are gone → fallback: ${NOTHING_WRITTEN}` } };
}

// The manifest at dir, parsed: null when absent or not JSON (the fill reports an unusable file itself).
function readManifestOrNull(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')); } catch { return null; }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const stampOf = (e) => Date.parse(e && e.ts);
const liveEvents = (events) => (Array.isArray(events) ? events : []).filter((e) => e && e.type !== 'worktree-reaped' && Number.isFinite(stampOf(e)));

// closedAt, in the spec's order: run-state.json's updatedAt once its status is clean, else the last
// event ts (worktree-reaped aside), else null. Never the clock.
function closedAtOf(runState, events) {
  if (isObj(runState) && runState.status === 'clean' && typeof runState.updatedAt === 'string' && Number.isFinite(Date.parse(runState.updatedAt))) return runState.updatedAt;
  const live = liveEvents(events);
  if (!live.length) return null;
  return live.reduce((a, b) => (stampOf(b) > stampOf(a) ? b : a)).ts;
}

// The run's start for `minutes`: the manifest's createdAt when the mint wrote it, else the first event.
function runStartAtOf(manifest, runState, events) {
  const m = isObj(manifest) ? manifest : null;
  const mintFacts = m && ['pluginVersion', 'policyHash', 'baseCommit'].some((k) => m[k] != null);
  if (m && typeof m.createdAt === 'string') {
    const created = Date.parse(m.createdAt);
    const rsCreated = isObj(runState) && typeof runState.createdAt === 'string' ? Date.parse(runState.createdAt) : NaN;
    if (Number.isFinite(created) && (mintFacts || (Number.isFinite(rsCreated) && Math.abs(created - rsCreated) <= 60000))) return m.createdAt;
  }
  const live = liveEvents(events);
  if (!live.length) return null;
  return live.reduce((a, b) => (stampOf(b) < stampOf(a) ? b : a)).ts;
}

// One fill of dir's manifest.json after a close (#6009): closedAt and minutes always, the cost group
// when withCost. base is a derivePhaseTiming result (its events and runState are the close's own),
// costRows deriveTiming's. A spec-N child gets none. Every throw is one stderr line; nothing here
// changes the close's result.
function fillManifestAtClose(dir, { base, costRows = null, withCost = false } = {}) {
  try {
    if (isSpecChildDir(dir)) return;
    const manifest = readManifestOrNull(dir);
    const events = base.events;
    const closedAt = closedAtOf(base.runState, events);
    const runStartAt = runStartAtOf(manifest, base.runState, events);
    const driver = isObj(manifest) && manifest.lane === 'driver';
    const input = { manifest, closedAt, runStartAt };
    if (withCost) {
      if (driver) input.events = readEvents(path.join(dir, 'driver-events.jsonl')).events || [];
      else Object.assign(input, costRowsFrom(costRows));
    }
    const r = deriveRunCost(input);
    const fields = { closedAt: r.closedAt, minutes: r.minutes };
    if (withCost) fields.cost = { tokensByModel: r.tokensByModel, costUsd: r.costUsd, priceDate: r.priceDate, unpricedModels: r.unpricedModels, costPartial: r.costPartial };
    fillRunManifest(dir, fields);
  } catch (err) {
    try { process.stderr.write(`claude-tweaks: run-manifest: ${errText(err)}\n`); } catch { /* never break a close */ }
  }
}

// A transcript-backed cost derive that writes no timing.json: -> { costRows, deadlineHit } (the kept
// close's re-derive). Resolved through module.exports so a test can count its calls.
async function deriveCloseCost(dir, base, own, { deadlineAt }) {
  const d = await deriveTiming(dir, {
    transcriptPaths: own.paths, wantTokens: own.paths.length > 0, cwd: dir, deadlineAt, base, clipToRunWindow: true, scopeDispatchesTo: own.taskCalls,
  });
  if (!d.ok) return { costRows: null, deadlineHit: false };
  return { costRows: d.costRows, deadlineHit: d.deadlineHit };
}

// A close that found timing.json already carrying token totals (token path): the manifest's times are
// filled fill-only-null; its cost group is re-derived only while the stored one is partial or null.
async function fillKeptManifest(dir, { env, homeDir, deadlineAt }) {
  try {
    const base = derivePhaseTiming(dir);
    if (!base.ok) return;
    const stored = readManifestOrNull(dir);
    const complete = isObj(stored) && stored.costPartial === false && typeof stored.costUsd === 'number';
    if (complete) return fillManifestAtClose(dir, { base });
    // Not deadline-gated: the driver lane's cost reads only the local driver-events.jsonl.
    if (isObj(stored) && stored.lane === 'driver') return fillManifestAtClose(dir, { base, withCost: true });
    const own = ownTranscripts(base.runState, { env, homeDir, runId: path.basename(dir), runRoot: runRootOf(dir) });
    if (!own.paths.length) return fillManifestAtClose(dir, { base });
    const costDeadlineAt = Math.min(deadlineAt, Date.now() + module.exports.KEPT_COST_BOUND_MS);
    const c = await module.exports.deriveCloseCost(dir, base, own, { deadlineAt: costDeadlineAt });
    const withCost = !c.deadlineHit && c.costRows !== null;
    fillManifestAtClose(dir, { base, costRows: c.costRows, withCost });
  } catch (err) {
    try { process.stderr.write(`claude-tweaks: run-manifest: ${errText(err)}\n`); } catch { /* never break a close */ }
  }
}

const NO_YIELD = 'no step-yield.json written';
const YIELD_GONE = `condition: run dir and its archive twin are gone → fallback: ${NO_YIELD}`;
const isArchivedDir = (d) => path.basename(path.dirname(d)) === 'archive';

// One derive-and-write of the yield in dir, under dir's timing lock (the one the timing.json write
// takes), so a yield is never derived from a timing.json that a concurrent token pass is about to
// replace and then written after it. The lock is waited for PHASE_LOCK_WAIT_MS at most, never past
// the close deadline; a lock not acquired in time is a skipped result carrying its SKIP text (and
// bound:true when the wait spent the close's whole bound, which finish names as the bound).
// -> a result, or { vanished: true } when dir is gone or being vacated.
function writeYieldIn(dir, deadlineAt, needRunState) {
  const onMiss = (waitMs) => ({
    status: 'skipped', skip: `condition: step-yield.json lock not acquired within ${waitMs} ms → fallback: ${NO_YIELD}`, fold: true,
    ...(Date.now() >= deadlineAt ? { bound: true } : {}),
  });
  return underTimingLock(dir, { deadlineAt, capMs: module.exports.PHASE_LOCK_WAIT_MS, needRunState, onMiss }, (vacated) => {
    const sy = require('./step-yield');
    const yieldObj = sy.deriveStepYield(dir);
    if (vacated()) return vanished();
    return writeUnlessGone(dir, () => sy.writeStepYield(dir, yieldObj)) || { status: 'written', skip: null };
  });
}

// dir, { deadlineAt } -> { status: 'written'|'skipped'|'failed', skip, fold? }: step-yield.json, derived
// whole from the run dir and written temp-then-rename, never into a dir that is not there or being
// vacated (a run dir gone is retried once at its archive twin, never recreated). A close already
// past its deadline derives nothing. Never throws. Every failed or skipped result carries its SKIP text
// in `skip` and fold:true: with logBound (the default) this function logs it as one SKIP line itself;
// with logBound false the caller (finish) folds it into the close's one SKIP line. step-yield.js is
// resolved through require at call time so a test can stub it.
function writeStepYieldSafe(dir, { boundMs = module.exports.TIMING_BOUND_MS, deadlineAt = Date.now() + boundMs, logBound = true } = {}) {
  let target = isArchivedDir(dir) || isDir(dir) ? dir : archiveTwin(dir);
  const settle = (r) => {
    if (logBound) logTimingSkip(target, r.skip);
    return r;
  };
  try {
    const boundSkip = `condition: close passed the ${boundMs} ms time bound before the step yield was derived → fallback: ${NO_YIELD}`;
    if (Date.now() >= deadlineAt) return settle({ status: 'failed', skip: boundSkip, fold: true, bound: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!isDir(target)) return settle({ status: 'failed', skip: YIELD_GONE, fold: true });
      const needRunState = lstatType(path.join(target, 'run-state.json')).type !== 'missing';
      const r = writeYieldIn(target, deadlineAt, needRunState);
      if (!r.vanished) return r.fold ? settle(r.bound ? { ...r, skip: boundSkip } : r) : r;
      // The dir vanished under the write (an archive moved it): follow it once.
      if (attempt === 0 && !isArchivedDir(target)) { target = archiveTwin(target); continue; }
      break;
    }
    return settle({ status: 'failed', skip: YIELD_GONE, fold: true });
  } catch (err) {
    return settle({ status: 'failed', skip: `condition: step yield could not be written (${errText(err)}) → fallback: ${NO_YIELD}`, fold: true });
  }
}

// Every result a close settles on ends here: its SKIP, then the step yield — read from the run dir
// after the timing write, so it sees the fresh timing.json (a kept one included: its persisted
// questions re-derive the wait times). A spec-N child gets none, like timing.json. deadlineAt is
// the close's own time bound (TIMING_BOUND_MS from its start): the yield is written inside it.
function finish(runDir, result, { deadlineAt, boundMs }) {
  // One close logs at most one timing-family SKIP line. The yield runs first (logBound false) so a
  // yield that was not written (the bound, a lock miss, a derive or write that threw) is named in
  // that one line: appended to the timing SKIP, or its own when the timing write logged none. The
  // bound is appended as the bare `no step-yield.json written` (the timing SKIP already names it);
  // any other cause is appended whole.
  const y = result.status !== 'not-top-level' ? module.exports.writeStepYieldSafe(runDir, { deadlineAt, boundMs, logBound: false }) : null;
  const folded = y && y.fold ? y : null;
  if (result.skip) logTimingSkip(runDir, folded ? `${result.skip}; ${folded.bound ? NO_YIELD : folded.skip}` : result.skip);
  else if (folded) logTimingSkip(runDir, folded.skip);
  return result;
}

// runDir -> { status, skip }: phase rows only, synchronous, no transcript read.
function writePhaseTimingSync(runDir) {
  const boundMs = module.exports.TIMING_BOUND_MS;
  const closeDeadlineAt = Date.now() + boundMs;
  let dir = runDir;
  let result;
  let filled = null;
  try {
    const p = prepare(runDir);
    if (p.done) result = p.done;
    else {
      filled = p.base;
      ({ dir, result } = write(runDir, p.base.timing, null, Date.now() + module.exports.PHASE_LOCK_WAIT_MS, p.base.runState !== null));
    }
  } catch (err) {
    result = { status: 'failed', tokens: false, skip: `condition: timing at close failed (${errText(err)}) → fallback: ${NOTHING_WRITTEN}` };
  }
  if (result.status === 'written' && filled) fillManifestAtClose(dir, { base: filled });
  else if (result.status === 'kept') {
    // A kept close reads no transcript: its times are filled from a fresh derive (fill-only-null).
    try { const fresh = derivePhaseTiming(dir); if (fresh.ok) fillManifestAtClose(dir, { base: fresh }); } catch { /* best-effort */ }
  }
  finish(dir, result, { deadlineAt: closeDeadlineAt, boundMs });
  return { status: result.status, skip: result.skip };
}

// runDir, opts -> Promise<{ status: 'written'|'kept'|'not-top-level'|'failed', tokens, skip }>. Never rejects.
async function writeTimingAtClose(runDir, { tokens = true, env = {}, homeDir = os.homedir, boundMs } = {}) {
  if (!tokens) {
    const r = writePhaseTimingSync(runDir);
    return { status: r.status, tokens: false, skip: r.skip };
  }
  // One deadline for the whole close, the transcript read and the yield alike (the named bound).
  const closeBoundMs = boundMs ?? module.exports.TIMING_BOUND_MS;
  const closeDeadlineAt = Date.now() + closeBoundMs;
  let dir = runDir;
  let result;
  let base = null;
  let fill = null;
  try {
    const p = prepare(runDir);
    if (p.done) {
      result = p.done;
    } else {
      base = p.base;
      const own = ownTranscripts(p.base.runState, { env, homeDir, runId: path.basename(runDir), runRoot: runRootOf(runDir) });
      const bound = boundMs ?? module.exports.TIMING_BOUND_MS;
      const deadlineAt = Date.now() + bound;
      const d = await deriveTiming(runDir, {
        transcriptPaths: own.paths, wantTokens: own.paths.length > 0, cwd: runDir, deadlineAt, base: p.base, clipToRunWindow: true, scopeDispatchesTo: own.taskCalls,
      });
      if (!d.ok) {
        result = { status: 'failed', tokens: false, skip: `condition: timing could not be derived (${d.error}) → fallback: ${NOTHING_WRITTEN}` };
      } else {
        let skip = null;
        if (own.reason) skip = `condition: ${own.reason} → fallback: ${PHASE_ONLY}`;
        else if (d.deadlineHit) skip = `condition: transcript read passed the ${bound} ms time bound → fallback: ${PHASE_ONLY}`;
        else if (!hasTokenTotals(d.timing)) skip = `condition: ${own.taskCalls.length ? 'own and Task-call transcripts' : 'own transcript'} yielded no token totals (${d.notes.length ? d.notes.join('; ') : 'no usage tokens'}) → fallback: ${PHASE_ONLY}`;
        ({ dir, result } = write(runDir, d.timing, skip, deadlineAt, p.base.runState !== null));
        const stored = readManifestOrNull(dir);
        fill = { base: p.base, costRows: d.costRows || null, withCost: hasTokenTotals(d.timing) || (isObj(stored) && stored.lane === 'driver') };
      }
    }
  } catch (err) {
    const failed = `condition: timing at close failed (${errText(err)}) → fallback: `;
    result = { status: 'failed', tokens: false, skip: `${failed}${NOTHING_WRITTEN}` };
    // A throw after the phase rows were derived (token derivation, a transcript row nothing
    // expected) still leaves those rows worth a file. A write that fails here too keeps the result above.
    if (base) {
      try {
        ({ dir, result } = write(runDir, base.timing, `${failed}${PHASE_ONLY}`, Date.now() + module.exports.PHASE_LOCK_WAIT_MS, base.runState !== null));
        // The phase rows landed: the manifest's times (never its cost, nothing was priced) follow.
        if (result.status === 'written') fill = { base };
      } catch { /* the failed result above stands */ }
    }
  }
  if (result.status === 'written' && fill) fillManifestAtClose(dir, fill);
  else if (result.status === 'kept') await fillKeptManifest(dir, { env, homeDir, deadlineAt: closeDeadlineAt });
  return finish(dir, result, { deadlineAt: closeDeadlineAt, boundMs: closeBoundMs });
}

// Same as writeTimingAtClose, and a throw out of it (a stub, a defect) is one SKIP line too: the
// in-process closing verbs call this, so a close never fails on timing. Resolved through
// module.exports at call time, like TIMING_BOUND_MS, so a test can stub the writer.
async function writeTimingAtCloseSafe(runDir, opts) {
  try {
    return await module.exports.writeTimingAtClose(runDir, opts);
  } catch (err) {
    logTimingSkip(runDir, `condition: timing at close failed (${errText(err)}) → fallback: ${NOTHING_WRITTEN}`);
    return { status: 'failed', tokens: false, skip: null };
  }
}

// runDir, { env } -> { spawned, reason }: starts bin/timing-at-close.js detached, so a
// close never waits on a transcript read. env (optional) is the child's environment;
// without it the child inherits this process's. The child starts in the run dir's parent (inside the main checkout, so
// its anchoring check resolves the main checkout whatever this process's cwd is). A spawn that fails asynchronously
// (ENOENT/EACCES are emitted, not thrown) logs the same SKIP from its 'error' listener.
function spawnTokenPass(runDir, { env } = {}) {
  const cannotStart = (reason) => logTimingSkip(runDir, `condition: background token pass could not start (${reason}) → fallback: timing.json keeps its phase rows without token totals`);
  try {
    const cli = path.join(__dirname, '..', '..', 'timing-at-close.js');
    const child = require('child_process').spawn(process.execPath, [cli, '--run', runDir], { detached: true, stdio: 'ignore', windowsHide: true, cwd: path.dirname(runDir), ...(env ? { env } : {}) });
    child.on('error', (err) => cannotStart(errText(err)));
    child.unref();
    return { spawned: true, reason: 'started' };
  } catch (err) {
    const reason = errText(err);
    cannotStart(reason);
    return { spawned: false, reason };
  }
}

module.exports = { TIMING_BOUND_MS, KEPT_COST_BOUND_MS, PHASE_LOCK_WAIT_MS, ownTranscripts, deriveCloseCost, isSpecChildDir, writeTimingAtClose, writeTimingAtCloseSafe, writePhaseTimingSync, writeStepYieldSafe, logTimingSkip, spawnTokenPass };
