// plugin/bin/lib/verify/baseline.js — baseline adjudication (#3043). When a
// check fails on a checkout with a known environment-specific failure baseline
// (a Windows dev checkout's separator/CRLF failures), this re-runs only the
// failing test files: at the base commit in a scratch detached worktree, and
// — for files passing at base or absent there — once more in isolation at
// HEAD. A file failing at base is baseline; one passing in isolation at HEAD
// is flaky; the rest are attributable. Fails closed: anything not classified
// with evidence (no extractable file, a failing entry naming no test file, a
// fail-fast skip, a spawn error, a base run with no numeric exit) is never
// "fails at base". git and runOne are injected so the tests never touch a
// real repo; realGit is the CLI's seam.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { sniffFamily, extractFailingFiles, countUnmatchedFailures, stripAnsi } = require('./extract');

function realGit(cwd) {
  const git = (args) => String(execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })).trim();
  return {
    repoRoot: () => git(['rev-parse', '--show-toplevel']),
    resolveCommit: (ref) => {
      try { return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) || null; } catch { return null; }
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
    removeWorktree: (dir) => {
      try { git(['worktree', 'remove', '--force', dir]); } catch { /* best effort — rm below */ }
      try { fs.rmSync(path.dirname(dir), { recursive: true, force: true }); } catch { /* best effort */ }
      try { git(['worktree', 'prune']); } catch { /* best effort */ }
    },
  };
}

// The same `/` → `+` log-name slug flaky.js's retryLogName uses, so two
// files never share a log path.
function slug(file) { return file.replace(/[\\/]/g, '+'); }

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const k = next++;
      out[k] = await fn(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

async function adjudicate({
  checks, baselineCmds, base, baseSha, cwd = null, logDir, runOne, spawnImpl, now = Date.now,
  envOf = () => null, git, concurrency = 4,
}) {
  const header = { base, baseSha };
  const work = [];
  const headDir = cwd || process.cwd();
  for (const c of checks.filter((x) => x.skipped || x.exitCode !== 0)) {
    if (c.skipped) return { ...header, eligible: false, reason: `${c.name} skipped (${c.skipped})` };
    if (c.spawnError !== undefined) return { ...header, eligible: false, reason: `${c.name} could not spawn` };
    const template = baselineCmds.get(c.name);
    if (!template) return { ...header, eligible: false, reason: `no --baseline-cmd for failing check ${c.name}` };
    let text;
    try { text = stripAnsi(fs.readFileSync(c.logPath, 'utf8')); } catch {
      return { ...header, eligible: false, reason: `${c.name} log unreadable` };
    }
    const family = sniffFamily(text);
    const files = extractFailingFiles(text, family, { cwd: headDir });
    if (files.length === 0) return { ...header, eligible: false, reason: `no-parse: no failing test file extractable from ${c.name}` };
    // A failing entry extractFailingFiles dropped means `files` is an
    // undercount — classifying the rest could return `pass` over a failure
    // nothing adjudicated.
    const unmatched = countUnmatchedFailures(text, family, { cwd: headDir });
    if (unmatched > 0) {
      return {
        ...header,
        eligible: false,
        reason: `unclassified failure(s): ${unmatched} failing ${unmatched === 1 ? 'entry names' : 'entries name'} no test file in ${c.name}`,
      };
    }
    for (const file of files) work.push({ check: c.name, file, command: template.replace(/\{file\}/g, file) });
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
  try {
    if (atBase.some(Boolean)) scratch = git.addWorktree(baseSha);
    const baseDir = scratch && (sub ? path.join(scratch, ...sub.split('/')) : scratch);
    const baseRuns = await pool(work, concurrency, (w, k) => (atBase[k] ? run(w, 'baseline', baseDir) : null));
    // Only a numeric non-zero exit is evidence of failing at base (Review Focus 3).
    const failsAtBase = baseRuns.map((r) => r !== null && typeof r.exitCode === 'number' && r.exitCode !== 0);
    const headRuns = await pool(work, concurrency, (w, k) => (failsAtBase[k] ? null : run(w, 'isolated', cwd)));
    const baselineFailing = [];
    const flakyPassed = [];
    const attributable = [];
    work.forEach((w, k) => {
      if (failsAtBase[k]) baselineFailing.push(w.file);
      else if (headRuns[k] && headRuns[k].exitCode === 0) flakyPassed.push(w.file);
      else attributable.push(w.file);
    });
    return {
      ...header,
      eligible: true,
      verdict: attributable.length === 0 ? 'pass' : 'fail',
      failingFiles: work.map((w) => w.file),
      baselineFailing,
      flakyPassed,
      attributable,
    };
  } finally {
    if (scratch) git.removeWorktree(scratch);
  }
}

module.exports = { adjudicate, realGit };
