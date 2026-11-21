'use strict';
// tools/step-yield-report.js reuses the shipped review-lens history's confirmed count and start-time rule
// instead of keeping a second copy (record #5998).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const report = require(path.join(ROOT, 'tools', 'step-yield-report.js'));
const history = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'review-lens', 'history'));

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the report uses the shipped confirmedCount and startedAtOf', () => {
  assert.equal(report.startedAtOf, history.startedAtOf);
  const src = stripComments(fs.readFileSync(path.join(ROOT, 'tools', 'step-yield-report.js'), 'utf8'));
  assert.ok(src.includes('confirmedCount('), 'the report calls confirmedCount(');
  assert.ok(!src.includes('num(f.both) + num('), 'the report keeps no second copy of the count');
});
