#!/usr/bin/env node
// bin/harness-cost-report.js — thin CLI over
// bin/lib/skill-audit/harness-cost.js's estimateHarnessCost(), the
// tool-count / shared-citation-depth measurement #2741 added alongside
// context-cost.js's existing prose-byte measurement. Exists so a skill's own
// prose (harness-health's Workflow, mirroring its existing
// Composed-bytes-per-step check) can invoke this as a plain Bash command
// rather than an inline `node -e`. Zero runtime npm deps.
//
// Usage: harness-cost-report.js --plugin-root <dir> [--ratio-threshold <n>] [--help]
// `--plugin-root` is the directory holding `skills/` directly beneath it —
// this repo: `plugin/`; an installed consumer: `${CLAUDE_PLUGIN_ROOT}` —
// never the repo root (same precondition as context-cost-report.js).
// `--ratio-threshold` overrides flagHighToolCount's default (2x the
// four-tool baseline) — rarely needed; exists for a one-off deeper sweep.
//
// Output (stdout): one JSON line —
// { totalSkills, unscopedCount, flagged: [...], entries: [...] } — `entries`
// is every skill's { name, bytes, tools, toolCount, overageRatio,
// sharedCitations }, sorted by bytes descending; `flagged` is the subset
// `flagHighToolCount` returns. Exit 0 on success; 2 on malformed invocation.
'use strict';
const path = require('path');
const { estimateHarnessCost, flagHighToolCount } = require('./lib/skill-audit/harness-cost');

const USAGE = 'usage: harness-cost-report.js --plugin-root <dir> [--ratio-threshold <n>] [--help]\n';

function parseArgs(argv) {
  // `ratioThreshold` stays undefined when the flag is absent, so
  // flagHighToolCount's own default applies.
  const o = { pluginRoot: null, ratioThreshold: undefined, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--plugin-root') o.pluginRoot = next();
    else if (a === '--ratio-threshold') {
      const v = next();
      const n = Number(v);
      if (v === null || !Number.isFinite(n)) return { error: `--ratio-threshold must be a number, got: ${v}` };
      o.ratioThreshold = n;
    } else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`harness-cost-report.js: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.pluginRoot) { deps.stderr(`harness-cost-report.js: --plugin-root <dir> is required\n${USAGE}`); return 2; }
  const root = path.resolve(o.pluginRoot);
  let report;
  try {
    const { entries, totalSkills, unscopedCount } = estimateHarnessCost(root);
    const flagged = flagHighToolCount(entries, { ratioThreshold: o.ratioThreshold });
    report = { totalSkills, unscopedCount, flagged, entries };
  } catch (err) {
    deps.stderr(`harness-cost-report.js: ${err && err.message}\n`);
    return 2;
  }
  deps.stdout(`${JSON.stringify(report)}\n`);
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
