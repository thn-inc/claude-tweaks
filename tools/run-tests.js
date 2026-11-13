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
// A bare local run (no arguments, `CI` unset or empty) selects by impact (#5319): it reads the
// test-impact map for the changes since the integration base (the selection `bin/verify.js` makes
// for a scoped run) and runs only the test files that read a changed path, printing one stderr line
// that names the count and the base. Whatever keeps it from narrowing — a missing map, a path a
// full-suite rule matches, an unreadable declaration, an unresolvable base, any error — runs the
// whole suite with the one-line reason on stderr, never a smaller run and never an exception. No
// selected file exits 0 with one line. `--full` runs the whole suite here; `CI` set (any non-empty
// value), `--shard`, `--record-durations`, root arguments and `--files-from` never consult the map,
// and neither does a run that is a child of `verify.js` or of another run (CT_TEST_SUITE_SLOT_HELD=1):
// it does what its parent asked, so only a top-level plain run selects.
//
// `--shard <i>/<n>` runs only the i-th of n disjoint slices of the root set, so CI can spread the suite
// across parallel jobs (`.github/workflows/test.yml`). Every shard computes the same partition from the
// same checkout: files are weighted by `tools/test-durations.json` (an unmeasured file weighs the median
// measured file) plus a fixed per-file startup cost, then dealt heaviest-first onto the lightest shard.
// The durations only balance the slices; a missing or unreadable file is named on stderr and every file
// weighs the same, and no file is ever dropped. `--record-durations <out>` runs the whole root set with
// an extra reporter (`tools/test-durations-reporter.js`) that writes that durations file.
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
const { spawn, spawnSync, execFileSync } = require('child_process');
const {
  isPidAlive, ensureOwnDir, acquireSlot, releaseSlot, slotLane, resolveSlots, defaultSlotBase, SLOT_DIR_VAR,
} = require('../plugin/bin/lib/suite-slot');

// This runner's name on the shared slot lock's log lines; the shipped module's default is neutral,
// so every call below passes it.
const LABEL = 'run-tests.js';

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

// `<index>/<total>`, both positive integers with no leading zero, index <= total.
const SHARD_RE = /^([1-9]\d*)\/([1-9]\d*)$/;

function parseShard(value) {
  const m = SHARD_RE.exec(String(value));
  if (!m) throw new Error(`--shard takes <index>/<total>, both positive integers (got ${JSON.stringify(value)})`);
  const index = Number(m[1]);
  const total = Number(m[2]);
  if (index > total) throw new Error(`--shard index ${index} is above the total ${total}`);
  return { index, total };
}

// The committed per-file durations `--shard` balances by, and what `--record-durations` writes.
const DURATIONS_FILE = path.join('tools', 'test-durations.json');
// A test process's startup and require cost, which the per-test durations leave out. Without it the
// ~1,000 sub-second files weigh almost nothing and pile onto whichever shard looks lightest.
const PER_FILE_OVERHEAD_MS = 150;
// An unmeasured file's weight when nothing is measured at all.
const DEFAULT_FILE_MS = 500;

// Parses a durations file: `{ "files": { "<repo-relative posix path>": <ms> } }`. Throws on any other
// shape, so the caller can name the problem and fall back to equal weights.
function readDurations(text) {
  const parsed = JSON.parse(text);
  const files = parsed && parsed.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('it has no "files" object');
  const durations = new Map();
  for (const [file, ms] of Object.entries(files)) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
      throw new Error(`its entry ${JSON.stringify(file)} is not a non-negative number`);
    }
    durations.set(file, ms);
  }
  return durations;
}

const posixKey = (file) => file.split(/[\\/]/).join('/');
const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Deals `files` (repo-relative) into `total` shards: heaviest first, each onto the shard with the
// smallest estimated load (lowest index on a tie), so the result depends only on the inputs and every
// shard job computes the same partition. Returns one `{ files, ms, unmeasured }` per shard, its files
// sorted. Every input file lands in exactly one shard.
// Pure: `durations` is a Map from posix path to ms.
function assignShards(files, durations, total) {
  const measured = files.map((f) => durations.get(posixKey(f))).filter((ms) => ms !== undefined).sort((a, b) => a - b);
  const fallbackMs = measured.length ? measured[Math.floor(measured.length / 2)] : DEFAULT_FILE_MS;
  const weighted = files.map((file) => {
    const ms = durations.get(posixKey(file));
    return { file, measured: ms !== undefined, ms: (ms === undefined ? fallbackMs : ms) + PER_FILE_OVERHEAD_MS };
  });
  weighted.sort((a, b) => b.ms - a.ms || byPath(a.file, b.file));
  const shards = Array.from({ length: total }, () => ({ files: [], ms: 0, unmeasured: 0 }));
  for (const w of weighted) {
    let lightest = 0;
    for (let i = 1; i < total; i++) if (shards[i].ms < shards[lightest].ms) lightest = i;
    shards[lightest].files.push(w.file);
    shards[lightest].ms += w.ms;
    if (!w.measured) shards[lightest].unmeasured += 1;
  }
  for (const s of shards) s.files.sort(byPath);
  return shards;
}

// Where a `--record-durations <out>` run's reporter writes until the run ends: beside `out`, tagged
// with the runner's pid, so the suite (which reads the committed durations file) never sees it
// truncated mid-run.
function durationsPartialPath(out, pid) {
  return `${path.resolve(out)}.partial-${pid}`;
}

// Moves a finished recording over `out`. A run killed by a signal, or a reporter that wrote nothing,
// leaves `out` as it was and the partial file removed. Returns a stderr line, never throws.
function finishRecording(out, pid, { signalled }) {
  const partial = durationsPartialPath(out, pid);
  let size = 0;
  try {
    size = fs.statSync(partial).size;
  } catch (_) {
    // no partial file: the reporter never opened it
  }
  if (!signalled && size > 0) {
    try {
      fs.renameSync(partial, path.resolve(out));
      return `run-tests.js: recorded test durations to ${out}`;
    } catch (err) {
      return `run-tests.js: could not move ${partial} to ${out}: ${err.message}`;
    }
  }
  fs.rmSync(partial, { force: true });
  return `run-tests.js: ${out} left unchanged — ${signalled ? 'the run was interrupted' : 'the durations reporter wrote nothing'}`;
}

// Pulls `--shard <v>` / `--shard=<v>`, `--record-durations <path>` and `--full` out of argv. Returns
// the remaining arguments with the two values (null when absent) and `full` (a boolean). Throws on a
// flag with no value.
function extractRunFlags(argv) {
  const rest = [];
  let shard = null;
  let recordDurations = null;
  let full = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--full') {
      full = true;
    } else if (arg.startsWith('--shard=')) {
      shard = arg.slice('--shard='.length);
    } else if (arg === '--shard' || arg === '--record-durations') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      if (arg === '--shard') shard = value;
      else recordDurations = value;
      i += 1;
    } else {
      rest.push(arg);
    }
  }
  return { rest, shard, recordDurations, full };
}

// What a run does about impact selection (#5319), from the arguments and the environment alone:
// 'listed' (a `--files-from` list names the files), 'whole' (`--full`, a shard, a recording, explicit
// roots, CI set — any non-empty value, as resolveConcurrency reads it — or a held suite slot,
// CT_TEST_SUITE_SLOT_HELD=1) or 'select' (consult the impact map). `--full` and `--files-from` together
// are contradictory and throw. Pure: `env` is a parameter, never read from `process`.
function resolveRunMode({ rest, shard, recordDurations, full, env }) {
  if (rest.includes('--files-from')) {
    if (full) throw new Error('--full cannot be combined with --files-from');
    return 'listed';
  }
  if (full || shard || recordDurations !== null || rest.length > 0 || (typeof env.CI === 'string' && env.CI !== '')) return 'whole';
  // A bare run under a held slot is a child of verify.js or of another run: it does what its parent asked.
  if (env.CT_TEST_SUITE_SLOT_HELD === '1') return 'whole';
  return 'select';
}

// The text up to the first line break, trimmed: a reason is always one stderr line.
const oneLine = (text) => String(text).split(/\r?\n/)[0].trim();

// The test files a plain local run would run, from the impact map and the changes since the
// integration base. `files === null` means "run the whole suite" and `reason` says why; otherwise
// `files` is the sorted, repo-relative, on-disk selection (possibly empty). Never throws: any error
// becomes a `selection failed: ...` reason, so a failure can only widen the run. The verify modules
// load lazily, so a checkout without them degrades to that reason instead of failing at require time.
function selectChangedTests({ repoRoot, deps = {} }) {
  const none = (reason, base = null) => ({ files: null, reason: oneLine(reason), base, total: 0, otherSuites: [] });
  try {
    const d = { ...realSelectionDeps(repoRoot), ...deps };
    const read = d.readDeclaration(path.join(repoRoot, '.claude-tweaks', 'verify-scope.json'));
    if (!read.ok) return none(read.errors[0]);
    if (!read.decl) return none('no declaration');
    const decl = read.decl;
    if (!decl.impact) return none('the declaration has no impact block');
    const execImpl = (cmd, args, options) => execFileSync(cmd, args, { ...options, cwd: repoRoot });
    const base = d.resolveBase({ integrationBranch: 'main', execImpl });
    const changed = d.changedFiles({ base, execImpl, withStatus: true });
    // The context verify.js --scope builds, from the same helper, so the two select alike.
    const impact = d.checkoutImpactContext({ decl, cwd: repoRoot, runFetch: d.runFetch, locate: d.gitLocations, load: d.loadImpactContext });
    const sel = d.selectScope({ decl, files: changed.files, stamp: null, statuses: changed.statuses || null, impact, fallbackBase: base });
    const imp = sel.impact;
    if (!imp) return none('the declaration has no impact block', base);
    if (imp.superseded) return none(`superseded by a full-suite rule (${imp.supersedingPaths.slice(0, 3).join(', ')})`, base);
    if (imp.files === null) return none(imp.fallback || 'impact selection returned no file list', base);
    // Suites besides the impact suite that the changes select (this repo's `journeys`): not run here, so named.
    const otherSuites = Array.isArray(sel.suites) ? sel.suites.filter((s) => s !== decl.impact.suite).sort(byPath) : [];
    return { files: imp.files.filter((f) => d.exists(f)).sort(byPath), reason: null, base, total: d.countTests(), otherSuites };
  } catch (err) {
    // A ChangedFilesError (an unresolvable base or diff) already names its own problem: bare, from either call.
    if (err && err.name === 'ChangedFilesError') return none(err.message);
    return none(`selection failed: ${err.message}`);
  }
}

// The real collaborators `selectChangedTests` uses unless a test injects its own.
function realSelectionDeps(repoRoot) {
  const verifyLib = (name) => require(`../plugin/bin/lib/verify/${name}`);
  const { readDeclaration } = verifyLib('declaration');
  const { resolveBase, changedFiles } = verifyLib('changed-files');
  const { gitLocations, loadImpactContext, checkoutImpactContext, runImpactFetch } = verifyLib('impact');
  const { selectScope } = verifyLib('scope');
  return {
    readDeclaration, resolveBase, changedFiles, gitLocations, loadImpactContext, checkoutImpactContext, selectScope,
    // verify.js's bounded fetch, announced first: a fetch can take up to 120 s of a plain run.
    runFetch: (command, cwd) => {
      console.error('run-tests.js: fetching the test-impact map (up to 120 s)');
      return runImpactFetch(command, cwd);
    },
    exists: (entry) => {
      try {
        return fs.statSync(path.resolve(repoRoot, entry)).isFile();
      } catch (_) {
        return false;
      }
    },
    countTests: () => listTestFiles(repoRoot, DEFAULT_ROOTS).length,
  };
}

// What to do with a selection and the one stderr line that says so: 'whole' (no narrowing — run
// everything, naming why), 'none' (nothing selected — exit 0 before taking a slot) or 'subset'.
// Pure: a function of the selection result alone.
function planDefaultRun({ files, reason, base, total, otherSuites = [] }) {
  const base9 = base === null ? '' : String(base).slice(0, 9);
  const also = otherSuites.length ? ` — also selected: ${otherSuites.join(', ')} (not run here; \`node plugin/bin/verify.js --scope .claude-tweaks/verify-scope.json --integration-branch main\` runs them)` : '';
  if (files === null) {
    return { action: 'whole', files: null, line: `run-tests.js: running the whole suite — impact selection could not narrow it: ${oneLine(reason)}` };
  }
  if (files.length === 0) {
    return { action: 'none', files, line: `run-tests.js: no test file selected for changes since ${base9} — nothing to run; \`npm test -- --full\` runs the whole suite here${also}` };
  }
  return {
    action: 'subset',
    files,
    line: `run-tests.js: impact-selected ${files.length} of ${total} test files for changes since ${base9} — \`npm test -- --full\` runs the whole suite here; CI runs it on every PR${also}`,
  };
}

// The bare run's selection step (#5319): prints the plan's one line, exits 0 when nothing is selected
// (before the caller takes any slot), and returns the subset to run, or null for the whole suite.
function applyDefaultSelection({ select, log, exit }) {
  const plan = planDefaultRun(select());
  log(plan.line);
  if (plan.action === 'none') exit(0);
  return plan.action === 'subset' ? plan.files : null;
}

// Returns a new env with git's auto-maintenance switched off, via env-carried config (appended after
// any inherited GIT_CONFIG_* so it never clobbers them). Never mutates `env`; a malformed inherited
// GIT_CONFIG_COUNT is left alone rather than guessed at.
function gitFixtureConfigEnv(env) {
  const out = { ...env };
  if (env.GIT_CONFIG_COUNT !== undefined && !/^\d+$/.test(env.GIT_CONFIG_COUNT)) return out;
  const n = env.GIT_CONFIG_COUNT === undefined ? 0 : Number(env.GIT_CONFIG_COUNT);
  out.GIT_CONFIG_COUNT = String(n + 2);
  out[`GIT_CONFIG_KEY_${n}`] = 'maintenance.auto';
  out[`GIT_CONFIG_VALUE_${n}`] = 'false';
  out[`GIT_CONFIG_KEY_${n + 1}`] = 'gc.auto';
  out[`GIT_CONFIG_VALUE_${n + 1}`] = '0';
  return out;
}

module.exports = {
  gitFixtureConfigEnv,
  listTestFiles, buildTestArgs, resolveConcurrency, resolveSlots, subsetFallbackReason, WIN32_COMMAND_LINE_MAX,
  isPidAlive, ensureOwnDir, acquireSlot, releaseSlot, createRunRoot, sweepStaleRoots, readFileList, slotLane,
  parseShard, readDurations, assignShards, extractRunFlags, durationsPartialPath, finishRecording,
  resolveRunMode, selectChangedTests, realSelectionDeps, planDefaultRun, applyDefaultSelection,
  DURATIONS_FILE, PER_FILE_OVERHEAD_MS, DEFAULT_FILE_MS,
};

if (require.main === module) {
  let argv;
  let shard = null;
  let recordDurations = null;
  let mode;
  try {
    const flags = extractRunFlags(process.argv.slice(2));
    argv = flags.rest;
    shard = flags.shard === null ? null : parseShard(flags.shard);
    recordDurations = flags.recordDurations;
    mode = resolveRunMode({ ...flags, env: process.env });
    // A partial run must never overwrite the committed durations, and a subset has no shards.
    if (shard && argv.includes('--files-from')) throw new Error('--shard cannot be combined with --files-from');
    if (recordDurations !== null && (shard || argv.includes('--files-from'))) {
      throw new Error('--record-durations needs the whole root set, so it cannot be combined with --shard or --files-from');
    }
  } catch (err) {
    console.error(`run-tests.js: ${err.message}`);
    process.exit(1);
  }
  let roots;
  let files;
  // A bare run selects by impact (#5319): the selection runs before any slot is taken, so a no-op
  // run never queues and the subset and whole-suite lanes are chosen after it.
  let impactSubset = null;
  if (mode === 'select') {
    impactSubset = applyDefaultSelection({
      select: () => selectChangedTests({ repoRoot: REPO_ROOT }),
      log: (line) => console.error(line),
      exit: (code) => process.exit(code),
    });
  }
  if (impactSubset !== null) {
    roots = null;
    files = impactSubset;
  } else if (argv.includes('--files-from')) {
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

  if (shard) {
    let durations = new Map();
    try {
      durations = readDurations(fs.readFileSync(path.join(REPO_ROOT, DURATIONS_FILE), 'utf8'));
    } catch (err) {
      console.error(`run-tests.js: ${DURATIONS_FILE} is unusable (${err.message}) — every file weighs the same, so the shards are unbalanced.`);
    }
    const shards = assignShards(files, durations, shard.total);
    const mine = shards[shard.index - 1];
    const totalMs = shards.reduce((n, s) => n + s.ms, 0);
    console.error(
      `run-tests.js: shard ${shard.index}/${shard.total} — ${mine.files.length} of ${files.length} files, ` +
        `estimated ${Math.round(mine.ms / 1000)}s of ${Math.round(totalMs / 1000)}s` +
        (mine.unmeasured ? `, ${mine.unmeasured} unmeasured in ${DURATIONS_FILE}` : ''),
    );
    // More shards than files: this slice is legitimately empty, and `node --test` with no files would
    // discover its own defaults instead of running nothing.
    if (mine.files.length === 0) process.exit(0);
    files = mine.files;
  }

  process.env.CT_HOOKS_GIT_TIMEOUT_MS = process.env.CT_HOOKS_GIT_TIMEOUT_MS || '60000';

  let testArgs;
  try {
    const argOptions = {
      platform: process.platform,
      nodeMajor: Number(process.versions.node.split('.')[0]),
      concurrency: resolveConcurrency(process.env, os.availableParallelism()),
    };
    // A shard is an explicit file list on every platform: its root globs would select the whole set.
    testArgs = buildTestArgs(files, shard ? null : roots, argOptions);
    if (shard) {
      const tooLong = subsetFallbackReason(process.execPath, testArgs, { platform: process.platform });
      if (tooLong) throw new Error(`--shard ${shard.index}/${shard.total}: ${tooLong}; use more shards`);
    }
    if (recordDurations !== null) {
      // Two reporters: the durations file, and the output this run would print anyway. node opens
      // (truncates) a reporter destination when the run starts, and the suite reads the committed
      // durations file, so the reporter writes beside it and the file is replaced only when the run
      // ends (see the exit handler below).
      testArgs.splice(
        2,
        0,
        `--test-reporter=${path.join(__dirname, 'test-durations-reporter.js')}`,
        `--test-reporter-destination=${durationsPartialPath(recordDurations, process.pid)}`,
        `--test-reporter=${process.stdout.isTTY ? 'spec' : 'tap'}`,
        '--test-reporter-destination=stdout',
      );
    }
    // A subset too long for the Windows command line has no globs of its own, so it runs the
    // full suite (and takes the full-suite slot lane below) rather than failing to spawn (#4134).
    const reason = roots === null ? subsetFallbackReason(process.execPath, testArgs, { platform: process.platform }) : null;
    if (reason) {
      const what = impactSubset !== null ? 'the impact-selected subset' : `--files-from ${argv[1]}`;
      console.error(`run-tests.js: ${what}: ${reason} — running the full suite instead.`);
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
    ensureOwnDir(slotBase, SLOT_DIR_VAR);
    const lane = slotLane(slotBase, roots === null);
    lockPath = acquireSlot({
      dir: lane.dir,
      slotsVar: lane.slotsVar,
      label: LABEL,
      slots: resolveSlots(process.env, console.error, lane.slotsVar, LABEL),
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
      // Every fixture git commit/push started `git maintenance run --auto` (391 processes across six
      // heavy test files, #5297); the env-carried config turns that off for the whole child tree.
      env: { ...gitFixtureConfigEnv(process.env), TMPDIR: runRoot, TMP: runRoot, TEMP: runRoot, CT_TEST_SUITE_SLOT_HELD: '1' },
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
    if (recordDurations !== null) {
      console.error(finishRecording(recordDurations, process.pid, { signalled: Boolean(forwarded || signal) }));
    }
    if (forwarded) process.exit(128 + os.constants.signals[forwarded]);
    if (signal) process.exit(128 + os.constants.signals[signal]);
    process.exit(code === null ? 1 : code);
  });
}
