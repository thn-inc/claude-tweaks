'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isolateTmpdir } = require('./helpers/tmp-dir');
isolateTmpdir('ct-iso-session-tmp-');
const {
  resolveSessionId,
  sessionTmpRoot,
  sessionTmpPath,
} = require('../plugin/bin/lib/session-tmp');

test('resolveSessionId trims and rejects blank/absent ids', () => {
  assert.strictEqual(resolveSessionId('  sess-abc  '), 'sess-abc');
  assert.strictEqual(resolveSessionId(''), null);
  assert.strictEqual(resolveSessionId('   '), null);
  assert.strictEqual(resolveSessionId(undefined), null);
  assert.strictEqual(resolveSessionId(null), null);
});

test('sessionTmpRoot is keyed on session id, under the OS tmpdir', () => {
  const root = sessionTmpRoot('sess-abc');
  assert.strictEqual(root, path.join(os.tmpdir(), 'ct-session-sess-abc'));
});

test('sessionTmpRoot returns null for an absent or blank session id', () => {
  assert.strictEqual(sessionTmpRoot(undefined), null);
  assert.strictEqual(sessionTmpRoot(''), null);
  assert.strictEqual(sessionTmpRoot('   '), null);
});

test('sessionTmpPath joins the root with the caller-supplied filename, preserving its basename', () => {
  const p = sessionTmpPath('sess-xyz', 'specify-parent-body.md');
  assert.strictEqual(p, path.join(os.tmpdir(), 'ct-session-sess-xyz', 'specify-parent-body.md'));
});

test('sessionTmpPath returns null for an absent session id (degrade, never throw)', () => {
  assert.strictEqual(sessionTmpPath(undefined, 'whatever.json'), null);
});

test('sessionTmpPath creates the session root directory on disk', () => {
  const sessionId = `test-mkdir-${process.pid}-${Date.now()}`;
  const p = sessionTmpPath(sessionId, 'probe.txt');
  try {
    assert.ok(fs.existsSync(path.dirname(p)), 'session root directory must exist after sessionTmpPath');
    fs.writeFileSync(p, 'ok');
    assert.strictEqual(fs.readFileSync(p, 'utf8'), 'ok');
  } finally {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

test('two different session ids derive disjoint roots by construction', () => {
  const a = sessionTmpRoot('session-a');
  const b = sessionTmpRoot('session-b');
  assert.notStrictEqual(a, b);
});

test('sessionTmpPath is idempotent across repeated calls for the same session', () => {
  const sessionId = `test-idempotent-${process.pid}-${Date.now()}`;
  const p1 = sessionTmpPath(sessionId, 'a.json');
  const p2 = sessionTmpPath(sessionId, 'b.json');
  try {
    assert.strictEqual(path.dirname(p1), path.dirname(p2), 'same session must reuse the same root directory');
  } finally {
    fs.rmSync(path.dirname(p1), { recursive: true, force: true });
  }
});
