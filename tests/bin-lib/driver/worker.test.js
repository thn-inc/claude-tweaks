'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const worker = require(path.join(LIB, 'driver', 'worker.js'));
const { launchWorker, buildEnv, conformsTo, ENVELOPE_FIELDS, ENV_ALLOW, ENV_ALLOW_WIN32 } = worker;
const { RESULT_SCHEMA, implementerSettings } = require(path.join(LIB, 'driver', 'roles.js'));
const OK = require('./fixtures/worker-result.json');
const BUDGET = require('./fixtures/worker-result-budget.json');

// A fake runner: records every call, answers with `outcome` (or rejects with `spawnError`).
function fakeRunner(outcome, { spawnError } = {}) {
  const calls = [];
  const runner = (call) => {
    const record = { ...call, files: {} };
    for (const flag of ['--settings', '--append-system-prompt-file']) {
      const i = call.args.indexOf(flag);
      if (i !== -1) record.files[flag] = { path: call.args[i + 1], text: fs.readFileSync(call.args[i + 1], 'utf8') };
    }
    calls.push(record);
    return { pid: 4242, kill() { throw new Error('unexpected kill'); }, exited: spawnError ? Promise.reject(spawnError) : Promise.resolve({ signal: null, stderr: '', ...outcome }) };
  };
  return { runner, calls };
}
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'driver-worker-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const base = (t, extra = {}) => ({ role: 'implementer', cwd: tmp(t), prompt: 'do the thing', ceilings: { wallClockMs: 60000 }, testCommand: 'node --test', settingsDir: tmp(t), platform: 'darwin', env: { PATH: '/bin', HOME: '/h', USER: 'u' }, ...extra });
const okOut = (over = {}) => ({ code: 0, stdout: JSON.stringify({ ...OK, ...over }) });

test('AC5: an ok result fills every envelope field from the result', async (t) => {
  const { runner } = fakeRunner(okOut());
  const env = await launchWorker(base(t), { runner });
  assert.deepStrictEqual(Object.keys(env), ENVELOPE_FIELDS);
  assert.strictEqual(env.status, 'ok');
  assert.strictEqual(env.reason, null);
  assert.deepStrictEqual(env.result, OK.structured_output);
  assert.deepStrictEqual(env.usage, OK.usage);
  assert.strictEqual(env.turns, OK.num_turns);
  assert.deepStrictEqual(env.denials, OK.permission_denials);
  assert.strictEqual(env.denials.length, 2);
  assert.strictEqual(env.costUsd, OK.total_cost_usd);
  assert.strictEqual(env.spendOverrun, false);
  assert.strictEqual(env.detail, null);
});

test('AC5: the envelope field names are pinned', () => {
  assert.deepStrictEqual(ENVELOPE_FIELDS, ['status', 'reason', 'result', 'usage', 'turns', 'denials', 'spendOverrun', 'costUsd', 'detail']);
});

test('AC5: a result that fails the schema is fail/schema', async (t) => {
  const { runner } = fakeRunner(okOut({ structured_output: { status: 'maybe', title: 't', summary: 's' } }));
  const env = await launchWorker(base(t), { runner });
  assert.strictEqual(env.status, 'fail');
  assert.strictEqual(env.reason, 'schema');
  assert.strictEqual(env.result, null);
  assert.strictEqual(env.turns, OK.num_turns);
  assert.strictEqual(env.denials.length, 2);
});

test('Review focus: a result with no structured_output is fail/schema, and the free-text result is not parsed', async (t) => {
  const stdoutObj = { ...OK, result: JSON.stringify(OK.structured_output) };
  delete stdoutObj.structured_output;
  const { runner } = fakeRunner({ code: 0, stdout: JSON.stringify(stdoutObj) });
  const env = await launchWorker(base(t), { runner });
  assert.strictEqual(env.status, 'fail');
  assert.strictEqual(env.reason, 'schema');
  assert.strictEqual(env.result, null);
});

test('AC5: a non-zero exit with a result object is fail/exit', async (t) => {
  const { runner } = fakeRunner({ code: 1, stdout: JSON.stringify({ ...OK, is_error: true, result: 'Not logged in · Please run /login' }) });
  const env = await launchWorker(base(t), { runner });
  assert.strictEqual(env.status, 'fail');
  assert.strictEqual(env.reason, 'exit');
  assert.match(env.detail, /Not logged in/);
});

test('AC6: a result with permission denials stays ok, and the runner is called exactly once', async (t) => {
  const { runner, calls } = fakeRunner(okOut());
  const env = await launchWorker(base(t), { runner });
  assert.strictEqual(env.status, 'ok');
  assert.strictEqual(env.denials.length, 2);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].files['--settings'].text, JSON.stringify(implementerSettings({ testCommand: 'node --test', platform: 'darwin' }), null, 2));
});

test('AC8: the CLI stopping at the spend ceiling is fail/spend-ceiling', async (t) => {
  const { runner, calls } = fakeRunner({ code: 1, stdout: JSON.stringify(BUDGET) });
  const env = await launchWorker(base(t, { ceilings: { wallClockMs: 60000, spendCeiling: 0.0001 } }), { runner });
  assert.strictEqual(env.status, 'fail');
  assert.strictEqual(env.reason, 'spend-ceiling');
  assert.strictEqual(env.detail, 'Reached maximum budget ($0.0001)');
  assert.strictEqual(env.spendOverrun, true);
  const i = calls[0].args.indexOf('--max-budget-usd');
  assert.notStrictEqual(i, -1);
  assert.strictEqual(calls[0].args[i + 1], '0.0001');
});

test('AC8: a cost above the ceiling on a normal result reports spendOverrun and leaves the status alone', async (t) => {
  const a = fakeRunner(okOut({ total_cost_usd: 3 }));
  const withCeiling = await launchWorker(base(t, { ceilings: { wallClockMs: 60000, spendCeiling: 2 } }), { runner: a.runner });
  assert.strictEqual(withCeiling.status, 'ok');
  assert.strictEqual(withCeiling.spendOverrun, true);
  const b = fakeRunner(okOut({ total_cost_usd: 3 }));
  const without = await launchWorker(base(t), { runner: b.runner });
  assert.strictEqual(without.spendOverrun, false);
  assert.ok(!b.calls[0].args.includes('--max-budget-usd'));
});

test('Review focus: a spend ceiling that is not a positive finite number is refused before anything is written', async (t) => {
  for (const bad of [0, -1, NaN, '2']) {
    const { runner, calls } = fakeRunner(okOut());
    const opts = base(t, { ceilings: { wallClockMs: 60000, spendCeiling: bad } });
    await assert.rejects(launchWorker(opts, { runner }), RangeError, String(bad));
    assert.strictEqual(calls.length, 0);
    assert.deepStrictEqual(fs.readdirSync(opts.settingsDir), []);
  }
});

test('AC9: a spawn error is fail/launch-error with the error named', async (t) => {
  const { runner } = fakeRunner({}, { spawnError: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) });
  const env = await launchWorker(base(t), { runner });
  assert.strictEqual(env.status, 'fail');
  assert.strictEqual(env.reason, 'launch-error');
  assert.match(env.detail, /ENOENT/);
  assert.strictEqual(env.result, null);
  assert.strictEqual(env.turns, null);
});

test('AC9: a flag the CLI does not know is fail/launch-error, never a worker result', async (t) => {
  const { runner } = fakeRunner({ code: 1, stdout: '', stderr: "error: unknown option '--restricted'\n" });
  const env = await launchWorker(base(t), { runner });
  assert.strictEqual(env.status, 'fail');
  assert.strictEqual(env.reason, 'launch-error');
  assert.strictEqual(env.detail, "error: unknown option '--restricted'");
});

test('Review focus: stdout that is not one result object never reads as ok', async (t) => {
  const table = [
    [{ code: 0, stdout: 'warning: x\n' }, 'schema'],
    [{ code: 0, stdout: '' }, 'schema'],
    [{ code: 0, stdout: '{"type":"other"}' }, 'schema'],
    [{ code: 2, stdout: 'partial {' }, 'exit'],
    [{ code: null, signal: 'SIGKILL', stdout: '' }, 'exit'],
  ];
  for (const [outcome, reason] of table) {
    const { runner } = fakeRunner(outcome);
    const env = await launchWorker(base(t), { runner });
    assert.strictEqual(env.status, 'fail', JSON.stringify(outcome));
    assert.strictEqual(env.reason, reason, JSON.stringify(outcome));
    if (outcome.signal) assert.match(env.detail, /SIGKILL/);
  }
});

test('AC10: the runner receives only allow-listed environment names', async (t) => {
  const { runner, calls } = fakeRunner(okOut());
  const env = { PATH: '/bin', HOME: '/h', USER: 'u', TMPDIR: '/t', LANG: 'C', CLAUDE_CONFIG_DIR: '/c', PIPELINE_RUN_DIR: '/r', CLAUDE_CODE_SESSION_ID: 's', GH_TOKEN: 'g', GITHUB_TOKEN: 'g2', SECRET: 'x' };
  await launchWorker(base(t, { env }), { runner });
  assert.deepStrictEqual(Object.keys(calls[0].options.env).sort(), [...ENV_ALLOW].sort());
});

test('AC10: on win32 the allow list matches names case-insensitively and keeps the stored spelling', () => {
  assert.deepStrictEqual(buildEnv({ Path: 'p', USERPROFILE: 'u', ComSpec: 'c', GH_TOKEN: 'g' }, 'win32'), { Path: 'p', USERPROFILE: 'u', ComSpec: 'c' });
  assert.deepStrictEqual(buildEnv({ Path: 'p' }, 'linux'), {});
  for (const name of ENV_ALLOW) assert.ok(ENV_ALLOW_WIN32.includes(name), name);
});

test('AC11: two concurrent launches use distinct files and both are removed', async (t) => {
  const { runner, calls } = fakeRunner(okOut());
  const settingsDir = tmp(t);
  await Promise.all([
    launchWorker(base(t, { settingsDir, claudeMdText: 'project rules' }), { runner }),
    launchWorker(base(t, { settingsDir, claudeMdText: 'project rules' }), { runner }),
  ]);
  assert.strictEqual(calls.length, 2);
  const paths = calls.flatMap((c) => Object.values(c.files).map((f) => f.path));
  assert.strictEqual(paths.length, 4);
  assert.strictEqual(new Set(paths).size, 4);
  for (const p of paths) assert.strictEqual(path.dirname(p), settingsDir);
  for (const c of calls) assert.strictEqual(c.files['--append-system-prompt-file'].text, 'project rules');
  assert.deepStrictEqual(fs.readdirSync(settingsDir), []);
});

test('Review focus: the per-launch files are removed when the launch fails to start', async (t) => {
  const { runner } = fakeRunner({}, { spawnError: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) });
  const opts = base(t, { claudeMdText: 'project rules' });
  const env = await launchWorker(opts, { runner });
  assert.strictEqual(env.reason, 'launch-error');
  assert.deepStrictEqual(fs.readdirSync(opts.settingsDir), []);
});

test('Review focus: the prompt and the project file never reach the argument list', async (t) => {
  const { runner, calls } = fakeRunner(okOut());
  const prompt = 'x'.repeat(40000);
  await launchWorker(base(t, { prompt, claudeMdText: 'x'.repeat(40000) }), { runner });
  assert.strictEqual(calls[0].input, prompt);
  for (const a of calls[0].args) assert.ok(a.length <= 1000, 'argument of length ' + a.length);
  assert.strictEqual(calls[0].file, 'claude');
  assert.strictEqual(calls[0].args[0], '-p');
});

test('reviewer launches write no settings file', async (t) => {
  const { runner, calls } = fakeRunner(okOut());
  await launchWorker(base(t, { role: 'reviewer' }), { runner });
  assert.ok(!calls[0].args.includes('--settings'));
  assert.ok(!('--settings' in calls[0].files));
});

test('conformsTo covers the schema subset and refuses the rest', () => {
  const good = OK.structured_output;
  assert.strictEqual(conformsTo(RESULT_SCHEMA, good), true);
  const { title, ...missing } = good;
  assert.strictEqual(conformsTo(RESULT_SCHEMA, missing), false);
  assert.strictEqual(conformsTo(RESULT_SCHEMA, { ...good, extra: 1 }), false);
  assert.strictEqual(conformsTo(RESULT_SCHEMA, { ...good, status: 'maybe' }), false);
  assert.strictEqual(conformsTo(RESULT_SCHEMA, { ...good, title: 5 }), false);
  assert.strictEqual(conformsTo(RESULT_SCHEMA, null), false);
  assert.strictEqual(conformsTo(RESULT_SCHEMA, []), false);
  assert.throws(() => conformsTo({ type: 'object', patternProperties: {} }, {}), /patternProperties/);
});
