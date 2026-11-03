// tests/bin-lib/wrap-up/packet-links.test.js
// Acceptance-packet contract constants and link rules (#4611).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SCHEMA_VERSION,
  PACKET_MARKER,
  PACKET_MARKER_RE,
  LOCAL_START,
  LOCAL_END,
  FACT_KINDS,
  FACT_STATUSES,
  CLAIM_SECTIONS,
  SECTION_KINDS,
  SECTIONS,
  MAX_PACKET_CHARS,
  CREDENTIAL_KEYS,
  FACT_ID_RE,
  encodeFactKey,
  VERIFICATION_WORDS,
  VERIFICATION_CLAIM_RE,
} = require('../../../plugin/bin/lib/wrap-up/packet-contract');
const {
  normalizeKey,
  checkLink,
  findCredentialInText,
  hasBearerUrl,
  isCredentialRefusal,
  isImageUrl,
} = require('../../../plugin/bin/lib/wrap-up/packet-links');

const allowedHosts = ['http://localhost:3000', 'https://dev.example.com'];
const check = (url) => checkLink(url, { allowedHosts });

test('hasBearerUrl reads a URL token with a bearer-shaped path segment, however it is spelled', () => {
  const bearer = 'Xk3j9f8s7d6f5g4h3j2k1';
  for (const text of [
    `http://localhost:3000/reset/${bearer}`,
    `curl "http://localhost:3000/reset/${bearer}/next"`,
    `curl 'https://h.example/${bearer}' -s`,
    `see (https://h.example/${bearer}).`,
    `see https://h.example/${bearer}, then go on`,
    `HTTPS://h.example/${bearer}`,
    `https://h.example:99999/${bearer}`,
    `https://h.example/a%2F${bearer}`,
    `https://h.example/${bearer}?x=1`,
    `https://h.example/${bearer}#x`,
    `curl localhost:3000/${bearer}`,
    `www.h.example/${bearer}`,
    `first https://h.example/a then https://h.example/${bearer}`,
  ]) {
    assert.equal(hasBearerUrl(text), true, text);
  }
});

test('hasBearerUrl leaves the placeholder, bare words, local paths and every other part of a URL', () => {
  const bearer = 'Xk3j9f8s7d6f5g4h3j2k1';
  for (const text of [
    'http://localhost:3000/reset/{id}',
    'curl http://localhost:3000/reset/{id}/next',
    'npm run demo',
    bearer,
    `node seed.js ${bearer}`,
    `.claude-tweaks/pipelines/2026-11-02T223727-record-4612/work/spec.md`,
    '/tmp/2026-11-02-acceptance-recording/w.gif',
    'http://localhost:3000/docs/token-guide',
    `https://h.example/a?x=${bearer}`,
    `https://h.example/a#${bearer}`,
    `https://${bearer}.example/a`,
    'https://h.example/2026-11-02-acceptance-recording.md',
    'C:/runs/2026-11-02-acceptance-recording/w.gif',
    '',
  ]) {
    assert.equal(hasBearerUrl(text), false, text);
  }
});

test('hasBearerUrl judges the token\'s own path when a URL sits later in the token', () => {
  const bearer = 'Xk3j9f8s7d6f5g4h3j2k1';
  for (const text of [
    `curl localhost:3000/reset/${bearer}?next=http://x/y`,
    `www.h.example/${bearer}?u=https://x/y`,
    `www.h.example/${bearer}#http://x/y`,
  ]) {
    assert.equal(hasBearerUrl(text), true, text);
  }
  for (const text of ['curl localhost:3000/reset/{id}?next=http://x/y', 'www.h.example/a?u=https://x/y', 'www.h.example/a#http://x/y']) {
    assert.equal(hasBearerUrl(text), false, text);
  }
});

test('hasBearerUrl reads bare localhost, a bracketed IPv6 host and a signed scheme as URL tokens', () => {
  const bearer = 'Xk3j9f8s7d6f5g4h3j2k1';
  for (const text of [
    `curl localhost/reset/${bearer}`,
    `LOCALHOST/${bearer}`,
    `curl [::1]:3000/reset/${bearer}`,
    `-https://h.example/${bearer}`,
    `+https://h.example/${bearer}`,
    `--https://h.example/${bearer}`,
    `${'a-'.repeat(20)}https://h.example/${bearer}`,
  ]) {
    assert.equal(hasBearerUrl(text), true, text);
  }
  for (const text of [
    'curl localhost/reset/{id}',
    'curl [::1]:3000/reset/{id}',
    '-https://h.example/a',
    'localhost',
    '/tmp/localhost/2026-11-02-acceptance-recording/w.gif',
    'runs/localhost/2026-11-02-acceptance-recording/w.gif',
    `my-localhost/${bearer}`,
    `notlocalhost/${bearer}`,
    `localhost.example/${bearer}`,
  ]) {
    assert.equal(hasBearerUrl(text), false, text);
  }
});

test('checkLink accepts an allowed host, and a path that only names a key word', () => {
  assert.deepEqual(check('http://localhost:3000/settings?role=admin'), { ok: true });
  assert.deepEqual(check('https://dev.example.com/docs/token-guide'), { ok: true });
});

test('checkLink refuses with the exact reason for each rule', () => {
  const cases = [
    ['https://evil.example/x', 'host not allowed: evil.example'],
    ['javascript:alert(1)', 'scheme not http(s)'],
    ['ftp://localhost:3000/', 'scheme not http(s)'],
    ['http://localhost:3000/?TOKEN=abc', 'credential key in query: token'],
    ['http://localhost:3000/?tok%65n=abc', 'credential key in query: token'],
    ['http://localhost:3000/p#sig=abc', 'credential key in fragment: sig'],
    ['http://user:pass@localhost:3000/', 'credential in userinfo'],
    ['http://localhost:3000/?sessionid=1', 'credential key in query: sessionid'],
    ['http://localhost:3000/?X-Amz-Signature=1', 'credential key in query: x-amz-signature'],
    ['not a url', 'unparseable url'],
  ];
  for (const [url, reason] of cases) {
    assert.deepEqual(check(url), { ok: false, reason }, url);
  }
});

// Characterization (#4612): the order checkLink applies its rules in, and what it has
// always let through in a path, pinned before the bearer-segment rule joins them.
test('checkLink reports the first rule that fails: url, scheme, host, userinfo, path, query, fragment', () => {
  const cases = [
    ['ftp://user:pass@evil.example/?token=1#sig=1', 'scheme not http(s)'],
    ['http://user:pass@evil.example/?token=1#sig=1', 'host not allowed: evil.example'],
    ['http://user:pass@localhost:3000/?token=1#sig=1', 'credential in userinfo'],
    ['http://user:pass@localhost:3000/a/Xk3j9f8s7d6f5g4h3j2k1?token=1', 'credential in userinfo'],
    ['http://localhost:3000/a/Xk3j9f8s7d6f5g4h3j2k1?token=1#sig=1', 'credential in path segment'],
    ['http://localhost:3000/?token=1#sig=1', 'credential key in query: token'],
    ['http://localhost:3000/#sig=1', 'credential key in fragment: sig'],
  ];
  for (const [url, reason] of cases) assert.deepEqual(check(url), { ok: false, reason }, url);
});

test('checkLink normalizes scheme case, a missing path and dot segments before the query screen', () => {
  assert.deepEqual(check('HTTP://LOCALHOST:3000'), { ok: true });
  assert.deepEqual(check('HTTP://LOCALHOST:3000/?token=1'), { ok: false, reason: 'credential key in query: token' });
  assert.deepEqual(check('http://localhost:3000/a/../b?sig=1'), { ok: false, reason: 'credential key in query: sig' });
  assert.deepEqual(check('http://localhost.:3000/'), { ok: false, reason: 'host not allowed: localhost.' });
});

test('checkLink accepts a path that merely looks odd: assignments, dots, stray percent, short ids', () => {
  const paths = ['/cb/token=abc', '/a/access_token/b', '/%/x', '/a%2Fb/c', '/file.v2.final.report.name.png', '/@scope/pkg', '/;jsessionid=abc', '/id/1234567', '/a/Xk3j9f8s7d6f5g4h3j2/b'];
  for (const p of paths) assert.deepEqual(check(`http://localhost:3000${p}`), { ok: true }, p);
});

test('checkLink userinfo: a username alone or a password alone is refused', () => {
  assert.deepEqual(check('http://user@localhost:3000/'), { ok: false, reason: 'credential in userinfo' });
  assert.deepEqual(check('http://:pass@localhost:3000/'), { ok: false, reason: 'credential in userinfo' });
});

test('checkLink host match is on the hostname, lowercased, not on a prefix of the URL', () => {
  assert.deepEqual(check('http://LOCALHOST:3000/'), { ok: true });
  assert.deepEqual(check('http://localhost:9999/'), { ok: true });
  assert.deepEqual(check('http://localhost.evil.example/'), { ok: false, reason: 'host not allowed: localhost.evil.example' });
  assert.deepEqual(check('http://evil.example/#@localhost:3000'), { ok: false, reason: 'host not allowed: evil.example' });
});

test('checkLink allowedHosts takes base URLs and bare hosts alike, case-insensitively', () => {
  assert.deepEqual(checkLink('https://dev.example.com/a', { allowedHosts: ['DEV.Example.com'] }), { ok: true });
  assert.deepEqual(checkLink('https://dev.example.com/a', { allowedHosts: ['https://DEV.example.com/base/'] }), { ok: true });
});

test('checkLink fails closed on no allowed hosts and on an absent host in the list', () => {
  assert.deepEqual(checkLink('http://localhost/', { allowedHosts: [] }), { ok: false, reason: 'host not allowed: localhost' });
  assert.deepEqual(checkLink('http://localhost/'), { ok: false, reason: 'host not allowed: localhost' });
  assert.deepEqual(checkLink('http://undefined/', { allowedHosts: [undefined, null] }), { ok: false, reason: 'host not allowed: undefined' });
});

test('checkLink non-string url is unparseable, not a throw', () => {
  assert.deepEqual(check(undefined), { ok: false, reason: 'unparseable url' });
});

test('checkLink query keys: a double-encoded key and a valueless key both refuse; a non-key does not', () => {
  assert.deepEqual(check('http://localhost:3000/?%2574oken=abc'), { ok: false, reason: 'credential key in query: token' });
  assert.deepEqual(check('http://localhost:3000/?a=1&jwt'), { ok: false, reason: 'credential key in query: jwt' });
  assert.deepEqual(check('http://localhost:3000/?monkey=1&tokens=2'), { ok: true });
});

test('checkLink fragment keys: split on & and ?, text before =, decoded and lowercased', () => {
  assert.deepEqual(check('http://localhost:3000/p#a=1&SIG=abc'), { ok: false, reason: 'credential key in fragment: sig' });
  assert.deepEqual(check('http://localhost:3000/p#tok%65n=abc'), { ok: false, reason: 'credential key in fragment: token' });
  assert.deepEqual(check('http://localhost:3000/p#a=1&password'), { ok: false, reason: 'credential key in fragment: password' });
  assert.deepEqual(check('http://localhost:3000/p#section-2'), { ok: true });
  assert.deepEqual(check('http://localhost:3000/p#note=token'), { ok: true });
});

test('checkLink refuses a query inside a fragment', () => {
  const cases = [
    ['http://localhost:3000/#/cb?token=abc', 'token'],
    ['http://localhost:3000/#/cb?x=1&sig=abc', 'sig'],
    ['http://localhost:3000/#/cb?jwt', 'jwt'],
    ['http://localhost:3000/#/cb%3Ftoken=abc', 'token'],
    ['http://localhost:3000/#state=x?token=abc', 'token'],
  ];
  for (const [url, key] of cases) {
    assert.deepEqual(check(url), { ok: false, reason: `credential key in fragment: ${key}` }, url);
  }
});

test('checkLink keeps accepting a benign fragment that only mentions a key', () => {
  for (const fragment of ['token-guide', '/docs/token-guide', '/cb?role=admin', '/token?x=1', 'note=token']) {
    assert.deepEqual(check(`http://localhost:3000/#${fragment}`), { ok: true }, fragment);
  }
});

test('checkLink: a stray % elsewhere in the fragment does not hide an encoded key', () => {
  assert.deepEqual(check('http://localhost:3000/#100%&tok%65n=abc'), { ok: false, reason: 'credential key in fragment: token' });
  assert.deepEqual(check('http://localhost:3000/#100%?tok%65n=abc'), { ok: false, reason: 'credential key in fragment: token' });
});

test('checkLink refuses a nested key in the normalized query', () => {
  const cases = [
    ['http://localhost:3000/?next=/cb?token=abc', 'token'],
    ['http://localhost:3000/?next=%2Fcb%3Ftoken%3Dabc', 'token'],
    ['http://localhost:3000/?a=1;token=abc', 'token'],
    ['http://localhost:3000/?a%26token=abc', 'token'],
    ['http://localhost:3000/?tok%65n%3Dabc', 'token'],
    ['http://localhost:3000/?GITHUB_TOKEN=abc', 'token'],
    ['http://localhost:3000/?api-key=abc', 'api_key'],
    ['http://localhost:3000/?a=%FF%74oken=abc', 'token'],
    ['http://localhost:3000/?a=token%20=abc', 'token'],
  ];
  for (const [url, key] of cases) {
    assert.deepEqual(check(url), { ok: false, reason: `credential key in query: ${key}` }, url);
  }
});

test('checkLink compares keys with - and _ removed, and reports the constant spelling', () => {
  const cases = [
    ['http://localhost:3000/?session_id=1', 'query', 'sessionid'],
    ['http://localhost:3000/?apikey=1', 'query', 'api_key'],
    ['http://localhost:3000/?api-key', 'query', 'api_key'],
    ['http://localhost:3000/?accesstoken', 'query', 'access_token'],
    ['http://localhost:3000/?next=/x?session-id=1', 'query', 'sessionid'],
    ['http://localhost:3000/#session_id', 'fragment', 'sessionid'],
    ['http://localhost:3000/#/cb;apikey=1', 'fragment', 'api_key'],
  ];
  for (const [url, where, key] of cases) {
    assert.deepEqual(check(url), { ok: false, reason: `credential key in ${where}: ${key}` }, url);
  }
  assert.deepEqual(check('http://localhost:3000/?session_list=1'), { ok: true });
});

test('checkLink reads + as a space in the query screen, before decoding', () => {
  assert.deepEqual(check('http://localhost:3000/?token+=abc'), { ok: false, reason: 'credential key in query: token' });
  assert.deepEqual(check('http://localhost:3000/?a=token+=abc'), { ok: false, reason: 'credential key in query: token' });
  assert.deepEqual(check('http://localhost:3000/?a=1+2&token+=abc'), { ok: false, reason: 'credential key in query: token' });
  assert.deepEqual(check('http://localhost:3000/?a=token%2B=abc'), { ok: true });
});

test('checkLink refuses a nested key in the normalized fragment', () => {
  const cases = [
    ['http://localhost:3000/#/cb;token=abc', 'token'],
    ['http://localhost:3000/#/cb/token=abc', 'token'],
    ['http://localhost:3000/#/cb/x_secret=abc', 'secret'],
  ];
  for (const [url, key] of cases) {
    assert.deepEqual(check(url), { ok: false, reason: `credential key in fragment: ${key}` }, url);
  }
});

test('checkLink keeps accepting a query or fragment that only mentions a key', () => {
  const accepted = [
    'http://localhost:3000/#note=token',
    'http://localhost:3000/?note=token',
    'http://localhost:3000/docs/token-guide',
    'http://localhost:3000/?next=/docs/token-guide',
    'http://localhost:3000/?next=/x?monkey=1',
    'http://localhost:3000/#/x;tokens=1',
    'http://localhost:3000/#/session:list',
  ];
  for (const url of accepted) assert.deepEqual(check(url), { ok: true }, url);
});

test('checkLink exact keys: a valueless key is decoded and lowercased, and the first exact key is the one reported', () => {
  assert.deepEqual(check('http://localhost:3000/?TOK%65N'), { ok: false, reason: 'credential key in query: token' });
  assert.deepEqual(check('http://localhost:3000/#TOK%65N'), { ok: false, reason: 'credential key in fragment: token' });
  assert.deepEqual(check('http://localhost:3000/#token=1&password=2'), { ok: false, reason: 'credential key in fragment: token' });
});

test('checkLink keeps refusing a bare fragment anchor that is a credential key', () => {
  assert.deepEqual(check('http://localhost:3000/#auth'), { ok: false, reason: 'credential key in fragment: auth' });
});

test('checkLink allowedHosts accepts a bare host:port or IPv6 entry; the port still does not count', () => {
  const allowed = [
    ['http://localhost:3000/', 'localhost:3000'],
    ['http://localhost:9999/', 'localhost:3000'],
    ['https://dev.example.com:8080/', 'dev.example.com:8080'],
    ['https://dev.example.com/', 'DEV.example.com:8080'],
    ['http://[::1]:3000/', '::1'],
    ['http://[::1]:3000/', '[::1]:3000'],
    ['http://[::1]/', '0:0:0:0:0:0:0:1'],
  ];
  for (const [url, entry] of allowed) {
    assert.deepEqual(checkLink(url, { allowedHosts: [entry] }), { ok: true }, `${url} vs ${entry}`);
  }
  assert.deepEqual(checkLink('http://evil.example:3000/', { allowedHosts: ['localhost:3000'] }), { ok: false, reason: 'host not allowed: evil.example' });
  assert.deepEqual(checkLink('http://localhost/', { allowedHosts: ['not a host'] }), { ok: false, reason: 'host not allowed: localhost' });
});

test('checkLink fails closed on null options or null allowedHosts', () => {
  const refused = { ok: false, reason: 'host not allowed: localhost' };
  assert.deepEqual(checkLink('http://localhost/', null), refused);
  assert.deepEqual(checkLink('http://localhost/', { allowedHosts: null }), refused);
  assert.deepEqual(checkLink('http://localhost/', { allowedHosts: 'localhost' }), refused);
});

test('every credential key refuses in query and in fragment', () => {
  for (const key of CREDENTIAL_KEYS) {
    assert.deepEqual(check(`http://localhost:3000/?${key}=1`), { ok: false, reason: `credential key in query: ${key}` });
    assert.deepEqual(check(`http://localhost:3000/#${key}=1`), { ok: false, reason: `credential key in fragment: ${key}` });
  }
});

// ---- Exposure link rule (#4612): every Recording link keeps to it ----

const okRaw = (url) => checkLink(url, { allowedHosts: ['host', 'raw.githubusercontent.com'] });

test('AC4.2: credential query shapes are refused after normalizing', () => {
  for (const url of ['https://host/?TOKEN=abc', 'https://host/?tok%65n=abc', 'https://host/?%74oken=abc', 'https://host/#token=abc',
    'https://user:pass@host/', 'HTTPS://host/?token=abc', 'https://host/x/?token=abc', 'https://host/a/../b?token=abc',
    'https://host/?access_token=a', 'https://host/?password=a', 'https://host/?session=a']) {
    const r = okRaw(url);
    assert.equal(r.ok, false, url);
    assert.ok(isCredentialRefusal(r.reason), url);
  }
});

test('AC4.3: a benign path naming the word is not withheld', () => {
  assert.equal(okRaw('https://host/docs/token-guide').ok, true);
});

test('a bearer-shaped path segment is refused', () => {
  assert.deepEqual(okRaw('https://host/a/Xk3j9f8s7d6f5g4h3j2k1/b'), { ok: false, reason: 'credential in path segment' });
  assert.equal(isCredentialRefusal(okRaw('https://host/a/Xk3j9f8s7d6f5g4h3j2k1/b').reason), true);
});

test('a bearer-shaped segment is found when it is encoded, last, or the only segment', () => {
  for (const path of ['/%58k3j9f8s7d6f5g4h3j2k1', '/a/Xk3j9f8s7d6f5g4h3j2k1', '/Xk3j9f8s7d6f5g4h3j2k1/', '/a/Xk3j9f8s7d6f5g4h3j2k1_-/b']) {
    assert.equal(okRaw(`https://host${path}`).reason, 'credential in path segment', path);
  }
});

test('an encoded slash is a segment boundary: the bearer value behind it is found', () => {
  for (const path of ['/a%2FXk3j9f8s7d6f5g4h3j2k1', '/Xk3j9f8s7d6f5g4h3j2k1%2Fb', '/a%2fXk3j9f8s7d6f5g4h3j2k1%2fb', '/a%252FXk3j9f8s7d6f5g4h3j2k1']) {
    assert.equal(okRaw(`https://host${path}`).reason, 'credential in path segment', path);
  }
});

test('a 20-character segment with no digit, or no letter, is not bearer-shaped', () => {
  assert.equal(okRaw('https://host/abcdefghijklmnopqrst').ok, true);
  assert.equal(okRaw('https://host/12345678901234567890').ok, true);
  assert.equal(okRaw('https://host/abcdefghij-klmnopqrs_t/x').ok, true);
});

test('a 19-character segment is not bearer-shaped, and a 20-character one is', () => {
  assert.equal(okRaw(`https://host/${'a1'.repeat(9)}b`).ok, true);
  assert.equal(okRaw(`https://host/${'a1'.repeat(10)}`).reason, 'credential in path segment');
});

test('a segment holding a character outside the alphabet is not bearer-shaped', () => {
  assert.equal(okRaw('https://host/Xk3j9f8s7d6f5g4h3j2k1.png').ok, true);
  assert.equal(okRaw('https://host/Xk3j9f8s7d6f5g4h3j2k1=').ok, true);
});

test('no exemption: a 40-hex commit sha segment on a raw host is refused', () => {
  assert.equal(okRaw(`https://raw.githubusercontent.com/o/r/${'a1'.repeat(20)}/docs/x.png`).reason, 'credential in path segment');
});

test('the userinfo and path reasons both read as credential refusals; no other reason does', () => {
  assert.equal(isCredentialRefusal('credential in userinfo'), true);
  assert.equal(isCredentialRefusal('credential key in query: token'), true);
  assert.equal(isCredentialRefusal('credential key in fragment: sig'), true);
  for (const reason of ['unparseable url', 'scheme not http(s)', 'host not allowed: credential.example', '']) {
    assert.equal(isCredentialRefusal(reason), false, reason);
  }
  assert.equal(isCredentialRefusal(undefined), false);
});

test('isImageUrl reads the pathname only', () => {
  for (const url of ['https://h/r.gif', 'https://h/r.PNG?x=1', 'https://h/a/r.webp#f', 'https://h/r.jpg', 'https://h/r.jpeg', 'https://h/r.svg', 'https://h/r.avif', 'https://h/r.bmp', 'https://h/r%2Egif', 'https://h/r.p%6Eg']) {
    assert.equal(isImageUrl(url), true, url);
  }
  for (const url of ['https://h/r.gif/landing', 'https://h/landing?f=r.png', 'https://h/landing#r.png', 'https://h/', 'not a url', undefined, null]) {
    assert.equal(isImageUrl(url), false, String(url));
  }
});

test('isImageUrl sees through a trailing slash, a ; parameter and trailing whitespace', () => {
  for (const url of ['https://store.example/r.gif/', 'https://store.example/r.gif///', 'https://store.example/r.gif;x=1', 'https://store.example/r.gif;a=1;b=2',
    'https://store.example/r.gif%20', 'https://store.example/r.gif%20%0A', 'https://store.example/r.gif;x=1/', 'https://store.example/r.gif%20/;x', 'https://store.example/r.gif%2F']) {
    assert.equal(isImageUrl(url), true, url);
  }
  for (const url of ['https://h/r.gif/landing', 'https://h/r.gif;x=1/landing', 'https://h/r.gif%20/landing', 'https://h/landing;r.gif', 'https://h/;r.gif/', 'https://h/%20/']) {
    assert.equal(isImageUrl(url), false, url);
  }
});

test('normalizeKey decodes up to three layers, then lowercases', () => {
  assert.equal(normalizeKey('TOKEN'), 'token');
  assert.equal(normalizeKey('tok%65n'), 'token');
  assert.equal(normalizeKey('%252574oken'), 'token');
  assert.equal(normalizeKey('%25252574oken'), '%74oken');
});

test('normalizeKey survives malformed percent escapes', () => {
  assert.equal(normalizeKey('100%'), '100%');
  assert.equal(normalizeKey('TOK%ZZ'), 'tok%zz');
  assert.equal(normalizeKey('%2525ZZ'), '%zz');
});

test('normalizeKey decodes each valid escape and leaves each invalid one literal', () => {
  assert.equal(normalizeKey('100% tok%65n'), '100% token');
  assert.equal(normalizeKey('%ZZ%41'), '%zza');
  assert.equal(normalizeKey('%FF%41'), '%ffa');
  assert.equal(normalizeKey('%41%FF%42'), 'a%ffb');
  assert.equal(normalizeKey('caf%C3%A9 %C3'), 'café %c3');
  assert.equal(normalizeKey('%F0%9F%98%80%'), '😀%');
  assert.equal(normalizeKey('%25%36%35'), 'e');
});

test('findCredentialInText: a stray or invalid escape does not hide an encoded key', () => {
  assert.equal(findCredentialInText('100% done, tok%65n=abc'), 'token');
  assert.equal(findCredentialInText('%FF%20tok%65n=abc'), 'token');
  assert.equal(findCredentialInText('50% off, cli --%6Bey abc'), 'key');
  assert.equal(findCredentialInText('100% done, to%6ben=abc'), 'token');
  assert.equal(findCredentialInText('100% done'), null);
  assert.equal(findCredentialInText(undefined), null);
});

test('contract constants hold their exact values', () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(PACKET_MARKER, '<!-- acceptance-packet: v1 -->');
  assert.equal(LOCAL_START, '<!-- acceptance-packet:start -->');
  assert.equal(LOCAL_END, '<!-- acceptance-packet:end -->');
  assert.equal(MAX_PACKET_CHARS, 60000);
  assert.deepEqual(FACT_KINDS, ['change', 'check', 'story', 'finding', 'link', 'recording', 'flag', 'decision', 'deploy']);
  assert.deepEqual(FACT_STATUSES, ['passed', 'failed', 'skipped', 'not-run']);
  assert.deepEqual(CLAIM_SECTIONS, ['what-changed', 'test-guide', 'tried-to-break', 'least-confident', 'risk-proofs']);
  assert.deepEqual(SECTION_KINDS, {
    'what-changed': ['change'],
    'test-guide': ['story', 'link'],
    'tried-to-break': ['story', 'check'],
    'least-confident': ['finding'],
    'risk-proofs': ['flag', 'check', 'story', 'recording', 'link'],
  });
  assert.deepEqual(CREDENTIAL_KEYS, [
    'token', 'access_token', 'password', 'passwd', 'secret', 'session', 'sessionid',
    'jwt', 'auth', 'key', 'api_key', 'sig', 'signature', 'x-amz-signature',
  ]);
  assert.equal(CREDENTIAL_KEYS.length, 14);
});

test('PACKET_MARKER_RE anchors on the first line and captures the version', () => {
  assert.equal(PACKET_MARKER_RE.exec(PACKET_MARKER)[1], '1');
  assert.equal(PACKET_MARKER_RE.exec('<!-- acceptance-packet: v12 -->\nbody')[1], '12');
  assert.equal(PACKET_MARKER_RE.test(`text\n${PACKET_MARKER}`), false);
  assert.equal(PACKET_MARKER_RE.test(LOCAL_START), false);
});

test('SECTIONS render order: keys and headings', () => {
  assert.deepEqual(SECTIONS.map((s) => s.key), [
    'what-changed', 'recording', 'test-guide', 'couldnt-test', 'tried-to-break',
    'least-confident', 'risk-proofs', 'decisions', 'deploy',
  ]);
  assert.deepEqual(SECTIONS.map((s) => s.heading), [
    'What changed', 'Recording', 'Test guide', "Couldn't test", 'Tried to break',
    'Least confident', 'Risk proofs', 'Decisions left for you', 'Deploy status',
  ]);
});

test('every claim section is a rendered section and has a kinds row', () => {
  const rendered = SECTIONS.map((s) => s.key);
  for (const section of CLAIM_SECTIONS) {
    assert.ok(rendered.includes(section), section);
    assert.ok(Object.hasOwn(SECTION_KINDS, section), section);
    for (const kind of SECTION_KINDS[section]) assert.ok(FACT_KINDS.includes(kind), kind);
  }
});

test('exports are frozen all the way down', () => {
  const frozen = [FACT_KINDS, FACT_STATUSES, CLAIM_SECTIONS, SECTION_KINDS, SECTIONS, CREDENTIAL_KEYS, VERIFICATION_WORDS];
  for (const value of frozen) assert.ok(Object.isFrozen(value));
  for (const row of Object.values(SECTION_KINDS)) assert.ok(Object.isFrozen(row));
  for (const row of SECTIONS) assert.ok(Object.isFrozen(row));
  assert.ok(Object.isFrozen(require('../../../plugin/bin/lib/wrap-up/packet-contract')));
});

test('VERIFICATION_CLAIM_RE is built from VERIFICATION_WORDS and matches whole words', () => {
  assert.deepEqual(VERIFICATION_WORDS, ['tested', 'verified', 'works']);
  assert.match('Login Verified', VERIFICATION_CLAIM_RE);
  assert.match('it works', VERIFICATION_CLAIM_RE);
  assert.match('I TESTED this', VERIFICATION_CLAIM_RE);
  assert.doesNotMatch('Open the login page', VERIFICATION_CLAIM_RE);
  assert.doesNotMatch('networks', VERIFICATION_CLAIM_RE);
});

test('findCredentialInText returns the matched key', () => {
  const cases = [
    ['curl -H "Authorization: Bearer x" http://localhost:3000/', 'authorization'],
    ['curl -H "authorization : Bearer x"', 'authorization'],
    ['cli --key abc', 'key'],
    ['cli --token=abc', 'token'],
    ['cli --token', 'token'],
    ['export API_KEY=abc', 'api_key'],
    ['TOKEN=abc npm start', 'token'],
    ['tok%65n=abc', 'token'],
    ['Open settings with password: hunter2', 'password'],
    ['password = hunter2', 'password'],
    ['x-amz-signature=1', 'x-amz-signature'],
    ['first line\nsecret=1', 'secret'],
    ['--sessionid=1', 'sessionid'],
  ];
  for (const [text, key] of cases) assert.equal(findCredentialInText(text), key, text);
});

test('findCredentialInText returns null for text that only resembles a credential', () => {
  const cases = [
    'node plugin/bin/acceptance-packet.js --help',
    'see /docs/token-guide',
    'monkey=1',
    'Open the session list',
    'cli --tokens abc',
    'cli --key-file abc',
    'cli my--key abc',
    'tokenize the input',
    '/docs/token-guide',
    'keyboard: us',
    'noauthorization: x',
    'mail user@example.com',
    'http://localhost:3000/a@b',
    'http://localhost:3000/?x=a@b',
    'http://localhost:3000?x=a@b',
    '',
  ];
  for (const text of cases) assert.equal(findCredentialInText(text), null, text);
});

test('findCredentialInText: _ and - are left boundaries, and a closing quote may precede = or :', () => {
  const cases = [
    ['GITHUB_TOKEN=ghp_abc npm start', 'token'],
    ['DB_PASSWORD=hunter2 npm start', 'password'],
    ['client_secret=abc', 'secret'],
    ['my_token=1', 'token'],
    ['x-session: abc', 'session'],
    [`curl -d '{"password":"hunter2"}' http://localhost:3000/`, 'password'],
    [`{'token' : 'x'}`, 'token'],
    ['`secret`=x', 'secret'],
    ['%FF%74oken=abc', 'token'],
  ];
  for (const [text, key] of cases) assert.equal(findCredentialInText(text), key, text);
});

test('findCredentialInText: - and _ are equivalent in flags and keys', () => {
  const cases = [
    ['cli --api-key abc', 'api_key'],
    ['cli --access-token abc', 'access_token'],
    ['cli --client-secret abc', 'secret'],
    ['cli --my_api_key=abc', 'api_key'],
    ['api-key=abc', 'api_key'],
    ['ACCESS-TOKEN: abc', 'access_token'],
    ['x_amz_signature=1', 'x-amz-signature'],
    ['cli --x_amz_signature 1', 'x-amz-signature'],
  ];
  for (const [text, key] of cases) assert.equal(findCredentialInText(text), key, text);
});

test('findCredentialInText: authorization takes a left boundary and a closing quote', () => {
  assert.equal(findCredentialInText(`curl -H '{"Authorization":"Bearer x"}'`), 'authorization');
  assert.equal(findCredentialInText('Proxy-Authorization: x'), 'authorization');
});

test('findCredentialInText: authorization is a header shape only (Decision Q2), so authorization= is not a match', () => {
  assert.equal(findCredentialInText('authorization=abc'), null);
});

test('findCredentialInText compares keys with - and _ removed, and returns the constant spelling', () => {
  const cases = [
    ['session_id=abc', 'sessionid'],
    ['cli --session-id abc', 'sessionid'],
    ['apikey=abc', 'api_key'],
    ['x-apikey: abc', 'api_key'],
    ['accesstoken=abc', 'access_token'],
    ['cli --my-apikey abc', 'api_key'],
    ['xamzsignature=1', 'x-amz-signature'],
    ['pass_word=abc', 'password'],
    ['token_=abc', 'token'],
    ['session__id=abc', 'sessionid'],
  ];
  for (const [text, key] of cases) assert.equal(findCredentialInText(text), key, text);
  for (const text of ['monkey=1', 'tokenize the input', '/docs/token-guide', 'keyboard: us', 'session_list=1', 'cli --session-idea abc']) {
    assert.equal(findCredentialInText(text), null, text);
  }
});

test('findCredentialInText: a key is the last word of a camelCase, digit or all-caps compound', () => {
  const cases = [
    ['authToken=abc', 'token'],
    ['sessionToken=abc', 'token'],
    ['apiToken=abc', 'token'],
    ['clientSecret=abc', 'secret'],
    ['APIToken=abc', 'token'],
    ['_authToken=abc123', 'token'],
    ['v2token=abc', 'token'],
    ['export CLIENTSECRET=abc', 'secret'],
    ['curl --authToken abc', 'token'],
    ['cli --clientSecret=abc', 'secret'],
  ];
  for (const [text, key] of cases) assert.equal(findCredentialInText(text), key, text);
});

test('findCredentialInText: bracket forms are screened', () => {
  const cases = [
    ['token[]=abc', 'token'],
    ['token[sub]=abc', 'token'],
    ['token[a][b]=abc', 'token'],
    ['user[password]=x', 'password'],
    ['user[password][]=x', 'password'],
  ];
  for (const [text, key] of cases) assert.equal(findCredentialInText(text), key, text);
});

test('findCredentialInText: a lowercase word that merely contains a key is not a match', () => {
  for (const text of ['monkey=1', 'keyboard=1', 'author=1', 'tokenizer=1', 'passwordless: yes', 'JavaScript: x', 'iPhone=1', 'tokens[]=1', 'see authToken in the docs']) {
    assert.equal(findCredentialInText(text), null, text);
  }
});

test('checkLink refuses a camelCase or bracketed key in the query and the fragment', () => {
  const cases = [
    ['http://localhost:3000/?authToken=abc', 'query', 'token'],
    ['http://localhost:3000/?sessionToken=abc', 'query', 'token'],
    ['http://localhost:3000/?apiToken=abc', 'query', 'token'],
    ['http://localhost:3000/?clientSecret=abc', 'query', 'secret'],
    ['http://localhost:3000/?_authToken=abc123', 'query', 'token'],
    ['http://localhost:3000/?CLIENTSECRET=abc', 'query', 'secret'],
    ['http://localhost:3000/?token[]=abc', 'query', 'token'],
    ['http://localhost:3000/?token%5B%5D=abc', 'query', 'token'],
    ['http://localhost:3000/?user[password]=x', 'query', 'password'],
    ['http://localhost:3000/?authToken', 'query', 'token'],
    ['http://localhost:3000/#authToken=abc', 'fragment', 'token'],
    ['http://localhost:3000/#/cb?authToken=abc', 'fragment', 'token'],
    ['http://localhost:3000/#user[password]=x', 'fragment', 'password'],
  ];
  for (const [url, where, key] of cases) {
    assert.deepEqual(check(url), { ok: false, reason: `credential key in ${where}: ${key}` }, url);
  }
});

test('checkLink accepts a word that merely contains a key, in the query and the fragment', () => {
  const accepted = [
    'http://localhost:3000/?monkey=1&keyboard=2&author=3&tokenizer=4',
    'http://localhost:3000/#monkey=1',
    'http://localhost:3000/#/author=1',
    'http://localhost:3000/?next=/docs/token-guide',
    'http://localhost:3000/docs/token-guide',
  ];
  for (const url of accepted) assert.deepEqual(check(url), { ok: true }, url);
});

test('findCredentialInText: URL userinfo reports password, never the matched text', () => {
  const cases = [
    'curl http://user:hunter2@localhost:3000/',
    'curl https://ghp_abc@github.com/x',
    'http%3A%2F%2Fuser%3Apw%40localhost',
    'curl http://user:a%2Fb@localhost/',
  ];
  for (const text of cases) assert.equal(findCredentialInText(text), 'password', text);
});

test('every credential key is found in flag and assignment shape', () => {
  for (const key of CREDENTIAL_KEYS) {
    assert.equal(findCredentialInText(`cli --${key} x`), key);
    assert.equal(findCredentialInText(`${key}=x`), key);
    assert.equal(findCredentialInText(`Use ${key.toUpperCase()}: x`), key);
  }
});

test('encodeFactKey escapes everything outside the id alphabet', () => {
  const cases = [
    ['src/routes/+page.svelte', 'src/routes/%2Bpage.svelte'],
    ['app/(marketing)/[slug]/page.tsx', 'app/%28marketing%29/%5Bslug%5D/page.tsx'],
    ['docs/my notes.md', 'docs/my%20notes.md'],
    ['100%.md', '100%25.md'],
    ['café.js', 'caf%C3%A9.js'],
    ['login#negative-2', 'login#negative-2'],
    ['A_z.0/#:@-', 'A_z.0/#:@-'],
    ['a😀', 'a%F0%9F%98%80'],
    ['a\nb', 'a%0Ab'],
  ];
  for (const [raw, encoded] of cases) {
    assert.equal(encodeFactKey(raw), encoded);
    assert.match(`change:${encoded}`, FACT_ID_RE);
  }
});

test('encodeFactKey never throws: a lone surrogate still yields a valid id', () => {
  assert.match(`change:${encodeFactKey('a\uD800b')}`, FACT_ID_RE);
});

test('encodeFactKey throws on a non-string rather than minting an "undefined" key', () => {
  assert.throws(() => encodeFactKey(undefined), TypeError);
});

test('FACT_ID_RE accepts only the escapes encodeFactKey produces', () => {
  for (const id of ['change:+page.svelte', 'change:100%.md', 'change:%2b', 'change:', 'Change:a', ':a', 'change', 'change:a b', 'change:a\n']) {
    assert.doesNotMatch(id, FACT_ID_RE, id);
  }
  assert.match('deploy-target:a', FACT_ID_RE);
});
