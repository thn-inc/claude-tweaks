'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  SUITE_STAMP_NAME, readSuiteStamps, writeSuiteStamps, composeSuiteCoverage,
} = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'suite-stamp.js'));

function fakeFs(files = {}) {
  return {
    files,
    readFileSync: (p) => {
      if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return files[p];
    },
    writeFileSync: (p, data) => { files[p] = data; },
    renameSync: (from, to) => { files[to] = files[from]; delete files[from]; },
    unlinkSync: (p) => { delete files[p]; },
  };
}

const SHA_A = '0123456789abcdef0123456789abcdef01234567';
const SHA_B = 'fedcba9876543210fedcba9876543210fedcba98';

test('readSuiteStamps returns {} when the file is absent', () => {
  assert.deepStrictEqual(readSuiteStamps('/g', fakeFs()), {});
});

test('readSuiteStamps returns {} on unparseable JSON or a non-object top level', () => {
  assert.deepStrictEqual(readSuiteStamps('/g', fakeFs({ [path.join('/g', SUITE_STAMP_NAME)]: 'not json' })), {});
  assert.deepStrictEqual(readSuiteStamps('/g', fakeFs({ [path.join('/g', SUITE_STAMP_NAME)]: '[1,2]' })), {});
  assert.deepStrictEqual(readSuiteStamps('/g', fakeFs({ [path.join('/g', SUITE_STAMP_NAME)]: '"x"' })), {});
});

test('readSuiteStamps drops a malformed per-check entry without discarding the others', () => {
  const fsImpl = fakeFs({
    [path.join('/g', SUITE_STAMP_NAME)]: JSON.stringify({
      types: { sha: SHA_A, dirty: false, at: 't' },
      lint: { sha: 'not-a-sha', dirty: false, at: 't' },
      tests: { sha: SHA_A, dirty: 'false' },
      web: null,
    }),
  });
  assert.deepStrictEqual(readSuiteStamps('/g', fsImpl), { types: { sha: SHA_A, dirty: false, at: 't' } });
});

test('writeSuiteStamps merges over the existing file and writes atomically', () => {
  const fsImpl = fakeFs({ [path.join('/g', SUITE_STAMP_NAME)]: JSON.stringify({ types: { sha: SHA_A, dirty: false, at: 't1' } }) });
  const merged = writeSuiteStamps('/g', { lint: { sha: SHA_A, dirty: false, at: 't2' } }, fsImpl);
  assert.deepStrictEqual(merged, {
    types: { sha: SHA_A, dirty: false, at: 't1' },
    lint: { sha: SHA_A, dirty: false, at: 't2' },
  });
  assert.deepStrictEqual(JSON.parse(fsImpl.files[path.join('/g', SUITE_STAMP_NAME)]), merged);
  assert.ok(!Object.keys(fsImpl.files).some((p) => p.includes('.tmp-')), 'no pid-suffixed tmp file left behind');
});

test('writeSuiteStamps with a null update clears that check\'s record, leaving the others (#3002 Deliverable 3)', () => {
  const fsImpl = fakeFs({
    [path.join('/g', SUITE_STAMP_NAME)]: JSON.stringify({
      types: { sha: SHA_A, dirty: false, at: 't1' },
      tests: { sha: SHA_A, dirty: false, at: 't1' },
    }),
  });
  const merged = writeSuiteStamps('/g', { tests: null }, fsImpl);
  assert.deepStrictEqual(merged, { types: { sha: SHA_A, dirty: false, at: 't1' } });
});

test('composeSuiteCoverage returns null for an empty declared list', () => {
  assert.strictEqual(composeSuiteCoverage({ declaredChecks: [], suiteStamps: {}, headSha: SHA_A, headDirty: false }), null);
});

test('composeSuiteCoverage is complete only when every declared check has a record matching the current clean sha (#3002 AC1/AC2)', () => {
  const suiteStamps = {
    types: { sha: SHA_A, dirty: false, at: 't' },
    lint: { sha: SHA_A, dirty: false, at: 't' },
    tests: { sha: SHA_A, dirty: false, at: 't' },
  };
  const complete = composeSuiteCoverage({ declaredChecks: ['types', 'lint', 'tests'], suiteStamps, headSha: SHA_A, headDirty: false });
  assert.deepStrictEqual(complete, { declared: ['types', 'lint', 'tests'], covered: ['types', 'lint', 'tests'], missing: [], complete: true });

  const missingOne = composeSuiteCoverage({ declaredChecks: ['types', 'lint', 'tests', 'e2e'], suiteStamps, headSha: SHA_A, headDirty: false });
  assert.deepStrictEqual(missingOne.missing, ['e2e']);
  assert.strictEqual(missingOne.complete, false);
});

test('composeSuiteCoverage never counts a record from an earlier sha (#3002 AC3)', () => {
  const suiteStamps = { tests: { sha: SHA_B, dirty: false, at: 't' } };
  const r = composeSuiteCoverage({ declaredChecks: ['tests'], suiteStamps, headSha: SHA_A, headDirty: false });
  assert.deepStrictEqual(r, { declared: ['tests'], covered: [], missing: ['tests'], complete: false });
});

test('composeSuiteCoverage never counts anything when the live tree is dirty, even with matching-sha records (#3002 AC3)', () => {
  const suiteStamps = { tests: { sha: SHA_A, dirty: false, at: 't' } };
  const r = composeSuiteCoverage({ declaredChecks: ['tests'], suiteStamps, headSha: SHA_A, headDirty: true });
  assert.strictEqual(r.complete, false);
  assert.deepStrictEqual(r.missing, ['tests']);
});

test('composeSuiteCoverage never counts a record itself written against a dirty tree (#3002 AC3)', () => {
  const suiteStamps = { tests: { sha: SHA_A, dirty: true, at: 't' } };
  const r = composeSuiteCoverage({ declaredChecks: ['tests'], suiteStamps, headSha: SHA_A, headDirty: false });
  assert.deepStrictEqual(r.missing, ['tests']);
});
