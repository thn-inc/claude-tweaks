#!/usr/bin/env node
// bin/drive.js — the pipeline driver (#5218): takes each named record, one at a time and
// in order, from admission to a draft PR with CI read. A program owns every step; a
// headless worker only writes the change. Nothing merges. A thin entry: the loop, the
// step table, USAGE and realDeps live in bin/lib/driver/ (run.js, steps.js, events.js).
//
//   Usage: drive.js #N [#M…]
//          drive.js --help | -h
//
// One JSON event line per step on stdout (and, once the run directory exists, in
// {run-dir}/driver-events.jsonl); each record's final line carries its outcome word.
// Exit codes (Combined-2, as bin/link-records.js):
//   0  every named record reached its final event, whatever its outcome (outcomes are data)
//   1  when the policy, or the run's repository or integration branch, cannot be resolved and no further record is attempted
//   2  malformed invocation (no record reference, a non-numeric one) or gh or git absent, or an internal error (run itself failed)
// --help (or -h) exits 0 before any probe of gh, git or policy.
'use strict';

const { run, realDeps } = require('./lib/driver/run');

// Sets proc.exitCode from run(). A rejected run() is a bug, not an outcome: it is exit 2
// with the message on stderr, never Node's unhandled-rejection exit 1, which would read
// as the documented exit 1. Exit 2 thus doubles as the internal-error code; revisit if a
// caller needs to retry an internal error differently from a usage error. Never
// process.exit: a pending stdout write must flush.
function main(argv, deps, proc = process) {
  return run(argv, deps)
    .then((code) => { proc.exitCode = code; })
    .catch((err) => {
      proc.stderr.write(`drive.js: internal error: ${(err && err.message) || String(err)}\n`);
      proc.exitCode = 2;
    });
}

module.exports = { run, main };

if (require.main === module) main(process.argv.slice(2), realDeps);
