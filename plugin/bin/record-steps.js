#!/usr/bin/env node
// bin/record-steps.js — validate a per-record step value and print its parts
// (#4358); the grammar is lib/flow/record-steps.js.
//
//   node bin/record-steps.js --value <value> [--targets "#A,#B"] [--help]
//
// --value is `#A:none;#B:build,test`. --targets, when given, must name exactly
// the value's records, in any order.
//
// Stdout: one JSON line, {records, recordSteps, steps, canonical}.
// Exit 0 the value is valid.
//      2 malformed invocation or an invalid value: stderr names the reason,
//        nothing on stdout.
// No run dir, no filesystem access and no exit 1 or 3.
'use strict';

const { parseRecordSteps, RECORD_RE } = require('./lib/flow/record-steps');

const USAGE = 'usage: record-steps.js --value <value> [--targets "#A,#B"] [--help]\n'
  + '  validates a per-record step value such as "#A:none;#B:build,test"; --targets must name exactly its records, in any order\n'
  + '  prints {records, recordSteps, steps, canonical}\n'
  + '  exit 0 the value is valid\n'
  + '       2 malformed invocation or an invalid value (stderr names the reason, nothing on stdout)\n';

const FLAGS = { '--value': 'value', '--targets': 'targets' };

function parseArgs(argv) {
  const o = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (!Object.hasOwn(FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} needs a value` };
    o[FLAGS[a]] = v;
    i++;
  }
  return o;
}

// "#A,#B" -> { targets } | { error }. A blank part, a non-record or a repeat is
// malformed: a mangled list must not pass or fail the match by accident.
function parseTargetList(raw) {
  const targets = raw.split(',').map((s) => s.trim());
  const bad = targets.find((t) => !RECORD_RE.test(t));
  if (bad !== undefined) return { error: `--targets entry ${JSON.stringify(bad)} is not a record reference (#N)` };
  if (new Set(targets).size !== targets.length) return { error: `--targets names a record twice: ${raw}` };
  return { targets };
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const usageError = (message) => { deps.stderr(`record-steps.js: ${message}\n${USAGE}`); return 2; };

  const o = parseArgs(argv);
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (o.value === undefined) return usageError('--value is required');
  let targets = null;
  if (o.targets !== undefined) {
    const parsed = parseTargetList(o.targets);
    if (parsed.error) return usageError(parsed.error);
    targets = parsed.targets;
  }

  const r = parseRecordSteps(o.value, { targets });
  if (!r.ok) return usageError(`invalid --value (${r.reason}): ${r.message}`);
  const { records, recordSteps, steps, canonical } = r;
  deps.stdout(`${JSON.stringify({ records, recordSteps, steps, canonical })}\n`);
  return 0;
}

module.exports = { run, parseArgs, parseTargetList };

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}
