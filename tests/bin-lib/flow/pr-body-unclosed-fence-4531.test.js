'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reviseSpecSummary } = require('../../../plugin/bin/lib/flow/pr-body');

test('an unclosed fence inside the Spec summary does not swallow the following sections', () => {
  const b = '### Spec summary\n\nOld.\n\n```\nstray\n\n### Phases\n\nkeep\n';
  const r = reviseSpecSummary({ body: b, reversals: [{ original: 'a', replacement: 'b' }], summary: 'New.' });
  assert.equal(r.changed, true);
  assert.match(r.body, /### Phases\n\nkeep/);
});
