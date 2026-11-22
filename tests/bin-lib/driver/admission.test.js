'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { ADMISSION_REASONS: R, evaluateAdmission, reviewerGateReason, widenedReviewerReason, isReadableWidenedBy } = require(path.join(LIB, 'driver', 'admission.js'));
const { evaluateRecordEligibility } = require(path.join(LIB, 'express', 'eligibility.js'));
const { reviewRequired } = require(path.join(LIB, 'driver', 'review.js'));
const {
  partitionByOpenBodyBlockers, partitionByOpenNativeBlockers, openNativeBlockerRefs, partitionByOpenLinkedPR,
} = require(path.join(LIB, 'issues', 'record-dependencies.js'));

const { hasDriverEscalationMarker, DRIVER_ESCALATION_MARKER } = require(path.join(LIB, 'driver', 'settle.js'));

const ADMIT = {
  number: 5216, state: 'OPEN', labels: ['auto:build', 'ready', 'size:low'], openBlockerRefs: [], openLinkedPRs: [], routing: 'on', driverEscalated: false,
  keyFiles: ['a.js'], bounds: { sizeCeiling: 'low', maxKeyFiles: 3 }, reviewerOn: false,
};
const reasonsFor = (overrides) => evaluateAdmission({ ...ADMIT, ...overrides }).reasons;

test('the base fact set admits', () => {
  assert.deepStrictEqual(evaluateAdmission(ADMIT), { admitted: true, reasons: [] });
});

test('AC3.1: no auto:build', () => {
  assert.deepStrictEqual(reasonsFor({ labels: ['ready'] }), [R.noBuildGrant]);
});

test('AC8 (#5584): a ready record without auto:build is not refused for the grant only when buildAuthority is typed', () => {
  assert.deepStrictEqual(evaluateAdmission({ ...ADMIT, labels: ['ready', 'size:low'], buildAuthority: 'typed' }), { admitted: true, reasons: [] });
  for (const buildAuthority of ['none', undefined, 'label', 'yes', 'Typed', 'typed ', true, null]) {
    assert.deepStrictEqual(reasonsFor({ labels: ['ready', 'size:low'], buildAuthority }), [R.noBuildGrant], `buildAuthority=${JSON.stringify(buildAuthority)}`);
  }
  const absent = { ...ADMIT, labels: ['ready', 'size:low'] };
  assert.deepStrictEqual(evaluateAdmission(absent).reasons, [R.noBuildGrant]);
});

test('AC8/AC15 (#5584): a typed fact lifts only the grant gate; every other gate still runs', () => {
  assert.deepStrictEqual(reasonsFor({ labels: ['ready', 'parked'], buildAuthority: 'typed' }), [R.parked]);
  assert.deepStrictEqual(reasonsFor({ labels: ['ready', 'bot:parked'], buildAuthority: 'typed' }), [R.parked]);
  assert.deepStrictEqual(reasonsFor({ labels: ['ready', 'bot:blocked'], buildAuthority: 'typed' }), [R.blocked]);
  assert.deepStrictEqual(reasonsFor({ labels: ['ready'], buildAuthority: 'typed', state: 'CLOSED' }), [R.notOpen]);
  assert.deepStrictEqual(reasonsFor({ labels: 'ready', buildAuthority: 'typed' }), [R.labelsUnreadable]);
  // A labelled record reads the same whatever the fact says.
  for (const buildAuthority of ['typed', 'none', undefined]) {
    assert.deepStrictEqual(evaluateAdmission({ ...ADMIT, buildAuthority }), { admitted: true, reasons: [] });
  }
});

test('AC3.2: the parked stage label', () => {
  assert.deepStrictEqual(reasonsFor({ labels: ['auto:build', 'parked'] }), [R.parked]);
});

test('AC3.2: bot:parked', () => {
  assert.deepStrictEqual(reasonsFor({ labels: ['auto:build', 'ready', 'bot:parked'] }), [R.parked]);
});

test('AC3.3: bot:blocked', () => {
  assert.deepStrictEqual(reasonsFor({ labels: ['auto:build', 'ready', 'bot:blocked'] }), [R.blocked]);
});

test('AC3.4: an open blocker', () => {
  assert.deepStrictEqual(reasonsFor({ openBlockerRefs: [4816] }), [R.openBlocker]);
});

test('AC3.5: an open PR', () => {
  assert.deepStrictEqual(reasonsFor({ openLinkedPRs: [5247] }), [R.openPR]);
});

test('AC3.6: state CLOSED', () => {
  assert.deepStrictEqual(reasonsFor({ state: 'CLOSED' }), [R.notOpen]);
});

test('AC3.7: ADMISSION_REASONS exports exactly the documented keys', () => {
  assert.deepStrictEqual(Object.keys(R).sort(), [
    'noBuildGrant', 'parked', 'blocked', 'openBlocker', 'openPR', 'notOpen', 'blockerFactsUnreadable',
    'prFactsUnreadable', 'stateUnreadable', 'labelsUnreadable', 'routingOff', 'splitOdd', 'splitUnreadable', 'routingUnknown',
    'escalatedByDriver', 'commentsUnreadable', 'reviewerOff', 'reviewerUnreadable', 'boundsUnreadable', 'keyFilesUnreadable',
    'reviewerOffWidened', 'widenedUnreadable',
  ].sort());
  assert.strictEqual(R.reviewerOffWidened, 'record is admitted beyond low risk or fast-lane ceremony and the reviewer step is off for it');
  assert.strictEqual(R.widenedUnreadable, 'record widening facts unreadable');
  assert.ok(Object.isFrozen(R));
  assert.strictEqual(R.noBuildGrant, 'record lacks auto:build');
  assert.strictEqual(R.parked, 'record is parked');
  assert.strictEqual(R.blocked, 'record is blocked');
  assert.strictEqual(R.openBlocker, 'record has an open blocker');
  assert.strictEqual(R.openPR, 'record has an open PR');
  assert.strictEqual(R.notOpen, 'record is not open');
  assert.strictEqual(R.blockerFactsUnreadable, 'blocker facts unreadable');
  assert.strictEqual(R.prFactsUnreadable, 'open PR facts unreadable');
  assert.strictEqual(R.stateUnreadable, 'record state unreadable');
  assert.strictEqual(R.labelsUnreadable, 'record labels unreadable');
  assert.strictEqual(R.routingOff, 'express-driver is off');
  assert.strictEqual(R.splitOdd, 'express-driver split: issue number is odd');
  assert.strictEqual(R.splitUnreadable, 'express-driver split: issue number unreadable');
  assert.strictEqual(R.routingUnknown('both'), 'express-driver value not recognised: both');
  assert.strictEqual(R.escalatedByDriver, 'already escalated by the driver');
  assert.strictEqual(R.commentsUnreadable, 'record comments unreadable');
  assert.strictEqual(R.reviewerOff, 'record is beyond the express bounds and the reviewer step is off for it');
  assert.strictEqual(R.reviewerUnreadable, 'reviewer-on answer unreadable');
  assert.strictEqual(R.boundsUnreadable, 'lane bounds unreadable');
  assert.strictEqual(R.keyFilesUnreadable, 'record Key Files unreadable');
});

test('AC11.2: a trusted marker refuses with its own reason', () => {
  const result = evaluateAdmission({ ...ADMIT, driverEscalated: true });
  assert.deepStrictEqual(result, { admitted: false, reasons: ['already escalated by the driver'] });
});

test('AC11.3: an untrusted marker does not refuse', () => {
  const driverEscalated = hasDriverEscalationMarker([{ authorAssociation: 'NONE', body: DRIVER_ESCALATION_MARKER }]);
  assert.strictEqual(driverEscalated, false);
  assert.deepStrictEqual(evaluateAdmission({ ...ADMIT, driverEscalated }), { admitted: true, reasons: [] });
});

test('AC11.4: an unreadable comment list fails closed', () => {
  for (const driverEscalated of [null, undefined, 'true', 1, {}, []]) {
    assert.deepStrictEqual(reasonsFor({ driverEscalated }), ['record comments unreadable'], `driverEscalated=${JSON.stringify(driverEscalated)}`);
  }
});

test('AC11.5: the gate alone refuses', () => {
  assert.deepStrictEqual(reasonsFor({ driverEscalated: true }), [R.escalatedByDriver]);
  assert.ok(!reasonsFor({ driverEscalated: true }).includes(R.commentsUnreadable));
  assert.deepStrictEqual(reasonsFor({ driverEscalated: false }), []);
});

test('the escalation gate stacks with the existing gates in one verdict', () => {
  assert.deepStrictEqual(reasonsFor({ state: 'CLOSED', driverEscalated: true }), [R.notOpen, R.escalatedByDriver]);
});

test('labels unreadable fails closed with its own reason', () => {
  for (const labels of ['auto:build', { name: 'auto:build' }, null, undefined]) {
    let reasons;
    assert.doesNotThrow(() => { reasons = reasonsFor({ labels }); });
    assert.deepStrictEqual(reasons, [R.labelsUnreadable], `labels=${JSON.stringify(labels)}`);
  }
  assert.deepStrictEqual(reasonsFor({ labels: [] }), [R.noBuildGrant]);
});

test('Review Focus 1: ready and parked together still refuses as parked', () => {
  assert.deepStrictEqual(reasonsFor({ labels: ['auto:build', 'ready', 'parked'] }), [R.parked]);
});

test('Review Focus 3: lower-case or padded state is not open, not unreadable', () => {
  assert.deepStrictEqual(reasonsFor({ state: 'open' }), [R.notOpen]);
  assert.deepStrictEqual(reasonsFor({ state: 'OPEN ' }), [R.notOpen]);
});

test('Review Focus 4: gh label objects are accepted', () => {
  assert.deepStrictEqual(evaluateAdmission({ ...ADMIT, labels: [{ name: 'auto:build' }] }), { admitted: true, reasons: [] });
});

test('AC4.1: three failing gates yield all three reasons in one call', () => {
  const result = evaluateAdmission({ ...ADMIT, labels: ['ready', 'bot:blocked'], state: 'CLOSED' });
  assert.deepStrictEqual(result, { admitted: false, reasons: [R.noBuildGrant, R.blocked, R.notOpen] });
});

test('AC4.2: bot:blocked plus an open blocker yields both reasons', () => {
  assert.deepStrictEqual(reasonsFor({ labels: ['auto:build', 'ready', 'bot:blocked'], openBlockerRefs: [4816] }), [R.blocked, R.openBlocker]);
});

test('AC5.1 (blocker facts)', () => {
  for (const openBlockerRefs of [null, undefined, '4816']) {
    assert.deepStrictEqual(reasonsFor({ openBlockerRefs }), [R.blockerFactsUnreadable], `openBlockerRefs=${JSON.stringify(openBlockerRefs)}`);
  }
});

test('AC5.1 (open-PR facts)', () => {
  for (const openLinkedPRs of [null, undefined, '4816']) {
    assert.deepStrictEqual(reasonsFor({ openLinkedPRs }), [R.prFactsUnreadable], `openLinkedPRs=${JSON.stringify(openLinkedPRs)}`);
  }
});

test('AC5.1 (state)', () => {
  for (const state of [undefined, null, 5]) {
    assert.deepStrictEqual(reasonsFor({ state }), [R.stateUnreadable], `state=${JSON.stringify(state)}`);
  }
});

test('AC5.2: empty blocker and open-PR arrays mean none', () => {
  assert.deepStrictEqual(ADMIT.openBlockerRefs, []);
  assert.deepStrictEqual(ADMIT.openLinkedPRs, []);
  assert.deepStrictEqual(evaluateAdmission(ADMIT), { admitted: true, reasons: [] });
});

test('AC6.1: off refuses every record', () => {
  assert.deepStrictEqual(reasonsFor({ routing: 'off', number: 5216 }), [R.routingOff]);
  assert.deepStrictEqual(reasonsFor({ routing: 'off', number: 5217 }), [R.routingOff]);
});

test('AC6.2: split admits even, refuses odd', () => {
  assert.deepStrictEqual(evaluateAdmission({ ...ADMIT, routing: 'split', number: 5216 }), { admitted: true, reasons: [] });
  assert.deepStrictEqual(reasonsFor({ routing: 'split', number: 5217 }), [R.splitOdd]);
});

test('AC6.3: on admits both', () => {
  assert.deepStrictEqual(evaluateAdmission({ ...ADMIT, routing: 'on', number: 5216 }), { admitted: true, reasons: [] });
  assert.deepStrictEqual(evaluateAdmission({ ...ADMIT, routing: 'on', number: 5217 }), { admitted: true, reasons: [] });
});

test('AC6.4: an unrecognised routing value is refused by the template', () => {
  for (const routing of ['ON', undefined, null, 'both']) {
    const reasons = reasonsFor({ routing });
    assert.strictEqual(reasons.length, 1, `routing=${routing}`);
    assert.ok(reasons[0].startsWith('express-driver value not recognised: '), reasons[0]);
    assert.strictEqual(reasons[0], R.routingUnknown(routing));
  }
});

test('AC6.5: split with a missing or non-integer number', () => {
  for (const number of [undefined, '5216', 5216.5]) {
    assert.deepStrictEqual(reasonsFor({ routing: 'split', number }), [R.splitUnreadable], `number=${JSON.stringify(number)}`);
  }
});

test('Review Focus 5: only split reads the issue number', () => {
  assert.deepStrictEqual(evaluateAdmission({ ...ADMIT, routing: 'on', number: undefined }), { admitted: true, reasons: [] });
  assert.deepStrictEqual(reasonsFor({ routing: 'off', number: undefined }), [R.routingOff]);
});

// Parity (spec Technical Approach): admission never decides blocker or open-PR
// state itself — it is fed the real output of the shared predicates, in both
// work-links modes, and its verdict must agree with theirs.
const FOREIGN = 'other-owner/other-repo';
const HOME = 'thn-inc/claude-tweaks';
const BODY_FIXTURES = [
  { name: 'open local blocker', blocks: true, body: 'Blocked by #4816\n', openNumbers: new Set([4816]), foreign: [] },
  { name: 'open foreign blocker', blocks: true, body: '', openNumbers: new Set(), foreign: [{ repository: FOREIGN, number: 12, state: 'OPEN' }] },
  { name: 'foreign with unreadable state', blocks: true, body: '', openNumbers: new Set(), foreign: [{ repository: FOREIGN, number: 12, state: null }] },
  { name: 'closed blockers only', blocks: false, body: 'Blocked by #4816\n', openNumbers: new Set(), foreign: [{ repository: FOREIGN, number: 12, state: 'CLOSED' }] },
  { name: 'no blockers', blocks: false, body: 'No dependencies.\n', openNumbers: new Set(), foreign: [] },
];

test('parity body-text: admission\'s blocker verdict matches partitionByOpenBodyBlockers', () => {
  for (const f of BODY_FIXTURES) {
    const c = { number: 5216, body: f.body };
    const foreignByRecord = new Map(f.foreign.length ? [[5216, f.foreign]] : []);
    const { excluded } = partitionByOpenBodyBlockers([c], f.openNumbers, foreignByRecord);
    const openBlockerRefs = excluded[0]?.blockedBy ?? [];
    const inExcluded = excluded.some((e) => e.number === 5216);
    assert.strictEqual(inExcluded, f.blocks, `fixture verdict: ${f.name}`);
    const { reasons } = evaluateAdmission({ ...ADMIT, openBlockerRefs });
    assert.strictEqual(reasons.includes(R.openBlocker), inExcluded, f.name);
  }
});

const node = (blockedBy) => ({ number: 5216, repository: { nameWithOwner: HOME }, blockedBy: { nodes: blockedBy } });
const NATIVE_FIXTURES = [
  { name: 'open local blocker', blocks: true, node: node([{ number: 4816, state: 'OPEN', repository: { nameWithOwner: HOME } }]) },
  { name: 'open foreign blocker', blocks: true, node: node([{ number: 12, state: 'OPEN', repository: { nameWithOwner: FOREIGN } }]) },
  { name: 'foreign with unreadable state', blocks: true, node: node([{ number: 12, state: null, repository: { nameWithOwner: FOREIGN } }]) },
  { name: 'closed blockers only', blocks: false, node: node([
    { number: 4816, state: 'CLOSED', repository: { nameWithOwner: HOME } },
    { number: 12, state: 'CLOSED', repository: { nameWithOwner: FOREIGN } },
  ]) },
  { name: 'no blockers', blocks: false, node: node([]) },
];

test('parity native: admission\'s blocker verdict matches partitionByOpenNativeBlockers', () => {
  for (const f of NATIVE_FIXTURES) {
    const { excluded } = partitionByOpenNativeBlockers([{ number: 5216 }], { i5216: f.node });
    const inExcluded = excluded.some((e) => e.number === 5216);
    assert.strictEqual(inExcluded, f.blocks, `fixture verdict: ${f.name}`);
    const { reasons } = evaluateAdmission({ ...ADMIT, openBlockerRefs: openNativeBlockerRefs(f.node) });
    assert.strictEqual(reasons.includes(R.openBlocker), inExcluded, f.name);
  }
});

test('parity linked PR: admission\'s open-PR verdict matches partitionByOpenLinkedPR', () => {
  const repoData = {
    i5216: { number: 5216, closedByPullRequestsReferences: { nodes: [{ number: 5247, state: 'OPEN' }] } },
    i5217: { number: 5217, closedByPullRequestsReferences: { nodes: [{ number: 5250, state: 'MERGED' }] } },
  };
  const candidates = [{ number: 5216 }, { number: 5217 }];
  const { excludedByOpenPR } = partitionByOpenLinkedPR(candidates, repoData);
  assert.deepStrictEqual(excludedByOpenPR, [{ number: 5216, pr: 5247 }], 'only the OPEN PR excludes');
  for (const c of candidates) {
    const openLinkedPRs = excludedByOpenPR.filter((e) => e.number === c.number).map((e) => e.pr);
    const inExcluded = excludedByOpenPR.some((e) => e.number === c.number);
    const { reasons } = evaluateAdmission({ ...ADMIT, number: c.number, openLinkedPRs });
    assert.strictEqual(reasons.includes(R.openPR), inExcluded, `#${c.number}`);
  }
});

test('a null argument fails closed instead of throwing', () => {
  let out;
  assert.doesNotThrow(() => { out = evaluateAdmission(null); });
  assert.strictEqual(out.admitted, false);
  for (const r of [R.labelsUnreadable, R.blockerFactsUnreadable, R.prFactsUnreadable, R.stateUnreadable, R.commentsUnreadable]) assert.ok(out.reasons.includes(r), r);
});

// The reviewer rule (#5224). A spec-shaped record, built as eligibility.test.js's record()
// helper builds one: `Surface: backend` so no Key File reads as a frontend, no ceremony label
// (the driver lane passes allowAbsentCeremony).
function record({ size = 'low', risk = 'low', keyFileCount = 2 } = {}) {
  const keyFiles = Array.from({ length: keyFileCount }, (_, i) => `lib/k${i}.js`);
  const body = [
    'Surface: backend', '',
    '## Current State', '', 'The module lacks a check.', '',
    '## Deliverables', '', '- Add the check.', '',
    '## Acceptance Criteria', '', '- The check runs.', '',
    '## Release Note', '', 'Adds a check.', '',
    '## Technical Approach', '',
    '### Key Files', '',
    ...keyFiles.map((p) => `- \`${p}\` (modify)`),
    '',
  ].join('\n');
  const labels = ['auto:build', 'ready', `risk:${risk}`, 'type:feature', ...(size ? [`size:${size}`] : [])];
  return { number: 5216, body, labels };
}

// laneVerdict mirrors steps.js's composition: eligibility (stops the record) then admission.
function laneVerdict(issue, { sizeCeiling = 'low', maxKeyFiles = 3, review = 'beyond-express' } = {}) {
  const el = evaluateRecordEligibility(issue, { enabled: true, allowAbsentCeremony: true, integrationModel: 'pr-first', sensitivePaths: [], sizeCeiling, maxKeyFiles });
  const reviewer = reviewRequired({ issue, keyFiles: el.keyFiles, policyValue: review });
  const facts = { labels: issue.labels, keyFiles: el.keyFiles, bounds: { sizeCeiling, maxKeyFiles }, reviewerOn: reviewer.on };
  if (!el.eligible) {
    const extra = reviewerGateReason(facts);
    return { admitted: false, reasons: extra ? [...el.reasons, extra] : el.reasons };
  }
  return evaluateAdmission({ ...ADMIT, ...facts });
}

const REVIEW_VALUES = ['off', 'beyond-express', 'on'];

test('AC2.1/AC2.2 (#5224): with every key unset the lane verdict equals today\'s rules (hand-written table)', () => {
  // Written by hand from the express rules before #5224, not computed by the code under test.
  const EXPECTED = {
    'low|0': ['no Key Files'],
    'low|1': [],
    'low|2': [],
    'low|3': [],
    'low|4': ['more than 3 Key Files'],
    'low|5': ['more than 3 Key Files'],
    'medium|0': ['size is not low', 'no Key Files'],
    'medium|1': ['size is not low'],
    'medium|2': ['size is not low'],
    'medium|3': ['size is not low'],
    'medium|4': ['size is not low', 'more than 3 Key Files'],
    'medium|5': ['size is not low', 'more than 3 Key Files'],
    'high|0': ['size is not low', 'no Key Files'],
    'high|1': ['size is not low'],
    'high|2': ['size is not low'],
    'high|3': ['size is not low'],
    'high|4': ['size is not low', 'more than 3 Key Files'],
    'high|5': ['size is not low', 'more than 3 Key Files'],
    'absent|0': ['size is not low', 'no Key Files'],
    'absent|1': ['size is not low'],
    'absent|2': ['size is not low'],
    'absent|3': ['size is not low'],
    'absent|4': ['size is not low', 'more than 3 Key Files'],
    'absent|5': ['size is not low', 'more than 3 Key Files'],
  };
  let rows = 0;
  for (const size of ['low', 'medium', 'high', 'absent']) {
    for (let count = 0; count <= 5; count += 1) {
      const key = `${size}|${count}`;
      const issue = record({ size: size === 'absent' ? null : size, keyFileCount: count });
      for (const review of REVIEW_VALUES) {
        const verdict = laneVerdict(issue, { review });
        assert.deepStrictEqual(verdict.reasons, EXPECTED[key], `${key} review=${review}`);
        assert.strictEqual(verdict.admitted, EXPECTED[key].length === 0, `${key} review=${review}`);
        rows += 1;
      }
    }
  }
  assert.strictEqual(rows, 72);
});

const WIDE = { sizeCeiling: 'medium', maxKeyFiles: 5 };

test('AC3.1 (#5224): widened, size:medium with 4 Key Files is admitted with the reviewer on or default, refused with it off', () => {
  const issue = record({ size: 'medium', keyFileCount: 4 });
  assert.deepStrictEqual(laneVerdict(issue, { ...WIDE, review: 'on' }), { admitted: true, reasons: [] });
  assert.deepStrictEqual(laneVerdict(issue, { ...WIDE, review: 'beyond-express' }), { admitted: true, reasons: [] });
  assert.deepStrictEqual(laneVerdict(issue, { ...WIDE, review: 'off' }), { admitted: false, reasons: [R.reviewerOff] });
});

test('AC3.2 (#5224): widened, size:low with 4 Key Files takes the same two outcomes', () => {
  const issue = record({ size: 'low', keyFileCount: 4 });
  assert.deepStrictEqual(laneVerdict(issue, { ...WIDE, review: 'on' }), { admitted: true, reasons: [] });
  assert.deepStrictEqual(laneVerdict(issue, { ...WIDE, review: 'beyond-express' }), { admitted: true, reasons: [] });
  assert.deepStrictEqual(laneVerdict(issue, { ...WIDE, review: 'off' }), { admitted: false, reasons: [R.reviewerOff] });
});

test('(#5224) widened, size:medium with at most 3 Key Files is beyond the express bounds by its size alone', () => {
  for (const keyFileCount of [1, 3]) {
    const issue = record({ size: 'medium', keyFileCount });
    assert.deepStrictEqual(laneVerdict(issue, { ...WIDE, review: 'beyond-express' }), { admitted: true, reasons: [] }, `${keyFileCount}`);
    assert.deepStrictEqual(laneVerdict(issue, { ...WIDE, review: 'off' }), { admitted: false, reasons: [R.reviewerOff] }, `${keyFileCount}`);
  }
});

test('AC3.5 (#5224): a record inside the express bounds is admitted the same with the reviewer on or off', () => {
  const issue = record({ size: 'low', keyFileCount: 2 });
  for (const review of REVIEW_VALUES) {
    assert.deepStrictEqual(laneVerdict(issue, { ...WIDE, review }), { admitted: true, reasons: [] }, `review=${review}`);
  }
});

test('AC3.6/AC3.7 (#5224): failing an eligibility bound and the reviewer condition reports eligibility reasons only, outside the driver bounds', () => {
  const issue = record({ size: 'medium', keyFileCount: 6 });
  assert.deepStrictEqual(laneVerdict(issue, { ...WIDE, review: 'off' }), { admitted: false, reasons: ['more than 5 Key Files'] });
});

test('AC3.6 (#5224, Plan Review Clarification): inside the driver bounds, another eligibility failure is followed by the reviewer reason', () => {
  const beyond = record({ risk: 'medium', size: 'medium', keyFileCount: 4 });
  assert.deepStrictEqual(laneVerdict(beyond, { ...WIDE, review: 'off' }).reasons, ['risk is not low', R.reviewerOff]);
  for (const review of ['on', 'beyond-express']) {
    assert.deepStrictEqual(laneVerdict(beyond, { ...WIDE, review }).reasons, ['risk is not low'], `review=${review}`);
  }
  const inside = record({ risk: 'medium', size: 'low', keyFileCount: 2 });
  assert.deepStrictEqual(laneVerdict(inside, { ...WIDE, review: 'off' }).reasons, ['risk is not low']);
});

test('(#5224) reviewerGateReason returns null on unreadable input', () => {
  const facts = { labels: ['size:medium'], keyFiles: ['a.js', 'b.js', 'c.js', 'd.js'], bounds: WIDE, reviewerOn: false };
  assert.strictEqual(reviewerGateReason(facts), R.reviewerOff, 'the readable base refuses');
  assert.strictEqual(reviewerGateReason({ ...facts, labels: null }), null);
  assert.strictEqual(reviewerGateReason({ ...facts, keyFiles: null }), null);
  assert.strictEqual(reviewerGateReason({ ...facts, bounds: { sizeCeiling: 'high', maxKeyFiles: 3 } }), null);
  assert.strictEqual(reviewerGateReason({ ...facts, reviewerOn: 'false' }), null);
  assert.strictEqual(reviewerGateReason(null), null);
});

test('AC6.2 (#5224): a missing or non-boolean reviewer-on answer refuses', () => {
  for (const v of [undefined, null, 'true', 1, {}]) {
    assert.ok(reasonsFor({ reviewerOn: v }).includes(R.reviewerUnreadable), `reviewerOn=${JSON.stringify(v)}`);
  }
  assert.deepStrictEqual(evaluateAdmission({ ...ADMIT, reviewerOn: true }), { admitted: true, reasons: [] });
});

test('AC6.2 (#5224): missing or malformed bounds refuse', () => {
  for (const b of [
    undefined, null, {}, { sizeCeiling: 'high', maxKeyFiles: 3 }, { sizeCeiling: 'low', maxKeyFiles: 0 }, { sizeCeiling: 'low', maxKeyFiles: '3' },
    { sizeCeiling: 'toString', maxKeyFiles: 3 }, { sizeCeiling: 'low', maxKeyFiles: 3.5 },
  ]) {
    assert.ok(reasonsFor({ bounds: b }).includes(R.boundsUnreadable), `bounds=${JSON.stringify(b)}`);
  }
  for (const keyFiles of [null, undefined, 'a.js']) {
    assert.ok(reasonsFor({ keyFiles }).includes(R.keyFilesUnreadable), `keyFiles=${JSON.stringify(keyFiles)}`);
  }
});

test('Review Focus 2 (#5224): a limit below the express limit narrows', () => {
  const three = record({ size: 'low', keyFileCount: 3 });
  for (const review of REVIEW_VALUES) {
    assert.deepStrictEqual(laneVerdict(three, { maxKeyFiles: 2, review }).reasons, ['more than 2 Key Files'], `review=${review}`);
  }
  assert.deepStrictEqual(laneVerdict(record({ size: 'low', keyFileCount: 2 }), { maxKeyFiles: 2, review: 'beyond-express' }), { admitted: true, reasons: [] });
});

test('AC1.1 (#6018): widenedBy absent and widenedBy [] give the base verdicts', () => {
  const fixtures = [
    {}, { labels: ['ready'] }, { labels: ['auto:build', 'parked'] }, { labels: ['auto:build', 'ready', 'bot:blocked'] },
    { openBlockerRefs: [4816] }, { openLinkedPRs: [5247] }, { state: 'CLOSED' }, { driverEscalated: true },
    { routing: 'off' }, { reviewerOn: 'yes' }, { labels: ['auto:build', 'ready', 'size:medium'], reviewerOn: false },
    { labels: ['auto:build', 'ready', 'size:medium'], reviewerOn: true, bounds: { sizeCeiling: 'medium', maxKeyFiles: 3 } },
    { bounds: null }, { keyFiles: 'a.js' }, { labels: 'ready' },
  ];
  for (const overrides of fixtures) {
    const facts = { ...ADMIT, ...overrides };
    assert.deepStrictEqual(evaluateAdmission({ ...facts, widenedBy: [] }), evaluateAdmission(facts), JSON.stringify(overrides));
    assert.deepStrictEqual(evaluateAdmission({ ...facts, widenedBy: undefined }), evaluateAdmission(facts), JSON.stringify(overrides));
  }
});

test('AC3.1 (#6018): a widened record with the reviewer off is refused with the widened reason', () => {
  assert.deepStrictEqual(reasonsFor({ widenedBy: ['risk'], reviewerOn: false }), [R.reviewerOffWidened]);
  assert.deepStrictEqual(reasonsFor({ widenedBy: ['ceremony'], reviewerOn: false }), [R.reviewerOffWidened]);
  assert.deepStrictEqual(reasonsFor({ widenedBy: ['risk', 'ceremony'], reviewerOn: false }), [R.reviewerOffWidened]);
  assert.deepStrictEqual(evaluateAdmission({ ...ADMIT, widenedBy: ['risk'], reviewerOn: true }), { admitted: true, reasons: [] });
  assert.deepStrictEqual(evaluateAdmission({ ...ADMIT, widenedBy: [], reviewerOn: false }), { admitted: true, reasons: [] });
  // A non-boolean reviewerOn is the unreadable reason alone, not also the widened refusal.
  assert.deepStrictEqual(reasonsFor({ widenedBy: ['risk'], reviewerOn: null }), [R.reviewerUnreadable]);
  // Both rules apply to a beyond-express widened record with the reviewer off, in push order.
  assert.deepStrictEqual(reasonsFor({ labels: ['auto:build', 'ready', 'size:medium'], bounds: { sizeCeiling: 'medium', maxKeyFiles: 3 }, widenedBy: ['risk'], reviewerOn: false }), [R.reviewerOff, R.reviewerOffWidened]);
});

test('widenedBy unreadable refuses with its own reason (#6018)', () => {
  for (const widenedBy of ['risk', null, {}, 3, true, ['risk', 1], [null]]) {
    assert.deepStrictEqual(reasonsFor({ widenedBy }), [R.widenedUnreadable], JSON.stringify(widenedBy));
  }
  assert.ok(evaluateAdmission({ ...ADMIT, widenedBy: 'risk', reviewerOn: false }).reasons.includes(R.widenedUnreadable));
});

test('widenedReviewerReason is the widened rule alone (#6018)', () => {
  assert.strictEqual(widenedReviewerReason({ widenedBy: ['risk'], reviewerOn: false }), R.reviewerOffWidened);
  assert.strictEqual(widenedReviewerReason({ widenedBy: ['risk'], reviewerOn: true }), null);
  assert.strictEqual(widenedReviewerReason({ widenedBy: [], reviewerOn: false }), null);
  assert.strictEqual(widenedReviewerReason({ widenedBy: undefined, reviewerOn: false }), null);
  assert.strictEqual(widenedReviewerReason({ reviewerOn: false }), null);
  assert.strictEqual(widenedReviewerReason({ widenedBy: ['risk'], reviewerOn: null }), null);
  for (const widenedBy of ['risk', null, {}, ['risk', 1], [null]]) {
    assert.strictEqual(widenedReviewerReason({ widenedBy, reviewerOn: true }), R.widenedUnreadable, JSON.stringify(widenedBy));
  }
  assert.strictEqual(widenedReviewerReason(null), null);
  assert.strictEqual(widenedReviewerReason(undefined), null);
  assert.strictEqual(isReadableWidenedBy(['risk', 'ceremony']), true);
  assert.strictEqual(isReadableWidenedBy([1]), false);
});
