'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reviseSpecSummary } = require('../../../plugin/bin/lib/flow/pr-body');

test('a fenced Spec summary heading does not start the span', () => {
  const b = '```\n### Spec summary\n```\n\n### Spec summary\n\nOld.\n\n### Phases\n\nkeep\n';
  const r = reviseSpecSummary({ body: b, reversals: [{ original: 'a', replacement: 'b' }], summary: 'New.' });
  assert.equal(r.changed, true);
  assert.ok(r.body.startsWith('```\n### Spec summary\n```\n'), 'fenced block must be untouched');
  assert.doesNotMatch(r.body, /Old\./);
  assert.match(r.body, /### Phases\n\nkeep/);
});
