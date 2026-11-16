// bin/lib/timing/at-close.js — write a run's timing.json when the run closes (#5555).
//
// Every closing path calls this module in-process: hooks.js close-run and
// teardown-run, the reconciler's archiveRunDir (writePhaseTimingSync, which
// never reads a transcript), and bin/timing-at-close.js (the background token
// pass spawnTokenPass starts). Token totals come only from the run's own
// transcript — {configDir}/projects/{slug of the run's worktree}/{sessionId}.jsonl
// — never from a projects-wide or newest-candidate search, so two runs of one
// dispatch session (one session id, two worktrees) never read each other's.
// A timing.json that already has token totals is kept byte-identical; a
// spec-N child of a multi-record run is never written (the parent's file
// covers the whole run). Token rows are clipped to the run's own lifetime
// (creation through close), so two runs of one session transcript never share them. The read-check-write runs
// under the run dir's .timing.lock; a run dir a concurrent archive moved away is
// followed to its archive twin, never recreated. Nothing here throws: a failure
// is one SKIP line in the run's decisions.md (_shared/auto-decision-log.md's
// Degrade-trace rule).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lstatType } = require('../path-guard');
const { derivePhaseTiming, deriveTiming, hasTokenTotals, writeTimingFile } = require('./run-timing');
const { priorWorktree } = require('../run-state-worktree');
const { acquireLock, releaseLock } = require('../file-lock');
const timingSkip = require('../log-decision/timing-skip');

// The one time bound on a close's transcript reads (ms).
const TIMING_BOUND_MS = 60000;

const PHASE_ONLY = 'timing.json phase rows written without token totals';
const NOTHING_WRITTEN = 'no timing.json written';

const { errText } = timingSkip;

// runState, { env, homeDir } -> { paths, reason }. At most the one own path.
// homeDir (a function) is called only when env has no CLAUDE_CONFIG_DIR.
function ownTranscripts(runState, { env = {}, homeDir = os.homedir } = {}) {
  try {
    const rs = runState && typeof runState === 'object' ? runState : {};
    const worktree = priorWorktree(rs);
    if (!worktree) return { paths: [], reason: 'no worktree or worktreeAtClose in run-state.json' };
    const sid = rs.sessionId;
    if (typeof sid !== 'string') return { paths: [], reason: 'no sessionId in run-state.json' };
    const configDir = (env && env.CLAUDE_CONFIG_DIR) || path.join(homeDir(), '.claude');
    // Looked up at call time so a test can stub it.
    const found = require('./transcript').locateTranscripts({ cwd: worktree, sessionId: sid, homeDir: null, configDir });
    if (!found.length) return { paths: [], reason: `no ${sid}.jsonl under the slug of ${worktree}` };
    return { paths: [found[0].path], reason: null };
  } catch (err) {
    return { paths: [], reason: `transcript lookup failed (${errText(err)})` };
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

// One SKIP line in runDir's decisions.md; a run dir that is not a directory gets none.
// (log-decision/timing-skip.js, shared with the closing paths' own fallback catch.)
function logTimingSkip(runDir, text) {
  timingSkip.logTimingSkip(runDir, text);
}

function readExisting(runDir) {
  try { return JSON.parse(fs.readFileSync(path.join(runDir, 'timing.json'), 'utf8')); } catch { return null; }
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

// One read-check-write in dir, under dir's timing lock, so a concurrent writer
// (a token pass, a second closer) never has its file overwritten between the
// check and the rename. The lock is waited for only until deadlineAt (never past
// the time bound); a lock not acquired in time is a SKIP. The lock never creates
// dir. needRunState (the run had a run-state.json when derived): a dir whose
// run-state.json is gone is being archived — its entries are moving to the twin,
// and a file written now would strand in it after the straggler sweep — so it
// counts as vanished. -> a result, or { vanished: true } when dir is gone.
function writeIn(dir, timing, skip, deadlineAt, needRunState) {
  if (!isDir(dir)) return { vanished: true };
  const withTokens = hasTokenTotals(timing);
  const waitMs = Math.max(0, Math.floor(Math.min(TIMING_BOUND_MS, deadlineAt - Date.now())));
  const held = acquireLock(path.join(dir, LOCK_NAME), { waitMs, env: {}, createParent: false });
  if (!held) {
    if (!isDir(dir)) return { vanished: true };
    return { status: 'failed', tokens: false, skip: `condition: timing.json lock not acquired within ${waitMs} ms → fallback: ${NOTHING_WRITTEN}` };
  }
  try {
    if (needRunState && lstatType(path.join(dir, 'run-state.json')).type === 'missing') return { vanished: true };
    // A timing with no token totals never replaces a file that gained them while
    // this call derived (a concurrent token pass).
    if (!withTokens && hasTokenTotals(readExisting(dir))) return { status: 'kept', tokens: true, skip: null };
    try {
      writeTimingFile(dir, timing);
    } catch (err) {
      if (!isDir(dir)) return { vanished: true };
      return { status: 'failed', tokens: false, skip: `condition: timing.json write failed (${errText(err)}) → fallback: ${NOTHING_WRITTEN}` };
    }
    return { status: 'written', tokens: withTokens, skip };
  } finally {
    releaseLock(held);
    // An archive's per-entry move can carry this lock dir to the twin, where the
    // release above misses it: compare-and-delete it there too (the token is ours alone).
    releaseLock({ lockPath: path.join(archiveTwin(dir), LOCK_NAME), token: held.token });
  }
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

function finish(runDir, result) {
  if (result.skip) logTimingSkip(runDir, result.skip);
  return result;
}

// runDir -> { status, skip }: phase rows only, synchronous, no transcript read.
function writePhaseTimingSync(runDir) {
  let dir = runDir;
  let result;
  try {
    const p = prepare(runDir);
    if (p.done) result = p.done;
    else ({ dir, result } = write(runDir, p.base.timing, null, Date.now() + module.exports.TIMING_BOUND_MS, p.base.runState !== null));
  } catch (err) {
    result = { status: 'failed', tokens: false, skip: `condition: timing at close failed (${errText(err)}) → fallback: ${NOTHING_WRITTEN}` };
  }
  finish(dir, result);
  return { status: result.status, skip: result.skip };
}

// runDir, opts -> Promise<{ status: 'written'|'kept'|'not-top-level'|'failed', tokens, skip }>. Never rejects.
async function writeTimingAtClose(runDir, { tokens = true, env = {}, homeDir = os.homedir, boundMs } = {}) {
  if (!tokens) {
    const r = writePhaseTimingSync(runDir);
    return { status: r.status, tokens: false, skip: r.skip };
  }
  let dir = runDir;
  let result;
  try {
    const p = prepare(runDir);
    if (p.done) {
      result = p.done;
    } else {
      const own = ownTranscripts(p.base.runState, { env, homeDir });
      const bound = boundMs ?? module.exports.TIMING_BOUND_MS;
      const deadlineAt = Date.now() + bound;
      const d = await deriveTiming(runDir, {
        transcriptPaths: own.paths, wantTokens: own.paths.length > 0, cwd: runDir, deadlineAt, base: p.base, clipToRunWindow: true,
      });
      if (!d.ok) {
        result = { status: 'failed', tokens: false, skip: `condition: timing could not be derived (${d.error}) → fallback: ${NOTHING_WRITTEN}` };
      } else {
        let skip = null;
        if (own.reason) skip = `condition: ${own.reason} → fallback: ${PHASE_ONLY}`;
        else if (d.deadlineHit) skip = `condition: transcript read passed the ${bound} ms time bound → fallback: ${PHASE_ONLY}`;
        else if (!hasTokenTotals(d.timing)) skip = `condition: own transcript yielded no token totals (${d.notes.length ? d.notes.join('; ') : 'no usage tokens'}) → fallback: ${PHASE_ONLY}`;
        ({ dir, result } = write(runDir, d.timing, skip, deadlineAt, p.base.runState !== null));
      }
    }
  } catch (err) {
    result = { status: 'failed', tokens: false, skip: `condition: timing at close failed (${errText(err)}) → fallback: ${NOTHING_WRITTEN}` };
  }
  return finish(dir, result);
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
// without it the child inherits this process's. A spawn that fails asynchronously
// (ENOENT/EACCES are emitted, not thrown) logs the same SKIP from its 'error' listener.
function spawnTokenPass(runDir, { env } = {}) {
  const cannotStart = (reason) => logTimingSkip(runDir, `condition: background token pass could not start (${reason}) → fallback: timing.json keeps its phase rows without token totals`);
  try {
    const cli = path.join(__dirname, '..', '..', 'timing-at-close.js');
    const child = require('child_process').spawn(process.execPath, [cli, '--run', runDir], { detached: true, stdio: 'ignore', windowsHide: true, ...(env ? { env } : {}) });
    child.on('error', (err) => cannotStart(errText(err)));
    child.unref();
    return { spawned: true, reason: 'started' };
  } catch (err) {
    const reason = errText(err);
    cannotStart(reason);
    return { spawned: false, reason };
  }
}

module.exports = { TIMING_BOUND_MS, ownTranscripts, isSpecChildDir, writeTimingAtClose, writeTimingAtCloseSafe, writePhaseTimingSync, logTimingSkip, spawnTokenPass };
