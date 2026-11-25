#!/usr/bin/env node
// bin/sdd-ruling-route.js — print the route of one staged SDD ruling temp file (#5449).
//   node bin/sdd-ruling-route.js --file <path>
// Prints exactly `audit` or `console` (one trailing newline), the verdict of
// lib/console/sdd-ruling.js's sddRulingRoute. Read by build/dispatch.md's carry-forward.
// Exit vocabulary is Payload-1/Invocation-2: 0 printed, 1 the --file path is
// unreadable, 2 a malformed invocation (an empty or whitespace-only --file value included). Nothing goes to stdout on a failure.
'use strict';

const fs = require('fs');
const { fsPath } = require('./lib/health-core/io');
const { sddRulingRoute } = require('./lib/console/sdd-ruling');

const USAGE = 'usage: sdd-ruling-route.js --file <path>   (exit 0 printed, 1 --file unreadable, 2 malformed invocation)\n';

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
};

function run(argv, deps) {
  if (argv.length !== 2 || argv[0] !== '--file' || argv[1].startsWith('--') || argv[1].trim() === '') {
    deps.stderr(USAGE);
    return 2;
  }
  const arg = argv[1];
  let text;
  try {
    text = deps.readFile(fsPath(deps, arg));
  } catch (err) {
    deps.stderr(`sdd-ruling-route.js: cannot read ${arg}: ${(err && err.code) || 'error'}\n`);
    return 1;
  }
  deps.stdout(sddRulingRoute(text) + '\n');
  return 0;
}

module.exports = { run, realDeps, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
