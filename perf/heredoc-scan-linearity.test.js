// Write-gate shell scan linearity budget (#4149) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// fileWriteTargets runs on every Bash call the pre-tool-use hook sees, so a super-linear scan
// is a session-breaking stall. #4149's fix rounds found three: a "$( whose body runs off the end
// from every top-level span (the next span rescanned the same text — 12 s at 120 KB through the
// hook before the per-pass step budget), a `$( #` comment repeated the same way, and a cwd set
// that grew by one per distinct `cd` path while every later piece was visited once per cwd
// (24-49 s at 40 KB before the 16-entry cap). This pins each as linear. Lives outside tests/ for
// the same reason the other perf/ files do: a wall-clock assertion flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { fileWriteTargets } = require('../plugin/bin/lib/hooks/git-command');

const BUDGET_MS = 750;
const timed = (fn) => {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
};
const distinct = (f, k) => Array.from({ length: k }, (_, i) => f(i)).join('');

for (const [label, piece] of [
  ['an unterminated heredoc inside "$( repeated', '"$(<<X\n"'],
  ['a "$( # comment repeated', '"$( #"'],
  ['an unquoted ${a repeated', '${a'],
]) {
  test(`fileWriteTargets: ${label} (60 KB) stays linear`, () => {
    const { value, ms } = timed(() => fileWriteTargets(`echo ${piece.repeat(Math.floor(60000 / piece.length))} && cp a /main/f.js`, '/r'));
    assert.ok(value.some((t) => t.file === path.resolve('/main/f.js')), JSON.stringify(value));
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
  });
}

for (const [route, group] of [
  ['brace groups', (i) => `{ cd /a${i}; }; true; `],
  ['substitution tails', (i) => `echo $(true; true) cd /a${i}; true; `],
]) {
  test(`fileWriteTargets: 1,500 distinct cd paths through ${route} stay linear`, () => {
    const { ms } = timed(() => fileWriteTargets(`${distinct(group, 1500)}cp a f.js`, '/r', { overflowCwd: '/main' }));
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
  });
}
