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
//     (232k chars ~1.0s pre-fix, 0.3ms on the base code). The lookahead is gone: the keyword is now
//     decided in code from the token after it (markers collected once, forward-only pointers), so
//     this case also guards a whitespace search restarted per keyword.
//   - `www.` runs, `_www.` runs, `www.g/o/r/issues/5` chains and `fix:www.` / `fix:` runs: the
//     `www\.[^\s/]+` URL alternative was quadratic (40k chars 1.0-1.5s, 200k 145s), also through the
//     keyword lookahead (`fix:www.` x25k, 75s); the lookahead is gone. #5352 brought back the
//     `www.` and bare-host alternatives and added PATH_REF, each with a guard that keeps it linear.
//     Probed time with the guard reverted:
//       - no `[\d_](?!www\.)` guard: `'_www.'.repeat(40000)` ~74s, `'1www.'.repeat(40000)` ~36s,
//         `'_www.a'.repeat(35000)` ~11s;
//       - no digit in the `www.`/bare-host boundary: `'www.g/o/r/issues/5'.repeat(11000)` ~95s,
//         `'github.com/o/r/issues/5'.repeat(9000)` ~23s;
//       - no PATH_REF length bounds: `'a-'.repeat(100000)` ~36s, `'1'.repeat(200000)` ~64s;
//       - no digit in the PATH_REF boundary: the verdict breaks rather than the time, leaving
//         87,989 characters of `'o/r/issues/5'.repeat(16000)`.
//   - back-to-back scheme URLs (`https://g/o/r/issues/5`*9000): with a `(?<![A-Za-z0-9])` boundary
//     each URL follows a digit and was refused until the previous removal left a space, peeling one
//     URL per loop pass (200k chars ~10.5s); the boundary is now letters-only.
//   - a keyword chain before a marker token (`fix `*k + `www.g/o/r/issues/5`): only the last
//     keyword's token carried the marker, so each loop pass removed one keyword and exposed the next
//     (100k chars ~81s); the chain is now decided right to left in one pass.
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
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — the keyword match must not backtrack over the whitespace run`);
});

test('neutralize: a keyword, a long whitespace run, a colon and a reference stays linear', () => {
  const { value, elapsed } = timed(`Fixes${' '.repeat(100000)}:${' '.repeat(10)}#12`);
  assert.ok(value === '', `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — the keyword match must not backtrack over the whitespace run`);
});

test('neutralize: many fragments that each need a second removal pass stay linear', () => {
  const fragment = 'Add Closes h#7ttps://github.com/o/r/issues/5 now ';
  const { value, elapsed } = timed(fragment.repeat(2000));
  const expected = 'Add now '.repeat(2000).trim();
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
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — the #N scan-back must not run at every digit, and PATH_REF's owner length bound must hold`);
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
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — the end of the keyword's token must be found once, not per keyword`);
});

test('neutralize: www. and keyword runs that match nothing stay linear and unchanged', () => {
  const shapes = {
    'www.': 'www.'.repeat(50000),
    '_www.': '_www.'.repeat(40000),
    'fix:www.': 'fix:www.'.repeat(25000),
    'fix:': 'fix:'.repeat(50000),
    '1www.': '1www.'.repeat(40000),
    '_www.a': '_www.a'.repeat(35000),
    '_www.a:1': '_www.a:1'.repeat(25000),
    'www. + a run': `www.${'a'.repeat(200000)}`,
    'github.com/ + a/ run': `github.com/${'a/'.repeat(100000)}`,
    '_www.g/o/r/': '_www.g/o/r/'.repeat(20000),
    '_github.com/o/r/': '_github.com/o/r/'.repeat(15000),
    'a-': 'a-'.repeat(100000),
    'a/': 'a/'.repeat(100000),
    'o/r/issues/': 'o/r/issues/'.repeat(18000),
  };
  for (const [name, input] of Object.entries(shapes)) {
    const { value, elapsed } = timed(input);
    assert.ok(value === input, `verdict changed on ${name} (length ${value.length})`);
    assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)}ms on ${name}`);
  }
});

test('neutralize: a keyword chain before a marker token goes in one pass', () => {
  const { value, elapsed } = timed(`${'fix '.repeat(25000)}www.g/o/r/issues/5`);
  assert.ok(value === '', `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — a keyword chain must be decided in one pass, not one keyword per loop pass`);
});

test('neutralize: back-to-back scheme URLs are all removed without a loop pass each', () => {
  const { value, elapsed } = timed('https://g/o/r/issues/5'.repeat(9000));
  assert.ok(value === '', `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — the URL boundary must admit a digit before the scheme`);
});

test('neutralize: back-to-back www., bare github.com and host-free references are all removed in one pass', () => {
  const shapes = {
    'www.g/o/r/issues/5': 'www.g/o/r/issues/5'.repeat(11000),
    'github.com/o/r/issues/5': 'github.com/o/r/issues/5'.repeat(9000),
    'o/r/issues/5': 'o/r/issues/5'.repeat(16000),
  };
  for (const [name, input] of Object.entries(shapes)) {
    const { value, elapsed } = timed(input);
    assert.ok(value === '', `verdict changed on ${name} (length ${value.length})`);
    assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms on ${name} — the boundary must admit a digit where the previous reference ended`);
  }
});
