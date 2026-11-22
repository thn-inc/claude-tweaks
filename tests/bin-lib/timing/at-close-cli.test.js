'use strict';
// bin/timing-at-close.js (#5555 Task 3): the detached token pass CLI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runCli, spawnCli } = require('../../helpers/run-cli');
const { gitRepo, linkedWorktreeOf } = require('../../helpers/git-fixtures');
const { readTiming, pickTokens } = require('../../helpers/close-timing');
const transcript = require('../../../plugin/bin/lib/timing/transcript');
const stepYield = require('../../../plugin/bin/lib/timing/step-yield');
const ctxLib = require('../../../plugin/bin/lib/hooks/context');
const { closeRunState } = require('../../../plugin/bin/lib/hooks/close-run-state');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'timing-at-close.js');
const SID = 'sess-5555-cli';

// A real git repo: the CLI refuses a run dir that is not anchored under a main checkout and sitting
// under its .claude-tweaks/pipelines/ (#5830), so every run dir here lives there and the CLI is run
// with that repo as its cwd.
function tmpRoot() { return gitRepo(); }

function closedRun(root, name, worktree) {
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', name);
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
    // Inside the run's 10:00..10:10 events, so inside its lifetime (the writer clips to it).
    line('m2', '2026-11-16T10:09:00.000Z', [1, 2, 3, 4]),
  ].join('\n') + '\n');
}

const TOKENS = { input: 11, output: 22, cacheRead: 33, cacheCreate: 44 };
const pick = pickTokens;

test('--run missing, a missing value, and an unknown flag exit 2 with usage on stderr', async () => {
  for (const argv of [[], ['--run'], ['--bogus'], ['--run', 'x', '--bogus']]) {
    const r = await runCli(CLI, argv);
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /usage: timing-at-close\.js --run <run-dir>/);
  }
});

test('--run --help: a flag in place of the run dir is a missing value, exit 2', async () => {
  for (const argv of [['--run', '--help'], ['--run', '--bogus']]) {
    const r = await runCli(CLI, argv, { env: {} });
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /--run requires a <run-dir> argument/);
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
    const r = await runCli(CLI, ['--run', runDir], { env: { CLAUDE_CONFIG_DIR: cfg }, cwd: root });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, path.join(runDir, 'timing.json') + '\n');
    assert.deepStrictEqual(pick(readTiming(runDir).totals.tokens), TOKENS);
    // A second pass keeps the file and still exits 0 with the path.
    const before = fs.readFileSync(path.join(runDir, 'timing.json'), 'utf8');
    const again = await runCli(CLI, ['--run', runDir], { env: { CLAUDE_CONFIG_DIR: cfg }, cwd: root });
    assert.equal(again.code, 0);
    assert.equal(again.stdout, path.join(runDir, 'timing.json') + '\n');
    assert.equal(fs.readFileSync(path.join(runDir, 'timing.json'), 'utf8'), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC6.1: the token pass rewrites step-yield.json whole beside the timing.json it wrote', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wt = path.join(root, 'wt');
    const runDir = closedRun(root, 'run', wt);
    writeTranscript(cfg, wt);
    const file = path.join(runDir, 'step-yield.json');
    fs.writeFileSync(file, '{"stale":true}');
    const r = await runCli(CLI, ['--run', runDir], { env: { CLAUDE_CONFIG_DIR: cfg }, cwd: root });
    assert.equal(r.code, 0);
    const y = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(Object.hasOwn(y, 'stale'), false);
    assert.equal(y.schemaVersion, stepYield.SCHEMA_VERSION);
    assert.ok(y.steps.length > 0);
    // A second pass keeps timing.json and still leaves a whole yield.
    fs.writeFileSync(file, '{"stale":true');
    assert.equal((await runCli(CLI, ['--run', runDir], { env: { CLAUDE_CONFIG_DIR: cfg }, cwd: root })).code, 0);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).schemaVersion, stepYield.SCHEMA_VERSION);
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
    const r = await runCli(CLI, ['--run', path.join('.claude-tweaks', 'pipelines', 'run')], { env: { CLAUDE_CONFIG_DIR: cfg }, cwd: root });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, path.join(runDir, 'timing.json') + '\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a worktree-local shadow of the run dir exits 3 before any write; the main checkout\'s own dir still gets its file', async () => {
  const main = tmpRoot();
  try {
    const wt = linkedWorktreeOf(main);
    const real = closedRun(main, 'run', path.join(main, 'wt'));
    // The shadow: a copy of the run dir inside the linked worktree (a bare relative path built from its cwd does this, [IL-127]).
    const shadow = path.join(wt, 'run');
    fs.cpSync(real, shadow, { recursive: true });
    const refused = await runCli(CLI, ['--run', shadow], { env: { CLAUDE_CONFIG_DIR: path.join(main, 'cfg') }, cwd: wt });
    assert.equal(refused.code, 3);
    assert.equal(refused.stdout, '');
    assert.match(refused.stderr, /not anchored under the main checkout/);
    assert.equal(fs.existsSync(path.join(shadow, 'timing.json')), false);
    assert.equal(fs.existsSync(path.join(shadow, '.timing.lock')), false);
    // The same call from the worktree against the main checkout's own run dir is allowed.
    const ok = await runCli(CLI, ['--run', real], { env: { CLAUDE_CONFIG_DIR: path.join(main, 'cfg') }, cwd: wt });
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(fs.existsSync(path.join(real, 'timing.json')), true);
  } finally {
    fs.rmSync(main, { recursive: true, force: true });
  }
});

test('a spec-N child of a multi-record run: exit 0, a one-line note, nothing written', async () => {
  const root = tmpRoot();
  try {
    const parent = closedRun(root, 'parent', path.join(root, 'wt'));
    const child = path.join(parent, 'spec-7');
    fs.mkdirSync(child);
    const r = await runCli(CLI, ['--run', child], { env: { CLAUDE_CONFIG_DIR: path.join(root, 'cfg') }, cwd: root });
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
    const r = await runCli(CLI, ['--run', runDir], { env: { CLAUDE_CONFIG_DIR: path.join(root, 'cfg') }, cwd: root });
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
    const r = spawnCli(CLI, ['--run', runDir], { env: { ...process.env, CLAUDE_CONFIG_DIR: cfg }, cwd: root });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, path.join(runDir, 'timing.json') + '\n');
    assert.deepStrictEqual(pick(readTiming(runDir).totals.tokens), TOKENS);
    assert.equal(spawnCli(CLI, []).code, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
