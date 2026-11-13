// plugin/bin/lib/ci-health/render.js — the fixed report lines bin/ci-health.js prints for
// /claude-tweaks:harness-health's CI health check (#5161). Pure: renderReport(report) takes the
// CLI's report envelope and returns one string per line; harness-health copies the lines verbatim.
//
// The runs half is unavailable when gh is absent or no runs page was read (the envelope's
// `runsAvailable`, fetch.js's `available`); only an available, empty runs half says there were no
// runs. The unavailable line shows the newest range's page 1 HTTP status, else its error. A
// truncated window's one line names each range fetch.js marked truncated. An unreadable billing
// endpoint never reads as "no budget".
//
// Every free-text value (a gh error, a reason) has its whitespace runs collapsed to one space, so
// each item stays on its own line. A workflow's name and path come from YAML a fork PR controls, so
// they go through neutralName and render inside a code span: a name can then never open a line with
// a report prefix such as `failed read:`, render a link, ping a mention, or carry a terminal escape.
'use strict';

const { RUNS_PER_PAGE, MAX_RUN_PAGES } = require('./constants');
const { NO_BUDGET } = require('./billing');
const { weekCount } = require('./stats');

const oneLine = (value) => String(value).replace(/\s+/g, ' ').trim();
const seconds = (value) => (value === null ? 'n/a' : `${value}s`);

// The one neutralizer for a fork-controlled workflow name or path, shared by these report lines and
// thresholds.js's issue body, both of which put it inside a code span: C0 controls (ESC included),
// DEL and C1 controls are dropped, whitespace runs (newlines included) collapse to one space, a
// backtick becomes `'` so the code span cannot be closed early (a link or heading inside it stays
// literal text), and `@` becomes `(at)` so no mention can ping anyone.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g;
function neutralName(name) {
  return String(name).replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().replace(/`/g, "'").replace(/@/g, '(at)');
}
const code = (value) => `\`${neutralName(value)}\``;

function workflowLine(w, watchSeconds) {
  let line = `${code(w.name)} (${code(w.path)}): ${w.runs} runs, p50 ${seconds(w.p50Seconds)}, p90 ${seconds(w.p90Seconds)}`;
  // Only a pull_request workflow sits behind the merge gate's watch (and can breach it), so a push-only
  // or scheduled workflow's p90 never reads as over the watch.
  const gated = Array.isArray(w.events) && w.events.includes('pull_request');
  if (gated && w.p90Seconds !== null && w.p90Seconds > watchSeconds) line += ` — over the ${watchSeconds}s merge-gate watch`;
  line += w.trend === 'insufficient' ? ', trend insufficient' : `, trend ${w.trend.label} ${w.trend.ratio}`;
  if (w.superseded === null) line += ', superseded n/a';
  else line += `, superseded ${w.superseded} (${w.supersededShare === null ? 'n/a' : w.supersededShare})`;
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

// An unavailable half read no page, so its first runs failure is the newest range's page 1.
function runsUnavailableLine(failures) {
  const firstPage = failures.find((f) => /^runs \S+ page 1$/.test(f.query));
  if (!firstPage) return 'runs unavailable';
  const why = firstPage.status != null ? `HTTP ${firstPage.status}` : oneLine(firstPage.error);
  return why ? `runs unavailable (${why})` : 'runs unavailable';
}

function breachLine(breach, watchSeconds) {
  if (breach.kind === 'p90-over-watch') {
    return `breach: ${code(breach.workflow)} (${code(breach.path)}) p90 ${breach.p90Seconds}s over the ${watchSeconds}s merge-gate watch`;
  }
  return `breach: Actions budget headroom ${breach.headroomPct}% below the ${breach.floor}% floor`;
}

// A failed filing has no filing line: its `failed read: {query}: …` line names it.
function filingLine({ filed, filingSkipped }) {
  if (filed) {
    const { number, title } = filed;
    return number === null ? `filed (issue number unread): ${title}` : `filed #${number}: ${title}`;
  }
  return filingSkipped ? `not filed: ${filingSkipped}` : null;
}

function renderReport(report) {
  const { days, from } = report.window;
  const failures = report.failures || [];
  const out = [`ci health: ${report.repo}, last ${days} days (from ${from})`];
  if (report.truncated) {
    const ranges = report.truncatedRanges || [];
    const named = ranges.map((r) => `${r.from}..${r.to} ${r.reason}`).join(', ');
    // A `budget` week may not have been read at all, so the line says so rather than calling its
    // durations sampled.
    const unread = ranges.some((r) => r.reason === 'budget') ? ' (a `budget` week is unread or partly read)' : '';
    out.push(`window truncated: ${ranges.length} of ${weekCount(days)} weeks hit the ${RUNS_PER_PAGE * MAX_RUN_PAGES}-run cap or the read budget (${named}); durations for those weeks are sampled from the runs read${unread}, counts are partial`);
  }
  if (report.ghAbsent) out.push('runs unavailable (gh absent)');
  else if (report.runsAvailable !== true) out.push(runsUnavailableLine(failures));
  else if (report.workflows.length === 0) out.push(`no workflow runs in the last ${days} days`);
  else for (const w of report.workflows) out.push(workflowLine(w, report.watchSeconds));
  out.push(billingLine(report));
  for (const breach of report.breaches) out.push(breachLine(breach, report.watchSeconds));
  // `filed` and `filingSkipped` are both null without --file.
  const filing = report.breaches.length > 0 ? filingLine(report) : null;
  if (filing) out.push(filing);
  for (const f of failures) out.push(`failed read: ${oneLine(f.query)}: ${oneLine(f.error)}`);
  return out;
}

module.exports = { renderReport, oneLine, neutralName };
