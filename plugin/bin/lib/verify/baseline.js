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
// log shows tests ran and passed. git and runOne are injected so the tests
// never touch a real repo; realGit is the CLI's seam.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  sniffFamily, extractFailingFiles, countUnmatchedFailures, fileLevelFailures, failingTestsByFile, parseCounts, stripAnsi,
  specEntryCount, cancelledCount, testTree,
} = require('./extract');

// `warn` and `rmSync` are injectable so a test can force a failed cleanup.
function realGit(cwd, { warn = (line) => process.stderr.write(line), rmSync = fs.rmSync } = {}) {
  const git = (args) => String(execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
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
    fileExistsAt: (sha, file) => {
      try { git(['cat-file', '-e', `${sha}:${file}`]); return true; } catch { return false; }
    },
    // Whether the working-tree file (repo-root-relative path) hashes to the
    // same blob it has at `sha` — clean filters applied, so a CRLF checkout
    // of an unchanged LF file still matches. Any git failure → false.
    sameAtBase: (sha, file) => {
      try {
        const root = git(['rev-parse', '--show-toplevel']);
        return git(['rev-parse', `${sha}:${file}`]) === git(['hash-object', `--path=${file}`, path.join(root, file)]);
      } catch { return false; }
    },
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
  };
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
function accountedFamily(text, cwd) {
  const family = sniffFamily(text);
  if (family !== 'spec' && family !== 'tap') return null;
  if (RUNNER_ERROR_RE.test(text)) return null;
  const counts = parseCounts(text, family);
  if (counts === null || cancelledCount(text, family) !== 0) return null;
  if (countUnmatchedFailures(text, family, { cwd }) > 0) return null;
  if (family === 'spec' && specEntryCount(text) !== counts.fail) return null;
  return family;
}

// A single-file log with every run-specific detail removed: the checkout
// root (each spelling — forward slashes, backslashes, YAML-doubled
// backslashes) and every duration. Two runs of the same file that fail the
// same way produce the same text.
function normalizeLog(text, roots) {
  let out = text.replace(/\r$/gm, '');
  for (const root of roots) {
    const fwd = root.replace(/\\/g, '/').replace(/\/+$/, '');
    const back = fwd.replace(/\//g, '\\');
    for (const spelling of [back.replace(/\\/g, '\\\\'), back, fwd]) out = out.split(spelling).join('<ROOT>');
  }
  return out.replace(/\(\d[\d.]*ms\)/g, '(ms)').replace(/^ℹ duration_ms .*$/gm, '').replace(/duration_ms: .*$/gm, '');
}

function readLog(logPath) {
  try { return stripAnsi(fs.readFileSync(logPath, 'utf8')); } catch { return null; }
}

async function adjudicate({
  checks, baselineCmds, base, baseSha, cwd = null, logDir, runOne, spawnImpl, now = Date.now,
  envOf = () => null, git, concurrency = 4, env = process.env,
}) {
  const header = { base, baseSha };
  const ineligible = (reason) => ({ ...header, eligible: false, reason });
  const work = [];
  const headDir = cwd || process.cwd();
  for (const c of checks.filter((x) => x.skipped || x.exitCode !== 0)) {
    if (c.skipped) return ineligible(`${c.name} skipped (${c.skipped})`);
    if (c.spawnError !== undefined) return ineligible(`${c.name} could not spawn`);
    if (typeof c.exitCode !== 'number') return ineligible(`${c.name} exited without a numeric code`);
    const template = baselineCmds.get(c.name);
    if (!template) return ineligible(`no --baseline-cmd for failing check ${c.name}`);
    const text = readLog(c.logPath);
    if (text === null) return ineligible(`${c.name} log unreadable`);
    const family = sniffFamily(text);
    const files = extractFailingFiles(text, family, { cwd: headDir });
    if (files.length === 0) return ineligible(`no-parse: no failing test file extractable from ${c.name}`);
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
    const unmatched = countUnmatchedFailures(text, family, { cwd: headDir });
    if (unmatched > 0) {
      return ineligible(`unclassified failure(s): ${unmatched} failing ${unmatched === 1 ? 'entry names' : 'entries name'} no test file in ${c.name}`);
    }
    if (family === 'spec') {
      const entries = specEntryCount(text);
      if (entries !== counts.fail) {
        return ineligible(`${c.name} failing entries (${entries}) do not account for ℹ fail ${counts.fail}`);
      }
    }
    const headFileLevel = fileLevelFailures(text, family, { cwd: headDir });
    const headTests = failingTestsByFile(text, family, { cwd: headDir });
    const headLocated = failingTestsByFile(text, family, { cwd: headDir, located: true });
    for (const file of files) {
      work.push({
        check: c.name, file, command: template.replace(/\{file\}/g, file),
        headFileLevel: headFileLevel.has(file), headTests: headTests.get(file) || [], headLocated: headLocated.get(file) || [],
      });
    }
  }

  // A --cwd subdir: failing files are relative to it, so the base-side path
  // and cwd are offset by the same subdir (Review Focus 5). A --cwd that does
  // not sit under git's own toplevel spelling (a junction, a subst drive, an
  // 8.3 name) would put the base-side run outside the scratch worktree —
  // possibly onto HEAD's own tree — so it is never adjudicated.
  const root = git.repoRoot();
  const sub = path.relative(root, headDir).replace(/\\/g, '/');
  if (sub === '..' || sub.startsWith('../') || path.isAbsolute(sub)) {
    return ineligible(`working directory ${headDir} does not resolve under the repository root ${root}`);
  }
  const repoRel = (file) => (sub ? `${sub}/${file}` : file);
  const atBase = work.map((w) => git.fileExistsAt(baseSha, repoRel(w.file)));
  const unchanged = work.map((w, k) => atBase[k] && git.sameAtBase(baseSha, repoRel(w.file)));
  let scratch = null;
  const run = (w, kind, dir) => runOne({
    name: `${w.check}-${kind}-${slug(w.file)}`, command: w.command, logDir, spawnImpl, now, cwd: dir, env: envOf(w.check),
  });
  const headResolvesDeps = Boolean(env.NODE_PATH) || hasNodeModulesUpward(headDir);
  try {
    if (atBase.some(Boolean)) scratch = git.addWorktree(baseSha);
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
      const family = accountedFamily(text, baseDir);
      if (family === null) return null;
      const file = work[k].file;
      const located = failingTestsByFile(text, family, { cwd: baseDir, located: true }).get(file);
      const conclusive = failingTestsByFile(text, family, { cwd: baseDir, conclusiveOnly: true }).get(file);
      if (!located || !conclusive || conclusive.length !== located.length) return null;
      const tree = testTree(text, family);
      const qualified = tree.wellFormed ? tree.failed.filter((p) => tree.paths.get(p) === 1) : [];
      return { text, located, qualified, fileLevel: fileLevelFailures(text, family, { cwd: baseDir }).has(file) };
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
    const headRoot = root;
    const failsToLoadAtBase = (k) => {
      const ev = baseEv[k];
      const r = headRuns[k];
      if (!ev || !ev.fileLevel || !work[k].headFileLevel || !unchanged[k] || !coveredBy(work[k].headLocated, ev.located)) return false;
      if (headResolvesDeps || (envOf(work[k].check) || {}).NODE_PATH) return false;
      if (!r || typeof r.exitCode !== 'number' || r.exitCode === 0) return false;
      const text = readLog(r.logPath);
      return text !== null && normalizeLog(text, [headRoot]) === normalizeLog(ev.text, [scratch]);
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
      const family = accountedFamily(text, headDir);
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
      const family = accountedFamily(text, headDir);
      if (family === null) return null;
      const file = work[k].file;
      const files = extractFailingFiles(text, family, { cwd: headDir });
      if (files.length !== 1 || files[0] !== file) return null;
      if (fileLevelFailures(text, family, { cwd: headDir }).has(file)) return null;
      const tree = testTree(text, family);
      if (!tree.wellFormed) return null;
      const isoNames = failingTestsByFile(text, family, { cwd: headDir }).get(file);
      if (!isoNames || !isoNames.every((n) => n !== null && tree.all.get(n) === 1)) return null;
      if (!tree.failed.every((p) => tree.paths.get(p) === 1) || !coveredBy(tree.failed, baseEv[k].qualified)) return null;
      const waived = multisetMinus(work[k].headTests, isoNames);
      if (!waived.every(passedIn(tree))) return null;
      return { log: r.logPath, waived };
    };
    const baselineFailing = [];
    const flakyPassed = [];
    const flakyLogs = {};
    const baselineIsolated = {};
    const attributable = [];
    const failingByCheck = {};
    work.forEach((w, k) => {
      (failingByCheck[w.check] = failingByCheck[w.check] || []).push(w.file);
      if (failsToLoadAtBase(k)) baselineFailing.push(w.file);
      else if (ranCleanly(headRuns[k], k)) { flakyPassed.push(w.file); flakyLogs[w.file] = headRuns[k].logPath; }
      else {
        const iso = baselineInIsolation(headRuns[k], k);
        if (iso) { baselineFailing.push(w.file); baselineIsolated[w.file] = iso; } else attributable.push(w.file);
      }
    });
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
    };
  } finally {
    if (scratch) git.removeWorktree(scratch);
  }
}

module.exports = { adjudicate, realGit };
