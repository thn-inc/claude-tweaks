// tests/bin-lib/issues/named-target.test.js — #1983: namedTarget(record) extracts the
// single file a by:docs-health record names as its subject, in both the pre-#1851 bare-id
// header form and the post-#1851 already-repo-relative form, and returns null for every
// other origin (this module never guesses a target from prose).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { namedTarget } = require('../../../plugin/bin/lib/issues/named-target');

test('namedTarget derives docs/{id}.md from the pre-#1851 bare-id Doc: header form', () => {
  const record = {
    labels: ['by:docs-health', 'docs-health:additive', 'risk:low', 'size:low'],
    body: '**Doc:** decisions/0007-foo | **Section:** Freshness | **Category:** staleness | **Misleads:** agent | **Classification:** additive | **Confidence:** high',
  };
  assert.deepStrictEqual(namedTarget(record), { path: 'docs/decisions/0007-foo.md' });
});

test('namedTarget returns the Doc: header value as-is when it is already a repo-relative docs/*.md path (#1851)', () => {
  const record = {
    labels: ['by:docs-health'],
    body: '**Doc:** docs/api.md | **Section:** Overview | **Category:** genre-drift | **Misleads:** human engineer | **Classification:** additive | **Confidence:** high',
  };
  assert.deepStrictEqual(namedTarget(record), { path: 'docs/api.md' });
});

test('namedTarget returns null for a non-docs-health origin', () => {
  const record = {
    labels: ['by:capture', 'ready'],
    body: '### Key Files\n\n- `plugin/bin/foo.js` (modify)',
  };
  assert.strictEqual(namedTarget(record), null);
});

test('namedTarget returns null for a by:docs-health record with no Doc: header (malformed body)', () => {
  const record = {
    labels: ['by:docs-health'],
    body: 'no header line here',
  };
  assert.strictEqual(namedTarget(record), null);
});

test('namedTarget returns null when the record has no labels', () => {
  assert.strictEqual(namedTarget({ body: '**Doc:** decisions/0007-foo | **Section:** x' }), null);
});
