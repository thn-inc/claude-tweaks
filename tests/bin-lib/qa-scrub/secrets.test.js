'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSecrets } = require('../../../plugin/bin/lib/qa-scrub/secrets');
const { scrubLine } = require('../../../plugin/bin/lib/qa-scrub/line');

test('parses pattern and role/label/placeholder locators', () => {
  const { secrets, error } = parseSecrets([
    { pattern: 'FAKE-QA-TOKEN-\\d{4}' },
    { locator: { role: 'textbox', name: 'API key' } },
    { locator: { role: 'code' } },
    { locator: { label: 'Your token' } },
    { locator: { placeholder: 'Paste key' } },
  ]);
  assert.equal(error, undefined);
  assert.equal(secrets.length, 5);
  assert.equal(secrets[0].kind, 'pattern');
  assert.ok(secrets[0].regex instanceof RegExp);
  assert.ok(secrets[0].regex.flags.includes('g'));
  assert.equal(secrets[0].source, 'FAKE-QA-TOKEN-\\d{4}');
  assert.deepEqual(secrets[1], { kind: 'locator', locator: { role: 'textbox', name: 'API key' } });
  assert.deepEqual(secrets[2], { kind: 'locator', locator: { role: 'code' } });
  assert.deepEqual(secrets[3], { kind: 'locator', locator: { label: 'Your token' } });
  assert.deepEqual(secrets[4], { kind: 'locator', locator: { placeholder: 'Paste key' } });
});

test('refuses testid and text locators with named codes', () => {
  assert.deepEqual(parseSecrets([{ locator: { testid: 'tok' } }]), { error: 'locator-testid-unsupported: entry 0' });
  assert.deepEqual(parseSecrets([{ pattern: 'x{4}' }, { locator: { text: 'abc' } }]), { error: 'locator-text-unsupported: entry 1' });
});

test('refuses a pattern that matches the empty string', () => {
  assert.deepEqual(parseSecrets([{ pattern: '.*' }]), { error: 'pattern-matches-empty: entry 0' });
  assert.deepEqual(parseSecrets([{ pattern: 'a?' }]), { error: 'pattern-matches-empty: entry 0' });
});

test('refuses an invalid regex without echoing it', () => {
  const r = parseSecrets([{ pattern: 'SECRETISH(' }]);
  assert.equal(r.error, 'pattern-invalid: entry 0');
  assert.doesNotMatch(r.error, /SECRETISH/);
});

test('refuses an empty array, a non-array, and an entry with both keys', () => {
  assert.deepEqual(parseSecrets([]), { error: 'secrets-empty' });
  assert.deepEqual(parseSecrets({ pattern: 'abc' }), { error: 'secrets-not-array' });
  assert.deepEqual(parseSecrets(null), { error: 'secrets-not-array' });
  assert.deepEqual(parseSecrets([{ pattern: 'abc', locator: { label: 'x' } }]), { error: 'entry-shape: entry 0' });
  assert.deepEqual(parseSecrets([{}]), { error: 'entry-shape: entry 0' });
  assert.deepEqual(parseSecrets(['abc']), { error: 'entry-shape: entry 0' });
  assert.deepEqual(parseSecrets([{ pattern: '' }]), { error: 'pattern-invalid: entry 0' });
  assert.deepEqual(parseSecrets([{ locator: { label: 'x', placeholder: 'y' } }]), { error: 'locator-shape: entry 0' });
  assert.deepEqual(parseSecrets([{ locator: { name: 'x' } }]), { error: 'locator-shape: entry 0' });
  assert.deepEqual(parseSecrets([{ locator: { label: '' } }]), { error: 'locator-shape: entry 0' });
  assert.deepEqual(parseSecrets([{ locator: { css: '.tok' } }]), { error: 'locator-shape: entry 0' });
});

test('AC3.1: scrubLine renders the exact copy', () => {
  assert.equal(
    scrubLine({ values_scrubbed: 1, artifacts_scrubbed: 4, screenshots_removed: 2 }),
    '1 secret value(s) scrubbed from 4 artifact(s); 2 screenshot(s) removed',
  );
});
