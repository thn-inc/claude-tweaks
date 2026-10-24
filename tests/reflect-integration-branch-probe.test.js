'use strict';
// reflect's tangential filing path probes the integration branch before an absence claim is filed, and drops the finding when the content is already there (#3987, after #3078 closed the gap #3817 was filed for).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const REFLECT = readText(
  path.join(__dirname, '..', 'plugin/skills/reflect/SKILL.md'));

const LEAD = '**Integration-branch probe before an absence claim (#3987).**';

function paragraph() {
  const start = REFLECT.indexOf(LEAD);
  assert.ok(start >= 0, 'the bold lead must be present');
  const end = REFLECT.indexOf('\n\n', start);
  return REFLECT.slice(start, end);
}

test('the integration-branch probe paragraph sits once, between the tangential header paragraph and the Number {n} sentence', () => {
  assert.equal(REFLECT.split(LEAD).length - 1, 1, 'the bold lead must appear exactly once');
  const header = REFLECT.indexOf("Without this header the Console's record-creation step");
  const probe = REFLECT.indexOf(LEAD);
  const number = REFLECT.indexOf('Number `{n}` is a per-run sequence counter');
  assert.ok(header >= 0, 'the tangential header paragraph must be present');
  assert.ok(number >= 0, 'the Number {n} sentence must be present');
  assert.ok(probe > header, 'the probe paragraph must come after the tangential header paragraph');
  assert.ok(number > probe, 'the Number {n} sentence must come after the probe paragraph');
});

test('the probe rule names the integration-branch reference, the fetch, the grep and log probes, and the Current State citation', () => {
  const p = paragraph();
  assert.ok(p.includes('_shared/integration-branch.md'), 'the paragraph must cite _shared/integration-branch.md for the branch resolution (probe rule)');
  assert.ok(p.includes("`git fetch origin '{integration-branch}'`"), 'the paragraph must name the fetch command (probe rule)');
  assert.ok(p.includes("`git grep -n -F -e '{phrase}' 'origin/{integration-branch}' -- '{path}'`"), 'the paragraph must name the git grep probe (probe rule)');
  assert.ok(p.includes("`git log -S '{phrase}' --oneline 'origin/{integration-branch}' -- '{path}'`"), 'the paragraph must name the git log -S probe (probe rule)');
  assert.ok(p.includes("Cite the probe command and its result in the record's Current State"), 'the paragraph must require citing the probe in Current State (probe rule)');
});

test('the could-not-run rule names the failed fetch and the grep or log exits that are not 0 or 1', () => {
  const p = paragraph();
  assert.ok(p.includes('`git fetch` exits non-zero'), 'the paragraph must name a failed fetch as could-not-run (could-not-run rule)');
  assert.ok(p.includes('exits other than 0 or 1'), 'the paragraph must treat grep or log exits other than 0 or 1 as could-not-run (could-not-run rule)');
  assert.ok(p.includes('never that the content is absent'), 'the paragraph must forbid reading a could-not-run probe as absence (could-not-run rule)');
  assert.ok(p.includes('`git log -S` exiting 0 with no output'), 'the paragraph must say how an empty git log -S result reads (could-not-run rule)');
});

test('the probe pins the -e grep form and the single-quoting rule for the phrase', () => {
  const p = paragraph();
  assert.ok(p.includes("-e '{phrase}'"), 'the paragraph must pin the grep -e form (quoting rule)');
  assert.ok(p.includes("Single-quote `{phrase}`, writing each `'` inside it as `'\\''`"), 'the paragraph must state the single-quote escaping rule (quoting rule)');
});

test('the drop rule skips filing when the claimed content is already on the integration branch and writes a decisions.md line', () => {
  const p = paragraph();
  assert.ok(p.includes('When the probe finds the claimed content already on the integration branch, the finding is not filed'), 'the paragraph must state the drop-when-present rule (drop rule)');
  assert.ok(p.includes('not filed — already on origin/{integration-branch}'), 'the paragraph must give the decisions.md line text (drop rule)');
});
