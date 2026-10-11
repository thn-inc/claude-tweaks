#!/usr/bin/env node
// bin/resolve-ambiguity.js — mechanically resolve one staged red-team finding
// against a record body already fetched to a local file (#2699).
//   node bin/resolve-ambiguity.js <body-file> (--marker "<text>" | --marker-file <file>)
//     (--resolution "<text>" | --resolution-file <file>) --out <body-file> [--help]
// Pure local transform (compose-then-write-once, matching this repo's other
// bin/ record-editing helpers — compose-record.js, link-records.js): reads the
// current body from <body-file> (fetched by the caller via `gh issue view
// --json body -q .body` or the equivalent MCP `issue_read`/`get_file_contents`
// call — this CLI never touches gh or MCP itself), replaces the single
// verbatim occurrence of the marker (a full `<!-- ambiguity: ... -->` comment
// or a whole `## Open Questions` row) with the resolution, drops the Open
// Questions section once its last row is gone, and writes the result to --out.
// The *-file forms exist so record-derived text never passes through a shell
// (backticks, `$(...)`, quotes); one trailing newline is stripped from each.
// Also reports whether `ready` is restorable: the body passes the spec-shaped
// gate (materialize-format.js's shapeGate) and no `## Open Questions` heading
// survives. The caller writes the body back (`gh issue edit --body-file` /
// `create_or_update_file`) and conditionally re-adds `ready` — see
// specify/decomposition-mode-closeout.md's "Staged for caller" procedure.
// Exit 0 = replaced, --out written (stdout: {out, markersRemaining,
//   openQuestionsRemaining, openQuestionsRemoved, readyRestorable});
// 2 = malformed invocation, an unreadable input file, or --out could not be written;
// 3 = the marker is not in the body, or occurs more than once (nothing written).
'use strict';

const fs = require('fs');
const { resolveAmbiguityMarker } = require('./lib/issues/ambiguity-resolve');

const USAGE = 'usage: resolve-ambiguity.js <body-file> (--marker "<text>" | --marker-file <file>) (--resolution "<text>" | --resolution-file <file>) --out <body-file> [--help]\n';

function parseArgs(argv) {
  const o = {
    bodyFile: null, marker: null, markerFile: null, resolution: null, resolutionFile: null, out: null, help: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--marker') o.marker = next();
    else if (a === '--marker-file') o.markerFile = next();
    else if (a === '--resolution') o.resolution = next();
    else if (a === '--resolution-file') o.resolutionFile = next();
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

// A file written by an editor or a heredoc ends in a newline the marker text
// itself doesn't carry — strip exactly one.
const stripTrailingNewline = (s) => s.replace(/\r?\n$/, '');

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`resolve-ambiguity.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.bodyFile) return usageError('<body-file> is required');
  if (o.marker !== null && o.markerFile !== null) return usageError('pass --marker or --marker-file, not both');
  if (o.resolution !== null && o.resolutionFile !== null) return usageError('pass --resolution or --resolution-file, not both');
  if ((o.marker === null || o.marker === '') && !o.markerFile) return usageError('--marker <text> or --marker-file <file> is required');
  if (o.resolution === null && !o.resolutionFile) return usageError('--resolution <text> or --resolution-file <file> is required');
  if (!o.out) return usageError('--out <body-file> is required');

  const read = (label, p) => {
    try { return { value: deps.readFile(p) }; } catch (err) {
      return { error: usageError(`could not read ${label}: ${p} (${err && err.message})`) };
    }
  };

  const body = read('<body-file>', o.bodyFile);
  if (body.error !== undefined) return body.error;
  let marker = o.marker;
  if (o.markerFile) {
    const r = read('--marker-file', o.markerFile);
    if (r.error !== undefined) return r.error;
    marker = stripTrailingNewline(r.value);
    if (marker === '') return usageError(`--marker-file is empty: ${o.markerFile}`);
  }
  let resolution = o.resolution;
  if (o.resolutionFile) {
    const r = read('--resolution-file', o.resolutionFile);
    if (r.error !== undefined) return r.error;
    resolution = stripTrailingNewline(r.value);
  }

  let result;
  try {
    result = resolveAmbiguityMarker(body.value, marker, resolution);
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
    openQuestionsRemoved: result.openQuestionsRemoved,
    readyRestorable: result.readyRestorable,
  })}\n`);
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
