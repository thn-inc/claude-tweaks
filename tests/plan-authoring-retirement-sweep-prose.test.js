// tests/plan-authoring-retirement-sweep-prose.test.js — pins #3462's
// plan-authoring rule: plugin/skills/build/plan-authoring-checks.md tells
// plan authors that a plan deleting a named mechanism carries a sweep task
// over every phrasing of it, with the file list taken from the grep's
// output, never from the spec's named list. Reads the live skill file. The
// paragraph is located by its bold label and every assertion runs on that
// paragraph alone. Both negative controls run the same assertion function
// the positive test runs and expect it to throw: one against the pre-change
// file shape (paragraph absent), one with the key phrase reworded.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const TEXT = readText(path.join(__dirname, '..', 'plugin', 'skills', 'build', 'plan-authoring-checks.md'));

const LABEL = '**Retirement-sweep check:**';
const KEY_PHRASE = "the sweep's file list comes from that grep's output, never from the spec's named list";

const PHRASINGS = [
  'the identifier',
  'the file path',
  'the option literal',
  'the numeric value as prose',
  'the issue number used as a label',
];

function assertRetirementSweepCheck(text) {
  const hits = text.split(/\r?\n\r?\n/).filter((p) => p.startsWith(LABEL));
  assert.strictEqual(hits.length, 1, 'expected exactly one Retirement-sweep check paragraph');
  const p = hits[0];
  assert.ok(p.includes('deletes or retires a named mechanism'), 'names the trigger');
  assert.ok(p.includes('every non-history path'), 'sweeps every non-history path');
  for (const phrasing of PHRASINGS) assert.ok(p.includes(phrasing), `names phrasing: ${phrasing}`);
  assert.ok(p.includes('verification grep names each phrasing'), 'verification grep names each phrasing');
  assert.ok(p.includes(KEY_PHRASE), 'file list comes from the grep output');
  assert.ok(p.includes('"Deleted-rule citation sweep"'), 'cites the Deleted-rule citation sweep rule');
  assert.ok(p.includes('"Grep retired term repo-wide"'), 'cites the Grep retired term repo-wide rule');
  assert.ok(p.includes('#3311') && p.includes('f49277005'), 'cites #3311 by PR and squash commit');
}

test('AC1.1 (#3462): plan-authoring-checks.md carries the Retirement-sweep check', () => {
  assertRetirementSweepCheck(TEXT);
});

test('AC1.1 (#3462): negative control — the pre-change file (paragraph absent) fails the pin', () => {
  const preChange = TEXT.split(/\r?\n\r?\n/).filter((p) => !p.startsWith(LABEL)).join('\n\n');
  assert.notStrictEqual(preChange, TEXT, 'control must actually remove the paragraph');
  assert.throws(() => assertRetirementSweepCheck(preChange));
});

test('AC2.1 (#3462): negative control — rewording the grep-output rule fails the pin', () => {
  const mutated = TEXT.replace(KEY_PHRASE, "the sweep's file list comes from the spec's named list");
  assert.notStrictEqual(mutated, TEXT, 'control must actually reword the phrase');
  assert.throws(() => assertRetirementSweepCheck(mutated));
});
