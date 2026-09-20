#!/usr/bin/env node
// bin/check-artifact-overwrite.js — refs #2014
//
// Mechanized front-end for the multi-spec artifact-overwrite completion check
// (plugin/skills/flow/multispec-artifact-namespacing.md, #786): walks the
// shared worktree's own commit range and reports whether any docs/journeys/
// or stories/ path that one spec added was later genuinely overwritten by a
// different spec's commit, as opposed to append-only extension. See
// bin/lib/flow/artifact-overwrite-check.js for the algorithm.
//
// Usage: check-artifact-overwrite.js --base <ref> [--head <ref>] [--path <pathspec>]...
//   --base is required (exclusive lower bound of the range, e.g. EXPECTED_BASE)
//   --head defaults to HEAD
//   --path may repeat; defaults to docs/journeys/ and stories/
//
// Exit codes (this CLI's own vocabulary — not portable to any other):
//   0  clean — no overwrite found; stdout carries {clean:true, overwrites:[]}
//   1  overwrite detected — the HARD-GATE case; stdout carries the offending
//      paths/commits/reasons, caller stops before rendering the console
//   2  malformed invocation (missing --base, unknown flag, missing value)
//   3  the walk itself failed (unresolvable ref, git not on PATH, etc.) —
//      stderr names the failure, nothing meaningful on stdout
'use strict';
const { checkArtifactOverwrite, ArtifactOverwriteCheckError } = require('./lib/flow/artifact-overwrite-check.js');

const USAGE = 'usage: check-artifact-overwrite.js --base <ref> [--head <ref>] [--path <pathspec>]...';

function run(argv, deps = {}) {
  const { stdout = process.stdout, stderr = process.stderr, check = checkArtifactOverwrite } = deps;
  const args = argv.slice(2);
  const opts = { paths: [] };
  while (args.length) {
    const arg = args.shift();
    if (arg === '--help') {
      stdout.write(`${USAGE}\n`);
      return 0;
    }
    const value = args.shift();
    if (value === undefined) {
      stderr.write(`check-artifact-overwrite: ${arg} requires a value\n${USAGE}\n`);
      return 2;
    }
    switch (arg) {
      case '--base': opts.base = value; break;
      case '--head': opts.head = value; break;
      case '--path': opts.paths.push(value); break;
      default:
        stderr.write(`check-artifact-overwrite: unknown argument: ${arg}\n${USAGE}\n`);
        return 2;
    }
  }
  if (!opts.base) {
    stderr.write(`check-artifact-overwrite: --base is required\n${USAGE}\n`);
    return 2;
  }

  let result;
  try {
    result = check(opts);
  } catch (err) {
    // Only a walk failure (unresolvable ref, git not on PATH -- an
    // ArtifactOverwriteCheckError) is this CLI's own exit 3. Anything else
    // is a real bug in the check itself and must crash loud, not be
    // misreported as an environment problem (refs #2014 review).
    if (!(err instanceof ArtifactOverwriteCheckError)) throw err;
    stderr.write(`check-artifact-overwrite: ${err.message}\n`);
    return 3;
  }
  stdout.write(`${JSON.stringify(result)}\n`);
  return result.clean ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = run(process.argv);
}

module.exports = { run };
