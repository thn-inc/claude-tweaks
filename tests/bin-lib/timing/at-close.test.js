'use strict';
// at-close.js (#5555 Task 2): timing.json written when a run closes, token
// totals from the run's own transcript only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const transcript = require('../../../plugin/bin/lib/timing/transcript');
const ctxLib = require('../../../plugin/bin/lib/hooks/context');
const { closeRunState } = require('../../../plugin/bin/lib/hooks/close-run-state');
const atClose = require('../../../plugin/bin/lib/timing/at-close');

const { TIMING_BOUND_MS, ownTranscripts, writeTimingAtClose, writePhaseTimingSync, logTimingSkip, spawnTokenPass } = atClose;
const SID = 'sess-5555';

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-at-close-')); }

function writeEvents(runDir) {
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), [
    { skill: 'claude-tweaks:build', ts: '2026-11-16T10:00:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:test', ts: '2026-11-16T10:10:00.000Z', type: 'skill_invoked' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
}

// A run dir closed by the real closeRunState: worktree null, worktreeAtClose = worktree.
function closedRun(root, name, worktree, sessionId = SID) {
  const runDir = path.join(root, name);
  fs.mkdirSync(runDir, { recursive: true });
  writeEvents(runDir);
  ctxLib.writeRunState(runDir, { sessionId, worktree, status: 'active' });
  const closed = closeRunState(runDir, { explicit: true });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.writeOk, true);
  return runDir;
}

// Two assistant lines with usage under {cfg}/projects/{slug(worktree)}/{sid}.jsonl.
function writeTranscript(cfg, worktree, [a, b], sid = SID) {
  const dir = path.join(cfg, 'projects', transcript.slugForCwd(worktree));
  fs.mkdirSync(dir, { recursive: true });
  const line = (id, ts, u) => JSON.stringify({
    timestamp: ts,
    message: { role: 'assistant', id, model: 'claude-test', content: [], usage: { input_tokens: u[0], output_tokens: u[1], cache_read_input_tokens: u[2], cache_creation_input_tokens: u[3] } },
  });
  const file = path.join(dir, `${sid}.jsonl`);
  fs.writeFileSync(file, [line('m1', '2026-11-16T10:01:00.000Z', a), line('m2', '2026-11-16T10:11:00.000Z', b)].join('\n') + '\n');
  return file;
}

const sum = (a, b) => ({ input: a[0] + b[0], output: a[1] + b[1], cacheRead: a[2] + b[2], cacheCreate: a[3] + b[3] });
const pickTokens = (t) => ({ input: t.input, output: t.output, cacheRead: t.cacheRead, cacheCreate: t.cacheCreate });
const readTiming = (runDir) => JSON.parse(fs.readFileSync(path.join(runDir, 'timing.json'), 'utf8'));
function skipLines(runDir) {
  let text = '';
  try { text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch { return []; }
  return text.split('\n').filter((l) => l.startsWith('- SKIP '));
}
function assertPhaseRows(timing) {
  assert.ok(Array.isArray(timing.phases));
  assert.ok(timing.phases.some((p) => p.phase === 'build' && p.source === 'skill_invoked'));
}

const A = [10, 20, 30, 40];
const B = [1, 2, 3, 4];
const OTHER = [1000, 2000, 3000, 4000];

test('AC2.1: worktree null + worktreeAtClose set, transcripts under two slugs → totals from worktreeAtClose\'s slug', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const wtB = path.join(root, 'wt-b');
    const runDir = closedRun(root, 'run', wtA);
    const rs = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
    assert.equal(rs.worktree, null);
    assert.equal(rs.worktreeAtClose, wtA);
    writeTranscript(cfg, wtA, [A, B]);
    const other = writeTranscript(cfg, wtB, [OTHER, OTHER]);
    // AC2.2: the other slug's file is the newest candidate, so a newest-candidate pick goes red.
    const later = new Date(Date.now() + 60000);
    fs.utimesSync(other, later, later);
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg }, homeDir: () => { throw new Error('homeDir read'); } });
    assert.deepStrictEqual(r, { status: 'written', tokens: true, skip: null });
    const timing = readTiming(runDir);
    assert.deepStrictEqual(pickTokens(timing.totals.tokens), sum(A, B));
    assert.deepStrictEqual(skipLines(runDir), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC9.1: one session id, two run dirs bound to two worktree slugs → each run\'s totals come from its own slug only', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const wtB = path.join(root, 'wt-b');
    const runA = closedRun(root, 'run-a', wtA);
    const runB = closedRun(root, 'run-b', wtB);
    writeTranscript(cfg, wtA, [A, A]);
    writeTranscript(cfg, wtB, [B, B]);
    const env = { CLAUDE_CONFIG_DIR: cfg };
    assert.equal((await writeTimingAtClose(runA, { env })).status, 'written');
    assert.equal((await writeTimingAtClose(runB, { env })).status, 'written');
    assert.deepStrictEqual(pickTokens(readTiming(runA).totals.tokens), sum(A, A));
    assert.deepStrictEqual(pickTokens(readTiming(runB).totals.tokens), sum(B, B));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC9.2: a run whose slug has no transcript → phase rows, no totals.tokens, one SKIP line naming the reason', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const wtC = path.join(root, 'wt-c');
    writeTranscript(cfg, wtA, [A, B]);
    const runDir = closedRun(root, 'run-c', wtC);
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(r.status, 'written');
    assert.equal(r.tokens, false);
    const timing = readTiming(runDir);
    assertPhaseRows(timing);
    assert.equal(Object.hasOwn(timing.totals, 'tokens'), false);
    const skips = skipLines(runDir);
    assert.equal(skips.length, 1);
    assert.ok(skips[0].includes(`no ${SID}.jsonl under the slug of ${wtC}`), skips[0]);
    assert.match(skips[0], /condition: .* → fallback: timing\.json phase rows written without token totals/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC3.1: a timing.json with token totals is byte-identical after writeTimingAtClose', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const runDir = closedRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [OTHER, OTHER]);
    const file = path.join(runDir, 'timing.json');
    fs.writeFileSync(file, '{"phases":[],"totals":{"tokens":{"input":5,"output":0,"cacheRead":0,"cacheCreate":0}},"budget":{"tokens":1}}');
    const before = fs.readFileSync(file);
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.deepStrictEqual(r, { status: 'kept', tokens: true, skip: null });
    assert.ok(before.equals(fs.readFileSync(file)));
    const sync = writePhaseTimingSync(runDir);
    assert.equal(sync.status, 'kept');
    assert.ok(before.equals(fs.readFileSync(file)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC3.2: a timing.json with no token totals is replaced and its budget key survives', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const runDir = closedRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [A, B]);
    const budget = { tokens: { input: 99 }, minutes: 30 };
    fs.writeFileSync(path.join(runDir, 'timing.json'), JSON.stringify({ phases: [], totals: { minutes: 1, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 } }, budget }));
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(r.status, 'written');
    const timing = readTiming(runDir);
    assertPhaseRows(timing);
    assert.deepStrictEqual(timing.budget, budget);
    assert.deepStrictEqual(pickTokens(timing.totals.tokens), sum(A, B));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC10.1: run-state.json with no worktreeAtClose key and worktree null → phase rows, no token totals', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const runDir = path.join(root, 'run');
    fs.mkdirSync(runDir);
    writeEvents(runDir);
    // The older shape: written before closeRunState kept worktreeAtClose.
    fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ sessionId: SID, worktree: null, status: 'clean' }));
    writeTranscript(cfg, path.join(root, 'wt-a'), [A, B]);
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(r.status, 'written');
    assert.equal(r.tokens, false);
    const timing = readTiming(runDir);
    assertPhaseRows(timing);
    assert.equal(Object.hasOwn(timing.totals, 'tokens'), false);
    const skips = skipLines(runDir);
    assert.equal(skips.length, 1);
    assert.match(skips[0], /no worktree or worktreeAtClose in run-state\.json/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC12.1: writeTimingAtClose on a spec-N child writes nothing and leaves an existing spec-N timing.json byte-identical', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const parent = closedRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [A, B]);
    const spec1 = path.join(parent, 'spec-1');
    const spec2 = path.join(parent, 'spec-2');
    for (const d of [spec1, spec2]) { fs.mkdirSync(d); writeEvents(d); }
    const childFile = path.join(spec1, 'timing.json');
    fs.writeFileSync(childFile, '{"phases":[],"totals":{"minutes":0}}');
    const before = fs.readFileSync(childFile);
    const env = { CLAUDE_CONFIG_DIR: cfg };
    assert.deepStrictEqual(await writeTimingAtClose(spec1, { env }), { status: 'not-top-level', tokens: false, skip: null });
    assert.deepStrictEqual(await writeTimingAtClose(spec2, { env }), { status: 'not-top-level', tokens: false, skip: null });
    assert.equal(writePhaseTimingSync(spec2).status, 'not-top-level');
    assert.ok(before.equals(fs.readFileSync(childFile)));
    assert.equal(fs.existsSync(path.join(spec2, 'timing.json')), false);
    assert.equal(fs.existsSync(path.join(spec1, 'decisions.md')), false);
    assert.equal(fs.existsSync(path.join(spec2, 'decisions.md')), false);
    // The parent gets the one file.
    assert.equal((await writeTimingAtClose(parent, { env })).status, 'written');
    assert.deepStrictEqual(pickTokens(readTiming(parent).totals.tokens), sum(A, B));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deadline: readUsage never settles → resolves within boundMs + 1000, phase rows written, one SKIP naming the bound', async () => {
  const root = tmpRoot();
  const real = transcript.readUsage;
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const runDir = closedRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [A, B]);
    transcript.readUsage = () => new Promise(() => {});
    const t0 = Date.now();
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg }, boundMs: 200 });
    assert.ok(Date.now() - t0 < 1200, `took ${Date.now() - t0} ms`);
    assert.equal(r.status, 'written');
    assert.equal(r.tokens, false);
    const timing = readTiming(runDir);
    assertPhaseRows(timing);
    assert.equal(Object.hasOwn(timing.totals, 'tokens'), false);
    const skips = skipLines(runDir);
    assert.equal(skips.length, 1);
    assert.match(skips[0], /200 ms time bound/);
  } finally {
    transcript.readUsage = real;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TIMING_BOUND_MS is at most 60000', () => {
  assert.ok(TIMING_BOUND_MS <= 60000);
  assert.equal(TIMING_BOUND_MS, 60000);
});

test('Review Focus 1: an unparseable timing.json is rewritten', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const runDir = closedRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [A, B]);
    fs.writeFileSync(path.join(runDir, 'timing.json'), '{"totals": {"tokens":');
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(r.status, 'written');
    assert.deepStrictEqual(pickTokens(readTiming(runDir).totals.tokens), sum(A, B));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Review Focus 2: a run dir removed before the call → failed, directory still absent, no throw', async () => {
  const root = tmpRoot();
  try {
    const runDir = path.join(root, 'gone');
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: path.join(root, 'cfg') } });
    assert.equal(r.status, 'failed');
    assert.equal(fs.existsSync(runDir), false);
    assert.equal(writePhaseTimingSync(runDir).status, 'failed');
    assert.equal(fs.existsSync(runDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Review Focus 4: sessionId "../x" → the no-transcript SKIP, no wider lookup', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    writeTranscript(cfg, wtA, [A, B]);
    const runDir = closedRun(root, 'run', wtA, '../x');
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(r.status, 'written');
    assert.equal(r.tokens, false);
    assert.equal(Object.hasOwn(readTiming(runDir).totals, 'tokens'), false);
    const skips = skipLines(runDir);
    assert.equal(skips.length, 1);
    assert.ok(skips[0].includes(`no ../x.jsonl under the slug of ${wtA}`), skips[0]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Review Focus 5: events.jsonl is a directory → failed, one SKIP', async () => {
  const root = tmpRoot();
  try {
    const runDir = closedRun(root, 'run', path.join(root, 'wt-a'));
    fs.rmSync(path.join(runDir, 'events.jsonl'));
    fs.mkdirSync(path.join(runDir, 'events.jsonl'));
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: path.join(root, 'cfg') } });
    assert.equal(r.status, 'failed');
    assert.equal(fs.existsSync(path.join(runDir, 'timing.json')), false);
    const skips = skipLines(runDir);
    assert.equal(skips.length, 1);
    assert.match(skips[0], /events\.jsonl unreadable .* → fallback: no timing\.json written/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ownTranscripts: worktree wins over worktreeAtClose; homeDir is read only without CLAUDE_CONFIG_DIR', () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const wtB = path.join(root, 'wt-b');
    const fileA = writeTranscript(cfg, wtA, [A, B]);
    writeTranscript(cfg, wtB, [A, B]);
    const throwingHome = () => { throw new Error('homeDir read'); };
    const r = ownTranscripts({ sessionId: SID, worktree: wtA, worktreeAtClose: wtB }, { env: { CLAUDE_CONFIG_DIR: cfg }, homeDir: throwingHome });
    assert.deepStrictEqual(r, { paths: [fs.realpathSync(fileA)], reason: null });
    assert.equal(ownTranscripts({ worktree: wtA }, { env: { CLAUDE_CONFIG_DIR: cfg } }).reason, 'no sessionId in run-state.json');
    assert.equal(ownTranscripts(null, { env: { CLAUDE_CONFIG_DIR: cfg } }).reason, 'no worktree or worktreeAtClose in run-state.json');
    // No CLAUDE_CONFIG_DIR: {homeDir()}/.claude is the config dir.
    const viaHome = ownTranscripts({ sessionId: SID, worktreeAtClose: wtA }, { env: {}, homeDir: () => path.join(root, 'home') });
    assert.deepStrictEqual(viaHome.paths, []);
    fs.cpSync(cfg, path.join(root, 'home', '.claude'), { recursive: true });
    const viaHome2 = ownTranscripts({ sessionId: SID, worktreeAtClose: wtA }, { env: {}, homeDir: () => path.join(root, 'home') });
    assert.equal(viaHome2.paths.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('logTimingSkip never throws and writes nothing for a missing run dir', () => {
  const root = tmpRoot();
  try {
    const gone = path.join(root, 'gone');
    assert.doesNotThrow(() => logTimingSkip(gone, 'condition: x → fallback: y'));
    assert.equal(fs.existsSync(gone), false);
    logTimingSkip(root, 'condition: x → fallback: y');
    const skips = skipLines(root);
    assert.equal(skips.length, 1);
    assert.match(skips[0], /^- SKIP \d{2}:\d{2}:\d{2} — timing at close: condition: x → fallback: y\./);
    assert.match(fs.readFileSync(path.join(root, 'decisions.md'), 'utf8'), /^## \/wrap-up$/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('spawnTokenPass with child_process.spawn stubbed to throw → spawned false and one SKIP', () => {
  const root = tmpRoot();
  const real = childProcess.spawn;
  try {
    childProcess.spawn = () => { throw new Error('EAGAIN stub'); };
    const r = spawnTokenPass(root);
    assert.equal(r.spawned, false);
    assert.match(r.reason, /EAGAIN stub/);
    const skips = skipLines(root);
    assert.equal(skips.length, 1);
    assert.match(skips[0], /background token pass could not start \(EAGAIN stub\) → fallback: timing\.json keeps its phase rows without token totals/);
  } finally {
    childProcess.spawn = real;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('spawnTokenPass with spawn stubbed to record → argv ends with ["--run", runDir] and options carry detached, windowsHide', () => {
  const root = tmpRoot();
  const real = childProcess.spawn;
  const calls = [];
  let unrefed = false;
  let errorListener = null;
  try {
    childProcess.spawn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { on: (ev, fn) => { if (ev === 'error') errorListener = fn; }, unref: () => { unrefed = true; } };
    };
    const r = spawnTokenPass(root);
    assert.equal(r.spawned, true);
    assert.equal(calls.length, 1);
    const { cmd, args, opts } = calls[0];
    assert.equal(cmd, process.execPath);
    assert.equal(args[0], path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'timing-at-close.js'));
    assert.deepStrictEqual(args.slice(-2), ['--run', root]);
    assert.equal(opts.detached, true);
    assert.equal(opts.windowsHide, true);
    assert.equal(opts.stdio, 'ignore');
    assert.equal(typeof errorListener, 'function');
    assert.doesNotThrow(() => errorListener(new Error('late')));
    assert.equal(unrefed, true);
    assert.deepStrictEqual(skipLines(root), []);
  } finally {
    childProcess.spawn = real;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writePhaseTimingSync never calls readUsage or locateTranscripts', () => {
  const root = tmpRoot();
  const realRead = transcript.readUsage;
  const realLocate = transcript.locateTranscripts;
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const runDir = closedRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [A, B]);
    transcript.readUsage = () => { throw new Error('readUsage called'); };
    transcript.locateTranscripts = () => { throw new Error('locateTranscripts called'); };
    const r = writePhaseTimingSync(runDir);
    assert.deepStrictEqual(r, { status: 'written', skip: null });
    const timing = readTiming(runDir);
    assertPhaseRows(timing);
    assert.equal(Object.hasOwn(timing.totals, 'tokens'), false);
    assert.deepStrictEqual(skipLines(runDir), []);
  } finally {
    transcript.readUsage = realRead;
    transcript.locateTranscripts = realLocate;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
