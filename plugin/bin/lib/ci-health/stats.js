// plugin/bin/lib/ci-health/stats.js — pure statistics over a GitHub Actions workflow-runs array
// (`repos/{o}/{r}/actions/runs` entries) for /claude-tweaks:harness-health's CI health check
// (#5161). No spawns, no I/O: ci-health.js reads the runs and hands them here.
//
// Workflows are grouped by `path` and named from their newest run by `created_at`.
//
// Percentiles are nearest-rank over `updated_at` minus `run_started_at`, completed runs only.
// Weekly buckets are consecutive 7-day windows anchored at `from` (by `created_at`); the trailing
// partial bucket stays out of the trend but counts in the whole-window figures.
//
// Superseded: per workflow, among runs on non-default branches keyed by
// `head_repository.full_name` + `head_branch`, a run whose `head_sha` is not the head of the newest
// run (by `created_at`) for that key, whatever its conclusion; denominator = that workflow's
// non-default-branch runs. Default-branch runs are never superseded. A run is default-branch work
// only when `head_branch` is the default branch and its `head_repository` is null or is the run's
// own `repository`: a fork PR from the fork's own `main` is non-default-branch work, keyed and
// counted like any other. With no default branch known (`defaultBranch: null`) both superseded
// figures are null.
//
// The trend label and the push flag compare the same 2-dp rounded value the Workflow reports
// (`trend.ratio`, `pushRunRate`), so a reported 1.25 is never `flat` and a 0.9 never unflagged.
//
// A completed run whose conclusion is in NO_WORK_CONCLUSIONS did no CI work: it counts in `runs`
// and `noWorkRuns` and stays out of the percentiles, the weekly buckets, `completedRuns` and the
// trend's per-bucket floor. A completed working run with no usable duration (a missing or
// unparsable timestamp, or `run_started_at` after `updated_at`) counts in `skippedRuns` instead.
'use strict';

const {
  BUCKET_DAYS,
  MIN_BUCKET_RUNS,
  TREND_RISING,
  TREND_FALLING,
  PUSH_RATE_FLAG,
  PUSH_SAMPLE_FLOOR,
  NO_WORK_CONCLUSIONS,
} = require('./constants');

const BUCKET_MS = BUCKET_DAYS * 24 * 60 * 60 * 1000;

function parseTime(value) {
  return typeof value === 'string' ? Date.parse(value) : NaN;
}

// An unparsable `created_at` sorts oldest and lands in no weekly bucket.
function createdMs(run) {
  const ms = parseTime(run.created_at);
  return Number.isNaN(ms) ? -Infinity : ms;
}

function durationSeconds(run) {
  if (!run || run.status !== 'completed') return null;
  const started = parseTime(run.run_started_at);
  const updated = parseTime(run.updated_at);
  if (Number.isNaN(started) || Number.isNaN(updated) || updated < started) return null;
  return (updated - started) / 1000;
}

function nearestRank(sortedAsc, p) {
  const n = sortedAsc.length;
  if (n === 0) return null;
  const rank = Math.min(n, Math.max(1, Math.ceil((p * n) / 100)));
  return sortedAsc[rank - 1];
}

const round2 = (x) => Math.round(x * 100) / 100;
const ascending = (values) => [...values].sort((a, b) => a - b);
const p50 = (values) => nearestRank(ascending(values), 50);

// Newest by `created_at`; an equal timestamp falls to the higher run id.
function newestOf(runs) {
  let best = null;
  for (const run of runs) {
    if (best === null) { best = run; continue; }
    const a = createdMs(run);
    const b = createdMs(best);
    if (a > b || (a === b && (run.id || 0) > (best.id || 0))) best = run;
  }
  return best;
}

function trendOf(buckets) {
  if (buckets.length < 2) return 'insufficient';
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (first.length < MIN_BUCKET_RUNS || last.length < MIN_BUCKET_RUNS) return 'insufficient';
  const firstP50 = p50(first);
  if (firstP50 === 0) return 'insufficient';
  const ratio = round2(p50(last) / firstP50);
  return { ratio, label: trendLabel(ratio) };
}

function trendLabel(ratio) {
  if (ratio >= TREND_RISING) return 'rising';
  if (ratio <= TREND_FALLING) return 'falling';
  return 'flat';
}

function byPath(a, b) {
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

function isDefaultBranchRun(run, defaultBranch) {
  if (run.head_branch !== defaultBranch) return false;
  if (!run.head_repository) return true;
  return Boolean(run.repository) && run.head_repository.full_name === run.repository.full_name;
}

function supersededOf(group, defaultBranch) {
  if (defaultBranch == null) return { superseded: null, supersededShare: null };
  const byKey = new Map();
  for (const run of group) {
    if (isDefaultBranchRun(run, defaultBranch)) continue;
    // JSON.stringify writes an undefined array entry as null, so a missing field keys like null.
    const key = JSON.stringify([run.head_repository ? run.head_repository.full_name : null, run.head_branch]);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(run);
  }
  let denominator = 0;
  let superseded = 0;
  for (const keyed of byKey.values()) {
    const head = newestOf(keyed).head_sha;
    denominator += keyed.length;
    for (const run of keyed) if (run.head_sha !== head) superseded += 1;
  }
  return { superseded, supersededShare: denominator === 0 ? null : round2(superseded / denominator) };
}

function workflowStats(path, group, { fromMs, fullBuckets, defaultBranch, pushSample }) {
  const events = new Set();
  const pushShas = new Set();
  const durations = [];
  const buckets = Array.from({ length: fullBuckets }, () => []);
  let skippedRuns = 0;
  let noWorkRuns = 0;
  let cancelled = 0;
  for (const run of group) {
    if (run.event) events.add(run.event);
    if (run.event === 'push' && run.head_sha) pushShas.add(run.head_sha);
    if (run.conclusion === 'cancelled') cancelled += 1;
    if (run.status !== 'completed') continue;
    if (NO_WORK_CONCLUSIONS.includes(run.conclusion)) { noWorkRuns += 1; continue; }
    const seconds = durationSeconds(run);
    if (seconds === null) { skippedRuns += 1; continue; }
    durations.push(seconds);
    const bucket = Math.floor((createdMs(run) - fromMs) / BUCKET_MS);
    if (bucket >= 0 && bucket < fullBuckets) buckets[bucket].push(seconds);
  }
  const sorted = ascending(durations);
  const rate = pushSample === null || pushShas.size === 0 ? null : round2(pushShas.size / pushSample);
  const { superseded, supersededShare } = supersededOf(group, defaultBranch);
  return {
    name: newestOf(group).name,
    path,
    events: [...events].sort(),
    runs: group.length,
    completedRuns: durations.length,
    skippedRuns,
    noWorkRuns,
    p50Seconds: nearestRank(sorted, 50),
    p90Seconds: nearestRank(sorted, 90),
    weeklyP50Seconds: buckets.map((bucket) => (bucket.length === 0 ? null : p50(bucket))),
    trend: trendOf(buckets),
    superseded,
    supersededShare,
    cancelled,
    pushRunRate: rate,
    pushesOnNearlyEveryPush: rate !== null && rate >= PUSH_RATE_FLAG,
  };
}

function computeStats(runs, { from, days, defaultBranch }) {
  const groups = new Map();
  const allPushShas = new Set();
  for (const run of runs) {
    if (!groups.has(run.path)) groups.set(run.path, []);
    groups.get(run.path).push(run);
    if (run.event === 'push' && run.head_sha) allPushShas.add(run.head_sha);
  }
  const context = {
    fromMs: from.getTime(),
    fullBuckets: Math.floor(days / BUCKET_DAYS),
    defaultBranch,
    pushSample: allPushShas.size >= PUSH_SAMPLE_FLOOR ? allPushShas.size : null,
  };
  const out = [];
  for (const [path, group] of groups) out.push(workflowStats(path, group, context));
  return out.sort(byPath);
}

module.exports = { durationSeconds, nearestRank, computeStats, round2 };
