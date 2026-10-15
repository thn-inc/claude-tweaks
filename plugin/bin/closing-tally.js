#!/usr/bin/env node
// bin/closing-tally.js — derive a `/claude-tweaks:backlog refine` run's
// closing tally mechanically from its own decisions.md (#2729), instead of a
// hand-composed count that can disagree with the audit trail it summarizes.
//   node bin/closing-tally.js --run <run-dir> [--help]
//   node bin/closing-tally.js --file <path-to-decisions.md> [--help]
// Prints one JSON envelope on success: {counts, line, unclassified}. `line`
// is the canonical tally-line string (refine-closing-summary.md's Per-type
// tally line); `unclassified` lists every "Backlog refine:" line that didn't
// match a known tally field — a vocabulary-drift signal, never silently
// dropped.
// Exit 0 success; 2 malformed invocation (neither/both of --run and --file,
// or an unknown flag); 3 the target file does not exist or could not be read.
'use strict';

const fs = require('fs');
const path = require('path');
const { computeClosingTally, renderTallyLine } = require('./lib/closing-tally/closing-tally');

const USAGE = 'usage: closing-tally.js (--run <run-dir> | --file <path>) [--help]\n';

function parseArgs(argv) {
  const opts = { run: null, file: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--run') opts.run = next();
    else if (a === '--file') opts.file = next();
    else return { error: `unknown argument: ${a}` };
  }
  return opts;
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(opts.error + '\n' + USAGE); return 2; }
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if ((!opts.run && !opts.file) || (opts.run && opts.file)) {
    deps.stderr('exactly one of --run or --file is required\n' + USAGE);
    return 2;
  }
  const target = opts.file ? opts.file : path.join(opts.run, 'decisions.md');
  let text;
  try {
    text = deps.readFile(target);
  } catch (err) {
    deps.stderr(`closing-tally.js: could not read ${target} (${err && err.message ? err.message : err})\n`);
    return 3;
  }
  const { counts, unclassified } = computeClosingTally(text);
  deps.stdout(JSON.stringify({ counts, line: renderTallyLine(counts), unclassified }, null, 2) + '\n');
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
