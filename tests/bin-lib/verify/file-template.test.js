'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const { substituteFile, describePath } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'file-template.js'));

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
  assert.deepStrictEqual(substituteFile("NODE_OPTIONS='--x' node --test {file}", 'tests/a b.test.js', LINUX),
    { ok: false, reason: 'template-quotes' });
  assert.deepStrictEqual(substituteFile('node --test ^{file}', 'tests/a b.test.js', WIN32),
    { ok: false, reason: 'template-quotes' });
  assert.deepStrictEqual(substituteFile('node --test {file}', 'tests/a\tb.test.js', LINUX),
    { ok: false, reason: 'control-character' });
});

test('substituteFile: a path with a leading dash is refused on both platforms — quoting cannot stop an option read', () => {
  for (const platform of ['linux', 'win32']) {
    assert.deepStrictEqual(substituteFile('node --test {file}', '--import=./x.js', { platform }), { ok: false, reason: 'leading-dash' });
    assert.deepStrictEqual(substituteFile('node --test {file}', '-r', { platform }), { ok: false, reason: 'leading-dash' });
  }
  assert.deepStrictEqual(substituteFile('node --test {file}', 'tests/-r.test.js', LINUX), { ok: true, command: 'node --test tests/-r.test.js' }, 'a dash after the first character is an ordinary path');
});

test('describePath: a control byte is shown as \\xNN and every other path is unchanged', () => {
  assert.strictEqual(describePath('tests/a\tb\x1b[31m\n.test.js'), 'tests/a\\x09b\\x1b[31m\\x0a.test.js');
  assert.strictEqual(describePath('tests/a b%.test.js'), 'tests/a b%.test.js');
});

test('substituteFile: win32 refuses a path with a double quote, a bang, or a trailing backslash, and a template with a single quote', () => {
  assert.deepStrictEqual(substituteFile('node --test {file}', 'tests/a"b.test.js', WIN32), { ok: false, reason: 'cmd-unquotable' });
  assert.deepStrictEqual(substituteFile('node --test {file}', 'tests/a!b.test.js', WIN32), { ok: false, reason: 'cmd-unquotable' });
  assert.deepStrictEqual(substituteFile('node --test {file}', 'tests\\dir\\', WIN32), { ok: false, reason: 'cmd-unquotable' });
  assert.deepStrictEqual(substituteFile("node --test '{file}'", 'tests/a b.test.js', WIN32), { ok: false, reason: 'template-quotes' });
  assert.deepStrictEqual(substituteFile('node --test {file}', 'tests\\a b.test.js', WIN32),
    { ok: true, command: 'node --test "tests\\a b.test.js"' });
});

test('substituteFile: a control character refuses on win32 too, and outranks the win32 path refusals', () => {
  assert.deepStrictEqual(substituteFile('node --test {file}', 'tests/a\tb.test.js', WIN32), { ok: false, reason: 'control-character' });
  assert.deepStrictEqual(substituteFile('node --test {file}', 'tests/%a\tb.test.js', WIN32), { ok: false, reason: 'control-character' });
});

test('substituteFile: POSIX refuses a template that leaves a backtick, backslash, bare double quote, or ${file} around the path', () => {
  for (const template of ['node --test `echo {file}`', 'node --test \\{file}', 'echo "x" {file}', 'node --test ${file}']) {
    assert.deepStrictEqual(substituteFile(template, 'tests/a b.test.js', LINUX), { ok: false, reason: 'template-quotes' }, template);
  }
});

test('substituteFile: every {file} in the template is substituted', () => {
  assert.deepStrictEqual(substituteFile('cp {file} {file}.bak', 'tests/a.test.js', LINUX),
    { ok: true, command: 'cp tests/a.test.js tests/a.test.js.bak' });
  assert.deepStrictEqual(substituteFile('cp {file} {file}.bak', 'tests/a b.test.js', LINUX),
    { ok: true, command: "cp 'tests/a b.test.js' 'tests/a b.test.js'.bak" });
});

test('substituteFile: a template that wraps {file} in quotes has that wrapper replaced by the helper quoting', () => {
  assert.deepStrictEqual(substituteFile('node --test "{file}"', 'tests/a b.test.js', LINUX),
    { ok: true, command: "node --test 'tests/a b.test.js'" });
  assert.deepStrictEqual(substituteFile('npx vitest run "{file}"', 'app/(marketing)/page.test.tsx', LINUX),
    { ok: true, command: "npx vitest run 'app/(marketing)/page.test.tsx'" });
  assert.deepStrictEqual(substituteFile("node --test '{file}'", 'tests/$(touch PWNED).test.js', LINUX),
    { ok: true, command: "node --test 'tests/$(touch PWNED).test.js'" });
  assert.deepStrictEqual(substituteFile('node --test "{file}"', 'tests/a&b.test.js', WIN32),
    { ok: true, command: 'node --test "tests/a&b.test.js"' });
});

test('substituteFile: the placeholder token is configurable, and the default stays {file} (#4024)', () => {
  assert.deepStrictEqual(substituteFile('run {files}', '/a b/l.txt', { platform: 'linux', token: '{files}' }),
    { ok: true, command: "run '/a b/l.txt'" });
  assert.deepStrictEqual(substituteFile('run "{files}"', '/a b/l.txt', { platform: 'win32', token: '{files}' }),
    { ok: true, command: 'run "/a b/l.txt"' });
  assert.deepStrictEqual(substituteFile('run {files}', '/a/l.txt', { platform: 'linux', token: '{files}' }),
    { ok: true, command: 'run /a/l.txt' });
  // With a custom token, a bare {file} is ordinary template text.
  assert.deepStrictEqual(substituteFile('run {file} {files}', '/a/l.txt', { platform: 'linux', token: '{files}' }),
    { ok: true, command: 'run {file} /a/l.txt' });
  assert.deepStrictEqual(substituteFile('run ${files}', '/a b/l.txt', { platform: 'linux', token: '{files}' }),
    { ok: false, reason: 'template-quotes' });
  assert.deepStrictEqual(substituteFile('run {file}', '/a b/l.txt', LINUX), { ok: true, command: "run '/a b/l.txt'" });
});

test('substituteFile: the quoted command runs as one literal word under a real sh', { skip: process.platform === 'win32' }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'file-template-'));
  try {
    for (const template of ['printf %s {file}', 'printf %s "{file}"']) {
      const sub = substituteFile(template, 'tests/$(touch PWNED).test.js', { platform: process.platform });
      assert.strictEqual(sub.ok, true);
      const out = execSync(sub.command, { cwd, shell: '/bin/sh', encoding: 'utf8' });
      assert.strictEqual(out, 'tests/$(touch PWNED).test.js');
      assert.strictEqual(fs.existsSync(path.join(cwd, 'PWNED')), false);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
