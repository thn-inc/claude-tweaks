// guard-rewrite linearity budget (#5588) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// guard-rewrite.js scans a Bash command (up to MAX_COMMAND, 64 KiB) with two new rules:
// drop-git-C-cwd (a `git -C <cwd>` operand) and quote-exit-status (a `word=$?` argument).
// The quote-exit-status word regex is unanchored and global; without its left-boundary
// lookbehind it restarts inside every long run of word characters and fails at the end of
// it. Shapes probed: many `git -C .` words, many `a=$?` words, a long word-character run
// with no `$?` (verdict null, bare `$?`), and a long run ending in `$?`.
// Pre-fix time (lookbehind removed): ~2970 ms on the 'a/'.repeat(30000) + ' $?' case (60 KB);
// the other three cases stay under 12 ms either way.
// Lives outside tests/ because a wall-clock assertion flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { rewriteForGuard } = require('../plugin/bin/lib/hooks/guard-rewrite');

const BUDGET_MS = 500;
const MAX_COMMAND = 64 * 1024;

function run(command) {
  assert.ok(command.length <= MAX_COMMAND, `command is ${command.length} chars, over MAX_COMMAND`);
  const start = performance.now();
  const out = rewriteForGuard({
    command,
    cwd: '/w/wt',
    pathImpl: path.posix,
    deps: { isLinkedWorktree: () => true, canonicalRealpath: (p) => path.posix.resolve(p) },
  });
  return { out, elapsed: performance.now() - start };
}

test('drop-git-C-cwd: many `git -C .` words stay linear and are all dropped', () => {
  const expected = 'git log; '.repeat(4000) + 'true';
  const { out, elapsed } = run('git -C . log; '.repeat(4000) + 'true');
  assert.ok(out, 'expected a rewrite');
  assert.ok(out.command === expected, `rewritten command differs (length ${out.command.length})`);
  assert.ok(elapsed < BUDGET_MS, `took ${elapsed.toFixed(0)}ms`);
});

test('quote-exit-status: many `a=$?` words stay linear and are all quoted', () => {
  const { out, elapsed } = run('git log; ' + 'echo a=$? '.repeat(6000));
  assert.ok(out, 'expected a rewrite');
  assert.ok(out.applied.includes('quote-exit-status'), `applied ${out.applied}`);
  const expected = 'git log; ' + 'echo "a=$?" '.repeat(6000);
  assert.ok(out.command === expected, `rewritten command differs (length ${out.command.length})`);
  assert.ok(elapsed < BUDGET_MS, `took ${elapsed.toFixed(0)}ms`);
});

test('quote-exit-status: a long word-character run with no `$?` word stays linear and returns null', () => {
  const { out, elapsed } = run('git log; echo ' + 'a/'.repeat(30000) + ' $?');
  assert.equal(out, null);
  assert.ok(elapsed < BUDGET_MS, `took ${elapsed.toFixed(0)}ms — the word regex must not restart inside a run`);
});

test('quote-exit-status: a long word-character run ending in `$?` stays linear and is quoted', () => {
  const { out, elapsed } = run('git log; echo ' + 'a.'.repeat(30000) + '$?');
  assert.ok(out, 'expected a rewrite');
  assert.ok(out.applied.includes('quote-exit-status'), `applied ${out.applied}`);
  assert.ok(elapsed < BUDGET_MS, `took ${elapsed.toFixed(0)}ms`);
});
