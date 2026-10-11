'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { verifyCommits, OUTCOMES } = require('../../../plugin/bin/lib/docs-health/commit-ref');
const { git, tmpDir, makeOriginRepo, cloneOf, makeAmbiguousRepo } = require('./commit-fixtures');

const outcomeOf = (result, input) => result.commits.find((c) => c.input === input).outcome;

test('OUTCOMES lists exactly the six outcome strings', () => {
  assert.deepStrictEqual([...OUTCOMES], [
    'reachable', 'exists-unreachable', 'not-found', 'unverifiable', 'ambiguous', 'invalid',
  ]);
});

test('full clone: reachable, exists-unreachable, not-found against origin/HEAD', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin);
  const missing = '0000000000000000000000000000000000000000';
  const r = verifyCommits({ root: dir, hashes: [origin.root, origin.sideOnly.slice(0, 9), missing] });
  assert.strictEqual(r.integrationBranch, 'main');
  assert.strictEqual(r.integrationRef, 'refs/remotes/origin/main');
  assert.strictEqual(r.shallow.initial, false);
  assert.deepStrictEqual(r.commits, [
    { input: origin.root, outcome: 'reachable', sha: origin.root },
    { input: origin.sideOnly.slice(0, 9), outcome: 'exists-unreachable', sha: origin.sideOnly },
    { input: missing, outcome: 'not-found' },
  ]);
});

test('repo with no remote falls back to refs/heads/<integration-branch>', () => {
  const origin = makeOriginRepo();
  const r = verifyCommits({ root: origin.dir, hashes: [origin.third], integrationBranch: 'main' });
  assert.strictEqual(r.integrationRef, 'refs/heads/main');
  assert.strictEqual(outcomeOf(r, origin.third), 'reachable');
});

test('uppercase input classifies like lowercase', () => {
  const origin = makeOriginRepo();
  const upper = origin.second.slice(0, 10).toUpperCase();
  const r = verifyCommits({ root: origin.dir, hashes: [upper], integrationBranch: 'main' });
  assert.deepStrictEqual(r.commits, [{ input: upper, outcome: 'reachable', sha: origin.second }]);
});

test('ambiguous abbreviated hash is its own outcome, listing every candidate', () => {
  const amb = makeAmbiguousRepo();
  const r = verifyCommits({ root: amb.dir, hashes: [amb.prefix], integrationBranch: 'main' });
  assert.deepStrictEqual(r.commits, [
    { input: amb.prefix, outcome: 'ambiguous', candidates: amb.candidates },
  ]);
});

test('invalid inputs keep their outcome and input order is preserved', () => {
  const origin = makeOriginRepo();
  const r = verifyCommits({
    root: origin.dir, hashes: ['xyz', origin.root, 'abc', '-evil'], integrationBranch: 'main',
  });
  assert.deepStrictEqual(r.commits.map((c) => [c.input, c.outcome]), [
    ['xyz', 'invalid'], [origin.root, 'reachable'], ['abc', 'invalid'], ['-evil', 'invalid'],
  ]);
});

test('shallow clone is deepened over every branch head, then classified', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  assert.strictEqual(git(dir, ['rev-parse', '--is-shallow-repository']).trim(), 'true');
  const r = verifyCommits({ root: dir, hashes: [origin.root, origin.sideOnly] });
  assert.strictEqual(r.shallow.initial, true);
  assert.strictEqual(r.shallow.deepened, true);
  assert.deepStrictEqual(r.commits.map((c) => c.outcome), ['reachable', 'exists-unreachable']);
  assert.strictEqual(git(dir, ['rev-parse', '--is-shallow-repository']).trim(), 'false');
});

test('deepen failure: shallow view never yields reachable or not-found', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  git(dir, ['remote', 'set-url', 'origin', `file://${tmpDir('gone')}/missing`]);
  const missing = '1111111111111111111111111111111111111111';
  // origin.third is the clone's tip, so it IS present in the shallow view.
  const r = verifyCommits({ root: dir, hashes: [origin.third, origin.root, missing, 'nothex'] });
  assert.strictEqual(r.shallow.deepened, false);
  assert.ok(r.shallow.error, 'the fetch failure is reported');
  assert.deepStrictEqual(r.commits.map((c) => c.outcome),
    ['unverifiable', 'unverifiable', 'unverifiable', 'invalid']);
  for (const c of r.commits.slice(0, 3)) assert.match(c.reason, /shallow/);
});

test('deepen disabled: shallow clone returns unverifiable without fetching', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const r = verifyCommits({ root: dir, hashes: [origin.third], deepen: false });
  assert.deepStrictEqual(r.commits.map((c) => c.outcome), ['unverifiable']);
  assert.strictEqual(git(dir, ['rev-parse', '--is-shallow-repository']).trim(), 'true');
});

test('unresolvable integration branch yields unverifiable', () => {
  const origin = makeOriginRepo();
  const r = verifyCommits({ root: origin.dir, hashes: [origin.root], integrationBranch: 'nope' });
  assert.strictEqual(outcomeOf(r, origin.root), 'unverifiable');
  assert.strictEqual(r.integrationRef, null);
});

test('rejects option-shaped names without invoking git on them', () => {
  const calls = [];
  const fakeGit = (args) => { calls.push(args); throw new Error(`unexpected ${args.join(' ')}`); };
  for (const opts of [{ integrationBranch: '-evil' }, { remote: '--upload-pack=x' }]) {
    const r = verifyCommits({ root: '/nowhere', hashes: ['abcd'], git: fakeGit, ...opts });
    assert.strictEqual(r.commits[0].outcome, 'unverifiable');
    assert.match(r.commits[0].reason, /invalid (remote|integration branch) name/);
  }
  assert.deepStrictEqual(calls, []);
});

test('not a git repository yields unverifiable, never a throw', () => {
  const r = verifyCommits({ root: tmpDir('plain'), hashes: ['abcd'], integrationBranch: 'main' });
  assert.strictEqual(r.commits[0].outcome, 'unverifiable');
});

test('an input one character longer than a full sha1 hash classifies invalid, not reachable', () => {
  const origin = makeOriginRepo();
  const over = `${origin.root}0`;
  const r = verifyCommits({ root: origin.dir, hashes: [over], integrationBranch: 'main' });
  assert.strictEqual(outcomeOf(r, over), 'invalid');
});

test('an annotated tag object hash is peeled to its commit and classified, not not-found', () => {
  const origin = makeOriginRepo();
  const r = verifyCommits({
    root: origin.dir, hashes: [origin.annotatedTag.slice(0, 10)], integrationBranch: 'main',
  });
  assert.deepStrictEqual(r.commits, [
    { input: origin.annotatedTag.slice(0, 10), outcome: 'reachable', sha: origin.second },
  ]);
});

test('verifyCommits throws a clear TypeError on a non-array hashes value', () => {
  const origin = makeOriginRepo();
  assert.throws(
    () => verifyCommits({ root: origin.dir, hashes: 'abcd', integrationBranch: 'main' }),
    /verifyCommits: hashes must be an array, got string/,
  );
});
