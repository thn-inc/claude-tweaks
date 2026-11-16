#!/usr/bin/env node
// bin/wait-for.js — a bounded foreground wait an agent calls instead of polling
// with `sleep` (#5602).
//   node bin/wait-for.js agents --ids <a,b> | ci --pr <n> | ci --run <id> | pid --pid <n>
//     [--max-seconds <n>=100 (<=150)] [--window-seconds <n>=1200 (<=3600)] [--session <id>] [--help]
// Call it with no Bash timeout: 150 s stays under the measured 180-second
// foreground ceiling (docs/reference/blocking-wait-probe.md). Prints one JSON
// line. Exit codes: 0 the target changed; 3 a bound was hit (`bound`: "call" or
// "deadline"); 2 a malformed invocation, a missing or invalid session id, a
// refused marker file, or an unexpected error. The contract, the per-session
// window and the targets live in bin/lib/wait-for/index.js; its USAGE is the
// full statement.
'use strict';

const os = require('os');
const lib = require('./lib/wait-for');

const realDeps = {
  now: () => Date.now(),
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
