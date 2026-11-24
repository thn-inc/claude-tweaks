'use strict';
// Tests tests/helpers/last-bump.js's assertLastBump (#5552): the guard that
// fails a pinned count assertion whose `// Last bump:` line was not rewritten
// with it. Each case writes a small fixture file and checks the helper's
// verdict on it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertLastBump } = require('./helpers/last-bump');

function withFixture(lines, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-last-bump-'));
  try {
    const file = path.join(dir, 'pin.test.js');
    fs.writeFileSync(file, lines.join('\n') + '\n');
    fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('passes when the Last bump line sits directly above a matching pin', () => {
  withFixture([
    '  // Last bump: 106 -> 109, #5224',
    '  assert.strictEqual(POLICY_KEYS.length, 109);',
  ], (file) => assert.doesNotThrow(() => assertLastBump(file)));
});

test('passes when the pin carries a message argument', () => {
  withFixture([
    '  // Last bump: 422 -> 423, #3898',
    "  assert.strictEqual(total, 423, 'Anti-Patterns rows');",
  ], (file) => assert.doesNotThrow(() => assertLastBump(file)));
});

test('passes on a CRLF checkout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-last-bump-'));
  try {
    const file = path.join(dir, 'pin.test.js');
    fs.writeFileSync(file, '  // Last bump: 106 -> 109, #5224\r\n  assert.strictEqual(POLICY_KEYS.length, 109);\r\n');
    assert.doesNotThrow(() => assertLastBump(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fails, naming the line, when the pin changed but the Last bump line did not', () => {
  withFixture([
    '  // Last bump: 106 -> 109, #5224',
    '  assert.strictEqual(POLICY_KEYS.length, 110);',
  ], (file) => assert.throws(
    () => assertLastBump(file),
    /pin\.test\.js:1 "\/\/ Last bump: 106 -> 109, #5224" says the pin is 109 but the assertion below pins 110: rewrite the Last bump line/
  ));
});

test('fails when a blank line separates the Last bump line from the pin', () => {
  withFixture([
    '  // Last bump: 106 -> 109, #5224',
    '',
    '  assert.strictEqual(POLICY_KEYS.length, 109);',
  ], (file) => assert.throws(() => assertLastBump(file), /must be followed directly by the count assertion/));
});

test('fails, listing both, when the Last bump line appears twice', () => {
  withFixture([
    '  // Last bump: 106 -> 109, #5224',
    '  // Last bump: 106 -> 109, #5224',
    '  assert.strictEqual(POLICY_KEYS.length, 109);',
  ], (file) => assert.throws(() => assertLastBump(file), /found 2 \(at pin\.test\.js:1, pin\.test\.js:2\)/));
});

test('fails when there is no Last bump line', () => {
  withFixture([
    '  assert.strictEqual(POLICY_KEYS.length, 109);',
  ], (file) => assert.throws(() => assertLastBump(file), /expected exactly one .* line, found 0\n/));
});
