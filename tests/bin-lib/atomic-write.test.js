'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeFileAtomic } = require('../../plugin/bin/lib/atomic-write');

test('writeFileAtomic: writes to a pid-suffixed tmp path in the same directory, then renames over the real path', () => {
  const writeCalls = [];
  const renameCalls = [];
  const writeFile = (p, content) => writeCalls.push({ p, content });
  const rename = (from, to) => renameCalls.push({ from, to });

  writeFileAtomic('/x/y/store.txt', 'hello', { writeFile, rename });

  assert.equal(writeCalls.length, 1);
  assert.notEqual(writeCalls[0].p, '/x/y/store.txt', 'writes to a tmp path, not the final path directly');
  assert.ok(writeCalls[0].p.startsWith('/x/y/store.txt.tmp-'), 'tmp path is derived from the real path, in the same directory');
  assert.equal(writeCalls[0].content, 'hello');
  assert.equal(renameCalls.length, 1);
  assert.equal(renameCalls[0].from, writeCalls[0].p);
  assert.equal(renameCalls[0].to, '/x/y/store.txt');
});

test('writeFileAtomic: tmp path is pid-suffixed, not a fixed name (two calls in one process reuse the same pid-derived name)', () => {
  const writes = [];
  const writeFile = (p) => writes.push(p);
  const rename = () => {};
  writeFileAtomic('/x/store.txt', 'a', { writeFile, rename });
  writeFileAtomic('/x/store.txt', 'b', { writeFile, rename });
  assert.equal(writes[0], writes[1], 'same pid within one process -> same tmp name; sequential calls, each rename is atomic per-call');
});

test('writeFileAtomic: a write failure is cleaned up (best-effort unlink of the tmp file) and rethrown unchanged', () => {
  const unlinkCalls = [];
  const writeFile = () => { throw new Error('ENOSPC: no space left on device'); };
  const rename = () => { throw new Error('rename should not be called when write failed'); };
  const unlink = (p) => unlinkCalls.push(p);

  assert.throws(
    () => writeFileAtomic('/x/store.txt', 'a', { writeFile, rename, unlink }),
    /ENOSPC/,
  );
  assert.equal(unlinkCalls.length, 1);
  assert.ok(unlinkCalls[0].startsWith('/x/store.txt.tmp-'));
});

test('writeFileAtomic: a rename failure is cleaned up (best-effort unlink of the tmp file) and rethrown unchanged', () => {
  const unlinkCalls = [];
  const writeFile = () => {};
  const rename = () => { throw new Error('EXDEV: cross-device link not permitted'); };
  const unlink = (p) => unlinkCalls.push(p);

  assert.throws(
    () => writeFileAtomic('/x/store.txt', 'a', { writeFile, rename, unlink }),
    /EXDEV/,
  );
  assert.equal(unlinkCalls.length, 1);
});

test('writeFileAtomic: an unlink failure during cleanup is swallowed — the original write/rename error still propagates', () => {
  const writeFile = () => {};
  const rename = () => { throw new Error('original failure'); };
  const unlink = () => { throw new Error('unlink also failed'); };

  assert.throws(
    () => writeFileAtomic('/x/store.txt', 'a', { writeFile, rename, unlink }),
    /original failure/,
  );
});

test('writeFileAtomic: on success, unlink is never called', () => {
  let unlinkCalled = false;
  const writeFile = () => {};
  const rename = () => {};
  const unlink = () => { unlinkCalled = true; };
  writeFileAtomic('/x/store.txt', 'a', { writeFile, rename, unlink });
  assert.equal(unlinkCalled, false);
});

test('writeFileAtomic: real-filesystem round-trip — writes the file with correct content and leaves no stray tmp file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
  const outPath = path.join(tmpDir, 'out.txt');

  writeFileAtomic(outPath, 'hello world');

  assert.equal(fs.readFileSync(outPath, 'utf8'), 'hello world');
  assert.deepEqual(fs.readdirSync(tmpDir), ['out.txt'], 'no stray out.txt.tmp-* file left behind');
});

const transient = (code) => Object.assign(new Error(code), { code });

test('writeFileAtomic: on Windows a transient rename race (EPERM/EACCES/EBUSY) is retried, then succeeds', () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    let calls = 0;
    const slept = [];
    const rename = () => { calls += 1; if (calls < 3) throw transient(code); };
    writeFileAtomic('/x/store.txt', 'a', { writeFile: () => {}, rename, unlink: () => {}, platform: 'win32', sleep: (ms) => slept.push(ms) });
    assert.equal(calls, 3, code);
    assert.deepEqual(slept, [5, 10], code);
  }
});

test('writeFileAtomic: the Windows retry is bounded — a persistent EPERM rethrows the original error and removes the tmp file', () => {
  let calls = 0;
  let unlinked = false;
  const rename = () => { calls += 1; throw transient('EPERM'); };
  assert.throws(
    () => writeFileAtomic('/x/store.txt', 'a', { writeFile: () => {}, rename, unlink: () => { unlinked = true; }, platform: 'win32', sleep: () => {} }),
    (err) => err.code === 'EPERM',
  );
  assert.equal(calls, 9, 'one attempt plus eight retries');
  assert.equal(unlinked, true);
});

test('writeFileAtomic: no retry off Windows, or for a non-transient error', () => {
  let calls = 0;
  const rename = () => { calls += 1; throw transient('EPERM'); };
  assert.throws(() => writeFileAtomic('/x/s', 'a', { writeFile: () => {}, rename, unlink: () => {}, platform: 'linux', sleep: () => {} }));
  assert.equal(calls, 1);
  calls = 0;
  const exdev = () => { calls += 1; throw transient('EXDEV'); };
  assert.throws(() => writeFileAtomic('/x/s', 'a', { writeFile: () => {}, rename: exdev, unlink: () => {}, platform: 'win32', sleep: () => {} }));
  assert.equal(calls, 1);
});

