'use strict';
// bin/timing-at-close.js (#5555 Task 3): the detached token pass CLI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCli, spawnCli } = require('../../helpers/run-cli');
const transcript = require('../../../plugin/bin/lib/timing/transcript');
const ctxLib = require('../../../plugin/bin/lib/hooks/context');
const { closeRunState } = require('../../../plugin/bin/lib/hooks/close-run-state');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'timing-at-close.js');
const SID = 'sess-5555-cli';

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-at-close-cli-')); }

function closedRun(root, name, worktree) {
  const runDir = path.join(root, name);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), [
    { skill: 'claude-tweaks:build', ts: '2026-11-16T10:00:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:test', ts: '2026-11-16T10:10:00.000Z', type: 'skill_invoked' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  ctxLib.writeRunState(runDir, { sessionId: SID, worktree, status: 'active' });
  assert.equal(closeRunState(runDir, { explicit: true }).status, 'closed');
  return runDir;
}

function writeTranscript(cfg, worktree) {
  const dir = path.join(cfg, 'projects', transcript.slugForCwd(worktree));
  fs.mkdirSync(dir, { recursive: true });
  const line = (id, ts, u) => JSON.stringify({
    timestamp: ts,
    message: { role: 'assistant', id, model: 'claude-test', content: [], usage: { input_tokens: u[0], output_tokens: u[1], cache_read_input_tokens: u[2], cache_creation_input_tokens: u[3] } },
  });
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), [
    line('m1', '2026-11-16T10:01:00.000Z', [10, 20, 30, 40]),
    // Inside the run's 10:00..10:10 event window (the writer clips to it).
    line('m2', '2026-11-16T10:09:00.000Z', [1, 2, 3, 4]),
  ].join('\n') + '\n');
}

const readTiming = (runDir) => JSON.parse(fs.readFileSync(path.join(runDir, 'timing.json'), 'utf8'));
const TOKENS = { input: 11, output: 22, cacheRead: 33, cacheCreate: 44 };
const pick = (t) => ({ input: t.input, output: t.output, cacheRead: t.cacheRead, cacheCreate: t.cacheCreate });

test('--run missing, a missing value, and an unknown flag exit 2 with usage on stderr', async () => {
  for (const argv of [[], ['--run'], ['--bogus'], ['--run', 'x', '--bogus']]) {
    const r = await runCli(CLI, argv);
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /usage: timing-at-close\.js --run <run-dir>/);
  }
});

test('--help prints usage and exits 0 (log-decision.js convention)', async () => {
  const r = await runCli(CLI, ['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /usage: timing-at-close\.js --run <run-dir>/);
  assert.equal(r.stderr, '');
});

test('a nonexistent run dir, and a file in place of one, exit 3', async () => {
  const root = tmpRoot();
  try {
    const missing = await runCli(CLI, ['--run', path.join(root, 'nope')], { env: {} });
    assert.equal(missing.code, 3);
    assert.match(missing.stderr, /run dir does not exist or is not a directory/);
    const file = path.join(root, 'a-file');
    fs.writeFileSync(file, 'x');
    assert.equal((await runCli(CLI, ['--run', file], { env: {} })).code, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a closed run with its transcript: exit 0, timing.json path on stdout, token totals written', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wt = path.join(root, 'wt');
    const runDir = closedRun(root, 'run', wt);
    writeTranscript(cfg, wt);
    const r = await runCli(CLI, ['--run', runDir], { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, path.join(runDir, 'timing.json') + '\n');
    assert.deepStrictEqual(pick(readTiming(runDir).totals.tokens), TOKENS);
    // A second pass keeps the file and still exits 0 with the path.
    const before = fs.readFileSync(path.join(runDir, 'timing.json'), 'utf8');
    const again = await runCli(CLI, ['--run', runDir], { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(again.code, 0);
    assert.equal(again.stdout, path.join(runDir, 'timing.json') + '\n');
    assert.equal(fs.readFileSync(path.join(runDir, 'timing.json'), 'utf8'), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a relative --run resolves against deps.cwd()', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wt = path.join(root, 'wt');
    const runDir = closedRun(root, 'run', wt);
    writeTranscript(cfg, wt);
    const r = await runCli(CLI, ['--run', 'run'], { env: { CLAUDE_CONFIG_DIR: cfg }, cwd: root });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, path.join(runDir, 'timing.json') + '\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a spec-N child of a multi-record run: exit 0, a one-line note, nothing written', async () => {
  const root = tmpRoot();
  try {
    const parent = closedRun(root, 'parent', path.join(root, 'wt'));
    const child = path.join(parent, 'spec-7');
    fs.mkdirSync(child);
    const r = await runCli(CLI, ['--run', child], { env: { CLAUDE_CONFIG_DIR: path.join(root, 'cfg') } });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^[^\n]*spec-N child[^\n]*\n$/);
    assert.equal(fs.existsSync(path.join(child, 'timing.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unwritable timing.json target exits 3', async () => {
  const root = tmpRoot();
  try {
    const wt = path.join(root, 'wt');
    const runDir = closedRun(root, 'run', wt);
    // A directory where the file belongs makes the write fail.
    fs.mkdirSync(path.join(runDir, 'timing.json'));
    const r = await runCli(CLI, ['--run', runDir], { env: { CLAUDE_CONFIG_DIR: path.join(root, 'cfg') } });
    assert.equal(r.code, 3);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /could not write timing\.json/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('script entry: a spawned child sets the exit code and prints the path', () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wt = path.join(root, 'wt');
    const runDir = closedRun(root, 'run', wt);
    writeTranscript(cfg, wt);
    const r = spawnCli(CLI, ['--run', runDir], { env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, path.join(runDir, 'timing.json') + '\n');
    assert.deepStrictEqual(pick(readTiming(runDir).totals.tokens), TOKENS);
    assert.equal(spawnCli(CLI, []).code, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
