// plugin/bin/lib/ci-audit/aggregate.js — the measured figures /claude-tweaks:ci-health (#5757)
// computes across recent runs: per-job phase percentiles, each workflow's critical path over
// `needs`, matrix shard skew, step names declared in several jobs, which workflow-job pairs never
// ran at the same time, and the run jobs no workflow job matched. Pure: no spawns, no I/O, no
// knowledge of which service the runs came from or how they were fetched. It does read the
// workflow-file naming and expression syntax: the `${{ … }}` delimiters of a declared job name and
// the matrix-shard rendering `name (value)` of a run job's name (matchJob, familyOf). It takes
// normalized runs — { id, workflow, conclusion,
// createdAt, jobs: NormJob[] } — the workflow facts readWorkflowFacts gives, keyed by the same
// `workflow` string the runs carry, and { minSample } (default 1), the shared-run floor an
// `overlaps` pair needs. matchJob, familyOf and usableJobs are exported so the checks map run jobs
// to workflow jobs by these same rules.
//
// Rules:
//  - A run job whose conclusion is `skipped` did no work, and a `cancelled` one stopped part-way:
//    neither contributes to any figure (percentiles, paths, skew, overlaps, unmatchedJobs); each
//    is counted in `notTimed` ({ skipped, cancelled }). Any other conclusion counts.
//  - A run job matches a workflow job by exact `name`; else, when the run job's name ends in `)`,
//    by a part before one of its ` (` to a workflow job that declares a matrix; else by a workflow
//    job whose name holds a `${{ … }}` expression and matches as a template (phases.nameMatches).
//    A name two workflow jobs share, or that two templates match, matches neither. A workflow
//    whose facts carry any `unparsed` reason has no trustworthy jobs: its run jobs match nothing
//    (no step kinds, so setup is null), and it gives no critical path, no overlaps and no
//    repeated steps.
//  - unmatchedJobs lists { workflow, job } for each run-job name of a workflow with trustworthy
//    facts that matched no workflow job: none of its figures reach a workflow-file check.
//  - A job with no phases (splitJobPhases returns null: a missing, backwards or unparseable
//    instant) counts once in `excluded` and contributes to no figure, overlap included.
//  - A job's total per run is waiting + setup + running (its row's `total` gives their
//    percentiles); the critical path weighs each workflow job by its p50 total — a matrix job by
//    its slowest shard — and is the heaviest chain over `needs`. A cycle in `needs` leaves the
//    workflow out; a need naming no job is ignored. `sumMs` adds every weighed job of the
//    workflow. `allJobsMatched` is false when the workflow has unmatchedJobs: a job missing from
//    the weights may sit on the real path, so `pathMs` may be short of it. pathMs assumes a
//    job's createdAt is when it became runnable (the source adapter pins that).
//  - Shard skew: a family is the matrix workflow job its run jobs match (named by the workflow
//    job's name), or, for a workflow with no trustworthy facts, the run-job name's part before its
//    first ` (`; two or more shards in one workflow give ratio = slowest shard's p50 total ÷ the
//    p50 of the shards' p50 totals.
//  - `overlaps` holds one entry { workflow, a, b, sharedRuns } per pair of two different matched
//    workflow jobs (named by their workflow job names, a before b) that both ran in at least
//    minSample runs and whose started-to-completed intervals never intersected in any of them
//    (touching ends do not intersect). Pairs that did overlap are not listed.
'use strict';

const { percentile, splitJobPhases, instant, nameMatches } = require('./phases');

const SLOWEST_STEPS = 3;
const NOT_TIMED = ['skipped', 'cancelled'];

const own = (obj, key) => obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

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
  if (name.endsWith(')')) {
    for (let i = name.lastIndexOf(' ('); i > 0; i = name.lastIndexOf(' (', i - 1)) {
      const base = name.slice(0, i);
      if (wfJobs.some((j) => j.name === base)) return one((j) => j.name === base && j.matrix === true);
    }
  }
  return one((j) => j.name.includes('${{') && nameMatches(j.name, name));
}

// The shard family a run job belongs to, or null.
function familyOf(name, wfJobs) {
  if (typeof name !== 'string') return null;
  if (wfJobs === null) {
    const cut = name.indexOf(' (');
    return cut > 0 && name.endsWith(')') ? name.slice(0, cut) : null;
  }
  const w = matchJob(name, wfJobs);
  return w !== null && w.matrix === true ? w.name : null;
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

// Heaviest chain over `needs`, or null on a cycle or when no job is weighed. A job with no weight
// (never run, or unmatched) is bridged over: its needs' best chain passes through it unchanged, so
// the chain lists weighed jobs only and a path may skip an unweighed link. The final tie clause
// (`top.chain.length === 0 && r.chain.length > 0`) lets a chain whose weighed jobs total 0 ms beat
// the empty initial `top`, so an all-zero workflow still yields a path rather than null.
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

function aggregate(runs, factsByWorkflow, opts = {}) {
  const list = Array.isArray(runs) ? runs : [];
  const facts = factsByWorkflow && typeof factsByWorkflow === 'object' ? factsByWorkflow : {};
  const minShared = opts && Number.isInteger(opts.minSample) && opts.minSample > 0 ? opts.minSample : 1;
  let excluded = 0;
  const notTimed = { skipped: 0, cancelled: 0 };
  const acc = new Map(); // `${workflow}\0${job}` -> per-job accumulator
  const pairs = new Map(); // workflow -> Map(`${xId}\0${yId}` -> { x, y, shared, overlapped })
  const unmatched = new Map(); // workflow -> Set of run-job names
  const jobsCache = new Map();
  const wfJobsOf = (wf) => {
    if (!jobsCache.has(wf)) jobsCache.set(wf, usableJobs(facts, wf));
    return jobsCache.get(wf);
  };

  for (const r of list) {
    if (!r || typeof r.workflow !== 'string' || !Array.isArray(r.jobs)) continue;
    const wf = r.workflow;
    const wfJobs = wfJobsOf(wf);
    const ranById = new Map(); // matched workflow job id -> { w, intervals }
    for (const j of r.jobs) {
      if (j && NOT_TIMED.includes(j.conclusion)) { notTimed[j.conclusion]++; continue; }
      if (!j || typeof j.name !== 'string') { excluded++; continue; }
      const matched = matchJob(j.name, wfJobs);
      const phases = splitJobPhases(j, matched ? matched.steps : null);
      if (phases === null) { excluded++; continue; }
      if (wfJobs !== null && matched === null) {
        if (!unmatched.has(wf)) unmatched.set(wf, new Set());
        unmatched.get(wf).add(j.name);
      }
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
      if (matched !== null) {
        if (!ranById.has(matched.id)) ranById.set(matched.id, { w: matched, intervals: [] });
        ranById.get(matched.id).intervals.push([instant(j.startedAt), instant(j.completedAt)]);
      }
    }
    if (!pairs.has(wf)) pairs.set(wf, new Map());
    const wfPairs = pairs.get(wf);
    const ran = [...ranById.values()].sort((m, n) => byText(m.w.id, n.w.id));
    for (let x = 0; x < ran.length; x++) {
      for (let y = x + 1; y < ran.length; y++) {
        const k = `${ran[x].w.id}\0${ran[y].w.id}`;
        if (!wfPairs.has(k)) wfPairs.set(k, { x: ran[x].w, y: ran[y].w, shared: 0, overlapped: false });
        const p = wfPairs.get(k);
        p.shared++;
        for (const [ps, pe] of ran[x].intervals) {
          for (const [qs, qe] of ran[y].intervals) if (ps < qe && qs < pe) p.overlapped = true;
        }
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
      if (cp !== null) criticalPaths.push({ workflow: wf, ...cp, allJobsMatched: !unmatched.has(wf) });
    }
    const families = new Map();
    for (const a of mine) {
      const family = familyOf(a.job, wfJobs);
      if (family === null) continue;
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

  const declared = new Map(); // step name -> Map of `${workflow}\0${job id}` -> the job's name
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
    if (wfJobsOf(wf) === null) continue;
    for (const p of pairs.get(wf).values()) {
      if (p.overlapped || p.shared < minShared) continue;
      const [a, b] = [p.x.name, p.y.name].sort(byText);
      overlaps.push({ workflow: wf, a, b, sharedRuns: p.shared });
    }
  }
  overlaps.sort((m, n) => byText(m.workflow, n.workflow) || byText(m.a, n.a) || byText(m.b, n.b));

  const unmatchedJobs = [];
  for (const wf of [...unmatched.keys()].sort(byText)) {
    for (const job of [...unmatched.get(wf)].sort(byText)) unmatchedJobs.push({ workflow: wf, job });
  }

  return { jobs, excluded, notTimed, criticalPaths, shardSkews, repeatedSteps, overlaps, unmatchedJobs };
}

module.exports = { aggregate, matchJob, familyOf, usableJobs };
