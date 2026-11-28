// guard-refusals assignment spell-out linearity budget (#5590) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// tools/guard-refusals/replay.js's spellOutAssignments() reads one Bash call's text, which nothing
// bounds, and writes each literal assignment's value out at its later references. It is one forward
// pass written by hand; each case here is an input built from the scan's own alphabet, with its
// verdict and a 1000 ms budget.
// Found when written (2026-11-16): a chain of 20000 assignments, each value holding the one before
// (`V1=/p$V0; V2=/p$V1; …`), wrote out 400 MB in 150 ms before the value and output caps. Every case
// here measured under 60 ms with them.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spellOutAssignments } = require('../tools/guard-refusals/replay');

const BUDGET_MS = 1000;
const chain = Array.from({ length: 20000 }, (_, i) => `V${i}=/p${i ? `$V${i - 1}` : ''}`).join('; ');

// `expect` is the output; null means the text comes back unchanged.
const CASES = [
  { what: 'a chain of 20000 assignments, each holding the one before', text: chain, expect: null },
  { what: "'$S ' x 20000 after S=/a", text: `S=/a; echo ${'$S '.repeat(20000)}`, expect: `S=/a; echo ${'/a '.repeat(20000)}` },
  { what: "'$S ' x 60000 after S=/a, past the output cap", text: `S=/a; echo ${'$S '.repeat(60000)}`, expect: null },
  { what: "'a=' x 150000 on one line", text: 'a=a=a='.repeat(50000), expect: null },
  { what: 'a name of 200000 characters, assigned', text: `${'S'.repeat(200000)}=1; echo`, expect: null },
  { what: 'a reference of 200000 name characters', text: `S=/a; echo $${'S'.repeat(200000)}`, expect: null },
  { what: '200000 spaces between a value and the next word', text: `S=/a${' '.repeat(200000)}x; echo $S`, expect: null },
  { what: "'T=1 <10 spaces> x; ' x 20000", text: `S=/a; ${`T=1${' '.repeat(10)}x; `.repeat(20000)}`, expect: null },
  { what: "'for' then 200000 spaces", text: `for${' '.repeat(200000)}!`, expect: null },
  { what: "'for' then '-a ' x 80000", text: `for ${'-a '.repeat(80000)}!`, expect: null },
  { what: "'$' x 200000", text: '$'.repeat(200000), expect: null },
  { what: '200000 backslashes', text: `S=/a; echo ${'\\'.repeat(200000)}`, expect: null },
  { what: "'(' x 100000 then ')' x 100000", text: `${'('.repeat(100000)}${')'.repeat(100000)}`, expect: null },
  // Many lines: a statement start is tried once per line, and a heredoc body is never written out.
  { what: "'S=/a\\n' x 40000", text: 'S=/a\n'.repeat(40000), expect: null },
  { what: "'cp x $S\\n' x 20000 after S=/a", text: `S=/a\n${'cp x $S\n'.repeat(20000)}`, expect: `S=/a\n${'cp x /a\n'.repeat(20000)}` },
  { what: 'a heredoc body of 40000 reference lines', text: `S=/a; cat <<EOF\n${'$S\n'.repeat(40000)}EOF\necho $S`, expect: `S=/a; cat <<EOF\n${'$S\n'.repeat(40000)}EOF\necho /a` },
];

for (const { what, text, expect } of CASES) {
  test(`assignment spell-out stays linear: ${what}`, () => {
    const start = performance.now();
    const out = spellOutAssignments(text);
    const elapsed = performance.now() - start;
    assert.ok(out === (expect === null ? text : expect), `${what}: wrong output (${out.length} characters)`);
    assert.ok(elapsed < BUDGET_MS, `${what}: took ${elapsed.toFixed(0)}ms`);
  });
}
