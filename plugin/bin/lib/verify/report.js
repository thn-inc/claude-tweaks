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
const { parseStatusPorcelainZ } = require('../git-z');

// #2987: the individual dirty paths behind gitInfo's boolean `dirty` —
// `--untracked-files=all` so an untracked directory expands to its files
// rather than collapsing to the directory name (`generated` globs name
// files, not directories). Used only by the pass-stamp's generated-path
// exemption in bin/verify.js; `gitInfo` below stays the general-purpose
// sha+boolean-dirty read every other caller already relies on. Fails toward
// null on a git error, same posture as gitInfo — never a fabricated empty
// list standing in for "could not check". A rename contributes BOTH paths:
// its source is deleted from the tree relative to HEAD, so a non-generated
// file renamed into a generated path must still disqualify the stamp. A
// copy's source is unchanged, so only its new path counts.
function dirtyFilePaths(execImpl = execFileSync) {
  let out;
  try {
    out = String(execImpl('git', ['--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=all'], { encoding: 'utf8', windowsHide: true }));
  } catch {
    return null;
  }
  const files = [];
  for (const record of parseStatusPorcelainZ(out)) {
    files.push(record.path);
    if (record.origPath !== undefined && record.xy.includes('R')) files.push(record.origPath);
  }
  return files;
}

function gitInfo(execImpl = execFileSync) {
  let sha = null;
  let dirty = null;
  try {
    sha = String(execImpl('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true })).trim();
  } catch {
    return { sha: null, dirty: null };
  }
  try {
    dirty = String(execImpl('git', ['--no-optional-locks', 'status', '--porcelain'], { encoding: 'utf8', windowsHide: true })).trim() !== ''; // git-path-read: not a path list (emptiness only)
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
    const out = String(execImpl('git', ['rev-parse', '--git-dir'], { encoding: 'utf8', cwd, windowsHide: true })).trim();
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
  // #3063: a null exitCode already fails/never-stamps (see `pass` below) —
  // this just names why, so report.json distinguishes a hang from any other
  // spawn-less failure.
  if (check.timedOut) entry.timedOut = true;
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
  // #1837: never disable the count-stamp comparison silently — a tests
  // check whose counts didn't parse (with a stamp in play) says so.
  if (check.countsUnparsed) entry.countsUnparsed = check.countsUnparsed;
  // #4347: a check whose verdict is a CI job's names that run.
  if (check.ci) entry.ci = check.ci;
  return entry;
}

function composeReport({
  checks, startedAt, durationMs, git, testCountRegression = null, scope = null, flakyEscalation = [],
  baselineAdjudicated = null, preExistingAdjudicated = null,
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
  // #3043: the baseline adjudication (verify.js --baseline) — omitted when none
  // ran. `pass` above stays the raw "every check exited 0"; the adjudication
  // detail lives here, and verify.js records the overall verdict as
  // `effectivePass` (#3316).
  if (baselineAdjudicated !== null) report.baselineAdjudicated = baselineAdjudicated;
  // #3129: the declared-pre-existing-failures adjudication (verify-scope.json's
  // `preExisting`) — omitted when it never ran or never applied. Mutually
  // exclusive with baselineAdjudicated in practice (a run adjudicates against
  // at most one of the two), but composeReport never enforces that itself.
  if (preExistingAdjudicated !== null) report.preExistingAdjudicated = preExistingAdjudicated;
  return report;
}

function writeReportAtomic(report, jsonPath, deps = {}) {
  writeFileAtomic(jsonPath, `${JSON.stringify(report, null, 2)}\n`, deps);
}

module.exports = { gitInfo, gitDir, composeReport, writeReportAtomic, dirtyFilePaths };
