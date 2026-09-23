#!/usr/bin/env node
// bin/activity-render.js — thin CLI over bin/lib/activity/render.js (#2757). Reads facts.json
// (gh's truth) and narratives.json (the skill's prose), renders markdown, and prints one
// warning line per dropped or ambiguous citation. Logic lives in run(argv, deps).
//
// Usage: activity-render.js --facts <path> --narratives <path> --out <report.md path> [--help]
// Exit codes:
//   0 rendered (warnings on stderr, one per line — exact forms in render.js)
//   1 malformed invocation (missing --facts/--narratives/--out, unknown flag, or an
//     unwritable --out path)
//   2 facts or narratives file unreadable, not JSON, or failing schema validation (a
//     missing/unrecognized schemaVersion in either file, a refs entry that is not a string —
//     every failing path is named on stderr)
'use strict';

const fs = require('fs');
const { render, SchemaError } = require('./lib/activity/render');

const USAGE = 'usage: activity-render.js --facts <path> --narratives <path> --out <report.md path> [--help]\n';

function parseArgs(argv) {
  const o = { facts: null, narratives: null, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[i + 1]; if (v === undefined || v === '' || v.startsWith('--')) return null; i += 1; return v; };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--facts') { o.facts = next(); if (o.facts === null) return { error: '--facts requires a value' }; }
    else if (a === '--narratives') { o.narratives = next(); if (o.narratives === null) return { error: '--narratives requires a value' }; }
    else if (a === '--out') { o.out = next(); if (o.out === null) return { error: '--out requires a value' }; }
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: (p, t) => fs.writeFileSync(p, t),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function loadJson(deps, label, p) {
  let raw;
  try { raw = deps.readFile(p); } catch (err) { throw new SchemaError([{ path: label, message: `could not read ${p}: ${err && err.message}` }]); }
  try { return JSON.parse(raw); } catch (err) { throw new SchemaError([{ path: label, message: `${p} is not valid JSON: ${err && err.message}` }]); }
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`activity-render.js: ${message}\n${USAGE}`); return 1; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  for (const k of ['facts', 'narratives', 'out']) if (!o[k]) return usageError(`--${k} is required`);

  let result;
  try {
    const facts = loadJson(deps, 'facts', o.facts);
    const narratives = loadJson(deps, 'narratives', o.narratives);
    result = render(facts, narratives);
  } catch (err) {
    if (err instanceof SchemaError) {
      for (const e of err.errors) deps.stderr(`activity-render.js: ${e.path}: ${e.message}\n`);
      return 2;
    }
    throw err;
  }
  try { deps.writeFile(o.out, result.markdown); } catch (err) { deps.stderr(`activity-render.js: could not write ${o.out}: ${err && err.message}\n`); return 1; }
  for (const w of result.warnings) deps.stderr(`${w}\n`);
  deps.stdout(JSON.stringify({ out: o.out, warnings: result.warnings.length }) + '\n');
  return 0;
}

module.exports = { run, parseArgs, realDeps, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
