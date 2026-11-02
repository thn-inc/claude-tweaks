'use strict';
// Pins #4634's shipped-set rule in the two release-skill files that apply it, with go-red controls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const DIR = path.join(__dirname, '..', 'plugin', 'skills', 'release');
const CONSOLE = readText(path.join(DIR, 'console.md'));
const BOOKKEEPING = readText(path.join(DIR, 'bookkeeping.md'));
const CLAUSES = {
  fixes: 'a commit carrying any `Fixes` or `Refs` line ships its `Fixes` numbers, so a bundle books every `Fixes` number',
  refs: 'a `Refs`-only commit books nothing, even when its `(#N)` suffix names that record',
  suffix: 'a commit carrying neither line ships its `(#N)` suffix',
  refsAccounted: 'A `Refs`-only commit is accounted for by its `Refs` number, on the `Kept open (not booked)` line or under the record another commit\'s `Fixes` line books, and is never listed under `Unattributed commits`',
};
const KEPT_OPEN_LINE = '`Kept open (not booked): #a, #b`';
const REFS_NUMBERS_PHRASE = '`Refs` numbers that nothing else in the range ships';
const FAILED_REFS_LOOKUP = 'A failed lookup of a `Refs` number nothing else ships stays on `Kept open (not booked)`, marked `(title unavailable: {error})`, and never joins the shipped set.';

function assertShippedSetRule(text, label) {
  for (const [name, clause] of Object.entries(CLAUSES)) {
    assert.ok(text.includes(clause), `${label}: shipped-set clause "${name}" missing`);
  }
  const flat = text.replace(/\s+/g, ' ');
  assert.ok(!flat.includes('One line per `(#N)` suffix'), `${label}: still states the suffix-only rule`);
  assert.ok(!flat.includes('one entry per distinct `(#N)` suffix'), `${label}: still states the suffix-only rule`);
}

function assertKeptOpenRendering(text, label) {
  assert.ok(text.includes(KEPT_OPEN_LINE), `${label}: nested Kept open (not booked) line missing`);
  assert.ok(text.includes(REFS_NUMBERS_PHRASE), `${label}: the unshipped-Refs-numbers phrase missing`);
  assert.ok(text.includes(FAILED_REFS_LOOKUP), `${label}: the failed-Refs-lookup sentence missing`);
}

test('AC8.1: console.md states the shipped-set rule, all four clauses', () => assertShippedSetRule(CONSOLE, 'console.md'));
test('AC8.1: bookkeeping.md states the shipped-set rule, all four clauses', () => assertShippedSetRule(BOOKKEEPING, 'bookkeeping.md'));

test('AC8.2: console.md renders unbooked Refs numbers on one nested Kept open (not booked) line', () => {
  assertKeptOpenRendering(CONSOLE, 'console.md');
});

test('go-red: dropping any one clause, or restoring the suffix-only rule, fails the assertion', () => {
  for (const [label, text] of [['console.md', CONSOLE], ['bookkeeping.md', BOOKKEEPING]]) {
    for (const [name, clause] of Object.entries(CLAUSES)) {
      const mutated = text.replace(clause, '');
      assert.notStrictEqual(mutated, text, `${label}: clause "${name}" not found to remove`);
      assert.throws(() => assertShippedSetRule(mutated, label), new RegExp(`clause "${name}" missing`));
    }
    for (const stale of ['One line per `(#N)` suffix', 'one entry per distinct\n`(#N)` suffix']) {
      assert.throws(() => assertShippedSetRule(`${text}\n${stale}`, label), /still states the suffix-only rule/);
    }
  }
});

test('AC8: bookkeeping.md holds a number whose Step 4 lookup failed, and a failed re-read writes nothing', () => {
  assert.ok(BOOKKEEPING.includes('except a number whose Step 4 lookup failed, which Read state below re-reads'));
  assert.ok(BOOKKEEPING.includes('A re-read that fails the same way is a per-record `FAILED` with the verb `read`, and no write is attempted'));
});

test('go-red: removing the Kept open line, the unshipped-Refs-numbers phrase or the failed-Refs-lookup sentence fails the AC8.2 assertion', () => {
  for (const part of [KEPT_OPEN_LINE, REFS_NUMBERS_PHRASE, FAILED_REFS_LOOKUP]) {
    const mutated = CONSOLE.replace(part, '');
    assert.notStrictEqual(mutated, CONSOLE, `console.md: "${part}" not found to remove`);
    assert.throws(() => assertKeptOpenRendering(mutated, 'console.md'), /console\.md: .* missing/);
  }
});
