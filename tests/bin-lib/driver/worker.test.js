'use strict';
const test = require('node:test');
const { afterEach } = test;
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const worker = require(path.join(LIB, 'driver', 'worker.js'));
const { launchWorker, buildEnv, conformsTo, ENVELOPE_FIELDS, ENV_ALLOW, ENV_ALLOW_WIN32 } = worker;
const { RESULT_SCHEMA, SANDBOX_PROBED_PLATFORMS, implementerSettings } = require(path.join(LIB, 'driver', 'roles.js'));
const OK = require('./fixtures/worker-result.json');
const BUDGET = require('./fixtures/worker-result-budget.json');

// A kill reaching the shared fake runner's handle is never expected. The launcher swallows
// a throwing `kill`, so the fake records instead, and the hook below fails the test.
const unexpectedKills = [];
afterEach(() => {
  const seen = unexpectedKills.splice(0);
  assert.deepStrictEqual(seen, [], 'the shared fake runner was killed');
});

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
    return { pid: 4242, kill(signal) { unexpectedKills.push(signal); }, exited: spawnError ? Promise.reject(spawnError) : Promise.resolve({ signal: null, stderr: '', ...outcome }) };
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

test('AC5: the envelope field names are pinned',() => {
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

test('AC5: a title that is not one line is fail/schema', async (t) => {
  for (const title of ['two\nlines', 'two\rlines', 'two\r\nlines']) {
    const { runner } = fakeRunner(okOut({ structured_output: { ...OK.structured_output, title } }));
    const env = await launchWorker(base(t), { runner });
    assert.strictEqual(env.status, 'fail', JSON.stringify(title));
    assert.strictEqual(env.reason, 'schema', JSON.stringify(title));
    assert.strictEqual(env.result, null);
  }
  const { runner } = fakeRunner(okOut({ structured_output: { ...OK.structured_output, title: 'one line, with: punctuation' } }));
  assert.strictEqual((await launchWorker(base(t), { runner })).status, 'ok');
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

test('AC12: a launch off the sandbox-probed platforms carries no Bash tool and no Bash rule', async (t) => {
  const { runner, calls } = fakeRunner(okOut());
  await launchWorker(base(t, { platform: 'linux' }), { runner });
  assert.strictEqual(calls[0].args[calls[0].args.indexOf('--tools') + 1], 'Read,Write,Edit');
  const settings = JSON.parse(calls[0].files['--settings'].text);
  for (const rule of settings.permissions.allow) assert.ok(!rule.startsWith('Bash('), rule);
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

test('Review: cwd and settingsDir must be absolute, and the rights file must lie outside the working directory', async (t) => {
  const refused = async (over, pattern, errClass) => {
    const { runner, calls } = fakeRunner(okOut());
    const opts = base(t, over);
    await assert.rejects(launchWorker(opts, { runner }), (err) => err instanceof errClass && pattern.test(err.message), JSON.stringify(Object.keys(over)));
    assert.strictEqual(calls.length, 0);
    if (path.isAbsolute(opts.settingsDir)) {
      if (fs.existsSync(opts.settingsDir)) assert.deepStrictEqual(fs.readdirSync(opts.settingsDir), []);
    } else {
      assert.ok(!fs.existsSync(opts.settingsDir), 'a relative settingsDir was created');
    }
  };
  await refused({ cwd: undefined }, /cwd/, TypeError);
  await refused({ cwd: 'relative/dir' }, /cwd/, TypeError);
  await refused({ settingsDir: 'relative/settings' }, /settingsDir/, TypeError);
  const same = tmp(t);
  await refused({ cwd: same, settingsDir: same }, /settingsDir.*outside the working directory/, Error);
  const inside = tmp(t);
  await refused({ cwd: inside, settingsDir: path.join(inside, 'sub', 'settings') }, /settingsDir.*outside the working directory/, Error);
  assert.ok(!fs.existsSync(path.join(inside, 'sub')));
});

test('Review: a settingsDir that merely shares a name prefix with cwd is accepted', async (t) => {
  const { runner, calls } = fakeRunner(okOut());
  const cwd = tmp(t);
  const settingsDir = cwd + '-settings';
  t.after(() => fs.rmSync(settingsDir, { recursive: true, force: true }));
  const env = await launchWorker(base(t, { cwd, settingsDir }), { runner });
  assert.strictEqual(env.status, 'ok');
  assert.strictEqual(calls.length, 1);
});

test('Review: a prompt that is not a string is refused before anything is written', async (t) => {
  for (const bad of [undefined, 42, Buffer.from('x')]) {
    const { runner, calls } = fakeRunner(okOut());
    const opts = base(t, { prompt: bad });
    await assert.rejects(launchWorker(opts, { runner }), (err) => err instanceof TypeError && /prompt/.test(err.message), String(bad));
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
  assert.deepStrictEqual(Object.keys(calls[0].options.env).sort(), ['CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH', 'TMPDIR', 'USER']);
  for (const name of ['PIPELINE_RUN_DIR', 'CLAUDE_CODE_SESSION_ID', 'GH_TOKEN', 'GITHUB_TOKEN']) assert.ok(!(name in calls[0].options.env), name);
});

test('AC10: the allow lists are pinned', () => {
  assert.deepStrictEqual(ENV_ALLOW, ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'CLAUDE_CONFIG_DIR']);
  assert.deepStrictEqual(ENV_ALLOW_WIN32, ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'CLAUDE_CONFIG_DIR', 'USERPROFILE', 'USERNAME', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']);
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

test('Review focus: a schema with an unsupported keyword is refused before anything is written', async (t) => {
  const { runner, calls } = fakeRunner(okOut());
  const opts = base(t, { schema: { type: 'object', patternProperties: {} } });
  await assert.rejects(launchWorker(opts, { runner }), /patternProperties/);
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(fs.readdirSync(opts.settingsDir), []);
  const nested = base(t, { schema: { type: 'object', properties: { a: { type: 'string', pattern: 'x' } } } });
  await assert.rejects(launchWorker(nested, { runner }), /pattern/);
  assert.strictEqual(calls.length, 0);
});

test('Review focus: a null or absent permission_denials gives an empty denials list', async (t) => {
  const absent = { ...OK };
  delete absent.permission_denials;
  for (const stdout of [JSON.stringify({ ...OK, permission_denials: null }), JSON.stringify(absent)]) {
    const { runner } = fakeRunner({ code: 0, stdout });
    const env = await launchWorker(base(t), { runner });
    assert.strictEqual(env.status, 'ok');
    assert.deepStrictEqual(env.denials, []);
  }
});

test('Review focus: a zero exit with an error result is fail/exit', async (t) => {
  for (const over of [{ subtype: 'error_during_execution' }, { is_error: true }]) {
    const { runner } = fakeRunner(okOut(over));
    const env = await launchWorker(base(t), { runner });
    assert.strictEqual(env.status, 'fail', JSON.stringify(over));
    assert.strictEqual(env.reason, 'exit', JSON.stringify(over));
    assert.strictEqual(env.result, null);
  }
});

test('Review focus: a removal that fails neither replaces the envelope nor skips the other file', async (t) => {
  const settingsDir = tmp(t);
  const okRunner = fakeRunner(okOut()).runner;
  const runner = (call) => {
    const handle = okRunner(call);
    const settingsPath = call.args[call.args.indexOf('--settings') + 1];
    fs.rmSync(settingsPath, { force: true });
    fs.mkdirSync(path.join(settingsPath, 'child'), { recursive: true });
    fs.writeFileSync(path.join(settingsPath, 'child', 'f'), 'x');
    return handle;
  };
  const env = await launchWorker(base(t, { settingsDir, claudeMdText: 'project rules' }), { runner });
  assert.strictEqual(env.status, 'ok');
  assert.deepStrictEqual(fs.readdirSync(settingsDir).filter((n) => n.endsWith('.append.md')), []);
});

test('Review focus: a name collision never removes the other file', async (t) => {
  const { runner, calls } = fakeRunner(okOut());
  const settingsDir = tmp(t);
  const original = fs.writeFileSync;
  const collision = Object.assign(new Error('file already exists'), { code: 'EEXIST' });
  const mock = t.mock.method(fs, 'writeFileSync', (file, ...rest) => {
    original(file, 'foreign');
    throw collision;
  }, { times: 1 });
  await assert.rejects(launchWorker(base(t, { settingsDir }), { runner }), (err) => err === collision);
  mock.mock.restore();
  assert.strictEqual(calls.length, 0);
  const files = fs.readdirSync(settingsDir);
  assert.strictEqual(files.length, 1);
  assert.strictEqual(fs.readFileSync(path.join(settingsDir, files[0]), 'utf8'), 'foreign');
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

// Never exits on its own. `dieOn` names what ends it: a signal name, or 'taskkill'.
function hungRunner(dieOn) {
  const calls = []; const kills = []; let finish;
  const exited = new Promise((resolve) => { finish = resolve; });
  const runner = (call) => {
    calls.push(call);
    if (call.file === 'taskkill') { if (dieOn === 'taskkill') finish({ code: 1, signal: null, stdout: '', stderr: '' }); return { pid: 1, kill() {}, exited: Promise.resolve({ code: 0, signal: null, stdout: '', stderr: '' }) }; }
    return { pid: 4242, kill(sig) { kills.push(sig); if (sig === dieOn) finish({ code: null, signal: sig, stdout: '', stderr: '' }); }, exited };
  };
  return { runner, calls, kills };
}
// Timers that record each delay and fire on the next tick, so no test waits on a real clock.
// `hold` lists delays that are recorded but never fired (the test decides the child's fate instead).
function instantTimers({ hold = [] } = {}) {
  const delays = []; const cleared = [];
  return { delays, cleared, timers: { setTimeout: (fn, ms) => { delays.push(ms); return hold.includes(ms) ? { held: ms } : setImmediate(fn); }, clearTimeout: (h) => { cleared.push(h); if (h && !h.held) clearImmediate(h); } } };
}
// Real timers that record every handle they hand out and every handle cleared.
function recordingTimers() {
  const handles = []; const cleared = [];
  return { handles, cleared, timers: { setTimeout: (fn, ms) => { const h = setTimeout(fn, ms); handles.push(h); return h; }, clearTimeout: (h) => { cleared.push(h); clearTimeout(h); } } };
}
// Kills a child a test started if the test ended without it exiting.
// It signals by pid directly, never through `handle.kill`, which is the code under test.
function reapAfter(t, handle) {
  let done = false;
  handle.exited.then(() => { done = true; }, () => { done = true; });
  t.after(() => {
    if (done || !Number.isInteger(handle.pid) || handle.pid <= 0) return;
    if (process.platform !== 'win32') { try { process.kill(-handle.pid, 'SIGKILL'); } catch { /* already gone */ } }
    try { process.kill(handle.pid, 'SIGKILL'); } catch { /* already gone */ }
  });
}

test('AC4: at the ceiling a POSIX child gets SIGTERM and the envelope is timeout/wall-clock-ceiling', async (t) => {
  const { runner, kills } = hungRunner('SIGTERM');
  const { timers, delays } = instantTimers();
  const env = await launchWorker(base(t, { platform: 'linux', ceilings: { wallClockMs: 1234 } }), { runner, timers });
  assert.strictEqual(env.status, 'timeout');
  assert.strictEqual(env.reason, 'wall-clock-ceiling');
  assert.deepStrictEqual(kills, ['SIGTERM']);
  assert.strictEqual(delays[0], 1234);
});

test('AC4: a POSIX child that ignores SIGTERM gets SIGKILL after KILL_GRACE_MS', async (t) => {
  const { runner, kills } = hungRunner('SIGKILL');
  const { timers, delays } = instantTimers();
  const env = await launchWorker(base(t, { platform: 'linux', ceilings: { wallClockMs: 1234 } }), { runner, timers });
  assert.strictEqual(env.status, 'timeout');
  assert.strictEqual(env.reason, 'wall-clock-ceiling');
  assert.deepStrictEqual(kills, ['SIGTERM', 'SIGKILL']);
  assert.deepStrictEqual(delays.slice(0, 2), [1234, worker.KILL_GRACE_MS]);
  assert.strictEqual(worker.KILL_GRACE_MS, 5000);
  assert.strictEqual(worker.REAP_DEADLINE_MS, 5000);
  assert.strictEqual(env.detail, null);
});

test("AC4: on win32 the ceiling runs taskkill on the child's pid", async (t) => {
  const { runner, kills, calls } = hungRunner('taskkill');
  const { timers } = instantTimers();
  const env = await launchWorker(base(t, { platform: 'win32', env: { Path: 'p' }, ceilings: { wallClockMs: 1234 } }), { runner, timers });
  assert.strictEqual(env.status, 'timeout');
  assert.strictEqual(env.reason, 'wall-clock-ceiling');
  assert.deepStrictEqual(kills, []);
  assert.strictEqual(calls[1].file, 'taskkill');
  assert.deepStrictEqual(calls[1].args, ['/T', '/F', '/PID', '4242']);
  assert.deepStrictEqual(calls[1].options, { env: { Path: 'p' } });
});

test('AC4: the envelope is returned only after the child has exited', async (t) => {
  const kills = [];
  let release;
  const exited = new Promise((resolve) => { release = resolve; });
  const runner = () => ({ pid: 4242, kill(sig) { kills.push(sig); }, exited });
  const { timers } = instantTimers({ hold: [5000] });
  let settled = false;
  const launch = launchWorker(base(t, { platform: 'linux', ceilings: { wallClockMs: 1234 } }), { runner, timers }).then((e) => { settled = true; return e; });
  for (let i = 0; i < 3; i += 1) await new Promise(setImmediate);
  assert.strictEqual(settled, false);
  assert.deepStrictEqual(kills, ['SIGTERM']);
  release({ code: null, signal: 'SIGTERM', stdout: '', stderr: '' });
  const env = await launch;
  assert.strictEqual(env.status, 'timeout');
  assert.strictEqual(env.reason, 'wall-clock-ceiling');
  assert.strictEqual(env.detail, null);
});

test('a child that survives the kill is given up on at the reap deadline, with its pid named', async (t) => {
  const posix = hungRunner('never');
  const posixTimers = instantTimers();
  const posixOpts = base(t, { platform: 'linux', ceilings: { wallClockMs: 1234 } });
  const a = await launchWorker(posixOpts, { runner: posix.runner, timers: posixTimers.timers });
  assert.strictEqual(a.status, 'timeout');
  assert.strictEqual(a.reason, 'wall-clock-ceiling');
  assert.deepStrictEqual(posix.kills, ['SIGTERM', 'SIGKILL']);
  assert.deepStrictEqual(posixTimers.delays, [1234, worker.KILL_GRACE_MS, worker.REAP_DEADLINE_MS]);
  assert.strictEqual(a.detail, 'child 4242 did not exit after kill');
  assert.deepStrictEqual(fs.readdirSync(posixOpts.settingsDir), []);

  const win = hungRunner('never');
  const winTimers = instantTimers();
  const winOpts = base(t, { platform: 'win32', env: { Path: 'p' }, ceilings: { wallClockMs: 1234 } });
  const b = await launchWorker(winOpts, { runner: win.runner, timers: winTimers.timers });
  assert.strictEqual(b.status, 'timeout');
  assert.strictEqual(b.reason, 'wall-clock-ceiling');
  assert.deepStrictEqual(win.kills, ['SIGKILL']);
  assert.ok(win.calls.some((c) => c.file === 'taskkill'));
  assert.deepStrictEqual(winTimers.delays, [1234, worker.REAP_DEADLINE_MS]);
  assert.strictEqual(b.detail, 'child 4242 did not exit after kill');
  assert.deepStrictEqual(fs.readdirSync(winOpts.settingsDir), []);
});

test('a taskkill that never returns does not hold the launch past the reap deadline', async (t) => {
  const taskkillKills = [];
  const workerKills = [];
  const never = new Promise(() => {});
  const runner = (call) => (call.file === 'taskkill'
    ? { pid: 1, kill(sig) { taskkillKills.push(sig); }, exited: never }
    : { pid: 4242, kill(sig) { workerKills.push(sig); }, exited: never });
  const { timers, delays } = instantTimers();
  const opts = base(t, { platform: 'win32', env: { Path: 'p' }, ceilings: { wallClockMs: 1234 } });
  const env = await launchWorker(opts, { runner, timers });
  assert.strictEqual(env.status, 'timeout');
  assert.strictEqual(env.reason, 'wall-clock-ceiling');
  assert.strictEqual(env.detail, 'child 4242 did not exit after kill');
  assert.deepStrictEqual(delays, [1234, worker.REAP_DEADLINE_MS]);
  assert.deepStrictEqual(taskkillKills, ['SIGKILL']);
  assert.deepStrictEqual(workerKills, ['SIGKILL']);
  assert.deepStrictEqual(fs.readdirSync(opts.settingsDir), []);
});

test('a worker handle whose kill throws at the win32 reap deadline does not stop the launch from returning', async (t) => {
  const never = new Promise(() => {});
  const runner = (call) => (call.file === 'taskkill'
    ? { pid: 1, kill() {}, exited: never }
    : { pid: 4242, kill() { throw new Error('already gone'); }, exited: never });
  const { timers } = instantTimers();
  const env = await launchWorker(base(t, { platform: 'win32', env: { Path: 'p' }, ceilings: { wallClockMs: 1234 } }), { runner, timers });
  assert.strictEqual(env.status, 'timeout');
  assert.strictEqual(env.detail, 'child 4242 did not exit after kill');
});

test('AC4: a child that exits before the ceiling clears the timer and is classified normally', async (t) => {
  const { runner } = fakeRunner(okOut());
  const { timers, cleared } = recordingTimers();
  const env = await launchWorker(base(t), { runner, timers });
  assert.strictEqual(env.status, 'ok');
  assert.strictEqual(cleared.length, 1);
});

test('a launch that fails to start clears the ceiling timer', async (t) => {
  const { runner } = fakeRunner({}, { spawnError: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) });
  const { timers, handles, cleared } = recordingTimers();
  const env = await launchWorker(base(t), { runner, timers });
  assert.strictEqual(env.reason, 'launch-error');
  assert.ok(handles.length > 0);
  for (const h of handles) assert.ok(cleared.includes(h));
  const thrown = recordingTimers();
  const env2 = await launchWorker(base(t), { runner: () => { throw new Error('boom'); }, timers: thrown.timers });
  assert.strictEqual(env2.reason, 'launch-error');
  assert.deepStrictEqual(thrown.handles, []);
});

test('a wall-clock ceiling that is not a positive finite number is refused', async (t) => {
  for (const bad of [0, -5, NaN, undefined, 2147483648, Infinity]) {
    const { runner, calls } = fakeRunner(okOut());
    const opts = base(t, { ceilings: { wallClockMs: bad } });
    await assert.rejects(launchWorker(opts, { runner }), RangeError, String(bad));
    assert.strictEqual(calls.length, 0);
    assert.deepStrictEqual(fs.readdirSync(opts.settingsDir), []);
  }
  const { runner } = fakeRunner(okOut());
  const env = await launchWorker(base(t, { ceilings: { wallClockMs: 2147483647 } }), { runner });
  assert.strictEqual(env.status, 'ok');
});

test('AC9: the win32 launch of a .cmd launcher is pinned as an exact string', async (t) => {
  const { runner, calls } = fakeRunner(okOut());
  await launchWorker(base(t, { platform: 'win32', bin: 'C:\\x\\claude.cmd', role: 'reviewer', env: { ComSpec: 'cmd.exe', Path: 'p' }, schema: { type: 'object' } }), { runner });
  assert.strictEqual(calls[0].file, 'cmd.exe');
  assert.deepStrictEqual(calls[0].args.slice(0, 3), ['/d', '/s', '/c']);
  assert.strictEqual(calls[0].options.windowsVerbatimArguments, true);
  assert.strictEqual(calls[0].args[3], String.raw`"C:\x\claude.cmd ^^^"-p^^^" ^^^"--safe-mode^^^" ^^^"--restricted^^^" ^^^"--tools^^^" ^^^"Read^^^,Grep^^^,Glob^^^" ^^^"--disable-slash-commands^^^" ^^^"--strict-mcp-config^^^" ^^^"--permission-prompts^^^" ^^^"none^^^" ^^^"--output-format^^^" ^^^"json^^^" ^^^"--json-schema^^^" ^^^"{\^^^"type\^^^":\^^^"object\^^^"}^^^""`);
});

test('AC9: a non-.cmd launcher passes through untouched on every platform', async (t) => {
  const { runner, calls } = fakeRunner(okOut());
  await launchWorker(base(t, { platform: 'win32', env: { Path: 'p' } }), { runner });
  assert.strictEqual(calls[0].file, 'claude');
  assert.strictEqual(calls[0].args[0], '-p');
});

test('defaultRunner pipes input to the child and resolves with its output', { timeout: 20000 }, async (t) => {
  const handle = worker.defaultRunner({ file: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)'], options: { cwd: os.tmpdir(), env: process.env }, input: 'hello' });
  reapAfter(t, handle);
  assert.deepStrictEqual(await handle.exited, { code: 0, signal: null, stdout: 'hello', stderr: '' });
  assert.strictEqual(typeof handle.pid, 'number');
});

test('defaultRunner takes detached and its kill from the platform it is given (win32)', { timeout: 20000 }, async (t) => {
  const seen = [];
  const spawn = (file, args, o) => { seen.push(o); return cp.spawn(file, args, o); };
  const handle = worker.defaultRunner({ file: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], options: { cwd: os.tmpdir(), env: process.env }, input: '', platform: 'win32' }, { spawn });
  reapAfter(t, handle);
  assert.strictEqual(seen[0].detached, false);
  assert.strictEqual(seen[0].windowsHide, true);
  handle.kill('SIGTERM');
  assert.strictEqual((await handle.exited).signal, 'SIGTERM');
});

test('defaultRunner takes detached and its kill from the platform it is given (linux)', { timeout: 20000, skip: process.platform === 'win32' && 'win32: no process groups' }, async (t) => {
  const seen = [];
  const spawn = (file, args, o) => { seen.push(o); return cp.spawn(file, args, o); };
  const handle = worker.defaultRunner({ file: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], options: { cwd: os.tmpdir(), env: process.env }, input: '', platform: 'linux' }, { spawn });
  reapAfter(t, handle);
  assert.strictEqual(seen[0].detached, true);
  handle.kill('SIGTERM');
  assert.strictEqual((await handle.exited).signal, 'SIGTERM');
});

test('defaultRunner rejects when the binary does not exist', { timeout: 20000 }, async (t) => {
  const missing = path.join(os.tmpdir(), 'no-such-binary-5217');
  const handle = worker.defaultRunner({ file: missing, args: [], options: { cwd: os.tmpdir(), env: process.env }, input: 'x' });
  reapAfter(t, handle);
  await assert.rejects(handle.exited, /ENOENT/);
  const env = await launchWorker(base(t, { bin: missing, platform: process.platform }));
  assert.strictEqual(env.status, 'fail');
  assert.strictEqual(env.reason, 'launch-error');
});

test('defaultRunner kill ends the child and a grandchild it started (POSIX only)', { timeout: 20000, skip: process.platform === 'win32' && 'win32: no process groups; taskkill covers it' }, async (t) => {
  const dir = tmp(t);
  const script = [
    "const { spawn } = require('child_process');",
    "const g = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });",
    "process.stdout.write(String(g.pid) + '\\n');",
    "require('fs').writeFileSync(process.argv[1], 'ready');",
    'setInterval(() => {}, 1000);',
  ].join('\n');
  const handle = worker.defaultRunner({ file: process.execPath, args: ['-e', script, path.join(dir, 'ready')], options: { cwd: dir, env: process.env }, input: '', platform: 'linux' });
  reapAfter(t, handle);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
  for (let i = 0; i < 50 && !fs.readdirSync(dir).includes('ready'); i += 1) await pause();
  assert.ok(fs.readdirSync(dir).includes('ready'), 'the child never reported its grandchild');
  handle.kill('SIGTERM');
  const out = await handle.exited;
  const grandPid = Number.parseInt(out.stdout.trim(), 10);
  assert.ok(Number.isInteger(grandPid) && grandPid > 0, 'grandchild pid in ' + JSON.stringify(out.stdout));
  t.after(() => { try { process.kill(grandPid, 'SIGKILL'); } catch { /* already gone */ } });
  let gone = false;
  for (let i = 0; i < 50 && !gone; i += 1) {
    try { process.kill(grandPid, 0); await pause(); } catch (err) { gone = err.code === 'ESRCH'; if (!gone) throw err; }
  }
  assert.ok(gone, 'the grandchild outlived the group kill');
});

test('defaultRunner kills a child it started when something throws after the spawn, and rethrows', async () => {
  const { EventEmitter } = require('node:events');
  const killed = [];
  const child = Object.assign(new EventEmitter(), { pid: 88, kill(sig) { killed.push(sig); } });
  child.stdin = Object.assign(new EventEmitter(), { end() { throw new Error('stdin broke'); } });
  child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
  assert.throws(() => worker.defaultRunner({ file: 'x', args: [], options: {}, input: 'p', platform: 'win32' }, { spawn: () => child }), /stdin broke/);
  assert.strictEqual(killed.length, 1);
});

test("defaultRunner lets the child's exit decide when stdin errors", async () => {
  const { EventEmitter } = require('node:events');
  const child = Object.assign(new EventEmitter(), { pid: 77 });
  child.stdin = Object.assign(new EventEmitter(), { write() {}, end() {} });
  child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
  const handle = worker.defaultRunner({ file: 'x', args: [], options: {}, input: 'p', platform: 'linux' }, { spawn: () => child });
  child.stdin.emit('error', Object.assign(new Error('write EOF'), { code: 'EOF' }));
  child.stderr.emit('data', "error: unknown option '--x'\n");
  child.emit('close', 1, null);
  assert.deepStrictEqual(await handle.exited, { code: 1, signal: null, stdout: '', stderr: "error: unknown option '--x'\n" });
});

test('AC7: live smoke test — the write runs, echo and curl are denied', { skip: !process.env.DRIVER_LIVE_SMOKE && 'set DRIVER_LIVE_SMOKE=1 to launch a real worker (spends tokens)' }, async (t) => {
  const cwd = tmp(t);
  const settingsDir = tmp(t);
  const init = cp.spawnSync('git', ['init', '-q'], { cwd, windowsHide: true });
  assert.strictEqual(init.status, 0, 'git init failed in the smoke test directory');
  fs.mkdirSync(path.join(cwd, '.git', 'info'), { recursive: true });
  const commit = cp.spawnSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd, windowsHide: true });
  assert.strictEqual(commit.status, 0, 'git commit failed in the smoke test directory');
  const configBefore = fs.readFileSync(path.join(cwd, '.git', 'config'));
  const prompt = 'Do these six things in order, continuing after any denial: (1) use the Write tool to create smoke-w.txt containing hi; (2) run the bash command: echo hi > smoke-b.txt (3) run the bash command: curl -s https://example.com -o smoke-net.txt (4) use the Write tool to create .git/info/smoke-note.txt containing hi (5) run the bash command: git log -1 --format=%H --output=.git/config (6) run the bash command: git log -1 --format=%H --output=.git/hooks/pre-commit. Then report what happened.';
  const env = await launchWorker({ role: 'implementer', cwd, settingsDir, prompt, model: 'haiku', testCommand: 'node --test', ceilings: { wallClockMs: 180000, spendCeiling: 1 }, claudeMdText: 'Probe project file.' });
  assert.strictEqual(env.status, 'ok', JSON.stringify(env));
  const files = fs.readdirSync(cwd);
  assert.ok(files.includes('smoke-w.txt'));
  assert.ok(!files.includes('smoke-b.txt'));
  assert.ok(!files.includes('smoke-net.txt'));
  assert.ok(!fs.readdirSync(path.join(cwd, '.git', 'info')).includes('smoke-note.txt'));
  assert.ok(fs.readFileSync(path.join(cwd, '.git', 'config')).equals(configBefore), '.git/config changed');
  assert.ok(!fs.existsSync(path.join(cwd, '.git', 'hooks', 'pre-commit')), '.git/hooks/pre-commit was written');
  // Bash is in the tool list only on the platforms where the sandbox was probed.
  if (SANDBOX_PROBED_PLATFORMS.includes(process.platform)) {
    const command = (d) => String((d.tool_input && d.tool_input.command) || '');
    assert.ok(env.denials.some((d) => command(d).includes('echo')), 'echo denied');
    assert.ok(env.denials.some((d) => command(d).includes('curl')), 'curl denied');
  }
  assert.ok(env.denials.some((d) => d.tool_name === 'Write' && String((d.tool_input && d.tool_input.file_path) || '').includes('.git')), 'write into .git denied');
  assert.deepStrictEqual(fs.readdirSync(settingsDir), []);
});
