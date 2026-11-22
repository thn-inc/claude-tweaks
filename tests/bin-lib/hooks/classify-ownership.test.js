'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { classifyOwnership } = require('../../../plugin/bin/lib/hooks/context');
const { gitRepo, linkedWorktreeOf } = require('../../helpers/git-fixtures');

test('foreign: both session ids present and different, regardless of cwd/binding', () => {
  const main = gitRepo();
  assert.strictEqual(
    classifyOwnership({ sessionId: 'session-a', cwd: main }, { sessionId: 'session-b' }),
    'foreign',
  );
});

test('foreign on distinct ids even when the caller sits inside the recorded worktree', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  assert.strictEqual(
    classifyOwnership({ sessionId: 'session-a', cwd: wt }, { sessionId: 'session-b', worktree: wt }),
    'foreign',
  );
});

test('indeterminate: caller cwd missing or empty', () => {
  assert.strictEqual(classifyOwnership({ sessionId: 's', cwd: '' }, { sessionId: 's' }), 'indeterminate');
  assert.strictEqual(classifyOwnership({ sessionId: 's' }, { sessionId: 's' }), 'indeterminate');
});

test('mine: equal ids, caller cwd inside the recorded worktree (subdirectory)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const sub = path.join(wt, 'nested');
  fs.mkdirSync(sub, { recursive: true });
  assert.strictEqual(
    classifyOwnership({ sessionId: 's', cwd: sub }, { sessionId: 's', worktree: wt }),
    'mine',
  );
});

test('foreign: equal ids, caller in a DIFFERENT live worktree than the binding — the #965 incident shape', () => {
  const main = gitRepo();
  const wtA = linkedWorktreeOf(main);
  const wtB = linkedWorktreeOf(main);
  assert.strictEqual(
    classifyOwnership({ sessionId: 's', cwd: wtA }, { sessionId: 's', worktree: wtB }),
    'foreign',
  );
});

test('foreign: owner id missing, binding recorded, caller in a different live worktree', () => {
  const main = gitRepo();
  const wtA = linkedWorktreeOf(main);
  const wtB = linkedWorktreeOf(main);
  assert.strictEqual(
    classifyOwnership({ sessionId: 's', cwd: wtA }, { worktree: wtB }),
    'foreign',
  );
});

test('mine: owner id missing, binding recorded, caller cwd inside the binding — binding match outranks incomplete identity', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  assert.strictEqual(
    classifyOwnership({ sessionId: 's', cwd: wt }, { worktree: wt }),
    'mine',
  );
});

test('indeterminate: equal ids, binding recorded, caller in the main checkout', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  assert.strictEqual(
    classifyOwnership({ sessionId: 's', cwd: main }, { sessionId: 's', worktree: wt }),
    'indeterminate',
  );
});

test('indeterminate: recorded worktree deleted from disk — fail-open, never foreign', () => {
  const main = gitRepo();
  const wtA = linkedWorktreeOf(main);
  const wtGone = linkedWorktreeOf(main);
  fs.rmSync(wtGone, { recursive: true, force: true });
  assert.strictEqual(
    classifyOwnership({ sessionId: 's', cwd: wtA }, { sessionId: 's', worktree: wtGone }),
    'indeterminate',
  );
});

test('indeterminate: caller cwd in a non-git directory, binding recorded', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const nonGit = scratchDir('ct-clown-nongit-');
  assert.strictEqual(
    classifyOwnership({ sessionId: 's', cwd: nonGit }, { sessionId: 's', worktree: wt }),
    'indeterminate',
  );
});

test('mine: caller cwd given as a symlink to the recorded worktree', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const link = path.join(scratchDir('ct-clown-link-'), 'wt-link');
  fs.symlinkSync(wt, link);
  assert.strictEqual(
    classifyOwnership({ sessionId: 's', cwd: link }, { sessionId: 's', worktree: wt }),
    'mine',
  );
});

test('mine: both ids present and equal, no binding, caller in the main checkout', () => {
  const main = gitRepo();
  assert.strictEqual(
    classifyOwnership({ sessionId: 's', cwd: main }, { sessionId: 's' }),
    'mine',
  );
});

test('indeterminate: equal ids, no binding, caller inside a linked worktree', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  assert.strictEqual(
    classifyOwnership({ sessionId: 's', cwd: wt }, { sessionId: 's' }),
    'indeterminate',
  );
});

test('indeterminate: either id missing, no binding', () => {
  const main = gitRepo();
  assert.strictEqual(classifyOwnership({ sessionId: 's', cwd: main }, {}), 'indeterminate');
  assert.strictEqual(classifyOwnership({ cwd: main }, { sessionId: 's' }), 'indeterminate');
  assert.strictEqual(classifyOwnership({ sessionId: '', cwd: main }, { sessionId: 's' }), 'indeterminate');
});

test('verdict vocabulary: every return value is one of mine/foreign/indeterminate', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const verdicts = new Set([
    classifyOwnership({ sessionId: 'a', cwd: main }, { sessionId: 'b' }),
    classifyOwnership({ sessionId: 's', cwd: wt }, { sessionId: 's', worktree: wt }),
    classifyOwnership({ sessionId: 's', cwd: main }, { sessionId: 's', worktree: wt }),
  ]);
  for (const v of verdicts) assert.ok(['mine', 'foreign', 'indeterminate'].includes(v), `unexpected verdict ${v}`);
});

// F1 (#1098 final review): a relative caller cwd must never resolve against
// the hook process's own cwd — it must fail closed to 'indeterminate' before
// any repoInfo() call happens at all.
test('indeterminate: caller cwd is relative (".") — must never resolve against the hook process\'s own cwd', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  assert.strictEqual(
    classifyOwnership({ sessionId: 's', cwd: '.' }, { sessionId: 's', worktree: wt }),
    'indeterminate',
  );
});

// F2 (#1098 final review): a binding that exists on disk but is a regular
// file (not a directory) is not a provable worktree — must fail open to
// 'indeterminate', never 'foreign'.
test('indeterminate: binding exists on disk but is a regular file, not a directory', () => {
  const main = gitRepo();
  const wtA = linkedWorktreeOf(main);
  const filePath = path.join(main, 'not-a-dir.txt');
  fs.writeFileSync(filePath, 'x');
  assert.strictEqual(
    classifyOwnership({ sessionId: 's', cwd: wtA }, { sessionId: 's', worktree: filePath }),
    'indeterminate',
  );
});

// F3 (#1098 final review): equal ids, no binding, caller outside any git
// repo at all — the outside-any-repo fallback branch.
test('indeterminate: equal ids, no binding, caller outside any git repo', () => {
  const nonGit = scratchDir('ct-clown-nongit-');
  assert.strictEqual(
    classifyOwnership({ sessionId: 's', cwd: nonGit }, { sessionId: 's' }),
    'indeterminate',
  );
});

// F4 (#1098 final review): null-safety pins — must not throw.
test('indeterminate: runState is null — must not throw', () => {
  const main = gitRepo();
  assert.strictEqual(classifyOwnership({ sessionId: 's', cwd: main }, null), 'indeterminate');
});

test('indeterminate: runState is undefined — must not throw', () => {
  const main = gitRepo();
  assert.strictEqual(classifyOwnership({ sessionId: 's', cwd: main }, undefined), 'indeterminate');
});

test('indeterminate: caller is null — must not throw', () => {
  assert.strictEqual(classifyOwnership(null, { sessionId: 's' }), 'indeterminate');
});
