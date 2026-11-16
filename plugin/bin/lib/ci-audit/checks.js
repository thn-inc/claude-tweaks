// plugin/bin/lib/ci-audit/checks.js — the checklist table /claude-tweaks:ci-health (#5757) runs over
// the aggregate result: each check's id, its default threshold, and the mechanical breaches the
// measured figures cross. A breach is a lead for the skill's judge, never a finding, and carries no
// remedy wording (the skill's checklist owns that). Pure: no spawns, no I/O, never throws.
//
// Breach = { check, workflow, job, metric, value, threshold }. repeated-work's breach also carries
// `step` (the repeated step's name) and has workflow and job null, since the aggregate counts a
// step's holder jobs across every workflow.
//
// Thresholds:
//  - DEFAULTS holds the six numeric thresholds; only an id in DEFAULTS can be overridden.
//    serial-independent-jobs and missing-concurrency have no numeric threshold (their breach
//    reports threshold 0 against value 0): they are not overridable, and parseThresholds refuses
//    them (`missing-concurrency=1` is ok:false) like any unknown id.
//  - A ratio check fires when its value is strictly above the threshold — a value exactly at it
//    gives no breach. repeated-work is a count and fires at or above its threshold (3 jobs).
//
// Rules:
//  - A job's total is the sum of its phase p50s (waiting + setup + running; a missing setup
//    figure counts 0). queue-wait is waiting p50 ÷ total, setup-dominance setup p50 ÷ total.
//  - No check fires for a job below minSample runs (default 5; `runs` equals the waiting and
//    running n). setup-dominance also needs setup.n ≥ minSample, since setup can be missing on
//    some runs.
//  - A workflow whose facts carry any `unparsed` reason, or that has no facts, is skipped by every
//    check that reads facts: missing-timeout, missing-concurrency, serial-independent-jobs and
//    repeated-work. Its `concurrencyDeclared: false` may only mean its region was not read.
//  - A run job maps to a workflow job as the aggregate matches them: an exact, unique `name`, else
//    the part before one of its ` (` naming a single workflow job that declares a matrix.
//  - critical-path-pole: for each critical path, a chain job (a workflow job name) whose heaviest
//    shard total among its run jobs at minSample exceeds the threshold share of `pathMs`.
//  - serial-independent-jobs: an `overlaps` entry with everOverlapped false (a missing pair is no
//    evidence), both run jobs at minSample, mapped to two different workflow jobs with no `needs`
//    path in either direction. job is the two run job names joined by ' + '.
//  - shard-skew: a shardSkews entry whose ratio exceeds the threshold, every shard of the family
//    at minSample.
//  - repeated-work: a repeatedSteps entry counted over the holder jobs in parsed workflows that
//    declare the step and have a run job at minSample.
//  - missing-timeout: a run job at minSample mapped to a workflow job with timeoutDeclared false,
//    running p90 ÷ p50 above the threshold.
//  - missing-concurrency: a parsed workflow with concurrencyDeclared false and a run job at
//    minSample.
'use strict';

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
};

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

// The facts' jobs when the workflow is parsed, else null.
function parsedJobs(factsByWorkflow, workflow) {
  if (!own(factsByWorkflow, workflow)) return null;
  const facts = factsByWorkflow[workflow];
  if (!facts || !Array.isArray(facts.jobs) || !Array.isArray(facts.unparsed) || facts.unparsed.length > 0) return null;
  return facts.jobs.filter((j) => j && typeof j.id === 'string' && typeof j.name === 'string');
}

// The workflow job a run job's name maps to, or null.
function workflowJobOf(name, wfJobs) {
  if (wfJobs === null || typeof name !== 'string') return null;
  const exact = wfJobs.filter((j) => j.name === name);
  if (exact.length > 0) return exact.length === 1 ? exact[0] : null;
  if (!name.endsWith(')')) return null;
  for (let i = name.lastIndexOf(' ('); i > 0; i = name.lastIndexOf(' (', i - 1)) {
    const base = name.slice(0, i);
    if (wfJobs.some((j) => j.name === base)) {
      const hits = wfJobs.filter((j) => j.name === base && j.matrix === true);
      return hits.length === 1 ? hits[0] : null;
    }
  }
  return null;
}

const enough = (s, minSample) => !!s && num(s.n) && s.n >= minSample && num(s.p50Ms);
const sampled = (j, minSample) => num(j.runs) && j.runs >= minSample && !!j.waiting && num(j.waiting.p50Ms) && !!j.running && num(j.running.p50Ms);
const totalMs = (j) => j.waiting.p50Ms + (j.setup && num(j.setup.p50Ms) ? j.setup.p50Ms : 0) + j.running.p50Ms;

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

function evaluate(agg, factsByWorkflow, thresholds, minSample) {
  const a = agg && typeof agg === 'object' ? agg : {};
  const facts = factsByWorkflow && typeof factsByWorkflow === 'object' ? factsByWorkflow : {};
  const limits = { ...DEFAULTS };
  if (thresholds && typeof thresholds === 'object') {
    for (const id of Object.keys(DEFAULTS)) if (own(thresholds, id) && num(thresholds[id])) limits[id] = thresholds[id];
  }
  const floor = num(minSample) ? minSample : DEFAULT_MIN_SAMPLE;
  const list = (k) => (Array.isArray(a[k]) ? a[k].filter((x) => x && typeof x === 'object') : []);
  const jobs = list('jobs').filter((j) => typeof j.workflow === 'string' && typeof j.job === 'string');
  const eligible = jobs.filter((j) => sampled(j, floor));
  const eligibleIn = (wf) => eligible.filter((j) => j.workflow === wf);
  const findEligible = (wf, name) => eligible.find((j) => j.workflow === wf && j.job === name);
  const jobsCache = new Map();
  const wfJobsOf = (wf) => {
    if (!jobsCache.has(wf)) jobsCache.set(wf, parsedJobs(facts, wf));
    return jobsCache.get(wf);
  };
  const out = [];
  const breach = (check, workflow, job, metric, value, extra = {}) =>
    out.push({ check, workflow, job, ...extra, metric, value, threshold: own(limits, check) ? limits[check] : 0 });

  for (const j of eligible) {
    const total = totalMs(j);
    if (!(total > 0)) continue;
    const wait = j.waiting.p50Ms / total;
    if (wait > limits['queue-wait']) breach('queue-wait', j.workflow, j.job, 'waitingShare', wait);
    if (enough(j.setup, floor)) {
      const setup = j.setup.p50Ms / total;
      if (setup > limits['setup-dominance']) breach('setup-dominance', j.workflow, j.job, 'setupShare', setup);
    }
  }

  for (const cp of list('criticalPaths')) {
    if (typeof cp.workflow !== 'string' || !num(cp.pathMs) || !(cp.pathMs > 0) || !Array.isArray(cp.chain)) continue;
    const wfJobs = wfJobsOf(cp.workflow);
    if (wfJobs === null) continue;
    for (const name of cp.chain) {
      const named = wfJobs.filter((w) => w.name === name);
      if (named.length !== 1) continue;
      let heaviest = null;
      for (const j of eligibleIn(cp.workflow)) {
        if (workflowJobOf(j.job, wfJobs) !== named[0]) continue;
        const t = totalMs(j);
        if (heaviest === null || t > heaviest) heaviest = t;
      }
      if (heaviest === null) continue;
      const share = heaviest / cp.pathMs;
      if (share > limits['critical-path-pole']) breach('critical-path-pole', cp.workflow, name, 'criticalPathShare', share);
    }
  }

  for (const o of list('overlaps')) {
    if (o.everOverlapped !== false || typeof o.workflow !== 'string') continue;
    const wfJobs = wfJobsOf(o.workflow);
    if (wfJobs === null || !findEligible(o.workflow, o.a) || !findEligible(o.workflow, o.b)) continue;
    const x = workflowJobOf(o.a, wfJobs);
    const y = workflowJobOf(o.b, wfJobs);
    if (x === null || y === null) continue;
    // A job reaches itself, so two shards of one workflow job never fire.
    const byId = new Map(wfJobs.map((w) => [w.id, w]));
    if (reaches(byId, x.id, y.id) || reaches(byId, y.id, x.id)) continue;
    breach('serial-independent-jobs', o.workflow, `${o.a} + ${o.b}`, 'overlappingRuns', 0);
  }

  for (const s of list('shardSkews')) {
    if (typeof s.workflow !== 'string' || typeof s.family !== 'string' || !num(s.ratio) || !num(s.shards)) continue;
    const shards = jobs.filter((j) => j.workflow === s.workflow && j.job.startsWith(`${s.family} (`) && j.job.endsWith(')'));
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
        if (eligibleIn(wf).some((j) => workflowJobOf(j.job, wfJobs) === w)) holders++;
      }
    }
    if (holders >= limits['repeated-work']) breach('repeated-work', null, null, 'jobsDeclaringStep', holders, { step: r.name });
  }

  for (const j of eligible) {
    const wfJobs = wfJobsOf(j.workflow);
    const w = workflowJobOf(j.job, wfJobs);
    if (w === null || w.timeoutDeclared !== false || !num(j.running.p90Ms) || !(j.running.p50Ms > 0)) continue;
    const spread = j.running.p90Ms / j.running.p50Ms;
    if (spread > limits['missing-timeout']) breach('missing-timeout', j.workflow, j.job, 'runningP90ToP50', spread);
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

module.exports = { CHECK_IDS, DEFAULTS, parseThresholds, evaluate };
