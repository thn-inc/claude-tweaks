'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { POLICY_KEYS, PLAN_LANE_REASONS: R, needsNoPlan } = require(path.join(LIB, 'driver', 'plan-lane.js'));
const { extractKeyFileEntries } = require(path.join(LIB, 'issues', 'grouping.js'));
const { evaluateRecordEligibility } = require(path.join(LIB, 'express', 'eligibility.js'));
const { evaluateAdmission } = require(path.join(LIB, 'driver', 'admission.js'));
const { reviewRequired } = require(path.join(LIB, 'driver', 'review.js'));
const { eligibilityOptions } = require(path.join(LIB, 'driver', 'lane-bounds.js'));
const { STEPS } = require(path.join(LIB, 'driver', 'steps.js'));

const backendFiles = (n) => Array.from({ length: n }, (_, i) => `plugin/bin/lib/plan-lane-fixture/m${i}.js`);

// A spec-shaped body: the metadata block (Surface:, Risk-flags:) before the first blank line, the
// sections shapeGate requires, and a `### Key Files` list (null leaves the section out).
function body(keyFiles, { surface = 'infra', riskFlags = 'Risk-flags: none', extra = '' } = {}) {
  return [
    `Surface: ${surface}`, riskFlags, '',
    '## Current State', '', 'The fixture lacks a line.', ...(extra ? ['', extra] : []), '',
    '## Deliverables', '', '- Add the line.', '',
    '## Acceptance Criteria', '', '- The line is present.', '',
    '## Release Note', '', 'Adds a line.', '',
    '## Technical Approach', '',
    ...(keyFiles === null ? [] : ['### Key Files', '', ...keyFiles.map((p) => `- \`${p}\` (modify)`), '']),
  ].join('\n');
}

const POLICY_DEFAULTS = {
  'express-driver': 'on',
  'express-driver-max-size': 'medium',
  'express-driver-max-key-files': 5,
  'express-driver-review': 'beyond-express',
  'express-lane': true,
  'integration-model': 'pr-first',
  'merge-sensitive-paths': [],
};
// resolve-policy's shape: { key: { value, source } }.
function policy(overrides = {}) {
  const values = { ...POLICY_DEFAULTS, ...overrides };
  return Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value, source: 'policy' }]));
}

function verdictFor({ labels, keyFiles, opts, pol = policy() }) {
  const b = body(keyFiles, opts);
  return needsNoPlan({ labels, keyFiles: extractKeyFileEntries(b), body: b, policy: pol });
}

const DRIVER_LABELS = ['risk:low', 'size:medium', 'type:feature'];
const DRIVER_FILES = backendFiles(4);
const EXPRESS_LABELS = ['risk:low', 'size:low', 'ceremony:fast-lane', 'type:task'];
const EXPRESS_FILES = backendFiles(2);
const MICRO_FILES = ['plugin/bin/lib/plan-lane-fixture/m0.js', 'tests/plan-lane-fixture/m0.test.js'];

test('POLICY_KEYS and PLAN_LANE_REASONS are frozen and name the stable codes', () => {
  assert.deepStrictEqual([...POLICY_KEYS], [
    'express-driver', 'express-driver-max-size', 'express-driver-max-key-files', 'express-driver-review',
    'express-lane', 'integration-model', 'merge-sensitive-paths',
  ]);
  assert.ok(Object.isFrozen(POLICY_KEYS));
  assert.ok(Object.isFrozen(R));
  assert.deepStrictEqual(Object.values(R).sort(), [
    'body-unreadable', 'inside-driver-bounds', 'inside-express-bounds', 'key-files-missing', 'key-files-unreadable',
    'labels-unreadable', 'outside-every-lane', 'passes-micro-plan-gate', 'policy-unreadable', 'risk-flags-unreadable',
  ]);
});

test('AC1.1: a record inside the driver bounds reads driver with no auto:build, bot:blocked and an open blocker line', () => {
  const v = verdictFor({ labels: [...DRIVER_LABELS, 'bot:blocked'], keyFiles: DRIVER_FILES, opts: { extra: 'Blocked by #123' } });
  assert.deepStrictEqual(v, { lane: 'driver', reason: 'inside-driver-bounds' });
});

test('AC6.2: express-driver split reads like on (no issue number is read, so parity never refuses)', () => {
  const v = verdictFor({ labels: [...DRIVER_LABELS, 'bot:blocked'], keyFiles: DRIVER_FILES, opts: { extra: 'Blocked by #123' }, pol: policy({ 'express-driver': 'split' }) });
  assert.deepStrictEqual(v, { lane: 'driver', reason: 'inside-driver-bounds' });
});

test('AC6.2: express-driver off never reads driver; a record the express lane takes reads express', () => {
  const pol = policy({ 'express-driver': 'off' });
  assert.deepStrictEqual(verdictFor({ labels: EXPRESS_LABELS, keyFiles: EXPRESS_FILES, pol }), { lane: 'express', reason: 'inside-express-bounds' });
  // The driver-only record has no other lane once the driver is off.
  assert.deepStrictEqual(verdictFor({ labels: DRIVER_LABELS, keyFiles: DRIVER_FILES, pol }), { lane: null, reason: 'outside-every-lane' });
});

test('AC2.1: a record passing the micro-plan gate reads micro-plan when the driver and express lanes are off', () => {
  const v = verdictFor({ labels: EXPRESS_LABELS, keyFiles: MICRO_FILES, pol: policy({ 'express-lane': false, 'express-driver': 'off' }) });
  assert.deepStrictEqual(v, { lane: 'micro-plan', reason: 'passes-micro-plan-gate' });
});

test('AC2.1: two implementation Key Files fail the micro-plan gate', () => {
  const v = verdictFor({ labels: EXPRESS_LABELS, keyFiles: backendFiles(2), pol: policy({ 'express-lane': false, 'express-driver': 'off' }) });
  assert.deepStrictEqual(v, { lane: null, reason: 'outside-every-lane' });
});

test('AC3.1: a risk:high record reads outside every lane', () => {
  const v = verdictFor({ labels: ['risk:high', 'size:medium', 'type:feature'], keyFiles: DRIVER_FILES });
  assert.deepStrictEqual(v, { lane: null, reason: 'outside-every-lane' });
});

test('AC6.1: a record inside driver, express and micro-plan bounds reads the first lane in precedence order', () => {
  assert.deepStrictEqual(verdictFor({ labels: EXPRESS_LABELS, keyFiles: MICRO_FILES }), { lane: 'driver', reason: 'inside-driver-bounds' });
  assert.deepStrictEqual(verdictFor({ labels: EXPRESS_LABELS, keyFiles: MICRO_FILES, pol: policy({ 'express-driver': 'off' }) }),
    { lane: 'express', reason: 'inside-express-bounds' });
  assert.deepStrictEqual(verdictFor({ labels: EXPRESS_LABELS, keyFiles: MICRO_FILES, pol: policy({ 'express-driver': 'off', 'express-lane': false }) }),
    { lane: 'micro-plan', reason: 'passes-micro-plan-gate' });
});

test('AC6.3: missing or unreadable Key Files read null', () => {
  const b = body(DRIVER_FILES);
  const base = { labels: DRIVER_LABELS, body: b, policy: policy() };
  assert.deepStrictEqual(needsNoPlan({ ...base, keyFiles: null }), { lane: null, reason: 'key-files-missing' });
  assert.deepStrictEqual(needsNoPlan({ ...base, keyFiles: 'x' }), { lane: null, reason: 'key-files-unreadable' });
  assert.deepStrictEqual(needsNoPlan({ ...base, keyFiles: { entries: [], unparsed: 1 } }), { lane: null, reason: 'key-files-unreadable' });
  assert.deepStrictEqual(needsNoPlan({ ...base, keyFiles: { entries: 'a', unparsed: 0 } }), { lane: null, reason: 'key-files-unreadable' });
  assert.deepStrictEqual(needsNoPlan({ ...base, keyFiles: { entries: [] } }), { lane: null, reason: 'key-files-unreadable' });
  // A partly unparsed section on an otherwise driver-eligible record still fails closed.
  const partial = extractKeyFileEntries(`${b}- no backticks here\n`);
  assert.strictEqual(partial.unparsed, 1);
  assert.deepStrictEqual(needsNoPlan({ ...base, keyFiles: partial }), { lane: null, reason: 'key-files-unreadable' });
});

test('AC6.3: unreadable labels or body read null', () => {
  const b = body(DRIVER_FILES);
  const keyFiles = extractKeyFileEntries(b);
  assert.deepStrictEqual(needsNoPlan({ labels: null, keyFiles, body: b, policy: policy() }), { lane: null, reason: 'labels-unreadable' });
  assert.deepStrictEqual(needsNoPlan({ labels: 'risk:low', keyFiles, body: b, policy: policy() }), { lane: null, reason: 'labels-unreadable' });
  assert.deepStrictEqual(needsNoPlan({ labels: DRIVER_LABELS, keyFiles, body: 7, policy: policy() }), { lane: null, reason: 'body-unreadable' });
  assert.deepStrictEqual(needsNoPlan(), { lane: null, reason: 'labels-unreadable' });
});

test('AC6.3: an unreadable bound or policy entry reads null, policy-unreadable', async (t) => {
  const b = body(DRIVER_FILES);
  const keyFiles = extractKeyFileEntries(b);
  const run = (pol) => needsNoPlan({ labels: DRIVER_LABELS, keyFiles, body: b, policy: pol });
  const unreadable = { lane: null, reason: 'policy-unreadable' };
  // Control: the same record and policy read driver.
  assert.deepStrictEqual(run(policy()), { lane: 'driver', reason: 'inside-driver-bounds' });
  const cases = {
    'max-size huge': policy({ 'express-driver-max-size': 'huge' }),
    'max-size toString': policy({ 'express-driver-max-size': 'toString' }),
    'max-key-files 0': policy({ 'express-driver-max-key-files': 0 }),
    'max-key-files "5"': policy({ 'express-driver-max-key-files': '5' }),
    'express-driver sometimes': policy({ 'express-driver': 'sometimes' }),
    'express-driver-review maybe': policy({ 'express-driver-review': 'maybe' }),
    'express-lane "true"': policy({ 'express-lane': 'true' }),
    'integration-model empty': policy({ 'integration-model': '' }),
    'integration-model null': policy({ 'integration-model': null }),
    'no policy': undefined,
    'policy not an object': 'on',
  };
  for (const key of POLICY_KEYS) {
    const missing = policy();
    delete missing[key];
    cases[`missing ${key}`] = missing;
    cases[`${key} entry without value`] = { ...policy(), [key]: { source: 'default' } };
    cases[`${key} entry not an object`] = { ...policy(), [key]: 'on' };
  }
  // Plan Review Clarification 1: resolve-policy's invalid shape, or an error field, is unreadable
  // even when the value it carries is a valid default.
  cases['invalid: true on a valid default'] = { ...policy(), 'express-driver-max-size': { value: 'medium', source: 'default', invalid: true } };
  cases['error field on a valid value'] = { ...policy(), 'express-driver': { value: 'on', source: 'policy', error: 'bad value' } };
  for (const [name, pol] of Object.entries(cases)) {
    await t.test(name, () => assert.deepStrictEqual(run(pol), unreadable));
  }
});

test('AC6.3: an unreadable bound on a record the express lane takes reads null, never express (Review Focus 2)', () => {
  for (const bad of [{ 'express-driver-max-size': 'huge' }, { 'express-driver-max-key-files': 0 }]) {
    for (const drv of ['on', 'off']) {
      const v = verdictFor({ labels: EXPRESS_LABELS, keyFiles: EXPRESS_FILES, pol: policy({ ...bad, 'express-driver': drv }) });
      assert.deepStrictEqual(v, { lane: null, reason: 'policy-unreadable' }, JSON.stringify({ bad, drv }));
    }
  }
});

test('AC6.3: a malformed Risk-flags line reads null, never a later lane (Review Focus 5)', () => {
  for (const riskFlags of ['Risk-flags: maybe?', 'Risk-flags: none, schema']) {
    const v = verdictFor({ labels: EXPRESS_LABELS, keyFiles: MICRO_FILES, opts: { riskFlags } });
    assert.deepStrictEqual(v, { lane: null, reason: 'risk-flags-unreadable' }, riskFlags);
  }
});

test('AC6.3: a health-origin record with no Key Files section reads key-files-missing, not a lane built from its header (Review Focus 1)', () => {
  const b = [
    'Anchor: `plugin/bin/lib/plan-lane-fixture/m0.js#L1`', '',
    body(null),
  ].join('\n');
  const labels = ['by:code-health', ...EXPRESS_LABELS];
  // Control: eligibility reads a Key File from the origin header, so a header-built verdict would not be empty.
  assert.ok(evaluateRecordEligibility({ body: b, labels }, { enabled: true, integrationModel: 'pr-first' }).keyFiles.length > 0);
  assert.strictEqual(extractKeyFileEntries(b), null);
  assert.deepStrictEqual(needsNoPlan({ labels, keyFiles: extractKeyFileEntries(b), body: b, policy: policy() }), { lane: null, reason: 'key-files-missing' });
});

test('AC6.2: grant and state labels (auto:merge-pending, auto:build, parked, bot:*) do not change the lane (Review Focus 4)', () => {
  const noise = ['auto:merge-pending', 'auto:build', 'auto:merge', 'parked', 'bot:parked', 'bot:blocked', 'bot:in-progress'];
  const offPol = policy({ 'express-driver': 'off' });
  for (const label of noise) {
    assert.deepStrictEqual(verdictFor({ labels: [...DRIVER_LABELS, label], keyFiles: DRIVER_FILES }),
      { lane: 'driver', reason: 'inside-driver-bounds' }, label);
    assert.deepStrictEqual(verdictFor({ labels: [...EXPRESS_LABELS, label], keyFiles: EXPRESS_FILES, pol: offPol }),
      { lane: 'express', reason: 'inside-express-bounds' }, label);
  }
});

test('AC3.1: a Key File under merge-sensitive-paths keeps the record out of the driver and express lanes', () => {
  const sensitive = { 'merge-sensitive-paths': ['plugin/bin/lib/plan-lane-fixture/**'] };
  assert.deepStrictEqual(verdictFor({ labels: EXPRESS_LABELS, keyFiles: EXPRESS_FILES, pol: policy(sensitive) }), { lane: null, reason: 'outside-every-lane' });
  assert.deepStrictEqual(verdictFor({ labels: EXPRESS_LABELS, keyFiles: EXPRESS_FILES, pol: policy({ ...sensitive, 'express-driver': 'off' }) }),
    { lane: null, reason: 'outside-every-lane' });
});

test('AC6.1: labels given as {name} objects read the same as strings', () => {
  const v = verdictFor({ labels: DRIVER_LABELS.map((name) => ({ name })), keyFiles: DRIVER_FILES });
  assert.deepStrictEqual(v, { lane: 'driver', reason: 'inside-driver-bounds' });
});

// The parity matrix: records on both sides of the driver bounds.
const NOISE = ['auto:merge-pending', 'parked', 'bot:blocked'];
const PARITY_RECORDS = [
  { name: 'low fast-lane 1 KF', labels: ['risk:low', 'size:low', 'ceremony:fast-lane', 'type:task'], files: backendFiles(1) },
  { name: 'low no-ceremony 1 KF', labels: ['risk:low', 'size:low', 'type:task'], files: backendFiles(1) },
  { name: 'medium no-ceremony 4 KF', labels: ['risk:low', 'size:medium', 'type:feature'], files: backendFiles(4) },
  { name: 'medium fast-lane 1 KF', labels: ['risk:low', 'size:medium', 'ceremony:fast-lane', 'type:bug'], files: backendFiles(1) },
  { name: 'low no-ceremony 4 KF', labels: ['risk:low', 'size:low', 'type:task'], files: backendFiles(4) },
  { name: 'medium 6 KF', labels: ['risk:low', 'size:medium', 'type:feature'], files: backendFiles(6) },
  { name: 'size high', labels: ['risk:low', 'size:high', 'type:feature'], files: backendFiles(1) },
  { name: 'ceremony standard', labels: ['risk:low', 'size:low', 'ceremony:standard', 'type:task'], files: backendFiles(1) },
  { name: 'risk high', labels: ['risk:high', 'size:low', 'ceremony:fast-lane', 'type:task'], files: backendFiles(1) },
  { name: 'protected path', labels: ['risk:low', 'size:low', 'type:task'], files: ['plugin/skills/_shared/x.md'] },
  { name: 'frontend surface', labels: ['risk:low', 'size:low', 'type:task'], files: backendFiles(1), opts: { surface: 'web' } },
  { name: 'no type label', labels: ['risk:low', 'size:low', 'ceremony:fast-lane'], files: backendFiles(1) },
  { name: 'kept risk flag', labels: ['risk:low', 'size:low', 'type:task'], files: backendFiles(1), opts: { riskFlags: 'Risk-flags: schema' } },
  { name: 'medium no-ceremony 4 KF with noise', labels: ['risk:low', 'size:medium', 'type:feature', ...NOISE], files: backendFiles(4) },
];

// Spec Deliverable 5: with grants, blockers and PRs neutralised, the predicate's driver verdict equals
// the bounds portion of eligibility + admission for the same record and policy, computed here from
// the real modules.
test('AC1.1 parity: the driver verdict equals eligibility + admission with grants, blockers and PRs neutralised', () => {
  const policies = {
    'review beyond-express': policy(),
    'review off': policy({ 'express-driver-review': 'off' }),
    'review on, split, low ceiling, 3 KF': policy({ 'express-driver-review': 'on', 'express-driver': 'split', 'express-driver-max-size': 'low', 'express-driver-max-key-files': 3 }),
  };
  const sides = { driver: 0, notDriver: 0 };
  for (const rec of PARITY_RECORDS) {
    for (const [polName, pol] of Object.entries(policies)) {
      const b = body(rec.files, rec.opts);
      const neutral = rec.labels.filter((l) => !/^(auto|bot):/.test(l) && l !== 'parked');
      const opts = eligibilityOptions(pol);
      const eligibility = evaluateRecordEligibility({ body: b, labels: neutral }, opts);
      const reviewer = reviewRequired({ issue: { labels: neutral }, keyFiles: eligibility.keyFiles, policyValue: pol['express-driver-review'].value });
      const admission = evaluateAdmission({
        state: 'OPEN', labels: neutral, openBlockerRefs: [], openLinkedPRs: [],
        routing: pol['express-driver'].value === 'split' ? 'on' : pol['express-driver'].value, driverEscalated: false,
        keyFiles: eligibility.keyFiles, bounds: { sizeCeiling: opts.sizeCeiling, maxKeyFiles: opts.maxKeyFiles },
        reviewerOn: reviewer.on, buildAuthority: 'typed',
      });
      const expected = eligibility.eligible && admission.admitted;
      const got = needsNoPlan({ labels: rec.labels, keyFiles: extractKeyFileEntries(b), body: b, policy: pol });
      assert.strictEqual(got.lane === 'driver', expected, `${rec.name} / ${polName}: ${JSON.stringify(got)}`);
      sides[expected ? 'driver' : 'notDriver'] += 1;
    }
  }
  assert.ok(sides.driver > 0 && sides.notDriver > 0, JSON.stringify(sides));
});

test('AC1.1 parity: the reviewer rule is load-bearing — beyond-express records with the reviewer off read not-driver', () => {
  const pol = policy({ 'express-driver-review': 'off' });
  assert.notStrictEqual(verdictFor({ labels: DRIVER_LABELS, keyFiles: DRIVER_FILES, pol }).lane, 'driver');
  assert.strictEqual(verdictFor({ labels: EXPRESS_LABELS, keyFiles: MICRO_FILES, pol }).lane, 'driver');
});

// The driver's real eligibility and admission steps, run with fake deps that neutralise only what the
// predicate neutralises (grants via a typed build authority, no blockers, no linked PR, OPEN, no
// escalation marker, express-driver on). A change in how a step calls the helpers (an option passed
// outside eligibilityOptions, say) moves only the step side, so this check goes red where the
// helper-composition parity above would not.
test('AC1.1 parity: the driver verdict equals the real eligibility and admission steps run on neutral facts', async () => {
  const step = (name) => STEPS.find((s) => s.name === name);
  const eligibility = step('eligibility');
  const admission = step('admission');
  assert.ok(eligibility && admission, 'STEPS names eligibility and admission');
  const deps = {
    evaluateRecordEligibility, reviewRequired, evaluateAdmission,
    ghBatch: () => { throw new Error('no forge read in this test'); },
    fetchNativeDependencies: ({ numbers }) => new Map(numbers.map((n) => [n, { blockedBy: [], openBlocker: false, openBlockerIds: [] }])),
    fetchLinkedPRs: ({ numbers }) => new Map(numbers.map((n) => [n, { openPR: null, mentions: [] }])),
    resolveBuildAuthority: () => ({ authority: 'typed', reasons: [] }),
    readTypedCommand: () => null,
    env: {},
    date: () => new Date(0),
    stdinIsTTY: false,
  };
  const policies = {
    'review beyond-express': policy(),
    'review off': policy({ 'express-driver-review': 'off' }),
    'review on, low ceiling, 3 KF': policy({ 'express-driver-review': 'on', 'express-driver-max-size': 'low', 'express-driver-max-key-files': 3 }),
  };
  const sides = { driver: 0, notDriver: 0 };
  for (const rec of PARITY_RECORDS) {
    for (const [polName, pol] of Object.entries(policies)) {
      const b = body(rec.files, rec.opts);
      const neutral = rec.labels.filter((l) => !/^(auto|bot):/.test(l) && l !== 'parked').map((name) => ({ name }));
      const ctx = {
        record: 7, named: false,
        issue: { number: 7, title: rec.name, body: b, labels: neutral, state: 'OPEN', comments: [] },
        shared: { policy: pol, repo: { host: 'github.com', owner: 'acme', repo: 'widgets' } },
      };
      const elig = await eligibility.run(ctx, deps);
      const adm = elig.status === 'ok' ? await admission.run(ctx, deps) : null;
      assert.notStrictEqual(elig.status, 'fail', `${rec.name} / ${polName}: eligibility step failed: ${elig.detail}`);
      if (adm) assert.notStrictEqual(adm.status, 'fail', `${rec.name} / ${polName}: admission step failed: ${adm.detail}`);
      const expected = elig.status === 'ok' && adm.status === 'ok';
      const got = needsNoPlan({ labels: rec.labels, keyFiles: extractKeyFileEntries(b), body: b, policy: pol });
      assert.strictEqual(got.lane === 'driver', expected, `${rec.name} / ${polName}: ${JSON.stringify(got)} vs steps ${elig.detail || 'ok'} / ${adm ? adm.detail || 'ok' : '-'}`);
      sides[expected ? 'driver' : 'notDriver'] += 1;
    }
  }
  assert.ok(sides.driver > 0 && sides.notDriver > 0, JSON.stringify(sides));
});

test('lane-bounds.js is the one eligibilityOptions: steps.js re-exports it, and plan-lane.js never loads steps.js', () => {
  assert.strictEqual(require(path.join(LIB, 'driver', 'steps.js')).eligibilityOptions, eligibilityOptions);
  const planLane = require.resolve(path.join(LIB, 'driver', 'plan-lane.js'));
  // A fresh process starts with an empty require cache, so whatever it holds after the require is what plan-lane.js loads.
  const loaded = JSON.parse(execFileSync(process.execPath, ['-e', `require(${JSON.stringify(planLane)}); process.stdout.write(JSON.stringify(Object.keys(require.cache)))`], { encoding: 'utf8', windowsHide: true }));
  assert.ok(loaded.includes(require.resolve(path.join(LIB, 'driver', 'lane-bounds.js'))), 'plan-lane.js loads lane-bounds.js');
  assert.ok(!loaded.includes(require.resolve(path.join(LIB, 'driver', 'steps.js'))), 'plan-lane.js must not load driver/steps.js');
});

test('a merge-sensitive-paths value that is neither a string nor a list of strings reads policy-unreadable', async (t) => {
  const run = (value) => verdictFor({ labels: EXPRESS_LABELS, keyFiles: EXPRESS_FILES, pol: policy({ 'merge-sensitive-paths': value }) });
  // Controls: a list, an empty string and a comma-separated string all read.
  assert.deepStrictEqual(run([]), { lane: 'driver', reason: 'inside-driver-bounds' });
  assert.deepStrictEqual(run(''), { lane: 'driver', reason: 'inside-driver-bounds' });
  assert.deepStrictEqual(run('docs/**, plugin/bin/lib/plan-lane-fixture/**'), { lane: null, reason: 'outside-every-lane' });
  for (const [name, value] of Object.entries({ null: null, number: 5, object: { a: 1 }, boolean: true, 'list with a number': [1], 'list with null': ['docs/**', null] })) {
    await t.test(name, () => assert.deepStrictEqual(run(value), { lane: null, reason: 'policy-unreadable' }));
  }
});

test('a Key Files entry that is not an object with a string path reads key-files-unreadable, never a throw', async (t) => {
  const b = body(MICRO_FILES);
  const pols = { 'all lanes on': policy(), 'micro-plan only': policy({ 'express-driver': 'off', 'express-lane': false }) };
  for (const [name, entries] of Object.entries({ null: [null], string: ['a.js'], 'numeric path': [{ path: 5 }], 'no path': [{ note: 'x' }], array: [['a.js']] })) {
    for (const [polName, pol] of Object.entries(pols)) {
      await t.test(`${name} / ${polName}`, () => {
        assert.deepStrictEqual(needsNoPlan({ labels: EXPRESS_LABELS, keyFiles: { entries, unparsed: 0 }, body: b, policy: pol }), { lane: null, reason: 'key-files-unreadable' });
      });
    }
  }
});
