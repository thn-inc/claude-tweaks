'use strict';

// #4221: the review-effort tier is the higher of the record-label tier and the diff-heuristic tier,
// and a summary records both inputs when they differ. Pins the rule in review-effort-derivation.md
// (step 4 "Take the higher", the worked #4028 example), the both-inputs form in code-mode-steps.md
// Step 2.5, and the Step 7 summary line in review-summary-template.md.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');

const REVIEW_DIR = path.join(__dirname, '..', 'plugin', 'skills', 'review');

const DERIVATION = readText(path.join(REVIEW_DIR, 'review-effort-derivation.md'));
const CODE_MODE_STEPS = readText(path.join(REVIEW_DIR, 'code-mode-steps.md'));
const SUMMARY_TEMPLATE = readText(path.join(REVIEW_DIR, 'review-summary-template.md'));

const TIER_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];
const RECORD_LABELS_FORM = 'record labels: risk:{x} × size:{y}';
const BOTH_INPUTS_FORM = 'label {a}, diff heuristic {b}';

// Parse the risk × record-size combination table into lookup[risk][size]. Fails loudly on a mis-parse.
function parseCombinationTable(text) {
  const rowRe = /^\s*\| \*\*(low|medium|high)\*\* \|(.*)\|$/gm;
  const lookup = {};
  for (const m of text.matchAll(rowRe)) {
    const cells = m[2].split('|').map((c) => c.trim());
    assert.equal(cells.length, 3, `row for risk ${m[1]} must carry 3 size cells, got ${cells.length}`);
    for (const cell of cells) {
      assert.ok(TIER_ORDER.includes(cell), `cell "${cell}" in risk ${m[1]} row is not a tier`);
    }
    lookup[m[1]] = { low: cells[0], medium: cells[1], high: cells[2] };
  }
  assert.equal(Object.keys(lookup).length, 3, 'combination table must parse to 3 risk rows');
  return lookup;
}

function paragraphWith(text, fragment) {
  return text.split('\n\n').find((p) => p.includes(fragment));
}

function lineStartingWith(text, prefix) {
  return text.split('\n').find((line) => line.startsWith(prefix));
}

test('the combination table parses to 3 risk rows x 3 size columns', () => {
  const table = parseCombinationTable(DERIVATION);
  assert.deepEqual(Object.keys(table).sort(), ['high', 'low', 'medium']);
});

test('AC1: risk:low x size:medium labels resolve to low, and a 142-file diff resolves to high', () => {
  const table = parseCombinationTable(DERIVATION);
  assert.equal(table.low.medium, 'low', 'label tier for risk:low x size:medium');
  assert.equal(table.medium.high, 'high', 'diff tier for a medium-risk, high-size diff');
  assert.ok(DERIVATION.includes('**high** at 10+ files'), '142 files must reach the size-proxy high threshold');

  const higher = TIER_ORDER[Math.max(TIER_ORDER.indexOf(table.low.medium), TIER_ORDER.indexOf(table.medium.high))];
  assert.equal(higher, 'high', 'the higher of the label tier and the diff tier must be high');

  const example = paragraphWith(DERIVATION, '#4028');
  assert.ok(example, 'derivation must carry the #4028 worked example');
  assert.ok(example.includes('label low, diff heuristic high'), 'worked example must record both inputs');
  assert.ok(example.includes('cross-package interface gives risk proxy `medium`'), 'worked example must name the diff risk proxy');
  assert.ok(example.includes('10+ files gives size proxy `high`'), 'worked example must name the diff size proxy');
});

test('the rule is stated and pinned: labels never lower a tier the diff already earns', () => {
  assert.ok(DERIVATION.includes('labels never lower a tier the diff already earns'));
  assert.match(DERIVATION, /resolved tier is the higher of the label tier and the diff tier/);
});

test('AC2: when labels and diff agree, the derivation keeps the record-labels source', () => {
  const agreement = DERIVATION.match(/When the two agree, the recorded source stays `record labels: risk:\{x\} × size:\{y\}`/);
  assert.ok(agreement, 'derivation must state the "When the two agree" sentence with the record-labels source');
  assert.doesNotMatch(DERIVATION, /stop at the first that applies/, 'resolution lead-in must not say to stop at the first step');
});

test('code-mode-steps.md Step 2.5 records both the record-labels form and the both-inputs form', () => {
  const recordLine = lineStartingWith(CODE_MODE_STEPS, 'Record the resolved tier');
  assert.ok(recordLine, 'Step 2.5 must carry the "Record the resolved tier" line');
  assert.ok(recordLine.includes(RECORD_LABELS_FORM), 'record line must keep the record-labels form');
  assert.ok(recordLine.includes(BOTH_INPUTS_FORM), 'record line must offer the both-inputs form');
});

test('review-summary-template.md Review effort line records both the record-labels form and the both-inputs form', () => {
  // Line 20 is the compact template and defers to this full-template line, which names the derivation sources.
  const effortLine = lineStartingWith(SUMMARY_TEMPLATE, '**Review effort:** {tier} (derived from');
  assert.ok(effortLine, 'template must carry the full-template **Review effort:** line');
  assert.ok(effortLine.includes(RECORD_LABELS_FORM), 'effort line must keep the record-labels form');
  assert.ok(effortLine.includes(BOTH_INPUTS_FORM), 'effort line must offer the both-inputs form');
});

test('code-mode-steps.md floor reference names step 5, not the old step 4', () => {
  assert.ok(CODE_MODE_STEPS.includes("step 5's `review-effort-floor`"), 'floor reference must name step 5');
  assert.ok(!CODE_MODE_STEPS.includes("step 4's `review-effort-floor`"), 'stale step 4 floor reference must be gone');
});
