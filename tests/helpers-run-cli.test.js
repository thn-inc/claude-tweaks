// tests/helpers-run-cli.test.js — the in-process CLI test helper (#5374):
// runCli / runCliSync call a CLI's exported run(argv, deps) inside the test
// process and fail the test when the CLI leaks process state; spawnCli runs the
// same CLI as a real child process for smoke tests.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCli, runCliSync, spawnCli } = require('./helpers/run-cli');

const FX = path.join(__dirname, 'fixtures', 'run-cli');

const scratch = [];
after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});
function mk() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-run-cli-')));
  scratch.push(d);
  return d;
}

const leak = (kind, opts) => runCli(path.join(FX, 'leaky-cli.js'), [kind], opts);

test('runCliSync captures stdout, stderr and the exit code, and passes argv, cwd, env and stdin through deps', () => {
  const dir = mk();
  const res = runCliSync(path.join(FX, 'ok-cli.js'), ['7', 'b'], { cwd: dir, env: { X: 'y' }, stdin: 'in' });
  assert.deepStrictEqual(res, { code: 7, stdout: `${JSON.stringify({ argv: ['7', 'b'], cwd: dir, x: 'y', stdin: 'in' })}\n`, stderr: 'warn\n' });
});

test('runCli awaits an async run', async () => {
  assert.deepStrictEqual(await runCli(path.join(FX, 'async-cli.js'), []), { code: 3, stdout: 'done\n', stderr: '' });
});

test('runCliSync refuses a run that returns a promise', () => {
  assert.throws(() => runCliSync(path.join(FX, 'async-cli.js'), []), /run returned a promise — use runCli/);
});

test('env is the complete environment the CLI sees: default {} hides process.env', () => {
  process.env.X = 'ambient';
  try { assert.match(runCliSync(path.join(FX, 'ok-cli.js'), []).stdout, /"x":null/); } finally { delete process.env.X; }
});

test('AC1.1 (a): runCli rejects when run sets process.exitCode', async () => {
  await assert.rejects(leak('exitcode'), /leaked process state: .*process\.exitCode changed \(undefined -> 3\)/);
  assert.strictEqual(process.exitCode, undefined);
});

test('AC1.1 (b): runCli rejects when run calls process.chdir', async () => {
  const before = process.cwd();
  await assert.rejects(leak('chdir'), /process\.cwd\(\) changed/);
  assert.strictEqual(process.cwd(), before);
});

test('AC1.1 (c): runCli rejects when run adds a process.env key', async () => {
  await assert.rejects(leak('env-add'), /process\.env\.CT_RUN_CLI_LEAK added/);
  assert.strictEqual('CT_RUN_CLI_LEAK' in process.env, false);
});

test('AC1.1 (c): runCli rejects when run changes a process.env key', async () => {
  const before = process.env.PATH;
  await assert.rejects(leak('env-change'), /process\.env\.PATH changed/);
  assert.strictEqual(process.env.PATH, before);
});

test('AC1.1 (d): runCli rejects when run leaves a SIGTERM listener registered', async () => {
  const before = process.listenerCount('SIGTERM');
  await assert.rejects(leak('listener'), /SIGTERM listeners \d+ -> \d+/);
  assert.strictEqual(process.listenerCount('SIGTERM'), before);
});

test('AC1.1 (e): runCli rejects when run writes to process.stdout directly', async () => {
  await assert.rejects(leak('stdout'), /wrote to process\.stdout directly/);
  await assert.rejects(leak('stderr'), /wrote to process\.stderr directly/);
});

test('AC1.1 (e): a direct write after an await is still attributed to the CLI', async () => {
  await assert.rejects(leak('async-stdout'), /wrote to process\.stdout directly/);
});

test('AC1.1 (f): runCli rejects when run calls os.homedir() while env.HOME differs from the real one', async () => {
  await assert.rejects(
    leak('homedir', { env: { HOME: '/nonexistent-home', USERPROFILE: '/nonexistent-home' } }),
    /called os\.homedir\(\) while env\.HOME was injected/,
  );
  assert.deepStrictEqual(await leak('homedir', { env: { ...process.env } }), { code: 0, stdout: '', stderr: '' });
});

test('a listener the CLI removed is reported and registered again', async () => {
  const mine = () => {};
  process.on('SIGHUP', mine);
  try {
    await assert.rejects(leak('listener-remove'), /SIGHUP listeners \d+ -> \d+/);
    assert.ok(process.listeners('SIGHUP').includes(mine));
  } finally {
    process.removeListener('SIGHUP', mine);
  }
});

test('runCliSync applies the same leak guard', () => {
  assert.throws(() => runCliSync(path.join(FX, 'leaky-cli.js'), ['exitcode']), /process\.exitCode changed/);
  assert.strictEqual(process.exitCode, undefined);
});

const REAL_RUNNER = /runCli: real runner reached — pass a fake in deps or allowRealRunner: true/;

test('AC2.1: a real runner left in realDeps throws, naming the key, when the CLI calls it', async () => {
  await assert.rejects(runCli(path.join(FX, 'runner-cli.js'), []), REAL_RUNNER);
  assert.throws(() => runCliSync(path.join(FX, 'runner-cli.js'), []), REAL_RUNNER);
});

test('AC2.2: allowRealRunner reaches the real runner, and a fake in deps replaces it', async () => {
  const cli = path.join(FX, 'runner-cli.js');
  assert.strictEqual((await runCli(cli, [], { allowRealRunner: true })).stdout, 'real-runner-reached');
  assert.strictEqual(runCliSync(cli, [], { allowRealRunner: true }).stdout, 'real-runner-reached');
  assert.strictEqual(runCliSync(cli, [], { deps: { runner: () => 'fake' } }).stdout, 'fake');
});

test('AC2.1: a real runner reach the CLI catches still fails the call', async () => {
  await assert.rejects(runCli(path.join(FX, 'runner-cli.js'), ['catch']), REAL_RUNNER);
  assert.throws(() => runCliSync(path.join(FX, 'runner-cli.js'), ['catch']), REAL_RUNNER);
});

test('refuses a CLI that exports no realDeps', async () => {
  assert.throws(() => runCliSync(path.join(FX, 'no-realdeps-cli.js'), []), /no-realdeps-cli\.js exports no realDeps/);
  await assert.rejects(runCli(path.join(FX, 'no-realdeps-cli.js'), []), /no-realdeps-cli\.js exports no realDeps/);
});

test('refuses a CLI that exports no run function', async () => {
  const NO_RUN = /runCli: no-run-cli\.js exports no run — see the entry contract in /;
  assert.throws(() => runCliSync(path.join(FX, 'no-run-cli.js'), []), NO_RUN);
  await assert.rejects(runCli(path.join(FX, 'no-run-cli.js'), []), NO_RUN);
});

test('rejects a run that returns a non-integer', () => {
  assert.throws(() => runCliSync(path.join(FX, 'ok-cli.js'), ['undefined']), /run returned undefined, expected an integer exit code/);
});

test('Review Focus 1: a run that throws leaves the helper usable', async () => {
  assert.throws(() => runCliSync(path.join(FX, 'throwing-cli.js'), ['sync']), /^Error: boom$/);
  assert.strictEqual(runCliSync(path.join(FX, 'ok-cli.js'), []).code, 0);
  await assert.rejects(runCli(path.join(FX, 'throwing-cli.js'), ['async']), /^Error: boom$/);
  assert.strictEqual(runCliSync(path.join(FX, 'ok-cli.js'), []).code, 0);
});

test('Review Focus 2: a write from outside the CLI\'s async context is not reported as its leak', async () => {
  const p = runCli(path.join(FX, 'async-cli.js'), []);
  process.stderr.write('');
  assert.deepStrictEqual(await p, { code: 3, stdout: 'done\n', stderr: '' });
});

test('a second in-process call while one is pending throws', async () => {
  const p = runCli(path.join(FX, 'async-cli.js'), []);
  assert.throws(() => runCliSync(path.join(FX, 'ok-cli.js'), []), /another runCli call is still pending/);
  assert.throws(() => runCli(path.join(FX, 'ok-cli.js'), []), /another runCli call is still pending/);
  await p;
});

test('spawnCli returns the same shape from a real process', () => {
  const dir = mk();
  const cli = path.join(FX, 'script-cli.js');
  const expected = { code: 4, stdout: `${JSON.stringify({ argv: ['4'], cwd: dir, x: 'y', stdin: 'in' })}\n`, stderr: 'warn\n' };
  assert.deepStrictEqual(spawnCli(cli, ['4'], { cwd: dir, env: { ...process.env, X: 'y' }, stdin: 'in' }), expected);
  assert.deepStrictEqual(runCliSync(cli, ['4'], { cwd: dir, env: { X: 'y' }, stdin: 'in' }), expected);
});
