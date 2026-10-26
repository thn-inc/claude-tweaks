'use strict';
// #2949: shaping mode (the primary #N/comma-list /specify path) must run the same
// diagram-suggestion detection decomposition mode's Step 2.5d already runs, per
// record, citing the shared table rather than restating it — and must honor the
// interactive/headless rendering split (STAGED log line, never an inline block,
// under bare drain / `next` / `--chained`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const read = (rel) => readText(path.join(__dirname, '..', rel));

const READBACK = 'plugin/skills/specify/shaping-mode-readback.md';

function section(text, startHeading, endHeading) {
  const start = text.indexOf(startHeading);
  assert.ok(start >= 0, `missing heading: ${startHeading}`);
  const end = text.indexOf(endHeading, start + startHeading.length);
  assert.ok(end > start, `missing heading after ${startHeading}: ${endHeading}`);
  return text.slice(start, end);
}

test('shaping-mode-readback.md has a Diagram suggestion section citing the shared file', () => {
  const src = read(READBACK);
  assert.match(src, /^### Diagram suggestion\b/m, 'missing ### Diagram suggestion section heading');
  const diagramSection = section(src, '### Diagram suggestion', '### Read-back verification');
  assert.match(diagramSection, /diagram-suggestion\.md/, 'must cite the shared detection file');
  assert.ok(!diagramSection.includes('named status enums'), 'must not restate the detection table inline');
  assert.ok(!diagramSection.includes('foreign key'), 'must not restate the detection table inline');
  assert.match(diagramSection, /disabled or missing/i, 'must restate the Gate\'s disabled-or-missing wording for this citation');
});

test('shaping-mode-readback.md runs the diagram-suggestion step per record, against the composed body', () => {
  const src = read(READBACK);
  const diagramSection = section(src, '### Diagram suggestion', '### Read-back verification');
  assert.match(diagramSection, /composed body/, 'must run against the already-composed body, not a re-fetch');
  assert.match(diagramSection, /per record|each record/i, 'must state it runs once per record on a batch');
  assert.match(diagramSection, /at most two|capped at two/i, 'must restate the per-record two-suggestion cap for the batch case');
});

test('shaping-mode-readback.md splits interactive render from headless STAGED logging', () => {
  const src = read(READBACK);
  const diagramSection = section(src, '### Diagram suggestion', '### Read-back verification');
  assert.match(diagramSection, /--chained/, 'must name --chained as a headless posture');
  assert.match(diagramSection, /\bnext\b/i, 'must name the next-form headless posture');
  assert.match(diagramSection, /headless posture/i, 'must name the general headless posture phrase');
  assert.match(diagramSection, /STAGED/, 'must describe the headless STAGED log line');
});

test('shaping-mode-readback.md renders an optional Diagram suggestions block after Actions Performed', () => {
  const src = read(READBACK);
  const actionsAt = src.indexOf('### Actions Performed');
  assert.ok(actionsAt >= 0, 'Actions Performed section missing');
  const blockAt = src.indexOf('### Diagram suggestions', actionsAt);
  assert.ok(blockAt > actionsAt, 'Diagram suggestions render block must come after Actions Performed');
  const block = src.slice(blockAt, blockAt + 400);
  assert.match(block, /optional/i, 'the render block must be marked optional (omit when nothing emitted)');
});
