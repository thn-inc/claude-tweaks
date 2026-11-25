'use strict';
// #5449: sddRulingRoute — the fail-closed audit/console route for sdd-ruling-* items.
// 'audit' only for exactly one `Class: procedural`, exactly one `Defers: no`, no Defer-reason line.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');

const { readText } = require('../../helpers/read-skill');
const libDir = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'console');
const sddRuling = require(path.join(libDir, 'sdd-ruling'));
const resolve = require(path.join(libDir, 'resolve'));
const { sddRulingRoute, SDD_RULING_ROUTES } = sddRuling;
const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'sdd-ruling-route.js');

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

test('SDD_RULING_ROUTES is frozen and the route returns its values', () => {
  assert.deepStrictEqual({ ...SDD_RULING_ROUTES }, { AUDIT: 'audit', CONSOLE: 'console' });
  assert.ok(Object.isFrozen(SDD_RULING_ROUTES));
  assert.strictEqual(sddRulingRoute(withClass(read(FIXTURES[0]))), SDD_RULING_ROUTES.AUDIT);
  assert.strictEqual(sddRulingRoute(read(FIXTURES[0])), SDD_RULING_ROUTES.CONSOLE);
  assert.strictEqual(resolve.SDD_RULING_ROUTES, SDD_RULING_ROUTES);
});

// CLI (#5449): exit family Payload-1 / Invocation-2.
function tmpFile(name, text) {
  const dir = scratchDir('sdd-ruling-route-cli-');
  fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

test('CLI prints audit for a procedural fixture and exits 0', () => {
  const dir = tmpFile('r.md', withClass(read(FIXTURES[0])));
  const r = runCliSync(CLI, ['--file', path.join(dir, 'r.md')]);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(r.stdout, 'audit\n');
});

test('CLI prints console for an unmodified fixture and exits 0', () => {
  const dir = tmpFile('r.md', read(FIXTURES[0]));
  const r = runCliSync(CLI, ['--file', path.join(dir, 'r.md')]);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(r.stdout, 'console\n');
});

test('CLI resolves a relative --file against cwd', () => {
  const dir = tmpFile('r.md', withClass(read(FIXTURES[1])));
  const r = runCliSync(CLI, ['--file', 'r.md'], { cwd: dir });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(r.stdout, 'audit\n');
});

test('AC4.1: CLI exits 1 on a missing --file path and 2 on a malformed call, printing nothing to stdout', () => {
  const dir = scratchDir('sdd-ruling-route-cli-');
  const missing = runCliSync(CLI, ['--file', path.join(dir, 'nope.md')]);
  assert.strictEqual(missing.code, 1);
  assert.strictEqual(missing.stdout, '');
  assert.ok(missing.stderr.length > 0);
  const none = runCliSync(CLI, []);
  assert.strictEqual(none.code, 2);
  assert.strictEqual(none.stdout, '');
  assert.ok(none.stderr.includes('usage:'));
  for (const argv of [['--file'], ['--bogus'], ['--file', '--bogus'], ['--file', 'a', '--file', 'b'], ['--file', 'a', 'extra']]) {
    const r = runCliSync(CLI, argv);
    assert.strictEqual(r.code, 2, argv.join(' '));
    assert.strictEqual(r.stdout, '', argv.join(' '));
    assert.ok(r.stderr.includes('usage:'), argv.join(' '));
  }
});

test('spawn smoke: script entry exits 0 and prints console', () => {
  const dir = tmpFile('r.md', read(FIXTURES[2]));
  const r = spawnCli(CLI, ['--file', path.join(dir, 'r.md')]);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(r.stdout, 'console\n');
});
