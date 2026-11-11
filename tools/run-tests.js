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
// go instead, because ~780 paths overflow the 32,767-char command line (#3316). A `--files-from`
// subset has no globs to fall back to, so on Windows one whose command line would overflow runs
// the full suite instead, with a named reason on stderr (#4134).
//
// The slot lock itself lives in plugin/bin/lib/suite-slot.js, shared with bin/verify.js.
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
// nested run skips the slot). Waiters are served in arrival order through `ticket-<seq>.json` files
// beside the slot locks (#4333); a checkout of this file from before that change ignores tickets and
// can jump the queue until its worktree catches up. A `--files-from` subset takes its slot from a
// separate lane (`<slot dir>/subset`, CT_TEST_SUBSET_SLOTS, default 1): a seconds-long impact
// subset must not queue behind a sibling's full suite, and two subsets still never run at once
// (#4024).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  isPidAlive, ensureOwnDir, acquireSlot, releaseSlot, slotLane, resolveSlots, defaultSlotBase,
} = require('../plugin/bin/lib/suite-slot');

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

// Matches a positive integer with no sign, fraction, or leading zero — the shape
// `CT_TEST_CONCURRENCY` accepts (the slot variables share it in suite-slot.js).
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

// The Windows `CreateProcess` command-line limit, in characters (#3316).
const WIN32_COMMAND_LINE_MAX = 32767;

// Why an explicit `--files-from` subset cannot be passed to `node --test` as-is: null when it
// fits (always off win32), else a sentence naming the line length and the limit. The line is
// counted as the space-separated `execPath args...` with every argument charged its length plus
// two quotes and a separator, and the last separator does not exist. That is an upper bound, not
// the exact length: libuv quotes an argument only when it holds a space, tab or quote, so most
// arguments cost two characters less. Keep the estimate pessimistic. `args` is `--test`,
// `--test-concurrency=<n>` and then the files, so the file count is `args.length - 2`.
// Pure: `platform` is a parameter, never read from `process`.
function subsetFallbackReason(execPath, args, { platform }) {
  if (platform !== 'win32') return null;
  const len = [execPath, ...args].reduce((n, a) => n + a.length + 3, 0) - 1;
  if (len < WIN32_COMMAND_LINE_MAX) return null;
  return `a ${args.length - 2}-file subset needs a ${len}-character command line, over the Windows limit of ${WIN32_COMMAND_LINE_MAX}`;
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
  listTestFiles, buildTestArgs, resolveConcurrency, resolveSlots, subsetFallbackReason, WIN32_COMMAND_LINE_MAX,
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
    const argOptions = {
      platform: process.platform,
      nodeMajor: Number(process.versions.node.split('.')[0]),
      concurrency: resolveConcurrency(process.env, os.availableParallelism()),
    };
    testArgs = buildTestArgs(files, roots, argOptions);
    // A subset too long for the Windows command line has no globs of its own, so it runs the
    // full suite (and takes the full-suite slot lane below) rather than failing to spawn (#4134).
    const reason = roots === null ? subsetFallbackReason(process.execPath, testArgs, { platform: process.platform }) : null;
    if (reason) {
      console.error(`run-tests.js: --files-from ${argv[1]}: ${reason} — running the full suite instead.`);
      roots = DEFAULT_ROOTS;
      files = listTestFiles(REPO_ROOT, roots).map((f) => path.relative(REPO_ROOT, f));
      testArgs = buildTestArgs(files, roots, argOptions);
    }
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
    const slotBase = defaultSlotBase(process.env, os.tmpdir());
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
  // slot nothing is held yet, so the default exit is right; it leaves only the waiter's ticket,
  // which reads as stale once the pid is gone.) A signal that lands before the child exists is
  // applied as soon as it does.
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
