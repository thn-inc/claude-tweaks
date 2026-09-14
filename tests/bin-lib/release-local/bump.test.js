'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bumpPart } = require('../../../plugin/bin/lib/release-local/bump.js');

const c = (type, breaking = false) => ({ type, breaking });

test('precedence: breaking > feat > fix > none', () => {
  assert.strictEqual(bumpPart([c('fix'), c('chore', true)]), 'major');
  assert.strictEqual(bumpPart([c('fix'), c('feat')]), 'minor');
  assert.strictEqual(bumpPart([c('chore'), c('fix')]), 'patch');
  assert.strictEqual(bumpPart([c('chore'), c('docs')]), 'none');
  assert.strictEqual(bumpPart([]), 'none');
});

test('an unconventional commit with a breaking footer still forces major', () => {
  assert.strictEqual(bumpPart([{ type: null, breaking: true }]), 'major');
});

test('#2327: preMajor + bump-minor-pre-major (default true) softens a breaking commit to minor', () => {
  assert.strictEqual(bumpPart([c('chore', true)], { preMajor: true }), 'minor');
  // Not preMajor: unaffected regardless of the flag — a 1.x+ line always majors on breaking.
  assert.strictEqual(bumpPart([c('chore', true)], { preMajor: false }), 'major');
  // Explicit opt-out: preMajor alone does not soften anything.
  assert.strictEqual(bumpPart([c('chore', true)], { preMajor: true, bumpMinorPreMajor: false }), 'major');
});

test('#2327: bump-patch-for-minor-pre-major defaults false — a plain feat on 0.x stays minor', () => {
  assert.strictEqual(bumpPart([c('feat')], { preMajor: true }), 'minor');
  assert.strictEqual(bumpPart([c('feat')], { preMajor: true, bumpPatchForMinorPreMajor: true }), 'patch');
  // Not preMajor: the flag never applies outside a 0.x base.
  assert.strictEqual(bumpPart([c('feat')], { preMajor: false, bumpPatchForMinorPreMajor: true }), 'minor');
});
