// tests/user-prompt-submit.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { hookEnv, runHookCli } = require('./helpers/hook-event');

const { parseTypedSkill, skillExists } = require('../plugin/bin/lib/hooks/user-prompt-submit');

// #1130: never let an omitted cwd fall through to the spawned subprocess's
// own process.cwd() — see tests/skill-invocation.test.js for the incident.
const HOOK_SANDBOX = scratchDir('ct-ups-sandbox-');

// #5377: runs hooks.js in-process through runHookCli. hookEnv blanks PIPELINE_RUN_DIR so an ambient
// value in the invoking shell can't redirect fixture writes into a real run's events.jsonl —
// resolveRun checks this env var before the cwd scan.
async function runHook(args, { input = '', cwd = HOOK_SANDBOX, env = {} } = {}) {
  const { code, stdout } = await runHookCli(args, { input, cwd, env: hookEnv(env) });
  return { code, stdout };
}

// Project with one active run; sessionId optional (absent = unowned run).
function projectWithRun({ sessionId } = {}) {
  const dir = scratchDir('ct-ups-');
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
  const bare = scratchDir('ct-ups-bare-');
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

// ---- #5584: the second writer — typed dispatch prompts into the pointer file ----
const upsModule = require('../plugin/bin/lib/hooks/user-prompt-submit');
const { sessionTmpRoot } = require('../plugin/bin/lib/session-tmp');

const SID = 'test-session-0001';
const NOW = new Date('2026-11-16T03:00:00.000Z');
const FIXTURES = path.join(__dirname, 'fixtures', 'typed-command');

function tmpRoot() {
  return scratchDir('ct-ups-tmp-');
}

function pointerFile(tmpdir, sessionId = SID) {
  return path.join(sessionTmpRoot(sessionId, { tmpdir }), 'dispatch-prompts.json');
}

function readPointerJson(tmpdir, sessionId = SID) {
  const p = pointerFile(tmpdir, sessionId);
  try { fs.lstatSync(p); } catch { return null; }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function dispatchInput(prompt, overrides = {}) {
  return { hook_event_name: 'UserPromptSubmit', session_id: SID, prompt_id: 'p-1', prompt, ...overrides };
}

function entries(numbers, promptId, at = NOW.toISOString()) {
  return Object.fromEntries(numbers.map((n) => [String(n), { promptId, at }]));
}

// The real dispatcher, in-process (#5377), with the passed env's temp dir pointed at a fixture dir:
// the pointer lands there only when the writer takes its temp dir from the context's env. Asserts
// the never-break contract.
async function submitDispatch(tmpdir, payload, cwd = HOOK_SANDBOX) {
  const r = await runHook(['user-prompt-submit'], {
    // win32's os.tmpdir() reads TEMP, then TMP; POSIX reads TMPDIR first.
    input: JSON.stringify({ cwd, ...payload }), cwd, env: { TMPDIR: tmpdir, TEMP: tmpdir, TMP: tmpdir },
  });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '');
  return r;
}

test('AC2.1: the three writing lines record the named numbers with the payload prompt id', () => {
  const cases = [
    ['/claude-tweaks:dispatch #12', [12]],
    ['/claude-tweaks:dispatch #12,#13', [12, 13]],
    ['/claude-tweaks:dispatch resume #12', [12]],
  ];
  for (const [prompt, numbers] of cases) {
    const tmpdir = tmpRoot();
    assert.strictEqual(upsModule.recordTypedDispatch(dispatchInput(prompt), { now: NOW, tmpdir }), true, prompt);
    assert.deepStrictEqual(readPointerJson(tmpdir), { v: 1, sessionId: SID, records: entries(numbers, 'p-1') }, prompt);
  }
});

test('AC2.1: the real dispatcher writes the three lines with empty stdout and exit 0', async () => {
  const cases = [
    ['/claude-tweaks:dispatch #12', ['12']],
    ['/claude-tweaks:dispatch #12,#13', ['12', '13']],
    ['/claude-tweaks:dispatch resume #12', ['12']],
  ];
  for (const [prompt, keys] of cases) {
    const tmpdir = tmpRoot();
    await submitDispatch(tmpdir, dispatchInput(prompt, { prompt_id: 'p-hook' }));
    const ptr = readPointerJson(tmpdir);
    assert.ok(ptr, `${prompt} must write the pointer`);
    assert.strictEqual(ptr.sessionId, SID);
    assert.deepStrictEqual(Object.keys(ptr.records).sort(), keys, prompt);
    for (const k of keys) {
      assert.strictEqual(ptr.records[k].promptId, 'p-hook');
      assert.match(ptr.records[k].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  }
});

test('AC2.2: the eleven non-writing prompts and payloads write nothing', async () => {
  const without = (key) => {
    const i = dispatchInput('/claude-tweaks:dispatch #12');
    delete i[key];
    return i;
  };
  const cases = [
    ['bare command', dispatchInput('/claude-tweaks:dispatch')],
    ['next', dispatchInput('/claude-tweaks:dispatch next')],
    ['--budget 2', dispatchInput('/claude-tweaks:dispatch --budget 2')],
    ['#12 --budget 2', dispatchInput('/claude-tweaks:dispatch #12 --budget 2')],
    ['close-out #12', dispatchInput('/claude-tweaks:dispatch close-out #12')],
    ['leading space', dispatchInput(' /claude-tweaks:dispatch #12')],
    ['command on the second line', dispatchInput('please build\n/claude-tweaks:dispatch #12')],
    ['no prompt_id', without('prompt_id')],
    ['empty prompt_id', dispatchInput('/claude-tweaks:dispatch #12', { prompt_id: '' })],
    ['prompt_id with a slash', dispatchInput('/claude-tweaks:dispatch #12', { prompt_id: 'p/1' })],
    ['no session_id', without('session_id')],
  ];
  assert.strictEqual(cases.length, 11);
  for (const [label, input] of cases) {
    const tmpdir = tmpRoot();
    assert.strictEqual(upsModule.recordTypedDispatch(input, { now: NOW, tmpdir }), false, label);
    assert.deepStrictEqual(fs.readdirSync(tmpdir), [], `${label} must write nothing`);
    await submitDispatch(tmpdir, input);
    assert.deepStrictEqual(fs.readdirSync(tmpdir).filter((n) => n.startsWith('ct-session-')), [],
      `${label} must write nothing through the dispatcher`);
  }
});

test('AC2.3: a project with no run directory still writes the pointer', async () => {
  const bare = scratchDir('ct-ups-bare-');
  const tmpdir = tmpRoot();
  await submitDispatch(tmpdir, dispatchInput('/claude-tweaks:dispatch #12'), bare);
  assert.strictEqual(readPointerJson(tmpdir).records['12'].promptId, 'p-1');
  assert.strictEqual(fs.existsSync(path.join(bare, '.claude-tweaks')), false);
});

test('AC2.3: an owned run gets both the skill_invoked event and the pointer', async () => {
  const { dir, run } = projectWithRun({ sessionId: SID });
  const tmpdir = tmpRoot();
  await submitDispatch(tmpdir, dispatchInput('/claude-tweaks:dispatch #12'), dir);
  assert.strictEqual(readPointerJson(tmpdir).records['12'].promptId, 'p-1');
  const events = readEvents(run);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].skill, 'claude-tweaks:dispatch');
});

test('AC2.4: an unwritable temp directory throws nothing and the dispatcher exits 0 silently', async () => {
  const tmpdir = tmpRoot();
  // A file where the session root directory should be.
  fs.writeFileSync(sessionTmpRoot(SID, { tmpdir }), 'not a directory');
  const input = dispatchInput('/claude-tweaks:dispatch #12');
  assert.strictEqual(upsModule.recordTypedDispatch(input, { now: NOW, tmpdir }), false);
  await submitDispatch(tmpdir, input);
  assert.strictEqual(fs.readFileSync(sessionTmpRoot(SID, { tmpdir }), 'utf8'), 'not a directory');
});

test('AC2.4: a throwing writer never stops run or the skill_invoked writer', () => {
  const { run } = projectWithRun({ sessionId: SID });
  const input = {
    prompt: '/claude-tweaks:dispatch #12',
    get session_id() { throw new Error('boom'); },
  };
  const tmpdir = tmpRoot();
  // #5377: a hand-built context carries env, or requireEnv throws.
  assert.deepStrictEqual(upsModule.run({ input, ownedRun: { dir: run }, env: { TMPDIR: tmpdir, TEMP: tmpdir, TMP: tmpdir } }), {});
  assert.deepStrictEqual(fs.readdirSync(tmpdir), []);
  const events = readEvents(run);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].skill, 'claude-tweaks:dispatch');
});

test('AC2.5: payloads built from the captured (g) and (h) rows write the same entry shape (a) writes', () => {
  for (const letter of ['a', 'g', 'h']) {
    const rows = JSON.parse(fs.readFileSync(path.join(FIXTURES, `captured-${letter}.json`), 'utf8'));
    const { promptId, sessionId } = rows[0];
    const tmpdir = tmpRoot();
    const input = dispatchInput('/claude-tweaks:dispatch #3', { session_id: sessionId, prompt_id: promptId });
    assert.strictEqual(upsModule.recordTypedDispatch(input, { now: NOW, tmpdir }), true, letter);
    assert.deepStrictEqual(readPointerJson(tmpdir, sessionId),
      { v: 1, sessionId, records: entries([3], promptId) }, letter);
  }
});

test('AC2.6: a non-string prompt writes nothing', () => {
  const prompts = [undefined, null, 42, ['/claude-tweaks:dispatch #12'], { toString: () => '/claude-tweaks:dispatch #12' }];
  for (const prompt of prompts) {
    const tmpdir = tmpRoot();
    assert.strictEqual(upsModule.recordTypedDispatch(dispatchInput(prompt), { now: NOW, tmpdir }), false);
    assert.deepStrictEqual(fs.readdirSync(tmpdir), []);
  }
  assert.strictEqual(upsModule.recordTypedDispatch(null, { now: NOW, tmpdir: tmpRoot() }), false);
});

test('AC2.7: only a dispatch first line loads build-authority.js, typed-command.js or grouping.js', () => {
  const tmpdir = tmpRoot();
  const hookPath = path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'user-prompt-submit.js');
  const script = `
    const path = require('path');
    const ups = require(${JSON.stringify(hookPath)});
    const prompt = require('fs').readFileSync(0, 'utf8');
    const out = ups.run({ input: { prompt, session_id: 'probe-session', prompt_id: 'p-1' }, env: process.env });
    const keys = Object.keys(require.cache);
    const has = (file) => keys.some((k) => k.endsWith(path.join('issues', file)));
    process.stdout.write(JSON.stringify({ out,
      ba: has('build-authority.js'), tc: has('typed-command.js'), gr: has('grouping.js') }));
  `;
  // real process: the subject is which modules a fresh process's require.cache holds after one run call.
  const probe = (prompt) => JSON.parse(execFileSync('node', ['-e', script], {
    input: prompt, encoding: 'utf8', env: { ...process.env, TMPDIR: tmpdir, TEMP: tmpdir, TMP: tmpdir }, windowsHide: true,
  }));
  const huge = `${'x'.repeat(2 * 1024 * 1024)}\n/claude-tweaks:dispatch #12`;
  for (const prompt of ['/claude-tweaks:help', '/claude-tweaks:dispatchx #12', huge]) {
    assert.deepStrictEqual(probe(prompt), { out: {}, ba: false, tc: false, gr: false }, prompt.slice(0, 40));
  }
  assert.deepStrictEqual(fs.readdirSync(tmpdir), []);
  // Control: the dispatch line does load them, so the absences above are real.
  assert.deepStrictEqual(probe('/claude-tweaks:dispatch #12'), { out: {}, ba: true, tc: true, gr: true });
  assert.strictEqual(readPointerJson(tmpdir, 'probe-session').records['12'].promptId, 'p-1');
});
