'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadIssueIndex } = require('../../../plugin/bin/lib/health-core/issue-index');

// Regression: loadIssueIndex used to be duplicated near-verbatim in all
// four health-suite CLI files (code-health.js, harness-health.js,
// journey-health.js, docs-health.js), differing only in the bracketed
// [toolName] prefix on its stderr diagnostics — now a single shared
// implementation parameterized by toolName.

function tmpFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-index-'));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-index-'));
  fs.writeFileSync(path.join(dir, 'rel-issues.json'), JSON.stringify([{ number: 7, state: 'open', fingerprint: 'fp' }]));
  assert.deepStrictEqual(loadIssueIndex('rel-issues.json', 'code-health', { cwd: () => dir }), {
    fp: { number: 7, state: 'open', labels: [] },
  });
  let err = '';
  assert.deepStrictEqual(loadIssueIndex('nope.json', 'code-health', { cwd: () => dir, stderr: (t) => { err += t; } }), {});
  assert.ok(err.includes('--issues file: nope.json —'), `expected the relative spelling, got: ${err}`);
  assert.ok(!err.includes(dir), 'must not print the cwd-resolved absolute path');
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
