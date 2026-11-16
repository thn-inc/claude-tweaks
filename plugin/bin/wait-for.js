#!/usr/bin/env node
// bin/wait-for.js — a bounded foreground wait an agent calls instead of polling
// with `sleep` (#5602).
//   node bin/wait-for.js agents --ids <a,b> | ci --pr <n> | ci --run <id> | pid --pid <n>
//     [--max-seconds <n>=100 (<=150)] [--window-seconds <n>=1200 (<=3600)] [--session <id>] [--help]
// Call it with no Bash timeout: an agents or pid call ends within 150 s and a ci call
// within 170 s (a slow read may run 20 s past the bound), under the measured
// 180-second foreground ceiling (docs/reference/blocking-wait-probe.md). Prints one JSON
// line. Exit codes: 0 the target changed; 3 a bound was hit (`bound`: "call" or
// "deadline"); 2 a malformed invocation, a missing or invalid session id, a
// refused marker file, or an unexpected error. The contract, the per-session
// window and the targets live in bin/lib/wait-for/index.js; its USAGE is the
// full statement.
'use strict';

const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { performance } = require('perf_hooks');
const lib = require('./lib/wait-for');
const { isPidAlive } = require('./lib/suite-slot');
const { ghOptions, injectedGhDeps } = require('./lib/repo-resolve');
const { GH_TIMEOUT_MS } = require('./lib/shared-primitives');

// One CI read. { pr } -> the `pr-checks.js --pr` envelope; { run } -> `gh run view`'s
// { status, conclusion }. Throws on any failure; the target decides what a failed read means.
// Both reads are child processes killed at `timeoutMs` (the loop's time left until the nearer of
// the call bound and the window deadline, plus its grace), so one slow read cannot hold the call past the foreground ceiling;
// a kill or a non-zero exit throws, which the ci target counts as a failed read. `--pr` runs
// pr-checks.js as its own process (its code stays where it is); `--run` is bounded by the
// gh timeout too.
function runner(query, { cwd, env, timeoutMs }) {
  if (query.pr !== undefined) {
    return JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'pr-checks.js'), '--pr', String(query.pr)], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, windowsHide: true }));
  }
  const args = ['run', 'view', String(query.run), '--json', 'status,conclusion'];
  return JSON.parse(execFileSync('gh', args, ghOptions(args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: Math.min(timeoutMs, GH_TIMEOUT_MS), windowsHide: true }, injectedGhDeps({ env }))));
}

const realDeps = {
  isPidAlive,
  cwd: () => process.cwd(),
  runner,
  now: () => Date.now(),
  monotonicNow: () => performance.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  tmpDir: () => os.tmpdir(),
  env: process.env,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  return lib.run(argv, deps);
}

module.exports = { run, realDeps };

if (require.main === module) run(process.argv.slice(2), realDeps).then((code) => { process.exitCode = code; });
