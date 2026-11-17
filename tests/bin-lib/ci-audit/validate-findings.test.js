'use strict';
// tests/bin-lib/ci-audit/validate-findings.test.js — #5757: ci-audit's finding validator, its
// fingerprint, its issue payload and the `validate-findings` verb. Every input is a hand-built
// gather report in the real gather shape; files the verb reads are real temp files read through an
// injected readFile, and every output is captured by an injected stdout/stderr.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const { run } = require('../../../plugin/bin/ci-audit');
const { validateFinding, METRICS } = require('../../../plugin/bin/lib/ci-audit/validate-finding');
const { fingerprint } = require('../../../plugin/bin/lib/ci-audit/fingerprint');
const { toIssuePayload, RELEASE_NOTE } = require('../../../plugin/bin/lib/ci-audit/issue-payload');
const { extractSection, extractFingerprint } = require('../../../plugin/bin/lib/issues/record');

const COMPOSE = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'compose-record.js');
const CI = 'wf/ci.yml';

const stat = (p50Ms, p90Ms, n) => ({ p50Ms, p90Ms, n });
const row = (job, waiting, setup, running, total) => ({
  workflow: CI, job, runs: 12, waiting: stat(...waiting, 12), setup: stat(...setup, 12),
  running: stat(...running, 12), total: stat(...total, 12), slowestSteps: [],
});

// lint: waiting 9000 of a 15000 total, so the waiting share is 0.6. The critical path is
// lint (15000) then unit (its slowest shard, 60000): pathMs 75000, unit's share 0.8.
function gather(over = {}) {
  return {
    definitions: { waiting: 'w', setup: 's', running: 'r' },
    window: { days: 30, from: '2026-10-17', maxRuns: 20, workflow: null, minSample: 5, thresholds: {}, sampledRuns: 12 },
    workflows: [{ file: CI, unparsed: [] }, { file: 'wf/nightly.yml', unparsed: [] }],
    jobs: [
      row('lint', [9000, 12000], [2000, 3000], [4000, 5000], [15000, 20000]),
      row('unit (a)', [1000, 2000], [3000, 4000], [56000, 70000], [60000, 76000]),
      row('unit (b)', [1000, 2000], [3000, 4000], [16000, 20000], [20000, 26000]),
    ],
    criticalPaths: [{ workflow: CI, pathMs: 75000, sumMs: 95000, chain: ['lint', 'unit'], allJobsMatched: true }],
    shardSkews: [{ workflow: CI, family: 'unit', ratio: 1.5, slowest: 'unit (a)', shards: 2 }],
    repeatedSteps: [{ name: 'Install deps', jobs: ['e2e', 'lint', 'unit'] }],
    overlaps: [],
    breaches: [
      { check: 'queue-wait', workflow: CI, job: 'lint', metric: 'waitingShare', value: 0.6, threshold: 0.4 },
      { check: 'critical-path-pole', workflow: CI, job: 'unit', metric: 'criticalPathShare', value: 0.8, threshold: 0.5 },
      { check: 'repeated-work', workflow: null, job: null, step: 'Install deps', metric: 'jobsDeclaringStep', value: 3, threshold: 3 },
    ],
    underSampled: [],
    unmatchedJobs: [],
    droppedBreaches: 0,
    excluded: 0,
    notTimed: { skipped: 0, cancelled: 0 },
    truncated: [],
    failures: [],
    unsampled: { skipped: 0, neverRun: 0 },
    noData: null,
    ...over,
  };
}

function finding(over = {}) {
  return {
    check: 'queue-wait',
    workflow: CI,
    job: 'lint',
    claim: 'lint waits longer for a runner than it takes to run.',
    remedy: 'Give lint a less contended runner pool, or fold it into a job that already holds one.',
    evidence: [
      { job: 'lint', metric: 'waiting.p50Ms', value: 9000 },
      { job: 'lint', metric: 'waitingShare', value: 0.6 },
    ],
    ...over,
  };
}

const errorsOf = (f, g = gather()) => {
  const v = validateFinding(f, g);
  assert.equal(v.ok, false, 'expected a rejection');
  return v.errors;
};
const accepted = (f, g = gather()) => {
  const v = validateFinding(f, g);
  assert.deepEqual(v.errors, []);
  assert.equal(v.ok, true);
};

// ---- validateFinding ----------------------------------------------------------------------

test('METRICS is the pinned evidence vocabulary', () => {
  assert.deepEqual(METRICS, {
    job: ['waiting.p50Ms', 'waiting.p90Ms', 'setup.p50Ms', 'setup.p90Ms', 'running.p50Ms', 'running.p90Ms',
      'total.p50Ms', 'total.p90Ms', 'runs'],
    criticalPath: ['criticalPath.pathMs', 'criticalPath.sumMs'],
    shardSkew: ['shardSkew.ratio'],
    breach: {
      'queue-wait': 'waitingShare',
      'setup-dominance': 'setupShare',
      'critical-path-pole': 'criticalPathShare',
      'serial-independent-jobs': 'overlappingRuns',
      'shard-skew': 'shardSkewRatio',
      'repeated-work': 'jobsDeclaringStep',
      'missing-timeout': 'runningP90ToP50',
      'missing-concurrency': 'concurrencyDeclared',
    },
  });
});

test('AC3.1: a finding citing a job absent from the gather is rejected naming it; corrected it is accepted; a value off by one is rejected naming both values', () => {
  assert.deepEqual(errorsOf(finding({ job: 'lnit' })), ['job: "lnit" is not a gathered job of workflow "wf/ci.yml"']);
  accepted(finding());
  assert.deepEqual(errorsOf(finding({ evidence: [{ job: 'lint', metric: 'waiting.p50Ms', value: 9001 }] })),
    ['evidence[0]: waiting.p50Ms of job "lint" is 9001 in the finding but 9000 in the gather']);
});

test('an evidence job absent from the workflow is unresolved, named', () => {
  assert.deepEqual(errorsOf(finding({ evidence: [{ job: 'unit (c)', metric: 'running.p90Ms', value: 1 }] })),
    ['evidence[0]: job "unit (c)" has no gathered row in workflow "wf/ci.yml"']);
});

test('a job-row metric with a null job is rejected', () => {
  assert.deepEqual(errorsOf(finding({ evidence: [{ job: null, metric: 'runs', value: 12 }] })),
    ['evidence[0]: runs needs a job']);
});

test('every job-row metric resolves to its own figure', () => {
  const ev = [
    ['waiting.p90Ms', 12000], ['setup.p50Ms', 2000], ['setup.p90Ms', 3000], ['running.p50Ms', 4000],
    ['running.p90Ms', 5000], ['total.p50Ms', 15000], ['total.p90Ms', 20000], ['runs', 12],
  ].map(([metric, value]) => ({ job: 'lint', metric, value }));
  accepted(finding({ evidence: ev }));
});

test('a finding citing a critical-path chain entry resolves, with the breach-only metric and the path figures', () => {
  accepted(finding({
    check: 'critical-path-pole', job: 'unit',
    evidence: [
      { job: 'unit', metric: 'criticalPathShare', value: 0.8 },
      { job: null, metric: 'criticalPath.pathMs', value: 75000 },
      { job: 'unit', metric: 'criticalPath.sumMs', value: 95000 },
      { job: 'unit (a)', metric: 'total.p50Ms', value: 60000 },
    ],
  }));
});

test('a critical-path figure cited for a job off the chain is unresolved', () => {
  assert.deepEqual(errorsOf(finding({ check: 'critical-path-pole', job: 'unit', evidence: [{ job: 'unit (a)', metric: 'criticalPath.pathMs', value: 75000 }] })),
    ['evidence[0]: criticalPath.pathMs: job "unit (a)" is not on the critical path of workflow "wf/ci.yml"']);
});

test('a critical-path figure in a workflow with no critical path is unresolved', () => {
  assert.deepEqual(errorsOf(finding({ check: 'critical-path-pole', job: 'unit', evidence: [{ job: null, metric: 'criticalPath.sumMs', value: 95000 }] }), gather({ criticalPaths: [] })),
    ['evidence[0]: criticalPath.sumMs: workflow "wf/ci.yml" has no critical path']);
});

test('a finding citing a shard family resolves without a breach (a judge lead), but a breach metric with no breach does not', () => {
  accepted(finding({ check: 'shard-skew', job: 'unit', evidence: [{ job: 'unit', metric: 'shardSkew.ratio', value: 1.5 }] }));
  assert.deepEqual(errorsOf(finding({ check: 'shard-skew', job: 'unit', evidence: [{ job: 'unit', metric: 'shardSkewRatio', value: 1.5 }] })),
    ['evidence[0]: shardSkewRatio: the gather has no shard-skew breach for job "unit" in workflow "wf/ci.yml"']);
  assert.deepEqual(errorsOf(finding({ check: 'shard-skew', job: 'unit', evidence: [{ job: 'lint', metric: 'shardSkew.ratio', value: 1.5 }] })),
    ['evidence[0]: shardSkew.ratio: "lint" is not a shard family of workflow "wf/ci.yml"']);
});

test('a finding job resolves through each gathered name source alone: a chain entry, a shard family, a breach pair', () => {
  const g = gather({
    criticalPaths: [{ workflow: CI, pathMs: 75000, sumMs: 95000, chain: ['lint', 'build'] }],
    shardSkews: [{ workflow: CI, family: 'e2e', ratio: 3, slowest: 'e2e (1)', shards: 2 }],
    breaches: [{ check: 'serial-independent-jobs', workflow: CI, job: 'lint + unit (a)', metric: 'overlappingRuns', value: 0, threshold: 0 }],
  });
  accepted(finding({ check: 'missing-timeout', job: 'build', evidence: [{ job: 'build', metric: 'criticalPath.pathMs', value: 75000 }] }), g);
  accepted(finding({ check: 'shard-skew', job: 'e2e', evidence: [{ job: 'e2e', metric: 'shardSkew.ratio', value: 3 }] }), g);
  accepted(finding({ check: 'serial-independent-jobs', job: 'lint + unit (a)', evidence: [{ job: 'lint + unit (a)', metric: 'overlappingRuns', value: 0 }] }), g);
  assert.deepEqual(errorsOf(finding({ check: 'queue-wait', job: 'lint + unit (a)', evidence: [{ job: 'lint', metric: 'runs', value: 12 }] }), g),
    ['job: "lint + unit (a)" is not a gathered job of workflow "wf/ci.yml"']);
});

test('a breach metric cited for a job the breach does not name is unresolved', () => {
  assert.deepEqual(errorsOf(finding({ evidence: [{ job: 'unit (a)', metric: 'waitingShare', value: 0.6 }] })),
    ['evidence[0]: waitingShare: the gather has no queue-wait breach for job "unit (a)" in workflow "wf/ci.yml"']);
});

test('an evidence job carrying a line break is rejected even when the gather holds it', () => {
  const g = gather({ jobs: [...gather().jobs, row('odd\njob', [1, 1], [1, 1], [1, 1], [3, 3])] });
  assert.deepEqual(errorsOf(finding({ job: null, evidence: [{ job: 'odd\njob', metric: 'runs', value: 12 }] }), g),
    ['evidence[0]: job contains a control character or line break']);
});

test('a contradicting breach figure names both values', () => {
  assert.deepEqual(errorsOf(finding({ evidence: [{ job: 'lint', metric: 'waitingShare', value: 0.61 }] })),
    ['evidence[0]: waitingShare of job "lint" is 0.61 in the finding but 0.6 in the gather']);
  assert.deepEqual(errorsOf(finding({ check: 'shard-skew', job: 'unit', evidence: [{ job: 'unit', metric: 'shardSkew.ratio', value: 2 }] })),
    ['evidence[0]: shardSkew.ratio of job "unit" is 2 in the finding but 1.5 in the gather']);
});

test('a breach metric of another check is rejected', () => {
  assert.deepEqual(errorsOf(finding({ evidence: [{ job: 'unit', metric: 'criticalPathShare', value: 0.8 }] })),
    ['evidence[0]: criticalPathShare is not a metric of check queue-wait']);
});

test('an unknown metric is rejected', () => {
  assert.deepEqual(errorsOf(finding({ evidence: [{ job: 'lint', metric: 'waiting.p99Ms', value: 1 }] })),
    ['evidence[0]: metric "waiting.p99Ms" is not in the evidence vocabulary']);
});

test('a malformed evidence entry is rejected', () => {
  assert.deepEqual(errorsOf(finding({ evidence: [{ job: 'lint', metric: 'runs', value: '12' }] })),
    ['evidence[0]: must be {job: string|null, metric: string, value: finite number}']);
  assert.deepEqual(errorsOf(finding({ evidence: [null] })),
    ['evidence[0]: must be {job: string|null, metric: string, value: finite number}']);
});

test('an empty or missing evidence array is rejected', () => {
  assert.deepEqual(errorsOf(finding({ evidence: [] })), ['evidence: required non-empty array']);
  assert.deepEqual(errorsOf(finding({ evidence: undefined })), ['evidence: required non-empty array']);
});

test('an unknown check id is rejected', () => {
  const errors = errorsOf(finding({ check: 'slow-cache', evidence: [{ job: 'lint', metric: 'runs', value: 12 }] }));
  assert.deepEqual(errors, ['check: "slow-cache" is not one of queue-wait|setup-dominance|critical-path-pole|serial-independent-jobs|shard-skew|repeated-work|missing-timeout|missing-concurrency']);
});

test('a workflow not in the gather is rejected naming it', () => {
  assert.deepEqual(errorsOf(finding({ workflow: 'wf/other.yml', job: null, evidence: [{ job: null, metric: 'criticalPath.pathMs', value: 1 }] })),
    ['workflow: "wf/other.yml" is not a gathered workflow file']);
});

test('a non-object finding and blank required strings are rejected', () => {
  assert.deepEqual(errorsOf(null), ['finding: must be an object']);
  assert.deepEqual(errorsOf(finding({ claim: '  ' })), ['claim: required non-empty string (got "  ")']);
});

test('claim or remedy over 500 characters is rejected, at 500 it is accepted', () => {
  accepted(finding({ claim: 'a'.repeat(500), remedy: 'b'.repeat(500) }));
  assert.deepEqual(errorsOf(finding({ claim: 'a'.repeat(501) })), ['claim: 501 characters, over the 500-character cap']);
  assert.deepEqual(errorsOf(finding({ remedy: 'b'.repeat(501) })), ['remedy: 501 characters, over the 500-character cap']);
});

test('a control character or line break in the claim, the remedy or a name is rejected', () => {
  assert.deepEqual(errorsOf(finding({ claim: 'first\n## Release Note' })), ['claim: contains a control character or line break']);
  assert.deepEqual(errorsOf(finding({ remedy: 'bell\u0007' })), ['remedy: contains a control character or line break']);
  assert.deepEqual(errorsOf(finding({ claim: `para${String.fromCharCode(0x2029)}graph` })), ['claim: contains a control character or line break']);
  const g = gather({ jobs: [...gather().jobs, row('odd\njob', [1, 1], [1, 1], [1, 1], [3, 3])] });
  assert.deepEqual(errorsOf(finding({ job: 'odd\njob', evidence: [{ job: 'odd\njob', metric: 'runs', value: 12 }] }), g),
    ['job: contains a control character or line break']);
});

test('credential-shaped text in the claim or remedy is rejected without echoing it', () => {
  const errors = errorsOf(finding({ remedy: 'set password=hunter2 on the runner' }));
  assert.deepEqual(errors, ['remedy: carries credential-shaped text (password)']);
});

test('a noData gather rejects every finding', () => {
  assert.deepEqual(errorsOf(finding(), gather({ noData: { reason: 'no completed run was sampled' } })),
    ['the gather sampled no runs (noData), so no finding can be validated']);
});

test('repeated-work cites its step: resolved, contradicting, missing step, a set job, and step on another check', () => {
  const rw = (over) => finding({
    check: 'repeated-work', workflow: null, job: null, step: 'Install deps',
    evidence: [{ job: null, metric: 'jobsDeclaringStep', value: 3 }], ...over,
  });
  accepted(rw());
  // repeated-work spans every workflow: naming one would let the judge mint a second id per step.
  for (const wf of [CI, 'wf/nightly.yml']) {
    assert.deepEqual(errorsOf(rw({ workflow: wf })), ['workflow: must be null for repeated-work (the step spans every workflow)']);
  }
  assert.deepEqual(errorsOf(rw({ evidence: [{ job: null, metric: 'jobsDeclaringStep', value: 4 }] })),
    ['evidence[0]: jobsDeclaringStep of step "Install deps" is 4 in the finding but 3 in the gather']);
  assert.deepEqual(errorsOf(rw({ step: 'Build' })), ['step: "Build" is not a gathered repeated step', 'evidence[0]: jobsDeclaringStep: the gather has no repeated-work breach for step "Build"']);
  assert.deepEqual(errorsOf(rw({ step: undefined })), ['step: required for repeated-work']);
  assert.deepEqual(errorsOf(rw({ job: 'lint' })), ['job: must be null for repeated-work (the step is the subject)']);
  assert.deepEqual(errorsOf(finding({ step: 'Install deps' })), ['step: only repeated-work names a step']);
});

test('a job-row figure over fewer runs than window.minSample is rejected naming the sample; with the floor met it is accepted', () => {
  const thin = { ...row('lint', [9000, 12000], [2000, 3000], [4000, 5000], [15000, 20000]), runs: 3 };
  const g = gather({ jobs: [thin], underSampled: [{ workflow: CI, job: 'lint', runs: 3 }] });
  assert.deepEqual(errorsOf(finding({ evidence: [{ job: 'lint', metric: 'waiting.p50Ms', value: 9000 }] }), g),
    ['evidence[0]: job "lint" is under-sampled in workflow "wf/ci.yml": 3 runs, under the gather\'s minimum sample of 5']);
  accepted(finding({ evidence: [{ job: 'lint', metric: 'waiting.p50Ms', value: 9000 }] }),
    gather({ jobs: [thin], window: { ...gather().window, minSample: 3 } }));
});

test('a finding naming a workflow with unparsed reasons is rejected; with none it is accepted', () => {
  const g = gather({ workflows: [{ file: CI, unparsed: ['tab indentation in jobs:'] }, { file: 'wf/nightly.yml', unparsed: [] }] });
  assert.deepEqual(errorsOf(finding(), g), ['workflow: "wf/ci.yml" has unparsed workflow-file reasons in the gather, so it is never judged']);
  accepted(finding());
});

// ---- fingerprint ------------------------------------------------------------------------

test('the fingerprint is cihealth-<8 hex> over check, workflow, job and step only', () => {
  const id = fingerprint(finding());
  assert.equal(id, 'cihealth-f788ae38');
  assert.equal(fingerprint(finding({ claim: 'reworded', evidence: [] })), id);
  assert.equal(fingerprint({ check: 'queue-wait', workflow: CI, job: 'lint', step: null }), id);
  assert.notEqual(fingerprint(finding({ job: 'unit (a)' })), id);
  assert.notEqual(fingerprint(finding({ check: 'repeated-work', workflow: null, job: null, step: 'A' })),
    fingerprint(finding({ check: 'repeated-work', workflow: null, job: null, step: 'B' })));
  assert.equal(fingerprint(finding({ check: 'repeated-work', workflow: null, job: null, step: 'Install deps' })), 'cihealth-e4149032');
  assert.equal(fingerprint(finding({ check: 'repeated-work', workflow: 'wf/nightly.yml', job: null, step: 'Install deps' })), 'cihealth-e4149032');
});

test('two repeated-work findings for one step naming different workflows are both rejected at the verb', () => {
  const rw = (wf) => finding({ check: 'repeated-work', workflow: wf, job: null, step: 'Install deps', evidence: [{ job: null, metric: 'jobsDeclaringStep', value: 3 }] });
  const r = verb(VF, { 'g.json': gather(), 'f.json': [rw(CI), rw('wf/nightly.yml')], 'i.json': [] });
  assert.equal(r.code, 1);
  assert.deepEqual(parseOut(r), []);
  assert.equal(r.err, [
    'ci-audit.js: validate-findings: finding 0 ("repeated-work") rejected: workflow: must be null for repeated-work (the step spans every workflow)',
    'ci-audit.js: validate-findings: finding 1 ("repeated-work") rejected: workflow: must be null for repeated-work (the step spans every workflow)',
    'ci-audit.js: validate-findings: 2 finding(s): 0 valid, 2 rejected, 0 collapsed as duplicates, 0 already filed or suppressed, 0 payload(s)',
    '',
  ].join('\n'));
});

test('a critical-path entry with a malformed figure has no gathered figure', () => {
  const g = gather({ criticalPaths: [{ workflow: CI, pathMs: 'x', sumMs: 95000, chain: ['lint', 'unit'] }] });
  assert.deepEqual(errorsOf(finding({ evidence: [{ job: null, metric: 'criticalPath.pathMs', value: 75000 }] }), g),
    ['evidence[0]: criticalPath.pathMs of workflow "wf/ci.yml" has no gathered figure']);
});

test('an unresolved credential-shaped name is withheld from the error text', () => {
  const errors = errorsOf(finding({ job: 'password=hunter2' }));
  assert.deepEqual(errors, ['job: (a name that looks like a credential, withheld) is not a gathered job of workflow "wf/ci.yml"']);
});

// ---- toIssuePayload ---------------------------------------------------------------------

function checkBody(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-audit-body-'));
  try {
    const file = path.join(dir, 'body.md');
    fs.writeFileSync(file, body);
    const r = childProcess.spawnSync(process.execPath, [COMPOSE, '--check', file], { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, `compose-record --check failed: ${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const payloadFor = (f, g = gather(), verifiedAsOf = null) => toIssuePayload({ ...f, id: fingerprint(f) }, g, verifiedAsOf);

test('AC5.1: the payload passes compose-record --check and carries the labels, marker and Release Note', () => {
  const p = payloadFor(finding());
  checkBody(p.body);
  assert.equal(p.origin, 'ci-health');
  assert.equal(p.type, 'task');
  assert.deepEqual(p.labels, ['by:ci-health', 'risk:low', 'size:low', 'ready']);
  assert.equal(p.id, 'cihealth-f788ae38');
  assert.ok(p.body.includes('<!-- work-fingerprint: cihealth-f788ae38 -->\nwork-fingerprint: cihealth-f788ae38'));
  assert.equal(extractFingerprint(p.body), 'cihealth-f788ae38');
  assert.equal(RELEASE_NOTE, 'No user-visible change — CI timing finding.');
  assert.ok(p.body.includes('\n\n## Release Note\n\nNo user-visible change — CI timing finding.\n\n_Filed by `/claude-tweaks:ci-health`.'), p.body);
  assert.ok(!p.body.includes('Key Files'), 'no Key Files section');
  assert.equal(p.title, 'CI queue-wait: `wf/ci.yml` — `lint`');
});

test('the payload Current State states the figures in code spans, the sample, the window and the claim', () => {
  const p = payloadFor(finding());
  assert.equal(extractSection(p.body, 'Current State', { trim: true }), [
    'Measured over the 30-day window from `2026-10-17`: `12` sampled runs, a job judged at `5` runs or more.',
    '- `waiting.p50Ms` of job `lint`: `9000`\n- `waitingShare` of job `lint`: `0.6`',
    'The finding, as the judge wrote it:',
    '```\nlint waits longer for a runner than it takes to run.\n```',
  ].join('\n\n'));
});

test('the payload Deliverables recommend the remedy and the Acceptance Criteria name the breach threshold', () => {
  const p = payloadFor(finding());
  assert.equal(extractSection(p.body, 'Deliverables', { trim: true }), [
    'Investigate this recommendation and apply it where it holds:',
    '```\nGive lint a less contended runner pool, or fold it into a job that already holds one.\n```',
  ].join('\n\n'));
  assert.equal(extractSection(p.body, 'Acceptance Criteria', { trim: true }),
    'On the next sweep, `waitingShare` for workflow `wf/ci.yml` job `lint` is at or below `0.4`, the queue-wait threshold.');
});

test('repeated-work Acceptance Criteria read "below" (the check fires at its threshold); a finding with no breach reads "no breach"', () => {
  const rw = finding({ check: 'repeated-work', workflow: null, job: null, step: 'Install deps', evidence: [{ job: null, metric: 'jobsDeclaringStep', value: 3 }] });
  const p = payloadFor(rw);
  checkBody(p.body);
  assert.equal(extractSection(p.body, 'Acceptance Criteria', { trim: true }),
    'On the next sweep, `jobsDeclaringStep` for step `Install deps` is below `3`, the repeated-work threshold.');
  assert.equal(p.title, 'CI repeated-work: step `Install deps`');
  assert.ok(p.body.startsWith('**Check:** `repeated-work` | **Step:** `Install deps`\n\n'), p.body);
  assert.equal(p.workflow, null);
  const lead = payloadFor(finding({ check: 'shard-skew', job: 'unit', evidence: [{ job: 'unit', metric: 'shardSkew.ratio', value: 1.5 }] }));
  assert.equal(extractSection(lead.body, 'Acceptance Criteria', { trim: true }),
    'On the next sweep, the shard-skew check reports no breach for workflow `wf/ci.yml` job `unit`.');
  const g = gather({ breaches: [{ check: 'missing-concurrency', workflow: CI, job: null, metric: 'concurrencyDeclared', value: 0, threshold: 0 }] });
  const mc = payloadFor(finding({ check: 'missing-concurrency', job: null, evidence: [{ job: null, metric: 'concurrencyDeclared', value: 0 }] }), g);
  assert.equal(extractSection(mc.body, 'Acceptance Criteria', { trim: true }),
    'On the next sweep, the missing-concurrency check reports no breach for workflow `wf/ci.yml`.');
});

test('the Failed reads block shows the first 20 lines and counts the rest, so the body stays bounded', () => {
  const failures = Array.from({ length: 25 }, (_, i) => `jobs of run ${i + 1}: timed out`);
  const p = payloadFor(finding(), gather({ failures }));
  checkBody(p.body);
  const block = p.body.split('Failed reads:\n\n```\n')[1].split('\n```')[0].split('\n');
  assert.equal(block.length, 21);
  assert.equal(block[19], 'jobs of run 20: timed out');
  assert.equal(block[20], '+5 more failed reads');
  assert.ok(!p.body.includes('jobs of run 21:'));
  const exact = payloadFor(finding(), gather({ failures: failures.slice(0, 20) }));
  assert.ok(!exact.body.includes('more failed reads'));
});

test('a failed-read line carrying credential-shaped text is withheld from the body', () => {
  const p = payloadFor(finding(), gather({ failures: ['jobs of run 7: password=hunter2'] }));
  assert.ok(!p.body.includes('hunter2'));
  assert.ok(p.body.includes('Failed reads:\n\n```\n(a failed read whose text looks like a credential, withheld)\n```'), p.body);
});

test('a truncated line carrying credential-shaped text is withheld from the body', () => {
  const p = payloadFor(finding(), gather({ truncated: ['runs a..b: token=abc123secret'] }));
  assert.ok(!p.body.includes('abc123secret'));
  assert.ok(p.body.includes('Truncated:\n\n```\n(a truncated range whose text looks like a credential, withheld)\n```'), p.body);
});

test('the title is capped at 200 characters, the name cut with an ellipsis inside a balanced span', () => {
  const name = 'j'.repeat(300);
  const g = gather({ jobs: [...gather().jobs, row(name, [1, 1], [1, 1], [1, 1], [3, 3])] });
  const p = payloadFor(finding({ job: name, evidence: [{ job: name, metric: 'runs', value: 12 }] }), g);
  assert.equal(p.title, `CI queue-wait: \`wf/ci.yml\` — \`${'j'.repeat(168)}…\``);
  assert.equal(p.title.length, 200);
  const short = payloadFor(finding());
  assert.equal(short.title, 'CI queue-wait: `wf/ci.yml` — `lint`');
});

test('a title cut over astral characters or backticks keeps every code point that fits, never a bare ellipsis', () => {
  // Each emoji is 2 UTF-16 units: the cut counts in the cap's own unit, so it keeps 84 of them, not 0.
  const emoji = '😀'.repeat(300);
  const g1 = gather({ jobs: [...gather().jobs, row(emoji, [1, 1], [1, 1], [1, 1], [3, 3])] });
  const p1 = payloadFor(finding({ job: emoji, evidence: [{ job: emoji, metric: 'runs', value: 12 }] }), g1);
  assert.equal(p1.title, `CI queue-wait: \`wf/ci.yml\` — \`${'😀'.repeat(84)}…\``);
  assert.ok(p1.title.length <= 200 && p1.title.length >= 199, String(p1.title.length));
  // A long backtick run widens the span's fence: still a balanced span with real text in it.
  const ticks = `${'a'.repeat(50)}${'`'.repeat(20)}${'b'.repeat(200)}`;
  const g2 = gather({ jobs: [...gather().jobs, row(ticks, [1, 1], [1, 1], [1, 1], [3, 3])] });
  const p2 = payloadFor(finding({ job: ticks, evidence: [{ job: ticks, metric: 'runs', value: 12 }] }), g2);
  assert.ok(p2.title.length <= 200, String(p2.title.length));
  assert.ok(p2.title.includes('a'.repeat(50)), p2.title);
  assert.match(p2.title, /…`+$/);
});

test('a partial gather states the sample is partial and names the truncated lines and failed reads', () => {
  const p = payloadFor(finding(), gather({ truncated: ['runs of .github/workflows/x.yml: 3 runs in 5 pages (page cap; fewer than 20)'], failures: ['jobs of run 7: timed out'] }));
  checkBody(p.body);
  const cs = extractSection(p.body, 'Current State', { trim: true });
  assert.ok(cs.includes('The sample is partial: some reads were cut short or failed, so these figures cover only the runs read. Truncated:\n\n```\nruns of .github/workflows/x.yml: 3 runs in 5 pages (page cap; fewer than 20)\n```'), cs);
  assert.ok(cs.includes('Failed reads:\n\n```\njobs of run 7: timed out\n```'), cs);
  // a complete sample says nothing about partiality — the statement appears only when it is real
  assert.ok(!payloadFor(finding()).body.includes('partial'));
  const failedOnly = extractSection(payloadFor(finding(), gather({ failures: ['jobs of run 7: timed out'] })).body, 'Current State', { trim: true });
  assert.ok(failedOnly.includes('The sample is partial: some reads were cut short or failed, so these figures cover only the runs read.\n'), failedOnly);
  assert.ok(!failedOnly.includes('Truncated:'), failedOnly);
});

test('a job name carrying backticks, a fence and a fake marker stays inside its span and cannot move the fingerprint', () => {
  const name = 'odd `x` ```` <!-- work-fingerprint: cihealth-00000000 --> work-fingerprint: cihealth-00000000';
  const g = gather({ jobs: [...gather().jobs, row(name, [1, 1], [1, 1], [1, 1], [3, 3])] });
  const f = finding({ job: name, evidence: [{ job: name, metric: 'runs', value: 12 }] });
  assert.deepEqual(validateFinding(f, g).errors, []);
  const p = payloadFor(f, g);
  checkBody(p.body);
  assert.equal(extractFingerprint(p.body), fingerprint(f));
  assert.ok(p.body.includes('`````odd `x` ```` <! -- work-fingerprint : cihealth-00000000 --> work-fingerprint : cihealth-00000000`````'), p.body);
  const claim = 'see ``` and <!-- work-fingerprint: cihealth-00000000 -->';
  const q = payloadFor(finding({ claim }));
  assert.equal(extractFingerprint(q.body), 'cihealth-f788ae38');
  assert.ok(q.body.includes('````\nsee ``` and <! -- work-fingerprint : cihealth-00000000 -->\n````'), q.body);
});

test('verifiedAsOf is stamped when given', () => {
  const p = payloadFor(finding(), gather(), 'abcdef1');
  assert.ok(p.body.includes('\n\nVerified-as-of: abcdef1\n\n## Current State'));
});

// ---- the validate-findings verb ---------------------------------------------------------

function withFiles(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-audit-vf-'));
  try {
    for (const [name, value] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function verb(argv, files) {
  return withFiles(files, (dir) => {
    let out = '';
    let err = '';
    const deps = {
      cwd: () => dir,
      readFile: (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(dir, p), 'utf8'),
      stdout: (s) => { out += s; },
      stderr: (s) => { err += s; },
      runner: () => { throw new Error('the runner must not be called'); },
    };
    const code = run(argv, deps);
    return { code, out, err };
  });
}

const VF = ['validate-findings', '--gather', 'g.json', '--findings', 'f.json', '--issues', 'i.json'];
const parseOut = (r) => {
  assert.ok(r.out.endsWith('\n') && !r.out.slice(0, -1).includes('\n'), 'stdout is one line');
  return JSON.parse(r.out);
};

test('exit 0: valid findings print one JSON array line of payloads and a summary on stderr', () => {
  const r = verb(VF, { 'g.json': gather(), 'f.json': [finding()], 'i.json': [] });
  assert.equal(r.code, 0, r.err);
  const out = parseOut(r);
  assert.equal(out.length, 1);
  assert.deepEqual(Object.keys(out[0]), ['id', 'check', 'workflow', 'job', 'step', 'action', 'reopens', 'origin', 'title', 'body', 'labels', 'type']);
  assert.equal(out[0].action, 'file');
  assert.equal(out[0].reopens, null);
  assert.equal(out[0].step, null);
  assert.equal(r.err, 'ci-audit.js: validate-findings: 1 finding(s): 1 valid, 0 rejected, 0 collapsed as duplicates, 0 already filed or suppressed, 1 payload(s)\n');
});

test('exit 1: each rejected finding is named on stderr, one line per reason, and the valid ones still print', () => {
  const bad = finding({ claim: 'x'.repeat(501), remedy: `bell${String.fromCharCode(7)}` });
  const unknown = finding({ check: 'slow-cache' });
  const r = verb(VF, { 'g.json': gather(), 'f.json': [bad, unknown, finding()], 'i.json': [] });
  assert.equal(r.code, 1);
  assert.equal(parseOut(r).length, 1);
  assert.equal(r.err, [
    'ci-audit.js: validate-findings: finding 0 ("queue-wait") rejected: claim: 501 characters, over the 500-character cap',
    'ci-audit.js: validate-findings: finding 0 ("queue-wait") rejected: remedy: contains a control character or line break',
    'ci-audit.js: validate-findings: finding 1 (an unknown check) rejected: check: "slow-cache" is not one of queue-wait|setup-dominance|critical-path-pole|serial-independent-jobs|shard-skew|repeated-work|missing-timeout|missing-concurrency',
    'ci-audit.js: validate-findings: 3 finding(s): 1 valid, 2 rejected, 0 collapsed as duplicates, 0 already filed or suppressed, 1 payload(s)',
    '',
  ].join('\n'));
});

test('a noData gather: every finding rejected, exit 1, an empty array', () => {
  const r = verb(VF, { 'g.json': gather({ noData: { reason: 'none' } }), 'f.json': [finding()], 'i.json': [] });
  assert.equal(r.code, 1);
  assert.deepEqual(parseOut(r), []);
  assert.match(r.err, /^ci-audit\.js: validate-findings: finding 0 \("queue-wait"\) rejected: the gather sampled no runs \(noData\), so no finding can be validated\n/);
});

test('no findings: exit 0 and an empty array', () => {
  const r = verb(VF, { 'g.json': gather(), 'f.json': [], 'i.json': [] });
  assert.equal(r.code, 0);
  assert.equal(r.out, '[]\n');
});

test('two findings with the same check, workflow and job collapse to one payload (the first)', () => {
  const r = verb(VF, { 'g.json': gather(), 'f.json': [finding(), finding({ claim: 'the same lead, reworded' })], 'i.json': [] });
  assert.equal(r.code, 0);
  const out = parseOut(r);
  assert.equal(out.length, 1);
  assert.ok(out[0].body.includes('lint waits longer'));
  assert.match(r.err, /2 valid, 0 rejected, 1 collapsed as duplicates, 0 already filed or suppressed, 1 payload\(s\)/);
});

test('AC4.1: a fingerprint match with an open by:ci-health issue produces no payload', () => {
  const issues = [{ number: 41, state: 'OPEN', labels: [{ name: 'by:ci-health' }], fingerprint: 'cihealth-f788ae38' }];
  const r = verb(VF, { 'g.json': gather(), 'f.json': [finding()], 'i.json': issues });
  assert.equal(r.code, 0);
  assert.deepEqual(parseOut(r), []);
  assert.match(r.err, /1 already filed or suppressed, 0 payload\(s\)/);
});

test('AC4.2: a different fingerprint files; a closed wontfix match produces none; a closed plain match reopens', () => {
  const other = [{ number: 41, state: 'OPEN', labels: ['by:ci-health'], fingerprint: 'cihealth-12345678' }];
  const filed = verb(VF, { 'g.json': gather(), 'f.json': [finding()], 'i.json': other });
  assert.equal(parseOut(filed).length, 1);
  assert.equal(parseOut(filed)[0].action, 'file');

  const wontfix = [{ number: 42, state: 'CLOSED', labels: ['by:ci-health', 'wontfix'], fingerprint: 'cihealth-f788ae38' }];
  assert.deepEqual(parseOut(verb(VF, { 'g.json': gather(), 'f.json': [finding()], 'i.json': wontfix })), []);

  const closed = [{ number: 43, state: 'CLOSED', labels: ['by:ci-health'], fingerprint: 'cihealth-f788ae38' }];
  const reopened = parseOut(verb(VF, { 'g.json': gather(), 'f.json': [finding()], 'i.json': closed }));
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].action, 'reopen');
  assert.equal(reopened[0].reopens, 43);
});

test('a closed match with no issue number is held, never printed as a reopen of null', () => {
  const closed = [{ state: 'CLOSED', labels: ['by:ci-health'], fingerprint: 'cihealth-f788ae38' }];
  const r = verb(VF, { 'g.json': gather(), 'f.json': [finding()], 'i.json': closed });
  assert.equal(r.code, 0);
  assert.deepEqual(parseOut(r), []);
  assert.match(r.err, /1 already filed or suppressed, 0 payload\(s\)/);
});

test('the issue index is built from the --issues array read once through the injected reader, never re-read by path', () => {
  const reads = [];
  const files = { 'g.json': gather(), 'f.json': [finding()], 'i.json': [{ number: 41, state: 'OPEN', labels: ['by:ci-health'], fingerprint: 'cihealth-f788ae38' }] };
  let out = '';
  const code = run(VF, {
    cwd: () => '/nonexistent-checkout',
    readFile: (p) => { reads.push(p); return JSON.stringify(files[p]); },
    stdout: (s) => { out += s; },
    stderr: () => {},
  });
  assert.equal(code, 0);
  assert.equal(out, '[]\n');
  assert.deepEqual(reads, ['g.json', 'f.json', 'i.json']);
});

test('a repeat run over unchanged data with its own payload filed files nothing', () => {
  const first = parseOut(verb(VF, { 'g.json': gather(), 'f.json': [finding()], 'i.json': [] }));
  const issues = first.map((p, i) => ({ number: 100 + i, state: 'OPEN', labels: p.labels, fingerprint: extractFingerprint(p.body) }));
  assert.deepEqual(parseOut(verb(VF, { 'g.json': gather(), 'f.json': [finding()], 'i.json': issues })), []);
});

test('AC6.1: --dry-run spawns no process and writes no file; payloads carry dryRun: true', () => {
  const spawnNames = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];
  const writeNames = ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'renameSync', 'unlinkSync', 'copyFileSync',
    'writeFile', 'appendFile', 'mkdir', 'rm', 'rename', 'unlink', 'openSync', 'createWriteStream'];
  const used = [];
  const swap = (mod, names) => names.map((n) => {
    const orig = mod[n];
    mod[n] = (...args) => { used.push(n); return orig.apply(mod, args); };
    return () => { mod[n] = orig; };
  });
  withFiles({ 'g.json': gather(), 'f.json': [finding()], 'i.json': [] }, (dir) => {
    let out = '';
    let calls = 0;
    const restore = [...swap(childProcess, spawnNames), ...swap(fs, writeNames)];
    let code;
    try {
      code = run([...VF, '--dry-run'], {
        cwd: () => dir,
        readFile: (p) => fs.readFileSync(path.join(dir, p), 'utf8'),
        stdout: (s) => { out += s; },
        stderr: () => {},
        runner: () => { calls += 1; },
      });
    } finally {
      for (const r of restore) r();
    }
    assert.equal(code, 0);
    assert.deepEqual(used, []);
    assert.equal(calls, 0);
    const payloads = JSON.parse(out);
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].dryRun, true);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['f.json', 'g.json', 'i.json']);
  });
});

test('exit 2: usage and unusable inputs print one stderr line and nothing on stdout', () => {
  const cases = [
    [['validate-findings', '--findings', 'f.json', '--issues', 'i.json'], {}, 'validate-findings requires --gather <file>'],
    [['validate-findings', '--gather', 'g.json', '--issues', 'i.json'], {}, 'validate-findings requires --findings <file>'],
    [['validate-findings', '--gather', 'g.json', '--findings', 'f.json'], {}, 'validate-findings requires --issues <file> (an empty JSON array when no by:ci-health issue exists)'],
    [[...VF, '--days', '3'], {}, 'unknown argument: "--days"'],
    [[...VF, '--gather', 'h.json'], {}, '--gather given twice'],
    [['validate-findings', '--gather'], {}, '--gather requires a file'],
    [VF, { 'f.json': [], 'i.json': [] }, '--gather g.json: could not read or parse the file'],
    [VF, { 'g.json': { jobs: [] }, 'f.json': [], 'i.json': [] }, '--gather g.json: not a gather report'],
    [VF, { 'g.json': gather(), 'f.json': '{"a":1}', 'i.json': [] }, '--findings f.json: must hold a JSON array'],
    [VF, { 'g.json': gather(), 'f.json': '[', 'i.json': [] }, '--findings f.json: could not read or parse the file'],
    [VF, { 'g.json': gather(), 'f.json': [], 'i.json': '{}' }, '--issues i.json: must hold a JSON array'],
    [VF, { 'g.json': gather(), 'f.json': [] }, '--issues i.json: could not read or parse the file'],
  ];
  for (const [argv, files, message] of cases) {
    const r = verb(argv, files);
    assert.equal(r.code, 2, message);
    assert.equal(r.out, '', message);
    assert.equal(r.err, `ci-audit.js: ${message} (see --help)\n`, message);
  }
});

test('--help names both verbs', () => {
  const r = verb(['--help'], {});
  assert.equal(r.code, 0);
  assert.match(r.out, /^usage: ci-audit\.js gather /);
  assert.match(r.out, /\n {7}ci-audit\.js validate-findings --gather <file> --findings <file> --issues <file> \[--dry-run\]\n/);
});
