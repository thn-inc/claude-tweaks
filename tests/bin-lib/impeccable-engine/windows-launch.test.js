'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchSpec, defaultDeps } = require('../../../plugin/bin/lib/impeccable-engine');

// On win32 the Impeccable launcher is `impeccable.cmd`. Node refuses to spawn a
// .cmd/.bat with execFile and no shell (CVE-2024-27980 hardening: spawnSync
// throws EINVAL), which made resolve() report `engine-not-installed` on every
// Windows machine with the engine installed. launchSpec routes batch launchers
// through cmd.exe with every argument escaped for the batch file's own `%*`
// re-parse; everything else passes through untouched.

test('launchSpec passes a POSIX launcher through unchanged', () => {
  const spec = launchSpec('/x/scripts/impeccable', ['doctor', '--json'], 'linux');
  assert.deepStrictEqual(spec, { file: '/x/scripts/impeccable', args: ['doctor', '--json'], options: {} });
});

test('launchSpec passes a non-batch win32 executable through unchanged', () => {
  const spec = launchSpec('C:\\x\\impeccable.exe', ['signals'], 'win32');
  assert.deepStrictEqual(spec, { file: 'C:\\x\\impeccable.exe', args: ['signals'], options: {} });
});

test('launchSpec routes a win32 .cmd launcher through cmd.exe with verbatim, escaped arguments', () => {
  const spec = launchSpec('C:\\x\\scripts\\impeccable.cmd', ['engine-probe'], 'win32', { ComSpec: 'C:\\Windows\\system32\\cmd.exe' });
  assert.strictEqual(spec.file, 'C:\\Windows\\system32\\cmd.exe');
  assert.deepStrictEqual(spec.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.strictEqual(spec.args.length, 4);
  assert.deepStrictEqual(spec.options, { windowsVerbatimArguments: true });
  assert.ok(spec.args[3].startsWith('"') && spec.args[3].endsWith('"'), 'the whole command line is one quoted /c payload');
  assert.ok(spec.args[3].includes('engine-probe'));
});

test('launchSpec matches .CMD and .bat case-insensitively, and falls back to cmd.exe without ComSpec', () => {
  for (const launcher of ['C:\\x\\IMPECCABLE.CMD', 'C:\\x\\impeccable.bat']) {
    const spec = launchSpec(launcher, [], 'win32', {});
    assert.strictEqual(spec.file, 'cmd.exe');
    assert.deepStrictEqual(spec.options, { windowsVerbatimArguments: true });
  }
});

// Real-process check: a fake launcher shaped like Impeccable's own
// (`setlocal`, then `"%run%" %*`) forwarding to a node script that prints its
// argv. Every argument must arrive byte-identical — including cmd.exe
// metacharacters a caller-supplied surface-brief path or concept-seed value
// could carry.
test('a .cmd launcher run through defaultDeps().spawn receives every argument intact (win32 only)', { skip: process.platform !== 'win32' && 'win32-only: exercises cmd.exe argument parsing' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-cmd-'));
  try {
    const echo = path.join(dir, 'echo-argv.js');
    fs.writeFileSync(echo, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    const launcher = path.join(dir, 'impeccable.cmd');
    fs.writeFileSync(launcher, [
      '@echo off',
      'setlocal',
      `set "run=${process.execPath}"`,
      `"%run%" "${echo}" %*`,
      'exit /b %errorlevel%',
      '',
    ].join('\r\n'));
    const args = [
      'concept-seed', '--scope', 'a b', '--from', 'say "hi"', 'a"&echo pwned&"', '--mode', 'x&y|z<w>v',
      '--chosen', '100%', '--reroll', '%PATH%', 'bang!', 'caret^', '(paren)', 'trail\\', 'semi;comma,', '',
    ];
    const out = defaultDeps().spawn(launcher, args, { encoding: 'utf8', timeout: 30000 });
    assert.deepStrictEqual(JSON.parse(out), args);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The exact `/c` payload, pinned on every platform (#3040): the win32
// real-process test above is skipped on Linux CI, so without this pin dropping
// either caret pass or the trailing-backslash doubling left every CI test green.
// The second caret pass is what stops `a"&echo pwned&"` from closing the quote
// during the launcher's own `"%run%" %*` re-parse and running `echo pwned`.
test('launchSpec pins the exact escaped /c payload for metacharacter, quote, trailing-backslash and injection args', () => {
  const payload = (arg) => launchSpec('C:\\x\\impeccable.cmd', [arg], 'win32', { ComSpec: 'cmd.exe' }).args[3];
  assert.strictEqual(payload('a b'), String.raw`"C:\x\impeccable.cmd ^^^"a^^^ b^^^""`);
  assert.strictEqual(payload('x&y|z<w>v'), String.raw`"C:\x\impeccable.cmd ^^^"x^^^&y^^^|z^^^<w^^^>v^^^""`);
  assert.strictEqual(payload('say "hi"'), String.raw`"C:\x\impeccable.cmd ^^^"say^^^ \^^^"hi\^^^"^^^""`);
  assert.strictEqual(payload('trail\\'), String.raw`"C:\x\impeccable.cmd ^^^"trail\\^^^""`);
  assert.strictEqual(payload('a"&echo pwned&"'), String.raw`"C:\x\impeccable.cmd ^^^"a\^^^"^^^&echo^^^ pwned^^^&\^^^"^^^""`);
});
