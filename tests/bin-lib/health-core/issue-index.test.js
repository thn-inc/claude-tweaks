'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { loadIssueIndex } = require('../../../plugin/bin/lib/health-core/issue-index');
const { decide: coreDecide } = require('../../../plugin/bin/lib/health-core/dedup');
const { decide: codeHealthDecide } = require('../../../plugin/bin/lib/code-health/dedup');

// Regression: loadIssueIndex used to be duplicated near-verbatim in all
// four health-suite CLI files (code-health.js, harness-health.js,
// journey-health.js, docs-health.js), differing only in the bracketed
// [toolName] prefix on its stderr diagnostics — now a single shared
// implementation parameterized by toolName.

function tmpFile(content) {
  const dir = scratchDir('issue-index-');
  const file = path.join(dir, 'issues.json');
  fs.writeFileSync(file, content);
  return file;
}

test('routes every diagnostic to an injected stderr instead of process.stderr', () => {
  let err = '';
  const stderr = (t) => { err += t; };
  assert.deepStrictEqual(loadIssueIndex('/nonexistent/issues.json', 'code-health', { stderr }), {});
  assert.match(err, /^\[code-health\] validate-findings: could not read or parse --issues file/);
  err = '';
  assert.deepStrictEqual(loadIssueIndex(tmpFile('{}'), 'code-health', { stderr }), {});
  assert.match(err, /must contain a JSON array/);
  err = '';
  loadIssueIndex(tmpFile(JSON.stringify([null])), 'code-health', { stderr });
  assert.match(err, /^\[code-health\] loadIssueIndex: skipping malformed issue entry/);
});

test('a relative file is read against an injected cwd and diagnostics print the caller\'s spelling', () => {
  const dir = scratchDir('issue-index-');
  fs.writeFileSync(path.join(dir, 'rel-issues.json'), JSON.stringify([{ number: 7, state: 'open', fingerprint: 'fp' }]));
  assert.deepStrictEqual(loadIssueIndex('rel-issues.json', 'code-health', { cwd: () => dir }), {
    fp: { number: 7, state: 'open', labels: [] },
  });
  let err = '';
  assert.deepStrictEqual(loadIssueIndex('nope.json', 'code-health', { cwd: () => dir, stderr: (t) => { err += t; } }), {});
  assert.ok(err.includes('--issues file: nope.json —'), `expected the relative spelling, got: ${err}`);
  assert.ok(!err.includes(dir), 'must not print the cwd-resolved absolute path');
});

// Win32 collapses `..` as text before the filesystem sees a path, for a bare
// relative read and the joined path alike, so there is no kernel behavior to pin.
const POSIX_KERNEL_ONLY = process.platform === 'win32'
  ? 'Win32 resolves `..` lexically, so there is no kernel behavior to preserve'
  : false;

test('a relative file keeps a \`..\` after a symlink for the kernel (not collapsed as text)', { skip: POSIX_KERNEL_ONLY }, () => {
  const root = scratchDir('issue-index-');
  fs.mkdirSync(path.join(root, 'other', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'other', 'only-there.json'), JSON.stringify([{ number: 1, state: 'open', fingerprint: 'fp' }]));
  fs.symlinkSync(path.join(root, 'other', 'deep'), path.join(root, 'link'), 'dir');
  assert.deepStrictEqual(loadIssueIndex('link/../only-there.json', 'code-health', { cwd: () => root }), {
    fp: { number: 1, state: 'open', labels: [] },
  });
});

test('returns {} when no file is given', () => {
  assert.deepStrictEqual(loadIssueIndex(undefined, 'code-health'), {});
  assert.deepStrictEqual(loadIssueIndex('', 'code-health'), {});
});

test('indexes issues by fingerprint', () => {
  const file = tmpFile(JSON.stringify([
    { number: 12, state: 'open', labels: ['bug'], fingerprint: 'fp-a' },
    { number: 34, state: 'closed', labels: [], fingerprint: 'fp-b' },
  ]));
  const index = loadIssueIndex(file, 'code-health');
  assert.deepStrictEqual(index, {
    'fp-a': { number: 12, state: 'open', labels: ['bug'] },
    'fp-b': { number: 34, state: 'closed', labels: [] },
  });
});

test('skips entries with no fingerprint field', () => {
  const file = tmpFile(JSON.stringify([
    { number: 1, state: 'open' }, // no fingerprint
    { number: 2, state: 'open', fingerprint: 'fp-only' },
  ]));
  const index = loadIssueIndex(file, 'code-health');
  assert.deepStrictEqual(Object.keys(index), ['fp-only']);
});

test('skips malformed (non-object) entries without throwing', () => {
  const file = tmpFile(JSON.stringify([null, 'not-an-object', 5, { number: 1, fingerprint: 'ok' }]));
  const index = loadIssueIndex(file, 'code-health');
  assert.deepStrictEqual(Object.keys(index), ['ok']);
});

test('defaults labels to an empty array when absent', () => {
  const file = tmpFile(JSON.stringify([{ number: 1, state: 'open', fingerprint: 'fp' }]));
  const index = loadIssueIndex(file, 'code-health');
  assert.deepStrictEqual(index.fp.labels, []);
});

test('returns {} and does not throw when the file cannot be read', () => {
  assert.deepStrictEqual(loadIssueIndex('/does/not/exist.json', 'code-health'), {});
});

test('returns {} and does not throw when the file is not JSON', () => {
  const file = tmpFile('not json{{{');
  assert.deepStrictEqual(loadIssueIndex(file, 'code-health'), {});
});

test('returns {} and does not throw when the file is JSON but not an array', () => {
  const file = tmpFile(JSON.stringify({ not: 'an array' }));
  assert.deepStrictEqual(loadIssueIndex(file, 'code-health'), {});
});

test('the [toolName] prefix parameterizes the bad-file diagnostic (proves the shared module still distinguishes callers)', () => {
  const origWrite = process.stderr.write;
  let captured = '';
  process.stderr.write = (chunk) => { captured += chunk; return true; };
  try {
    loadIssueIndex('/does/not/exist.json', 'docs-health');
  } finally {
    process.stderr.write = origWrite;
  }
  assert.match(captured, /^\[docs-health\]/);
});

function load(entries, toolName = 'code-health') {
  let err = '';
  const index = loadIssueIndex(tmpFile(JSON.stringify(entries)), toolName, { stderr: (t) => { err += t; } });
  return { index, err };
}

test('AC1.1: gh raw shape — uppercase state and label objects normalize, stderr stays quiet', () => {
  const { index, err } = load([{ number: 7, state: 'CLOSED', labels: [{ name: 'wontfix' }, { name: 'by:code-health' }], fingerprint: 'fp' }]);
  assert.deepStrictEqual(index, { fp: { number: 7, state: 'closed', labels: ['wontfix', 'by:code-health'] } });
  assert.strictEqual(err, '');
});

test('AC2.1: nameless label elements are dropped, the issue is kept, one stderr line reports the count', () => {
  const { index, err } = load([{ number: 3, state: 'open', labels: ['bug', null, { id: 1 }, 42, { name: 'wontfix' }], fingerprint: 'fp' }]);
  assert.deepStrictEqual(index, { fp: { number: 3, state: 'open', labels: ['bug', 'wontfix'] } });
  assert.strictEqual(err, '[code-health] loadIssueIndex: ignored 3 label entries with no name\n');
});

const STATELESS = [{ number: 1, fingerprint: 'no-state' }, { number: 2, state: 5, fingerprint: 'num-state' }];

test('AC3.1: a missing or non-string state is stored as the empty string', () => {
  const { index, err } = load(STATELESS);
  assert.strictEqual(index['no-state'].state, '');
  assert.strictEqual(index['num-state'].state, '');
  assert.strictEqual(err, '[code-health] loadIssueIndex: 2 issue entries with no state, treated as not closed\n');
});

test('AC3.2: both decide() functions skip an entry whose state normalized to the empty string', () => {
  const { index } = load(STATELESS);
  for (const fp of ['no-state', 'num-state']) {
    assert.deepStrictEqual(coreDecide({ id: fp }, index, {}), { action: 'skip', issue: index[fp].number });
    assert.deepStrictEqual(codeHealthDecide({ id: fp, risk: 'high' }, index, {}), { action: 'skip', issue: index[fp].number });
  }
});

test('a mixed-case state is lowercased', () => {
  const { index } = load([{ number: 4, state: 'Closed', fingerprint: 'fp' }]);
  assert.strictEqual(index.fp.state, 'closed');
});

test('nameless labels across several issues are totalled in one stderr line, under the caller\'s tool name', () => {
  const { index, err } = load([
    { number: 1, state: 'open', labels: [null, 'x'], fingerprint: 'a' },
    { number: 2, state: 'open', labels: [{}, 7, { name: 'y' }], fingerprint: 'b' },
  ], 'docs-health');
  assert.deepStrictEqual(index.a.labels, ['x']);
  assert.deepStrictEqual(index.b.labels, ['y']);
  assert.strictEqual(err, '[docs-health] loadIssueIndex: ignored 3 label entries with no name\n');
});

test('a label object whose name is not a string is dropped and counted', () => {
  const { index, err } = load([{ number: 1, state: 'open', labels: [{ name: 5 }, { name: null }, { name: 'ok' }], fingerprint: 'fp' }]);
  assert.deepStrictEqual(index.fp.labels, ['ok']);
  assert.strictEqual(err, '[code-health] loadIssueIndex: ignored 2 label entries with no name\n');
});

test('a non-array labels value is stored as [] and counted once; a null one is stored as [] quietly', () => {
  const { index, err } = load([
    { number: 1, state: 'open', labels: 'wontfix', fingerprint: 'str' },
    { number: 2, state: 'open', labels: null, fingerprint: 'nul' },
  ]);
  assert.deepStrictEqual(index.str.labels, []);
  assert.deepStrictEqual(index.nul.labels, []);
  assert.strictEqual(err, '[code-health] loadIssueIndex: ignored 1 label entries with no name\n');
  assert.deepStrictEqual(coreDecide({ id: 'str' }, index, {}), { action: 'skip', issue: 1 });
});

test('an entry with no fingerprint adds nothing to the ignored count', () => {
  const { index, err } = load([
    { number: 1, state: 'open', labels: [null] },
    { number: 2, state: 'open', labels: ['a'], fingerprint: 'fp' },
  ]);
  assert.deepStrictEqual(Object.keys(index), ['fp']);
  assert.strictEqual(err, '');
});

test('entries that all carry a string state print nothing about state on stderr', () => {
  const { index, err } = load([
    { number: 1, state: 'OPEN', fingerprint: 'a' },
    { number: 2, state: 'closed', fingerprint: 'b' },
  ]);
  assert.deepStrictEqual(Object.keys(index), ['a', 'b']);
  assert.strictEqual(err, '');
});
