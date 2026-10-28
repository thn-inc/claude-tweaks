'use strict';
// tests/bin-lib/run-liveness/facts.test.js — #3977: the disposition facts
// gatherer maps every failed probe to the "cannot determine" value.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gatherFacts, prFact } = require('../../../plugin/bin/lib/run-liveness/facts');

const DAY = 24 * 60 * 60 * 1000;

function tmpRun(name = '2026-10-01T000000-record-5') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-facts-'));
  const dir = path.join(root, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir };
}

// A fake git: `answers` maps the joined argv to a result; anything else fails hard.
function fakeGit(answers) {
  return (args) => {
    const key = args.join(' ');
    if (key in answers) return answers[key];
    return { stdout: null, failure: 'git-error', exitCode: 128, stderr: 'fatal' };
  };
}
const OK = (stdout = '') => ({ stdout, failure: null });
const MISSING = { stdout: null, failure: 'git-error', exitCode: 1, stderr: '' };

test('prFact maps MERGED/CLOSED/OPEN/null', () => {
  assert.deepStrictEqual(prFact({ number: 3, state: 'MERGED' }), { pr: 'merged', prNumber: 3, prDraft: false });
  assert.deepStrictEqual(prFact({ number: 3, state: 'CLOSED' }), { pr: 'closed-unmerged', prNumber: 3, prDraft: false });
  assert.deepStrictEqual(prFact({ number: 3, state: 'OPEN', isDraft: true }), { pr: 'open', prNumber: 3, prDraft: true });
  assert.deepStrictEqual(prFact(null), { pr: 'none', prNumber: null, prDraft: null });
});

test('facts: a pr lookup failure maps to unknown', () => {
  for (const v of ['gh-absent', 'network-failure', 'pr-not-found', 'invalid-arguments', undefined, { state: 'WEIRD' }]) {
    assert.strictEqual(prFact(v).pr, 'unknown', String(v));
  }
});

test('prDraft true only when isDraft === true', () => {
  assert.strictEqual(prFact({ number: 1, state: 'OPEN', isDraft: 'true' }).prDraft, false);
  assert.strictEqual(prFact({ number: 1, state: 'OPEN' }).prDraft, false);
});

test('branch absent everywhere yields uniqueCommits 0', () => {
  const { root, dir } = tmpRun();
  const git = fakeGit({ 'rev-parse --verify --quiet refs/heads/b': MISSING, 'rev-parse --verify --quiet refs/remotes/origin/b': MISSING });
  const f = gatherFacts({ root, dir, state: {}, branch: 'b', integration: 'main', prState: null, deps: { git, listStaged: () => [] } });
  assert.deepStrictEqual(f.branch, { name: 'b', localExists: false, remoteExists: false, uniqueCommits: 0 });
});

test('a local branch counts its commits past origin/{integration}', () => {
  const { root, dir } = tmpRun();
  const git = fakeGit({
    'rev-parse --verify --quiet refs/heads/b': OK('abc\n'),
    'rev-parse --verify --quiet refs/remotes/origin/b': MISSING,
    'rev-parse --verify --quiet refs/remotes/origin/main': OK('def\n'),
    'rev-list --count refs/remotes/origin/main..refs/heads/b': OK('4\n'),
  });
  const f = gatherFacts({ root, dir, state: {}, branch: 'b', integration: 'main', prState: null, deps: { git, listStaged: () => [] } });
  assert.deepStrictEqual(f.branch, { name: 'b', localExists: true, remoteExists: false, uniqueCommits: 4 });
});

test('no origin integration ref falls back to the local integration branch', () => {
  const { root, dir } = tmpRun();
  const git = fakeGit({
    'rev-parse --verify --quiet refs/heads/b': OK('abc\n'),
    'rev-parse --verify --quiet refs/remotes/origin/b': MISSING,
    'rev-parse --verify --quiet refs/remotes/origin/main': MISSING,
    'rev-parse --verify --quiet refs/heads/main': OK('def\n'),
    'rev-list --count refs/heads/main..refs/heads/b': OK('2\n'),
  });
  const f = gatherFacts({ root, dir, state: {}, branch: 'b', integration: 'main', prState: null, deps: { git, listStaged: () => [] } });
  assert.strictEqual(f.branch.uniqueCommits, 2);
});

test('rev-list failure yields uniqueCommits null', () => {
  const { root, dir } = tmpRun();
  const git = fakeGit({ 'rev-parse --verify --quiet refs/heads/b': OK('abc'), 'rev-parse --verify --quiet refs/remotes/origin/b': OK('abc') });
  const f = gatherFacts({ root, dir, state: {}, branch: 'b', integration: 'main', prState: null, deps: { git, listStaged: () => [] } });
  assert.strictEqual(f.branch.uniqueCommits, null);
});

test('a ref probe that errors is null, not false', () => {
  const { root, dir } = tmpRun();
  const f = gatherFacts({ root, dir, state: {}, branch: 'b', integration: 'main', prState: null, deps: { git: fakeGit({}), listStaged: () => [] } });
  assert.deepStrictEqual(f.branch, { name: 'b', localExists: null, remoteExists: null, uniqueCommits: null });
});

test('no branch name yields every branch fact unknown', () => {
  const { root, dir } = tmpRun();
  const f = gatherFacts({ root, dir, state: {}, branch: null, prState: null, deps: { git: fakeGit({}), listStaged: () => [] } });
  assert.deepStrictEqual(f.branch, { name: null, localExists: null, remoteExists: null, uniqueCommits: null });
});

test('git status failure yields dirty null; clean and dirty read as booleans', () => {
  const { root, dir } = tmpRun();
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-facts-wt-'));
  const run = (answer) => gatherFacts({
    root, dir, state: { worktree: wt }, branch: null, prState: null,
    deps: { git: (args) => (args.join(' ') === '--no-optional-locks status --porcelain' ? answer : MISSING), listStaged: () => [] },
  }).worktree;
  assert.deepStrictEqual(run({ stdout: null, failure: 'git-error', exitCode: 128 }), { path: wt, exists: true, dirty: null });
  assert.deepStrictEqual(run(OK('')), { path: wt, exists: true, dirty: false });
  assert.deepStrictEqual(run(OK(' M a.js\n')), { path: wt, exists: true, dirty: true });
});

test('missing worktree path yields exists false', () => {
  const { root, dir } = tmpRun();
  const f = gatherFacts({ root, dir, state: { worktree: path.join(root, 'gone') }, prState: null, deps: { git: fakeGit({}), listStaged: () => [] } });
  assert.deepStrictEqual(f.worktree, { path: path.join(root, 'gone'), exists: false, dirty: false });
  const none = gatherFacts({ root, dir, state: {}, prState: null, deps: { git: fakeGit({}), listStaged: () => [] } });
  assert.deepStrictEqual(none.worktree, { path: null, exists: false, dirty: false });
});

test('staged lists top-level and spec-N entries (default lister)', () => {
  const { root, dir } = tmpRun();
  fs.mkdirSync(path.join(dir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'staged', 'review-unconfirmed-1.md'), 'x');
  fs.mkdirSync(path.join(dir, 'spec-2', 'staged'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'spec-2', 'staged', 'reflect-1.md'), 'x');
  const f = gatherFacts({ root, dir, state: {}, prState: null, deps: { git: fakeGit({}) } });
  assert.deepStrictEqual(f.staged, ['staged/review-unconfirmed-1.md', 'spec-2/staged/reflect-1.md']);
});

test('quietMs runs from the last own event; unreadable events log yields quietMs null', () => {
  const { root, dir } = tmpRun();
  const deps = { git: fakeGit({}), listStaged: () => [] };
  const now = Date.parse('2026-10-05T00:00:00Z');
  assert.strictEqual(gatherFacts({ root, dir, state: {}, prState: null, now, deps }).quietMs, null);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [
    JSON.stringify({ ts: '2026-10-03T00:00:00.000Z', type: 'commit' }),
    JSON.stringify({ ts: '2026-10-04T12:00:00.000Z', type: 'x', attribution: 'fallback' }),
  ].join('\n') + '\n');
  assert.strictEqual(gatherFacts({ root, dir, state: {}, prState: null, now, deps }).quietMs, 2 * DAY);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '');
  assert.strictEqual(gatherFacts({ root, dir, state: {}, prState: null, now, deps }).quietMs, now - Date.parse('2026-10-01T00:00:00Z'));
});

test('a throwing dep yields all-unknown facts', () => {
  const { root, dir } = tmpRun();
  const f = gatherFacts({ root, dir, state: {}, prState: { state: 'CLOSED', number: 2 }, deps: { git: fakeGit({}), listStaged: () => { throw new Error('boom'); } } });
  assert.strictEqual(f.pr, 'unknown');
  assert.strictEqual(f.staged, null);
  assert.strictEqual(f.worktree.dirty, null);
  assert.strictEqual(f.shape, 'formal');
});
