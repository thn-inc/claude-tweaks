'use strict';
// Run-end residue convergence (#4620, control mode): every open ledger row and unfiled reflection
// insight ends in one terminal state — resolved, filed, digested or carried — or, when its carry
// itself throws, `failed` with the error, so nothing is ever silently dropped. Pure: `compose` and
// `carry` are injected; the caller (console-resolve.js --converge) writes the carried facts. Prose
// twin: skills/_shared/ledger-format.md's control-mode paragraph under `#### Ledger narrowing`.

const { validateShaped } = require('../compose-record/compose');
const { deferReasonProblem } = require('./reflect-destination');
const { specShapedBody, recordPayload, fencedBlock, defuse, LABELS } = require('../issues/record');
const { fingerprintFromBasis } = require('../health-core/fingerprint');
const { capWords, oneLine } = require('./finding-filing');
const { TERMINAL_STATUSES } = require('../wrap-up/ledger-write');

const RESIDUE_STATES = Object.freeze(['resolved', 'filed', 'digested', 'carried']);
const RESIDUE_FAILED = 'failed';

const TITLE_PREFIX = 'Run residue left open: ';
const TITLE_TEXT_MAX = 80;

// The `Key: value` header block before the first blank line, and the body after it.
function splitProposal(proposal) {
  const text = String(proposal);
  const at = text.indexOf('\n\n');
  const head = at < 0 ? text : text.slice(0, at);
  const body = at < 0 ? '' : text.slice(at + 2);
  const header = {};
  for (const line of head.split('\n')) {
    const m = /^([A-Za-z][A-Za-z-]*):[ \t]*(.*?)[ \t\r]*$/.exec(line);
    if (m && !Object.hasOwn(header, m[1].toLowerCase())) header[m[1].toLowerCase()] = m[2];
  }
  return { header, body };
}

// A proposal the filing route may stage: a spec-shaped body and a Defer-reason the deferral gate accepts.
function fileable(proposal) {
  if (typeof proposal !== 'string' || proposal.trim() === '') return false;
  const { header, body } = splitProposal(proposal);
  return validateShaped(body).ok && deferReasonProblem({ deferReason: header['defer-reason'] }) === null;
}

// The default `compose`: a staged-record proposal for one residue item. With no (or an unknown)
// deferReason the header carries none (or the unknown value), so the filing check fails and the item carries.
function composeResidueProposal(item) {
  const text = String(item.text);
  const reason = typeof item.deferReason === 'string' && item.deferReason !== '' ? item.deferReason : null;
  const gateOk = reason !== null && deferReasonProblem({ deferReason: reason }) === null;
  const origin = `run-end residue (${item.source === 'insight' ? 'reflection insight' : 'ledger row'} ${oneLine(String(item.id))})`;
  const title = `${TITLE_PREFIX}${capWords(oneLine(text), TITLE_TEXT_MAX)}`;
  const body = recordPayload({
    title,
    type: 'task',
    fingerprint: fingerprintFromBasis('runresidue', [item.source, oneLine(text)]),
    body: specShapedBody({
      provenance: gateOk ? { origin, deferReason: reason } : { origin },
      currentState: ['The run ended with this item still open. It follows.', fencedBlock(defuse(text))],
      deliverables: '- [ ] settle the item: fix it, or record why it no longer applies',
      acceptanceCriteria: '- [ ] the item is fixed and the fix is referenced here, or this record is closed with the reason it no longer applies',
      releaseNote: 'No user-visible change.',
      filedBy: 'wrap-up',
    }),
  }).body;
  const head = [`Title: ${title}`, 'Type: task', `Labels: ${LABELS.NEEDS_DEFINITION}`];
  if (reason !== null) head.push(`Defer-reason: ${oneLine(reason)}`);
  return `${head.join('\n')}\n\n${body}`;
}

// items: [{ id, source: 'ledger'|'insight', text, status, deferReason?, belowFloor?, filingFailed? }]
// -> [{ id, state, proposal?, fact?, error? }], one entry per item, in input order.
function convergeResidue(items, { compose, carry }) {
  return items.map((item) => {
    // Only the closed ledger vocabulary resolves an item; any other status is a failure naming it, never a silent drop.
    if (item.status !== 'open') {
      if (TERMINAL_STATUSES.includes(item.status)) return { id: item.id, state: 'resolved' };
      return { id: item.id, state: RESIDUE_FAILED, error: `unrecognized status '${item.status}' (expected open or one of ${TERMINAL_STATUSES.join(', ')})` };
    }
    if (item.belowFloor === true) return { id: item.id, state: 'digested' };
    if (item.filingFailed !== true) {
      let proposal = null;
      try { proposal = compose(item); } catch { proposal = null; }
      if (fileable(proposal)) return { id: item.id, state: 'filed', proposal };
    }
    try {
      return { id: item.id, state: 'carried', fact: carry(item) };
    } catch (err) {
      return { id: item.id, state: RESIDUE_FAILED, error: err && err.message ? err.message : String(err) };
    }
  });
}

module.exports = { RESIDUE_STATES, RESIDUE_FAILED, convergeResidue, composeResidueProposal };
