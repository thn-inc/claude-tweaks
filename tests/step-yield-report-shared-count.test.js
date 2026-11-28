'use strict';
// tools/step-yield-report.js reuses the shipped review-lens history's confirmed count and start-time rule
// instead of keeping a second copy (record #5998).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { stripComments, stripperVerdict } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const report = require(path.join(ROOT, 'tools', 'step-yield-report.js'));
const history = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'review-lens', 'history'));

test('the report uses the shipped confirmedCount and startedAtOf', () => {
  assert.equal(report.startedAtOf, history.startedAtOf);
  const raw = readText(path.join(ROOT, 'tools', 'step-yield-report.js'));
  assert.equal(stripperVerdict(raw), 'ok');
  const src = stripComments(raw);
  assert.ok(src.includes('confirmedCount('), 'the report calls confirmedCount(');
  assert.ok(!src.includes('num(f.both) + num('), 'the report keeps no second copy of the count');
});
