#!/usr/bin/env node
// bin/context-cost-report.js — thin CLI over
// bin/lib/skill-audit/context-cost.js's composedBytesReport(), the per-step
// composed-bytes measurement #1990 already built. Exists so a skill's own
// prose (harness-health's Workflow, in particular) can invoke this as a
// plain Bash command rather than needing an inline `node -e` that re-derives
// the report shape. Zero runtime npm deps.
//
// Usage: context-cost-report.js --plugin-root <dir> [--help]
// `--plugin-root` is the directory holding `skills/` directly beneath it —
// this repo: `plugin/`; an installed consumer: `${CLAUDE_PLUGIN_ROOT}` —
// never the repo root (composedBytesReport's own precondition; a repo-root
// caller gets a clear rejection from that layer, not an ENOENT).
// Output (stdout): one JSON line — an array of
// { step, file, line, bytes: {max, byCombination: [...]} } rows per compose
// call site, unparsed/error rows included with their `error`/`reason` field
// instead of `bytes`. Exit 0 on success (including a row-level error —
// that's data, not a CLI failure); 2 on malformed invocation.
'use strict';
const path = require('path');
const { composedBytesReport } = require('./lib/skill-audit/context-cost');

const USAGE = 'usage: context-cost-report.js --plugin-root <dir> [--help]\n';

function parseArgs(argv) {
  const o = { pluginRoot: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--plugin-root') o.pluginRoot = next();
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`context-cost-report.js: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.pluginRoot) { deps.stderr(`context-cost-report.js: --plugin-root <dir> is required\n${USAGE}`); return 2; }
  const root = path.resolve(o.pluginRoot);
  let reportRows;
  try {
    reportRows = composedBytesReport(root);
  } catch (err) {
    deps.stderr(`context-cost-report.js: ${err && err.message}\n`);
    return 2;
  }
  const rows = reportRows.map((row) => {
    if (row.error) return { step: row.step, file: row.file, line: row.line, error: row.error };
    return {
      step: row.step,
      file: row.file,
      line: row.line,
      bytes: { max: row.max, byCombination: row.combinations.map((c) => ({ conditions: c.conditions, bytes: c.bytes })) },
    };
  });
  deps.stdout(`${JSON.stringify(rows)}\n`);
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
