#!/usr/bin/env node
// bin/drive.js — the pipeline driver (#5218): takes each named record, one at a time and
// in order, from admission to a draft PR with CI read. A program owns every step; a
// headless worker only writes the change. A record merges only when a judgment supplier is
// configured (none is by default; #5226's merge step, bin/lib/driver/merge.js); otherwise
// nothing merges, and a run that gets that far ends at pending-review, as in Phase 1. A thin
// entry: the loop, the step table, USAGE and realDeps live in bin/lib/driver/ (run.js,
// steps.js, events.js, merge.js).
//
//   Usage: drive.js #N [#M…]
//          drive.js --help | -h
//          drive.js --no-settle #N [#M…]   (the caller settles stops: the final line carries settle: left-to-caller and the stop object)
//
// One JSON event line per step on stdout (and, once the run directory exists, in
// {run-dir}/driver-events.jsonl); each record's final line carries its outcome word.
// Exit codes (Combined-2, as bin/link-records.js):
//   0  every named record reached its final event, whatever its outcome (outcomes are data)
//   1  when the policy, or the run's repository or integration branch, cannot be resolved and no further record is attempted
//   2  malformed invocation (no record reference, a non-numeric one) or gh or git absent, or an internal error (run itself failed)
//      (exit 2 is overloaded on purpose; revisit if a caller needs to retry an internal error
//      differently from a usage error)
// --help (or -h) exits 0 before any probe of gh, git or policy.
'use strict';

const { run, realDeps } = require('./lib/driver/run');

// Sets proc.exitCode from run(). A rejected run() is a bug, not an outcome: it is exit 2
// with the message on stderr, never Node's unhandled-rejection exit 1, which would read
// as the documented exit 1. Never process.exit: a pending stdout write must flush.
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
