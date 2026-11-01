// bin/lib/issues/local-parent-gate-shape.js
// Maps the record store (bin/lib/issues/local-store.js) onto the facts shape
// bin/lib/issues/parent-gate.js's gh gather returns, so `evaluateParentGate` and
// `evaluateIdempotence` run over one shape on the local-files backend too (#4603).
// Consumer: `bin/parent-gate.js --backend local-files`. Pure, no I/O: the CLI runs
// the two store scans and hands their records in; this file is the
// mcp-parent-gate-shape.js of the record store.
//
// The mapping: a record's `parent` facet is its parent; `closed`/`not-planned` give a
// sub-issue's state (OPEN, or CLOSED with COMPLETED or NOT_PLANNED); the `risk`,
// `is-parent-issue` and `acceptance` facets stand in for the labels the gh path reads
// (`risk:{tier}`, `parent-issue`, `acceptance:*`). Closing PRs are unknown to the
// store, so every `closedBy` is []. The store is read in two scans, open then closed;
// a record both return (closed between them) is kept once, as the later closed scan
// read it.
'use strict';

const { LABELS } = require('./record-vocabulary');

// A record's `acceptance` facet, as the label the gate reads it from.
const ACCEPTANCE_LABELS = {
  pending: LABELS.ACCEPT_PENDING,
  approved: LABELS.ACCEPT_APPROVED,
  'changes-requested': LABELS.ACCEPT_CHANGES_REQUESTED,
};

// A sub-issue or parent id the store does not hold. `exit` is the CLI's code for it (1:
// the invocation names a record that does not exist); `role` is 'sub-issue' or 'parent'.
class LocalRecordError extends Error {
  constructor(role, id) {
    super(`${role} #${id} is not a record`);
    this.name = 'LocalRecordError';
    this.exit = 1;
    this.role = role;
    this.id = id;
  }
}

// A record's facets -> the gh-shaped stateReason: '' while open, else COMPLETED or NOT_PLANNED.
function stateReasonOf(facets) {
  if (!facets.closed) return '';
  return facets.notPlanned ? 'NOT_PLANNED' : 'COMPLETED';
}

// The open scan's and the closed scan's records -> one record per id, the closed scan's winning.
function recordsById({ open = [], closed = [] } = {}) {
  return new Map([...open, ...closed].map((record) => [record.id, record]));
}

// { open, closed } store records + { subIssue | parent } -> { gate, idempotence }.
//   gate         { parent, parentLabels, subIssues: [{ number, title, state, stateReason, labels, closedBy }] }
//                (with no parent facet, { parent: null, parentLabels: [], subIssues: [] }).
//   idempotence  { state, body } of the parent, for evaluateIdempotence's `source: 'body'`;
//                null with no parent.
// Throws LocalRecordError for a sub-issue in hand, or a parent it or --parent names, that the store lacks.
function localGateFacts(records, { subIssue = null, parent = null } = {}) {
  const byId = recordsById(records);
  let parentId = parent;
  if (parentId === null) {
    const sub = byId.get(subIssue);
    if (!sub) throw new LocalRecordError('sub-issue', subIssue);
    parentId = sub.facets.parent;
  }
  if (parentId === null || parentId === undefined) {
    return { gate: { parent: null, parentLabels: [], subIssues: [] }, idempotence: null };
  }
  const parentRecord = byId.get(parentId);
  if (!parentRecord) throw new LocalRecordError('parent', parentId);

  const parentLabels = [];
  if (parentRecord.facets.isParentIssue === true) parentLabels.push(LABELS.PARENT_ISSUE);
  const { acceptance } = parentRecord.facets;
  if (Object.prototype.hasOwnProperty.call(ACCEPTANCE_LABELS, acceptance)) parentLabels.push(ACCEPTANCE_LABELS[acceptance]);
  const subIssues = [...byId.values()].filter((r) => r.facets.parent === parentId).map((r) => ({
    number: r.id,
    title: r.title,
    state: r.facets.closed ? 'CLOSED' : 'OPEN',
    stateReason: stateReasonOf(r.facets),
    labels: r.facets.risk ? [`risk:${r.facets.risk}`] : [],
    closedBy: [],
  }));
  return {
    gate: { parent: parentId, parentLabels, subIssues },
    idempotence: { state: parentRecord.facets.closed ? 'CLOSED' : 'OPEN', body: parentRecord.body },
  };
}

module.exports = {
  ACCEPTANCE_LABELS, LocalRecordError, localGateFacts,
};
