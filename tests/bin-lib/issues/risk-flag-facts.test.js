'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { riskFlagEntries } = require('../../../plugin/bin/lib/issues/risk-flag-facts');

test('flag entries carry unconfirmed only when marked, proof entries their neutralized text', () => {
  const r = riskFlagEntries('Risk-flags: auth, migrations\nRisk-flags-unconfirmed: true\n\n## O\n', '### Task 1: x\n\nProof(auth): An unauthenticated request [still](x) returns 401.\n');
  assert.deepStrictEqual(r.flags, [{ id: 'migrations', unconfirmed: true }, { id: 'auth', unconfirmed: true }]);
  assert.deepStrictEqual(r.proofs.map((p) => p.id), ['auth']);
  assert.match(r.proofs[0].text, /\\\[still\\\]/);
});

test('a flag set without the marker carries no unconfirmed key at all', () => {
  const r = riskFlagEntries('Risk-flags: auth\n', null);
  assert.deepStrictEqual(r.flags, [{ id: 'auth' }]);
  const explicitFalse = riskFlagEntries('Risk-flags: auth\nRisk-flags-unconfirmed: false\n', null);
  assert.deepStrictEqual(explicitFalse.flags, [{ id: 'auth' }]);
});

test('an unclassified or clean record produces no entries', () => {
  assert.deepStrictEqual(riskFlagEntries('Surface: x\n', ''), { status: 'unclassified', flags: [], proofs: [] });
  assert.deepStrictEqual(riskFlagEntries('Risk-flags: none\n', ''), { status: 'ok', flags: [], proofs: [] });
});

test('an unknown line produces an entry per widened flag, each saying the line is unreadable', () => {
  const r = riskFlagEntries('Risk-flags: Bad\n', null);
  assert.strictEqual(r.status, 'unknown');
  assert.strictEqual(r.flags.length, 4);
  assert.ok(r.flags.every((f) => f.text === 'unreadable flag line'));
});

test('an ok line never carries the unreadable text, and a policy extra is read as a kept flag', () => {
  const ok = riskFlagEntries('Risk-flags: auth\n', null);
  assert.ok(ok.flags.every((f) => !('text' in f)));
  assert.deepStrictEqual(riskFlagEntries('Risk-flags: pii\n', null, { extraCategories: ['pii'] }).flags, [{ id: 'pii' }]);
  assert.strictEqual(riskFlagEntries('Risk-flags: pii\n', null).status, 'unknown');
});

test('a too-short proof, a fenced proof and no plan give no proof entry', () => {
  assert.deepStrictEqual(riskFlagEntries('Risk-flags: auth\n', '### Task 1: x\n\nProof(auth): short\n').proofs, []);
  assert.deepStrictEqual(riskFlagEntries('Risk-flags: auth\n', '### Task 1: x\n\n```\nProof(auth): An unauthenticated request still returns 401.\n```\n').proofs, []);
  assert.deepStrictEqual(riskFlagEntries('Risk-flags: auth\n', null).proofs, []);
});

test('the first substantive proof per slug wins, a proof for an unflagged slug is ignored', () => {
  const plan = [
    '### Task 1: x', '', 'Proof(auth): short', 'Proof(auth): The first long enough proof for the auth route.', '',
    '### Task 2: y', '', 'Proof(auth): The second long enough proof for the auth route.',
    'Proof(migrations): A migration proof for a slug the record never flagged.', '',
  ].join('\n');
  const r = riskFlagEntries('Risk-flags: auth\n', plan);
  assert.deepStrictEqual(r.proofs, [{ id: 'auth', text: 'The first long enough proof for the auth route.' }]);
});

test('an unknown line asks a proof for every widened flag', () => {
  const plan = '### Task 1: x\n\nProof(migrations): Applying the migration twice leaves the schema unchanged.\n';
  const r = riskFlagEntries('Risk-flags: Bad\n', plan);
  assert.deepStrictEqual(r.proofs.map((p) => p.id), ['migrations']);
  assert.strictEqual(r.flags.length, 4);
});
