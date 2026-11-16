// Cross-repository dependency parse linearity budget (#4793) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// cross-repo-refs.js parses 'Blocked by owner/name#N' lines out of a record body and strips
// qualified refs from free text. Both regexes share one grammar, so both are pinned here. A
// character class that accepts the terminators, or an unanchored strip regex without its
// left-boundary lookbehind, restarts at every character of a long token and goes quadratic.
// Inputs are built from the grammar's own alphabet without the terminator that ends a match.
// Lives outside tests/ for the same reason the other perf/ files do: a wall-clock assertion
// flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseCrossRepoDependencies, stripCrossRepoRefs } = require('../plugin/bin/lib/issues/cross-repo-refs');

const INPUTS = [
  ['a long token with no slash', `Blocked by ${'a'.repeat(200000)}`],
  ['a long repository name with no hash', `Blocked by a/${'a'.repeat(200000)}`],
  ['many unterminated qualified lines', 'Blocked by a/a\n'.repeat(20000)],
  ['a long hyphen run with no slash', `Blocked by a${'-'.repeat(200000)}`],
  ['a long hyphen-led token', `Blocked by ${'-'.repeat(200000)}/a#1`],
  ['a long run of newlines', '\n'.repeat(40000)],
];

function timed(fn, input) {
  const start = performance.now();
  const out = fn(input);
  return { out, elapsed: performance.now() - start };
}

test('parseCrossRepoDependencies stays linear on adversarial bodies and finds nothing in them', () => {
  for (const [name, input] of INPUTS) {
    const { out, elapsed } = timed(parseCrossRepoDependencies, input);
    assert.deepStrictEqual(out, [], `${name}: no qualified ref is present`);
    assert.ok(elapsed < 200, `${name}: parsing took ${elapsed.toFixed(0)}ms — the line regex must not backtrack within a token`);
  }
});

test('stripCrossRepoRefs stays linear on adversarial text and leaves it unchanged', () => {
  for (const [name, input] of INPUTS) {
    const { out, elapsed } = timed(stripCrossRepoRefs, input);
    assert.ok(out === input, `${name}: no qualified ref is present, so the text must come back unchanged (length ${out.length} vs ${input.length})`);
    assert.ok(elapsed < 200, `${name}: stripping took ${elapsed.toFixed(0)}ms — the lookbehind must keep a long token from restarting at every character`);
  }
});
