// tests/user-prompt-submit.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hookEnv, runHookCli } = require('./helpers/hook-event');

const { parseTypedSkill, skillExists } = require('../plugin/bin/lib/hooks/user-prompt-submit');

// #1130: never let an omitted cwd fall through to the spawned subprocess's
// own process.cwd() — see tests/skill-invocation.test.js for the incident.
const HOOK_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ups-sandbox-'));

// #5377: runs hooks.js in-process through runHookCli. hookEnv blanks PIPELINE_RUN_DIR so an ambient
// value in the invoking shell can't redirect fixture writes into a real run's events.jsonl —
// resolveRun checks this env var before the cwd scan.
async function runHook(args, { input = '', cwd = HOOK_SANDBOX, env = {} } = {}) {
  const { code, stdout } = await runHookCli(args, { input, cwd, env: hookEnv(env) });
  return { code, stdout };
}

// Project with one active run; sessionId optional (absent = unowned run).
function projectWithRun({ sessionId } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ups-'));
  const run = path.join(dir, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  const state = { status: 'active' };
  if (sessionId) state.sessionId = sessionId;
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify(state));
  return { dir, run };
}

// UserPromptSubmit payload: `prompt` is the raw typed line, unexpanded.
function promptPayload(prompt, overrides = {}) {
  return JSON.stringify({
    hook_event_name: 'UserPromptSubmit', prompt_id: 'p-1', permission_mode: 'default', prompt, ...overrides,
  });
}

function readEvents(run) {
  const p = path.join(run, 'events.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function submit(dir, prompt, sessionId = 'owner') {
  return runHook(['user-prompt-submit'], {
    input: promptPayload(prompt, { cwd: dir, session_id: sessionId }), cwd: dir,
  });
}

test('owned run: a typed /claude-tweaks:help appends one skill_invoked with source user', async () => {
  const { dir, run } = projectWithRun({ sessionId: 'owner' });
  const r = await submit(dir, '/claude-tweaks:help');
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '');
  const events = readEvents(run);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'skill_invoked');
  assert.strictEqual(events[0].skill, 'claude-tweaks:help');
  assert.strictEqual(events[0].source, 'user');
  assert.match(events[0].ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(!('attribution' in events[0]), 'owned run must not be tagged fallback');
});

test('arguments and later lines are ignored; the first line decides', async () => {
  const cases = [
    ['/claude-tweaks:build #123 --mode auto', 'claude-tweaks:build'],
    ['/claude-tweaks:capture\nan idea\n/claude-tweaks:build', 'claude-tweaks:capture'],
    ['/claude-tweaks:capture\r\nidea', 'claude-tweaks:capture'],
  ];
  for (const [prompt, skill] of cases) {
    const { dir, run } = projectWithRun({ sessionId: 'owner' });
    const r = await submit(dir, prompt);
    assert.strictEqual(r.code, 0);
    const events = readEvents(run);
    assert.strictEqual(events.length, 1, `${JSON.stringify(prompt)} must append exactly one event`);
    assert.strictEqual(events[0].skill, skill);
  }
  for (const prompt of ['please run /claude-tweaks:build', 'notes\n/claude-tweaks:build']) {
    const { dir, run } = projectWithRun({ sessionId: 'owner' });
    const r = await submit(dir, prompt);
    assert.strictEqual(r.code, 0);
    assert.strictEqual(readEvents(run).length, 0, `${JSON.stringify(prompt)} must append nothing`);
  }
});

test('bare, foreign and malformed forms leave nothing', async () => {
  const prompts = [
    '/build', '/help', '/superpowers:brainstorming', '/claude-tweaks:', '/Claude-Tweaks:help',
    ' /claude-tweaks:help', '/claude-tweaks:help/extra',
  ];
  for (const prompt of prompts) {
    const { dir, run } = projectWithRun({ sessionId: 'owner' });
    const r = await submit(dir, prompt);
    assert.strictEqual(r.code, 0);
    assert.strictEqual(fs.existsSync(path.join(run, 'events.jsonl')), false,
      `${JSON.stringify(prompt)} must not write events.jsonl`);
  }
});

test('an unknown skill name leaves nothing', async () => {
  const { dir, run } = projectWithRun({ sessionId: 'owner' });
  const r = await submit(dir, '/claude-tweaks:buil');
  assert.strictEqual(r.code, 0);
  assert.strictEqual(fs.existsSync(path.join(run, 'events.jsonl')), false);

  assert.strictEqual(parseTypedSkill('/claude-tweaks:buil x'), 'buil');
  assert.strictEqual(skillExists('buil'), false);
  assert.strictEqual(skillExists('help'), true);
  assert.strictEqual(skillExists('wrap-up'), true);
  assert.strictEqual(parseTypedSkill('/claude-tweaks:../help'), null);
});

test('unowned run: appends one event tagged attribution fallback', async () => {
  const { dir, run } = projectWithRun();
  const r = await submit(dir, '/claude-tweaks:help', 'some-session');
  assert.strictEqual(r.code, 0);
  const events = readEvents(run);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].attribution, 'fallback');
  assert.strictEqual(events[0].source, 'user');
});

test('no resolvable run: exits 0, writes nothing, pipelines dir absent', async () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ups-bare-'));
  const r = await submit(bare, '/claude-tweaks:help');
  assert.strictEqual(r.code, 0);
  assert.strictEqual(fs.existsSync(path.join(bare, '.claude-tweaks')), false,
    'no .claude-tweaks tree may be created');
});

test('foreign-owned run: exits 0, appends nothing', async () => {
  const { dir, run } = projectWithRun({ sessionId: 'other' });
  const r = await submit(dir, '/claude-tweaks:help', 'me');
  assert.strictEqual(r.code, 0);
  assert.strictEqual(readEvents(run).length, 0);
});

test('missing or non-string prompt, and garbage stdin, exit 0 with empty stdout', async () => {
  const { dir } = projectWithRun({ sessionId: 'owner' });
  for (const input of [
    promptPayload(undefined, { cwd: dir, session_id: 'owner' }),
    promptPayload(42, { cwd: dir, session_id: 'owner' }),
    '%%%not json%%%',
  ]) {
    const r = await runHook(['user-prompt-submit'], { input, cwd: dir });
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.stdout, '');
  }
});

// #5377: AC9.1 — an event call takes its cwd and env from the injected values, not from the runner's
// own process. No payload carries a `cwd`. The injected cwd is a fixture project that is not
// process.cwd(): only it lets the cwd scan find the project's run. PIPELINE_RUN_DIR in the injected
// env names the OLDER of two runs: only the injected env can pick it (a cwd scan picks the newer).
test('AC9.1: user-prompt-submit — an event call uses the injected cwd or env', async () => {
  const { dir, run } = projectWithRun({ sessionId: 'owner' });
  assert.notStrictEqual(fs.realpathSync(dir), fs.realpathSync(process.cwd()), 'precondition: the fixture project is not the runner cwd');
  const scanned = await runHook(['user-prompt-submit'], {
    input: promptPayload('/claude-tweaks:help', { session_id: 'owner' }), cwd: dir,
  });
  assert.strictEqual(scanned.code, 0);
  assert.strictEqual(readEvents(run).length, 1, 'the injected cwd found the project run');

  const pinnedProject = projectWithRun();
  const newer = path.join(pinnedProject.dir, '.claude-tweaks', 'pipelines', '2026-07-02T090000-spec-2');
  fs.mkdirSync(newer, { recursive: true });
  fs.writeFileSync(path.join(newer, 'run-state.json'), JSON.stringify({ status: 'active' }));
  const pinned = await runHook(['user-prompt-submit'], {
    input: promptPayload('/claude-tweaks:help', { session_id: 'some-session' }), cwd: pinnedProject.dir,
    env: { PIPELINE_RUN_DIR: pinnedProject.run },
  });
  assert.strictEqual(pinned.code, 0);
  assert.strictEqual(readEvents(pinnedProject.run).length, 1, 'the injected env picked the older run');
  assert.strictEqual(fs.existsSync(path.join(newer, 'events.jsonl')), false, 'the newer run, which a cwd scan would pick, got no event');
});
