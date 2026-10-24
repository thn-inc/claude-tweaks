// tests/reverify-before-write-conformance.test.js
// Pins plugin/skills/_shared/reverify-before-write.md's pattern/policy text and
// each of its three consumers' citation of it (record #843). Deliberately
// does not re-pin any consumer's own reverify mechanics (which labels/fields,
// how a mismatch is logged, the Invariant-based re-derivation) — that stays
// owned by each consumer's existing prose, per the contract's "What the
// contract does not decide" section.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(REPO_ROOT, rel));

const CONTRACT_PATH = 'plugin/skills/_shared/reverify-before-write.md';
const CONTRACT = read(CONTRACT_PATH);

function collapseWhitespace(s) {
  return s.replace(/\s+/g, ' ');
}

// --- the contract states its own recognition + policy ---

test('reverify-before-write.md names the recognition shape (confirm-then-apply + unbounded wait)', () => {
  assert.ok(CONTRACT.includes('unbounded human-confirmation gate'));
  assert.ok(CONTRACT.includes('confirm-then-apply'));
});

test('reverify-before-write.md states the skip-on-mismatch, fail-closed policy', () => {
  assert.ok(CONTRACT.includes('Skip the write rather than overwriting a fresher decision'));
  assert.ok(CONTRACT.includes('fail closed'));
});

test('reverify-before-write.md names all three consumers in its "does not decide" section', () => {
  assert.ok(CONTRACT.includes('tidy/step-6-auto.md'));
  assert.ok(CONTRACT.includes('backlog/refine-mode.md'));
  assert.ok(CONTRACT.includes('_shared/staged-patch.md'));
});

// --- each consumer cites the contract (case-insensitive, content-anchored),
// paired with a whitespace-spanning control so a mid-line-wrapped citation
// still matches ---

const CONSUMER_FILES = [
  'plugin/skills/tidy/step-6-auto.md',
  'plugin/skills/backlog/refine-mode.md',
  'plugin/skills/_shared/staged-patch.md',
];

for (const rel of CONSUMER_FILES) {
  test(`${rel} cites _shared/reverify-before-write.md (case-insensitive)`, () => {
    const content = read(rel);
    assert.match(content, /_shared\/reverify-before-write\.md/i, rel);
  });

  test(`${rel} cites _shared/reverify-before-write.md (whitespace-spanning control)`, () => {
    const collapsed = collapseWhitespace(read(rel));
    assert.match(collapsed, /_shared\/reverify-before-write\.md/i, rel);
  });
}

// --- backlog/refine-mode.md no longer carries its retired standalone
// "General rule" restatement (the pure-rationale paragraph); its own
// label/body reverify mechanics (Step 5's per-field diff procedure) are
// deliberately not pinned here — outcome wording stays owned by the consumer ---

test('refine-mode.md no longer restates the general-rule rationale standalone', () => {
  const content = read('plugin/skills/backlog/refine-mode.md');
  assert.ok(!content.includes('Any batch-confirm-then-apply flow with a long-lived `AskUserQuestion` gate between building a row\'s premise and writing it needs this same pre-write reverify — the gate\'s wait time is unbounded and nothing else in this plugin guards the window.'));
});

test('refine-mode.md no longer restates the general-rule rationale standalone (whitespace-spanning control)', () => {
  const collapsed = collapseWhitespace(read('plugin/skills/backlog/refine-mode.md'));
  const collapsedRetired = collapseWhitespace('Any batch-confirm-then-apply flow with a long-lived `AskUserQuestion` gate between building a row\'s premise and writing it needs this same pre-write reverify — the gate\'s wait time is unbounded and nothing else in this plugin guards the window.');
  assert.ok(!collapsed.includes(collapsedRetired));
});

// --- outcome wording survives verbatim in each consumer (the "consumers own
// outcomes" half made concrete) ---

test('step-6-auto.md keeps its gate-still-due outcome wording', () => {
  assert.ok(read('plugin/skills/tidy/step-6-auto.md').includes('re-verifies the gate is still `due` with freshly read state'));
});

test('refine-mode.md keeps its per-row label/body diff mechanics', () => {
  const content = read('plugin/skills/backlog/refine-mode.md');
  assert.ok(content.includes("re-fetch that record's live labels"));
  assert.ok(content.includes('re-fetch the record\'s live body'));
});

test('staged-patch.md keeps its Invariant-based re-derivation outcome', () => {
  const content = read('plugin/skills/_shared/staged-patch.md');
  assert.ok(content.includes("re-derives from the `Invariant:` line"));
  assert.ok(content.includes('re-derived from Invariant via direct edit'));
});

// --- skill-graph edges exist for the two skill-level consumers ---

test('docs/skill-graph.md carries edges to the new contract from backlog and tidy', () => {
  const graph = read('docs/skill-graph.md');
  const matches = graph.match(/_shared\/reverify-before-write\.md/g) || [];
  assert.ok(matches.length >= 2, `found ${matches.length} edges, expected >= 2`);
});
