#!/usr/bin/env node
'use strict';

// Portable replacement for the shell-only test invocations this repo used to run via
// `package.json`'s "test" and "test:perf" scripts, e.g. `CT_HOOKS_GIT_TIMEOUT_MS=60000
// node --test $(find tests tools/upstream-drift/tests -name '*.test.js' | sort)`. That form
// relies on a POSIX env-prefix and `$(...)` command substitution, neither of which `npm` on
// Windows can run under `cmd.exe`. This script reproduces the same file selection and env
// default in pure Node, then runs `node --test` the same way, so both scripts work identically
// on POSIX and Windows.
//
// Roots default to the "test" script's set (`tests`, `tools/upstream-drift/tests`); pass one or
// more repo-relative root paths as CLI positional args to override — `test:perf` invokes this as
// `node tools/run-tests.js perf`. `--files-from <list>` instead runs exactly the files the list
// names, one repo-relative path per line (blank lines ignored, resolved against the repo root
// whatever the caller's cwd) — verify.js's impact-selected subset (#4024). An empty list, a
// missing file or a non-`*.test.js` entry exits 1, never handing `node --test` zero files.
//
// Elsewhere the explicit file list goes to `node --test`; on Windows (Node >= 22) the root globs
// go instead, because ~780 paths overflow the 32,767-char command line (#3316).
//
// Running the suite also bounds its load on the machine (#3969): concurrent suites from sibling
// worktrees and fixtures leaked into the shared temp dir made the dev machine unusable. Each run
// takes a cross-process slot, runs `node --test` with a bounded `--test-concurrency` and a private
// TMPDIR under `<tmpdir>/ct-test-runs/` (removed on exit; roots orphaned by a killed run are swept
// from that directory on the next one), and forwards SIGINT/SIGTERM/SIGHUP to the child so a
// signalled runner frees its slot and root promptly instead of after the suite. Env knobs:
// CT_TEST_SUITE_SLOTS (simultaneous suites, default 1), CT_TEST_CONCURRENCY (files at once,
// default half the cores, or cores - 1 when CI is set), CT_TEST_SUITE_SLOT_DIR (where the slot
// locks live, default under the real tmpdir), CT_TEST_SUITE_SLOT_HELD (=1 set for the child so a
// nested run skips the slot). A `--files-from` subset takes its slot from a separate lane
// (`<slot dir>/subset`, CT_TEST_SUBSET_SLOTS, default 1): a seconds-long impact subset must not
// queue behind a sibling's full suite, and two subsets still never run at once (#4024).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// The repo root every root path is relative to — both the explicit file list and the win32
// root globs resolve against it (the spawned `node --test` runs with it as cwd), so the two
// branches select the same files whatever directory the caller ran this from.
const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_ROOTS = ['tests', path.join('tools', 'upstream-drift', 'tests')];

// Reads `dir` directly and treats a missing directory as "no files here" — never
// `fs.existsSync(dir)` first: that shape is a check-then-act race (the directory can vanish
// between the check and the read) and, more to the point here, both `dir` values are static
// repo-relative roots, so the only realistic way this ever throws ENOENT is a genuine absence,
// which is exactly the case this function already needs to treat as empty.
function collectTestFiles(dir, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(full, results);
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      results.push(full);
    }
  }
}

// Walks `roots` (relative to `cwd`, defaulting to this repo's root) and returns every
// `*.test.js` file, sorted — the same file set `find {roots} -name '*.test.js' | sort` would
// produce. `roots` defaults to DEFAULT_ROOTS (the "test" script's set) when omitted or empty.
// Exported so tests can exercise the selection logic directly instead of shelling out.
function listTestFiles(cwd, roots) {
  const base = cwd || REPO_ROOT;
  const useRoots = roots && roots.length ? roots : DEFAULT_ROOTS;
  const files = [];
  for (const root of useRoots) {
    collectTestFiles(path.resolve(base, root), files);
  }
  files.sort();
  return files;
}

// The entries of a `--files-from` list: one path per line, CRs stripped, blank lines and repeats
// dropped, order kept. Throws (naming the entry) on a non-`*.test.js` entry, a path that is not
// repo-relative (leading `-`, absolute, a `..` segment), or one `exists` says is not a file, and on a
// list naming nothing — so a subset run can never reach `node --test` empty.
function readFileList(text, { exists }) {
  const entries = [];
  for (const raw of String(text).split('\n')) {
    const entry = raw.replace(/\r$/, '');
    if (entry.trim() === '' || entries.includes(entry)) continue;
    if (!entry.endsWith('.test.js')) throw new Error(`listed entry ${JSON.stringify(entry)} is not a *.test.js file`);
    // A repo-relative path only: a leading `-` would reach `node --test` as an option, and an absolute
    // or `..` path would run a file from outside this checkout.
    if (entry.startsWith('-') || path.isAbsolute(entry) || /^[A-Za-z]:/.test(entry) || entry.split(/[\\/]/).includes('..')) {
      throw new Error(`listed entry ${JSON.stringify(entry)} is not a repo-relative path`);
    }
    if (!exists(entry)) throw new Error(`listed test file ${JSON.stringify(entry)} does not exist`);
    entries.push(entry);
  }
  if (entries.length === 0) throw new Error('the list names no test files');
  return entries;
}

// Matches a positive integer with no sign, fraction, or leading zero — the shape both
// `CT_TEST_CONCURRENCY` and `CT_TEST_SUITE_SLOTS` accept.
const POSITIVE_INT = /^[1-9]\d*$/;

// How many test files `node --test` runs at once. Half the cores (at least 1) by default so one
// suite leaves the machine usable for sibling worktrees (#3969), except when `CI` is set (any
// non-empty value): a CI runner is single-tenant, so halving only slows it and the default is
// node's own, cores - 1 (at least 1). `CT_TEST_CONCURRENCY` overrides either with a positive
// integer, and an invalid value is ignored rather than failing the run.
// Pure: `env` and `cpus` are parameters, never read from `process`/`os`.
function resolveConcurrency(env, cpus) {
  const raw = env.CT_TEST_CONCURRENCY;
  if (typeof raw === 'string' && POSITIVE_INT.test(raw)) return Number(raw);
  if (typeof env.CI === 'string' && env.CI !== '') return Math.max(1, cpus - 1);
  return Math.max(1, Math.floor(cpus / 2));
}

// How many full suites may run at once across processes (the slot semaphore). Defaults to 1;
// `CT_TEST_SUITE_SLOTS` overrides with a positive integer. An invalid value falls back to 1 and
// says so once through `log`, so a typo is visible instead of silently changing the cap. `key`
// names the variable read — `CT_TEST_SUBSET_SLOTS` for the subset lane, same rules.
function resolveSlots(env, log, key = 'CT_TEST_SUITE_SLOTS') {
  const raw = env[key];
  if (raw === undefined) return 1;
  if (typeof raw === 'string' && POSITIVE_INT.test(raw)) return Number(raw);
  log(`run-tests.js: ignoring invalid ${key}=${JSON.stringify(raw)} (want a positive integer) — using 1 slot.`);
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

// Returns the argv (after the node binary) for `node --test`. The explicit file list is the
// default — `node --test` glob args don't work on Node 20 (#407). On win32 that list overflows
// the 32,767-char command line (#3316), so there it passes the root globs, which needs Node >= 22.
// `--test-concurrency=<n>` follows `--test` on both branches (#3969); `concurrency` must be a
// positive integer, checked before the win32/Node<22 error so that error keeps its own message.
// `roots === null` is an explicit `--files-from` subset, which has no root globs to fall back to:
// its file list is passed on every platform.
// Pure: `platform`, `nodeMajor` and `concurrency` are parameters, never read from `process`.
function buildTestArgs(files, roots, { platform, nodeMajor, concurrency }) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`buildTestArgs: concurrency must be a positive integer (got ${String(concurrency)}).`);
  }
  const head = ['--test', `--test-concurrency=${concurrency}`];
  if (platform !== 'win32' || roots === null) return [...head, ...files];
  if (nodeMajor < 22) {
    throw new Error(
      'the Windows command line cannot hold the explicit test-file list, and `node --test` ' +
        `globs need Node >= 22 on Windows (running Node ${nodeMajor}).`,
    );
  }
  return [...head, ...roots.map((root) => `${root.split(/[\\/]/).join('/')}/**/*.test.js`)];
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
// name the holder and lets a later run tell a dead holder from a live one.
function createLock(lockPath, pid, cwd, now) {
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
  try {
    fs.writeSync(fd, JSON.stringify({ pid, startedAt: new Date(now()).toISOString(), cwd }));
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
    return isAlive(held.pid) ? { pid: held.pid, cwd: held.cwd, startedAt: held.startedAt } : { stale: true };
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

// Takes one of `slots` cross-process suite slots (`slot-<i>.lock` in `dir`) and returns the lock
// path, polling every `pollMs` until one frees up (#3969). A lock held by a dead pid is reclaimed
// immediately, so a crashed run never wedges the queue. The wait message is logged once per call.
// `isAlive`, `now`, `sleep` and `log` are parameters so tests never touch real processes or time.
// A lock naming our own `pid` is stale by definition — a prior run that crashed and whose pid the
// OS then reused for this one — so it is reclaimed rather than waited on forever.
function acquireSlot({ dir, slots, pid, cwd, isAlive: isPidLive, now, sleep, log, pollMs = 2000, staleUnparseableMs = 600000, staleReclaimMs = 30000, slotsVar = 'CT_TEST_SUITE_SLOTS' }) {
  const isAlive = (holderPid) => holderPid !== pid && isPidLive(holderPid);
  ensureOwnDir(dir);
  let logged = false;
  for (;;) {
    let blocker = null;
    for (let i = 0; i < slots; i++) {
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
      // The lock path is named so a maintainer can delete a lock whose pid was reused by an
      // unrelated long-lived process (isAlive cannot tell it from the run that took the slot).
      log(
        `run-tests.js: waiting for a test-suite slot — held by pid ${blocker.pid} (cwd ${blocker.cwd}) ` +
          `since ${blocker.startedAt}; set ${slotsVar} to raise the limit (lock: ${blocker.lockPath})`,
      );
    }
    sleep(pollMs);
  }
}

// Frees `lockPath` only if it still names `pid`, so a run that lost its lock to a reclaim never
// deletes the new owner's. Never throws: this runs on exit paths where a failure must not mask
// the suite's own exit code.
function releaseSlot(lockPath, pid) {
  try {
    const held = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (held && held.pid === pid) fs.unlinkSync(lockPath);
  } catch (_) {
    // missing, unparseable or already gone — nothing to release
  }
}

// The per-run temp root: a pid-tagged directory under `realTmp` that the suite's children use as
// their TMPDIR, so one run's leaked temp dirs are removable together and attributable to a pid.
function createRunRoot(realTmp, pid) {
  return fs.mkdtempSync(path.join(realTmp, 'ct-testrun-' + pid + '-'));
}

// Removes `ct-testrun-<pid>-*` roots in `dir` whose pid is no longer alive (a killed run never
// reached its own cleanup). Returns the removed paths. One unreadable or undeletable entry must
// not stop the sweep or fail the run, so per-entry errors are swallowed.
function sweepStaleRoots({ dir, isAlive }) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const removed = [];
  for (const entry of entries) {
    const match = entry.isDirectory() && /^ct-testrun-(\d+)-/.exec(entry.name);
    if (!match || isAlive(Number(match[1]))) continue;
    const full = path.resolve(dir, entry.name);
    try {
      fs.rmSync(full, { recursive: true, force: true });
      removed.push(full);
    } catch (_) {
      // leave it for the next sweep
    }
  }
  return removed;
}

module.exports = {
  listTestFiles, buildTestArgs, resolveConcurrency, resolveSlots,
  isPidAlive, ensureOwnDir, acquireSlot, releaseSlot, createRunRoot, sweepStaleRoots, readFileList, slotLane,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  let roots;
  let files;
  if (argv.includes('--files-from')) {
    // A subset plus roots would be ambiguous (which wins?), so the flag stands alone.
    if (argv.length !== 2 || argv[0] !== '--files-from') {
      console.error('run-tests.js: --files-from <list> takes exactly one list file and no root arguments.');
      process.exit(1);
    }
    try {
      const isFile = (entry) => {
        try {
          return fs.statSync(path.resolve(REPO_ROOT, entry)).isFile();
        } catch (_) {
          return false;
        }
      };
      files = readFileList(fs.readFileSync(argv[1], 'utf8'), { exists: isFile })
        .map((entry) => path.relative(REPO_ROOT, path.resolve(REPO_ROOT, entry)));
    } catch (err) {
      console.error(`run-tests.js: --files-from ${argv[1]}: ${err.message}`);
      process.exit(1);
    }
    roots = null;
  } else {
    roots = argv.length ? argv : DEFAULT_ROOTS;
    files = listTestFiles(REPO_ROOT, roots).map((f) => path.relative(REPO_ROOT, f));
  }

  // `node --test` with zero file arguments falls back to its own default-pattern
  // auto-discovery and can exit 0 having run nothing — "the suite gets quieter, not
  // redder" (docs/incident-log.md:421). A rename/typo of a root must fail loudly here,
  // not degrade into a silently-green `npm test`/`npm run test:perf`.
  if (roots !== null && files.length === 0) {
    console.error(
      `run-tests.js: found zero *.test.js files under ${roots.join(', ')} — refusing to run ` +
        "`node --test` with no explicit files (it would silently discover its own defaults " +
        'and exit 0 having run nothing). Check that these directories exist and are non-empty.',
    );
    process.exit(1);
  }

  process.env.CT_HOOKS_GIT_TIMEOUT_MS = process.env.CT_HOOKS_GIT_TIMEOUT_MS || '60000';

  let testArgs;
  try {
    testArgs = buildTestArgs(files, roots, {
      platform: process.platform,
      nodeMajor: Number(process.versions.node.split('.')[0]),
      concurrency: resolveConcurrency(process.env, os.availableParallelism()),
    });
  } catch (err) {
    console.error(`run-tests.js: ${err.message}`);
    process.exit(1);
  }

  // Run roots live under one dedicated parent, so the startup sweep reads a directory that only
  // ever holds run roots instead of scanning the whole real tmpdir.
  const runsDir = path.join(os.tmpdir(), 'ct-test-runs');
  ensureOwnDir(runsDir);
  sweepStaleRoots({ dir: runsDir, isAlive: isPidAlive });

  // A nested run (a test that itself runs this script) inherits CT_TEST_SUITE_SLOT_HELD=1 from
  // the suite that already holds the slot, and must not wait on it.
  let lockPath = null;
  if (process.env.CT_TEST_SUITE_SLOT_HELD !== '1') {
    // The subset leaf sits under the fixed-name slot base, so the base is ownership-checked too.
    const slotBase = process.env.CT_TEST_SUITE_SLOT_DIR || path.join(os.tmpdir(), 'ct-test-suite-slots');
    ensureOwnDir(slotBase);
    const lane = slotLane(slotBase, roots === null);
    lockPath = acquireSlot({
      dir: lane.dir,
      slotsVar: lane.slotsVar,
      slots: resolveSlots(process.env, console.error, lane.slotsVar),
      pid: process.pid,
      cwd: REPO_ROOT,
      isAlive: isPidAlive,
      now: Date.now,
      sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
      log: console.error,
    });
  }

  // From here the slot is held, so a signal must forward to the child and let the cleanup below
  // run rather than kill the runner with the lock and run root left behind. (While waiting for a
  // slot nothing is held yet, so the default exit is right.) A signal that lands before the child
  // exists is applied as soon as it does.
  let child = null;
  let forwarded = null;
  // `node --test` dies on SIGHUP by default, orphaning its workers, but shuts them down on SIGTERM —
  // so SIGHUP reaches the child as SIGTERM. The runner's own exit code still follows `forwarded`.
  const childSignal = (sig) => (sig === 'SIGHUP' ? 'SIGTERM' : sig);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      forwarded = sig;
      if (child) child.kill(childSignal(sig));
    });
  }

  let runRoot = null;
  const cleanup = () => {
    if (runRoot) {
      try {
        fs.rmSync(runRoot, { recursive: true, force: true });
      } catch (err) {
        console.error(`run-tests.js: could not remove ${runRoot}: ${err.message}`);
      }
      runRoot = null;
    }
    if (lockPath) {
      releaseSlot(lockPath, process.pid);
      lockPath = null;
    }
  };

  try {
    runRoot = createRunRoot(runsDir, process.pid);
    child = spawn(process.execPath, testArgs, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: { ...process.env, TMPDIR: runRoot, TMP: runRoot, TEMP: runRoot, CT_TEST_SUITE_SLOT_HELD: '1' },
    });
  } catch (err) {
    cleanup();
    throw err;
  }
  if (forwarded) child.kill(childSignal(forwarded));

  // A spawn failure emits 'error' (and no 'exit'): clean up, then surface it as an uncaught throw.
  child.on('error', (err) => {
    cleanup();
    throw err;
  });
  child.on('exit', (code, signal) => {
    cleanup();
    if (forwarded) process.exit(128 + os.constants.signals[forwarded]);
    if (signal) process.exit(128 + os.constants.signals[signal]);
    process.exit(code === null ? 1 : code);
  });
}
