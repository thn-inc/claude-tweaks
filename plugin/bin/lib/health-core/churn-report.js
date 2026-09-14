'use strict';

// Shared churn-report renderer — byte-identical across all four
// health-suite CLIs' cmdChurnReport (code-health.js, harness-health.js,
// journey-health.js, docs-health.js) before this extraction. Each engine
// supplies its own readDurableState/computeChurn (all four now share the
// same computeChurn implementation, bin/lib/health-core/runs.js, which
// returns a `stayed` field alongside `appeared`/`disappeared`/`ratio`), but
// this renderer never reads `stayed`, so it works unmodified regardless.
function makeCmdChurnReport({ readDurableState, computeChurn }) {
  return function cmdChurnReport(args) {
    const root = args.root || process.cwd();
    const runs = readDurableState(root).runs;
    if (runs.length === 0) {
      process.stdout.write('no run logs found\n');
      return;
    }
    let threshold = null;
    if (args['fail-on-high-churn'] != null) {
      threshold = parseFloat(args['fail-on-high-churn']);
      if (!Number.isFinite(threshold)) {
        process.stderr.write(`churn-report: invalid --fail-on-high-churn value: ${args['fail-on-high-churn']}\n`);
        return 2;
      }
    }
    const rows = [['runId', 'runAt', 'findings', 'appeared', 'disappeared', 'ratio']];
    let exceeded = false;
    for (let i = 0; i < runs.length; i++) {
      const prior = i > 0 ? runs[i - 1] : null;
      const c = computeChurn(runs[i].fingerprints, prior);
      rows.push([
        runs[i].runId,
        (runs[i].runAt || '').slice(0, 19),
        String(runs[i].fingerprints.length),
        String(c.appeared.length),
        String(c.disappeared.length),
        String(c.ratio),
      ]);
      if (threshold != null && prior != null && c.ratio >= threshold) exceeded = true;
    }
    const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => String(r[col]).length)));
    for (const row of rows) {
      process.stdout.write(row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ') + '\n');
    }
    if (exceeded) {
      process.stdout.write(`\nhigh churn: one or more runs >= ${threshold}\n`);
      return 1;
    }
  };
}

module.exports = { makeCmdChurnReport };
