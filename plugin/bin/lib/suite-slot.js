'use strict';

// The machine-wide test-suite slot lock: a cross-process semaphore (`slot-<i>.lock`), a FIFO
// queue of waiters (`ticket-<seq>.json`) and the reclaim mutex (`slot-<i>.reclaim`) that keeps a
// dead holder's slot from being taken twice. Bounding how many suites run at once is what keeps a
// dev machine usable when sibling worktrees each run one (#3969, #4333).
//
// Two callers share this one implementation, one lock directory and one ticket format:
// tools/run-tests.js (the maintainer test runner) and bin/verify.js (the shipped verify gate). Do not
// change the lock directory, the lock/ticket file names (`slot-<i>.lock`, `slot-<i>.reclaim`,
// `ticket-<seq>.json`, `subset/`) or the ticket JSON shape (`{ pid, startedAt, cwd, slots? }`):
// sibling worktrees on an older run-tests.js share the same directory and read these files.
//
// Every function is pure of `process`/`os` state except through its parameters, so tests drive the
// lock with fake pids, clocks and sleeps.

const fs = require('fs');
const path = require('path');

// Matches a positive integer with no sign, fraction, or leading zero — the shape both
// `CT_TEST_CONCURRENCY` and `CT_TEST_SUITE_SLOTS` accept.
const POSITIVE_INT = /^[1-9]\d*$/;

// How many full suites may run at once across processes (the slot semaphore). Defaults to 1;
// `CT_TEST_SUITE_SLOTS` overrides with a positive integer. An invalid value falls back to 1 and
// says so once through `log`, so a typo is visible instead of silently changing the cap. `key`
// names the variable read — `CT_TEST_SUBSET_SLOTS` for the subset lane, same rules. `label` prefixes
// the message with the calling tool's name.
function resolveSlots(env, log, key = 'CT_TEST_SUITE_SLOTS', label = 'run-tests.js') {
  const raw = env[key];
  if (raw === undefined) return 1;
  if (typeof raw === 'string' && POSITIVE_INT.test(raw)) return Number(raw);
  log(`${label}: ignoring invalid ${key}=${JSON.stringify(raw)} (want a positive integer) — using 1 slot.`);
  return 1;
}

// The slot lane a run waits in: a `--files-from` subset (`roots === null`) uses its own
// `subset/` directory and `CT_TEST_SUBSET_SLOTS`; every other run the full-suite lane.
// Pure: `baseDir` and `subset` are parameters.
function slotLane(baseDir, subset) {
  return subset
    ? { dir: path.join(baseDir, 'subset'), slotsVar: 'CT_TEST_SUBSET_SLOTS' }
    : { dir: baseDir, slotsVar: 'CT_TEST_SUITE_SLOTS' };
}

// Whether `pid` names a live process: signal 0 probes without delivering anything. ESRCH means
// gone; EPERM means it exists but belongs to someone else, which still counts as alive — a slot
// holder we cannot signal must not be treated as dead and have its lock stolen. A non-positive or
// non-integer pid is never a process: `kill(0, 0)` would probe our own process group and report it
// alive forever.
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// Creates `lockPath` exclusively (`wx`) with the holder's identity. Returns false when another
// process already owns the file; any other error propagates. The identity is what lets a waiter
// name the holder and lets a later run tell a dead holder from a live one. `extra` fields ride
// along in the identity (a queue ticket records its `slots` limit there); a slot lock passes none.
function createLock(lockPath, pid, cwd, now, extra = {}) {
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
  try {
    fs.writeSync(fd, JSON.stringify({ pid, startedAt: new Date(now()).toISOString(), cwd, ...extra }));
  } catch (err) {
    // An empty lock left behind would read as a live unknown holder and stall every other run
    // for `staleUnparseableMs`, so a failed write removes the file before surfacing the error.
    fs.closeSync(fd);
    unlinkQuiet(lockPath);
    throw err;
  }
  fs.closeSync(fd);
  return true;
}

// Stands in for a holder whose identity is not readable (caught between create and write, or a
// reclaim in flight).
const UNKNOWN_HOLDER = Object.freeze({ pid: 'unknown', cwd: 'unknown', startedAt: 'unknown' });

// Classifies an existing lock file: `null` if it vanished, `{ stale: true }` if it is
// reclaimable (dead holder, or unparseable and older than `staleUnparseableMs`), else the
// held-by info. A fresh unparseable file is a holder caught between create and write, so it is
// treated as held with unknown identity rather than reclaimed.
function readHolder(lockPath, { isAlive, now, staleUnparseableMs }) {
  let text;
  let mtimeMs;
  try {
    text = fs.readFileSync(lockPath, 'utf8');
    mtimeMs = fs.statSync(lockPath).mtimeMs;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let held;
  try {
    held = JSON.parse(text);
  } catch (_) {
    held = null;
  }
  if (held && Number.isInteger(held.pid) && held.pid > 0) {
    return isAlive(held.pid) ? { pid: held.pid, cwd: held.cwd, startedAt: held.startedAt, slots: held.slots } : { stale: true };
  }
  if (now() - mtimeMs > staleUnparseableMs) return { stale: true };
  return UNKNOWN_HOLDER;
}

function unlinkQuiet(p) {
  try {
    fs.unlinkSync(p);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Creates the reclaim mutex exclusively; false when it already exists.
function createMutex(mutex) {
  try {
    fs.closeSync(fs.openSync(mutex, 'wx'));
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

// Reclaims a lock its caller judged stale, atomically enough that two reclaimers cannot both end
// up holding the slot. The race without a mutex: A and B both read the same dead lock; A unlinks it
// and creates its own; B then unlinks A's live lock and creates its own — both hold the slot. So
// only the process that creates `slot-<i>.reclaim` (`wx`) may reclaim, and under it the lock is
// RE-READ and must still be stale before the unlink + create. A mutex older than `staleReclaimMs`
// was left by a reclaimer that crashed inside its window: it is cleared and taken once. Residual
// risk: a reclaimer crashing inside the window, or two processes clearing the same old mutex, can
// at worst let two suites run at once one time — never a deadlock, since the mutex always ages out.
// Returns true when `lockPath` is now ours; false when someone else holds or is reclaiming it.
function reclaimSlot(lockPath, { pid, cwd, isAlive, now, staleUnparseableMs, staleReclaimMs }) {
  const mutex = lockPath.replace(/\.lock$/, '.reclaim');
  if (!createMutex(mutex)) {
    let ageMs;
    try {
      ageMs = now() - fs.statSync(mutex).mtimeMs;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (ageMs !== undefined && ageMs <= staleReclaimMs) return false;
    unlinkQuiet(mutex);
    if (!createMutex(mutex)) return false;
  }
  try {
    const holder = readHolder(lockPath, { isAlive, now, staleUnparseableMs });
    if (holder !== null && !holder.stale) return false;
    if (holder !== null) unlinkQuiet(lockPath);
    return createLock(lockPath, pid, cwd, now);
  } finally {
    unlinkQuiet(mutex);
  }
}

// Creates `dir` if needed and refuses it unless it is a real directory owned by this user. The slot
// and run-root parents sit at fixed names under the tmpdir; where that is a shared, world-writable
// /tmp (multi-user Linux), another user could pre-create either — a symlink steering the sweep's
// deletes, or a directory of theirs holding a lock that blocks every run. Throws on a mismatch.
function ensureOwnDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (!st.isDirectory() || (uid !== null && st.uid !== uid)) {
    throw new Error(`${dir} is not a directory owned by this user — remove it and re-run.`);
  }
}

// The queue tickets in `dir` (`ticket-<seq>.json`), oldest first. Only names of exactly that shape
// count, so `slot-*.lock`, `.reclaim` mutexes and the `subset/` lane directory are never tickets.
function listTickets(dir) {
  const tickets = [];
  for (const name of fs.readdirSync(dir)) {
    const match = /^ticket-(\d+)\.json$/.exec(name);
    if (match) tickets.push({ seq: Number(match[1]), path: path.join(dir, name) });
  }
  return tickets.sort((a, b) => a.seq - b.seq);
}

// Joins the queue: creates the ticket after the highest one listed (1 when none), recording the
// waiter's `slots` limit, and moves to the next number whenever another process took the one tried.
function takeTicket(dir, { pid, cwd, now, slots }) {
  const listed = listTickets(dir);
  for (let seq = listed.length ? listed[listed.length - 1].seq + 1 : 1; ; seq++) {
    const ticketPath = path.join(dir, `ticket-${seq}.json`);
    if (createLock(ticketPath, pid, cwd, now, { slots })) return { seq, path: ticketPath };
  }
}

// The tickets ahead of `seq`, judged like slot locks: a stale one (dead pid, our own pid, or
// unparseable and older than `staleUnparseableMs` — never age alone) is removed, a vanished one is
// skipped. `floor` is the lowest slot index the caller may try: the largest limit among the live
// tickets ahead (0 when none), where a ticket's limit is its `slots` when that is a positive integer
// and unlimited (`Infinity`) otherwise, so a ticket whose limit is unreadable blocks every index.
// `first` is the lowest live ticket ahead whose limit reaches the caller's own `slots` — the one
// that alone blocks every index the caller can use — or null; it exists whenever `floor >= slots`.
// `holderOpts.slots` is the caller's limit.
function ticketsAhead(dir, seq, holderOpts) {
  let floor = 0;
  let first = null;
  for (const ticket of listTickets(dir)) {
    if (ticket.seq >= seq) break;
    const holder = readHolder(ticket.path, holderOpts);
    if (holder === null) continue;
    if (holder.stale) {
      unlinkQuiet(ticket.path);
      continue;
    }
    const limit = Number.isInteger(holder.slots) && holder.slots > 0 ? holder.slots : Infinity;
    if (limit > floor) floor = limit;
    if (!first && limit >= holderOpts.slots) first = { ...holder, lockPath: ticket.path };
  }
  return { floor, first };
}

// Whether the lock or ticket at `filePath` still names `pid`: false when it was deleted, is
// unparseable or not an object (`null` included), or a newcomer was numbered into its seq.
function namesPid(filePath, pid) {
  try {
    const held = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return !!held && held.pid === pid;
  } catch (err) {
    if (err.code === 'ENOENT' || err instanceof SyntaxError) return false;
    throw err;
  }
}

// Takes one of `slots` cross-process suite slots (`slot-<i>.lock` in `dir`) and returns the lock
// path, polling every `pollMs` until one frees up (#3969). Waiters are served in arrival order
// (#4333): each takes a `ticket-<seq>.json` first and tries a slot only past the tickets ahead of
// it. Tickets decide order only; the slot locks still decide exclusivity. Each ticket records its
// `slots` limit, and a waiter may try `slot-<i>` only when no earlier live ticket has `slots > i` —
// so a later arrival with a higher limit still takes an index the waiters ahead of it cannot use,
// and a ticket whose limit is unreadable counts as unlimited and blocks every index. A ticket is
// stale by pid liveness, never by age — a live waiter's ticket may legitimately be hours old. A
// number below a live ticket is practically never reissued (a later arrival lists the directory
// while every earlier live waiter's ticket exists), so reaping a stale ticket ahead practically never
// deletes a newer one. Two races remain: `takeTicket`'s list-then-create is not atomic (P lists none,
// W1 and W2 create tickets 1 and 2, W1 acquires and removes ticket 1, P creates ticket 1 below live
// ticket 2, so P is served ahead of W2), and `ticketsAhead`'s read-then-unlink is not atomic (two
// reapers judging ticket k stale can delete a fresh ticket reissued at k in between; the waiter
// that lost its ticket fails its own-ticket check, `namesPid`, on its next poll and rejoins at the
// tail).
// Residual risk: a ticket whose pid was reused by an unrelated process, or whose waiter is stopped
// rather than dead, blocks the queue until a human deletes the ticket the log line names — the same
// risk slot locks already accept. The usual source of an orphan ticket is an interrupted wait: a
// default SIGINT/SIGTERM during the synchronous `Atomics.wait` skips `finally`, and such a ticket
// is reaped once its pid is dead unless the pid has been reused (the case above). A lock held by a
// dead pid is reclaimed immediately, so a crashed run never wedges the queue. The wait message is
// logged once per call.
// `isAlive`, `now`, `sleep` and `log` are parameters so tests never touch real processes or time.
// A lock or ticket naming our own `pid` is stale by definition — a prior run that crashed and whose
// pid the OS then reused for this one — so it is reclaimed rather than waited on forever.
// `label` prefixes the wait line with the calling tool's name; `hint` replaces its trailing
// "set <slotsVar> to raise the limit" advice when that variable is not the caller's knob.
function acquireSlot({ dir, slots, pid, cwd, isAlive: isPidLive, now, sleep, log, pollMs = 2000, staleUnparseableMs = 600000, staleReclaimMs = 30000, slotsVar = 'CT_TEST_SUITE_SLOTS', label = 'run-tests.js', hint = null }) {
  const isAlive = (holderPid) => holderPid !== pid && isPidLive(holderPid);
  ensureOwnDir(dir);
  const advice = hint ?? `set ${slotsVar} to raise the limit`;
  const holderOpts = { isAlive, now, staleUnparseableMs, slots };
  let ticket = takeTicket(dir, { pid, cwd, now, slots });
  let logged = false;
  try {
    for (;;) {
      // Our ticket must still be ours: deleted by hand, unparseable, or naming another pid (a newcomer
      // numbered into our deleted seq). Rejoin at the tail; the file at the old path is not ours to remove.
      if (!namesPid(ticket.path, pid)) ticket = takeTicket(dir, { pid, cwd, now, slots });
      const { floor, first } = ticketsAhead(dir, ticket.seq, holderOpts);
      let blocker = null;
      for (let i = floor; i < slots; i++) {
        const lockPath = path.join(dir, `slot-${i}.lock`);
        if (createLock(lockPath, pid, cwd, now)) return lockPath;
        const holder = readHolder(lockPath, { isAlive, now, staleUnparseableMs });
        if (holder === null || holder.stale) {
          if (reclaimSlot(lockPath, { pid, cwd, isAlive, now, staleUnparseableMs, staleReclaimMs })) return lockPath;
          // Someone else is reclaiming this slot or won it: it is held now, so keep scanning.
          if (!blocker) blocker = { ...UNKNOWN_HOLDER, lockPath };
          continue;
        }
        if (!blocker || blocker.pid === 'unknown') blocker = { ...holder, lockPath };
      }
      if (!logged) {
        logged = true;
        // The lock or ticket path is named so a maintainer can delete one whose pid was reused by an
        // unrelated long-lived process (isAlive cannot tell it from the run that took the slot).
        log(
          floor >= slots
            ? `${label}: waiting for a test-suite slot — queued behind pid ${first.pid} (cwd ${first.cwd}) ` +
                `since ${first.startedAt}; ${advice} (ticket: ${first.lockPath})`
            : `${label}: waiting for a test-suite slot — held by pid ${blocker.pid} (cwd ${blocker.cwd}) ` +
                `since ${blocker.startedAt}; ${advice} (lock: ${blocker.lockPath})`,
        );
      }
      sleep(pollMs);
    }
  } finally {
    releaseSlot(ticket.path, pid); // removes the ticket only while it still names our pid
  }
}

// Frees `lockPath` only if it still names `pid`, so a run that lost its lock to a reclaim never
// deletes the new owner's. Never throws: this runs on exit paths where a failure must not mask
// the suite's own exit code.
function releaseSlot(lockPath, pid) {
  try {
    if (namesPid(lockPath, pid)) fs.unlinkSync(lockPath);
  } catch (_) {
    // missing, unparseable or already gone — nothing to release
  }
}

// The `<i>` of a `slot-<i>.lock` basename (the path acquireSlot returns), null for any other name.
function slotIndexOf(lockPath) {
  const match = /^slot-(\d+)\.lock$/.exec(path.basename(lockPath));
  return match ? Number(match[1]) : null;
}

// Where the slot locks live: `CT_TEST_SUITE_SLOT_DIR` when it is a non-empty string, else
// `ct-test-suite-slots` under `tmpdir`. Pure: `env` and `tmpdir` are parameters.
function defaultSlotBase(env, tmpdir) {
  const override = env.CT_TEST_SUITE_SLOT_DIR;
  return typeof override === 'string' && override !== '' ? override : path.join(tmpdir, 'ct-test-suite-slots');
}

module.exports = {
  isPidAlive, ensureOwnDir, acquireSlot, releaseSlot, slotLane, resolveSlots, slotIndexOf, defaultSlotBase,
};
