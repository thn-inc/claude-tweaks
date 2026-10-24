#!/usr/bin/env node
// bin/diff-facts.js
//
// wrap-up's ceremony-derivation.md step 1 diff-facts gather as ONE process
// (#3955): the merge base and numstat (shared with blast-radius.js via
// bin/lib/blast-radius-cli.js#gatherDiffFiles) fed to computeDiffFacts
// (bin/lib/dispatch/ceremony-derive.js). A thin shell — argv parsing lives
// here, the gather and the fact derivation do not. Zero runtime npm deps.
//
// Usage: diff-facts.js (--base <ref> | --integration-branch <branch>)
// Success: exit 0, one JSON object {fileCount, testFiles, docsFiles, implFiles,
// totalLines, testOnly, docsOnly, lowSurface} on stdout.
// The documented failures — unknown flag, missing value, neither flag, and a
// BlastRadiusError (unresolvable base, git error) — exit 1 with one stderr line
// and NO stdout: a failed gather must never be readable as an empty diff, the
// same silent-approval hazard blast-radius.js guards against. Any other thrown
// error is rethrown (stack trace on stderr) and still exits 1 with NO stdout.
'use strict';
const { gatherDiffFiles, BlastRadiusError } = require('./lib/blast-radius-cli.js');
const { computeDiffFacts } = require('./lib/dispatch/ceremony-derive.js');

const USAGE = 'usage: diff-facts.js (--base <ref> | --integration-branch <branch>)';
const VALUE_FLAGS = new Set(['--base', '--integration-branch']);

function run(argv, deps = {}) {
  const stdout = deps.stdout || ((s) => process.stdout.write(s));
  const stderr = deps.stderr || ((s) => process.stderr.write(s));
  const fail = (msg) => {
    stderr(`diff-facts: ${msg}\n`);
    return 1;
  };

  const args = argv.slice();
  const opts = {};
  while (args.length) {
    const flag = args.shift();
    if (!VALUE_FLAGS.has(flag)) return fail(`unknown argument: ${flag}`);
    const value = args.shift();
    if (value === undefined || value.startsWith('--')) return fail(`${flag} requires a value`);
    if (flag === '--base') opts.base = value;
    else opts.integrationBranch = value;
  }
  if (!opts.base && !opts.integrationBranch) return fail(USAGE);

  let gathered;
  try {
    gathered = gatherDiffFiles(opts, { git: deps.git });
  } catch (err) {
    if (err instanceof BlastRadiusError) return fail(String(err.message).split('\n')[0]);
    throw err;
  }
  stdout(`${JSON.stringify(computeDiffFacts(gathered.files))}\n`);
  return 0;
}

module.exports = { run };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
