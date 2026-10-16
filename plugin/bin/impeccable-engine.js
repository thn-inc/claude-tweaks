#!/usr/bin/env node
// bin/impeccable-engine.js — CLI for bin/lib/impeccable-engine: find and run
// Impeccable's design engine (plugin 4.2.2+) without ever downloading it.
//   node bin/impeccable-engine.js resolve
//   node bin/impeccable-engine.js run <signals|doctor|concept-seed|surface-brief> [args...]
// Prints one JSON envelope to stdout. Exit 0 for every resolved outcome
// (ok:false included — failures are data the caller branches on); exit 2 only
// for a usage error (unknown verb, an argument outside a verb's allowlist —
// including `doctor --fix` — or any argument after `resolve`). A usage error
// never calls resolve()/run(), so it never spawns the launcher.
'use strict';

const engine = require('./lib/impeccable-engine');

const USAGE = 'usage: impeccable-engine.js resolve\n'
  + '       impeccable-engine.js run <signals|doctor|concept-seed|surface-brief> [args...]\n';

const realDeps = {
  resolve: engine.resolve,
  run: engine.run,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// argv -> exit code. All I/O through deps so tests never touch a real engine.
function run(argv, deps = realDeps) {
  const sub = argv[0];
  if (sub === 'resolve') {
    if (argv.length > 1) { deps.stderr(USAGE); return 2; }
    deps.stdout(JSON.stringify(deps.resolve({})) + '\n');
    return 0;
  }
  if (sub === 'run') {
    const verb = argv[1];
    const args = argv.slice(2);
    // validateVerbArgs rejects an unknown verb as well as a bad argument shape.
    if (!engine.validateVerbArgs(verb, args).ok) { deps.stderr(USAGE); return 2; }
    deps.stdout(JSON.stringify(deps.run(verb, args, {})) + '\n');
    return 0;
  }
  deps.stderr(USAGE);
  return 2;
}

module.exports = { run };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
