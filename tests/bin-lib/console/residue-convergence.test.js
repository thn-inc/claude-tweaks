'use strict';
// #4620: run-end residue convergence under control mode — every ledger row and reflection insight
// ends resolved, filed, digested or carried (or failed, loudly), never left open.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { convergeResidue, composeResidueProposal, RESIDUE_STATES, RESIDUE_FAILED } = require(path.join(LIB, 'console', 'residue-convergence'));
const { validateShaped } = require(path.join(LIB, 'compose-record', 'compose'));
const { deferReasonProblem } = require(path.join(LIB, 'console', 'reflect-destination'));

const items = [
  { id: 'ledger-1', source: 'ledger', text: 'fixed already', status: 'fixed' },
  { id: 'ledger-2', source: 'ledger', text: 'typo in a comment', status: 'open', deferReason: 'tangential', belowFloor: true },
  { id: 'ledger-3', source: 'ledger', text: 'locked worktree held by a live session', status: 'open', deferReason: 'blocked-external', belowFloor: false },
  { id: 'insight-4', source: 'insight', text: 'a convention to capture', status: 'open', belowFloor: false },
];
const carry = (it) => ({ id: `decision:console:${it.id}` });

test('the state vocabulary is the four terminal states, with failed outside it', () => {
  assert.deepStrictEqual(RESIDUE_STATES, ['resolved', 'filed', 'digested', 'carried']);
  assert.ok(Object.isFrozen(RESIDUE_STATES));
  assert.strictEqual(RESIDUE_FAILED, 'failed');
  assert.ok(!RESIDUE_STATES.includes(RESIDUE_FAILED));
});

test('AC2.1 AC2.2: every ledger row and insight ends resolved, filed, digested or carried — none left open', () => {
  const out = convergeResidue(items, { compose: composeResidueProposal, carry });
  assert.deepStrictEqual(out.map((o) => [o.id, o.state]), [['ledger-1', 'resolved'], ['ledger-2', 'digested'], ['ledger-3', 'filed'], ['insight-4', 'carried']]);
  assert.ok(out.every((o) => RESIDUE_STATES.includes(o.state)));
  assert.deepStrictEqual(out[3].fact, { id: 'decision:console:insight-4' });
  assert.strictEqual(out[0].proposal, undefined);
  assert.strictEqual(out[1].proposal, undefined);
});

test('AC3.1: a filed residue record is spec-shaped and its Defer-reason passes the deferral gate', () => {
  const filed = convergeResidue([items[2]], { compose: composeResidueProposal, carry })[0];
  assert.strictEqual(filed.state, 'filed');
  const [header, ...rest] = filed.proposal.split('\n\n');
  assert.deepStrictEqual(validateShaped(rest.join('\n\n')), { ok: true, gaps: [] });
  assert.strictEqual(deferReasonProblem({ deferReason: /^Defer-reason: (.+)$/m.exec(header)[1] }), null);
  assert.match(header, /^Title: .+\nType: task\nLabels: \S+\nDefer-reason: blocked-external$/);
  assert.ok(filed.proposal.includes('locked worktree held by a live session'), 'the body quotes the item text');
});

test('AC3.1 go-red: a proposal failing the shape check is never filed', () => {
  const bad = convergeResidue([items[2]], { compose: () => 'Title: x\nDefer-reason: blocked-external\n\nno sections', carry })[0];
  assert.strictEqual(bad.state, 'carried');
});

test('AC3.1 go-red: a spec-shaped proposal with no Defer-reason header is never filed', () => {
  const good = composeResidueProposal(items[2]);
  const noReason = good.replace(/^Defer-reason: .*\n/m, '');
  assert.notStrictEqual(noReason, good);
  assert.strictEqual(convergeResidue([items[2]], { compose: () => noReason, carry })[0].state, 'carried');
});

test('AC4.5: a gate rejection (unknown Defer-reason) carries the item as a decision fact', () => {
  const out = convergeResidue([{ ...items[2], deferReason: 'because' }], { compose: composeResidueProposal, carry });
  assert.deepStrictEqual(out, [{ id: 'ledger-3', state: 'carried', fact: { id: 'decision:console:ledger-3' } }]);
});

test('AC4.5: an item with no deferReason composes no Defer-reason header and carries', () => {
  assert.doesNotMatch(composeResidueProposal(items[3]), /^Defer-reason:/m);
  assert.strictEqual(convergeResidue([items[3]], { compose: composeResidueProposal, carry })[0].state, 'carried');
});

test('AC4.5: a stage or create failure seen by --converge (filingFailed) carries the item', () => {
  let composed = 0;
  const out = convergeResidue([{ ...items[2], filingFailed: true }], { compose: (it) => { composed += 1; return composeResidueProposal(it); }, carry });
  assert.deepStrictEqual(out, [{ id: 'ledger-3', state: 'carried', fact: { id: 'decision:console:ledger-3' } }]);
  assert.strictEqual(composed, 0, 'a filing that already failed is not composed again');
});

test('AC4.5: a compose that throws carries the item', () => {
  const out = convergeResidue([items[2]], { compose: () => { throw new Error('no body'); }, carry });
  assert.strictEqual(out[0].state, 'carried');
});

test('AC4.6: a failed carry reports failed with the error, never drops the item', () => {
  const out = convergeResidue([items[3]], { compose: composeResidueProposal, carry: () => { throw new Error('disk full'); } });
  assert.deepStrictEqual(out, [{ id: 'insight-4', state: 'failed', error: 'disk full' }]);
});

test('AC4.7: a below-floor item is digested and counts as terminal', () => {
  let carried = 0;
  const out = convergeResidue([items[1]], { compose: composeResidueProposal, carry: (it) => { carried += 1; return carry(it); } });
  assert.deepStrictEqual(out, [{ id: 'ledger-2', state: 'digested' }]);
  assert.ok(RESIDUE_STATES.includes('digested'));
  assert.strictEqual(carried, 0);
});

test('a non-open status resolves before the floor or filing is consulted', () => {
  const out = convergeResidue([{ ...items[1], status: 'accepted' }], { compose: composeResidueProposal, carry });
  assert.deepStrictEqual(out, [{ id: 'ledger-2', state: 'resolved' }]);
});

test('every input item appears exactly once', () => {
  const out = convergeResidue(items, { compose: composeResidueProposal, carry });
  assert.strictEqual(out.length, items.length);
  assert.deepStrictEqual(out.map((o) => o.id), items.map((i) => i.id));
});
