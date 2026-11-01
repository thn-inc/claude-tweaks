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
// Usage: check-artifact-overwrite.js --base <ref> [--head <ref>] [--path <pathspec>]... [--run <dir>]
//   --base is required (exclusive lower bound of the range, e.g. EXPECTED_BASE)
//   --head defaults to HEAD
//   --path may repeat; defaults to docs/journeys/ and stories/
//   --run  the multi-spec parent run dir; reads <dir>/manifest.yml and lets a
//          commit with no `refs #N` trailer be attributed to the one spec whose
//          manifest window holds its author date (refs #4593). Omitted only
//          for a run whose `parallel` waves ran with two or more members —
//          there the windows interleave and attribution stays refs-only.
//
// Exit codes (this CLI's own vocabulary — not portable to any other):
//   0  clean — no overwrite found; stdout carries {clean:true, overwrites:[]}
//   1  overwrite detected — the HARD-GATE case; stdout carries the offending
//      paths/commits/reasons, caller stops before rendering the console
//   2  malformed invocation (missing --base, unknown flag, missing value, a
//      --run that is empty or looks like a flag)
//   3  the walk itself failed (unresolvable ref, git not on PATH, etc.) —
//      stderr names the failure, nothing meaningful on stdout. Also: a
//      manifest named by --run that is missing, unreadable or does not parse,
//      lists no specs, or carries a present-but-invalid transition timestamp.
//      A spec with no transition at all is not exit 3 — it turns windows off.
//
// --run boundary posture: read-only and deliberately unanchored (no
// $RUN_ROOT resolution). manifest.yml's only writers (hooks.js manifest-init /
// spec-status) refuse a non-anchored --run, so a worktree-local shadow run dir
// never holds a manifest.yml; a dir without one exits 3 — loud, never a
// refs-only or wrong verdict.
'use strict';
const fs = require('fs');
const path = require('path');
const { checkArtifactOverwrite, ArtifactOverwriteCheckError } = require('./lib/flow/artifact-overwrite-check.js');
const { parseManifestYaml } = require('./lib/flow/manifest.js');

const USAGE = 'usage: check-artifact-overwrite.js --base <ref> [--head <ref>] [--path <pathspec>]... [--run <dir>]';

function run(argv, deps = {}) {
  const {
    stdout = process.stdout, stderr = process.stderr, check = checkArtifactOverwrite,
    readFile = fs.readFileSync,
  } = deps;
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
      case '--run':
        if (!value.trim() || value.startsWith('--')) {
          stderr.write(`check-artifact-overwrite: --run requires a directory\n${USAGE}\n`);
          return 2;
        }
        opts.run = value;
        break;
      default:
        stderr.write(`check-artifact-overwrite: unknown argument: ${arg}\n${USAGE}\n`);
        return 2;
    }
  }
  if (!opts.base) {
    stderr.write(`check-artifact-overwrite: --base is required\n${USAGE}\n`);
    return 2;
  }

  const { run: runDir, ...checkOpts } = opts;
  if (runDir) {
    // Read directly and treat any failure as "absent" (no existence pre-check).
    const file = path.join(runDir, 'manifest.yml');
    let text;
    try {
      text = readFile(file, 'utf8');
    } catch (err) {
      stderr.write(`check-artifact-overwrite: cannot read manifest ${file}: ${err.message}\n`);
      return 3;
    }
    const manifest = parseManifestYaml(text);
    if (!manifest) {
      stderr.write(`check-artifact-overwrite: manifest ${file} does not parse as a multi-spec manifest\n`);
      return 3;
    }
    checkOpts.manifest = manifest;
  }

  let result;
  try {
    result = check(checkOpts);
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
