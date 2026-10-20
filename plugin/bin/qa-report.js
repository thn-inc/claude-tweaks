#!/usr/bin/env node
// bin/qa-report.js — the only writer of a QA run's report.json (#3328). The
// /claude-tweaks:test QA Phase 5 hands this CLI a per-story results payload;
// lib/qa-report/compose.js validates it and derives every aggregate (summary,
// findings, caveats, ...) from the stories array, so report.json's counts
// cannot disagree with it the way a hand-written file can — which is what
// qa-stamp.js --write then refuses as `summary-mismatch`.
//
//   node bin/qa-report.js --results <RUN_DIR/story-results.json> --out <RUN_DIR/report.json>
//
// On success prints one JSON line {"written":true,"path":"<abs out>","summary":{...}}.
// On failure stderr is `qa-report.js: <reason>`. Exit vocabulary:
//   0  report.json written
//   1  the results payload is unreadable, unparseable, or invalid (no --out written)
//   2  malformed invocation (usage on stderr)
//   3  --out could not be written
//
// --out is a QA artifact path (under .claude-tweaks/artifacts/), not a pipeline
// run dir, so no run-dir anchoring guard applies. The write is an overwrite with
// no lock: one QA run owns its report.json.
'use strict';

const fs = require('fs');
const path = require('path');
const { composeQaReport } = require('./lib/qa-report/compose');
const { writeFileAtomic } = require('./lib/atomic-write');

const USAGE = 'usage: qa-report.js --results <RUN_DIR/story-results.json> --out <RUN_DIR/report.json>\n'
  + '  exit 0 written, 1 results payload unreadable/invalid, 2 malformed invocation, 3 --out unwritable\n';

const FLAGS = { '--results': 'results', '--out': 'out' };

function parseArgs(argv) {
  const o = { results: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const key = FLAGS[a];
    if (!key) return { error: `unknown argument: ${a}` };
    const v = argv[++i];
    if (v === undefined || v === '' || v.startsWith('--')) return { error: `${a} requires a value` };
    if (o[key] !== null) return { error: `${a} given more than once` };
    o[key] = v;
  }
  if (!o.results) return { error: '--results <path> is required' };
  if (!o.out) return { error: '--out <path> is required' };
  return o;
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: (p, content) => writeFileAtomic(p, content),
  now: () => new Date().toISOString(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

const errMsg = (err) => (err && (err.code || err.message)) || 'unknown';

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`qa-report.js: ${o.error}\n${USAGE}`); return 2; }
  const fail = (code, reason) => { deps.stderr(`qa-report.js: ${reason}\n`); return code; };

  let text;
  try { text = deps.readFile(o.results); } catch (err) {
    return fail(1, `results-unreadable: ${o.results} (${errMsg(err)})`);
  }
  let input;
  try { input = JSON.parse(text); } catch (err) {
    return fail(1, `results-unparseable: ${o.results} (${errMsg(err)})`);
  }
  let composed;
  try { composed = composeQaReport(input, { now: deps.now }); } catch (err) {
    return fail(1, `compose-failed: ${errMsg(err)}`);
  }
  if (composed.error) return fail(1, composed.error);

  const out = path.resolve(o.out);
  try { deps.writeFile(out, `${JSON.stringify(composed.report, null, 2)}\n`); } catch (err) {
    return fail(3, `out-unwritable: ${out} (${errMsg(err)})`);
  }
  deps.stdout(`${JSON.stringify({ written: true, path: out, summary: composed.report.summary })}\n`);
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
