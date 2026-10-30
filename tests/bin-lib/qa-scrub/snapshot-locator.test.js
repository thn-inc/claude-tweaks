'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('../../helpers/read-skill');
const { resolveLocatorValues } = require('../../../plugin/bin/lib/qa-scrub/snapshot-locator');

const YAML = readText(path.join(__dirname, '..', '..', 'fixtures', 'qa-scrub', 'page-reveal.yml'));

test('AC6.1: role+name resolves the inline value from fixture snapshot YAML', () => {
  assert.deepEqual(resolveLocatorValues(YAML, { role: 'textbox', name: 'API key' }), ['FAKE-QA-KEY-9999']);
});

test('label resolves a descendant code value and descendant text', () => {
  assert.deepEqual(resolveLocatorValues(YAML, { label: 'Your token' }), [
    'FAKE-QA-TOKEN-0000-not-a-real-secret',
    'Shown once — copy it now.',
  ]);
});

test('role without name matches every node of that role', () => {
  assert.deepEqual(resolveLocatorValues(YAML, { role: 'code' }), ['FAKE-QA-TOKEN-0000-not-a-real-secret']);
});

test('property lines are never values', () => {
  assert.deepEqual(resolveLocatorValues(YAML, { role: 'link', name: 'Docs' }), []);
});

test('placeholder matches the node carrying it', () => {
  assert.deepEqual(resolveLocatorValues(YAML, { placeholder: 'you@example.com' }), []);
  const typed = YAML.replace('- textbox "Email" [ref=e7]:', '- textbox "Email" [ref=e7]: typed-value-1234');
  assert.deepEqual(resolveLocatorValues(typed, { placeholder: 'you@example.com' }), ['typed-value-1234']);
});

test('no match yields an empty array', () => {
  assert.deepEqual(resolveLocatorValues(YAML, { role: 'textbox', name: 'Nope' }), []);
  assert.deepEqual(resolveLocatorValues('', { label: 'x' }), []);
});

test('escaped quotes in a name and a quoted inline value', () => {
  const y = '- textbox "Say \\"hi\\"" [ref=e1]: "quoted-value-77"\n';
  assert.deepEqual(resolveLocatorValues(y, { label: 'Say "hi"' }), ['quoted-value-77']);
});
