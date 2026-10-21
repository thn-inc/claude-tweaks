// plugin/bin/lib/verify/baseline.js — baseline adjudication (#3043). When a
// check fails on a checkout with a known environment-specific failure baseline
// (a Windows dev checkout's separator/CRLF failures), this re-runs only the
// failing test files: at the base commit in a scratch detached worktree, and
// — for files existing at base but not proven failing there — once more in
// isolation at HEAD. A file failing at base is baseline; one passing in
// isolation at HEAD is flaky; the rest, including every file absent at base,
// are attributable. Fails closed: anything not classified with evidence (no
// extractable file, a failing entry naming no test file, a fail-fast skip, a
// spawn error, a base run with no numeric exit) is never "fails at base" — a
// base run counts only when its own log names the file as failing with every
// test that fails in it at HEAD, and a file is flaky only when its isolated
// log shows tests ran and passed. An isolated run that fails a test base does
// not cover gets one retry (#3111) before being called attributable — when
// the retry's own failures are covered by base (or it passes cleanly), the
// extra failure did not reproduce and is reported flaky instead. git and
// runOne are injected so the tests never touch a real repo; realGit is the
// CLI's seam.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { substituteFile, describePath } = require('./file-template');
const { toPosix } = require('../shared-primitives');
const {
  sniffFamily, extractFailingFiles, countUnmatchedFailures, fileLevelFailures, failingTestsByFile, parseCounts, stripAnsi,
  specEntryCount, cancelledCount, testTree,
} = require('./extract');

// `warn` and `rmSync` are injectable so a test can force a failed cleanup.
function realGit(cwd, { warn = (line) => process.stderr.write(line), rmSync = fs.rmSync } = {}) {
  // `input`, when given, is piped to the child's stdin (the two batch-check
  // / hash-object calls below); every other call site passes none, and stdin
  // stays closed exactly as it did before `input` existed.
  const git = (args, input) => String(execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'], input, windowsHide: true,
  })).trim();
  return {
    repoRoot: () => git(['rev-parse', '--show-toplevel']),
    resolveCommit: (ref) => {
      // --end-of-options: a ref spelled like a flag is a (non-existent) ref, never a git option.
      try { return git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]) || null; } catch { return null; }
    },
    // `git merge-base --is-ancestor`: exit 0 → true, exit 1 → false; any
    // other failure throws (the caller's adjudication-error path), never a
    // guessed answer.
    isAncestor: (a, b) => {
      try { git(['merge-base', '--is-ancestor', a, b]); return true; } catch (err) {
        if (err && err.status === 1) return false;
        throw err;
      }
    },
    // Existence-at-base and sameness-at-base for every `files` entry (each a
    // repo-root-relative path) in two spawns total, however many files there
    // are: one `cat-file --batch-check` for the base blob sha (a missing
    // object reports `<input> missing`, never a sha), and one
    // `hash-object --stdin-paths` for the working-tree blob (clean filters
    // applied per path, same as `--path=<file>` would, so a CRLF checkout of
    // an unchanged LF file still matches). `root` is passed in rather than
    // re-resolved — the caller already holds it from its own repoRoot() call.
    // A file absent from the working tree is never handed to hash-object —
    // fs.existsSync is not a git spawn, and one missing path would otherwise
    // fail the whole batch, not just that file.
    batchBaseInfo: (sha, files, root) => {
      const result = new Map();
      if (files.length === 0) return result;
      const checkOut = git(['cat-file', '--batch-check=%(objectname)'], `${files.map((f) => `${sha}:${f}`).join('\n')}\n`).split('\n');
      const atBaseSha = files.map((_, i) => {
        const line = checkOut[i] || '';
        return /missing$/.test(line) ? null : line.trim();
      });
      const onDisk = files.map((f) => fs.existsSync(path.join(root, f)));
      const hashable = files.filter((f, i) => atBaseSha[i] !== null && onDisk[i]);
      const hashes = new Map();
      if (hashable.length > 0) {
        const hashOut = git(['hash-object', '--stdin-paths'], `${hashable.map((f) => path.join(root, f)).join('\n')}\n`).split('\n');
        hashable.forEach((f, i) => hashes.set(f, (hashOut[i] || '').trim()));
      }
      files.forEach((f, i) => {
        const exists = atBaseSha[i] !== null;
        result.set(f, { exists, same: exists && hashes.get(f) === atBaseSha[i] });
      });
      return result;
    },
    // Whether `rel` (a relativized, forward-slash path from a log) names a
    // file inside the checkout at `dir` (#3153). A path that relativize()
    // left absolute, or one with a `..` segment anywhere (a log can name
    // `tests/../../x` verbatim), is never inside it.
    inCheckout: (dir, rel) => !path.posix.isAbsolute(rel) && !/^[A-Za-z]:/.test(rel)
      && !rel.split('/').includes('..') && fs.existsSync(path.join(dir, rel)),
    addWorktree: (sha) => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-base-'));
      const dir = path.join(parent, 'wt');
      try {
        git(['worktree', 'add', '--detach', dir, sha]);
      } catch (err) {
        // The caller never learns `dir` on a throw, so its cleanup cannot run — remove the parent here.
        try { rmSync(parent, { recursive: true, force: true }); } catch { /* best effort */ }
        throw err;
      }
      return dir;
    },
    // Never silent: a scratch that survives every attempt is named on stderr
    // with the manual cleanup command. No startup sweep — it could delete a
    // sibling session's live scratch.
    removeWorktree: (dir) => {
      try { git(['worktree', 'remove', '--force', dir]); } catch { /* best effort — rm below */ }
      try { rmSync(path.dirname(dir), { recursive: true, force: true }); } catch { /* best effort */ }
      try { git(['worktree', 'prune']); } catch { /* best effort */ }
      if (fs.existsSync(dir)) {
        warn(`verify.js: could not remove the baseline scratch worktree ${dir} — remove it manually: git worktree remove --force ${dir}\n`);
      }
    },
    // Every worktree `git` currently has registered against this repo, as
    // absolute paths — read-only, so the caller can name a stale one without
    // ever sweeping it itself (#3064).
    listWorktrees: () => {
      try {
        return [...git(['worktree', 'list', '--porcelain']).matchAll(/^worktree (.+)$/gm)].map((m) => m[1]);
      } catch { return []; }
    },
  };
}

// A stale `ct-verify-base-*` scratch worktree left behind by an uncatchable
// kill (Windows TerminateProcess; or, pre-#3064, any POSIX signal) is named
// by the caller, never swept here — a sibling session's own live scratch
// worktree looks identical to `git worktree list`, so removing it
// automatically risks deleting work that is still in flight.
function findStaleBaselineWorktrees(listWorktrees) {
  return listWorktrees().filter((dir) => path.basename(path.dirname(dir)).startsWith('ct-verify-base-'));
}

// The same `/` → `+` log-name slug flaky.js's retryLogName uses, so two
// files never share a log path.
function slug(file) { return file.replace(/[\\/]/g, '+'); }

// After any rejection no worker takes a further item, and the first error is
// thrown only once every in-flight item has settled — so the caller's `finally`
// (scratch-worktree removal) never races a sibling still spawning into it.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  let failed = false;
  let firstError;
  const worker = async () => {
    while (!failed && next < items.length) {
      const k = next++;
      try {
        out[k] = await fn(items[k], k);
      } catch (err) {
        if (!failed) { failed = true; firstError = err; }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failed) throw firstError;
  return out;
}

// Multiset containment: every HEAD failing test name (repeats counted) is
// among the base's for the same file. An unparsed (null) or empty HEAD list
// is never covered.
function coveredBy(headNames, baseNames) {
  if (headNames.length === 0) return false;
  const left = new Map();
  baseNames.forEach((n) => left.set(n, (left.get(n) || 0) + 1));
  return headNames.every((n) => {
    if (n === null || !left.get(n)) return false;
    left.set(n, left.get(n) - 1);
    return true;
  });
}

// Whether Node's module resolution from `dir` would find a node_modules
// directory: at `dir` itself or any ancestor up to the filesystem root.
function hasNodeModulesUpward(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    try { if (fs.statSync(path.join(d, 'node_modules')).isDirectory()) return true; } catch { /* absent */ }
    if (path.dirname(d) === d) return false;
  }
}

// `a` minus `b`, as multisets, in `a`'s order.
function multisetMinus(a, b) {
  const left = new Map();
  b.forEach((n) => left.set(n, (left.get(n) || 0) + 1));
  return a.filter((n) => {
    if (!left.get(n)) return true;
    left.set(n, left.get(n) - 1);
    return false;
  });
}

// Node's own runner-level error diagnostics — an uncaught error from async
// work that outlived its test, and the like. Node reports them as a separate
// file-level failure only when no test in the file failed, so beside any
// failing test they are visible here and nowhere else.
// (TAP prints a test's own console output as `# …` lines, so a bare
// `# Error:` is not Node's; the phrase is in every variant of its diagnostic.)
const RUNNER_ERROR_RE = /^ℹ Error: |generated asynchronous activity after the test ended/m;

// The family of a single-file log that accounts for its whole failure — spec
// or tap, counts parsed, nothing cancelled, no runner-level error diagnostic,
// every failing entry naming a test file, and (spec) entries adding up to
// `ℹ fail` — else null.
function accountedFamily(text, scope) {
  const family = sniffFamily(text);
  if (family !== 'spec' && family !== 'tap') return null;
  if (RUNNER_ERROR_RE.test(text)) return null;
  const counts = parseCounts(text, family);
  if (counts === null || cancelledCount(text, family) !== 0) return null;
  if (countUnmatchedFailures(text, family, scope) > 0) return null;
  if (family === 'spec' && specEntryCount(text) !== counts.fail) return null;
  return family;
}

// A single-file log with every run-specific detail removed: the checkout
// root (each spelling — forward slashes, backslashes, YAML-doubled
// backslashes) and every duration, including the run summary's own (spec
// `ℹ duration_ms`, TAP `# duration_ms`). Two runs of the same file that fail
// the same way produce the same text.
function normalizeLog(text, roots) {
  let out = text.replace(/\r$/gm, '');
  for (const root of roots) {
    // Either input spelling, on any host — not toPosix, which is a no-op on POSIX (#3317).
    const fwd = root.replace(/\\/g, '/').replace(/\/+$/, '');
    const back = fwd.replace(/\//g, '\\');
    for (const spelling of [back.replace(/\\/g, '\\\\'), back, fwd]) out = out.split(spelling).join('<ROOT>');
  }
  return out.replace(/\(\d[\d.]*ms\)/g, '(ms)').replace(/^ℹ duration_ms .*$/gm, '').replace(/^# duration_ms .*$/gm, '').replace(/duration_ms: .*$/gm, '');
}

function readLog(logPath) {
  try { return stripAnsi(fs.readFileSync(logPath, 'utf8')); } catch { return null; }
}

// #3167: realpath a directory before it is ever compared against a node
// --test log's own printed paths. On macOS `os.tmpdir()` — and so the
// `--baseline` scratch worktree created under it — can sit behind a symlink
// (`/var` -> `/private/var`), while node reports the real path.
// `extract.js`'s `relativize()` does a plain string-prefix compare, so a
// symlinked dir never matches and every file under it is misclassified
// `attributable`. Fails open to the original value — tests pass
// non-existent paths (`/repo`, `/scratch`) that cannot be resolved.
function tryRealpath(dir) {
  try { return fs.realpathSync(dir); } catch { return dir; }
}

// The ineligible reason for a HEAD-side failing entry that named a real test
// file — just one absent from this checkout — rather than naming no test
// file at all (#3153 final-review finding 2).
function absentFromCheckoutReason(n, checkName) {
  return `absent-from-checkout: ${n} failing ${n === 1 ? 'entry names' : 'entries name'} only paths absent from the checkout in ${checkName}`;
}

// Conventional process exit codes for an unhandled signal (128 + signal
// number) — what every shell and CI runner already expects a killed process
// to report (#3064).
const SIGNAL_EXIT_CODES = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };

async function adjudicate({
  checks, baselineCmds, base, baseSha, cwd = null, logDir, runOne, spawnImpl, now = Date.now,
  envOf = () => null, timeoutOf = () => null, git, concurrency = 4, env = process.env, computeFixed = true,
  platform = process.platform,
}) {
  const header = { base, baseSha };
  const ineligible = (reason) => ({ ...header, eligible: false, reason });
  const work = [];
  const acceptedChecks = [];
  const headDir = tryRealpath(cwd || process.cwd());
  // Every log is read against the checkout it ran in, and only a path present
  // there names a failing file (#3153).
  const at = (dir) => ({ cwd: dir, exists: (rel) => git.inCheckout(dir, rel) });
  for (const c of checks.filter((x) => x.skipped || x.exitCode !== 0)) {
    if (c.skipped) return ineligible(`${c.name} skipped (${c.skipped})`);
    if (c.spawnError !== undefined) return ineligible(`${c.name} could not spawn`);
    if (typeof c.exitCode !== 'number') return ineligible(`${c.name} exited without a numeric code`);
    const template = baselineCmds.get(c.name);
    if (!template) return ineligible(`no --baseline-cmd for failing check ${c.name}`);
    const text = readLog(c.logPath);
    if (text === null) return ineligible(`${c.name} log unreadable`);
    const family = sniffFamily(text);
    const files = extractFailingFiles(text, family, at(headDir));
    if (files.length === 0) {
      // When dropping `exists` alone would have named a file, every entry
      // here did name a test file — just one absent from this checkout, not
      // "no test file" (#3153 final-review finding 2).
      if (extractFailingFiles(text, family, { cwd: headDir }).length > 0) {
        return ineligible(absentFromCheckoutReason(countUnmatchedFailures(text, family, at(headDir)), c.name));
      }
      return ineligible(`no-parse: no failing test file extractable from ${c.name}`);
    }
    // The failing-file list must account for the whole failure. Only spec
    // and tap have a guard that proves it; their summary counts must parse
    // (a truncated log has none).
    if (family !== 'spec' && family !== 'tap') {
      return ineligible(`${c.name} output family ${family} has no failure-accounting guard`);
    }
    const counts = parseCounts(text, family);
    if (counts === null) {
      return ineligible(`${c.name} summary counts unparsed (family ${family}) — log truncated or unrecognized`);
    }
    // A failing entry extractFailingFiles dropped means `files` is an
    // undercount — classifying the rest could return `pass` over a failure
    // nothing adjudicated.
    const unmatched = countUnmatchedFailures(text, family, at(headDir));
    if (unmatched > 0) {
      // Same distinction as above: when dropping `exists` alone would have
      // matched every entry, the gap is entirely paths absent from this
      // checkout, not entries naming no test file (#3153 finding 2).
      if (countUnmatchedFailures(text, family, { cwd: headDir }) === 0) {
        return ineligible(absentFromCheckoutReason(unmatched, c.name));
      }
      return ineligible(`unclassified failure(s): ${unmatched} failing ${unmatched === 1 ? 'entry names' : 'entries name'} no test file in ${c.name}`);
    }
    if (family === 'spec') {
      // The spec reporter lists a cancelled test (a timeout under load) in the
      // failing section while `ℹ fail` excludes it, so the full run's entries
      // add up to fail + cancelled. A cancelled HEAD test is then held to the
      // usual evidence: it fails at base, or shows its own pass in isolation.
      const entries = specEntryCount(text);
      const cancelled = cancelledCount(text, family) || 0;
      if (entries !== counts.fail + cancelled) {
        const accounted = cancelled ? `ℹ fail ${counts.fail} + ℹ cancelled ${cancelled}` : `ℹ fail ${counts.fail}`;
        return ineligible(`${c.name} failing entries (${entries}) do not account for ${accounted}`);
      }
    }
    acceptedChecks.push(c);
    const headFileLevel = fileLevelFailures(text, family, at(headDir));
    const headTests = failingTestsByFile(text, family, at(headDir));
    const headLocated = failingTestsByFile(text, family, { ...at(headDir), located: true });
    for (const file of files) {
      const subst = substituteFile(template, file, { platform });
      if (!subst.ok) return ineligible(`${c.name} failing file ${describePath(file)} cannot be handed to the shell safely (${subst.reason})`);
      work.push({
        check: c.name, file, command: subst.command,
        headFileLevel: headFileLevel.has(file), headTests: headTests.get(file) || [], headLocated: headLocated.get(file) || [],
      });
    }
  }

  // A --cwd subdir: failing files are relative to it, so the base-side path
  // and cwd are offset by the same subdir (Review Focus 5). A --cwd that does
  // not sit under git's own toplevel spelling (a junction, a subst drive, an
  // 8.3 name) would put the base-side run outside the scratch worktree —
  // possibly onto HEAD's own tree — so it is never adjudicated.
  // Realpath'd like headDir (#3167), or a symlinked toplevel spelling would
  // put an ordinary in-repo cwd outside the repository root.
  const root = tryRealpath(git.repoRoot());
  const sub = toPosix(path.relative(root, headDir));
  if (sub === '..' || sub.startsWith('../') || path.isAbsolute(sub)) {
    return ineligible(`working directory ${headDir} does not resolve under the repository root ${root}`);
  }
  const repoRel = (file) => (sub ? `${sub}/${file}` : file);
  // One batched call for every failing file's existence-at-base and
  // sameness-at-base, instead of up to four per-file git spawns (#3070) — the
  // repo root above is passed straight through rather than resolved again.
  const baseInfo = git.batchBaseInfo(baseSha, work.map((w) => repoRel(w.file)), root);
  const atBase = work.map((w) => baseInfo.get(repoRel(w.file)).exists);
  const unchanged = work.map((w) => baseInfo.get(repoRel(w.file)).same);
  let scratch = null;
  let signalHandlers = [];
  // #3063: a single-file run bounds at the same timeout as the check's own
  // full-suite --cmd-timeout (a generous bound — one file should finish
  // well inside the budget the whole suite gets) when the caller declared
  // one; absent a declared timeout this stays null, unchanged from before.
  const run = (w, kind, dir) => runOne({
    name: `${w.check}-${kind}-${slug(w.file)}`, command: w.command, logDir, spawnImpl, now, cwd: dir,
    env: envOf(w.check), timeout: timeoutOf(w.check),
  });
  const headResolvesDeps = Boolean(env.NODE_PATH) || hasNodeModulesUpward(headDir);
  try {
    if (atBase.some(Boolean)) {
      // While the scratch worktree exists, a Ctrl-C or kill removes it
      // before exiting with the signal's conventional code (128 + signal
      // number) — otherwise the process ends before the `finally` below
      // ever runs, leaving the worktree and its checkout behind with no
      // trace (#3064). Registered before addWorktree, not after: git
      // registers the worktree before its synchronous call returns, and a
      // signal landing in that gap would otherwise take the default action.
      // With a listener installed, Node defers the signal until the sync call
      // returns, so `scratch` is already set when the handler runs.
      // Deregistered in `finally` either way, so a clean completion never
      // leaks a listener into the next adjudicate() call in the same process.
      signalHandlers = Object.entries(SIGNAL_EXIT_CODES).map(([sig, code]) => [sig, () => { if (scratch) git.removeWorktree(scratch); process.exit(code); }]);
      for (const [sig, handler] of signalHandlers) process.on(sig, handler);
      // Realpath'd like headDir (#3167): addWorktree may return a symlinked path.
      scratch = tryRealpath(git.addWorktree(baseSha));
    }
    const baseDir = scratch && (sub ? path.join(scratch, ...sub.split('/')) : scratch);
    const baseRuns = await pool(work, concurrency, (w, k) => (atBase[k] ? run(w, 'baseline', baseDir) : null));
    // A numeric non-zero exit alone proves nothing (a typo'd template, a scratch
    // tree with no node_modules and a shell syntax error all exit non-zero):
    // the base run's own log must name this very file as failing, under the
    // same accounting guards as HEAD's, with nothing cancelled and no failure
    // that timed out or was cancelled (it did not finish — no evidence; the
    // whole base log is then unproven). `located` keys each failure by its
    // failing site (`name@line:col`, file-level ones included). `qualified`
    // is the base tree's failing points by suite path, kept only when that
    // path is unique in the tree — and none at all from a malformed tree.
    const baseEv = baseRuns.map((r, k) => {
      if (r === null || typeof r.exitCode !== 'number' || r.exitCode === 0) return null;
      const text = readLog(r.logPath);
      if (text === null) return null;
      const family = accountedFamily(text, at(baseDir));
      if (family === null) return null;
      const file = work[k].file;
      const located = failingTestsByFile(text, family, { ...at(baseDir), located: true }).get(file);
      const conclusive = failingTestsByFile(text, family, { ...at(baseDir), conclusiveOnly: true }).get(file);
      if (!located || !conclusive || conclusive.length !== located.length) return null;
      const tree = testTree(text, family);
      const qualified = tree.wellFormed ? tree.failed.filter((p) => tree.paths.get(p) === 1) : [];
      return { text, located, qualified, fileLevel: fileLevelFailures(text, family, at(baseDir)).has(file) };
    });
    // Every file present at base takes one isolated HEAD run. A file absent
    // at base is new on this branch: attributable outright — an isolated pass
    // must never let a flaky verdict cover a new file.
    const headRuns = await pool(work, concurrency, (w, k) => (atBase[k] ? run(w, 'isolated', cwd) : null));
    // A test file that does not load at all has no tests to compare, so it is
    // baseline only when it is wholly file-level at base and in the full run,
    // unchanged, failing at the same sites (a load failure at 1:1 never covers
    // a file-scoped hook failure), and its isolated HEAD log is the base log
    // once roots and durations are removed — the same error, not merely the
    // same site. A scratch worktree carries no untracked dependencies, so a
    // load failure there is not distinguishable from a missing install: it
    // counts only when HEAD resolves no dependencies either — Node's own
    // resolution: no node_modules at the HEAD directory or any ancestor, and
    // no NODE_PATH (inherited or the check's own --cmd-env).
    const failsToLoadAtBase = (k) => {
      const ev = baseEv[k];
      const r = headRuns[k];
      if (!ev || !ev.fileLevel || !work[k].headFileLevel || !unchanged[k] || !coveredBy(work[k].headLocated, ev.located)) return false;
      if (headResolvesDeps || (envOf(work[k].check) || {}).NODE_PATH) return false;
      if (!r || typeof r.exitCode !== 'number' || r.exitCode === 0) return false;
      const text = readLog(r.logPath);
      return text !== null && normalizeLog(text, [root]) === normalizeLog(ev.text, [scratch]);
    };
    // A full-run failing test passed in the isolated log only when its leaf
    // name occurs there exactly once and that once is a pass. Absence is no
    // evidence: a test that never ran (killed mid-file, skipped, filtered out)
    // proves nothing.
    const passedIn = (tree) => (n) => n !== null && tree.all.get(n) === 1 && tree.passed.get(n) === 1;
    // Flaky is symmetric evidence: the isolated run exited 0, its log accounts
    // for itself (nothing cancelled), tests actually ran and passed (an
    // all-skipped run is not clean — `echo {file}` proves nothing), and every
    // test that failed in the full run shows its own pass there.
    const ranCleanly = (r, k) => {
      if (!r || r.exitCode !== 0) return false;
      const text = readLog(r.logPath);
      if (text === null) return false;
      const family = accountedFamily(text, at(headDir));
      if (family === null) return false;
      const counts = parseCounts(text, family);
      if (!(counts.tests > 0 && counts.pass > 0 && counts.fail === 0)) return false;
      const tree = testTree(text, family);
      return tree.wellFormed && work[k].headTests.length > 0 && work[k].headTests.every(passedIn(tree));
    };
    // Baseline after an isolated HEAD run: the isolated log (same accounting
    // guards, nothing cancelled, naming only this file, never a file-level
    // failure) fails only tests that also fail at base — compared by suite
    // path (`X > works`) between the two single-file trees, its failing leaf
    // names each unique — and every full-run failure it did not reproduce
    // shows its own pass there. Returns {log, waived} or null.
    const baselineInIsolation = (r, k) => {
      if (!r || typeof r.exitCode !== 'number' || r.exitCode === 0 || !baseEv[k]) return null;
      const text = readLog(r.logPath);
      if (text === null) return null;
      const family = accountedFamily(text, at(headDir));
      if (family === null) return null;
      const file = work[k].file;
      const files = extractFailingFiles(text, family, at(headDir));
      if (files.length !== 1 || files[0] !== file) return null;
      if (fileLevelFailures(text, family, at(headDir)).has(file)) return null;
      const tree = testTree(text, family);
      if (!tree.wellFormed) return null;
      const isoNames = failingTestsByFile(text, family, at(headDir)).get(file);
      if (!isoNames || !isoNames.every((n) => n !== null && tree.all.get(n) === 1)) return null;
      if (!tree.failed.every((p) => tree.paths.get(p) === 1) || !coveredBy(tree.failed, baseEv[k].qualified)) return null;
      const waived = multisetMinus(work[k].headTests, isoNames);
      if (!waived.every(passedIn(tree))) return null;
      return { log: r.logPath, waived };
    };
    // #3111: an isolated HEAD run that fails a test base does not cover would
    // otherwise be attributable outright — but that extra failure may itself
    // be a one-off flake rather than a real regression. Re-run the file once
    // more in isolation before finalizing that verdict; when the retry's own
    // failing set is covered by base (or the retry passes cleanly), the
    // extra failure did not reproduce, so report it flaky instead.
    // Each HEAD verdict is computed once here and reused below — both to
    // decide `needsRetry` and to classify `work` — rather than re-running the
    // same check twice per file.
    const headLoadFail = work.map((w, k) => failsToLoadAtBase(k));
    const headRanClean = headRuns.map((r, k) => ranCleanly(r, k));
    const headBaselineIso = headRuns.map((r, k) => baselineInIsolation(r, k));
    const needsRetry = work.map((w, k) => (
      Boolean(headRuns[k]) && typeof headRuns[k].exitCode === 'number' && headRuns[k].exitCode !== 0
      && !headLoadFail[k] && !headRanClean[k] && !headBaselineIso[k]
    ));
    const retryRuns = await pool(work, concurrency, (w, k) => (needsRetry[k] ? run(w, 'isolated-retry', cwd) : null));
    const baselineFailing = [];
    const flakyPassed = [];
    const flakyLogs = {};
    const baselineIsolated = {};
    const attributable = [];
    const failingByCheck = {};
    // #3063 AC2: a per-file base/isolated run that times out is no evidence
    // either way — `exitCode: null` already routes it to `attributable`
    // below via every classifier's own numeric-exitCode guard; this just
    // remembers which attributable files got there because of a timeout,
    // so the caller can name it on stdout instead of a bare file list.
    const timedOut = [];
    work.forEach((w, k) => {
      (failingByCheck[w.check] = failingByCheck[w.check] || []).push(w.file);
      if ((baseRuns[k] && baseRuns[k].timedOut) || (headRuns[k] && headRuns[k].timedOut)
        || (retryRuns[k] && retryRuns[k].timedOut)) timedOut.push(w.file);
      if (headLoadFail[k]) { baselineFailing.push(w.file); return; }
      if (headRanClean[k]) { flakyPassed.push(w.file); flakyLogs[w.file] = headRuns[k].logPath; return; }
      if (headBaselineIso[k]) { baselineFailing.push(w.file); baselineIsolated[w.file] = headBaselineIso[k]; return; }
      if (needsRetry[k] && (ranCleanly(retryRuns[k], k) || baselineInIsolation(retryRuns[k], k))) {
        flakyPassed.push(w.file); flakyLogs[w.file] = retryRuns[k].logPath; return;
      }
      attributable.push(w.file);
    });
    // #3313: files that fail at base but pass at HEAD. Per-file adjudication
    // never runs those at base, so each failing check takes one full-command
    // run in the scratch worktree — only once some file is proven failing at
    // base (a scratch worktree then exists), and never touching the verdict.
    // Any check that cannot prove its base failing set makes `fixed` null for
    // the whole run: a partial list would read as a complete one.
    let fixed = null;
    let fixedReason = 'no failing file classified baseline — base full run skipped';
    if (!computeFixed) {
      fixedReason = 'base full run disabled (--no-baseline-fixed)';
    } else if (baselineFailing.length > 0) {
      const union = new Set();
      fixedReason = null;
      for (const c of acceptedChecks) {
        const checkEnv = envOf(c.name);
        if (!c.command) { fixedReason = `${c.name} has no command to run at base`; break; }
        const r = await runOne({
          name: `${c.name}-base-full`, command: c.command, logDir, spawnImpl, now, cwd: baseDir, env: checkEnv, timeout: timeoutOf(c.name),
        });
        if (typeof r.exitCode !== 'number') {
          fixedReason = `${c.name} base full run exited without a numeric code${r.timedOut ? ' (timed out)' : ''}`; break;
        }
        const text = readLog(r.logPath);
        if (text === null) { fixedReason = `${c.name} base full run log unreadable — see ${r.logPath}`; break; }
        const family = accountedFamily(text, at(baseDir));
        if (family === null) { fixedReason = `${c.name} base full run log does not account for its failures — see ${r.logPath}`; break; }
        if (parseCounts(text, family).tests === 0) { fixedReason = `${c.name} base full run ran no tests — see ${r.logPath}`; break; }
        const baseFailing = new Set(extractFailingFiles(text, family, at(baseDir)));
        // A load failure in a scratch worktree is indistinguishable from a
        // missing install unless HEAD resolves no dependencies either.
        if (headResolvesDeps || (checkEnv || {}).NODE_PATH) {
          for (const f of fileLevelFailures(text, family, at(baseDir))) baseFailing.delete(f);
        }
        const headFailing = new Set(failingByCheck[c.name] || []);
        for (const f of baseFailing) if (!headFailing.has(f) && git.inCheckout(headDir, f)) union.add(f);
      }
      if (fixedReason === null) fixed = [...union];
    }
    return {
      ...header,
      eligible: true,
      verdict: attributable.length === 0 ? 'pass' : 'fail',
      failingFiles: work.map((w) => w.file),
      failingByCheck,
      baselineFailing,
      flakyPassed,
      flakyLogs,
      baselineIsolated,
      attributable,
      new: attributable,
      fixed,
      ...(fixed === null ? { fixedReason } : {}),
      timedOut,
    };
  } finally {
    for (const [sig, handler] of signalHandlers) process.removeListener(sig, handler);
    if (scratch) git.removeWorktree(scratch);
  }
}

module.exports = { adjudicate, realGit, findStaleBaselineWorktrees, RUNNER_ERROR_RE };
