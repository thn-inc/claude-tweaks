'use strict';
// #5377: the env tripwire and the in-process hook-event runner.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { withEnvTripwire } = require('./helpers/env-tripwire');
const { runHookCli, hookEnv } = require('./helpers/hook-event');

const sessionEnd = require('../plugin/bin/lib/hooks/session-end');
const { resolvePluginVersion } = require('../plugin/bin/lib/plugin-version');

const sandbox = fs.realpathSync(scratchDir('ct-hook-event-'));

// Swaps session-end's run for `recorder`, restoring it afterwards.
async function withRecorder(recorder, fn) {
  const original = sessionEnd.run;
  sessionEnd.run = recorder;
  try { return await fn(); } finally { sessionEnd.run = original; }
}

test('withEnvTripwire records a read made from plugin/bin and none made from the test', async () => {
  const original = process.env;
  const { reads } = await withEnvTripwire(() => {
    resolvePluginVersion();
    return process.env.PATH;
  });
  assert.ok(reads.length > 0, 'the plugin read must be recorded');
  for (const r of reads) {
    assert.ok(r.frame.includes(`plugin${path.sep}bin`), `frame is under plugin/bin: ${r.frame}`);
  }
  assert.ok(!reads.some((r) => r.key === 'PATH'), 'the test own read of PATH is not recorded');
  assert.strictEqual(process.env, original);
});

test('withEnvTripwire restores process.env when fn throws', async () => {
  const original = process.env;
  await assert.rejects(withEnvTripwire(() => { throw new Error('boom'); }), /boom/);
  assert.strictEqual(process.env, original);
});

test('withEnvTripwire restores process.env when an async fn rejects', async () => {
  const original = process.env;
  await assert.rejects(withEnvTripwire(async () => { throw new Error('async boom'); }), /async boom/);
  assert.strictEqual(process.env, original);
});

test('AC9.1: the event tail hands env, cwd, homeDir and spawn to the event module', async () => {
  let seen;
  const fakeSpawn = () => {};
  await withRecorder((ctx) => { seen = ctx; return {}; }, async () => {
    const res = await runHookCli(['session-end'], { input: '{}', cwd: sandbox, env: hookEnv({ CT_5377_SENTINEL: 'x' }), deps: { spawn: fakeSpawn } });
    assert.strictEqual(res.code, 0);
  });
  assert.strictEqual(seen.env.CT_5377_SENTINEL, 'x');
  assert.strictEqual(seen.cwd, sandbox);
  assert.strictEqual(seen.spawn, fakeSpawn);
  assert.strictEqual(typeof seen.homeDir, 'function');
});

test('runHookCli returns the event JSON in stdout', async () => {
  const realWriteSync = fs.writeSync;
  const fds = [];
  fs.writeSync = function patched(fd, ...rest) { fds.push(fd); return realWriteSync.call(this, fd, ...rest); };
  let res;
  try {
    res = await withRecorder(() => ({ json: { ok: 1 } }), () => runHookCli(['session-end'], { input: '{}', cwd: sandbox, env: hookEnv() }));
  } finally {
    fs.writeSync = realWriteSync;
  }
  assert.strictEqual(res.stdout, '{"ok":1}');
  assert.ok(!fds.includes(1), 'the event JSON must not reach the real fd 1');
});

test('runHookCli rejects when an event reads process.env', async () => {
  // resolvePluginVersion() with no argument defaults to process.env, so it reads CLAUDE_PLUGIN_ROOT
  // from the real one inside plugin/bin.
  await withRecorder(() => { resolvePluginVersion(); return {}; }, async () => {
    await assert.rejects(
      runHookCli(['session-end'], { input: '{}', cwd: sandbox, env: hookEnv() }),
      (err) => /hook event read process\.env: .*CLAUDE_PLUGIN_ROOT@/.test(err.message),
    );
  });
});

test('runHookCli leaves a verb call outside the tripwire, and trips the same read under an event name', async () => {
  // A verb whose handler reads the real process.env from a plugin/bin frame: the verb call resolves,
  // the same read under an event name rejects. Without the isVerb branch the verb call would reject.
  const { VERBS } = require('../plugin/bin/hooks');
  const original = VERBS['reconcile-summary'].run;
  let ran = 0;
  const reader = () => { ran += 1; resolvePluginVersion(); return 0; };
  VERBS['reconcile-summary'].run = reader;
  try {
    const res = await runHookCli(['reconcile-summary'], { input: '', cwd: sandbox, env: hookEnv() });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(ran, 1, 'the verb handler ran its process.env read');
  } finally {
    VERBS['reconcile-summary'].run = original;
  }
  await withRecorder(reader, async () => {
    await assert.rejects(
      runHookCli(['session-end'], { input: '{}', cwd: sandbox, env: hookEnv() }),
      /hook event read process\.env: .*CLAUDE_PLUGIN_ROOT@/,
    );
  });
  assert.strictEqual(ran, 2);
});

test('runHookCli requires cwd and env', async () => {
  await assert.rejects(runHookCli(['session-end'], { env: hookEnv() }), TypeError);
  await assert.rejects(runHookCli(['session-end'], { cwd: sandbox }), TypeError);
});
