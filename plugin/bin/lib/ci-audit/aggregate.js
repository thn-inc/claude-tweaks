// plugin/bin/lib/ci-audit/aggregate.js — the measured figures /claude-tweaks:ci-health (#5757)
// computes across recent runs: per-job phase percentiles, each workflow's critical path over
// `needs`, matrix shard skew, step names declared in several jobs, and which job pairs ever ran
// at the same time. Pure: no spawns, no I/O, no knowledge of where the runs came from. It takes
// normalized runs — { id, workflow, conclusion, createdAt, jobs: NormJob[] } — and the workflow
// facts readWorkflowFacts gives, keyed by the same `workflow` string the runs carry. matchJob and
// usableJobs are exported so the checks map run jobs to workflow jobs by this same rule.
//
// Rules:
//  - A run job matches a workflow job by exact `name`, else, when the run job's name ends in
//    `)`, by a part before one of its ` (` to a workflow job that declares a matrix. A name two
//    workflow jobs share matches neither. A workflow whose facts carry any `unparsed` reason has
//    no trustworthy jobs: its run jobs match nothing (no step kinds, so setup is null), and it
//    gives no critical path and no repeated steps.
//  - A job with no phases (splitJobPhases returns null: a missing, backwards or unparseable
//    instant) counts once in `excluded` and contributes to no figure, overlap included.
//  - A job's total per run is waiting + setup + running (its row's `total` gives their
//    percentiles); the critical path weighs each workflow
//    job by its p50 total — a matrix job by its slowest shard — and is the heaviest chain over
//    `needs`. A cycle in `needs` leaves the workflow out; a need naming no job is ignored.
//    `sumMs` adds every weighed job of the workflow.
//  - Shard skew is run data only: run jobs named `family (…)` (the part before the first ` (`)
//    with two or more shards in one workflow give ratio = slowest shard's p50 total ÷ the p50 of
//    the shards' p50 totals.
//  - `overlaps` holds one entry per pair of run jobs of a workflow seen in the same run at least
//    once; `everOverlapped` is true when some run shows their started-to-completed intervals
//    intersecting (touching ends do not intersect).
'use strict';

const { percentile, splitJobPhases } = require('./phases');

const SLOWEST_STEPS = 3;

const own = (obj, key) => obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function instant(value) {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

const stat = (values) => ({ p50Ms: percentile(values, 50), p90Ms: percentile(values, 90), n: values.length });

// The facts' jobs when they are trustworthy, else null.
function usableJobs(factsByWorkflow, workflow) {
  if (!own(factsByWorkflow, workflow)) return null;
  const facts = factsByWorkflow[workflow];
  if (!facts || !Array.isArray(facts.jobs) || !Array.isArray(facts.unparsed) || facts.unparsed.length > 0) return null;
  return facts.jobs.filter((j) => j && typeof j.id === 'string' && typeof j.name === 'string');
}

// The workflow job a run job's name maps to, or null.
function matchJob(name, wfJobs) {
  if (wfJobs === null || typeof name !== 'string') return null;
  const one = (pred) => {
    const hits = wfJobs.filter(pred);
    return hits.length === 1 ? hits[0] : null;
  };
  const exact = wfJobs.filter((j) => j.name === name);
  if (exact.length > 0) return exact.length === 1 ? exact[0] : null;
  if (!name.endsWith(')')) return null;
  for (let i = name.lastIndexOf(' ('); i > 0; i = name.lastIndexOf(' (', i - 1)) {
    const base = name.slice(0, i);
    if (wfJobs.some((j) => j.name === base)) return one((j) => j.name === base && j.matrix === true);
  }
  return null;
}

function stepDurations(steps, into) {
  if (!Array.isArray(steps)) return;
  for (const s of steps) {
    if (!s || typeof s.name !== 'string') continue;
    const start = instant(s.startedAt);
    const end = instant(s.completedAt);
    if (start === null || end === null || end < start) continue;
    if (!into.has(s.name)) into.set(s.name, []);
    into.get(s.name).push(end - start);
  }
}

// Heaviest chain over `needs`, or null on a cycle or when no job is weighed.
function criticalPath(wfJobs, weightById) {
  const byId = new Map(wfJobs.map((j) => [j.id, j]));
  const memo = new Map();
  const visiting = new Set();
  let cycle = false;
  const longest = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) { cycle = true; return { ms: 0, chain: [] }; }
    visiting.add(id);
    let best = { ms: 0, chain: [] };
    for (const need of byId.get(id).needs || []) {
      if (!byId.has(need)) continue;
      const r = longest(need);
      if (r.ms > best.ms) best = r;
    }
    visiting.delete(id);
    const w = weightById.get(id);
    const out = w === undefined ? best : { ms: best.ms + w, chain: [...best.chain, byId.get(id).name] };
    memo.set(id, out);
    return out;
  };
  let top = { ms: 0, chain: [] };
  for (const j of wfJobs) {
    const r = longest(j.id);
    if (r.ms > top.ms || (top.chain.length === 0 && r.chain.length > 0)) top = r;
  }
  if (cycle || top.chain.length === 0) return null;
  let sumMs = 0;
  for (const w of weightById.values()) sumMs += w;
  return { pathMs: top.ms, sumMs, chain: top.chain };
}

function aggregate(runs, factsByWorkflow) {
  const list = Array.isArray(runs) ? runs : [];
  const facts = factsByWorkflow && typeof factsByWorkflow === 'object' ? factsByWorkflow : {};
  let excluded = 0;
  const acc = new Map(); // `${workflow}\0${job}` -> per-job accumulator
  const pairs = new Map(); // workflow -> Map(`${a}\0${b}` -> everOverlapped)
  const jobsCache = new Map();
  const wfJobsOf = (wf) => {
    if (!jobsCache.has(wf)) jobsCache.set(wf, usableJobs(facts, wf));
    return jobsCache.get(wf);
  };

  for (const r of list) {
    if (!r || typeof r.workflow !== 'string' || !Array.isArray(r.jobs)) continue;
    const wf = r.workflow;
    const wfJobs = wfJobsOf(wf);
    const intervals = [];
    for (const j of r.jobs) {
      if (!j || typeof j.name !== 'string') { excluded++; continue; }
      const matched = matchJob(j.name, wfJobs);
      const phases = splitJobPhases(j, matched ? matched.steps : null);
      if (phases === null) { excluded++; continue; }
      const key = `${wf}\0${j.name}`;
      if (!acc.has(key)) {
        acc.set(key, { workflow: wf, job: j.name, matched, waiting: [], setup: [], running: [], totals: [], steps: new Map() });
      }
      const a = acc.get(key);
      a.waiting.push(phases.waitingMs);
      if (phases.setupMs !== null) a.setup.push(phases.setupMs);
      a.running.push(phases.runningMs);
      a.totals.push(phases.waitingMs + (phases.setupMs || 0) + phases.runningMs);
      stepDurations(j.steps, a.steps);
      intervals.push({ name: j.name, start: instant(j.startedAt), end: instant(j.completedAt) });
    }
    if (!pairs.has(wf)) pairs.set(wf, new Map());
    const wfPairs = pairs.get(wf);
    for (let x = 0; x < intervals.length; x++) {
      for (let y = x + 1; y < intervals.length; y++) {
        const [p, q] = [intervals[x], intervals[y]].sort((m, n) => byText(m.name, n.name));
        if (p.name === q.name) continue;
        const k = `${p.name}\0${q.name}`;
        const hit = p.start < q.end && q.start < p.end;
        wfPairs.set(k, wfPairs.get(k) === true || hit);
      }
    }
  }

  const accs = [...acc.values()].sort((m, n) => byText(m.workflow, n.workflow) || byText(m.job, n.job));
  const jobs = accs.map((a) => ({
    workflow: a.workflow,
    job: a.job,
    runs: a.totals.length,
    waiting: stat(a.waiting),
    setup: stat(a.setup),
    running: stat(a.running),
    total: stat(a.totals),
    slowestSteps: [...a.steps.entries()]
      .map(([name, ds]) => ({ name, p50Ms: percentile(ds, 50), n: ds.length }))
      .sort((m, n) => n.p50Ms - m.p50Ms || byText(m.name, n.name))
      .slice(0, SLOWEST_STEPS),
  }));

  const workflows = [...new Set(accs.map((a) => a.workflow))];
  const criticalPaths = [];
  const shardSkews = [];
  for (const wf of workflows) {
    const mine = accs.filter((a) => a.workflow === wf);
    const wfJobs = wfJobsOf(wf);
    if (wfJobs !== null) {
      const weightById = new Map();
      for (const a of mine) {
        if (a.matched === null) continue;
        const w = percentile(a.totals, 50);
        const prev = weightById.get(a.matched.id);
        if (prev === undefined || w > prev) weightById.set(a.matched.id, w);
      }
      const cp = criticalPath(wfJobs, weightById);
      if (cp !== null) criticalPaths.push({ workflow: wf, ...cp });
    }
    const families = new Map();
    for (const a of mine) {
      const cut = a.job.indexOf(' (');
      if (cut <= 0 || !a.job.endsWith(')')) continue;
      const family = a.job.slice(0, cut);
      if (!families.has(family)) families.set(family, []);
      families.get(family).push({ name: a.job, ms: percentile(a.totals, 50) });
    }
    for (const [family, shards] of [...families.entries()].sort((m, n) => byText(m[0], n[0]))) {
      if (shards.length < 2) continue;
      const mid = percentile(shards.map((s) => s.ms), 50);
      if (!(mid > 0)) continue;
      const slowest = shards.reduce((m, s) => (s.ms > m.ms || (s.ms === m.ms && byText(s.name, m.name) < 0) ? s : m));
      shardSkews.push({ workflow: wf, family, ratio: slowest.ms / mid, slowest: slowest.name, shards: shards.length });
    }
  }

  const declared = new Map(); // step name -> Set of `${workflow}\0${job id}` with the job's name
  for (const wf of Object.keys(facts).sort(byText)) {
    const wfJobs = wfJobsOf(wf);
    if (wfJobs === null) continue;
    for (const j of wfJobs) {
      for (const s of Array.isArray(j.steps) ? j.steps : []) {
        if (!s || typeof s.name !== 'string') continue;
        if (!declared.has(s.name)) declared.set(s.name, new Map());
        declared.get(s.name).set(`${wf}\0${j.id}`, j.name);
      }
    }
  }
  const repeatedSteps = [...declared.entries()]
    .filter(([, holders]) => holders.size >= 2)
    .map(([name, holders]) => ({ name, jobs: [...holders.values()].sort(byText) }))
    .sort((m, n) => n.jobs.length - m.jobs.length || byText(m.name, n.name));

  const overlaps = [];
  for (const wf of [...pairs.keys()].sort(byText)) {
    for (const [k, everOverlapped] of [...pairs.get(wf).entries()].sort((m, n) => byText(m[0], n[0]))) {
      const [a, b] = k.split('\0');
      overlaps.push({ workflow: wf, a, b, everOverlapped });
    }
  }

  return { jobs, excluded, criticalPaths, shardSkews, repeatedSteps, overlaps };
}

module.exports = { aggregate, matchJob, usableJobs };
