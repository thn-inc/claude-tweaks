'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ACCEPTANCE_LABELS, LocalRecordError, localGateFacts,
} = require('../../../plugin/bin/lib/issues/local-parent-gate-shape');
const { evaluateParentGate } = require('../../../plugin/bin/lib/issues/parent-gate');
const { LABELS } = require('../../../plugin/bin/lib/issues/record-vocabulary');

// A record as local-store.js's queryRecords returns it (only the fields the mapping reads).
const record = (id, facets = {}, over = {}) => ({
  id, title: `Rec ${id}`, body: '', facets: { parent: null, closed: false, ...facets }, ...over,
});

// Parent 1 (is-parent-issue) with sub-issues 2 (closed, risk low) and 3 (open, risk medium),
// and 4, which names another parent.
const store = () => ({
  open: [record(1, { isParentIssue: true }, { body: 'Overview' }), record(3, { parent: 1, risk: 'medium' }), record(4, { parent: 9 })],
  closed: [record(2, { parent: 1, risk: 'low', closed: true })],
});

test('a parent maps to the gh gather facts shape', () => {
  assert.deepEqual(localGateFacts(store(), { parent: 1 }), {
    gate: {
      parent: 1,
      parentLabels: [LABELS.PARENT_ISSUE],
      subIssues: [
        { number: 3, title: 'Rec 3', state: 'OPEN', stateReason: '', labels: ['risk:medium'], closedBy: [] },
        { number: 2, title: 'Rec 2', state: 'CLOSED', stateReason: 'COMPLETED', labels: ['risk:low'], closedBy: [] },
      ],
    },
    idempotence: { state: 'OPEN', body: 'Overview' },
  });
});

test('a sub-issue resolves its parent facet; the same facts as from the parent', () => {
  assert.deepEqual(localGateFacts(store(), { subIssue: 3 }), localGateFacts(store(), { parent: 1 }));
});

test('not-planned, an unscored record and a closed parent', () => {
  const s = store();
  s.closed.push(record(5, { parent: 1, closed: true, notPlanned: true }));
  s.closed.push({ ...s.open.shift(), facets: { isParentIssue: true, parent: null, closed: true } });
  const { gate, idempotence } = localGateFacts(s, { parent: 1 });
  const five = gate.subIssues.find((x) => x.number === 5);
  assert.deepEqual([five.state, five.stateReason, five.labels], ['CLOSED', 'NOT_PLANNED', []]);
  assert.equal(idempotence.state, 'CLOSED');
});

test('the acceptance facet becomes its label; is-parent-issue only when true', () => {
  for (const [facet, label] of Object.entries(ACCEPTANCE_LABELS)) {
    const s = { open: [record(1, { acceptance: facet }), record(2, { parent: 1 })], closed: [] };
    assert.deepEqual(localGateFacts(s, { parent: 1 }).gate.parentLabels, [label], facet);
  }
  assert.deepEqual(ACCEPTANCE_LABELS, { pending: LABELS.ACCEPT_PENDING, approved: LABELS.ACCEPT_APPROVED, 'changes-requested': LABELS.ACCEPT_CHANGES_REQUESTED });
  const unknown = { open: [record(1, { acceptance: 'toString', isParentIssue: false })], closed: [] };
  assert.deepEqual(localGateFacts(unknown, { parent: 1 }).gate.parentLabels, []);
  // The labels gate as the gh path's would.
  const pending = { open: [record(1, { acceptance: 'pending', isParentIssue: true }), record(2, { parent: 1, risk: 'low', closed: true })], closed: [] };
  assert.equal(evaluateParentGate({ ...localGateFacts(pending, { parent: 1 }).gate, riskFloor: 'high' }).state, 'gated');
});

test('a record both scans return is kept once, as the closed scan read it', () => {
  const s = store();
  s.open.push(record(2, { parent: 1, risk: 'low', closed: false }));
  const subs = localGateFacts(s, { parent: 1 }).gate.subIssues;
  assert.deepEqual(subs.filter((x) => x.number === 2).map((x) => x.state), ['CLOSED']);
  assert.equal(subs.length, 2);
});

test('a sub-issue with no parent facet has no parent', () => {
  assert.deepEqual(localGateFacts(store(), { subIssue: 1 }), { gate: { parent: null, parentLabels: [], subIssues: [] }, idempotence: null });
});

test('an id the store lacks is a LocalRecordError of exit 1, naming the role', () => {
  const cases = [
    [{ subIssue: 99 }, 'sub-issue', 99],
    [{ parent: 99 }, 'parent', 99],
    [{ subIssue: 4 }, 'parent', 9],
  ];
  for (const [args, role, id] of cases) {
    assert.throws(() => localGateFacts(store(), args), (err) => {
      assert.ok(err instanceof LocalRecordError, JSON.stringify(args));
      assert.deepEqual([err.exit, err.role, err.id, err.message], [1, role, id, `${role} #${id} is not a record`]);
      return true;
    });
  }
  // An empty store (an absent records dir) holds no record.
  assert.throws(() => localGateFacts({ open: [], closed: [] }, { subIssue: 1 }), LocalRecordError);
});
