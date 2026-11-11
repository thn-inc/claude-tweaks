// plugin/bin/lib/verify/slot.js — verify.js's machine-wide suite slot (#5119):
// pure helpers for how many slots a project's runs may hold at once, which lane
// a run queues in and how many test workers one slot may use, plus holdSlot,
// which takes and holds one. The lock itself lives in plugin/bin/lib/suite-slot.js.
'use strict';

const os = require('os');
const {
  acquireSlot, releaseSlot, isPidAlive, ensureOwnDir, slotLane, slotIndexOf, defaultSlotBase, SLOT_DIR_VAR,
} = require('../suite-slot');

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

// The wait line's raise-the-limit advice. A declared count wins over the
// policy key's flag, so raising the key would change nothing there.
function slotHint(source) {
  const declared = 'raise concurrency.suiteSlots in .claude-tweaks/verify-scope.json';
  return source === 'declaration' ? declared : `${declared}, or the verify-suite-slots policy key`;
}

// A lock dir holdSlot cannot use (not a directory owned by this user, not
// writable, …): verify.js exits 2 on it, never 1 as if a check had failed.
// The message names the failure itself (`suite slot unavailable — {cause}`), so
// a caller that only records err.message (--baseline adjudication's
// `adjudication error: …`) still says what failed.
class SlotUnavailableError extends Error {
  constructor(cause) {
    super(`suite slot unavailable — ${cause}`);
  }
}

// A declared concurrency.suiteSlots wins, then --default-suite-slots, then one
// slot. `declared` and `flag` are positive integers or null (validated by
// declaration.js and args.js).
function resolveSuiteSlots({ declared, flag }) {
  if (declared !== null && declared !== undefined) return { slots: declared, source: 'declaration' };
  if (flag !== null && flag !== undefined) return { slots: flag, source: 'flag' };
  return { slots: 1, source: 'default' };
}

// The lane follows the commands that run, not the selection mode: no local
// check means nothing to queue for (null); a run whose local checks include a
// full-suite command takes the 'full' lane; any other run queues as 'subset'.
// The caller computes fullSuiteRuns.
function chooseLane({ localCheckCount, fullSuiteRuns }) {
  if (localCheckCount === 0) return null;
  return fullSuiteRuns ? 'full' : 'subset';
}

// Test-worker cap per slot: half the cores split across the slots, at least 1.
function workerCap(cores, slots) {
  return Math.max(1, Math.floor(cores / (2 * slots)));
}

// Takes one of `slots` machine-wide suite slots in `lane` ('full' or 'subset') and holds it until
// release(). Returns null, touching nothing, when there is nothing to queue for (`lane` null) or a
// parent already holds a slot for this process tree (CT_TEST_SUITE_SLOT_HELD=1), so a nested
// verify.js or run-tests.js never waits on its own parent. While held, every child inherits
// CT_TEST_SUITE_SLOT_HELD=1 and a CT_TEST_WORKERS cap (a value the caller set wins); release
// restores both. The slot is freed on every exit path: an 'exit' hook, and SIGINT/SIGTERM/SIGHUP
// handlers that first run `beforeRelease(signal)` (verify.js stops its running checks there),
// then — only when no other listener for that signal remains — release and exit 128+n.
// Otherwise adjudicate()'s own handler, registered later, removes its scratch worktree and exits,
// and the 'exit' hook releases the slot after that removal (#5150). The acquire wait is
// synchronous: no check runs while a run waits. A lock dir it cannot use throws
// SlotUnavailableError. `cores` defaults to the core count, read only once a slot is held, from
// `osImpl.availableParallelism()`, or `osImpl.cpus().length` on a Node without it (before 18.14).
function holdSlot({
  lane, slots, source, beforeRelease = () => {}, env = process.env, tmpdir = os.tmpdir(),
  cores, osImpl = os, pid = process.pid, cwd = process.cwd(), isAlive = isPidAlive, now = Date.now,
  sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  log = (l) => process.stderr.write(`${l}\n`), proc = process,
}) {
  if (env.CT_TEST_SUITE_SLOT_HELD === '1' || lane === null) return null;
  const base = defaultSlotBase(env, tmpdir);
  const startedMs = now();
  let lockPath;
  try {
    ensureOwnDir(base, SLOT_DIR_VAR);
    lockPath = acquireSlot({
      dir: slotLane(base, lane === 'subset').dir, slots, pid, cwd, isAlive, now, sleep, log,
      label: `verify.js [${lane} lane]`, hint: slotHint(source),
    });
  } catch (err) {
    throw new SlotUnavailableError(String((err && err.message) || err));
  }
  const waitedMs = now() - startedMs;
  const cpuCount = cores ?? (typeof osImpl.availableParallelism === 'function' ? osImpl.availableParallelism() : osImpl.cpus().length);
  const prior = { CT_TEST_SUITE_SLOT_HELD: env.CT_TEST_SUITE_SLOT_HELD, CT_TEST_WORKERS: env.CT_TEST_WORKERS };
  env.CT_TEST_SUITE_SLOT_HELD = '1';
  if (env.CT_TEST_WORKERS === undefined) env.CT_TEST_WORKERS = String(workerCap(cpuCount, slots));
  let released = false;
  const handlers = [];
  const release = () => {
    if (released) return;
    released = true;
    releaseSlot(lockPath, pid);
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    proc.removeListener('exit', release);
    for (const [sig, handler] of handlers) proc.removeListener(sig, handler);
  };
  proc.on('exit', release);
  for (const sig of SIGNALS) {
    const handler = () => {
      const last = proc.listenerCount(sig) === 1;
      try {
        beforeRelease(sig);
      } finally {
        // #5150: a later listener (adjudicate()'s) still has to remove this slot's scratch
        // worktree, so the slot stays held until that listener exits — the 'exit' hook releases
        // it — and a waiter on this slot never starts on the path while it is torn down.
        if (last) release();
      }
      if (last) proc.exit(128 + os.constants.signals[sig]);
    };
    handlers.push([sig, handler]);
    proc.on(sig, handler);
  }
  // `base` is the lock dir the slot was taken under: with `index` it keys the scratch worktree path
  // a --baseline adjudication reuses (#5150).
  return {
    lane, index: slotIndexOf(lockPath), slots, source, waitedMs, release, base,
  };
}

module.exports = {
  resolveSuiteSlots, chooseLane, workerCap, holdSlot, SlotUnavailableError,
};
