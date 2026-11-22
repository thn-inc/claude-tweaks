// guard-refusals chained-status linearity budget (#5588) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// tools/guard-refusals/shapes.js's git-chained-status and gh-jq-pipe-chained detectors read one
// Bash call's text, which nothing bounds (a skill fence body or a transcript command). Their old
// regex form, `<word>\s[^\n]*?(?:;|&&|\|\|)[^\n]*\$\?`, backtracked once per separator for every
// command-position start on a long line; chainedStatus() now finds each line's last `$?` and
// latest separator once. Each case asserts the verdict and a 1000 ms budget through detectShapes.
//
// Pre-fix times (this file run against the regex form):
// - `git x; ` x 2000, no `$?`: 32.7 s.
// - `gh x --repo github.com/o/r; ` x 1000, no `$?`: 11.9 s. The gh detector runs only after its
//   --jq / --repo gate, so the bare `gh x; ` run (45 ms pre-fix) is a verdict pin only.
// - `echo $?; ` ahead of `git x; ` x 2000: 32.1 s, since that `$?` sits before every separator.
// The git-C-glob cases pin gitCGlob() the same way (its regex form is quadratic in the operand).
// The lines ending in a chained `$?` are verdict pins: the first start matches at once either way.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { detectShapes } = require('../tools/guard-refusals/shapes');

const BUDGET_MS = 1000;

function timed(text) {
  const start = performance.now();
  const ids = detectShapes(text);
  return { ids, elapsed: performance.now() - start };
}

const CASES = [
  { what: "'git x; ' x 2000, no $?", text: 'git x; '.repeat(2000), id: 'git-chained-status', expect: false },
  { what: "'gh x; ' x 2000, no $?", text: 'gh x; '.repeat(2000), id: 'gh-jq-pipe-chained', expect: false },
  { what: "'gh x --repo github.com/o/r; ' x 1000, no $?", text: 'gh x --repo github.com/o/r; '.repeat(1000), id: 'gh-jq-pipe-chained', expect: false },
  { what: "'echo $?; ' then 'git x; ' x 2000", text: 'echo $?; ' + 'git x; '.repeat(2000), id: 'git-chained-status', expect: false },
  { what: "'git x; ' x 2000 then 'echo $?'", text: 'git x; '.repeat(2000) + 'echo $?', id: 'git-chained-status', expect: true },
  { what: "'gh x --repo github.com/o/r; ' x 1000 then 'echo $?'", text: 'gh x --repo github.com/o/r; '.repeat(1000) + 'echo $?', id: 'gh-jq-pipe-chained', expect: true },
  // Multi-line text: each line's search for `$?` stays inside that line.
  { what: "'git x\\n' x 40000, no $?", text: 'git x\n'.repeat(40000), id: 'git-chained-status', expect: false },
  { what: "'echo $?\\n' then 'git x\\n' x 40000", text: 'echo $?\n' + 'git x\n'.repeat(40000), id: 'git-chained-status', expect: false },
  { what: "'gh x --repo github.com/o/r\\n' x 10000, no $?", text: 'gh x --repo github.com/o/r\n'.repeat(10000), id: 'gh-jq-pipe-chained', expect: false },
  { what: "'echo $?\\n' then 'gh x --repo github.com/o/r\\n' x 10000", text: 'echo $?\n' + 'gh x --repo github.com/o/r\n'.repeat(10000), id: 'gh-jq-pipe-chained', expect: false },
  // git-C-glob: gitCGlob() replaced `git\s+-C\s+\S+[^;&|\n]*[*?[]`, which rescanned the segment once
  // per split of the operand (97 ms at 10,000 characters, 1.2 s at 40,000, 4x per doubling).
  { what: "'git -C ' then 'a' x 40000, no glob", text: 'git -C ' + 'a'.repeat(40000), id: 'git-C-glob', expect: false },
  { what: "'git -C x ' x 16000, no glob", text: 'git -C x '.repeat(16000), id: 'git-C-glob', expect: false },
  { what: "'git -C x ' x 16000 then '*'", text: 'git -C x '.repeat(16000) + '*', id: 'git-C-glob', expect: true },
  { what: "'git -C x\\n' x 40000, no glob", text: 'git -C x\n'.repeat(40000), id: 'git-C-glob', expect: false },
];

for (const { what, text, id, expect } of CASES) {
  test(`chained status stays linear: ${what}`, () => {
    const { ids, elapsed } = timed(text);
    assert.strictEqual(ids.includes(id), expect, `${what}: ${id} ${expect ? 'missing' : 'flagged'} (${JSON.stringify(ids)})`);
    assert.ok(elapsed < BUDGET_MS, `${what}: took ${elapsed.toFixed(0)}ms`);
  });
}
