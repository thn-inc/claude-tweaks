#!/usr/bin/env node
// bin/drive.js — the pipeline driver (#5218): takes each named record, one at a time and
// in order, from admission to a draft PR with CI read. A program owns every step; a
// headless worker only writes the change. Nothing merges. A thin entry: the loop, the
// step table, USAGE and realDeps live in bin/lib/driver/ (run.js, steps.js, events.js).
//
//   Usage: drive.js #N [#M…]
//
// One JSON event line per step on stdout (and, once the run directory exists, in
// {run-dir}/driver-events.jsonl); each record's final line carries its outcome word.
// Exit codes (Combined-2, as bin/link-records.js):
//   0  every named record reached its final event, whatever its outcome (outcomes are data)
//   1  the policy could not be read; no further record was attempted
//   2  malformed invocation (no record reference, a non-numeric one) or gh or git absent
// --help exits 0 before any probe of gh, git or policy.
'use strict';

const { run, realDeps } = require('./lib/driver/run');

module.exports = { run };

if (require.main === module) run(process.argv.slice(2), realDeps).then((code) => { process.exitCode = code; });
