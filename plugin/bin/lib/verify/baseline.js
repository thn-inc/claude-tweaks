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
  specEntryCount,
} = require('./extract');

// `warn` and `rmSync` are injectable so a test can force a failed cleanup.
function realGit(cwd, { warn = (line) => process.stderr.write(line), rmSync = fs.rmSync } = {}) {
  const git = (args) => String(execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })).trim();
  return {
    repoRoot: () => git(['rev-parse', '--show-toplevel']),
    resolveCommit: (ref) => {
      try { return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) || null; } catch { return null; }
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
    addWorktree: (sha) => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-base-'));
      const dir = path.join(parent, 'wt');
      git(['worktree', 'add', '--detach', dir, sha]);
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
    for (const file of files) {
      work.push({
        check: c.name, file, command: template.replace(/\{file\}/g, file),
        headFileLevel: headFileLevel.has(file), headTests: headTests.get(file) || [],
      });
    }
  }

  // A --cwd subdir: failing files are relative to it, so the base-side path
  // and cwd are offset by the same subdir (Review Focus 5).
  const sub = path.relative(git.repoRoot(), headDir).replace(/\\/g, '/');
  const repoRel = (file) => (sub ? `${sub}/${file}` : file);
  const atBase = work.map((w) => git.fileExistsAt(baseSha, repoRel(w.file)));
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
    // the base run's own log must name this very file as failing — and with
    // every test that fails in it at HEAD, so an old environment failure
    // cannot cover a new failing test in the same file. Anything else is
    // unproven and falls through to the isolated HEAD run.
    const baseNames = work.map(() => null);
    const failsAtBase = baseRuns.map((r, k) => {
      if (r === null || typeof r.exitCode !== 'number' || r.exitCode === 0) return false;
      const text = readLog(r.logPath);
      if (text === null) return false;
      const family = sniffFamily(text);
      const file = work[k].file;
      const baseTests = failingTestsByFile(text, family, { cwd: baseDir }).get(file);
      if (baseTests) baseNames[k] = baseTests;
      if (!baseTests || !coveredBy(work[k].headTests, baseTests)) return false;
      if (!fileLevelFailures(text, family, { cwd: baseDir }).has(file)) return true;
      // A file-level base failure is a test file that did not load. A scratch
      // worktree carries no untracked dependencies, so that is not
      // distinguishable from a missing install: it proves "fails at base" only
      // when HEAD's own failure was file-level too and HEAD resolves no
      // dependencies either — Node's own resolution: no node_modules at the
      // HEAD directory or any ancestor, and no NODE_PATH (inherited or the
      // check's own --cmd-env).
      return work[k].headFileLevel && !headResolvesDeps && !(envOf(work[k].check) || {}).NODE_PATH;
    });
    // A file absent at base is new on this branch: attributable outright —
    // an isolated pass must never let a flaky verdict cover a new file.
    const headRuns = await pool(work, concurrency, (w, k) => (failsAtBase[k] || !atBase[k] ? null : run(w, 'isolated', cwd)));
    // Flaky is symmetric evidence: the isolated run exited 0 AND its log shows
    // tests actually ran and passed (an all-skipped run is not clean) —
    // `echo {file}` proves nothing.
    const ranCleanly = (r) => {
      if (!r || r.exitCode !== 0) return false;
      const text = readLog(r.logPath);
      if (text === null) return false;
      const counts = parseCounts(text, sniffFamily(text));
      return counts !== null && counts.tests > 0 && counts.pass > 0 && counts.fail === 0;
    };
    // A file whose full-run failures go beyond base's (extra tests failing
    // under the full suite's load) is still baseline when, in isolation at
    // HEAD, it fails only tests that also fail at base — the isolated log held
    // to the same accounting guards as the full run's, naming only this file,
    // and never on a file-level failure.
    const baselineInIsolation = (r, k) => {
      if (!r || typeof r.exitCode !== 'number' || r.exitCode === 0 || !baseNames[k]) return false;
      const text = readLog(r.logPath);
      if (text === null) return false;
      const family = sniffFamily(text);
      if (family !== 'spec' && family !== 'tap') return false;
      const counts = parseCounts(text, family);
      if (counts === null || countUnmatchedFailures(text, family, { cwd: headDir }) > 0) return false;
      if (family === 'spec' && specEntryCount(text) !== counts.fail) return false;
      const file = work[k].file;
      const files = extractFailingFiles(text, family, { cwd: headDir });
      if (files.length !== 1 || files[0] !== file) return false;
      if (fileLevelFailures(text, family, { cwd: headDir }).has(file)) return false;
      const names = failingTestsByFile(text, family, { cwd: headDir }).get(file);
      return Boolean(names) && coveredBy(names, baseNames[k]);
    };
    const baselineFailing = [];
    const flakyPassed = [];
    const flakyLogs = {};
    const baselineIsolatedLogs = {};
    const attributable = [];
    const failingByCheck = {};
    work.forEach((w, k) => {
      (failingByCheck[w.check] = failingByCheck[w.check] || []).push(w.file);
      if (failsAtBase[k]) baselineFailing.push(w.file);
      else if (ranCleanly(headRuns[k])) { flakyPassed.push(w.file); flakyLogs[w.file] = headRuns[k].logPath; }
      else if (baselineInIsolation(headRuns[k], k)) { baselineFailing.push(w.file); baselineIsolatedLogs[w.file] = headRuns[k].logPath; }
      else attributable.push(w.file);
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
      baselineIsolatedLogs,
      attributable,
    };
  } finally {
    if (scratch) git.removeWorktree(scratch);
  }
}

module.exports = { adjudicate, realGit };
