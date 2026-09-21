// plugin/bin/lib/verify/report.js — report.json composition (#892). The write
// itself is writeReportAtomic below, wrapping the codebase's dominant
// pid-suffixed atomic-write primitive (../atomic-write.js's writeFileAtomic,
// #2004) and called directly by bin/verify.js: a crashed run must never
// leave a half-written report.json a downstream gate reads as pass evidence
// (#892 AC3). gitInfo fails toward null — sha alone is not proof on a dirty
// tree, which is why dirty rides alongside it.
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const { writeFileAtomic } = require('../atomic-write');

function gitInfo(execImpl = execFileSync) {
  let sha = null;
  let dirty = null;
  try {
    sha = String(execImpl('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })).trim();
  } catch {
    return { sha: null, dirty: null };
  }
  try {
    dirty = String(execImpl('git', ['status', '--porcelain'], { encoding: 'utf8' })).trim() !== '';
  } catch {
    dirty = null;
  }
  return { sha, dirty };
}

// The checkout's own git dir (per-worktree under .git/worktrees/<name>/,
// never the common dir — a sibling worktree's pass must not satisfy this one).
// bin/verify.js resolves its default --log-dir/--count-stamp and the #1921
// stamp location from this; null means "not inside a checkout" and the CLI
// falls back to its tmpdir behavior.
function gitDir(execImpl = execFileSync, cwd = process.cwd()) {
  try {
    const out = String(execImpl('git', ['rev-parse', '--git-dir'], { encoding: 'utf8', cwd })).trim();
    if (out === '') return null;
    return path.resolve(cwd, out);
  } catch {
    return null;
  }
}

function entryFor(check) {
  if (check.skipped) return { command: check.command, skipped: check.skipped };
  const entry = {
    command: check.command,
    exitCode: check.exitCode,
    durationMs: check.durationMs,
    logPath: check.logPath,
    summary: check.summary === undefined ? null : check.summary,
    failingRegion: check.failingRegion === undefined ? null : check.failingRegion,
  };
  if (check.spawnError !== undefined) entry.spawnError = check.spawnError;
  if (check.counts !== undefined && check.counts !== null) entry.counts = check.counts;
  if (check.flakyRetried && check.flakyRetried.length) entry.flakyRetried = check.flakyRetried;
  if (check.retryFailed && check.retryFailed.length) entry.retryFailed = check.retryFailed;
  if (check.retryAttempts) {
    entry.retryAttempts = check.retryAttempts.map((a) => {
      const { file, attempt, exitCode, logPath } = a;
      const out = { file, attempt, exitCode, logPath };
      if (a.spawnError !== undefined) out.spawnError = a.spawnError;
      return out;
    });
  }
  if (check.retryDecision) entry.retryDecision = check.retryDecision;
  return entry;
}

function composeReport({
  checks, startedAt, durationMs, git, testCountRegression = null, scope = null, flakyEscalation = [],
}) {
  const byName = {};
  for (const check of checks) byName[check.name] = entryFor(check);
  const pass = checks
    .filter((c) => !c.skipped)
    .every((c) => c.exitCode === 0);
  const report = {
    sha: git.sha, dirty: git.dirty,
    startedAt, durationMs, pass,
    checks: byName,
  };
  // Omitted when null (#881) — mirrors entryFor's own counts convention:
  // never guessed/partial, absence over a fabricated non-regression.
  if (testCountRegression !== null) report.testCountRegression = testCountRegression;
  if (scope !== null) report.scope = scope;
  // #1925: only when an allowlisted file has crossed the escalation
  // threshold — absence over an empty array, same as the fields above.
  if (Array.isArray(flakyEscalation) && flakyEscalation.length) report.flakyEscalation = flakyEscalation;
  return report;
}

function writeReportAtomic(report, jsonPath, deps = {}) {
  writeFileAtomic(jsonPath, `${JSON.stringify(report, null, 2)}\n`, deps);
}

module.exports = { gitInfo, gitDir, composeReport, writeReportAtomic };
