#!/usr/bin/env node
// bin/compose-brainstorm-args.js — thin CLI wrapper over
// bin/lib/specify/brainstorming-ceremony.js's composeBrainstormingArgs,
// mirroring bin/resolve-blockers.js's argument-parsing/deps-injection
// shape. /claude-tweaks:specify's three `/superpowers:brainstorming`
// invocation sites (skills/specify/brainstorming-ceremony.md) run this
// once, after resolving `design-ceremony` via bin/resolve-policy.js, to
// compose the exact `args` text for the Skill tool call, so the
// composition itself is mechanized rather than re-derived by prose at
// each site (#1886). Zero runtime npm deps, shells out to nothing.
//
// Usage: compose-brainstorm-args.js --design-ceremony <value> --input-file <path> [--help]
// Reads the file at --input-file (the record's title+body, or the bare
// topic string, exactly as it would otherwise be passed to the Skill
// tool's `args`) and prints the composed string to stdout, unchanged
// unless --design-ceremony is literally 'fast-lane'. Exit 0 on success;
// 2 on a malformed invocation (missing/unknown flag, an unreadable
// --input-file, or an --input-file that is empty/whitespace-only). Any
// --design-ceremony value other than 'fast-lane' (including 'standard'
// or a typo) is accepted and passes the input through unchanged —
// composeBrainstormingArgs's own fail-safe, not a validation error, so
// this CLI never rejects on the enum value itself; a value that is
// neither 'fast-lane' nor 'standard' additionally prints a warning to
// stderr before the unchanged stdout.
'use strict';

const fs = require('fs');
const { composeBrainstormingArgs } = require('./lib/specify/brainstorming-ceremony');

const USAGE = 'usage: compose-brainstorm-args.js --design-ceremony <value> --input-file <path> [--help]\n';

function parseArgs(argv) {
  const opts = { designCeremony: null, inputFile: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; }
    else if (a === '--design-ceremony') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) return { error: 'missing value for --design-ceremony' };
      opts.designCeremony = v;
      i++;
    } else if (a === '--input-file') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) return { error: 'missing value for --input-file' };
      opts.inputFile = v;
      i++;
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  return opts;
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// argv -> exit code. All I/O through deps so tests never touch the real
// filesystem — same seam as bin/resolve-blockers.js's run(argv, deps).
function run(argv, deps = realDeps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(opts.error + '\n' + USAGE); return 2; }
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (!opts.designCeremony) { deps.stderr('missing --design-ceremony\n' + USAGE); return 2; }
  if (!opts.inputFile) { deps.stderr('missing --input-file\n' + USAGE); return 2; }

  let input;
  try {
    input = deps.readFile(opts.inputFile);
  } catch (err) {
    deps.stderr(`compose-brainstorm-args: could not read --input-file: ${err && err.message ? err.message : String(err)}\n`);
    return 2;
  }

  if (input.trim() === '') {
    deps.stderr('compose-brainstorm-args: --input-file is empty or whitespace-only\n' + USAGE);
    return 2;
  }

  if (opts.designCeremony !== 'fast-lane' && opts.designCeremony !== 'standard') {
    deps.stderr(`compose-brainstorm-args: warning — --design-ceremony "${opts.designCeremony}" is not "fast-lane" or "standard"; passing input through unchanged\n`);
  }

  deps.stdout(composeBrainstormingArgs(input, opts.designCeremony));
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
