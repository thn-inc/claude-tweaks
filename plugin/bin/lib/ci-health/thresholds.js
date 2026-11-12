// plugin/bin/lib/ci-health/thresholds.js — breach detection, the one breach issue's composition,
// and dedup-then-file for /claude-tweaks:harness-health's CI health check (#5161). No spawns and
// no config reads: ci-health.js passes the stats and billing results, the project's `work-types`
// value, and the `openIssueTitles()` / `createIssue({title, body, labels, type}) -> {number}` deps.
//
// Breach kinds: a workflow with a `pull_request` event and at least P90_BREACH_MIN_RUNS completed
// runs (`completedRuns`, so skipped no-work runs never lift it to the floor) whose whole-window p90
// is above the watch; a readable `headroomPct` — the same 2-dp value the envelope carries — below
// the floor. The issue body names workflows, p90 seconds, the headroom percentage and the floor,
// never an amount.
//
// The issue is typed like every other harness-health filing (harness-health/filing.md's "Type
// expression branch"): `work-types: labels` adds `type:task` and returns `type: null`; any other
// value, unset included, returns `type: 'task'` for the native Issue Type.
'use strict';

const { MERGE_GATE_WATCH_SECONDS, P90_BREACH_MIN_RUNS, DEFAULT_MIN_HEADROOM_PCT } = require('./constants');
const { errorText } = require('./fetch');
const { isNum } = require('./billing');
const { recordPayload, specShapedBody } = require('../issues/record');

const BREACH_TITLE = 'CI health: workflow p90 duration or Actions budget headroom breaches a threshold';

function breachesOf({ workflows, billing }, { minHeadroomPct = DEFAULT_MIN_HEADROOM_PCT, watchSeconds = MERGE_GATE_WATCH_SECONDS } = {}) {
  const breaches = [];
  for (const w of workflows || []) {
    if (!Array.isArray(w.events) || !w.events.includes('pull_request')) continue;
    if (!(w.completedRuns >= P90_BREACH_MIN_RUNS) || !isNum(w.p90Seconds) || w.p90Seconds <= watchSeconds) continue;
    breaches.push({ kind: 'p90-over-watch', workflow: w.name, path: w.path, p90Seconds: w.p90Seconds });
  }
  if (billing && billing.available === true && isNum(billing.headroomPct) && billing.headroomPct < minHeadroomPct) {
    breaches.push({ kind: 'headroom-below-floor', headroomPct: billing.headroomPct, floor: minHeadroomPct });
  }
  return breaches;
}

// A workflow's `name` comes from its YAML and its `path` names its file, and a fork PR can add a
// workflow file under any name with any YAML, so both are neutralized before they reach the
// markdown body: whitespace runs (newlines included) collapse to one space, a backtick becomes `'`,
// and `@` becomes `(at)` so no mention can ping anyone.
function neutralName(name) {
  return String(name).replace(/\s+/g, ' ').trim().replace(/`/g, "'").replace(/@/g, '(at)');
}

function breachLine(breach, watchSeconds) {
  if (breach.kind === 'p90-over-watch') {
    return `- Workflow \`${neutralName(breach.workflow)}\` (\`${neutralName(breach.path)}\`): whole-window p90 run duration ${breach.p90Seconds} s, above the merge gate's ${watchSeconds} s watch.`;
  }
  return `- Actions budget headroom ${breach.headroomPct}%, below the ${breach.floor}% floor.`;
}

// Dedup is an exact title match against open issues only, so closing resolves nothing and no label
// suppresses a later filing — the footer says that instead of specShapedBody's default.
const FOOTER = "_Filed by `/claude-tweaks:harness-health`'s CI health check. A later `--file` run files again while a breach remains and no open issue carries this exact title._";

function composeBreachIssue(breaches, {
  repo, days, watchSeconds = MERGE_GATE_WATCH_SECONDS, minHeadroomPct = DEFAULT_MIN_HEADROOM_PCT, workTypes,
} = {}) {
  const body = specShapedBody({
    header: [
      `CI health over the last ${days} days of \`${repo}\` workflow runs, against the merge gate's ${watchSeconds} s watch and a ${minHeadroomPct}% Actions budget headroom floor.`,
      `p90 is run duration and excludes queue wait — advisory evidence for the merge gate's ${watchSeconds} s watch, not a verdict on it.`,
    ].join('\n\n'),
    currentState: breaches.map((b) => breachLine(b, watchSeconds)).join('\n'),
    deliverables: [
      `- A recorded decision for each breach under Current State: for a workflow, speed it up or accept its duration (the ${watchSeconds} s watch is fixed by design); for headroom, raise the Actions budget or reduce Actions usage.`,
    ],
    acceptanceCriteria: [
      '- Every breach under Current State has a recorded decision on this issue.',
      '- A later CI health check reports no breach, or this issue records why a remaining breach is accepted.',
    ].join('\n'),
    releaseNote: 'No user-visible change — CI health evidence.',
    filedBy: '/claude-tweaks:harness-health',
    footer: FOOTER,
  });
  const payload = recordPayload({
    title: BREACH_TITLE,
    body,
    type: 'task',
    origin: 'harness-health',
    risk: 'low',
    size: 'low',
    ready: false,
    fingerprint: 'ci-health-threshold-breach',
  });
  if (workTypes === 'labels') return { ...payload, labels: [...payload.labels, 'type:task'], type: null };
  return payload;
}

// Every `skipped` value fileBreaches returns; render.js prints one as `not filed: {reason}`, and
// harness-health/ci-health-check.md names the ones that can print (a test pins the two equal).
const SKIP_REASONS = Object.freeze({
  NO_FILE: 'no --file',
  NO_BREACH: 'no breach',
  TRUNCATED: 'window truncated',
  RUNS_READ_FAILED: 'runs read failed',
  OPEN_ISSUE_EXISTS: 'open issue exists',
});

// A failed runs read (any page, page 1 included) covers only part of the window, like a truncated
// one, so neither files.
function fileBreaches({ breaches, truncated, partial, file }, { openIssueTitles, createIssue }, composeArgs) {
  const outcome = (fields) => ({ filed: null, skipped: null, failure: null, ...fields });
  if (!file) return outcome({ skipped: SKIP_REASONS.NO_FILE });
  if (!breaches || breaches.length === 0) return outcome({ skipped: SKIP_REASONS.NO_BREACH });
  if (truncated) return outcome({ skipped: SKIP_REASONS.TRUNCATED });
  if (partial) return outcome({ skipped: SKIP_REASONS.RUNS_READ_FAILED });
  let titles;
  try {
    titles = openIssueTitles();
  } catch (err) {
    return outcome({ failure: { query: 'open issue titles', error: errorText(err) } });
  }
  // An unreadable title list cannot prove there is no duplicate, so it files nothing.
  if (!Array.isArray(titles)) {
    return outcome({ failure: { query: 'open issue titles', error: 'open issue titles is not a list' } });
  }
  if (titles.includes(BREACH_TITLE)) return outcome({ skipped: SKIP_REASONS.OPEN_ISSUE_EXISTS });
  const payload = composeBreachIssue(breaches, composeArgs);
  let created;
  try {
    created = createIssue(payload);
  } catch (err) {
    return outcome({ failure: { query: 'file issue', error: errorText(err) } });
  }
  return outcome({ filed: { title: payload.title, number: created && isNum(created.number) ? created.number : null } });
}

module.exports = { BREACH_TITLE, SKIP_REASONS, breachesOf, composeBreachIssue, fileBreaches };
