'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const { substituteFile } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'file-template.js'));

const LINUX = { platform: 'linux' };
const WIN32 = { platform: 'win32' };

test('substituteFile: a plain path substitutes byte-for-byte on both platforms', () => {
  assert.deepStrictEqual(substituteFile('node --test {file}', 'tests/a.test.js', WIN32),
    { ok: true, command: 'node --test tests/a.test.js' });
  assert.deepStrictEqual(substituteFile('node --test {file}', 'tests/a.test.js', LINUX),
    { ok: true, command: 'node --test tests/a.test.js' });
  assert.deepStrictEqual(substituteFile('node --test "{file}"', 'tests/a.test.js', LINUX),
    { ok: true, command: 'node --test "tests/a.test.js"' });
});

test('substituteFile: a $(…) path is single-quoted on POSIX and double-quoted on win32', () => {
  assert.deepStrictEqual(substituteFile('node --test {file}', 'tests/$(touch PWNED).test.js', LINUX),
    { ok: true, command: "node --test 'tests/$(touch PWNED).test.js'" });
  assert.deepStrictEqual(substituteFile('node --test {file}', 'tests/$(touch PWNED).test.js', WIN32),
    { ok: true, command: 'node --test "tests/$(touch PWNED).test.js"' });
});

test('substituteFile: an embedded single quote closes and reopens the POSIX quote', () => {
  assert.deepStrictEqual(substituteFile('node --test {file}', "tests/it's.test.js", LINUX),
    { ok: true, command: "node --test 'tests/it'\\''s.test.js'" });
});

test('substituteFile: $& in the path substitutes literally', () => {
  assert.deepStrictEqual(substituteFile('node --test {file}', 'tests/a$&b.test.js', LINUX),
    { ok: true, command: "node --test 'tests/a$&b.test.js'" });
});

test('substituteFile: refusals are named', () => {
  assert.deepStrictEqual(substituteFile('node --test {file}', 'tests/%PATH%.test.js', WIN32),
    { ok: false, reason: 'cmd-unquotable' });
  assert.deepStrictEqual(substituteFile('node --test "{file}"', 'tests/a b.test.js', LINUX),
    { ok: false, reason: 'template-quotes' });
  assert.deepStrictEqual(substituteFile('node --test {file}', 'tests/a\tb.test.js', LINUX),
    { ok: false, reason: 'control-character' });
});

test('substituteFile: the quoted command runs as one literal word under a real sh', { skip: process.platform === 'win32' }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'file-template-'));
  const sub = substituteFile('printf %s {file}', 'tests/$(touch PWNED).test.js', { platform: process.platform });
  assert.strictEqual(sub.ok, true);
  const out = execSync(sub.command, { cwd, shell: '/bin/sh', encoding: 'utf8' });
  assert.strictEqual(out, 'tests/$(touch PWNED).test.js');
  assert.strictEqual(fs.existsSync(path.join(cwd, 'PWNED')), false);
});
