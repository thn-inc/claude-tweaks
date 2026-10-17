'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  readStamp, detectRegression, caveatLine,
  nextFlakyHits, flakyEscalations, escalationCaveatLine, FLAKY_ESCALATION_HITS,
} = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'count-stamp.js'));

function fakeFs(files) {
  return {
    readFileSync: (p) => {
      if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return files[p];
    },
  };
}

test('readStamp returns null when the file does not exist (bootstrap, first run)', () => {
  assert.strictEqual(readStamp('/nope.json', fakeFs({})), null);
});

test('readStamp returns null on malformed JSON (fail toward absence)', () => {
  assert.strictEqual(readStamp('/c.json', fakeFs({ '/c.json': 'not json' })), null);
});

test('readStamp returns null when tests is missing or not a finite number', () => {
  assert.strictEqual(readStamp('/c.json', fakeFs({ '/c.json': '{"sha":"abc"}' })), null);
  assert.strictEqual(readStamp('/c.json', fakeFs({ '/c.json': '{"tests":"9"}' })), null);
  assert.strictEqual(readStamp('/c.json', fakeFs({ '/c.json': '{"tests":null}' })), null);
});

test('readStamp parses a well-formed stamp', () => {
  const fs = fakeFs({ '/c.json': '{"tests":10,"sha":"abc","recordedAt":"2026-08-27T00:00:00.000Z"}' });
  assert.deepStrictEqual(readStamp('/c.json', fs), { tests: 10, sha: 'abc', recordedAt: '2026-08-27T00:00:00.000Z' });
});

test('detectRegression returns null when there is no previous baseline (bootstrap)', () => {
  assert.strictEqual(detectRegression(null, { tests: 5 }), null);
});

test('detectRegression returns null when the current run has no parseable count', () => {
  assert.strictEqual(detectRegression({ tests: 5 }, null), null);
});

test('detectRegression returns null when the count held steady or increased', () => {
  assert.strictEqual(detectRegression({ tests: 10 }, { tests: 10 }), null);
  assert.strictEqual(detectRegression({ tests: 10 }, { tests: 12 }), null);
});

// IL-84's exact shape: an enumerated-glob npm test configuration silently
// excluded a whole test directory (15 tests never ran) while still exiting
// 0 -- a drop that looked identical to a clean pass. This fixture reproduces
// that shape at the detection layer: a prior run recorded 100 tests, this
// run's glob silently excluded a directory and only 85 ran.
test('detectRegression fires on IL-84\'s exact shape -- a silent glob exclusion drops the count', () => {
  const previous = { tests: 100, sha: 'aaa', recordedAt: '2026-08-20T00:00:00.000Z' };
  const current = { tests: 85, sha: 'bbb', recordedAt: '2026-08-27T00:00:00.000Z' };
  const regression = detectRegression(previous, current);
  assert.deepStrictEqual(regression, { previousTests: 100, currentTests: 85, droppedBy: 15 });
});

test('caveatLine returns null when there is no regression', () => {
  assert.strictEqual(caveatLine(null), null);
});

test('caveatLine names the drop, the delta, and cites IL-84', () => {
  const line = caveatLine({ previousTests: 100, currentTests: 85, droppedBy: 15 });
  assert.match(line, /^CAVEAT:/);
  assert.match(line, /100/);
  assert.match(line, /85/);
  assert.match(line, /15/);
  assert.match(line, /IL-84/);
});

test('nextFlakyHits increments each retried file, keeps other allowlisted counts, and prunes files no longer allowlisted (#1925)', () => {
  const previous = { tests: 10, sha: 'a', recordedAt: 't', flakyHits: { 'tests/a.test.js': 2, 'tests/gone.test.js': 7, 'tests/b.test.js': 1 } };
  assert.deepStrictEqual(
    nextFlakyHits(previous, ['tests/a.test.js', 'tests/new.test.js'], ['tests/a.test.js', 'tests/b.test.js', 'tests/new.test.js']),
    { 'tests/a.test.js': 3, 'tests/b.test.js': 1, 'tests/new.test.js': 1 },
  );
});

test('nextFlakyHits treats a null allowlist (no declaration read) as unknown and carries every prior count forward untouched (#1925)', () => {
  const previous = { tests: 1, flakyHits: { 'tests/a.test.js': 3, 'tests/b.test.js': 1 } };
  assert.deepStrictEqual(nextFlakyHits(previous, [], null), { 'tests/a.test.js': 3, 'tests/b.test.js': 1 });
  // A retry under an unknown allowlist still counts, alongside the carried-forward map (review 3f, #1925).
  assert.deepStrictEqual(nextFlakyHits(previous, ['tests/a.test.js', 'tests/new.test.js'], null), { 'tests/a.test.js': 4, 'tests/b.test.js': 1, 'tests/new.test.js': 1 });
});

test('nextFlakyHits tolerates a missing or malformed flakyHits map and a null previous stamp (bootstrap)', () => {
  assert.deepStrictEqual(nextFlakyHits(null, ['tests/a.test.js'], ['tests/a.test.js']), { 'tests/a.test.js': 1 });
  assert.deepStrictEqual(nextFlakyHits({ tests: 1, flakyHits: 'nope' }, [], ['tests/a.test.js']), {});
  assert.deepStrictEqual(nextFlakyHits({ tests: 1, flakyHits: { 'tests/a.test.js': 'x' } }, [], ['tests/a.test.js']), {});
});

test('flakyEscalations lists allowlisted files at or above the threshold, sorted by file, and the caveat names the count (#1925 AC5 shape)', () => {
  assert.strictEqual(FLAKY_ESCALATION_HITS, 5);
  assert.deepStrictEqual(
    flakyEscalations({ 'tests/z.test.js': 6, 'tests/a.test.js': 5, 'tests/b.test.js': 4 }, ['tests/a.test.js', 'tests/z.test.js']),
    [
      { file: 'tests/a.test.js', hits: 5, onAllowlist: true }, { file: 'tests/z.test.js', hits: 6, onAllowlist: true },
    ],
  );
  assert.strictEqual(
    escalationCaveatLine({ file: 'tests/a.test.js', hits: 5, onAllowlist: true }),
    'CAVEAT: flaky-allowlist: tests/a.test.js retried 5 times — file a fix or remove it from the allowlist',
  );
});

// #3062: a baseline-adjudicated flaky file is counted into flakyHits the
// same way a retried allowlisted file is, and the file need not be on
// `flaky.files` for the count to accumulate across runs -- that is exactly
// the case the escalation-to-staged-proposal path (below) exists for.
test('nextFlakyHits accumulates a non-allowlisted baseline-flaky file across runs instead of resetting to 1 (#3062 AC1)', () => {
  const allowlist = ['tests/other.test.js'];
  const run1 = nextFlakyHits(null, ['tests/unlisted.test.js'], allowlist);
  assert.deepStrictEqual(run1, { 'tests/unlisted.test.js': 1 });
  const run2 = nextFlakyHits({ tests: 1, flakyHits: run1 }, ['tests/unlisted.test.js'], allowlist);
  assert.deepStrictEqual(run2, { 'tests/unlisted.test.js': 2 });
});

test('nextFlakyHits drops a non-allowlisted flagged file the moment a later run no longer flags it', () => {
  const allowlist = [];
  const run1 = nextFlakyHits(null, ['tests/unlisted.test.js'], allowlist);
  const run2 = nextFlakyHits({ tests: 1, flakyHits: run1 }, [], allowlist);
  assert.deepStrictEqual(run2, {});
});

test('flakyEscalations marks onAllowlist false for a file reaching the threshold without being declared, matching exactly (not substring) and glob patterns (#3062 AC2)', () => {
  const escalations = flakyEscalations(
    { 'tests/undeclared.test.js': 5, 'tests/declared.test.js': 5, 'tests/globbed.test.js': 5 },
    ['tests/declared.test.js', 'tests/glob*.test.js'],
  );
  assert.deepStrictEqual(escalations, [
    { file: 'tests/declared.test.js', hits: 5, onAllowlist: true },
    { file: 'tests/globbed.test.js', hits: 5, onAllowlist: true },
    { file: 'tests/undeclared.test.js', hits: 5, onAllowlist: false },
  ]);
});

test('flakyEscalations treats a null allowlist (no declaration) as nothing on it', () => {
  const escalations = flakyEscalations({ 'tests/undeclared.test.js': 5 }, null);
  assert.deepStrictEqual(escalations, [{ file: 'tests/undeclared.test.js', hits: 5, onAllowlist: false }]);
});

test('escalationCaveatLine renders the staged-proposal wording for a non-allowlisted escalation, never the fix-or-remove wording (#3062 AC2)', () => {
  const line = escalationCaveatLine({ file: 'tests/undeclared.test.js', hits: 5, onAllowlist: false });
  assert.strictEqual(
    line,
    'CAVEAT: flaky-allowlist: tests/undeclared.test.js baseline-flaky 5 times — not on flaky.files; a staged proposal to add it is pending review',
  );
  assert.doesNotMatch(line, /file a fix or remove it/);
});
