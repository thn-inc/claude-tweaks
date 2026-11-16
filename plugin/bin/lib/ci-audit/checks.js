// plugin/bin/lib/ci-audit/checks.js — the checklist table /claude-tweaks:ci-health (#5757) runs over
// the aggregate result: each check's id, its default threshold, and the mechanical breaches the
// measured figures cross. A breach is a lead for the skill's judge, never a finding, and carries no
// remedy wording (the skill's checklist owns that). Pure: no spawns, no I/O, never throws.
//
// Breach = { check, workflow, job, metric, value, threshold }. repeated-work's breach also carries
// `step` (the repeated step's name) and has workflow and job null, since the aggregate counts a
// step's holder jobs across every workflow. missing-timeout's breach also carries `worstJob`, the
// run job (shard) whose figure is the breach's value.
//
// Thresholds:
//  - DEFAULTS holds the six numeric check thresholds and four absolute floors, `<check>-floor-ms`
//    (FLOOR_IDS); only an id in DEFAULTS can be overridden. serial-independent-jobs and
//    missing-concurrency have no numeric threshold (their breach reports threshold 0 against value
//    0): they are not overridable, and parseThresholds refuses them (`missing-concurrency=1` is
//    ok:false) like any unknown id.
//  - A ratio check fires when its value is strictly above the threshold — a value exactly at it
//    gives no breach. repeated-work is a count and fires at or above its threshold (3 jobs).
//  - A floor is met at or above its value: a share is no lead when the time it measures is short.
//    queue-wait needs waiting p50 ≥ queue-wait-floor-ms (30 s), setup-dominance setup p50 ≥
//    setup-dominance-floor-ms (30 s), critical-path-pole the path's pathMs ≥
//    critical-path-pole-floor-ms (60 s), missing-timeout the shard's running p90 ≥
//    missing-timeout-floor-ms (300 s: a job that ends in minutes is no runaway risk).
//  - evaluate falls back to the default for an override that is not a finite number above 0, and
//    to minSample 5 for a minSample that is not a positive integer; the CLI validates user input.
//    limits(thresholds) gives the values actually applied.
//
// Rules:
//  - queue-wait is waiting p50 ÷ the sum of the phase p50s (waiting + setup + running; a missing
//    setup figure counts 0), setup-dominance setup p50 ÷ that sum.
//  - No check fires for a job below minSample runs (default 5; `runs` equals the waiting and
//    running n). setup-dominance also needs setup.n ≥ minSample, since setup can be missing on
//    some runs.
//  - A workflow whose facts carry any `unparsed` reason, or that has no facts, is skipped by every
//    check that reads facts: missing-timeout, missing-concurrency, serial-independent-jobs,
//    repeated-work and critical-path-pole. Its `concurrencyDeclared: false` may only mean its
//    concurrency region was not read.
//  - A run job maps to a workflow job by the aggregate's own matchJob, its shard family by
//    familyOf, and a workflow's facts are trusted by its usableJobs.
//  - critical-path-pole: for each critical path of two or more jobs with allJobsMatched true, a
//    chain job (a workflow job name) whose heaviest `total.p50Ms` (the p50 of per-run totals, the
//    statistic `pathMs` is built from) among its run jobs at minSample exceeds the threshold share
//    of `pathMs`.
//  - serial-independent-jobs: an `overlaps` entry (a pair of workflow jobs that never overlapped)
//    with sharedRuns ≥ minSample, the two workflow jobs linked by no `needs` path in either
//    direction. job is the two workflow job names joined by ' + '.
//  - shard-skew: a shardSkews entry whose ratio exceeds the threshold, every shard of the family
//    at minSample.
//  - repeated-work: a repeatedSteps entry counted over the holder jobs in parsed workflows that
//    declare the step and have a run job at minSample; a matrix job counts once, not per shard.
//  - missing-timeout: one breach per workflow job with timeoutDeclared false — a property of the
//    job, not of each shard — when a run job matched to it at minSample has running p90 ÷ p50
//    above the threshold and running p90 at its floor; job is the workflow job's name, the value
//    the worst such shard's ratio.
//  - missing-concurrency: one breach per parsed workflow with concurrencyDeclared false and a run
//    job at minSample.
'use strict';

const { matchJob, familyOf, usableJobs } = require('./aggregate');

const CHECK_IDS = [
  'queue-wait',
  'setup-dominance',
  'critical-path-pole',
  'serial-independent-jobs',
  'shard-skew',
  'repeated-work',
  'missing-timeout',
  'missing-concurrency',
];

const DEFAULTS = {
  'queue-wait': 0.4,
  'setup-dominance': 0.4,
  'critical-path-pole': 0.5,
  'shard-skew': 2,
  'repeated-work': 3,
  'missing-timeout': 3,
  'queue-wait-floor-ms': 30000,
  'setup-dominance-floor-ms': 30000,
  'critical-path-pole-floor-ms': 60000,
  'missing-timeout-floor-ms': 300000,
};
const FLOOR_IDS = Object.keys(DEFAULTS).filter((id) => id.endsWith('-floor-ms'));

const DEFAULT_MIN_SAMPLE = 5;
const NUMBER = /^\d+(?:\.\d+)?$/;

const own = (obj, key) => obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const num = (v) => typeof v === 'number' && Number.isFinite(v);

function parseThresholds(text) {
  if (typeof text !== 'string') return { ok: false, error: 'thresholds must be text' };
  const values = {};
  if (text.trim() === '') return { ok: true, values };
  for (const part of text.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) return { ok: false, error: `"${part.trim()}" is not id=value` };
    const id = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    if (!own(DEFAULTS, id)) return { ok: false, error: `"${id}" is not a check with a numeric threshold` };
    if (own(values, id)) return { ok: false, error: `"${id}" is given twice` };
    if (!NUMBER.test(raw) || !(Number(raw) > 0)) return { ok: false, error: `"${id}" needs a positive number, got "${raw}"` };
    values[id] = Number(raw);
  }
  return { ok: true, values };
}

const enough = (s, minSample) => !!s && num(s.n) && s.n >= minSample && num(s.p50Ms);
const sampled = (j, minSample) => num(j.runs) && j.runs >= minSample && !!j.waiting && num(j.waiting.p50Ms) && !!j.running && num(j.running.p50Ms);
const totalMs = (j) => j.waiting.p50Ms + (j.setup && num(j.setup.p50Ms) ? j.setup.p50Ms : 0) + j.running.p50Ms;

// The one workflow job named `name`, or null when none or several carry it.
function uniqueByName(wfJobs, name) {
  const hits = wfJobs.filter((w) => w.name === name);
  return hits.length === 1 ? hits[0] : null;
}

// Whether `to` is reachable from `from` over `needs`.
function reaches(byId, from, to) {
  const seen = new Set();
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === to) return true;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    for (const need of Array.isArray(byId.get(id).needs) ? byId.get(id).needs : []) stack.push(need);
  }
  return false;
}

// The thresholds and floors evaluate applies: each override that is a finite number above 0, else
// the default.
function limitsOf(thresholds) {
  const limits = { ...DEFAULTS };
  if (thresholds && typeof thresholds === 'object') {
    for (const id of Object.keys(DEFAULTS)) if (own(thresholds, id) && num(thresholds[id]) && thresholds[id] > 0) limits[id] = thresholds[id];
  }
  return limits;
}

function evaluate(agg, factsByWorkflow, thresholds, minSample) {
  const a = agg && typeof agg === 'object' ? agg : {};
  const facts = factsByWorkflow && typeof factsByWorkflow === 'object' ? factsByWorkflow : {};
  const limits = limitsOf(thresholds);
  const floor = Number.isInteger(minSample) && minSample > 0 ? minSample : DEFAULT_MIN_SAMPLE;
  const list = (k) => (Array.isArray(a[k]) ? a[k].filter((x) => x && typeof x === 'object') : []);
  const jobs = list('jobs').filter((j) => typeof j.workflow === 'string' && typeof j.job === 'string');
  const eligible = jobs.filter((j) => sampled(j, floor));
  const eligibleIn = (wf) => eligible.filter((j) => j.workflow === wf);
  const jobsCache = new Map();
  const wfJobsOf = (wf) => {
    if (!jobsCache.has(wf)) jobsCache.set(wf, usableJobs(facts, wf));
    return jobsCache.get(wf);
  };
  const out = [];
  const breach = (check, workflow, job, metric, value, extra = {}) =>
    out.push({ check, workflow, job, ...extra, metric, value, threshold: own(limits, check) ? limits[check] : 0 });

  for (const j of eligible) {
    const total = totalMs(j);
    if (!(total > 0)) continue;
    const wait = j.waiting.p50Ms / total;
    if (wait > limits['queue-wait'] && j.waiting.p50Ms >= limits['queue-wait-floor-ms']) {
      breach('queue-wait', j.workflow, j.job, 'waitingShare', wait);
    }
    if (enough(j.setup, floor)) {
      const setup = j.setup.p50Ms / total;
      if (setup > limits['setup-dominance'] && j.setup.p50Ms >= limits['setup-dominance-floor-ms']) {
        breach('setup-dominance', j.workflow, j.job, 'setupShare', setup);
      }
    }
  }

  for (const cp of list('criticalPaths')) {
    if (typeof cp.workflow !== 'string' || !num(cp.pathMs) || !(cp.pathMs > 0) || !Array.isArray(cp.chain)) continue;
    if (cp.chain.length < 2) continue; // no job dominates a path of one
    if (cp.allJobsMatched !== true) continue; // an unmatched job may sit on the real path
    if (cp.pathMs < limits['critical-path-pole-floor-ms']) continue;
    const wfJobs = wfJobsOf(cp.workflow);
    if (wfJobs === null) continue;
    for (const name of cp.chain) {
      const named = uniqueByName(wfJobs, name);
      if (named === null) continue;
      let heaviest = null;
      for (const j of eligibleIn(cp.workflow)) {
        if (matchJob(j.job, wfJobs) !== named) continue;
        if (!j.total || !num(j.total.p50Ms)) continue; // total.n equals runs, already at minSample
        const t = j.total.p50Ms;
        if (heaviest === null || t > heaviest) heaviest = t;
      }
      if (heaviest === null) continue;
      const share = heaviest / cp.pathMs;
      if (share > limits['critical-path-pole']) breach('critical-path-pole', cp.workflow, name, 'criticalPathShare', share);
    }
  }

  for (const o of list('overlaps')) {
    if (typeof o.workflow !== 'string' || typeof o.a !== 'string' || typeof o.b !== 'string') continue;
    if (!num(o.sharedRuns) || o.sharedRuns < floor) continue; // a pair seen apart is no evidence
    const wfJobs = wfJobsOf(o.workflow);
    if (wfJobs === null) continue;
    const x = uniqueByName(wfJobs, o.a);
    const y = uniqueByName(wfJobs, o.b);
    if (x === null || y === null) continue;
    // A job reaches itself, so a pair naming one workflow job twice never fires.
    const byId = new Map(wfJobs.map((w) => [w.id, w]));
    if (reaches(byId, x.id, y.id) || reaches(byId, y.id, x.id)) continue;
    breach('serial-independent-jobs', o.workflow, `${o.a} + ${o.b}`, 'overlappingRuns', 0);
  }

  for (const s of list('shardSkews')) {
    if (typeof s.workflow !== 'string' || typeof s.family !== 'string' || !num(s.ratio) || !num(s.shards)) continue;
    const wfJobs = wfJobsOf(s.workflow);
    const shards = jobs.filter((j) => j.workflow === s.workflow && familyOf(j.job, wfJobs) === s.family);
    if (shards.length !== s.shards || !shards.every((j) => sampled(j, floor))) continue;
    if (s.ratio > limits['shard-skew']) breach('shard-skew', s.workflow, s.family, 'shardSkewRatio', s.ratio);
  }

  for (const r of list('repeatedSteps')) {
    if (typeof r.name !== 'string') continue;
    let holders = 0;
    for (const wf of Object.keys(facts)) {
      const wfJobs = wfJobsOf(wf);
      if (wfJobs === null) continue;
      for (const w of wfJobs) {
        if (!(Array.isArray(w.steps) && w.steps.some((st) => st && st.name === r.name))) continue;
        if (eligibleIn(wf).some((j) => matchJob(j.job, wfJobs) === w)) holders++;
      }
    }
    if (holders >= limits['repeated-work']) breach('repeated-work', null, null, 'jobsDeclaringStep', holders, { step: r.name });
  }

  const worst = new Map(); // `${workflow}\0${workflow job id}` -> { workflow, w, job, spread }
  for (const j of eligible) {
    const w = matchJob(j.job, wfJobsOf(j.workflow));
    if (w === null || w.timeoutDeclared !== false || !num(j.running.p90Ms) || !(j.running.p50Ms > 0)) continue;
    if (j.running.p90Ms < limits['missing-timeout-floor-ms']) continue;
    const spread = j.running.p90Ms / j.running.p50Ms;
    if (!(spread > limits['missing-timeout'])) continue;
    const k = `${j.workflow}\0${w.id}`;
    const prev = worst.get(k);
    if (!prev || spread > prev.spread || (spread === prev.spread && byText(j.job, prev.job) < 0)) {
      worst.set(k, { workflow: j.workflow, w, job: j.job, spread });
    }
  }
  for (const { workflow, w, job, spread } of worst.values()) {
    breach('missing-timeout', workflow, w.name, 'runningP90ToP50', spread, { worstJob: job });
  }

  for (const wf of Object.keys(facts)) {
    if (wfJobsOf(wf) === null || facts[wf].concurrencyDeclared !== false || eligibleIn(wf).length === 0) continue;
    breach('missing-concurrency', wf, null, 'concurrencyDeclared', 0);
  }

  const rank = (b) => CHECK_IDS.indexOf(b.check);
  const text = (v) => (v === null ? '' : v);
  return out.sort((m, n) => rank(m) - rank(n) || byText(text(m.workflow), text(n.workflow))
    || byText(text(m.job), text(n.job)) || byText(text(m.step || null), text(n.step || null)));
}

module.exports = { CHECK_IDS, DEFAULTS, FLOOR_IDS, DEFAULT_MIN_SAMPLE, parseThresholds, limitsOf, evaluate };
