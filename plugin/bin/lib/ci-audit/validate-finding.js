// plugin/bin/lib/ci-audit/validate-finding.js — the validating half of /claude-tweaks:ci-health's
// (#5757) gather / judge / validate split. The judge writes findings; every figure a finding cites
// must equal a figure the gather measured, so a fabricated or misread number never reaches an
// issue body. Pure: no spawns, no I/O, never throws.
//
// Finding = { check, workflow, job: string|null, step?: string|null, claim, remedy,
//             evidence: [{ job: string|null, metric, value }] }.
// validateFinding(finding, gather) -> { ok: true, errors: [], value } | { ok: false, errors: string[] }.
//
// Evidence metric vocabulary (METRICS), each resolved against one gather figure:
//  - job-row metrics `waiting.p50Ms` `waiting.p90Ms` `setup.p50Ms` `setup.p90Ms` `running.p50Ms`
//    `running.p90Ms` `total.p50Ms` `total.p90Ms` `runs`: the `jobs[]` row of the finding's
//    workflow whose `job` equals the evidence job (a run-data name, e.g. `unit (a)`); a null job is
//    rejected.
//  - `criticalPath.pathMs` `criticalPath.sumMs`: the workflow's `criticalPaths[]` entry; the
//    evidence job is null or one of its `chain` entries.
//  - `shardSkew.ratio`: the workflow's `shardSkews[]` entry whose `family` equals the evidence job.
//  - the breach metric of the finding's own check (METRICS.breach): the `breaches[]` entry with
//    that check, metric, workflow and job — for repeated-work, workflow and job null and `step`
//    equal to the finding's step. A breach metric of another check is rejected.
// Three outcomes per cited fact: resolved; unresolved (the job, workflow, step or metric is not in
// the gather) -> rejected naming it; resolved but contradicting (a cited value that is not exactly
// the gather's figure) -> rejected naming both values. A finding for a check with no breach in the
// gather is allowed (the judge may see a lead the mechanical pass missed) when every figure resolves.
//
// Other rules:
//  - `check` is one of checks.js's CHECK_IDS; `workflow` one of `workflows[].file`, except for
//    repeated-work, whose workflow must be null: the gather counts a repeated step across every
//    workflow (its breach has workflow null), so a named workflow would be the judge's free choice
//    and would mint a second fingerprint for the same step.
//  - `job`, when set, is a gathered name of that workflow: a `jobs[].job`, a critical-path `chain`
//    entry, a shard `family`, or the job of a breach of the finding's check there (the
//    serial-independent-jobs pair `a + b`). repeated-work names its `step` (a `repeatedSteps[].name`)
//    and has job null; no other check names a step.
//  - A gather with `noData` set rejects every finding: no run was sampled.
//  - A workflow whose gathered `unparsed` is non-empty is never judged, so a finding naming it is
//    rejected; a job-row metric cited for a row under `window.minSample` runs (a row the gather
//    lists in `underSampled`) is rejected too, so too few runs never back a finding.
//  - Free text: `claim` and `remedy` are required, at most 500 characters each (rejected, never
//    cut), and neither may carry credential-shaped text (findCredentialInText; the match is never
//    echoed). No checked string — claim, remedy, check, workflow, job, step, an evidence job — may carry a
//    control character or line break (C0, C1, U+2028, U+2029): every one is single-line text.
//  - Error text quotes every untrusted name through JSON.stringify, so a stderr line stays one line,
//    and withholds a name that looks like a credential (findCredentialInText) instead of echoing it.
'use strict';

const { CHECK_IDS } = require('./checks');
const { requireNonEmptyStrings } = require('../health-core/finding-validation');
const { findCredentialInText } = require('../wrap-up/packet-links');

const TEXT_CAP = 500;

const METRICS = Object.freeze({
  job: Object.freeze(['waiting.p50Ms', 'waiting.p90Ms', 'setup.p50Ms', 'setup.p90Ms', 'running.p50Ms', 'running.p90Ms',
    'total.p50Ms', 'total.p90Ms', 'runs']),
  criticalPath: Object.freeze(['criticalPath.pathMs', 'criticalPath.sumMs']),
  shardSkew: Object.freeze(['shardSkew.ratio']),
  breach: Object.freeze({
    'queue-wait': 'waitingShare',
    'setup-dominance': 'setupShare',
    'critical-path-pole': 'criticalPathShare',
    'serial-independent-jobs': 'overlappingRuns',
    'shard-skew': 'shardSkewRatio',
    'repeated-work': 'jobsDeclaringStep',
    'missing-timeout': 'runningP90ToP50',
    'missing-concurrency': 'concurrencyDeclared',
  }),
});

const BREACH_METRICS = new Set(Object.values(METRICS.breach));
// C0 and C1 controls, DEL, and the two Unicode line terminators.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\p{Zl}\p{Zp}]/u;

const own = (obj, key) => obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const q = (v) => (typeof v === 'string' && findCredentialInText(v) !== null
  ? '(a name that looks like a credential, withheld)' : JSON.stringify(v));
const list = (g, key) => (Array.isArray(g[key]) ? g[key].filter((x) => x && typeof x === 'object') : []);

// The figure a metric names, or { error } when it does not resolve.
function resolve(ev, f, g) {
  const { job, metric } = ev;
  const wf = f.workflow;
  if (METRICS.job.includes(metric)) {
    if (job === null) return { error: `${metric} needs a job` };
    const r = list(g, 'jobs').find((j) => j.workflow === wf && j.job === job);
    if (!r) return { error: `job ${q(job)} has no gathered row in workflow ${q(wf)}` };
    // A row under the gather's minimum sample is one no check judged: a figure over so few runs
    // is not evidence (the gather lists it in `underSampled`, never as clean).
    const min = g.window && g.window.minSample;
    if (num(min) && num(r.runs) && r.runs < min) {
      return { error: `job ${q(job)} is under-sampled in workflow ${q(wf)}: ${r.runs} runs, under the gather's minimum sample of ${min}` };
    }
    const [phase, stat] = metric.split('.');
    const value = stat === undefined ? r[phase] : (r[phase] && r[phase][stat]);
    if (!num(value)) return { error: `${metric} of job ${q(job)} has no gathered figure` };
    return { value, subject: `job ${q(job)}` };
  }
  if (METRICS.criticalPath.includes(metric)) {
    const cp = list(g, 'criticalPaths').find((c) => c.workflow === wf);
    if (!cp) return { error: `${metric}: workflow ${q(wf)} has no critical path` };
    if (job !== null && !(Array.isArray(cp.chain) && cp.chain.includes(job))) {
      return { error: `${metric}: job ${q(job)} is not on the critical path of workflow ${q(wf)}` };
    }
    const subject = job === null ? `workflow ${q(wf)}` : `job ${q(job)}`;
    const value = cp[metric.split('.')[1]];
    if (!num(value)) return { error: `${metric} of ${subject} has no gathered figure` };
    return { value, subject };
  }
  if (METRICS.shardSkew.includes(metric)) {
    const s = list(g, 'shardSkews').find((x) => x.workflow === wf && x.family === job);
    if (!s) return { error: `${metric}: ${q(job)} is not a shard family of workflow ${q(wf)}` };
    return { value: s.ratio, subject: `job ${q(job)}` };
  }
  if (BREACH_METRICS.has(metric)) {
    if (METRICS.breach[f.check] !== metric) return { error: `${metric} is not a metric of check ${f.check}` };
    if (f.check === 'repeated-work') {
      const b = list(g, 'breaches').find((x) => x.check === f.check && x.metric === metric && x.workflow === null && x.job === null && x.step === f.step);
      if (!b) return { error: `${metric}: the gather has no repeated-work breach for step ${q(f.step)}` };
      return { value: b.value, subject: `step ${q(f.step)}` };
    }
    const b = list(g, 'breaches').find((x) => x.check === f.check && x.metric === metric && x.workflow === wf && x.job === job);
    if (!b) {
      const where = job === null ? '' : ` for job ${q(job)}`;
      return { error: `${metric}: the gather has no ${f.check} breach${where} in workflow ${q(wf)}` };
    }
    return { value: b.value, subject: job === null ? `workflow ${q(wf)}` : `job ${q(job)}` };
  }
  return { error: `metric ${q(metric)} is not in the evidence vocabulary` };
}

// The names a finding's `job` may take in workflow `wf`.
function gatheredJobNames(g, wf, check) {
  const names = new Set();
  for (const j of list(g, 'jobs')) if (j.workflow === wf && typeof j.job === 'string') names.add(j.job);
  for (const c of list(g, 'criticalPaths')) if (c.workflow === wf && Array.isArray(c.chain)) for (const n of c.chain) names.add(n);
  for (const s of list(g, 'shardSkews')) if (s.workflow === wf && typeof s.family === 'string') names.add(s.family);
  for (const b of list(g, 'breaches')) if (b.check === check && b.workflow === wf && typeof b.job === 'string') names.add(b.job);
  return names;
}

function textErrors(f) {
  const errors = [];
  for (const field of ['claim', 'remedy']) {
    const v = f[field];
    if (typeof v !== 'string' || v.trim() === '') continue; // requireNonEmptyStrings names it
    if (v.length > TEXT_CAP) errors.push(`${field}: ${v.length} characters, over the ${TEXT_CAP}-character cap`);
    else if (CONTROL_RE.test(v)) errors.push(`${field}: contains a control character or line break`);
    else {
      const kind = findCredentialInText(v);
      if (kind !== null) errors.push(`${field}: carries credential-shaped text (${kind})`);
    }
  }
  for (const field of ['check', 'workflow', 'job', 'step']) {
    if (typeof f[field] === 'string' && CONTROL_RE.test(f[field])) errors.push(`${field}: contains a control character or line break`);
  }
  return errors;
}

function evidenceErrors(f, g) {
  if (!Array.isArray(f.evidence) || f.evidence.length === 0) return ['evidence: required non-empty array'];
  const errors = [];
  f.evidence.forEach((ev, i) => {
    const at = `evidence[${i}]`;
    if (!ev || typeof ev !== 'object' || !(ev.job === null || typeof ev.job === 'string')
      || typeof ev.metric !== 'string' || !num(ev.value)) {
      errors.push(`${at}: must be {job: string|null, metric: string, value: finite number}`);
      return;
    }
    if (typeof ev.job === 'string' && CONTROL_RE.test(ev.job)) {
      errors.push(`${at}: job contains a control character or line break`);
      return;
    }
    const r = resolve(ev, f, g);
    if (r.error) errors.push(`${at}: ${r.error}`);
    else if (r.value !== ev.value) {
      errors.push(`${at}: ${ev.metric} of ${r.subject} is ${ev.value} in the finding but ${r.value} in the gather`);
    }
  });
  return errors;
}

function validateFinding(finding, gather) {
  if (finding === null || typeof finding !== 'object' || Array.isArray(finding)) {
    return { ok: false, errors: ['finding: must be an object'] };
  }
  const g = gather !== null && typeof gather === 'object' ? gather : {};
  if (g.noData !== null && g.noData !== undefined) {
    return { ok: false, errors: ['the gather sampled no runs (noData), so no finding can be validated'] };
  }
  const f = finding;
  const workflowFree = f.check === 'repeated-work';
  const errors = requireNonEmptyStrings(f, workflowFree ? ['check', 'claim', 'remedy'] : ['check', 'workflow', 'claim', 'remedy']);
  errors.push(...textErrors(f));
  if (errors.length > 0) return { ok: false, errors };

  if (!CHECK_IDS.includes(f.check)) errors.push(`check: ${q(f.check)} is not one of ${CHECK_IDS.join('|')}`);
  if (workflowFree) {
    if (f.workflow !== null) errors.push('workflow: must be null for repeated-work (the step spans every workflow)');
  } else if (!list(g, 'workflows').some((w) => w.file === f.workflow)) {
    errors.push(`workflow: ${q(f.workflow)} is not a gathered workflow file`);
  } else if (list(g, 'workflows').some((w) => w.file === f.workflow && Array.isArray(w.unparsed) && w.unparsed.length > 0)) {
    // The gather never judges a workflow whose file it could not fully read (its breaches are dropped).
    errors.push(`workflow: ${q(f.workflow)} has unparsed workflow-file reasons in the gather, so it is never judged`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const step = own(f, 'step') ? f.step : null;
  if (f.check === 'repeated-work') {
    if (typeof step !== 'string' || step === '') errors.push('step: required for repeated-work');
    else if (!list(g, 'repeatedSteps').some((r) => r.name === step)) errors.push(`step: ${q(step)} is not a gathered repeated step`);
    if (f.job !== null) errors.push('job: must be null for repeated-work (the step is the subject)');
  } else {
    if (step !== null && step !== undefined) errors.push('step: only repeated-work names a step');
    if (!(f.job === null || typeof f.job === 'string')) errors.push('job: must be a string or null');
    else if (f.job !== null && !gatheredJobNames(g, f.workflow, f.check).has(f.job)) {
      errors.push(`job: ${q(f.job)} is not a gathered job of workflow ${q(f.workflow)}`);
    }
  }
  // Evidence resolves against the finding's own step and job, so a step or job that is itself
  // malformed stops here rather than adding misleading evidence errors. The two prefixes below are
  // coupled to the messages pushed in the repeated-work branch (`step: required for repeated-work`,
  // `job: must be null for repeated-work`) and in the else branch (`job: must be a string or null`):
  // change those texts and this match together. The other errors (an unknown step or job name)
  // still let the evidence resolve, so one rejection names every unresolved fact.
  if (errors.some((e) => e.startsWith('step: required') || e.startsWith('job: must'))) return { ok: false, errors };
  errors.push(...evidenceErrors({ ...f, step }, g));
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], value: { ...f, step } };
}

module.exports = { validateFinding, METRICS, TEXT_CAP };
