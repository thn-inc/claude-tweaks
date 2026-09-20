// plugin/bin/lib/verify/flaky.js — runner-owned flaky retry (#1925). Pure:
// planRetry decides from data only ("every failing file listed or no
// retry"), runRetries spawns through an injected runOne (the same log
// capture, spawn-error recording, and duration as any check), and
// applyRetryResults folds the attempts back into the check result. The
// hit counter and its escalation live in count-stamp.js; the caveat text
// for a retried pass lives here so verify.js renders one shape.
'use strict';

const { globToRegExp } = require('../issues/blast-radius');

function planRetry({ failingFiles, flaky, retry, suite }) {
  if (!Array.isArray(failingFiles) || failingFiles.length === 0) return { retry: false, reason: 'no-parse' };
  const patterns = (flaky && flaky.files) || [];
  const unlisted = failingFiles.filter((f) => !patterns.some((entry) => globToRegExp(entry).test(f)));
  if (unlisted.length) return { retry: false, reason: `unlisted: [${unlisted.join(', ')}]`, unlisted };
  const template = retry && retry[suite];
  if (typeof template !== 'string') return { retry: false, reason: 'no-template' };
  if (!flaky || !(flaky.maxRetries >= 1)) return { retry: false, reason: 'max-retries-0' };
  const files = failingFiles.slice();
  return { retry: true, files, command: files.map((file) => ({ file, cmd: template.replace(/\{file\}/g, file) })) };
}

// {check}-retry-{file-slug}-{i}: per file AND per attempt, so two files
// retried in one run never share a log path (record Gotchas). The slug
// swaps `/` for `+` — a character extract.js's path charset never admits,
// so `tests/a-b.test.js` and `tests/a/b.test.js` cannot collide the way a
// dash slug would (review 3c, refs #1925).
function retryLogName(checkName, file, attempt) {
  return `${checkName}-retry-${file.replace(/\//g, '+')}-${attempt}`;
}

function applyRetryResults(check, attempts) {
  const files = [...new Set(attempts.map((a) => a.file))];
  const passed = files.filter((f) => attempts.some((a) => a.file === f && a.exitCode === 0));
  const failed = files.filter((f) => !passed.includes(f));
  if (files.length > 0 && failed.length === 0) return { ...check, exitCode: 0, flakyRetried: files, retryAttempts: attempts };
  return { ...check, flakyRetried: [], retryFailed: failed, retryAttempts: attempts };
}

// Serial, plan order; a file stops at its first pass; the first file to
// exhaust maxRetries ends the run (remaining files are not attempted).
async function runRetries({
  check, plan, maxRetries, logDir, runOne, spawnImpl, now, cwd,
}) {
  const attempts = [];
  for (const { file, cmd } of plan.command) {
    let passed = false;
    for (let attempt = 1; attempt <= maxRetries && !passed; attempt++) {
      const r = await runOne({
        name: retryLogName(check.name, file, attempt), command: cmd, logDir, spawnImpl, now, cwd,
      });
      const record = { file, attempt, exitCode: r.exitCode, logPath: r.logPath, durationMs: r.durationMs };
      if (r.spawnError !== undefined) record.spawnError = r.spawnError;
      attempts.push(record);
      passed = r.exitCode === 0;
    }
    if (!passed) break;
  }
  return applyRetryResults(check, attempts);
}

function flakyCaveatLines(checks) {
  const lines = [];
  for (const check of checks) {
    if (!check.flakyRetried || check.flakyRetried.length === 0) continue;
    const logs = (check.retryAttempts || []).filter((a) => a.exitCode === 0).map((a) => a.logPath);
    lines.push(`CAVEAT: flaky-retried: ${check.flakyRetried.join(', ')} — passed on isolated rerun; see ${logs.join(', ')}`);
  }
  return lines;
}

module.exports = { planRetry, retryLogName, applyRetryResults, runRetries, flakyCaveatLines };
