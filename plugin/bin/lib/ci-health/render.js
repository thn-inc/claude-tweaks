// plugin/bin/lib/ci-health/render.js — the fixed report lines bin/ci-health.js prints for
// /claude-tweaks:harness-health's CI health check (#5161). Pure: renderReport(report) takes the
// CLI's report envelope and returns one string per line; harness-health copies the lines verbatim.
//
// The runs half is unavailable when gh is absent or page 1 failed (fetch.js stops at the first
// failed page, so a `runs page 1` failure means no page was read); only an available, empty runs
// half says there were no runs. An unreadable billing endpoint never reads as "no budget".
//
// Every free-text value (a workflow name from fork-controllable YAML, a gh error, a reason) has its
// whitespace runs collapsed to one space, so each item stays on its own line.
'use strict';

const { RUNS_PER_PAGE, MAX_RUN_PAGES } = require('./constants');
const { NO_BUDGET } = require('./billing');

const oneLine = (value) => String(value).replace(/\s+/g, ' ').trim();
const seconds = (value) => (value === null ? 'n/a' : `${value}s`);

function workflowLine(w, watchSeconds) {
  let line = `${oneLine(w.name)} (${oneLine(w.path)}): ${w.runs} runs, p50 ${seconds(w.p50Seconds)}, p90 ${seconds(w.p90Seconds)}`;
  // Only a pull_request workflow sits behind the merge gate's watch (and can breach it), so a push-only
  // or scheduled workflow's p90 never reads as over the watch.
  const gated = Array.isArray(w.events) && w.events.includes('pull_request');
  if (gated && w.p90Seconds !== null && w.p90Seconds > watchSeconds) line += ` — over the ${watchSeconds}s merge-gate watch`;
  line += w.trend === 'insufficient' ? ', trend insufficient' : `, trend ${w.trend.label} ${w.trend.ratio}`;
  line += w.superseded === null
    ? ', superseded n/a'
    : `, superseded ${w.superseded} (${w.supersededShare === null ? 'n/a' : w.supersededShare})`;
  line += `, cancelled ${w.cancelled}`;
  if (w.skippedRuns) line += `, skipped ${w.skippedRuns}`;
  if (w.noWorkRuns) line += `, no-work ${w.noWorkRuns}`;
  if (w.pushesOnNearlyEveryPush) {
    line += `, runs on ${Math.round(w.pushRunRate * 100)}% of pushes (informational; a repo's only push workflow always reads 100%)`;
  }
  return line;
}

function billingLine(report) {
  const b = report.billing || {};
  if (report.ghAbsent) return 'billing unavailable (gh absent)';
  if (b.available !== true) return `billing unavailable (${oneLine(b.status != null ? b.status : b.reason)})`;
  const firstPage = b.firstPageOnly ? ' (first page of budgets only)' : '';
  if (typeof b.headroomPct === 'number') {
    return `billing: Actions budget headroom ${b.headroomPct}% (floor ${report.minHeadroomPct}%)${firstPage}`;
  }
  // A readable response missing a field the formula needs is not "no budget".
  if (b.reason && b.reason !== NO_BUDGET) return `billing: Actions budget headroom unreadable (${oneLine(b.reason)})${firstPage}`;
  return `billing: ${NO_BUDGET}${firstPage}`;
}

function breachLine(breach, watchSeconds) {
  if (breach.kind === 'p90-over-watch') {
    return `breach: ${oneLine(breach.workflow)} (${oneLine(breach.path)}) p90 ${breach.p90Seconds}s over the ${watchSeconds}s merge-gate watch`;
  }
  return `breach: Actions budget headroom ${breach.headroomPct}% below the ${breach.floor}% floor`;
}

function filingLine(outcome) {
  if (outcome.filed) {
    const { number, title } = outcome.filed;
    return number === null ? `filed (issue number unread): ${title}` : `filed #${number}: ${title}`;
  }
  if (outcome.skipped) return `not filed: ${outcome.skipped}`;
  return `not filed: ${outcome.failure ? oneLine(outcome.failure.query) : 'unknown'} failed`;
}

function renderReport(report) {
  const { days, from } = report.window;
  const failures = report.failures || [];
  const out = [`ci health: ${report.repo}, last ${days} days (from ${from})`];
  if (report.truncated) {
    out.push(`window truncated at ${RUNS_PER_PAGE * MAX_RUN_PAGES} runs: statistics cover the newest runs only`);
  }
  const firstPage = failures.find((f) => f.query === 'runs page 1');
  if (report.ghAbsent) out.push('runs unavailable (gh absent)');
  else if (firstPage) out.push(`runs unavailable (${firstPage.status != null ? `HTTP ${firstPage.status}` : oneLine(firstPage.error)})`);
  else if (report.workflows.length === 0) out.push(`no workflow runs in the last ${days} days`);
  else for (const w of report.workflows) out.push(workflowLine(w, report.watchSeconds));
  out.push(billingLine(report));
  for (const breach of report.breaches) out.push(breachLine(breach, report.watchSeconds));
  // `filed` is null without --file.
  if (report.filed && report.breaches.length > 0) out.push(filingLine(report.filed));
  for (const f of failures) out.push(`failed read: ${oneLine(f.query)}: ${oneLine(f.error)}`);
  return out;
}

module.exports = { renderReport, oneLine };
