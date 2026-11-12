'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { ADMISSION_REASONS: R, evaluateAdmission } = require(path.join(LIB, 'driver', 'admission.js'));
const {
  partitionByOpenBodyBlockers, partitionByOpenNativeBlockers, openNativeBlockerRefs, partitionByOpenLinkedPR,
} = require(path.join(LIB, 'issues', 'record-dependencies.js'));

const ADMIT = { number: 5216, state: 'OPEN', labels: ['auto:build', 'ready'], openBlockerRefs: [], openLinkedPRs: [], routing: 'on' };
const reasonsFor = (overrides) => evaluateAdmission({ ...ADMIT, ...overrides }).reasons;

test('the base fact set admits', () => {
  assert.deepStrictEqual(evaluateAdmission(ADMIT), { admitted: true, reasons: [] });
});

test('AC3.1: no auto:build', () => {
  assert.deepStrictEqual(reasonsFor({ labels: ['ready'] }), [R.noBuildGrant]);
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
  ].sort());
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
  for (const r of [R.labelsUnreadable, R.blockerFactsUnreadable, R.prFactsUnreadable, R.stateUnreadable]) assert.ok(out.reasons.includes(r), r);
});
