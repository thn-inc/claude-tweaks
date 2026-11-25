'use strict';
// #5449: sddRulingRoute — the fail-closed audit/console route for sdd-ruling-* items.
// 'audit' only for exactly one `Class: procedural`, exactly one `Defers: no`, no Defer-reason line.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('../../helpers/read-skill');
const libDir = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'console');
const sddRuling = require(path.join(libDir, 'sdd-ruling'));
const resolve = require(path.join(libDir, 'resolve'));
const { sddRulingRoute } = sddRuling;

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'sdd-ruling-route');
const FIXTURES = [
  'spec-5162-sdd-ruling-9.md', 'spec-5162-sdd-ruling-16.md', 'spec-5162-sdd-ruling-31.md', 'spec-5161-sdd-ruling-3.md',
];
const read = (f) => readText(path.join(FIXTURE_DIR, f));

// Insert `line` as a new header line directly after the Kind: line (preserving the line ending).
function withClass(text, line = 'Class: procedural') {
  const out = text.replace(/^(Kind:[^\r\n]*)(\r?\n)/m, (m, kind, eol) => `${kind}${eol}${line}${eol}`);
  assert.notStrictEqual(out, text, 'withClass must change the text');
  return out;
}

test('AC1.1: the four archived procedural rulings route audit once Class: procedural is added', () => {
  for (const f of FIXTURES) assert.strictEqual(sddRulingRoute(withClass(read(f))), 'audit', f);
});

test('AC1.2: the same four files without the added line route console', () => {
  for (const f of FIXTURES) assert.strictEqual(sddRulingRoute(read(f)), 'console', f);
});

test('AC2.1: Class: procedural with Defers: yes routes console', () => {
  for (const f of FIXTURES) {
    const t = read(f);
    const yes = t.replace('Defers: no', 'Defers: yes');
    assert.notStrictEqual(yes, t);
    assert.strictEqual(sddRulingRoute(withClass(yes)), 'console', f);
  }
});

test('AC2.2: a Defer-reason line, two Class lines, Class: maybe, or no header routes console', () => {
  const t = read(FIXTURES[0]);
  assert.strictEqual(sddRulingRoute(withClass(withClass(t), 'Defer-reason: genuinely-larger')), 'console');
  assert.strictEqual(sddRulingRoute(withClass(withClass(t))), 'console');
  assert.strictEqual(sddRulingRoute(withClass(t, 'Class: procedural\nClass: behaviour')), 'console');
  assert.strictEqual(sddRulingRoute(withClass(t, 'Class: maybe')), 'console');
  assert.strictEqual(sddRulingRoute('\nRuling body only\n'), 'console');
  assert.strictEqual(sddRulingRoute(''), 'console');
  assert.strictEqual(sddRulingRoute(null), 'console');
  assert.strictEqual(sddRulingRoute(undefined), 'console');
});

test('Class: behaviour routes console', () => {
  assert.strictEqual(sddRulingRoute(withClass(read(FIXTURES[0]), 'Class: behaviour')), 'console');
});

test('a missing or duplicate Defers line routes console', () => {
  assert.strictEqual(sddRulingRoute('Kind: sdd-ruling\nClass: procedural\n\nbody\n'), 'console');
  assert.strictEqual(sddRulingRoute('Kind: sdd-ruling\nClass: procedural\nDefers: no\nDefers: no\n\nbody\n'), 'console');
});

test('review focus: a Class: line only in the body does not count', () => {
  assert.strictEqual(sddRulingRoute('Kind: sdd-ruling\nDefers: no\n\nClass: procedural\n'), 'console');
});

test('review focus: CRLF header routes audit', () => {
  assert.strictEqual(sddRulingRoute('Kind: sdd-ruling\r\nClass: procedural\r\nDefers: no\r\n\r\nbody\r\n'), 'audit');
});

test('review focus: key case and value padding are normalized; empty Class value routes console', () => {
  assert.strictEqual(sddRulingRoute('Kind: sdd-ruling\nclass:  Procedural \nDEFERS: No\n\nbody\n'), 'audit');
  assert.strictEqual(sddRulingRoute('Kind: sdd-ruling\nClass:\nDefers: no\n\nbody\n'), 'console');
});

test('review focus: an empty Defer-reason header line forces console', () => {
  assert.strictEqual(sddRulingRoute(withClass(read(FIXTURES[0]), 'Class: procedural\nDefer-reason:')), 'console');
});

test('resolve.js re-exports sddRulingRoute', () => {
  assert.strictEqual(resolve.sddRulingRoute, sddRuling.sddRulingRoute);
});
