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
