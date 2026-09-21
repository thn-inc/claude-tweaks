'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { guardReleasableTree, pushAfterAncestryCheck } = require('../../../plugin/bin/lib/release/run.js');

test('guardReleasableTree: branch and clean-tree checks, parameterized by branch', () => {
  const calls = [];
  const deps = { git: (a) => { calls.push(a.join(' ')); return a[0] === 'branch' ? 'develop\n' : ''; } };
  assert.throws(() => guardReleasableTree(deps, { branch: 'main' }), /releases run from main; current branch is "develop"/);
  guardReleasableTree(deps, { branch: 'develop' });
  const dirty = { git: (a) => (a[0] === 'branch' ? 'main\n' : ' M x.js\n') };
  assert.throws(() => guardReleasableTree(dirty, { branch: 'main' }), /tracked modifications/);
});

test('pushAfterAncestryCheck: fetch → ancestry → push of every ref; divergence throws the caller\'s message and pushes nothing', () => {
  const calls = [];
  const ok = { git: (a) => { calls.push(a.join(' ')); return ''; } };
  pushAfterAncestryCheck(ok, { branch: 'main', refs: ['main', 'v1.3.0'], onDiverged: 'moved' });
  assert.deepStrictEqual(calls, ['fetch origin main', 'merge-base --is-ancestor origin/main HEAD', 'push origin main v1.3.0']);
  const diverged = { git: (a) => { if (a[0] === 'merge-base') throw new Error('no'); calls.push(`d:${a[0]}`); return ''; } };
  assert.throws(() => pushAfterAncestryCheck(diverged, { branch: 'main', refs: ['main'], onDiverged: 'origin moved — recover by hand' }), /origin moved — recover by hand/);
  assert.ok(!calls.includes('d:push'));
});

// #2254 F6: a branch that is not on origin yet has no origin/<branch> to fetch or
// compare against — the fetch would die with "couldn't find remote ref".
test('pushAfterAncestryCheck: remoteBranchExists:false pushes without the fetch or the ancestry check', () => {
  const calls = [];
  const deps = { git: (a) => { calls.push(a.join(' ')); return ''; } };
  pushAfterAncestryCheck(deps, { branch: 'main', refs: ['main', 'v1.3.0'], remoteBranchExists: false, onDiverged: 'moved' });
  assert.deepStrictEqual(calls, ['push origin main v1.3.0']);
});
