'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { POLICY_KEYS, PLAN_LANE_REASONS: R, needsNoPlan } = require(path.join(LIB, 'driver', 'plan-lane.js'));
const { extractKeyFileEntries } = require(path.join(LIB, 'issues', 'grouping.js'));
const { evaluateRecordEligibility, widenings } = require(path.join(LIB, 'express', 'eligibility.js'));
const { evaluateAdmission } = require(path.join(LIB, 'driver', 'admission.js'));
const { reviewRequired } = require(path.join(LIB, 'driver', 'review.js'));
const { eligibilityOptions } = require(path.join(LIB, 'driver', 'lane-bounds.js'));
const { STEPS } = require(path.join(LIB, 'driver', 'steps.js'));
const { resolvePolicyKeys } = require(path.join(LIB, 'policy-schema.js'));

// The real resolver's reply for protected-paths (a hand-written one would drift from the schema).
const protectedPathsReply = (policyRaw) => resolvePolicyKeys(['protected-paths'], { policyRaw })['protected-paths'];

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
  'express-driver-max-risk': 'low',
  'express-driver-review': 'beyond-express',
  'express-driver-protected-paths': 'refuse',
  'express-lane': true,
  'integration-model': 'pr-first',
  'merge-sensitive-paths': [],
};
// resolve-policy's shape: { key: { value, source } }; protected-paths is the real unset reply unless overridden.
function policy(overrides = {}) {
  const values = { ...POLICY_DEFAULTS, ...overrides };
  return {
    'protected-paths': protectedPathsReply(''),
    ...Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value, source: 'policy' }])),
  };
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
    'express-driver', 'express-driver-max-size', 'express-driver-max-key-files', 'express-driver-max-risk', 'express-driver-review',
    'express-driver-protected-paths', 'express-lane', 'integration-model', 'merge-sensitive-paths', 'protected-paths',
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

test('AC2.1: three implementation Key Files pass the micro-plan gate (#5463 AC2.1)', () => {
  const v = verdictFor({ labels: EXPRESS_LABELS, keyFiles: backendFiles(3), pol: policy({ 'express-lane': false, 'express-driver': 'off' }) });
  assert.deepStrictEqual(v, { lane: 'micro-plan', reason: 'passes-micro-plan-gate' });
});

test('AC2.1: four implementation Key Files fail the micro-plan gate (#5463 AC2.1)', () => {
  const v = verdictFor({ labels: EXPRESS_LABELS, keyFiles: backendFiles(4), pol: policy({ 'express-lane': false, 'express-driver': 'off' }) });
  assert.deepStrictEqual(v, { lane: null, reason: 'outside-every-lane' });
});

test('AC2.1: a kept risk flag keeps a record that passes every other micro-plan condition out of the micro-plan lane', () => {
  const pol = policy({ 'express-lane': false, 'express-driver': 'off' });
  const v = verdictFor({ labels: EXPRESS_LABELS, keyFiles: MICRO_FILES, opts: { riskFlags: 'Risk-flags: auth' }, pol });
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
    'max-risk huge': policy({ 'express-driver-max-risk': 'huge' }),
    'max-risk toString': policy({ 'express-driver-max-risk': 'toString' }),
    'express-driver sometimes': policy({ 'express-driver': 'sometimes' }),
    'express-driver-review maybe': policy({ 'express-driver-review': 'maybe' }),
    'protected-paths Reviewer': policy({ 'express-driver-protected-paths': 'Reviewer' }),
    'protected-paths invalid: true': { ...policy(), 'express-driver-protected-paths': { value: 'refuse', source: 'default', invalid: true } },
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
  // #6018's two keys, the same way.
  cases['max-risk invalid: true on a valid default'] = { ...policy(), 'express-driver-max-risk': { value: 'low', source: 'default', invalid: true } };
  cases['max-risk error field'] = { ...policy(), 'express-driver-max-risk': { value: 'medium', source: 'policy', error: 'bad value' } };
  cases['review invalid: true on a valid default'] = { ...policy(), 'express-driver-review': { value: 'beyond-express', source: 'default', invalid: true } };
  cases['review error field'] = { ...policy(), 'express-driver-review': { value: 'on', source: 'policy', error: 'bad value' } };
  for (const [name, pol] of Object.entries(cases)) {
    await t.test(name, () => assert.deepStrictEqual(run(pol), unreadable));
  }
});

test('every schema value of the three enum policy keys reads as readable policy', async (t) => {
  // plan-lane.js keeps its own copy of each key's values; a value the schema gains that the copy
  // lacks would read every record policy-unreadable, so each schema value is pinned here.
  const { POLICY_KEYS: SCHEMA } = require(path.join(LIB, 'policy-schema.js'));
  const b = body(DRIVER_FILES);
  const keyFiles = extractKeyFileEntries(b);
  for (const key of ['express-driver', 'express-driver-review', 'express-driver-protected-paths']) {
    const values = SCHEMA.find((k) => k.key === key).values;
    assert.ok(Array.isArray(values) && values.length > 0, `${key} has schema values`);
    for (const value of values) {
      await t.test(`${key}: ${value}`, () => {
        const v = needsNoPlan({ labels: DRIVER_LABELS, keyFiles, body: b, policy: policy({ [key]: value }) });
        assert.notStrictEqual(v.reason, 'policy-unreadable');
      });
    }
  }
});

test('#6019: a merge-time protected Key File reads driver only under reviewer with the reviewer on', () => {
  const hookFiles = ['plugin/hooks/x.js'];
  const labels = ['risk:low', 'size:low', 'ceremony:fast-lane', 'type:task'];
  const read = (pol, files = hookFiles) => verdictFor({ labels, keyFiles: files, pol: policy({ 'express-driver-review': 'on', 'express-lane': false, ...pol }) }).lane;
  assert.strictEqual(read({ 'express-driver-protected-paths': 'reviewer' }), 'driver');
  assert.notStrictEqual(read({ 'express-driver-protected-paths': 'reviewer', 'express-driver-review': 'off' }), 'driver');
  assert.notStrictEqual(read({ 'express-driver-protected-paths': 'refuse' }), 'driver');
  assert.notStrictEqual(read({ 'express-driver-protected-paths': 'reviewer' }, ['.github/workflows/ci.yml']), 'driver');
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
  // Two implementation files now pass the micro-plan gate (#5463), which reads no merge-sensitive paths: the record falls through to micro-plan, never driver or express.
  assert.deepStrictEqual(verdictFor({ labels: EXPRESS_LABELS, keyFiles: EXPRESS_FILES, pol: policy(sensitive) }), { lane: 'micro-plan', reason: 'passes-micro-plan-gate' });
  assert.deepStrictEqual(verdictFor({ labels: EXPRESS_LABELS, keyFiles: EXPRESS_FILES, pol: policy({ ...sensitive, 'express-driver': 'off' }) }),
    { lane: 'micro-plan', reason: 'passes-micro-plan-gate' });
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
  // `schema` above is not a built-in category, so that row reads as unreadable; this one is a readable kept flag.
  { name: 'kept built-in risk flag', labels: ['risk:low', 'size:low', 'type:task'], files: backendFiles(1), opts: { riskFlags: 'Risk-flags: migrations' } },
  { name: 'medium no-ceremony 4 KF with noise', labels: ['risk:low', 'size:medium', 'type:feature', ...NOISE], files: backendFiles(4) },
  // #6018's widenings: risk above low, and a recognised ceremony other than fast-lane.
  { name: 'risk medium fast-lane 1 KF', labels: ['risk:medium', 'size:low', 'ceremony:fast-lane', 'type:task'], files: backendFiles(1) },
  { name: 'risk medium no-ceremony 4 KF', labels: ['risk:medium', 'size:medium', 'type:feature'], files: backendFiles(4) },
  { name: 'risk high no-ceremony 1 KF', labels: ['risk:high', 'size:low', 'type:task'], files: backendFiles(1) },
  { name: 'ceremony standard medium 4 KF', labels: ['risk:low', 'size:medium', 'ceremony:standard', 'type:feature'], files: backendFiles(4) },
  { name: 'stray ceremony beside standard', labels: ['risk:low', 'size:low', 'ceremony:standard', 'ceremony:fastlane', 'type:task'], files: backendFiles(1) },
];

// The policies both parity tests run every record under: the reviewer's three values, and #6018's risk
// ceiling and ceremony widening under each reviewer value that changes what they admit.
const PARITY_POLICIES = {
  'review beyond-express': policy(),
  'review off': policy({ 'express-driver-review': 'off' }),
  'review on, split, low ceiling, 3 KF': policy({ 'express-driver-review': 'on', 'express-driver': 'split', 'express-driver-max-size': 'low', 'express-driver-max-key-files': 3 }),
  'review on, max-risk high': policy({ 'express-driver-review': 'on', 'express-driver-max-risk': 'high' }),
  'review beyond-express, max-risk medium': policy({ 'express-driver-max-risk': 'medium' }),
  'review off, max-risk high': policy({ 'express-driver-review': 'off', 'express-driver-max-risk': 'high' }),
};

// Spec Deliverable 5: with grants, blockers and PRs neutralised, the predicate's driver verdict equals
// the bounds portion of eligibility + admission for the same record and policy, computed here from
// the real modules.
test('AC1.1 parity: the driver verdict equals eligibility + admission with grants, blockers and PRs neutralised', () => {
  const sides = { driver: 0, notDriver: 0 };
  for (const rec of PARITY_RECORDS) {
    for (const [polName, pol] of Object.entries(PARITY_POLICIES)) {
      const b = body(rec.files, rec.opts);
      const neutral = rec.labels.filter((l) => !/^(auto|bot):/.test(l) && l !== 'parked');
      const opts = eligibilityOptions(pol);
      const eligibility = evaluateRecordEligibility({ body: b, labels: neutral }, opts);
      // As steps.js's eligibility step computes it: an eligible record's widenings, none for a refused one.
      const widenedBy = eligibility.eligible ? widenings({ labels: neutral, riskCeiling: opts.riskCeiling, anyCeremony: opts.allowAnyCeremony }) : [];
      const reviewer = reviewRequired({ issue: { labels: neutral }, keyFiles: eligibility.keyFiles, policyValue: pol['express-driver-review'].value, widenedBy });
      const admission = evaluateAdmission({
        state: 'OPEN', labels: neutral, openBlockerRefs: [], openLinkedPRs: [],
        routing: pol['express-driver'].value === 'split' ? 'on' : pol['express-driver'].value, driverEscalated: false,
        keyFiles: eligibility.keyFiles, bounds: { sizeCeiling: opts.sizeCeiling, maxKeyFiles: opts.maxKeyFiles },
        reviewerOn: reviewer.on, widenedBy, buildAuthority: 'typed',
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

// #6018: the driver's risk ceiling is `express-driver-max-risk`, read through eligibilityOptions.
test('#6018: a record above express-driver-max-risk does not read driver; at or below it, it does', () => {
  const medium = ['risk:medium', 'size:medium', 'type:feature'];
  const high = ['risk:high', 'size:medium', 'type:feature'];
  const at = (labels, ceiling) => verdictFor({ labels, keyFiles: DRIVER_FILES, pol: policy({ 'express-driver-max-risk': ceiling }) }).lane;
  assert.notStrictEqual(at(medium, 'low'), 'driver');
  assert.notStrictEqual(at(high, 'medium'), 'driver');
  assert.strictEqual(at(medium, 'medium'), 'driver');
  assert.strictEqual(at(high, 'high'), 'driver');
});

// #6018: a risk-widened record is admitted only with the reviewer on, so `express-driver-review: off`
// refuses it at admission (reviewerOffWidened) even though eligibility passes it.
test('#6018: a risk-widened record with express-driver-review off does not read driver', () => {
  const labels = ['risk:medium', 'size:low', 'ceremony:fast-lane', 'type:task'];
  const pol = policy({ 'express-driver-max-risk': 'medium', 'express-driver-review': 'off', 'express-lane': false });
  assert.notStrictEqual(verdictFor({ labels, keyFiles: EXPRESS_FILES, pol }).lane, 'driver');
  // Control: the same record with the reviewer on reads driver.
  assert.strictEqual(verdictFor({ labels, keyFiles: EXPRESS_FILES, pol: policy({ 'express-driver-max-risk': 'medium', 'express-driver-review': 'on' }) }).lane, 'driver');
});

// #6018: `express-driver-review: on` admits any recognised ceremony:* tier; off and beyond-express do not.
test('#6018: a ceremony:standard record in bounds reads driver only with express-driver-review on', () => {
  const labels = ['risk:low', 'size:medium', 'ceremony:standard', 'type:feature'];
  const at = (review) => verdictFor({ labels, keyFiles: DRIVER_FILES, pol: policy({ 'express-driver-review': review }) });
  assert.deepStrictEqual(at('on'), { lane: 'driver', reason: 'inside-driver-bounds' });
  assert.notStrictEqual(at('off').lane, 'driver');
  assert.notStrictEqual(at('beyond-express').lane, 'driver');
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
  // The real admission step reads routing from the policy itself, so split's parity would refuse
  // record 7; `on` stands in for it here, as needsNoPlan reads split.
  const policies = Object.fromEntries(Object.entries(PARITY_POLICIES)
    .map(([name, pol]) => [name, { ...pol, 'express-driver': { value: 'on', source: 'policy' } }]));
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
  // The comma-separated string reads and the sensitive path keeps the record out of driver and express; it then passes the micro-plan gate (#5463).
  assert.deepStrictEqual(run('docs/**, plugin/bin/lib/plan-lane-fixture/**'), { lane: 'micro-plan', reason: 'passes-micro-plan-gate' });
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

test('#6020 AC5: a malformed protected-paths applies the shipped list in the plan lane', () => {
  const read = (reply) => verdictFor({ labels: EXPRESS_LABELS, keyFiles: ['plugin/hooks/x.js'], pol: { ...policy(), 'protected-paths': reply } });
  const unset = read(protectedPathsReply(''));
  assert.notStrictEqual(unset.lane, 'driver');
  assert.notStrictEqual(unset.lane, 'express');
  const invalidReply = protectedPathsReply('protected-paths: ["infra/**"]\n');
  assert.strictEqual(invalidReply.invalid, true);
  for (const reply of [invalidReply, { value: 5, source: 'policy' }]) {
    const v = read(reply);
    assert.notStrictEqual(v.reason, 'policy-unreadable');
    assert.deepStrictEqual(v, unset);
  }
  assert.deepStrictEqual(read({ error: 'unknown-key' }), { lane: null, reason: 'policy-unreadable' });
  assert.deepStrictEqual(read({ value: 'infra/**', source: 'policy', error: 'x' }), { lane: null, reason: 'policy-unreadable' });
});

test('#6020: a resolved protected-paths list decides the driver and express lanes', () => {
  const read = (reply, files) => verdictFor({ labels: EXPRESS_LABELS, keyFiles: files, pol: { ...policy(), 'protected-paths': reply } }).lane;
  const set = { value: 'infra/**', source: 'policy' };
  const not = (lane) => lane !== 'driver' && lane !== 'express';
  assert.ok(not(read(protectedPathsReply(''), ['plugin/hooks/x.js'])));
  assert.ok(!not(read(set, ['plugin/hooks/x.js'])));
  assert.ok(not(read(set, ['infra/main.tf'])));
});
