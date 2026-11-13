// plugin/bin/lib/ci-health/constants.js — every threshold /claude-tweaks:harness-health's CI health
// check (#5161) uses, and the one code definition of the merge-verification gate's bounded watch.
//
// MERGE_GATE_WATCH_SECONDS is cited by plugin/skills/_shared/pr-first-merge.md's "Bounded watch"
// paragraph, whose shell keeps the literal `900` (an agent runs that fence and cannot require this
// module). tests/ci-health-watch-twin-pin.test.js pins the two equal, so change both together —
// and the watch is fixed by design (pr-first-merge-appendix.md's "Rationale notes"), not tuned here.
'use strict';

const MERGE_GATE_WATCH_SECONDS = 900;

// A 100-run page and the billing summary are not 5 s calls; these are github.com-only reads, so
// this deliberately does not follow the `gh-timeout-ms` policy key, mirroring
// bin/lib/activity/gather.js's ACTIVITY_GH_TIMEOUT_MS.
const CI_HEALTH_GH_TIMEOUT_MS = 15000;

const RUNS_PER_PAGE = 100;
// 10 pages of 100 is GitHub's 1,000-result ceiling for one `created`-filtered actions/runs query:
// past it the API returns no further runs. fetch.js reads the window one BUCKET_DAYS range per
// query and marks a range truncated (reason `cap`) only when its page MAX_RUN_PAGES comes back
// full, so raising this past the ceiling would read past the end and never report a capped range.
const MAX_RUN_PAGES = 10;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 400;
const BUCKET_DAYS = 7;
// The runs pages one invocation may request across every range, failed calls included: the default
// window's 5 ranges (stats.js's weekCount(DEFAULT_DAYS)) × MAX_RUN_PAGES, so the default window is
// never cut by it on any repository, while --days 400 (58 ranges, up to 580 pages) stops here.
// Ranges it leaves unread, or cuts mid-read, are truncated with reason `budget`. Worst case at
// CI_HEALTH_GH_TIMEOUT_MS per call: 50 × 15 s = 750 s of runs reads. A test pins the derivation.
const RUN_PAGE_BUDGET = 50;
const MIN_BUCKET_RUNS = 5;
const TREND_RISING = 1.25;
const TREND_FALLING = 0.8;
const PUSH_RATE_FLAG = 0.9;
const PUSH_SAMPLE_FLOOR = 10;
const P90_BREACH_MIN_RUNS = 5;
const DEFAULT_MIN_HEADROOM_PCT = 10;

// A run with this conclusion did no CI work, so it counts in `runs` and `noWorkRuns` and stays out
// of the percentiles, the weekly buckets, `completedRuns` and both 5-run floors (the spec's Plan
// Review Clarifications).
const NO_WORK_CONCLUSIONS = Object.freeze(['skipped']);

module.exports = {
  MERGE_GATE_WATCH_SECONDS,
  CI_HEALTH_GH_TIMEOUT_MS,
  RUNS_PER_PAGE,
  MAX_RUN_PAGES,
  RUN_PAGE_BUDGET,
  DEFAULT_DAYS,
  MAX_DAYS,
  BUCKET_DAYS,
  MIN_BUCKET_RUNS,
  TREND_RISING,
  TREND_FALLING,
  PUSH_RATE_FLAG,
  PUSH_SAMPLE_FLOOR,
  P90_BREACH_MIN_RUNS,
  DEFAULT_MIN_HEADROOM_PCT,
  NO_WORK_CONCLUSIONS,
};
