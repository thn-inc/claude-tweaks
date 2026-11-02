'use strict';
// tests/bin-lib/walkthrough/redact.test.js — #4612: the Recording section's text redaction.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redactText, REDACTED } = require('../../../plugin/bin/lib/walkthrough/redact');
const { findCredentialInText } = require('../../../plugin/bin/lib/wrap-up/packet-links');

const CASES = [
  ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc', 'Authorization: [redacted]'],
  ['Authorization: Digest abc123', 'Authorization: [redacted]'],
  ['authorization=abc123', 'authorization=[redacted]'],
  ['api_key=sk_live_123abc', 'api_key=[redacted]'],
  ['sk_live_abc', '[redacted]'],
  ['ghp_abc123def', '[redacted]'],
  ['gho_abc123def', '[redacted]'],
  ['bearer abc.def', '[redacted]'],
  ['eyJhbGciOiJIUzI1NiJ9.e30.abc', '[redacted]'],
  ['password=hunter2 next', 'password=[redacted] next'],
  ['"token": "abc"', '"token": [redacted]'],
  ['GITHUB_TOKEN=abc', 'GITHUB_TOKEN=[redacted]'],
  ['--api-key abc', '--api-key [redacted]'],
  ['--client-secret=abc', '--client-secret=[redacted]'],
  ['https://user:pass@example.com/x', 'https://[redacted]@example.com/x'],
  ['mail bob.smith+a@example.co.uk now', 'mail [redacted] now'],
];

const words = (text) => text.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 1);

test('the placeholder is the fixed token', () => {
  assert.equal(REDACTED, '[redacted]');
});

test('redacts each shape, whole value, key kept', () => {
  for (const [raw, expected] of CASES) {
    const { text, count, residual } = redactText(raw);
    assert.equal(text, expected, raw);
    assert.equal(count, 1, raw);
    assert.equal(findCredentialInText(residual), null, raw);
    const expectedWords = words(expected);
    for (const fragment of words(raw).filter((word) => !expectedWords.includes(word))) {
      assert.equal(text.includes(fragment), false, `${raw}: ${fragment} in text`);
      assert.equal(residual.includes(fragment), false, `${raw}: ${fragment} in residual`);
    }
  }
});

test('benign text is untouched', () => {
  for (const raw of ['monkey=1', '/docs/token-guide', 'acceptance-packet.js --help', 'keyboard: x']) {
    const { text, count } = redactText(raw);
    assert.equal(text, raw);
    assert.equal(count, 0, raw);
  }
});

test('a percent-encoded key is left for the screen', () => {
  assert.notEqual(findCredentialInText(redactText('tok%65n=abc').residual), null);
});

test('counts each replacement', () => {
  assert.equal(redactText('a=1 token=x password=y').count, 2);
});

test('a value holding the placeholder is not recounted, so a second pass changes nothing', () => {
  for (const [raw] of CASES) {
    const once = redactText(raw);
    assert.deepEqual([redactText(once.text).text, redactText(once.text).count], [once.text, 0], raw);
  }
  assert.deepEqual(
    (({ text, count }) => [text, count])(redactText('bearer eyJhbGciOiJIUzI1NiJ9.e30.abc')),
    ['bearer [redacted]', 1],
  );
});

test('a key inside a non-credential value is still found', () => {
  assert.equal(redactText('https://example.com/cb?token=abc&x=1').text, 'https://example.com/cb?token=[redacted]&x=1');
  assert.equal(redactText('next=token=abc').text, 'next=token=[redacted]');
  assert.equal(redactText('--verbose --api-key abc').text, '--verbose --api-key [redacted]');
  assert.equal(redactText('--name bob --api-key abc').text, '--name bob --api-key [redacted]');
});

test('a quoted value goes whole, an escaped quote included', () => {
  assert.equal(redactText('password="two words" next').text, 'password=[redacted] next');
  assert.equal(redactText(String.raw`"token": "ab\"cd", "x": 1`).text, '"token": [redacted], "x": 1');
  assert.equal(redactText('--password \'two words\' next').text, '--password [redacted] next');
  assert.equal(redactText('"Authorization": "Bearer abc def"').text, '"Authorization": [redacted]');
});

test('a header value goes to the end of its line, whatever the scheme', () => {
  const cases = [
    ['Authorization: Digest username="x", realm="y"\nnext', 'Authorization: [redacted]\nnext'],
    ['Authorization: abc def\r\nnext', 'Authorization: [redacted]\r\nnext'],
    ['Proxy-Authorization: Negotiate abc', 'Proxy-Authorization: [redacted]'],
    ['myAuthorization: Digest abc', 'myAuthorization: [redacted]'],
    ['Authorization: "Digest" abc', 'Authorization: [redacted]'],
    ['Authorization: "Digest abc', 'Authorization: [redacted]'],
    ['"Authorization": "Digest abc", "x": 1', '"Authorization": [redacted], "x": 1'],
  ];
  for (const [raw, expected] of cases) {
    const { text, count, residual } = redactText(raw);
    assert.deepEqual([text, count], [expected, 1], raw);
    assert.equal(residual.includes('abc'), false, raw);
    assert.equal(findCredentialInText(residual), null, raw);
  }
});

test('an authorization assignment takes one value, and an open quote takes the line', () => {
  const cases = [
    ['authorization=abc next', 'authorization=[redacted] next'],
    ['https://example.com/?authorization=abc&x=1', 'https://example.com/?authorization=[redacted]&x=1'],
    ['x_authorization=abc', 'x_authorization=[redacted]'],
    ['authorization="a b" next', 'authorization=[redacted] next'],
    ['authorization="abc def\nnext', 'authorization=[redacted]\nnext'],
  ];
  for (const [raw, expected] of cases) {
    const { text, count, residual } = redactText(raw);
    assert.deepEqual([text, count], [expected, 1], raw);
    assert.equal(residual.includes('abc'), false, raw);
    assert.equal(findCredentialInText(residual), null, raw);
  }
});

test('a word merely ending in authorization is left alone', () => {
  for (const raw of ['unauthorization: x', 'unauthorization=x']) {
    assert.deepEqual((({ text, count }) => [text, count])(redactText(raw)), [raw, 0], raw);
  }
});

test('an unterminated quote stays in the residual for the screen to refuse', () => {
  const { text, count, residual } = redactText('password="two words');
  assert.deepEqual([text, count], ['password="two words', 0]);
  assert.notEqual(findCredentialInText(residual), null);
});

test('a token-shaped word inside a longer word is left alone', () => {
  for (const raw of ['task_list', 'task-list', 'unbearer abc', 'neyJa.b']) {
    assert.deepEqual((({ text, count }) => [text, count])(redactText(raw)), [raw, 0], raw);
  }
});
