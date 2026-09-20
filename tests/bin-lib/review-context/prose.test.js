'use strict';

// #1893: review-effort-derivation.md read as if `build-review-context.js mint` prints a bare
// directory path (it prints a one-line JSON object by default). Pins that the prose now names
// the actual JSON shape and the `--print-dir` flag, and that step3-lens-dispatch.md defines
// `{ctx-dir}` before it is first used as a bare path.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');

const EFFORT_DERIVATION = fs.readFileSync(
  path.join(ROOT, 'plugin', 'skills', 'review', 'review-effort-derivation.md'),
  'utf8',
);
const LENS_DISPATCH = fs.readFileSync(
  path.join(ROOT, 'plugin', 'skills', 'review', 'step3-lens-dispatch.md'),
  'utf8',
);

test('review-effort-derivation.md names the JSON shape mint prints by default', () => {
  assert.match(EFFORT_DERIVATION, /\{"dir":\s*"…"\}/);
});

test('review-effort-derivation.md uses --print-dir for the {ctx-dir} shell variable', () => {
  assert.match(EFFORT_DERIVATION, /mint --print-dir --run "\$PIPELINE_RUN_DIR"/);
});

test('review-effort-derivation.md documents the .dir fallback for a pre-flag build', () => {
  assert.match(EFFORT_DERIVATION, /JSON\.parse\(require\('fs'\)\.readFileSync\(0\)\)\.dir/);
});

test('step3-lens-dispatch.md defines {ctx-dir} before using it as a bare path in --dir {ctx-dir}', () => {
  const usageIndex = LENS_DISPATCH.indexOf('--dir {ctx-dir}');
  const definitionIndex = LENS_DISPATCH.indexOf('{ctx-dir}` is that path');
  assert.notEqual(usageIndex, -1, 'expected a --dir {ctx-dir} reuse call in step3-lens-dispatch.md');
  assert.notEqual(definitionIndex, -1, 'expected {ctx-dir} to be defined as the printed bare path');
  assert.ok(
    definitionIndex < usageIndex,
    '{ctx-dir} must be defined before the --dir {ctx-dir} reuse call that follows it',
  );
});
