'use strict';
// run-state-worktree.js (#5555): the one worktree-precedence rule, re-exported by hooks/context.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { priorWorktree } = require('../../plugin/bin/lib/run-state-worktree');
const context = require('../../plugin/bin/lib/hooks/context');

test('priorWorktree: worktree wins, worktreeAtClose stands in for a null or empty one, else null', () => {
  assert.equal(priorWorktree({ worktree: '/a', worktreeAtClose: '/b' }), '/a');
  assert.equal(priorWorktree({ worktree: null, worktreeAtClose: '/b' }), '/b');
  assert.equal(priorWorktree({ worktree: '', worktreeAtClose: '/b' }), '/b');
  assert.equal(priorWorktree({ worktree: 7, worktreeAtClose: '' }), null);
  assert.equal(priorWorktree(null), null);
  assert.equal(priorWorktree('not-an-object'), null);
});

test('hooks/context.js re-exports the leaf\'s priorWorktree, not a copy', () => {
  assert.equal(context.priorWorktree, priorWorktree);
});
