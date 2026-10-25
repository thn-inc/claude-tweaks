'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeText, fingerprintFromBasis, createFingerprint, parseMarkerFingerprints } = require('../../../plugin/bin/lib/health-core/fingerprint');

test('normalizeText collapses whitespace and lowercases', () => {
  assert.strictEqual(normalizeText('  Foo   BAR  baz '), 'foo bar baz');
});

test('fingerprintFromBasis returns a <prefix>-<8hex> id', () => {
  const id = fingerprintFromBasis('someprefix', ['a', 'b', 'c']);
  assert.match(id, /^someprefix-[0-9a-f]{8}$/);
});

test('fingerprintFromBasis is stable for identical basis arrays', () => {
  assert.strictEqual(
    fingerprintFromBasis('p', ['a', 'b']),
    fingerprintFromBasis('p', ['a', 'b']),
  );
});

test('fingerprintFromBasis differs when the basis array differs', () => {
  assert.notStrictEqual(
    fingerprintFromBasis('p', ['a', 'b']),
    fingerprintFromBasis('p', ['a', 'c']),
  );
});

test('fingerprintFromBasis differs when the prefix differs, even with the same basis', () => {
  assert.notStrictEqual(
    fingerprintFromBasis('p1', ['a', 'b']),
    fingerprintFromBasis('p2', ['a', 'b']),
  );
});

test('createFingerprint: skillName dashes are stripped to build the id prefix', () => {
  const { fingerprint } = createFingerprint('journey-health', ['journey', 'category', 'section', 'description']);
  const id = fingerprint({ journey: 'checkout-flow', category: 'drift', section: 'self-review', description: 'x' });
  assert.match(id, /^journeyhealth-[0-9a-f]{8}$/);
});

test('createFingerprint: fingerprint pulls basis fields in the given order, normalizing description', () => {
  const { fingerprint } = createFingerprint('docs-health', ['assetType', 'target', 'section', 'description']);
  const a = fingerprint({ assetType: 'doc', target: 'guides/setup', section: 'Overview', description: 'Stale   Count' });
  const b = fingerprint({ assetType: 'doc', target: 'guides/setup', section: 'Overview', description: 'stale count' });
  assert.strictEqual(a, b);
  const c = fingerprint({ assetType: 'doc', target: 'guides/other', section: 'Overview', description: 'Stale   Count' });
  assert.notStrictEqual(a, c);
});

test('createFingerprint: two skills with the same basis fields still produce different ids (prefix isolation)', () => {
  const journey = createFingerprint('journey-health', ['assetType', 'target', 'section', 'description']);
  const docs = createFingerprint('docs-health', ['assetType', 'target', 'section', 'description']);
  const args = { assetType: 'doc', target: 'x', section: 'y', description: 'z' };
  assert.notStrictEqual(journey.fingerprint(args), docs.fingerprint(args));
});

test('createFingerprint: normalizeDescription is exposed and behaves like normalizeText', () => {
  const { normalizeDescription } = createFingerprint('journey-health', ['description']);
  assert.strictEqual(normalizeDescription('  Foo   BAR  baz '), 'foo bar baz');
});

test('AC2.1: parseMarkerFingerprints extracts digest-fingerprint markers', () => {
  const body = '- [ ] **a** <!-- digest-fingerprint: fp-1 -->\n- [ ] **b** <!-- digest-fingerprint: fp-2 -->';
  assert.deepStrictEqual(parseMarkerFingerprints(body, 'digest-fingerprint'), ['fp-1', 'fp-2']);
});

test('AC2.1: parseMarkerFingerprints extracts materiality-fingerprint markers, ignoring trailing suffixes and other prefixes', () => {
  const text = '- [x] f <!-- materiality-fingerprint: materiality-aaaa1111 --> → #12\n- [y] g <!-- materiality-fingerprint: materiality-bbbb2222 --> <!-- digest-fingerprint: other -->';
  assert.deepStrictEqual(parseMarkerFingerprints(text, 'materiality-fingerprint'), ['materiality-aaaa1111', 'materiality-bbbb2222']);
});

test('AC2.1: parseMarkerFingerprints returns [] for a body with no marker, and for null/undefined/empty', () => {
  assert.deepStrictEqual(parseMarkerFingerprints('plain body, no markers', 'digest-fingerprint'), []);
  assert.deepStrictEqual(parseMarkerFingerprints(null, 'digest-fingerprint'), []);
  assert.deepStrictEqual(parseMarkerFingerprints(undefined, 'materiality-fingerprint'), []);
  assert.deepStrictEqual(parseMarkerFingerprints('', 'materiality-fingerprint'), []);
  assert.deepStrictEqual(parseMarkerFingerprints(42, 'digest-fingerprint'), []);
});

test('parseMarkerFingerprints matches the prefix literally (regex metacharacters escaped)', () => {
  assert.deepStrictEqual(parseMarkerFingerprints('<!-- a.b: one --> <!-- aXb: two -->', 'a.b'), ['one']);
  assert.deepStrictEqual(parseMarkerFingerprints('<!-- a$b: one --> <!-- ab: two -->', 'a$b'), ['one']);
  assert.deepStrictEqual(parseMarkerFingerprints('<!-- a(b: one --> <!-- ab: two -->', 'a(b'), ['one']);
});
