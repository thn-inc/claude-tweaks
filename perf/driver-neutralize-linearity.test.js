// Driver `neutralize` regex linearity budget (#5269) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// neutralize() cleans worker-controlled text before it reaches a commit title, a PR body or an event
// line, and that text is uncapped. These shapes were found when the closing-keyword rule narrowed to
// "only before a reference" and the reference passes began repeating to a fixed point:
//   - `fix` + a long whitespace run + a non-reference: the lookahead grammar `\s*:?\s*` split the run
//     two ways at every length, quadratic (60k spaces took ~7.6s, 100k ~52s pre-fix; now
//     `(?:\s*:)?\s*`).
//   - a keyword + a whitespace run + a colon + a reference: not slow pre-fix (the greedy run reaches
//     the colon at once); kept as a verdict guard that the rewritten grammar still removes it.
//   - many fragments that each need a second removal pass (`h#7ttps://…` rebuilt into a URL): the
//     fixed-point loop must stay linear in the number of fragments; pre-loop the verdict was wrong
//     (a closing URL survived), so that case is guarded by its verdict as well as its time.
//   - a long run of identifier characters with no `/` (or with a `/x` tail and no `#`): QUALIFIED_REF
//     rescanned the run from every start, quadratic already on the base code (50k `h` ~4s, 100k ~18s,
//     200k ~91s, and with a `/x` tail ~83s, pre-fix); a left-boundary lookbehind of its own owner
//     class now lets a match start only at the run's start or where a previous `#N` match ended.
//   - a long digit run (`1`*200k, `#` + `1`*200k + `a`): the `(?<=#\d+)` scan-back would run at every
//     digit; the `(?!\d)` before it keeps it to once per run (with the guard removed: `1`*200k took
//     ~158s and `#` + `1`*200k + `a` ~94s).
//   - back-to-back qualified references (`a/b#1`*50k): the verdict (everything removed) is the
//     guard, since a plain left-boundary lookbehind leaves `a/b#a/b#…` behind.
//   - nested splices (`https://g/o/r/`*k + `https://h/o/r/issues/1` + `issues/2`*k): each removal
//     rebuilt the enclosing URL, and with plain deletion the loop peeled one layer per pass over
//     the whole text (k=4000 ~3.2s, k=9000 ~12.2s); a single space per in-loop removal ends it.
//   - a keyword in a long non-space run (`a.fix:https://g/o/r/issues/1/`*8000): the keyword
//     lookahead embedded URL_REF's greedy tail and scanned to the run's end from every keyword
//     (232k chars ~1.0s pre-fix, 0.3ms on the base code); it now embeds only the URL head.
//   - `h#1`*5k collapsing to `h`*5k: only a time budget for many bare-reference removals; it
//     catches none of the mutants above and has no pre-fix time.
// Lives outside tests/ for the same reason the other perf/ files do: a wall-clock assertion flakes
// under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { neutralize } = require('../plugin/bin/lib/driver/events');

function timed(input) {
  const start = performance.now();
  const value = neutralize(input);
  return { value, elapsed: performance.now() - start };
}

test('neutralize: a keyword followed by a long whitespace run and no reference stays linear', () => {
  const { value, elapsed } = timed(`fix${' '.repeat(100000)}x`);
  assert.ok(value === 'fix x', `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — the keyword lookahead must not backtrack over the whitespace run`);
});

test('neutralize: a keyword, a long whitespace run, a colon and a reference stays linear', () => {
  const { value, elapsed } = timed(`Fixes${' '.repeat(100000)}:${' '.repeat(10)}#12`);
  assert.ok(value === '', `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — the keyword lookahead must not backtrack over the whitespace run`);
});

test('neutralize: many fragments that each need a second removal pass stay linear', () => {
  const fragment = 'Add Closes h#7ttps://github.com/o/r/issues/5 now ';
  const { value, elapsed } = timed(fragment.repeat(2000));
  const expected = 'Add Closes https:// now '.repeat(2000).trim();
  assert.ok(value === expected, `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)}ms — the fixed-point loop must not rescan per fragment`);
});

test('neutralize: a run of bare references that collapses to prose stays linear', () => {
  const { value, elapsed } = timed('h#1'.repeat(5000));
  assert.ok(value === 'h'.repeat(5000), `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)}ms`);
});

test('neutralize: a long identifier run with no slash stays linear', () => {
  const input = 'h'.repeat(200000);
  const { value, elapsed } = timed(input);
  assert.ok(value === input, `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — QUALIFIED_REF must not rescan the run from every start`);
});

test('neutralize: a long digit run stays linear', () => {
  const input = '1'.repeat(200000);
  const { value, elapsed } = timed(input);
  assert.ok(value === input, `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — the #N scan-back must not run at every digit`);
});

test('neutralize: a hash, a long digit run and a letter stays linear', () => {
  const input = `#${'1'.repeat(200000)}a`;
  const { value, elapsed } = timed(input);
  assert.ok(value === 'a', `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — the #N scan-back must not run at every digit`);
});

test('neutralize: back-to-back qualified references are all removed, in linear time', () => {
  const { value, elapsed } = timed('a/b#1'.repeat(50000));
  assert.ok(value === '', `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)}ms`);
});

test('neutralize: a long identifier run with a slash tail and no # stays linear', () => {
  const input = `${'h'.repeat(200000)}/x`;
  const { value, elapsed } = timed(input);
  assert.ok(value === input, `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — QUALIFIED_REF must not rescan the run from every start`);
});

test('neutralize: deeply nested splices settle without a pass per layer', () => {
  const k = 4000;
  const input = `${'https://g/o/r/'.repeat(k)}https://h/o/r/issues/1${'issues/2'.repeat(k)}`;
  const { value, elapsed } = timed(input);
  const expected = `${'https://g/o/r/'.repeat(k - 1)} ${'issues/2'.repeat(k - 1)}`;
  assert.ok(value === expected, `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — in-loop removals must leave a space, not splice again`);
});

test('neutralize: keywords inside one long non-space run stay linear', () => {
  const { value, elapsed } = timed('a.fix:https://g/o/r/issues/1/'.repeat(8000));
  assert.ok(value === 'a.', `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — the keyword lookahead must not scan the URL tail`);
});

test('neutralize: the widened URL hosts stay linear on long non-matching runs', () => {
  for (const input of [`www.${'a'.repeat(200000)}`, `_https://${'a'.repeat(200000)}`, `github.com/${'a/'.repeat(100000)}`]) {
    const { value, elapsed } = timed(input);
    assert.ok(value === input, `verdict changed (length ${value.length})`);
    assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms on ${input.slice(0, 12)}`);
  }
});
