'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripComments, stripperVerdict } = require('../helpers/strip-comments');

const ROOT = path.resolve(__dirname, '..', '..');

test('AC9.1: the hook and the parser share one status-line module (subagent-stop.js keeps no pattern of its own)', () => {
  const sl = require('../../plugin/bin/lib/status-line');
  assert.ok(sl.CANONICAL_RE.test('STATUS: DONE'));
  assert.ok(!sl.CANONICAL_RE.test('STATUS: DONE.'));
  assert.ok(sl.LENIENT_RE.test('- **Status:** BLOCKED'));
  assert.deepStrictEqual([...sl.STATUS_WORDS], ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED']);
  const raw = fs.readFileSync(path.join(ROOT, 'plugin/bin/lib/hooks/subagent-stop.js'), 'utf8');
  const src = stripComments(raw);
  assert.equal(stripperVerdict(raw, src), 'ok');
  assert.match(src, /require\(['"]\.\.\/status-line['"]\)/);
  assert.doesNotMatch(src, /\/\^STATUS: \(DONE/);
});
