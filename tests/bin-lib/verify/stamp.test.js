'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  composeStamp, writeStamp, readStamp, STAMP_JSON_NAME, STAMP_LEGACY_NAME,
} = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'stamp.js'));

function fakeFs(files = {}) {
  return {
    files,
    readFileSync: (p) => {
      if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return files[p];
    },
    writeFileSync: (p, data) => { files[p] = data; },
    renameSync: (from, to) => { files[to] = files[from]; delete files[from]; },
  };
}

const REPORT = { sha: 'abc123', dirty: false, pass: true, checks: {} };

test('composeStamp copies sha/dirty from the report and carries every field verbatim', () => {
  const stamp = composeStamp({
    report: REPORT, scope: 'full', fullSha: 'abc123', base: null, changedFiles: [],
    suitesRun: ['tests'], flakyRetried: [], reportPath: '/g/claude-tweaks-verify/report.json',
    at: '2026-09-05T14:07:09Z',
  });
  assert.deepStrictEqual(stamp, {
    sha: 'abc123', dirty: false, scope: 'full', fullSha: 'abc123', base: null, changedFiles: [],
    suitesRun: ['tests'], flakyRetried: [], reportPath: '/g/claude-tweaks-verify/report.json',
    at: '2026-09-05T14:07:09Z',
  });
});

test('composeStamp never lets caller-supplied fields override the derived sha/dirty (no spread-after-derived)', () => {
  const stamp = composeStamp({
    report: { sha: 'real', dirty: true }, scope: 'full', fullSha: 'real', base: null, changedFiles: [],
    suitesRun: [], flakyRetried: [], reportPath: '/r.json', at: 't', sha: 'forged', dirty: false,
  });
  assert.strictEqual(stamp.sha, 'real');
  assert.strictEqual(stamp.dirty, true);
});

test('writeStamp writes the JSON stamp and the legacy bare-SHA twin atomically', () => {
  const fsImpl = fakeFs();
  const stamp = composeStamp({
    report: REPORT, scope: 'full', fullSha: 'abc123', base: null, changedFiles: [],
    suitesRun: ['tests'], flakyRetried: [], reportPath: '/r.json', at: 't',
  });
  const out = writeStamp('/g', stamp, { fsImpl });
  assert.strictEqual(out.jsonPath, path.join('/g', STAMP_JSON_NAME));
  assert.strictEqual(out.legacyPath, path.join('/g', STAMP_LEGACY_NAME));
  assert.deepStrictEqual(JSON.parse(fsImpl.files[out.jsonPath]), stamp);
  assert.strictEqual(fsImpl.files[out.legacyPath], 'abc123\n');
  assert.ok(!Object.keys(fsImpl.files).some((p) => p.endsWith('.tmp')), 'no tmp files left behind');
});

test('writeStamp writes the JSON stamp through a pid-suffixed tmp file (#2004 — migrated off the retired lib/verify/atomic-write.js)', () => {
  const fsImpl = fakeFs();
  const stamp = composeStamp({
    report: REPORT, scope: 'full', fullSha: 'abc123', base: null, changedFiles: [],
    suitesRun: ['tests'], flakyRetried: [], reportPath: '/r.json', at: 't',
  });
  const writeCalls = [];
  const spiedFsImpl = {
    ...fsImpl,
    writeFileSync: (p, data) => { writeCalls.push(p); fsImpl.writeFileSync(p, data); },
  };
  const out = writeStamp('/g', stamp, { fsImpl: spiedFsImpl });
  // out.legacyPath ("…verify-pass") is a string-prefix of out.jsonPath
  // ("…verify-pass.json"), so an exact-match check is required here — a
  // startsWith/prefix match against the legacy path would also match the
  // JSON tmp write, since it happens first.
  const jsonTmpWrite = writeCalls.find((p) => p.startsWith(`${out.jsonPath}.tmp`));
  assert.ok(jsonTmpWrite, 'the JSON stamp write must go through a tmp-then-rename path');
  assert.ok(/\.tmp-\d+$/.test(jsonTmpWrite), `JSON stamp tmp path must be pid-suffixed (got ${jsonTmpWrite}), not the retired module's bare .tmp`);
  // The legacy bare-SHA twin write is untouched (Non-Goals) — still the plain,
  // non-pid-suffixed `.tmp` shape.
  const legacyTmpWrite = writeCalls.find((p) => p === `${out.legacyPath}.tmp`);
  assert.strictEqual(legacyTmpWrite, `${out.legacyPath}.tmp`);
});

test('writeStamp with legacy:false writes only the JSON stamp and leaves an existing bare file untouched (#1922 review H1)', () => {
  const fsImpl = fakeFs({ [path.join('/g', STAMP_LEGACY_NAME)]: 'lastfullsha\n' });
  const stamp = composeStamp({
    report: REPORT, scope: 'scoped', fullSha: 'lastfullsha', base: 'lastfullsha', changedFiles: ['a.js'],
    suitesRun: ['unit'], flakyRetried: [], reportPath: '/r.json', at: 't',
  });
  const out = writeStamp('/g', stamp, { fsImpl, legacy: false });
  assert.deepStrictEqual(JSON.parse(fsImpl.files[out.jsonPath]), stamp);
  assert.strictEqual(fsImpl.files[out.legacyPath], 'lastfullsha\n', 'the bare file must keep naming the last real FULL pass');
  assert.ok(!Object.keys(fsImpl.files).some((p) => p.endsWith('.tmp')), 'no tmp files left behind');
});

test('readStamp returns null when neither file exists', () => {
  assert.strictEqual(readStamp('/g', fakeFs()), null);
});

test('readStamp prefers the JSON stamp regardless of the bare file', () => {
  const JSON_SHA = '0123456789abcdef0123456789abcdef01234567';
  const fsImpl = fakeFs({
    [path.join('/g', STAMP_JSON_NAME)]: JSON.stringify({ sha: JSON_SHA, scope: 'full', fullSha: JSON_SHA }),
    [path.join('/g', STAMP_LEGACY_NAME)]: 'bare\n',
  });
  assert.deepStrictEqual(readStamp('/g', fsImpl), { sha: JSON_SHA, scope: 'full', fullSha: JSON_SHA });
});

test('readStamp returns null on unparseable JSON — never falls back to the bare file', () => {
  const fsImpl = fakeFs({
    [path.join('/g', STAMP_JSON_NAME)]: 'not json',
    [path.join('/g', STAMP_LEGACY_NAME)]: '0123456789abcdef0123456789abcdef01234567\n',
  });
  assert.strictEqual(readStamp('/g', fsImpl), null);
});

test('readStamp returns null when the JSON parses but is not an object with a string sha', () => {
  assert.strictEqual(readStamp('/g', fakeFs({ [path.join('/g', STAMP_JSON_NAME)]: '"abc"' })), null);
  assert.strictEqual(readStamp('/g', fakeFs({ [path.join('/g', STAMP_JSON_NAME)]: '{"scope":"full"}' })), null);
});

test('readStamp falls back to the bare file as a legacy full-scope stamp when JSON is absent', () => {
  const fsImpl = fakeFs({ [path.join('/g', STAMP_LEGACY_NAME)]: '0123456789abcdef0123456789abcdef01234567\n' });
  assert.deepStrictEqual(readStamp('/g', fsImpl), { sha: '0123456789abcdef0123456789abcdef01234567', scope: 'full', legacy: true });
});

test('readStamp returns null when the bare file is not a 40-hex SHA', () => {
  const fsImpl = fakeFs({ [path.join('/g', STAMP_LEGACY_NAME)]: 'garbage\n' });
  assert.strictEqual(readStamp('/g', fsImpl), null);
  assert.strictEqual(readStamp('/g', fakeFs({ [path.join('/g', STAMP_LEGACY_NAME)]: '' })), null);
});

// #1922 review finding (low): the JSON branch must enforce SHA_RE on sha and
// (when present) fullSha the same way the legacy bare-file branch does —
// fail toward absence rather than trusting an arbitrary JSON string.
test('readStamp returns null when the JSON sha is not a 40-hex SHA', () => {
  const fsImpl = fakeFs({
    [path.join('/g', STAMP_JSON_NAME)]: JSON.stringify({ sha: 'not-a-sha', scope: 'full' }),
  });
  assert.strictEqual(readStamp('/g', fsImpl), null);
});

test('readStamp returns null when the JSON sha is valid but fullSha is not a 40-hex SHA', () => {
  const VALID = '0123456789abcdef0123456789abcdef01234567';
  const fsImpl = fakeFs({
    [path.join('/g', STAMP_JSON_NAME)]: JSON.stringify({ sha: VALID, scope: 'scoped', fullSha: '--x' }),
  });
  assert.strictEqual(readStamp('/g', fsImpl), null);
});

test('readStamp returns the JSON stamp as-is when sha is valid and fullSha is absent', () => {
  const VALID = '0123456789abcdef0123456789abcdef01234567';
  const fsImpl = fakeFs({
    [path.join('/g', STAMP_JSON_NAME)]: JSON.stringify({ sha: VALID, scope: 'full' }),
  });
  assert.deepStrictEqual(readStamp('/g', fsImpl), { sha: VALID, scope: 'full' });
});
