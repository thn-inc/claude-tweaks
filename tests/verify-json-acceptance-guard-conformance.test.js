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
  // The Landed check is single-sourced: step 3 cites the contract, it does not restate it.
  /acceptance-labeling-landed\.md/,
  /pr-first-merge\.md.{0,40}Step 1/,
  // Anchored on "Step 1": the Mark-ready sentence already says "before the confirmation gate".
  /Step 1 before the confirmation gate/,
  // No run dir resolves -> stop the candidate, never guess (and never run Step 1 blind).
  /`no run dir`.{0,160}stop this candidate/,
  /stopped: acceptance labeling unverifiable — no run dir/,
  // close-out's own choice on `no run dir`: the contract leaves the live-state tier to consumers.
  /without (running )?the live-state tier/,
  // The re-run gets verification-brief.md's inputs.
  /`PIPELINE_RUN_DIR` = the resolved run/,
  /`CLOSING_SUB_ISSUES` = the PR's `Fixes` record numbers/,
];
const MERGE_PINS = [/verify\.json/, /acceptance-labeling/, /not landed/, /pass.{0,12}skip/];
// Pins the flag's {base} value too: the CLI exits 2 on a bare --require-verify.
const RESIDUE_PIN = /console-residue\.js" --run "\$(PIPELINE_RUN_DIR|MULTISPEC_PARENT_DIR)" --require-verify \{base\}/;

// The inserted sentences, located by their opening and closing words so the
// negative control removes exactly what this task added.
const CLOSE_OUT_ADDED = /\*\*Acceptance labeling first\*\*.*?`MULTISPEC_PARENT_DIR` = the parent\./;
const MERGE_ADDED = /Labeling has not landed when.*?reached this merge\./;

test('AC3.1 + AC5.3: close-out step 3 cites the contract, keeps the no-run-dir stop and the Step 1 wiring', () => {
  for (const re of CLOSE_OUT_PINS) assert.match(closeOutStep3, re);
  assert.doesNotMatch(closeOutStep3, /needs no separate run here/);
});

test('AC3.2: close-out step 3 no longer restates the live-state tier', () => {
  assert.doesNotMatch(closeOutStep3, /run-comment: brief/);
  assert.doesNotMatch(closeOutStep3, /run-comment: try-it/);
  assert.doesNotMatch(closeOutStep3, /read every `spec-\*\/verify\.json`/);
});

test('AC2.1: negative control — close-out step 3 without the added rule fails each pin', () => {
  assert.match(closeOutStep3, CLOSE_OUT_ADDED, 'the added rule must be locatable');
  const stripped = closeOutStep3.replace(CLOSE_OUT_ADDED, '');
  for (const re of CLOSE_OUT_PINS) assert.doesNotMatch(stripped, re);
});

// Labeling (and any Step 1 run) precedes step 3's Mark-ready call — pr-first-merge's own
// Step 1 -> Step 2 order.
function assertLabelingBeforeMarkReady(step3) {
  const labeling = step3.indexOf('**Acceptance labeling first**');
  const markReady = step3.indexOf('Step 2 (Mark ready)');
  assert.ok(labeling >= 0 && markReady >= 0, 'both the labeling check and the Mark-ready call must exist');
  assert.ok(labeling < markReady, 'the labeling check must come before Mark ready');
}

test('final review: close-out step 3 checks labeling before the Mark-ready call', () => {
  assertLabelingBeforeMarkReady(closeOutStep3);
});

test('final review: negative control — Mark ready ahead of the labeling check fails the order pin', () => {
  const markReady = closeOutStep3.match(/Then, when `isDraft`.*?reads it otherwise\./)[0];
  const swapped = closeOutStep3.replace(markReady, '').replace('**Acceptance labeling first**', `${markReady} **Acceptance labeling first**`);
  assert.throws(() => assertLabelingBeforeMarkReady(swapped), assert.AssertionError);
});

const reportingSection = slice(CLOSE_OUT, '## Reporting', '## Anti-Patterns');
const NO_RUN_DIR_OUTCOME = /`stopped: acceptance labeling unverifiable — no run dir`/;

test('final review: close-out Reporting lists the no-run-dir stop outcome', () => {
  assert.match(reportingSection, NO_RUN_DIR_OUTCOME);
});

test('final review: negative control — Reporting without that outcome fails the pin', () => {
  assert.doesNotMatch(reportingSection.replace(NO_RUN_DIR_OUTCOME, ''), NO_RUN_DIR_OUTCOME);
});

const BRIEF = read('plugin', 'skills', 'wrap-up', 'verification-brief.md');
const briefRouting = slice(BRIEF, '## Routing', '## Try it block');
const CLOSE_OUT_ROW = /\| `\/claude-tweaks:dispatch`'s close-out step 3 \(`dispatch\/close-out\.md`\) \| one or more \*\*sub-issues\*\* \(the PR's `Fixes` records\)/;

test('final review: verification-brief.md routing table lists close-out step 3 as a caller', () => {
  assert.match(briefRouting, /Five call sites exist today/);
  assert.match(briefRouting, CLOSE_OUT_ROW);
});

test('final review: negative control — the routing table without the close-out row fails the pin', () => {
  assert.doesNotMatch(briefRouting.replace(CLOSE_OUT_ROW, ''), CLOSE_OUT_ROW);
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
    assert.doesNotMatch(text.replace(/ --require-verify \{base\}/g, ' --require-verify'), RESIDUE_PIN);
  }
});
