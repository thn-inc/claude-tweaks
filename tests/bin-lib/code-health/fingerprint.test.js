const { test } = require('node:test');
const assert = require('node:assert');
const { fingerprint, normalizeAnchor } = require('../../../plugin/bin/lib/code-health/fingerprint');
const { fingerprintFromBasis } = require('../../../plugin/bin/lib/health-core/fingerprint');

test('normalizeAnchor lowercases path, strips :line and :line:col on either side of #', () => {
  // symbol side must not be stripped — only :line(:col) artifacts
  assert.strictEqual(
    normalizeAnchor('src/Foo.ts:12#handleRequest'),
    'src/foo.ts#handleRequest',
  );
  assert.strictEqual(
    normalizeAnchor('src/Foo.ts#handleRequest:99:3'),
    'src/foo.ts#handleRequest',
  );
  assert.strictEqual(
    normalizeAnchor('  src/Bar.ts  #  doThing  '),
    'src/bar.ts#doThing',
  );
});

test('v2 fingerprint returns a codehealth-<8hex> id', () => {
  const id = fingerprint({ criterion: 'simplification', areaId: 'src/api', anchor: 'src/api/user.js#getUser' });
  assert.match(id, /^codehealth-[0-9a-f]{8}$/);
});

test('v2 fingerprint is stable when the finding moves lines (anchor stability)', () => {
  // Line number in anchor file ref is stripped by normalizeAnchor.
  const a = fingerprint({ criterion: 'dead-code', areaId: 'src', anchor: 'src/util.js:42#trimPath' });
  const b = fingerprint({ criterion: 'dead-code', areaId: 'src', anchor: 'src/util.js:99#trimPath' });
  assert.strictEqual(a, b, 'moved line must not change the fingerprint');
});

test('v2 fingerprint is stable when prose around the anchor is reworded', () => {
  // The anchor itself is the same; wording of the surrounding evidence is irrelevant.
  const a = fingerprint({ criterion: 'naming-clarity', areaId: 'lib', anchor: 'lib/parser.js#parse' });
  const b = fingerprint({ criterion: 'naming-clarity', areaId: 'lib', anchor: 'lib/parser.js#parse' });
  assert.strictEqual(a, b);
});

test('v2 fingerprint differs when criterion, areaId, or anchor differs', () => {
  const base = { criterion: 'resilience', areaId: 'src', anchor: 'src/http.js#fetch' };
  assert.notStrictEqual(
    fingerprint(base),
    fingerprint({ ...base, criterion: 'security-logic' }),
  );
  assert.notStrictEqual(
    fingerprint(base),
    fingerprint({ ...base, areaId: 'lib' }),
  );
  assert.notStrictEqual(
    fingerprint(base),
    fingerprint({ ...base, anchor: 'src/http.js#retry' }),
  );
});

// REGRESSION: fingerprint must delegate to health-core's shared
// fingerprintFromBasis primitive (the same one harness-health/journey-health/
// docs-health use), not a hand-rolled inline sha1 — so a future change to the
// id format lands in one place instead of code-health's copy silently
// drifting out of sync.
test('v2 fingerprint is byte-identical to fingerprintFromBasis(\'codehealth\', [criterion, areaId, normalizeAnchor(anchor)])', () => {
  const args = { criterion: 'simplification', areaId: 'src/api', anchor: 'src/api/user.js#getUser' };
  const expected = fingerprintFromBasis('codehealth', ['simplification', 'src/api', normalizeAnchor('src/api/user.js#getUser')]);
  assert.strictEqual(fingerprint(args), expected);
});

// The id is persisted in filed issue markers and dedup keys on it, so these
// literals were captured before the v1 branch was deleted (#5536) and must
// never be recomputed to follow a change — a change here forks dedup.
test('fingerprint v2 ids are pinned literals — the id is persisted in issue markers and dedup keys on it (#5536)', () => {
  assert.strictEqual(
    fingerprint({ criterion: 'simplification', areaId: 'src/api', anchor: 'src/api/user.js#getUser' }),
    'codehealth-a7f87202',
  );
  assert.strictEqual(
    fingerprint({ criterion: 'dead-code', areaId: 'src', anchor: 'src/util.js:42#trimPath' }),
    'codehealth-a46a4581',
  );
  assert.strictEqual(
    fingerprint({ criterion: 'bad-practice', areaId: '.', anchor: 'a.js#TODO x' }),
    'codehealth-678965af',
  );
});
