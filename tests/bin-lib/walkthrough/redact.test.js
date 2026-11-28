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
  ['ghs_abc123def', '[redacted]'],
  ['ghu_abc123def', '[redacted]'],
  ['ghr_abc123def', '[redacted]'],
  ['github_pat_11ABCDE_abc123def', '[redacted]'],
  ['bearer abc.def', '[redacted]'],
  ['eyJhbGciOiJIUzI1NiJ9.e30.abc', '[redacted]'],
  ['password=hunter2 next', 'password=[redacted] next'],
  ['"token": "abc"', '"token": [redacted]'],
  ['GITHUB_TOKEN=abc', 'GITHUB_TOKEN=[redacted]'],
  ['--api-key abc', '--api-key [redacted]'],
  ['--client-secret=abc', '--client-secret=[redacted]'],
  ['https://user:pass@example.com/x', 'https://[redacted]@example.com/x'],
  ['mail bob.smith+a@example.co.uk now', 'mail [redacted] now'],
  // A keyed value beginning with a scheme word.
  ['authorization=Bearer abc123', 'authorization=[redacted]'],
  ['Authorization = Bearer abc123', 'Authorization = [redacted]'],
  ['token: Bearer abc123', 'token: [redacted]'],
  ['auth: Basic dXNlcjpwYXNz', 'auth: [redacted]'],
  ['x-api-key: Bearer abc123', 'x-api-key: [redacted]'],
  ['--token Bearer abc123', '--token [redacted]'],
  // A separator of more than one character.
  ['password := hunter2', 'password := [redacted]'],
  ['password == hunter2', 'password == [redacted]'],
  ['token=="abc123"', 'token==[redacted]'],
  ['token === "abc123"', 'token === [redacted]'],
  [':password => "hunter2"', ':password => [redacted]'],
  ['Authorization := Digest abc123', 'Authorization := [redacted]'],
  ['authorization == abc123', 'authorization == [redacted]'],
  ['api_key: = abc123', 'api_key: = [redacted]'],
  // JSON quotes escaped inside a string.
  [String.raw`{\"password\": \"hunter2\"}`, String.raw`{\"password\": [redacted]}`],
  [String.raw`{\"token\":\"abc123\"}`, String.raw`{\"token\":[redacted]}`],
  [String.raw`{\"Authorization\":\"Digest abc123\"}`, String.raw`{\"Authorization\":[redacted]}`],
  [String.raw`{\"token\":\"ab\\\"cd\"}`, String.raw`{\"token\":[redacted]}`],
  [String.raw`{\"token\":\"abc def`, String.raw`{\"token\":[redacted]`],
  // A delimiter inside a bare value.
  ['password=pa;ss', 'password=[redacted]'],
  ['password=ab,cd', 'password=[redacted]'],
  ['api_key=abc)def', 'api_key=[redacted]'],
  ['?token=abc&x=1', '?token=[redacted]&x=1'],
  ['token=abc, next', 'token=[redacted], next'],
  ['{"a":1,"token":"abc","b":2}', '{"a":1,"token":[redacted],"b":2}'],
  // One secret under two rules.
  ['bearer eyJhbGciOiJIUzI1NiJ9.e30.abc, next', 'bearer [redacted], next'],
  ['Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc.', 'Bearer [redacted].'],
  ['token: Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc', 'token: [redacted]'],
  // E-mail local parts and hosts.
  ['jörg@example.com', '[redacted]'],
  ["o'brien@example.com", '[redacted]'],
  ['bob@localhost', '[redacted]'],
  ['bob@exämple.com', '[redacted]'],
  ["'bob@example.com'", "'[redacted]'"],
  // A prefix after `_` or `-`.
  ['prefix_sk_live_abc', 'prefix_[redacted]'],
  ['x-ghp_abc123', 'x-[redacted]'],
  // A tail after a JWT under a bearer word.
  ['Bearer eyJa.b.c.d.e', '[redacted]'],
  ['bearer eyJhbGciOiJIUzI1NiJ9.e30.abc.secretpart', '[redacted]'],
  ['bearer eyJhbGciOiJIUzI1NiJ9.e30.abc,secretpart', '[redacted]'],
  ['bearer eyJhbGciOiJIUzI1NiJ9.e30.abc/secretpart', '[redacted]'],
  ['bearer eyJhbGciOiJIUzI1NiJ9.e30.abc:secretpart', '[redacted]'],
  ['eyJa.b.c.d.e', '[redacted]'],
  // A literal backslash-n, -r or -t before a token.
  [String.raw`foo\ntoken=abc`, String.raw`foo\ntoken=[redacted]`],
  [String.raw`foo\npassword=abc`, String.raw`foo\npassword=[redacted]`],
  [String.raw`foo\nsecret=abc`, String.raw`foo\nsecret=[redacted]`],
  [String.raw`foo\tsession=abc`, String.raw`foo\tsession=[redacted]`],
  [String.raw`foo\rtoken=abc`, String.raw`foo\rtoken=[redacted]`],
  [String.raw`{\"msg\":\"a\ntoken=abc\"}`, String.raw`{\"msg\":\"a\ntoken=[redacted]\"}`],
  [String.raw`foo\nauthorization: abc`, String.raw`foo\nauthorization: [redacted]`],
  [String.raw`foo\nauthorization=abc`, String.raw`foo\nauthorization=[redacted]`],
  [String.raw`foo\n--token abc`, String.raw`foo\n--token [redacted]`],
  [String.raw`foo\nbearer abc`, String.raw`foo\n[redacted]`],
  [String.raw`foo\nsk_live_abc`, String.raw`foo\n[redacted]`],
  [String.raw`foo\neyJa.b.c`, String.raw`foo\n[redacted]`],
  [String.raw`C:\token=abc`, String.raw`C:\token=[redacted]`],
  // A quote inside a bare value.
  ['token=ab"cd', 'token=[redacted]'],
  ["password=ab'cd", 'password=[redacted]'],
  ['api_key=ab`cd', 'api_key=[redacted]'],
  [String.raw`token=ab\"cd`, 'token=[redacted]'],
  ['"token=abc" next', '"token=[redacted]" next'],
  ['f("token=abc")', 'f("token=[redacted]")'],
  ['"token=abc", next', '"token=[redacted]", next'],
  ['<a href="?token=abc">', '<a href="?token=[redacted]">'],
  // More scheme words.
  ['token: NTLM abc', 'token: [redacted]'],
  ['api_key: ApiKey abc', 'api_key: [redacted]'],
  ['authorization=NTLM abc123', 'authorization=[redacted]'],
  ['token: OAuth abc', 'token: [redacted]'],
  // After a scheme word on an authorization key, the rest of the line goes.
  ['authorization=Digest username="bob", response="abc"', 'authorization=[redacted]'],
  ['authorization=Digest username="bob", response="abc"\nnext', 'authorization=[redacted]\nnext'],
  // JSON escaped twice.
  [String.raw`{\\\"token\\\":\\\"abc\\\"}`, String.raw`{\\\"token\\\":[redacted]}`],
  [String.raw`{\\\"Authorization\\\":\\\"Digest abc\\\"}`, String.raw`{\\\"Authorization\\\":[redacted]}`],
  [String.raw`{\\\"token\\\":\\\"abc def`, String.raw`{\\\"token\\\":[redacted]`],
  // A value starting with a backslash.
  [String.raw`password=\hunter2`, 'password=[redacted]'],
  [String.raw`password=\$ecret123`, 'password=[redacted]'],
  [String.raw`--password \!abc`, '--password [redacted]'],
  [String.raw`api_key: \abc`, 'api_key: [redacted]'],
  [String.raw`"token":\abc`, '"token":[redacted]'],
  [String.raw`token=\\abc`, 'token=[redacted]'],
  [String.raw`authorization=\abc`, 'authorization=[redacted]'],
  [String.raw`token: Bearer \abc`, 'token: [redacted]'],
  [String.raw`sk_\abc`, '[redacted]'],
  [String.raw`ghp_\abc`, '[redacted]'],
  [String.raw`--token=\abc`, '--token=[redacted]'],
  // A quoted bearer value keeps what surrounds it.
  ['"bearer eyJa.b.c"', '"bearer [redacted]"'],
  ['{"h":"bearer eyJa.b.c","x":1}', '{"h":"bearer [redacted]","x":1}'],
  [String.raw`{\"h\":\"bearer eyJa.b.c\",\"x\":1}`, String.raw`{\"h\":\"bearer [redacted]\",\"x\":1}`],
  ['"bearer abc"', '"[redacted]"'],
  ['{"h":"bearer abc","x":1}', '{"h":"[redacted]","x":1}'],
  ['bearer abc, next', '[redacted], next'],
  ['bearer eyJa.b.c"secretpart', '[redacted]'],
  ['bearer "abc def" next', '[redacted] next'],
  // Text glued to a value.
  [String.raw`token=[redacted]\secretpart`, 'token=[redacted]'],
  ['token=[redacted]"secretpart', 'token=[redacted]'],
  [String.raw`--token="abc"\def`, '--token=[redacted]'],
  ['token="abc"def', 'token=[redacted]'],
  [String.raw`token="abc"\def`, 'token=[redacted]'],
  [String.raw`token=\"abc\"def`, 'token=[redacted]'],
  ['token="abc". next', 'token=[redacted]. next'],
  ['{"token":"abc"},{"x":1}', '{"token":[redacted]},{"x":1}'],
  ['<a title="token=abc">', '<a title="token=[redacted]">'],
  [`--password "ab"'cd'`, '--password [redacted]'],
  [`token="ab"'cd'`, 'token=[redacted]'],
  // The flag rule's separator run.
  ['--token => abc', '--token => [redacted]'],
  ['--token = abc', '--token = [redacted]'],
  ['--token := "abc def"', '--token := [redacted]'],
  // Case and whitespace limits.
  ['bearer EYJa.b.c', '[redacted]'],
  ['authorization=token\nnext line', 'authorization=[redacted]\nnext line'],
  ['token: bearer\nnext line', 'token: [redacted]\nnext line'],
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
    // A fragment inside the expected text is a kept key's letters (`pa` in `password`), not a leak.
    for (const fragment of words(raw).filter((word) => !expected.includes(word))) {
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

test('a scheme word before an unterminated quote is not spent as the value', () => {
  // The keyed rule declines, so the key stays in the residual and the screen refuses the whole string.
  assert.equal(findCredentialInText(redactText('token: Bearer "abc def').residual), 'token');
  assert.equal(findCredentialInText(redactText('password: Basic "abc def').residual), 'password');
  assert.equal(redactText('authorization=Bearer "abc def\nnext').text, 'authorization=[redacted]\nnext');
});

test('a separator with no value after it is not spent as the value', () => {
  for (const raw of ['authorization==', 'token==']) {
    assert.deepEqual((({ text, count }) => [text, count])(redactText(raw)), [raw, 0], raw);
  }
});

test('a version pin reads as an address: over-redacted, visibly', () => {
  assert.deepEqual((({ text, count }) => [text, count])(redactText('pkg@1.2.3')), ['[redacted]', 1]);
  assert.deepEqual((({ text, count }) => [text, count])(redactText('foo@latest')), ['[redacted]', 1]);
});

test('text around an address is left alone', () => {
  for (const raw of ['@scope/pkg', 'user@', '[redacted]@example.com']) {
    assert.deepEqual((({ text, count }) => [text, count])(redactText(raw)), [raw, 0], raw);
  }
});

test('a placeholder followed by more of a token is still a value', () => {
  assert.equal(redactText('bearer [redacted]abc').text, '[redacted]');
  assert.equal(redactText('token=[redacted]abc').text, 'token=[redacted]');
  assert.equal(redactText('token=[redacted].abc').text, 'token=[redacted]');
  assert.equal(redactText('Authorization: [redacted] abc').text, 'Authorization: [redacted]');
});

test('a later rule does not run on past a placeholder an earlier rule wrote', () => {
  const { text, count } = redactText('--client-secret="abc", next');
  assert.deepEqual([text, count], ['--client-secret=[redacted], next', 1]);
  const header = redactText('"Authorization": "Digest abc", "x": 1');
  assert.deepEqual([redactText(header.text).text, redactText(header.text).count], [header.text, 0]);
});

test('a bearer value no value form takes still goes, up to its whitespace', () => {
  assert.equal(redactText('bearer "abc def').text, '[redacted] def');
});

test('a JWT starts with a case-sensitive eyJ', () => {
  for (const raw of ['eyjafjallajokull.is', 'EYJa.b']) {
    assert.deepEqual((({ text, count }) => [text, count])(redactText(raw)), [raw, 0], raw);
  }
});

test('only a backslash makes a leading n, r or t a boundary', () => {
  // `pantoken` is one word: untouched, and the shared screen reads it the same way.
  for (const raw of ['pantoken=abc', 'ntoken=abc', 'monkey=1', String.raw`\monkey=1`, String.raw`\nmonkey=1`, String.raw`C:\network=1`, String.raw`\xtoken=abc`]) {
    const { text, count, residual } = redactText(raw);
    assert.deepEqual([text, count], [raw, 0], raw);
    assert.equal(findCredentialInText(residual), null, raw);
  }
});

test('a token-shaped word inside a longer word is left alone', () => {
  for (const raw of ['task_list', 'task-list', 'unbearer abc', 'neyJa.b']) {
    assert.deepEqual((({ text, count }) => [text, count])(redactText(raw)), [raw, 0], raw);
  }
});
