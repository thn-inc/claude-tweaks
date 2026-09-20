// tests/node-eval-file.test.js
// Fake deps per gh-api-module-pattern's injectable-runner convention for the
// unit tests; a real end-to-end spawn (no faking) proves the actual fix —
// a genuinely multi-line script, run through the real CLI via stdin, must
// produce output and see the correct argv positions, the exact failure mode
// #2564 reports for a multi-line `node -e` argument on Windows Git Bash.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const { run } = require('../plugin/bin/node-eval-file.js');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'node-eval-file.js');

function fakeDeps({ spawnResult = { status: 0 }, writeThrows = null } = {}) {
  const calls = { writes: [], unlinks: [], spawns: [] };
  const deps = {
    tempScriptPath: () => '/fake/tmp/node-eval-123.cjs',
    writeFileSync: (p, s) => {
      if (writeThrows) throw writeThrows;
      calls.writes.push({ p, s });
    },
    unlinkSync: (p) => { calls.unlinks.push(p); },
    spawnSync: (cmd, args, opts) => { calls.spawns.push({ cmd, args, opts }); return spawnResult; },
    stderr: (s) => { calls.stderr = (calls.stderr || '') + s; },
  };
  return { deps, calls };
}

test('run(): writes the argv-splice preamble ahead of the source, execs node on the temp file with forwarded args, cleans up', () => {
  const { deps, calls } = fakeDeps();
  const code = run('console.log("hi");', ['a', 'b'], deps);
  assert.equal(code, 0);
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.writes[0].p, '/fake/tmp/node-eval-123.cjs');
  assert.equal(calls.writes[0].s, 'process.argv.splice(1, 1);\nconsole.log("hi");');
  assert.equal(calls.spawns.length, 1);
  assert.deepEqual(calls.spawns[0].args, ['/fake/tmp/node-eval-123.cjs', 'a', 'b']);
  assert.deepEqual(calls.spawns[0].opts, { stdio: 'inherit' });
  assert.deepEqual(calls.unlinks, ['/fake/tmp/node-eval-123.cjs']);
});

test('run(): propagates the child\'s real exit code, not just 0/1', () => {
  const { deps } = fakeDeps({ spawnResult: { status: 3 } });
  assert.equal(run('process.exit(3);', [], deps), 3);
});

test('run(): cleans up the temp file even when the child failed', () => {
  const { deps, calls } = fakeDeps({ spawnResult: { status: 1 } });
  run('process.exit(1);', [], deps);
  assert.deepEqual(calls.unlinks, ['/fake/tmp/node-eval-123.cjs']);
});

test('run(): a spawn error (e.g. node not found) is a loud stderr message and exit 1, never a silent success', () => {
  const { deps, calls } = fakeDeps({ spawnResult: { error: new Error('ENOENT'), status: null } });
  const code = run('1;', [], deps);
  assert.equal(code, 1);
  assert.match(calls.stderr, /failed to run temp script: ENOENT/);
});

test('run(): a write failure (unwritable temp dir) is a loud stderr message and exit 1', () => {
  const { deps, calls } = fakeDeps({ writeThrows: new Error('EACCES') });
  const code = run('1;', [], deps);
  assert.equal(code, 1);
  assert.match(calls.stderr, /could not write temp script: EACCES/);
});

test('run(): a signal-killed child (no numeric status) is loud, not a silent 0', () => {
  const { deps, calls } = fakeDeps({ spawnResult: { status: null, signal: 'SIGTERM' } });
  const code = run('1;', [], deps);
  assert.equal(code, 1);
  assert.match(calls.stderr, /terminated by signal SIGTERM/);
});

test('end-to-end (real spawn, no faking): a genuinely multi-line script piped on stdin produces output — the exact case a multi-line `node -e` argument fails on Git Bash', () => {
  const script = [
    'const a = process.argv[1];',
    'const b = process.argv[2];',
    'console.log(JSON.stringify({ a, b, sum: Number(a) + Number(b) }));',
  ].join('\n');
  const out = execFileSync(process.execPath, [CLI, '2', '3'], { input: script, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out.trim()), { a: '2', b: '3', sum: 5 });
});

test('end-to-end: argv positions match plain `node -e "<code>" <args>` semantics exactly (process.argv[1] is the first real arg, no script-path entry)', () => {
  const viaEval = execFileSync(process.execPath, ['-e', 'console.log(process.argv[1], process.argv[2])', 'x', 'y'], { encoding: 'utf8' });
  const script = 'console.log(process.argv[1], process.argv[2]);';
  const viaWrapper = execFileSync(process.execPath, [CLI, 'x', 'y'], { input: script, encoding: 'utf8' });
  assert.equal(viaWrapper, viaEval);
});

test('end-to-end: a non-zero exit inside the evaluated script propagates', () => {
  assert.throws(() => {
    execFileSync(process.execPath, [CLI], { input: 'process.exit(7);', encoding: 'utf8' });
  }, (err) => err.status === 7);
});
