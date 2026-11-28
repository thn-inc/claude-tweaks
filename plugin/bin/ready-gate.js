#!/usr/bin/env node
// bin/ready-gate.js — may a record body carry the `ready` label? (#6374)
//   node bin/ready-gate.js <body-file>
// Prints one JSON line, {"ready":true|false,"reasons":[…]}, from the ready-grant gate
// (lib/issues/ambiguity-resolve.js's readyGate: spec shape, no surviving Open Questions
// section, no symbolic `Blocked by: … (left for owner/name)` line).
// Exit 0 = the body may carry `ready`;
// 1 = the body was read but must not carry `ready` (reasons say why);
// 2 = malformed invocation or an unreadable file.
'use strict';

const fs = require('fs');
const { readyGate } = require('./lib/issues/ambiguity-resolve');
const { fsPath } = require('./lib/health-core/io');

const USAGE = 'usage: ready-gate.js <body-file>\n'
  + '  exit 0 = the body may carry `ready`; 1 = it must not (reasons on stdout); 2 = malformed invocation or unreadable file\n';

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
};

function run(argv, deps = realDeps) {
  if (argv.length !== 1 || argv[0].startsWith('--')) {
    deps.stderr(`ready-gate.js: expected exactly one <body-file>\n${USAGE}`);
    return 2;
  }
  let body;
  try {
    body = deps.readFile(fsPath(deps, argv[0]));
  } catch (err) {
    deps.stderr(`ready-gate.js: could not read body file: ${argv[0]} (${err && err.message})\n`);
    return 2;
  }
  const gate = readyGate(body);
  deps.stdout(JSON.stringify({ ready: gate.ok, reasons: gate.reasons }) + '\n');
  return gate.ok ? 0 : 1;
}

module.exports = { run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
