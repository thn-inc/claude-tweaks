// Acceptance-packet inline() linearity budget (#4611) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// packet-render.js runs inline() on every outside value it renders: claims, QA errors, the observation plan. No
// caller bounds their length. One super-linear shape was found: collapseLines' `\s*[\r\n]+\s*` restarting inside a
// long run of spaces with no line break (about 26 s at 200k characters). The other inputs are built from the alphabet
// of AUTOLINK_TOKEN_RE, whose bounded repeats keep it linear on a long run of word characters. Lives outside tests/
// for the same reason the other perf/ files do: a wall-clock assertion flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { inline } = require('../plugin/bin/lib/wrap-up/packet-render');

const BUDGET_MS = 2000;
const timed = (input) => {
  const start = performance.now();
  const value = inline(input);
  return { value, ms: performance.now() - start };
};

const SPACES = ' '.repeat(200000);

for (const [label, input, expected] of [
  ['200k spaces', SPACES, ''],
  ['200k spaces between two words', `a${SPACES}b`, `a${SPACES}b`],
  ['a 200k-character word', 'a'.repeat(200000), 'a'.repeat(200000)],
  ['100k `a1` repeats', 'a1'.repeat(100000), 'a1'.repeat(100000)],
  ['100k `a.` repeats', 'a.'.repeat(100000), 'a.'.repeat(100000)],
  ['100k `a@` repeats', 'a@'.repeat(100000), 'a@'.repeat(100000)],
  ['200k `@`', '@'.repeat(200000), '@'.repeat(200000)],
  ['200k `#`', '#'.repeat(200000), `\\${'#'.repeat(200000)}`],
  ['an `@` before a 200k-character word', `a@${'b'.repeat(200000)}`, `a@${'b'.repeat(200000)}`],
  ['100k `a/` repeats', 'a/'.repeat(100000), 'a/'.repeat(100000)],
  ['200k `-`', '-'.repeat(200000), `\\${'-'.repeat(200000)}`],
  ['200k `=`', '='.repeat(200000), `\\${'='.repeat(200000)}`],
]) {
  test(`inline: ${label} stays linear`, () => {
    const { value, ms } = timed(input);
    // assert.ok, not strictEqual: a failing strictEqual would print 200k characters.
    assert.ok(value === expected, `wrong output (${value.length} chars, starts ${JSON.stringify(value.slice(0, 8))})`);
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
  });
}
