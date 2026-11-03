'use strict';
const { classifyDecisionLine } = require('./decisions-classifier.js');

const NARROWING_MIN_APPEARANCES = 10;
const CEILING_MIN_STOPS = 10;

const HYPHENATED_ID = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})?(?:-|$)/;
const COMPACT_ID = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:-|$)/;

// 14-digit YYYYMMDDHHMMSS key from a run id's leading timestamp, or null when it has none.
function runIdTimestamp(runId) {
  const m = HYPHENATED_ID.exec(runId) || COMPACT_ID.exec(runId);
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6] || '00'}`;
}

function cmp(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function aggregate({ tsv, runs, rowIds, windowN }) {
  const datedRuns = [];
  let excluded = 0;
  for (const run of runs) {
    const key = runIdTimestamp(run.runId);
    if (key === null) excluded++;
    else datedRuns.push({ run, key });
  }
  const sortedRuns = datedRuns
    .sort((a, b) => cmp(a.key, b.key) || cmp(a.run.runId, b.run.runId))
    .map((d) => d.run);
  const windowRuns = sortedRuns.slice(-windowN);
  const windowRunIds = new Set(windowRuns.map((r) => r.runId));

  const perRow = {};
  for (const rowId of rowIds) {
    const rowsInWindow = (tsv.rows || []).filter((r) => r.rowId === rowId && windowRunIds.has(r.runId));
    if (rowsInWindow.length === 0) { perRow[rowId] = 'no runs in window'; continue; }
    const findings = rowsInWindow.reduce((sum, r) => sum + (Number(r.count) || 0), 0);
    perRow[rowId] = { appearances: rowsInWindow.length, findings };
  }

  const consoleDist = { unlogged: 0 };
  const reversibilityDist = { high: 0, med: 0, low: 0, 'n/a': 0 };
  const frictionCounts = {};
  let refusedCount = 0;
  let failedCount = 0;
  let consoleStops = 0;

  for (const run of windowRuns) {
    let sawTerminal = false;
    for (const line of run.decisionLines || []) {
      const c = classifyDecisionLine(line);
      if (c.terminalDecision) {
        consoleDist[c.terminalDecision] = (consoleDist[c.terminalDecision] || 0) + 1;
        sawTerminal = true;
        consoleStops++;
      }
      if (c.reversibility) reversibilityDist[c.reversibility] = (reversibilityDist[c.reversibility] || 0) + 1;
      if (c.kind === 'REFUSED') refusedCount++;
      if (c.kind === 'FAILED') failedCount++;
    }
    if (!sawTerminal) consoleDist.unlogged++;
    for (const [kind, n] of Object.entries((run.events && run.events.counts) || {})) {
      frictionCounts[kind] = (frictionCounts[kind] || 0) + n;
    }
  }

  const narrowingSignal = rowIds.filter((id) => {
    const r = perRow[id];
    return r !== 'no runs in window' && r.appearances >= NARROWING_MIN_APPEARANCES && r.findings === 0;
  });
  const narrowingSuppressed = rowIds.filter((id) => {
    const r = perRow[id];
    return r !== 'no runs in window' && r.appearances < NARROWING_MIN_APPEARANCES;
  });
  const ceiling = consoleStops < CEILING_MIN_STOPS;

  return {
    window: { runIds: windowRuns.map((r) => r.runId), excluded },
    perRow,
    consoleDist,
    reversibilityDist,
    frictionCounts,
    refusedCount,
    failedCount,
    narrowingSignal,
    suppressions: { narrowing: narrowingSuppressed, ceiling },
  };
}

module.exports = { aggregate, runIdTimestamp, NARROWING_MIN_APPEARANCES, CEILING_MIN_STOPS };
