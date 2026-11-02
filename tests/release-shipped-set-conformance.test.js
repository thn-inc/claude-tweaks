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

function assertShippedSetRule(text, label) {
  for (const [name, clause] of Object.entries(CLAUSES)) {
    assert.ok(text.includes(clause), `${label}: shipped-set clause "${name}" missing`);
  }
  assert.ok(!text.includes('One line per `(#N)` suffix'), `${label}: still states the suffix-only rule`);
  assert.ok(!text.includes('one entry per distinct `(#N)` suffix'), `${label}: still states the suffix-only rule`);
}

function assertKeptOpenRendering(text, label) {
  assert.ok(text.includes(KEPT_OPEN_LINE), `${label}: nested Kept open (not booked) line missing`);
  assert.ok(text.includes(REFS_NUMBERS_PHRASE), `${label}: the unshipped-Refs-numbers phrase missing`);
}

test('AC8.1: console.md states the shipped-set rule, all three cases', () => assertShippedSetRule(CONSOLE, 'console.md'));
test('AC8.1: bookkeeping.md states the shipped-set rule, all three cases', () => assertShippedSetRule(BOOKKEEPING, 'bookkeeping.md'));

test('AC8.2: console.md renders unbooked Refs numbers on one nested Kept open (not booked) line', () => {
  assertKeptOpenRendering(CONSOLE, 'console.md');
});

test('go-red: dropping any one clause, or restoring the suffix-only rule, fails the assertion', () => {
  for (const [label, text] of [['console.md', CONSOLE], ['bookkeeping.md', BOOKKEEPING]]) {
    for (const clause of Object.values(CLAUSES)) {
      assert.throws(() => assertShippedSetRule(text.replace(clause, ''), label));
    }
    assert.throws(() => assertShippedSetRule(`${text}\nOne line per \`(#N)\` suffix`, label));
  }
});

test('go-red: removing the Kept open line or the unshipped-Refs-numbers phrase fails the AC8.2 assertion', () => {
  assert.throws(() => assertKeptOpenRendering(CONSOLE.replace(KEPT_OPEN_LINE, ''), 'console.md'));
  assert.throws(() => assertKeptOpenRendering(CONSOLE.replace(REFS_NUMBERS_PHRASE, ''), 'console.md'));
});
