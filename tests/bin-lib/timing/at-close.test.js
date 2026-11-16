'use strict';
// at-close.js (#5555 Task 2): timing.json written when a run closes, token
// totals from the run's own transcript only.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const transcript = require('../../../plugin/bin/lib/timing/transcript');
const ctxLib = require('../../../plugin/bin/lib/hooks/context');
const { closeRunState } = require('../../../plugin/bin/lib/hooks/close-run-state');
const atClose = require('../../../plugin/bin/lib/timing/at-close');
const { runCli } = require('../../helpers/run-cli');
const TIMING_CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'timing-at-close.js');

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
  // Both rows inside writeEvents' 10:00..10:10 window (the at-close writer clips to it).
  fs.writeFileSync(file, [line('m1', '2026-11-16T10:01:00.000Z', a), line('m2', '2026-11-16T10:09:00.000Z', b)].join('\n') + '\n');
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

test('deadline: readUsage never settles → resolves at boundMs, phase rows written, one SKIP naming the bound', async () => {
  const root = tmpRoot();
  const real = transcript.readUsage;
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const runDir = closedRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [A, B]);
    let entered = false;
    transcript.readUsage = () => { entered = true; return new Promise(() => {}); };
    // Mock timers drive the bound (no wall-clock budget): pending just before it, settled at it.
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    let r;
    try {
      let settled = false;
      const p = writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg }, boundMs: 200 }).finally(() => { settled = true; });
      for (let i = 0; i < 5000 && !entered; i++) await new Promise((res) => setImmediate(res));
      assert.equal(entered, true, 'the hung reader was never reached');
      mock.timers.tick(199);
      for (let i = 0; i < 20; i++) await new Promise((res) => setImmediate(res));
      assert.equal(settled, false, 'writeTimingAtClose returned before its bound');
      mock.timers.tick(1);
      r = await p;
    } finally {
      mock.timers.reset();
    }
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

test('a closed run reads its transcript against worktreeAtClose: a Read under the worktree is classed worktree-relative', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    // A worktree whose absolute path holds a skills/ segment: read whole, every
    // file in it looks like a procedure file; worktree-relative, notes.md does not.
    const wt = path.join(root, 'skills', 'wt-a');
    const runDir = closedRun(root, 'run', wt);
    const dir = path.join(cfg, 'projects', transcript.slugForCwd(wt));
    fs.mkdirSync(dir, { recursive: true });
    const lines = [
      { timestamp: '2026-11-16T10:01:00.000Z', message: { role: 'assistant', id: 'm1', model: 'claude-test', usage: { input_tokens: 5, output_tokens: 1 }, content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: path.join(wt, 'notes.md') } }] } },
      { timestamp: '2026-11-16T10:01:05.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'hello notes' }] } },
    ];
    fs.writeFileSync(path.join(dir, `${SID}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(r.status, 'written');
    const totals = readTiming(runDir).totals;
    assert.equal(totals.procedureBytes, 0);
    assert.equal(totals.turnClasses.read, 1);
    assert.equal(totals.turnClasses.procedure, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an own transcript with no usage rows → zero tokens written and one SKIP naming it', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const runDir = closedRun(root, 'run', wtA);
    const dir = path.join(cfg, 'projects', transcript.slugForCwd(wtA));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${SID}.jsonl`), '');
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(r.status, 'written');
    assert.equal(r.tokens, false);
    assertPhaseRows(readTiming(runDir));
    const skips = skipLines(runDir);
    assert.equal(skips.length, 1);
    assert.match(skips[0], /condition: own transcript yielded no token totals \(tokens: transcript had no usage rows .*\) → fallback: timing\.json phase rows written without token totals/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('timing.json is a directory → failed and exactly one write-failed SKIP, on both the token and the tokens:false path', async () => {
  const root = tmpRoot();
  try {
    const runDir = closedRun(root, 'run', path.join(root, 'wt-a'));
    fs.mkdirSync(path.join(runDir, 'timing.json'));
    const env = { CLAUDE_CONFIG_DIR: path.join(root, 'cfg') };
    const r = await writeTimingAtClose(runDir, { env });
    assert.equal(r.status, 'failed');
    assert.equal(r.tokens, false);
    let skips = skipLines(runDir);
    assert.equal(skips.length, 1);
    assert.match(skips[0], /condition: timing\.json write failed \(.*\) → fallback: no timing\.json written/);
    const r2 = await writeTimingAtClose(runDir, { tokens: false, env });
    assert.equal(r2.status, 'failed');
    assert.equal(r2.tokens, false);
    skips = skipLines(runDir);
    assert.equal(skips.length, 2);
    assert.match(skips[1], /timing\.json write failed/);
    assert.ok(fs.statSync(path.join(runDir, 'timing.json')).isDirectory());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeTimingAtClose({ tokens: false }) writes phase rows and reads no transcript', async () => {
  const root = tmpRoot();
  const realRead = transcript.readUsage;
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const runDir = closedRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [A, B]);
    transcript.readUsage = () => { throw new Error('readUsage called'); };
    const r = await writeTimingAtClose(runDir, { tokens: false, env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.deepStrictEqual(r, { status: 'written', tokens: false, skip: null });
    const timing = readTiming(runDir);
    assertPhaseRows(timing);
    assert.equal(Object.hasOwn(timing.totals, 'tokens'), false);
  } finally {
    transcript.readUsage = realRead;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a token-totals timing.json written mid-call by a concurrent pass is kept byte-identical', async () => {
  const root = tmpRoot();
  const realRead = transcript.readUsage;
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const runDir = closedRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [A, B]);
    const file = path.join(runDir, 'timing.json');
    const concurrent = '{"phases":[],"totals":{"tokens":{"input":7,"output":1,"cacheRead":0,"cacheCreate":0}}}\n';
    // The derivation step: a concurrent token pass lands its file, and this call's read yields nothing.
    transcript.readUsage = async () => { fs.writeFileSync(file, concurrent); return []; };
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.deepStrictEqual(r, { status: 'kept', tokens: true, skip: null });
    assert.equal(fs.readFileSync(file, 'utf8'), concurrent);
    assert.deepStrictEqual(skipLines(runDir), []);
  } finally {
    transcript.readUsage = realRead;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Two runs of one session and worktree, closed one after the other: run-1 created
// 09:55, events 10:00..10:10, closed 10:30; run-2 created 10:55, events 11:00..11:10,
// closed 11:30. updatedAt is set as the close's own writeRunState stamps it.
function sequentialRuns(root) {
  const wtA = path.join(root, 'wt-a');
  const mk = (id, [e1, e2], closedAt) => {
    const runDir = closedRun(root, id, wtA);
    fs.writeFileSync(path.join(runDir, 'events.jsonl'), [
      { skill: 'claude-tweaks:build', ts: e1, type: 'skill_invoked' },
      { skill: 'claude-tweaks:wrap-up', ts: e2, type: 'skill_invoked' },
    ].map((e) => JSON.stringify(e)).join('\n') + '\n');
    const rs = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
    fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ ...rs, updatedAt: closedAt }, null, 2) + '\n');
    return runDir;
  };
  const first = mk('2020-01-06T095500-record-1', ['2020-01-06T10:00:00.000Z', '2020-01-06T10:10:00.000Z'], '2020-01-06T10:30:00.000Z');
  const second = mk('2020-01-06T105500-record-2', ['2020-01-06T11:00:00.000Z', '2020-01-06T11:10:00.000Z'], '2020-01-06T11:30:00.000Z');
  return { wtA, first, second };
}

// One usage row per [stamp, usage] under {cfg}/projects/{slug(wt)}/{SID}.jsonl.
function writeRows(cfg, wt, rows) {
  const dir = path.join(cfg, 'projects', transcript.slugForCwd(wt));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), rows.map(([ts, u], i) => JSON.stringify({
    timestamp: ts,
    message: { role: 'assistant', id: `m${i}`, model: 'claude-test', content: [], usage: { input_tokens: u[0], output_tokens: u[1], cache_read_input_tokens: u[2], cache_creation_input_tokens: u[3] } },
  })).join('\n') + '\n');
}

test('item 3: each run counts its own calls from creation through close — after its last event included, another run\'s excluded — and two sequential runs get disjoint totals', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const { wtA, first, second } = sequentialRuns(root);
    const C = [100, 0, 0, 0];
    const D = [200, 0, 0, 0];
    writeRows(cfg, wtA, [
      ['2020-01-06T09:50:00.000Z', OTHER], // before run-1 was created: an earlier run's call
      ['2020-01-06T10:05:00.000Z', A],
      ['2020-01-06T10:20:00.000Z', C], // after run-1's last event, before its close
      ['2020-01-06T11:05:00.000Z', B],
      ['2020-01-06T11:20:00.000Z', D], // after run-2's last event, before its close
    ]);
    const env = { CLAUDE_CONFIG_DIR: cfg };
    assert.equal((await writeTimingAtClose(first, { env })).status, 'written');
    assert.equal((await writeTimingAtClose(second, { env })).status, 'written');
    assert.deepStrictEqual(pickTokens(readTiming(first).totals.tokens), sum(A, C));
    assert.deepStrictEqual(pickTokens(readTiming(second).totals.tokens), sum(B, D));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('item 3: the window ends at run-state updatedAt (the close\'s own write), not at the moment the pass runs', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const { wtA, second } = sequentialRuns(root);
    // A call after run-2's close (11:30) but long before this pass runs (the real now).
    writeRows(cfg, wtA, [['2020-01-06T11:05:00.000Z', A], ['2020-01-06T11:45:00.000Z', OTHER]]);
    const r = await runCli(TIMING_CLI, ['--run', second], { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(r.code, 0, r.stderr);
    assert.deepStrictEqual(pickTokens(readTiming(second).totals.tokens), sum(A, [0, 0, 0, 0]));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A run dir under pipelines/, as the reconciler sees it: -> { runDir, twin }.
function pipelinesRun(root, name, worktree) {
  const pipelines = path.join(root, 'pipelines');
  fs.mkdirSync(pipelines, { recursive: true });
  const runDir = closedRun(pipelines, name, worktree);
  return { runDir, twin: path.join(pipelines, 'archive', name) };
}

test('item 2: the reconciler archives the run during the transcript read → timing.json lands in the archive twin, the run dir is not recreated', async () => {
  const root = tmpRoot();
  const realRead = transcript.readUsage;
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const { runDir, twin } = pipelinesRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [A, B]);
    transcript.readUsage = async (p, o) => {
      fs.mkdirSync(path.dirname(twin), { recursive: true });
      fs.renameSync(runDir, twin);
      return realRead(p, o);
    };
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.deepStrictEqual(r, { status: 'written', tokens: true, skip: null });
    assert.equal(fs.existsSync(runDir), false, 'the vanished run dir is never recreated');
    const timing = readTiming(twin);
    assertPhaseRows(timing);
    assert.equal(timing.runDir, twin);
    assert.deepStrictEqual(pickTokens(timing.totals.tokens), sum(A, B));
    assert.deepStrictEqual(skipLines(twin), []);
    assert.deepStrictEqual(fs.readdirSync(twin).filter((n) => n.startsWith('.timing.lock') || n.includes('.tmp-')), []);
  } finally {
    transcript.readUsage = realRead;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('item 2: a pending SKIP is logged in the archive twin the timing landed in', async () => {
  const root = tmpRoot();
  const realRead = transcript.readUsage;
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const { runDir, twin } = pipelinesRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [A, B]);
    let entered = false;
    transcript.readUsage = () => {
      entered = true;
      fs.mkdirSync(path.dirname(twin), { recursive: true });
      fs.renameSync(runDir, twin);
      return new Promise(() => {});
    };
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    let r;
    try {
      const p = writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg }, boundMs: 200 });
      for (let i = 0; i < 5000 && !entered; i++) await new Promise((res) => setImmediate(res));
      mock.timers.tick(200);
      r = await p;
    } finally {
      mock.timers.reset();
    }
    assert.equal(r.status, 'written');
    assert.equal(fs.existsSync(runDir), false);
    assertPhaseRows(readTiming(twin));
    const skips = skipLines(twin);
    assert.equal(skips.length, 1, JSON.stringify(skips));
    assert.match(skips[0], /200 ms time bound/);
  } finally {
    transcript.readUsage = realRead;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('archive mid-move: run-state.json already moved to the twin, the run dir still there → timing.json goes to the twin, nothing strands in the run dir', async () => {
  const root = tmpRoot();
  const realRead = transcript.readUsage;
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const { runDir, twin } = pipelinesRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [A, B]);
    transcript.readUsage = async (p, o) => {
      // archiveRunDir's per-entry loop: everything moved, the dir itself not yet removed.
      fs.mkdirSync(twin, { recursive: true });
      for (const name of fs.readdirSync(runDir)) fs.renameSync(path.join(runDir, name), path.join(twin, name));
      return realRead(p, o);
    };
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.deepStrictEqual(r, { status: 'written', tokens: true, skip: null });
    assert.deepStrictEqual(fs.readdirSync(runDir), [], 'nothing written into the emptied run dir');
    assert.deepStrictEqual(pickTokens(readTiming(twin).totals.tokens), sum(A, B));
  } finally {
    transcript.readUsage = realRead;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a timing lock the archive carried to the twin mid-write is released there, not left as a dead lock dir', async (t) => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const { runDir, twin } = pipelinesRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [A, B]);
    const realRename = fs.renameSync;
    let moved = false;
    t.mock.method(fs, 'renameSync', (src, dest) => {
      if (!moved && dest === path.join(runDir, 'timing.json')) {
        // The archive's per-entry move takes the held lock dir along, just before our rename.
        moved = true;
        fs.mkdirSync(twin, { recursive: true });
        realRename(path.join(runDir, '.timing.lock'), path.join(twin, '.timing.lock'));
      }
      return realRename(src, dest);
    });
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(moved, true);
    assert.equal(r.status, 'written');
    assert.equal(fs.existsSync(path.join(twin, '.timing.lock')), false, 'the carried lock dir is released at the twin');
    assert.equal(fs.existsSync(path.join(runDir, '.timing.lock')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('item 2: the run dir vanishes with no archive twin → failed, nothing recreated, no throw', async () => {
  const root = tmpRoot();
  const realRead = transcript.readUsage;
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const { runDir, twin } = pipelinesRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [A, B]);
    transcript.readUsage = async (p, o) => { fs.rmSync(runDir, { recursive: true, force: true }); return realRead(p, o); };
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(r.status, 'failed');
    assert.equal(fs.existsSync(runDir), false);
    assert.equal(fs.existsSync(twin), false);
  } finally {
    transcript.readUsage = realRead;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('item 7: the read-check-write holds the run dir\'s timing lock — a lock held by a live writer past the bound is one SKIP, the file untouched', async () => {
  const root = tmpRoot();
  const { acquireLock, releaseLock } = require('../../../plugin/bin/lib/file-lock');
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const runDir = closedRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [A, B]);
    const file = path.join(runDir, 'timing.json');
    const before = '{"phases":[],"totals":{"minutes":1}}\n';
    fs.writeFileSync(file, before);
    // A concurrent writer (this live process) holds the lock for the whole call.
    const held = acquireLock(path.join(runDir, '.timing.lock'), { waitMs: 0, env: {} });
    assert.ok(held);
    let r;
    let sync;
    try {
      r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg }, boundMs: 100 });
    } finally {
      releaseLock(held);
    }
    assert.equal(r.status, 'failed');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    const skips = skipLines(runDir);
    assert.equal(skips.length, 1, JSON.stringify(skips));
    assert.match(skips[0], /condition: timing\.json lock not acquired within \d+ ms → fallback: no timing\.json written/);
    // Released, the same call writes.
    sync = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(sync.status, 'written');
    assert.equal(fs.existsSync(path.join(runDir, '.timing.lock')), false);
  } finally {
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
    // No env given: the child inherits this process's environment.
    assert.equal(Object.hasOwn(opts, 'env'), false);
    assert.equal(unrefed, true);
    assert.deepStrictEqual(skipLines(root), []);
    // AC11: an 'error' emitted after the spawn returned (ENOENT/EACCES) is the could-not-start SKIP.
    assert.equal(typeof errorListener, 'function');
    assert.doesNotThrow(() => errorListener(new Error('late')));
    const skips = skipLines(root);
    assert.equal(skips.length, 1);
    assert.match(skips[0], /background token pass could not start \(late\) → fallback: timing\.json keeps its phase rows without token totals/);
  } finally {
    childProcess.spawn = real;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('spawnTokenPass passes the caller\'s env to the child', () => {
  const root = tmpRoot();
  const real = childProcess.spawn;
  const seen = [];
  try {
    childProcess.spawn = (cmd, args, opts) => { seen.push(opts); return { on() {}, unref() {} }; };
    const env = { CLAUDE_CONFIG_DIR: path.join(root, 'cfg'), PATH: '' };
    assert.equal(spawnTokenPass(root, { env }).spawned, true);
    assert.equal(seen[0].env, env);
    assert.equal(seen[0].windowsHide, true);
  } finally {
    childProcess.spawn = real;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('spawnTokenPass: a spawn that fails asynchronously (an emitted ENOENT) logs one could-not-start SKIP', async () => {
  const root = tmpRoot();
  const real = childProcess.spawn;
  const { EventEmitter } = require('events');
  try {
    childProcess.spawn = () => {
      const child = new EventEmitter();
      child.unref = () => {};
      setImmediate(() => child.emit('error', Object.assign(new Error('spawn node ENOENT'), { code: 'ENOENT' })));
      return child;
    };
    const r = spawnTokenPass(root);
    assert.equal(r.spawned, true);
    assert.deepStrictEqual(skipLines(root), []);
    await new Promise((res) => setImmediate(res));
    const skips = skipLines(root);
    assert.equal(skips.length, 1);
    assert.match(skips[0], /background token pass could not start \(spawn node ENOENT\)/);
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
