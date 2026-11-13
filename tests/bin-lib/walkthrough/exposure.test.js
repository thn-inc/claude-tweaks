// tests/bin-lib/walkthrough/exposure.test.js
// The embed/link decision for a recording (#4612): one function, a test per branch.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decideExposure, readRepoVisibility } = require('../../../plugin/bin/lib/walkthrough/exposure');
const { EXPOSURES } = require('../../../plugin/bin/lib/wrap-up/packet-contract');

const LANDING = 'https://store.example/landing/run-4612';
const probe = (extra) => ({ anonymousFetch: 'refused', url: LANDING, ...extra });

test('EXPOSURES holds the three values, in order, frozen', () => {
  assert.deepEqual(EXPOSURES, ['local-only', 'linked-private', 'withheld']);
  assert.ok(Object.isFrozen(EXPOSURES));
});

test('no probe is local-only', () => {
  assert.equal(decideExposure({ repoVisibility: 'private', storeProbe: null }), 'local-only');
  assert.equal(decideExposure({ repoVisibility: 'private' }), 'local-only');
  assert.equal(decideExposure({ repoVisibility: 'private', storeProbe: undefined }), 'local-only');
  assert.equal(decideExposure(), 'local-only');
});

test('a store that did not refuse the anonymous fetch is local-only', () => {
  for (const anonymousFetch of ['allowed', 'unreachable', undefined, 'REFUSED', 'maybe', true, null]) {
    assert.equal(decideExposure({ repoVisibility: 'private', storeProbe: probe({ anonymousFetch }) }), 'local-only', String(anonymousFetch));
  }
});

test('a landing page that carries a credential is withheld', () => {
  for (const url of ['https://store.example/p?token=abc', 'https://store.example/p#sig=abc', 'https://u:p@store.example/p',
    'https://store.example/a/Xk3j9f8s7d6f5g4h3j2k1/b']) {
    assert.equal(decideExposure({ repoVisibility: 'private', storeProbe: probe({ url }) }), 'withheld', url);
  }
});

test('a landing page the link rule refuses for any other reason is local-only', () => {
  for (const url of ['not a url', 'ftp://store.example/p', 'javascript:alert(1)', '', undefined, null, 42]) {
    assert.equal(decideExposure({ repoVisibility: 'private', storeProbe: probe({ url }) }), 'local-only', String(url));
  }
});

test('an image url is local-only even when the probe was refused', () => {
  for (const url of ['https://store.example/rec.gif', 'https://store.example/a/rec.PNG?x=1']) {
    assert.equal(decideExposure({ repoVisibility: 'private', storeProbe: probe({ url }) }), 'local-only', url);
  }
});

test('a credential in an image url is still withheld, not merely local-only', () => {
  assert.equal(decideExposure({ repoVisibility: 'private', storeProbe: probe({ url: 'https://store.example/rec.gif?token=abc' }) }), 'withheld');
});

test('a secret gist is local-only whatever the visibility', () => {
  for (const repoVisibility of ['private', 'public']) {
    assert.equal(decideExposure({ repoVisibility, storeProbe: probe({ store: 'secret-gist' }) }), 'local-only', repoVisibility);
  }
});

test('an actions artifact needs a private repository', () => {
  assert.equal(decideExposure({ repoVisibility: 'private', storeProbe: probe({ store: 'actions-artifact' }) }), 'linked-private');
  for (const repoVisibility of ['public', 'unknown', 'Private', undefined, null, true]) {
    assert.equal(decideExposure({ repoVisibility, storeProbe: probe({ store: 'actions-artifact' }) }), 'local-only', String(repoVisibility));
  }
});

test('a refused, non-image, non-gist store is linked-private', () => {
  assert.equal(decideExposure({ repoVisibility: 'private', storeProbe: probe() }), 'linked-private');
  assert.equal(decideExposure({ repoVisibility: 'public', storeProbe: probe({ store: 'other-store' }) }), 'linked-private');
  assert.equal(decideExposure({ repoVisibility: 'public', storeProbe: probe({ url: 'http://[::1]:8080/landing' }) }), 'linked-private');
});

test('AC2.3: the v1 outcome is local-only whatever the visibility, with no probe', () => {
  for (const v of ['public', 'private', 'unknown', undefined, null]) {
    assert.equal(decideExposure({ repoVisibility: v, storeProbe: null }), 'local-only', String(v));
  }
});

test('every decision is one of EXPOSURES', () => {
  const probes = [null, probe(), probe({ url: 'https://s.example/?token=1' }), probe({ anonymousFetch: 'allowed' }), probe({ store: 'secret-gist' })];
  for (const storeProbe of probes) {
    assert.ok(EXPOSURES.includes(decideExposure({ repoVisibility: 'private', storeProbe })));
  }
});

test('readRepoVisibility: isPrivate true is private, with the gh args it names', () => {
  const calls = [];
  const gh = (args) => { calls.push(args); return '{"isPrivate":true}'; };
  assert.equal(readRepoVisibility(gh), 'private');
  assert.deepEqual(calls, [['repo', 'view', '--json', 'isPrivate']]);
});

test('readRepoVisibility: anything but isPrivate true is public (fail closed)', () => {
  for (const out of ['{"isPrivate":false}', '{}', '{"isPrivate":"yes"}', '{"isPrivate":"true"}', '{"isPrivate":1}', 'not json', '', 'null', '[]', '{"isPrivate":null}', undefined, null, 42]) {
    assert.equal(readRepoVisibility(() => out), 'public', String(out));
  }
});

test('readRepoVisibility: a throwing runner is public', () => {
  assert.equal(readRepoVisibility(() => { throw new Error('gh: not found'); }), 'public');
});

test('readRepoVisibility: a missing runner is public', () => {
  assert.equal(readRepoVisibility(undefined), 'public');
});
