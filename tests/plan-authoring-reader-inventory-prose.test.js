// tests/plan-authoring-reader-inventory-prose.test.js — pins #3397's
// plan-authoring rule: plugin/skills/build/plan-authoring-checks.md tells
// plan authors to derive an "every reader of X" inventory from the value's
// read call sites, with literal-text greps a supplement only. Reads the live
// skill file (prose we just wrote — the skill-prose-conformance-tests
// live-vs-fixture distinction). The paragraph is located by its bold label
// and every assertion runs on that paragraph alone. Both negative controls
// run the same assertion function the positive test runs and expect it to
// throw: one against the pre-change file shape (this paragraph absent), one
// against the paragraph with its key phrase reworded.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const TEXT = readText(path.join(__dirname, '..', 'plugin', 'skills', 'build', 'plan-authoring-checks.md'));

const LABEL = '**Reader-inventory derivation check (extends the Consumer-enumeration check):**';
const KEY_PHRASE = "derive the plan's reader inventory from the value's read call sites";

const CALL_SITES = [
  '`--json comments`',
  '`/comments` REST paths',
  '`issue_read`/`get_comments`',
  '`.comments[]`',
  '`listComments`',
];

const MISSED_READERS = [
  '`tidy/SKILL.md`',
  '`release/bookkeeping.md`',
  '`_shared/headless-self-report.md`',
  '`assess-agent-autonomy/failure-check.md`',
  '`dispatch/settle-and-merge.md`',
  '`health-core/materiality-digest.js`',
];

function assertReaderInventoryCheck(text) {
  const hits = text.split(/\r?\n\r?\n/).filter((p) => p.startsWith(LABEL));
  assert.strictEqual(hits.length, 1, 'expected exactly one Reader-inventory derivation check paragraph');
  const p = hits[0];
  assert.ok(p.includes('"at every reader of"'), 'names the "at every reader of" trigger');
  assert.ok(p.includes(KEY_PHRASE), 'names read-call-site derivation');
  for (const site of CALL_SITES) assert.ok(p.includes(site), `names call-site form ${site}`);
  assert.ok(p.includes('classify each hit'), 'tells the plan to classify each hit');
  assert.ok(p.includes('a supplement, never the source'), 'demotes literal-text greps');
  assert.ok(p.includes("#3358's plan"), 'cites #3358');
  for (const reader of MISSED_READERS) assert.ok(p.includes(reader), `names missed reader ${reader}`);
}

test('AC1.1 + AC2.1 (#3397): plan-authoring-checks.md carries the Reader-inventory derivation check', () => {
  assertReaderInventoryCheck(TEXT);
});

test('AC2.1 (#3397): negative control — the pre-change file (paragraph absent) fails the pin', () => {
  const preChange = TEXT.split(/\r?\n\r?\n/).filter((p) => !p.startsWith(LABEL)).join('\n\n');
  assert.notStrictEqual(preChange, TEXT, 'control must actually remove the paragraph');
  assert.throws(() => assertReaderInventoryCheck(preChange));
});

test('AC2.1 (#3397): negative control — rewording the key phrase fails the pin', () => {
  const mutated = TEXT.replace(KEY_PHRASE, "derive the plan's reader inventory from literal greps");
  assert.notStrictEqual(mutated, TEXT, 'control must actually reword the phrase');
  assert.throws(() => assertReaderInventoryCheck(mutated));
});
