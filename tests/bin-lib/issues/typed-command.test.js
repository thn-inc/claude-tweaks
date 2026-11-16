'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  POINTER_FILE,
  TYPED_DISPATCH_MAX_AGE_MS,
  POINTER_MAX_BYTES,
  isWellFormedId,
  writePointer,
  readPointer,
} = require('../../../plugin/bin/lib/issues/typed-command');

const SESSION = 'sess-0001';
const PROMPT = 'prompt-0001';
const AT = '2026-11-16T10:00:00.000Z';

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typed-command-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function pointerPath(tmpdir, sessionId = SESSION) {
  return path.join(tmpdir, `ct-session-${sessionId}`, POINTER_FILE);
}

function plant(tmpdir, content, sessionId = SESSION) {
  const file = pointerPath(tmpdir, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

function valid(records = { 12: { promptId: PROMPT, at: AT } }, sessionId = SESSION) {
  return { v: 1, sessionId, records };
}

const read = (tmpdir, number = 12, sessionId = SESSION) => readPointer({ sessionId, number, tmpdir });

test('the constants carry the spec values', () => {
  assert.strictEqual(POINTER_FILE, 'dispatch-prompts.json');
  assert.strictEqual(TYPED_DISPATCH_MAX_AGE_MS, 30 * 60 * 1000);
  assert.strictEqual(POINTER_MAX_BYTES, 65536);
});

test('isWellFormedId accepts 1 to 64 characters of [A-Za-z0-9-] only', () => {
  assert.strictEqual(isWellFormedId('a'), true);
  assert.strictEqual(isWellFormedId('A-z-09'), true);
  assert.strictEqual(isWellFormedId('x'.repeat(64)), true);
  for (const bad of ['..', '../x', 'a/b', 'a/', 'a%2fb', '', 'x'.repeat(65), 'a\n', 'a ', 'a_b', null, undefined, 12]) {
    assert.strictEqual(isWellFormedId(bad), false, JSON.stringify(bad));
  }
});

test('a valid pointer entry is returned', (t) => {
  const dir = tmp(t);
  plant(dir, valid());
  assert.deepStrictEqual(read(dir), { ok: true, promptId: PROMPT, at: AT });
});

test('no file reads no-pointer', (t) => {
  assert.deepStrictEqual(read(tmp(t)), { ok: false, reason: 'no-pointer' });
});

test('an empty records object reads no-pointer', (t) => {
  const dir = tmp(t);
  plant(dir, valid({}));
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'no-pointer' });
});

test('an entry only for another record reads no-pointer', (t) => {
  const dir = tmp(t);
  plant(dir, valid({ 13: { promptId: PROMPT, at: AT } }));
  assert.deepStrictEqual(read(dir, 12), { ok: false, reason: 'no-pointer' });
});

test('a file that is not JSON reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  plant(dir, '{"v":1,');
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('v other than 1 reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  plant(dir, { ...valid(), v: 2 });
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('records that is an array reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  plant(dir, valid([{ promptId: PROMPT, at: AT }]));
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('an entry promptId that is not well formed reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  plant(dir, valid({ 12: { promptId: 'a/b', at: AT } }));
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('an entry at that does not parse reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  plant(dir, valid({ 12: { promptId: PROMPT, at: 'yesterday' } }));
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('a sessionId other than the reader\'s reads pointer-other-session', (t) => {
  const dir = tmp(t);
  plant(dir, valid(undefined, 'sess-other'));
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-other-session' });
});

// A link at the pointer path is never followed: the inside link points at a
// valid pointer, so an answer other than pointer-unreadable means it was read.
test('a symlink resolving inside the temp dir reads pointer-unreadable, its target unread', (t) => {
  const dir = tmp(t);
  const file = pointerPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const target = path.join(path.dirname(file), 'real.json');
  fs.writeFileSync(target, JSON.stringify(valid()));
  fs.symlinkSync(target, file);
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('a symlink resolving outside the temp dir reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  const outside = tmp(t);
  const target = path.join(outside, 'elsewhere.json');
  fs.writeFileSync(target, JSON.stringify(valid()));
  const file = pointerPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(target, file);
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('a dangling symlink reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  const file = pointerPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(path.join(dir, 'no-such-file.json'), file);
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('a 65,537-byte file reads pointer-unreadable', (t) => {
  const dir = tmp(t);
  const body = JSON.stringify(valid());
  plant(dir, body + ' '.repeat(65537 - body.length));
  assert.strictEqual(fs.statSync(pointerPath(dir)).size, 65537);
  assert.deepStrictEqual(read(dir), { ok: false, reason: 'pointer-unreadable' });
});

test('a reader with a malformed session id reads no-session-id without touching the filesystem', () => {
  const touched = [];
  const spy = new Proxy(fs, { get: (target, key) => { touched.push(key); return target[key]; } });
  for (const bad of ['..', '../x', '', undefined]) {
    assert.deepStrictEqual(readPointer({ sessionId: bad, number: 12, tmpdir: os.tmpdir(), fsImpl: spy }),
      { ok: false, reason: 'no-session-id' });
  }
  assert.deepStrictEqual(touched, []);
});

test('writePointer round-trips the spec shape', (t) => {
  const dir = tmp(t);
  const now = new Date(AT);
  assert.strictEqual(writePointer({ sessionId: SESSION, promptId: PROMPT, numbers: [12], now, tmpdir: dir }), true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(pointerPath(dir), 'utf8')),
    { v: 1, sessionId: SESSION, records: { 12: { promptId: PROMPT, at: AT } } });
  assert.deepStrictEqual(read(dir), { ok: true, promptId: PROMPT, at: AT });
  assert.deepStrictEqual(fs.readdirSync(path.dirname(pointerPath(dir))), [POINTER_FILE]);
});

test('writePointer accepts epoch milliseconds for now', (t) => {
  const dir = tmp(t);
  assert.strictEqual(writePointer({ sessionId: SESSION, promptId: PROMPT, numbers: [12], now: Date.parse(AT), tmpdir: dir }), true);
  assert.deepStrictEqual(read(dir), { ok: true, promptId: PROMPT, at: AT });
});

test('a second write for 12 replaces 12\'s entry and keeps 13\'s', (t) => {
  const dir = tmp(t);
  const later = '2026-11-16T10:05:00.000Z';
  assert.strictEqual(writePointer({ sessionId: SESSION, promptId: PROMPT, numbers: [12, 13], now: new Date(AT), tmpdir: dir }), true);
  assert.strictEqual(writePointer({ sessionId: SESSION, promptId: 'prompt-0002', numbers: [12], now: new Date(later), tmpdir: dir }), true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(pointerPath(dir), 'utf8')), {
    v: 1,
    sessionId: SESSION,
    records: { 12: { promptId: 'prompt-0002', at: later }, 13: { promptId: PROMPT, at: AT } },
  });
});

test('writePointer starts empty over a pointer of another session', (t) => {
  const dir = tmp(t);
  plant(dir, valid({ 13: { promptId: PROMPT, at: AT } }, 'sess-other'));
  assert.strictEqual(writePointer({ sessionId: SESSION, promptId: PROMPT, numbers: [12], now: new Date(AT), tmpdir: dir }), true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(pointerPath(dir), 'utf8')),
    { v: 1, sessionId: SESSION, records: { 12: { promptId: PROMPT, at: AT } } });
});

test('writePointer replaces a symlink at the pointer path without writing through it', (t) => {
  const dir = tmp(t);
  const outside = tmp(t);
  const target = path.join(outside, 'victim.json');
  fs.writeFileSync(target, 'untouched');
  const file = pointerPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(target, file);
  assert.strictEqual(writePointer({ sessionId: SESSION, promptId: PROMPT, numbers: [12], now: new Date(AT), tmpdir: dir }), true);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), 'untouched');
  assert.strictEqual(fs.lstatSync(file).isFile(), true);
});

test('writePointer with a malformed session id writes nothing and returns false', (t) => {
  const dir = tmp(t);
  for (const bad of ['..', '../x', 'a/b', 'a/', 'a%2fb', '', 'x'.repeat(65)]) {
    assert.strictEqual(isWellFormedId(bad), false, JSON.stringify(bad));
    assert.strictEqual(writePointer({ sessionId: bad, promptId: PROMPT, numbers: [12], now: new Date(AT), tmpdir: dir }), false, JSON.stringify(bad));
  }
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('writePointer with a malformed prompt id, numbers or now writes nothing and returns false', (t) => {
  const dir = tmp(t);
  const base = { sessionId: SESSION, promptId: PROMPT, numbers: [12], now: new Date(AT), tmpdir: dir };
  const cases = [
    { promptId: 'a/b' }, { promptId: '' }, { promptId: undefined },
    { numbers: [] }, { numbers: [0] }, { numbers: [-1] }, { numbers: [1.5] }, { numbers: ['12'] }, { numbers: 12 },
    { now: 'not a date' }, { now: undefined },
  ];
  for (const c of cases) {
    assert.strictEqual(writePointer({ ...base, ...c }), false, JSON.stringify(c));
  }
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});
