#!/usr/bin/env node
// bin/resolve-ambiguity.js — mechanically resolve one staged red-team finding
// against a record body already fetched to a local file (#2699).
//   node bin/resolve-ambiguity.js <body-file> --marker "<text>" --resolution "<text>" --out <body-file> [--help]
// Pure local transform (compose-then-write-once, matching this repo's other
// bin/ record-editing helpers — compose-record.js, link-records.js): reads the
// current body from <body-file> (fetched by the caller via `gh issue view
// --json body -q .body` or the equivalent MCP `issue_read`/`get_file_contents`
// call — this CLI never touches gh or MCP itself), replaces the FIRST verbatim
// occurrence of --marker with --resolution, and writes the result to --out.
// Also reports whether `ready` is restorable per spec-template.md's structural
// check: zero remaining `<!-- ambiguity: -->` markers AND no surviving
// `## Open Questions` heading. The caller writes the body back
// (`gh issue edit --body-file` / `create_or_update_file`) and conditionally
// re-adds `ready` — see specify/decomposition-mode-closeout.md's "Staged for
// caller" resolution pointer.
// Exit 0 = replaced, --out written (stdout: {out, markersRemaining,
//   openQuestionsRemaining, readyRestorable});
// 2 = malformed invocation, or --out could not be written;
// 3 = --marker not found verbatim in the body (nothing written).
'use strict';

const fs = require('fs');
const { resolveAmbiguityMarker } = require('./lib/issues/ambiguity-resolve');

const USAGE = 'usage: resolve-ambiguity.js <body-file> --marker "<text>" --resolution "<text>" --out <body-file> [--help]\n';

function parseArgs(argv) {
  const o = {
    bodyFile: null, marker: null, resolution: null, out: null, help: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--marker') o.marker = next();
    else if (a === '--resolution') o.resolution = next();
    else if (a === '--out') o.out = next();
    else if (a.startsWith('--')) return { error: `unknown argument: ${a}` };
    else positional.push(a);
  }
  if (positional.length > 1) return { error: `unexpected argument: ${positional[1]}` };
  o.bodyFile = positional[0] || null;
  return o;
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: (p, s) => fs.writeFileSync(p, s),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`resolve-ambiguity.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.bodyFile) return usageError('<body-file> is required');
  if (o.marker === null || o.marker === '') return usageError('--marker <text> is required');
  if (o.resolution === null) return usageError('--resolution <text> is required');
  if (!o.out) return usageError('--out <body-file> is required');

  let body;
  try { body = deps.readFile(o.bodyFile); } catch (err) {
    return usageError(`could not read <body-file>: ${o.bodyFile} (${err && err.message})`);
  }

  let result;
  try {
    result = resolveAmbiguityMarker(body, o.marker, o.resolution);
  } catch (err) {
    deps.stderr(`resolve-ambiguity.js: ${err && err.message}\n`);
    return 3;
  }

  try { deps.writeFile(o.out, result.body); } catch (err) {
    deps.stderr(`resolve-ambiguity.js: could not write --out file: ${o.out} (${err && err.message})\n`);
    return 2;
  }

  deps.stdout(`${JSON.stringify({
    out: o.out,
    markersRemaining: result.markersRemaining,
    openQuestionsRemaining: result.openQuestionsRemaining,
    readyRestorable: result.readyRestorable,
  })}\n`);
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
