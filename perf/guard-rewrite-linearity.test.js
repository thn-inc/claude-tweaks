// guard-rewrite linearity budget (#5588) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// guard-rewrite.js scans a Bash command (up to MAX_COMMAND, 64 KiB) with two new rules:
// drop-git-C-cwd (a `git -C <cwd>` operand) and quote-exit-status (a `word=$?` argument).
// Each case asserts the verdict, a 500 ms budget at the full size N, and growth: the best of
// three runs at N must stay under 8x the best of three at N/4 (+50 ms slack) — linear is about
// 4x, quadratic about 16x.
//
// What each case guards (times measured with the guard reverted, best of 3):
// - 'a/' run + ` $?` (null verdict): the left-boundary lookbehind of EXIT_STATUS_WORD. Without
//   it the regex restarts inside every long word-character run: 2280 ms at 60 KB (budget 500).
// - `git log; ` x N then `git -C .`: the no-`-C` candidate's scan stopping at its own simple
//   command. A mutant that also scans to the end of the text per candidate: 25.7 ms at N/4 but
//   342 ms at N, so the growth check catches it (the 500 ms budget alone would not).
// - `git -C .` x N: a verdict pin. A mutant recomputing CWD_MOVER.test(s) per candidate is NOT
//   caught: that scan is cheap (~150 ms extra at the 64 KiB ceiling), under the budget and the slack.
// - `a=$?` x N and the `a.` run ending in `$?`: verdict pins; they stay fast with the lookbehind
//   removed (each match starts at once), so they do not discriminate it.
// Lives outside tests/ because a wall-clock assertion flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { rewriteForGuard } = require('../plugin/bin/lib/hooks/guard-rewrite');

const BUDGET_MS = 500;
const MAX_COMMAND = 64 * 1024;
const RUNS = 3;

function once(command) {
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

// Best of RUNS at one size; the verdict comes from the last run.
function best(command) {
  let min = Infinity;
  let out;
  for (let k = 0; k < RUNS; k += 1) {
    const r = once(command);
    out = r.out;
    min = Math.min(min, r.elapsed);
  }
  return { out, min };
}

// Times build(n/4) and build(n); returns the verdict at n and both times.
function measure(build, n) {
  const small = best(build(n / 4));
  const full = best(build(n));
  return { out: full.out, small: small.min, full: full.min };
}

function assertLinear({ small, full }, what) {
  assert.ok(full < BUDGET_MS, `${what}: took ${full.toFixed(0)}ms at full size`);
  assert.ok(full < 8 * small + 50, `${what}: ${small.toFixed(1)}ms at N/4 but ${full.toFixed(1)}ms at N — super-linear`);
}

test('drop-git-C-cwd: many `git -C .` words stay linear and are all dropped', () => {
  const m = measure((n) => 'git -C . log; '.repeat(n) + 'true', 4000);
  assert.ok(m.out, 'expected a rewrite');
  assert.ok(m.out.command === 'git log; '.repeat(4000) + 'true', `rewritten command differs (length ${m.out.command.length})`);
  assertLinear(m, 'git -C .');
});

test('drop-git-C-cwd: many non-`-C` git calls before one `git -C .` stay linear', () => {
  const m = measure((n) => 'git log; '.repeat(n) + 'git -C . log', 6000);
  assert.ok(m.out, 'expected a rewrite');
  assert.ok(m.out.command === 'git log; '.repeat(6000) + 'git log', `rewritten command differs (length ${m.out.command.length})`);
  assertLinear(m, 'git log x N then git -C .');
});

test('quote-exit-status: many `a=$?` words stay linear and are all quoted', () => {
  const m = measure((n) => 'git log; ' + 'echo a=$? '.repeat(n), 6000);
  assert.ok(m.out, 'expected a rewrite');
  assert.ok(m.out.applied.includes('quote-exit-status'), `applied ${m.out.applied}`);
  assert.ok(m.out.command === 'git log; ' + 'echo "a=$?" '.repeat(6000), `rewritten command differs (length ${m.out.command.length})`);
  assertLinear(m, 'a=$? x N');
});

test('quote-exit-status: a long word-character run with no `$?` word stays linear and returns null', () => {
  const m = measure((n) => 'git log; echo ' + 'a/'.repeat(n) + ' $?', 30000);
  assert.equal(m.out, null);
  assertLinear(m, 'a/ run');
});

test('quote-exit-status: a long word-character run ending in `$?` stays linear and is quoted', () => {
  const m = measure((n) => 'git log; echo ' + 'a.'.repeat(n) + '$?', 30000);
  assert.ok(m.out, 'expected a rewrite');
  assert.ok(m.out.applied.includes('quote-exit-status'), `applied ${m.out.applied}`);
  assertLinear(m, 'a. run ending in $?');
});
