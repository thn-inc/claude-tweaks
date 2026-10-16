'use strict';
// #2949: shaping mode (the primary #N/comma-list /specify path) must run the same
// diagram-suggestion detection decomposition mode's Step 2.5d already runs, per
// record, citing the shared table rather than restating it — and must honor the
// interactive/headless rendering split (STAGED log line, never an inline block,
// under bare drain / `next` / `--chained`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const READBACK = 'plugin/skills/specify/shaping-mode-readback.md';

test('shaping-mode-readback.md has a Diagram suggestion section citing the shared file', () => {
  const src = read(READBACK);
  assert.match(src, /^### Diagram suggestion\b/m, 'missing ### Diagram suggestion section heading');
  const at = src.indexOf('### Diagram suggestion');
  const section = src.slice(at, src.indexOf('### Read-back verification'));
  assert.ok(section.length > 0, 'Diagram suggestion section must precede Read-back verification');
  assert.match(section, /diagram-suggestion\.md/, 'must cite the shared detection file');
  assert.ok(!section.includes('named status enums'), 'must not restate the detection table inline');
  assert.ok(!section.includes('foreign key'), 'must not restate the detection table inline');
});

test('shaping-mode-readback.md runs the diagram-suggestion step per record, against the composed body', () => {
  const src = read(READBACK);
  const section = src.slice(src.indexOf('### Diagram suggestion'), src.indexOf('### Read-back verification'));
  assert.match(section, /composed body/, 'must run against the already-composed body, not a re-fetch');
  assert.match(section, /per record|each record/i, 'must state it runs once per record on a batch');
  assert.match(section, /at most two|capped at two/i, 'must restate the per-record two-suggestion cap for the batch case');
});

test('shaping-mode-readback.md splits interactive render from headless STAGED logging', () => {
  const src = read(READBACK);
  const section = src.slice(src.indexOf('### Diagram suggestion'), src.indexOf('### Read-back verification'));
  assert.match(section, /--chained/, 'must name --chained as a headless posture');
  assert.match(section, /next.*headless posture|headless posture/i, 'must name the next-form headless posture');
  assert.match(section, /STAGED/, 'must describe the headless STAGED log line');
});

test('shaping-mode-readback.md renders an optional Diagram suggestions block after Actions Performed', () => {
  const src = read(READBACK);
  const actionsAt = src.indexOf('### Actions Performed');
  const blockAt = src.indexOf('### Diagram suggestions', actionsAt);
  assert.ok(actionsAt >= 0, 'Actions Performed section missing');
  assert.ok(blockAt > actionsAt, 'Diagram suggestions render block must come after Actions Performed');
  const block = src.slice(blockAt, blockAt + 400);
  assert.match(block, /optional/i, 'the render block must be marked optional (omit when nothing emitted)');
});
