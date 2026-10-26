'use strict';
// #2949: the diagram-suggestion signal-detection table must live in exactly one
// place that both decomposition mode (Step 2.5d) and shaping mode cite — never
// restated per mode. This pins the shared file's required sections and content,
// and pins that decomposition-mode.md no longer carries its own copy of the table.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const read = (rel) => readText(path.join(__dirname, '..', rel));

const SHARED = 'plugin/skills/specify/diagram-suggestion.md';
const DECOMPOSITION = 'plugin/skills/specify/decomposition-mode.md';

test('diagram-suggestion.md exists with the required sections', () => {
  const src = read(SHARED);
  assert.match(src, /^## Gate$/m, 'missing ## Gate section');
  assert.match(src, /^## Detection$/m, 'missing ## Detection section');
  assert.match(src, /^## Output format$/m, 'missing ## Output format section');
  assert.match(src, /^## Rendering/m, 'missing ## Rendering section');
});

test('diagram-suggestion.md carries the six-row detection table', () => {
  const src = read(SHARED);
  for (const type of ['`state`', '`er`', '`sequence`', '`flowchart`', '`architecture`', '`tree`']) {
    assert.ok(src.includes(type), `detection table missing a row for ${type}`);
  }
  assert.match(src, /at most \*\*two\*\*/, 'missing the emit-at-most-two rule');
  assert.match(src, /Skip emission entirely if no signal matches/, 'missing the skip-if-no-signal rule');
});

test('diagram-suggestion.md Gate section reads the CLAUDE.md diagram-suggestions flag', () => {
  const src = read(SHARED);
  const gate = src.slice(src.indexOf('## Gate'), src.indexOf('## Detection'));
  assert.match(gate, /diagram-suggestions/);
  assert.match(gate, /disabled.*or missing/i);
});

test('diagram-suggestion.md Detection section is input-agnostic (not hard-coded to one record body)', () => {
  const src = read(SHARED);
  const detection = src.slice(src.indexOf('## Detection'), src.indexOf('## Output format'));
  // Must describe scanning "the given text" / "the text" rather than naming
  // only "the record's body" or only "the design doc" — both callers reuse it.
  assert.match(detection, /the given text|Scan the text/, 'Detection section must stay caller-agnostic');
});

test('diagram-suggestion.md Rendering section states the STAGED log-line shape with a caller-supplied step id', () => {
  const src = read(SHARED);
  assert.match(src, /STAGED \{time\} — \{step-id\}: diagram-suggestion \(\{type\}\) for \{ref-or-slug\}\. Reversibility: high\./);
});

test('decomposition-mode.md Step 2.5d cites the shared file instead of restating the table', () => {
  const src = read(DECOMPOSITION);
  const at = src.indexOf('## Step 2.5d');
  assert.ok(at >= 0, 'Step 2.5d heading missing from decomposition-mode.md');
  const next = src.indexOf('\n## ', at + 1);
  const section = src.slice(at, next > 0 ? next : undefined);
  assert.match(section, /diagram-suggestion\.md/, 'Step 2.5d no longer cites diagram-suggestion.md');
  assert.ok(!section.includes('named status enums'), 'Step 2.5d still restates the detection table inline');
  assert.ok(!section.includes('foreign key'), 'Step 2.5d still restates the detection table inline');
  // Framing that stays local to decomposition mode:
  assert.match(section, /runs for every surface/);
  assert.match(section, /### Diagram suggestions/, 'Step 2.5d must still name the Step 9 summary block it feeds');
});
