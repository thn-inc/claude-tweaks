'use strict';
// #3783: the two pending-review merge sites read verify.json's
// `acceptance-labeling` row instead of assuming wrap-up's Phase 4 ran it.
// Prose-as-implementation — pin the rule against the live text, with a
// negative control per pin proving the assertion can go red.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p)).replace(/\s+/g, ' ');

const slice = (text, from, to) => {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `section ${from} .. ${to} must exist`);
  return text.slice(a, b);
};

const CLOSE_OUT = read('plugin', 'skills', 'dispatch', 'close-out.md');
const MERGE = read('plugin', 'skills', '_shared', 'pr-first-merge.md');
const SUMMARY = read('plugin', 'skills', 'flow', 'summary-template.md');
const MULTI_SUMMARY = read('plugin', 'skills', 'flow', 'multispec-summary.md');

const closeOutStep3 = slice(CLOSE_OUT, '3. **Convert draft to ready', '4. **Confirmation gate');
const mergeStep1 = slice(MERGE, '## Step 1:', '## Step 1.5');

const CLOSE_OUT_PINS = [
  /verify\.json/,
  /acceptance-labeling/,
  /claude-tweaks-run:/,
  /pr-first-merge\.md.{0,40}Step 1/,
  // Anchored on "Step 1": the Mark-ready sentence already says "before the confirmation gate".
  /Step 1 before the confirmation gate/,
  /no valid .{0,40}marker.{0,80}(missing|not landed)/i,
];
const MERGE_PINS = [/verify\.json/, /acceptance-labeling/, /not landed/];
const RESIDUE_PIN = /console-residue\.js" --run "\$(PIPELINE_RUN_DIR|MULTISPEC_PARENT_DIR)" --require-verify/;

// The inserted sentences, located by their opening and closing words so the
// negative control removes exactly what this task added.
const CLOSE_OUT_ADDED = /Step 1 \(Acceptance labeling\) is guarded.*?before the confirmation gate\./;
const MERGE_ADDED = /Labeling has not landed when.*?reached this merge\./;

test('AC2.1: close-out step 3 reads verify.json and runs Step 1 before the gate when labeling has not landed', () => {
  for (const re of CLOSE_OUT_PINS) assert.match(closeOutStep3, re);
  assert.doesNotMatch(closeOutStep3, /needs no separate run here/);
});

test('AC2.1: negative control — close-out step 3 without the added rule fails each pin', () => {
  assert.match(closeOutStep3, CLOSE_OUT_ADDED, 'the added rule must be locatable');
  const stripped = closeOutStep3.replace(CLOSE_OUT_ADDED, '');
  for (const re of CLOSE_OUT_PINS) assert.doesNotMatch(stripped, re);
});

test('AC3.1: pr-first-merge Step 1 names verify.json and the not-landed condition', () => {
  for (const re of MERGE_PINS) assert.match(mergeStep1, re);
});

test('AC3.1: negative control — pr-first-merge Step 1 without the added sentence fails each pin', () => {
  assert.match(mergeStep1, MERGE_ADDED, 'the added sentence must be locatable');
  const stripped = mergeStep1.replace(MERGE_ADDED, '');
  for (const re of MERGE_PINS) assert.doesNotMatch(stripped, re);
});

test('AC4.1: both flow summary templates pass --require-verify to console-residue.js', () => {
  assert.match(SUMMARY, RESIDUE_PIN);
  assert.match(MULTI_SUMMARY, RESIDUE_PIN);
});

test('AC4.1: negative control — stripping --require-verify fails the pin', () => {
  for (const text of [SUMMARY, MULTI_SUMMARY]) {
    assert.doesNotMatch(text.replace(/ --require-verify/g, ''), RESIDUE_PIN);
  }
});
