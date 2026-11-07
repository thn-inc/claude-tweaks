'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const TRUST = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'trust-table.md'));
const REFINE = readText(path.join(ROOT, 'plugin', 'skills', 'backlog', 'refine-mode.md'));

test('label-filtered fetch warnings account for GitHub 1000-result ceiling', () => {
  const expected = '>= Math.min(Number(process.env.FETCH_LIMIT), 1000)';
  const trustConditions = [...TRUST.matchAll(/if \(parents\.length (.*?)\) \{/g)].map((m) => m[1]);
  assert.deepEqual(trustConditions, Array(3).fill(expected), 'all trust-table label fetches must cap their warning threshold at 1000 results');
  assert.equal((TRUST.match(/GitHub's 1000-result ceiling/g) || []).length, 3, 'each trust-table warning must name GitHub\'s 1000-result ceiling');
  assert.match(REFINE, /if \(issues\.length >= Math\.min\(Number\(process\.env\.FETCH_LIMIT\), 1000\)\)/, 'refine ready fetch must cap its warning threshold at 1000 results');
  assert.match(REFINE, /GitHub's 1000-result ceiling/, 'refine warning must name GitHub\'s 1000-result ceiling');
});
