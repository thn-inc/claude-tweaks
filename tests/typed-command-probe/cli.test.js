'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { run } = require('../../tools/typed-command-probe');
const { writePointer } = require('../../plugin/bin/lib/issues/typed-command');

const REPO = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO, 'tools', 'typed-command-probe.js');
const FIXTURES = path.join(REPO, 'tests', 'fixtures', 'typed-command');
const SESSION = 'test-session-0001';
const RECORD = 3;
const ID = { a: 'test-prompt-000a', g: 'test-prompt-000g' };
const NOW = '2026-11-16T02:20:00.000Z';
const SLUG = '-launch-dir';

const fixture = (c) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `captured-${c}.json`), 'utf8'));
const toJsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

// A temp root holding a config dir whose one transcript is `rows`, and a temp dir whose pointer
// names `promptId` for RECORD at `at` — the store a live session leaves behind.
function storeOf(t, rows, { promptId, at, pointer = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'typed-command-probe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = { root, configDir: path.join(root, 'config'), tmpdir: path.join(root, 'tmp') };
  fs.mkdirSync(store.tmpdir, { recursive: true });
  fs.mkdirSync(path.join(store.configDir, 'projects', SLUG), { recursive: true });
  fs.writeFileSync(path.join(store.configDir, 'projects', SLUG, `${SESSION}.jsonl`), toJsonl(rows));
  if (pointer) assert.equal(writePointer({ sessionId: SESSION, promptId, numbers: [RECORD], now: at, tmpdir: store.tmpdir }), true);
  return store;
}

function capture(over = {}) {
  const out = [];
  const err = [];
  return {
    out,
    err,
    deps: {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      env: {},
      cwd: () => REPO,
      now: () => new Date(NOW),
      ...over,
    },
  };
}

const argvFor = (store, extra = []) => ['--session', SESSION, '--record', String(RECORD), '--config-dir', store.configDir, '--tmpdir', store.tmpdir, ...extra];

function probe(store, over) {
  const c = capture(over);
  assert.equal(run(argvFor(store), c.deps), 0, c.err.join('\n'));
  assert.equal(c.out.length, 1, 'one JSON object');
  return { text: c.out[0], out: JSON.parse(c.out[0]) };
}

test('the captured (a) store prints the pointer entry, the candidate markers and typed', (t) => {
  const store = storeOf(t, fixture('a'), { promptId: ID.a, at: fixture('a')[0].timestamp });
  const { text, out } = probe(store);
  assert.deepEqual(Object.keys(out), ['pointer', 'candidates', 'answer']);
  assert.deepEqual(out.pointer, { ok: true, promptId: ID.a, at: fixture('a')[0].timestamp });
  assert.deepEqual(out.answer, { answer: 'typed', promptId: ID.a });
  assert.equal(out.candidates.length, 2, 'the command row and its skill expansion');
  assert.deepEqual(out.candidates[0], {
    promptId: ID.a, turnOrigin: 'human', originKind: 'human', promptSource: null, isMeta: null,
    keys: ['type', 'promptId', 'sessionId', 'timestamp', 'turnOrigin', 'origin', 'isSidechain', 'message'],
  });
  assert.equal(out.candidates[1].isMeta, true);
  assert.equal(out.candidates[1].originKind, null);
  assert.ok(!text.includes('<command-message>'), 'no row text');
  assert.ok(!text.includes('skill expansion elided'), 'no content-block text either');
});

test('a tool-result row of the same prompt id is not a candidate', (t) => {
  const toolResult = { ...fixture('a')[0], message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] } };
  const store = storeOf(t, [...fixture('a'), toolResult], { promptId: ID.a, at: fixture('a')[0].timestamp });
  assert.equal(probe(store).out.candidates.length, 2);
});

test('the captured (g) store prints not-typed with the scheduled row\'s markers, never its text', (t) => {
  const store = storeOf(t, fixture('g'), { promptId: ID.g, at: fixture('g')[0].timestamp });
  const { text, out } = probe(store);
  assert.deepEqual(out.answer, { answer: 'none', reason: 'not-typed' });
  assert.equal(out.candidates[0].turnOrigin, 'scheduled');
  assert.ok(out.candidates[0].keys.includes('scheduledTaskId'));
  assert.ok(out.candidates[0].keys.includes('wakeupSource'));
  assert.ok(!text.includes('<command-message>'));
  assert.ok(!text.includes('test-task'), 'a marker key is named, its value is not printed');
});

test('no pointer prints none no-pointer and no candidates', (t) => {
  const store = storeOf(t, fixture('a'), { pointer: false });
  const { out } = probe(store);
  assert.deepEqual(out, { pointer: { ok: false, reason: 'no-pointer' }, candidates: [], answer: { answer: 'none', reason: 'no-pointer' } });
});

test('the clock is the injected now: an hour later the (a) store prints expired', (t) => {
  const store = storeOf(t, fixture('a'), { promptId: ID.a, at: fixture('a')[0].timestamp });
  const { out } = probe(store, { now: () => new Date(Date.parse(NOW) + 3600e3) });
  assert.deepEqual(out.answer, { answer: 'none', reason: 'expired' });
  assert.equal(out.candidates.length, 2, 'the candidates still print');
});

test('--config-dir defaults to the environment\'s CLAUDE_CONFIG_DIR', (t) => {
  const store = storeOf(t, fixture('a'), { promptId: ID.a, at: fixture('a')[0].timestamp });
  const c = capture({ env: { CLAUDE_CONFIG_DIR: store.configDir } });
  assert.equal(run(['--session', SESSION, '--record', String(RECORD), '--tmpdir', store.tmpdir], c.deps), 0);
  assert.deepEqual(JSON.parse(c.out[0]).answer, { answer: 'typed', promptId: ID.a });
});

test('a malformed invocation exits 1 with the usage and prints nothing on stdout', () => {
  for (const argv of [
    [],
    ['--record', '3'],
    ['--session', SESSION],
    ['--session', SESSION, '--record', '0'],
    ['--session', SESSION, '--record', '3x'],
    ['--session', SESSION, '--record'],
    ['--session', '', '--record', '3'],
    ['--session', SESSION, '--record', '3', '--bogus'],
    ['--session', SESSION, '--record', '3', '--tmpdir'],
  ]) {
    const c = capture();
    assert.equal(run(argv, c.deps), 1, JSON.stringify(argv));
    assert.equal(c.out.length, 0, JSON.stringify(argv));
    assert.match(c.err.join('\n'), /usage: node tools\/typed-command-probe\.js/);
  }
  const help = capture();
  assert.equal(run(['--help'], help.deps), 0);
  assert.match(help.out[0], /^usage: node tools\/typed-command-probe\.js/);
});

test('the script itself exits 1 without --session and prints the (a) answer as JSON on stdout', (t) => {
  const missing = spawnSync(process.execPath, [CLI, '--record', '3'], { encoding: 'utf8', windowsHide: true });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /usage:/);

  // The script reads the real clock, so the rows and pointer are stamped now.
  const now = new Date().toISOString();
  const rows = fixture('a').map((r) => ({ ...r, timestamp: now }));
  const store = storeOf(t, rows, { promptId: ID.a, at: now });
  const ok = spawnSync(process.execPath, [CLI, ...argvFor(store)], { encoding: 'utf8', windowsHide: true });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout).answer, { answer: 'typed', promptId: ID.a });
  assert.ok(!ok.stdout.includes('<command-message>'));
});
