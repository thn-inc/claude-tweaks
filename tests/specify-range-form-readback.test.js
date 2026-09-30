'use strict';

// Prose-pin for /specify's range-form input and shaping-mode's read-back
// verification step (refs #705). Both are documented in prose only (skill
// markdown), so a later slimming pass could silently drop either without any
// test noticing — mirrors tests/specify-batch-input.test.js's rationale for
// the comma-list form these two build on.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readFlat = (rel) => read(rel).replace(/\s+/g, ' ');

test('specify SKILL.md documents the #A-#B/#A–#B range form and its expansion rule', () => {
  const src = readFlat('plugin/skills/specify/SKILL.md');
  assert.ok(src.includes('**Range form (`#A-#B`/`#A–#B` — shaping-mode-only).**'), 'Range form paragraph marker missing from SKILL.md');
  assert.ok(src.includes('expands to the equivalent comma-joined list'), 'range-to-comma-list expansion rule missing from SKILL.md');
  // The leading backtick here closes `A`'s code span from the prose ("`A`
  // must be less than or equal to `B`") -- the substring starts mid-span by
  // design, not a typo, since assert.ok(includes(...)) only needs a
  // contiguous slice, not a self-balanced one.
  assert.ok(src.includes('A` must be less than or equal to `B`'), 'A <= B validation rule missing from SKILL.md');
});

test('specify SKILL.md wires range expansion into the batch-branch resolution bullet', () => {
  const src = readFlat('plugin/skills/specify/SKILL.md');
  assert.ok(src.includes('first, expand a range-form first argument'), 'batch-branch bullet does not mention range expansion');
  // The pre-existing sequential-per-element rule this task must not disturb:
  assert.ok(src.includes('a loop never a fan-out (no Task dispatch, one record at a time)'), 'pre-existing sequential-per-element rule was disturbed');
});

test('specify SKILL.md caps the range form at 25 expanded elements with a hard-error message', () => {
  const src = readFlat('plugin/skills/specify/SKILL.md');
  assert.ok(src.includes('ranges are capped at 25'), 'range expansion cap (25 elements) hard-error message missing from SKILL.md');
});

test('specify SKILL.md rejects a malformed range at case 1 rather than silently falling through to topic resolution', () => {
  const src = readFlat('plugin/skills/specify/SKILL.md');
  assert.ok(src.includes('looks like a range but is not valid'), 'malformed-range hard-error message missing from SKILL.md');
  assert.ok(src.includes('Range-shaped rejection point'), 'range-shaped rejection point clause missing from the batch-branch bullet');
  assert.ok(
    src.includes("it never falls through to case 2's path check or cases 3-5's topic/backlog resolution"),
    'no-fallthrough-to-topic-resolution rule missing',
  );
});

test('shaping-mode.md documents mandatory read-back verification after each record write', () => {
  // #1346 split shaping-mode.md at the ### Metadata block boundary; the
  // ### Read-back verification subsection landed in shaping-mode-stamping.md.
  const src = readFlat('plugin/skills/specify/shaping-mode-stamping.md');
  assert.ok(src.includes('### Read-back verification'), 'Read-back verification subsection missing from shaping-mode-stamping.md');
  assert.ok(src.includes('re-fetch the record fresh'), 'read-back re-fetch rule missing');
  assert.ok(src.includes('does **not** roll back the write or stop the batch'), 'read-back failure-isolation rule missing');
  // Ordering language: the read-back for record k must complete before record k+1 starts.
  assert.ok(src.includes('before moving to the next record in the batch'), 'read-back per-record ordering language missing');
  for (const token of ['`ready` is present', 'six spec-shaped sections', 'No unresolved placeholder marker']) {
    assert.ok(src.includes(token), `read-back assertion "${token}" missing`);
  }
  // The pre-existing outcome vocabulary this task must not disturb:
  assert.ok(src.includes('no `skipped` outcome'), 'pre-existing stop-all rationale for the missing skipped outcome was disturbed');
  // The `failed` outcome prefix (a write OR read-back failure) referenced by
  // Actions Performed's opening sentence:
  assert.ok(src.includes('or whose read-back verification (above) failed'), 'Actions Performed write-failure sentence missing its read-back-failure extension');
  // The read-back check is symmetric on the framing verdict, not just the
  // open-verdict absence check — it also asserts presence on solution-baked.
  assert.ok(src.includes('the verdict was `solution-baked`, `solution:unjustified` is present instead'), 'read-back solution-baked presence assertion missing');
});
