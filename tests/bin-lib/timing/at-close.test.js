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
const { gitRepo, cleanGitEnv } = require('../../helpers/git-fixtures');
const { SID, A, B, writeEvents, writeTranscript, sum, pickTokens, readTiming, skipLines, assertPhaseRows, withStub } = require('../../helpers/close-timing');
const TIMING_CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'timing-at-close.js');
const HOOKS_JS = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'hooks.js');

const { TIMING_BOUND_MS, ownTranscripts, writeTimingAtClose, writePhaseTimingSync, logTimingSkip, spawnTokenPass } = atClose;

// The SKIP lines about timing.json, and the ones about the step yield passing the close's time bound.
const timingSkips = (dir) => skipLines(dir).filter((l) => !l.includes('step yield'));
const yieldBoundSkips = (dir) => skipLines(dir).filter((l) => /time bound before the step yield was derived/.test(l));

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-at-close-')); }

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
    assert.equal(skips.length, 1, 'the one SKIP names the bound; the yield past it adds none of its own');
    assert.match(skips[0], /200 ms time bound/);
    assert.match(skips[0], /; no step-yield\.json written/, 'the one SKIP names the dropped step-yield.json');
    // The bound is past, so the yield is not derived either.
    assert.equal(fs.existsSync(path.join(runDir, 'step-yield.json')), false);
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
function sequentialRuns(root, runsParent = root) {
  const wtA = path.join(root, 'wt-a');
  const mk = (id, [e1, e2], closedAt) => {
    const runDir = closedRun(runsParent, id, wtA);
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
  const root = gitRepo(); // the CLI refuses a run dir outside a main checkout's .claude-tweaks/pipelines/
  try {
    const cfg = path.join(root, 'cfg');
    const { wtA, second } = sequentialRuns(root, path.join(root, '.claude-tweaks', 'pipelines'));
    // A call after run-2's close (11:30) but long before this pass runs (the real now).
    writeRows(cfg, wtA, [['2020-01-06T11:05:00.000Z', A], ['2020-01-06T11:45:00.000Z', OTHER]]);
    const r = await runCli(TIMING_CLI, ['--run', second], { env: { CLAUDE_CONFIG_DIR: cfg }, cwd: root });
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
    const skips = timingSkips(runDir);
    assert.equal(skips.length, 1, JSON.stringify(skips));
    assert.match(skips[0], /condition: timing\.json lock not acquired within \d+ ms → fallback: no timing\.json written/);
    // The wait spent the whole bound, so the yield past it is skipped: the one SKIP names it, no second line.
    assert.match(skips[0], /; no step-yield\.json written/);
    assert.equal(yieldBoundSkips(runDir).length, 0);
    assert.equal(skipLines(runDir).length, 1, JSON.stringify(skipLines(runDir)));
    // Released, the same call writes.
    sync = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(sync.status, 'written');
    assert.equal(fs.existsSync(path.join(runDir, '.timing.lock')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the phase-rows-only write waits for a held timing lock PHASE_LOCK_WAIT_MS, never the transcript bound — one SKIP, the file untouched', async () => {
  const root = tmpRoot();
  const { acquireLock, releaseLock } = require('../../../plugin/bin/lib/file-lock');
  try {
    assert.ok(atClose.PHASE_LOCK_WAIT_MS < TIMING_BOUND_MS);
    const runDir = closedRun(root, 'run', path.join(root, 'wt-a'));
    const held = acquireLock(path.join(runDir, '.timing.lock'), { waitMs: 0, env: {} });
    assert.ok(held);
    let r;
    try {
      r = await withStub(atClose, 'PHASE_LOCK_WAIT_MS', 50, () => writePhaseTimingSync(runDir));
    } finally {
      releaseLock(held);
    }
    assert.equal(r.status, 'failed');
    assert.equal(fs.existsSync(path.join(runDir, 'timing.json')), false);
    const skips = skipLines(runDir);
    assert.equal(skips.length, 1, JSON.stringify(skips));
    const waited = /lock not acquired within (\d+) ms/.exec(skips[0]);
    assert.ok(waited && Number(waited[1]) <= 50, skips[0]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a throw in token derivation still writes the phase rows: no totals.tokens, one SKIP naming the throw', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wtA = path.join(root, 'wt-a');
    const runDir = closedRun(root, 'run', wtA);
    writeTranscript(cfg, wtA, [A, B]);
    // A reader that hands back nothing makes the derivation throw after the phase rows exist.
    const r = await withStub(transcript, 'readUsage', async () => null, () => writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } }));
    assert.equal(r.status, 'written');
    assert.equal(r.tokens, false);
    const timing = readTiming(runDir);
    assertPhaseRows(timing);
    assert.equal(Object.hasOwn(timing.totals, 'tokens'), false);
    const skips = skipLines(runDir);
    assert.equal(skips.length, 1, JSON.stringify(skips));
    assert.match(skips[0], /condition: timing at close failed \(.+\) → fallback: timing\.json phase rows written without token totals/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a timing.json that cannot be read (EIO) is never overwritten on a guess: failed, one SKIP naming it, the bytes unchanged', () => {
  const root = tmpRoot();
  const realRead = fs.readFileSync;
  try {
    const runDir = closedRun(root, 'run', path.join(root, 'wt-a'));
    const file = path.join(runDir, 'timing.json');
    fs.writeFileSync(file, '{"phases":[],"totals":{"tokens":{"input":5,"output":0,"cacheRead":0,"cacheCreate":0}}}');
    const before = fs.readFileSync(file);
    fs.readFileSync = (p, ...rest) => {
      if (typeof p === 'string' && p.endsWith('timing.json')) throw Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' });
      return realRead(p, ...rest);
    };
    let r;
    try { r = writePhaseTimingSync(runDir); } finally { fs.readFileSync = realRead; }
    assert.equal(r.status, 'failed');
    assert.deepStrictEqual(fs.readFileSync(file), before);
    const skips = skipLines(runDir);
    assert.equal(skips.length, 1, JSON.stringify(skips));
    assert.match(skips[0], /EIO/);
  } finally {
    fs.readFileSync = realRead;
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
    assert.deepStrictEqual(r, { paths: [fs.realpathSync(fileA)], taskCalls: [], reason: null });
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
    // The child's anchoring check resolves the main checkout from its cwd: the run dir's parent, not this process's.
    assert.equal(opts.cwd, path.dirname(root));
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

// --- #5556: step-yield.json beside timing.json, on every close ---

const stepYield = require('../../../plugin/bin/lib/timing/step-yield');
const YIELD = stepYield.STEP_YIELD_FILE;
const readYield = (dir) => JSON.parse(fs.readFileSync(path.join(dir, YIELD), 'utf8'));
const yieldSkips = (dir) => skipLines(dir).filter((l) => l.includes('step yield could not be written'));

test('AC6.1: writeTimingAtClose leaves step-yield.json beside timing.json (written, kept and phase-only closes alike)', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wt = path.join(root, 'wt-a');
    const runDir = closedRun(root, 'run', wt);
    writeTranscript(cfg, wt, [A, B]);
    assert.equal((await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } })).status, 'written');
    assert.equal(readYield(runDir).schemaVersion, stepYield.SCHEMA_VERSION);
    fs.rmSync(path.join(runDir, YIELD));
    assert.equal((await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } })).status, 'kept');
    assert.ok(readYield(runDir).steps.length > 0, 'a kept timing.json still gets a yield');
    const plain = closedRun(root, 'run-phase', wt);
    assert.equal(writePhaseTimingSync(plain).status, 'written');
    assert.ok(readYield(plain).steps.length > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC6.1: a failed timing result on a run dir that exists still gets a yield; a spec-N child gets none', async () => {
  const root = tmpRoot();
  try {
    const runDir = closedRun(root, 'run', path.join(root, 'wt'));
    fs.mkdirSync(path.join(runDir, 'timing.json'));
    const r = await writeTimingAtClose(runDir, { tokens: false });
    assert.equal(r.status, 'failed');
    assert.ok(readYield(runDir).steps.length > 0);
    const child = path.join(runDir, 'spec-3');
    fs.mkdirSync(child);
    fs.writeFileSync(path.join(child, 'events.jsonl'), '');
    assert.equal((await writeTimingAtClose(child, { tokens: false })).status, 'not-top-level');
    assert.equal(fs.existsSync(path.join(child, YIELD)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rewritesWhole: a pre-existing step-yield.json with junk is replaced by a whole derived file', async () => {
  const root = tmpRoot();
  try {
    const runDir = closedRun(root, 'run', path.join(root, 'wt'));
    fs.writeFileSync(path.join(runDir, YIELD), '{"junk":true');
    await writeTimingAtClose(runDir, { tokens: false });
    const y = readYield(runDir);
    assert.equal(y.schemaVersion, stepYield.SCHEMA_VERSION);
    assert.equal(Object.hasOwn(y, 'junk'), false);
    assert.deepStrictEqual(fs.readdirSync(runDir).filter((f) => f.includes(YIELD) && f !== YIELD), [], 'no temp file left behind');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keptKeepsWaits: a kept timing.json carrying questions gives the rewritten yield non-null waitedMinutes', async () => {
  const root = tmpRoot();
  try {
    const runDir = closedRun(root, 'run', path.join(root, 'wt'));
    const events = [
      { skill: 'claude-tweaks:build', ts: '2020-01-01T10:00:00.000Z', type: 'skill_invoked' },
      { type: 'ask-user-question', ts: '2020-01-01T10:05:00.000Z', toolUseId: 'toolu_k1', questions: [{ question: 'Merge now?', options: [] }], response: 'yes' },
      { type: 'commit', ts: '2020-01-01T10:08:00.000Z', action: 'push' },
      { skill: 'claude-tweaks:test', ts: '2020-01-01T10:10:00.000Z', type: 'skill_invoked' },
    ];
    fs.writeFileSync(path.join(runDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    fs.writeFileSync(path.join(runDir, 'timing.json'), JSON.stringify({
      phases: [], totals: { tokens: { input: 5, output: 0, cacheRead: 0, cacheCreate: 0 } },
      questions: [{ id: 'toolu_k1', askTs: '2020-01-01T10:03:00.000Z', answerTs: '2020-01-01T10:05:00.000Z', questions: ['Merge now?'] }],
    }));
    const before = fs.readFileSync(path.join(runDir, 'timing.json'));
    assert.equal((await writeTimingAtClose(runDir)).status, 'kept');
    assert.ok(before.equals(fs.readFileSync(path.join(runDir, 'timing.json'))));
    const qs = readYield(runDir).steps.flatMap((s) => s.questions);
    assert.equal(qs.length, 1);
    assert.equal(typeof qs[0].waitedMinutes, 'number');
    assert.ok(qs[0].waitedMinutes > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC6.2: deriveStepYield throwing → the close result is unchanged and exactly one SKIP names the yield', async () => {
  const root = tmpRoot();
  try {
    const a = closedRun(root, 'run-a', path.join(root, 'wt'));
    const b = closedRun(root, 'run-b', path.join(root, 'wt'));
    const expected = await writeTimingAtClose(a, { tokens: false });
    const thrown = await withStub(stepYield, 'deriveStepYield', () => { throw new Error('boom yield'); }, () => writeTimingAtClose(b, { tokens: false }));
    assert.deepStrictEqual(thrown, expected);
    assert.deepStrictEqual(yieldSkips(a), []);
    const skips = yieldSkips(b);
    assert.equal(skips.length, 1, JSON.stringify(skips));
    assert.match(skips[0], /condition: step yield could not be written \(boom yield\) → fallback: no step-yield\.json written/);
    assert.equal(fs.existsSync(path.join(b, YIELD)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('vanishedDir: the run dir removed before the yield write → nothing recreated, no throw, at most one SKIP', async () => {
  const root = tmpRoot();
  try {
    const runDir = closedRun(root, 'run', path.join(root, 'wt'));
    fs.rmSync(runDir, { recursive: true, force: true });
    const r = atClose.writeStepYieldSafe(runDir);
    assert.equal(r.status, 'failed');
    assert.equal(fs.existsSync(runDir), false);
    assert.equal(fs.existsSync(path.join(root, 'archive')), false);

    // Removed between the derive and the write: the temp-then-rename never resurrects the dir.
    const racing = closedRun(root, 'run-racing', path.join(root, 'wt'));
    const out = await withStub(stepYield, 'deriveStepYield', (d) => {
      fs.rmSync(d, { recursive: true, force: true });
      return { schemaVersion: 1, steps: [] };
    }, () => atClose.writeStepYieldSafe(racing));
    assert.equal(out.status, 'failed');
    assert.equal(fs.existsSync(racing), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('vanishedDir: a run dir an archive moved away → the yield lands in the archive twin, the run dir is not recreated', () => {
  const root = tmpRoot();
  try {
    const runDir = closedRun(root, 'run', path.join(root, 'wt'));
    const twin = path.join(root, 'archive', 'run');
    fs.mkdirSync(path.dirname(twin), { recursive: true });
    fs.renameSync(runDir, twin);
    const r = atClose.writeStepYieldSafe(runDir);
    assert.equal(r.status, 'written');
    assert.equal(fs.existsSync(runDir), false);
    assert.ok(readYield(twin).steps.length > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rename-after-archive: run-state.json moved to the twin while the yield derives → nothing strands in the run dir, the yield lands in the twin', async () => {
  const root = tmpRoot();
  try {
    const runDir = closedRun(root, 'run', path.join(root, 'wt'));
    const twin = path.join(root, 'archive', 'run');
    fs.mkdirSync(twin, { recursive: true });
    const real = stepYield.deriveStepYield;
    let moved = false;
    const r = await withStub(stepYield, 'deriveStepYield', (d, o) => {
      const y = real(d, o);
      // An archive's per-entry move: run-state.json first, the run dir itself still there.
      if (!moved) { moved = true; fs.renameSync(path.join(d, 'run-state.json'), path.join(twin, 'run-state.json')); }
      return y;
    }, () => atClose.writeStepYieldSafe(runDir));
    assert.equal(r.status, 'written');
    assert.equal(fs.existsSync(path.join(runDir, YIELD)), false, 'a yield stranded in the vacated run dir');
    assert.ok(fs.existsSync(path.join(twin, YIELD)));
    assert.deepStrictEqual(yieldSkips(runDir), []);
    assert.equal(fs.existsSync(path.join(runDir, '.timing.lock')), false);
    assert.equal(fs.existsSync(path.join(twin, '.timing.lock')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const LOCK_MISS = /condition: step-yield\.json lock not acquired within \d+ ms → fallback: no step-yield\.json written/;

test('lockHeld: a timing lock held by a live writer → no yield, one SKIP naming the lock miss, the file untouched', async () => {
  const root = tmpRoot();
  const { acquireLock, releaseLock } = require('../../../plugin/bin/lib/file-lock');
  try {
    const runDir = closedRun(root, 'run', path.join(root, 'wt'));
    const held = acquireLock(path.join(runDir, '.timing.lock'), { waitMs: 0, env: {} });
    assert.ok(held);
    let r;
    try {
      r = await withStub(atClose, 'PHASE_LOCK_WAIT_MS', 50, () => atClose.writeStepYieldSafe(runDir));
    } finally {
      releaseLock(held);
    }
    assert.equal(r.status, 'skipped');
    assert.equal(r.fold, true);
    assert.equal(Object.hasOwn(r, 'bound'), false, 'inside the bound');
    assert.match(r.skip, LOCK_MISS);
    assert.equal(fs.existsSync(path.join(runDir, YIELD)), false);
    assert.equal(skipLines(runDir).length, 1);
    assert.match(skipLines(runDir)[0], LOCK_MISS);
    // Released, the same call writes.
    assert.equal(atClose.writeStepYieldSafe(runDir).status, 'written');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lock miss inside the bound, through a close: exactly one SKIP line, on the synchronous archive path too, and a timing SKIP absorbs it', async () => {
  const root = tmpRoot();
  const { acquireLock, releaseLock } = require('../../../plugin/bin/lib/file-lock');
  try {
    // A kept timing.json (token totals) takes no lock, so only the yield misses it.
    const runDir = closedRun(root, 'run', path.join(root, 'wt'));
    fs.writeFileSync(path.join(runDir, 'timing.json'), JSON.stringify({ phases: [], totals: { tokens: { input: 5, output: 0, cacheRead: 0, cacheCreate: 0 } } }));
    const held = acquireLock(path.join(runDir, '.timing.lock'), { waitMs: 0, env: {} });
    assert.ok(held);
    try {
      const r = await withStub(atClose, 'PHASE_LOCK_WAIT_MS', 50, () => writePhaseTimingSync(runDir));
      assert.equal(r.status, 'kept');
    } finally {
      releaseLock(held);
    }
    assert.equal(fs.existsSync(path.join(runDir, YIELD)), false);
    assert.equal(skipLines(runDir).length, 1, JSON.stringify(skipLines(runDir)));
    assert.match(skipLines(runDir)[0], LOCK_MISS);

    // The timing write misses the same held lock: its SKIP and the yield's are one line.
    const both = closedRun(root, 'run-both', path.join(root, 'wt'));
    const heldBoth = acquireLock(path.join(both, '.timing.lock'), { waitMs: 0, env: {} });
    assert.ok(heldBoth);
    try {
      const r = await withStub(atClose, 'PHASE_LOCK_WAIT_MS', 50, () => writePhaseTimingSync(both));
      assert.equal(r.status, 'failed');
    } finally {
      releaseLock(heldBoth);
    }
    assert.equal(skipLines(both).length, 1, JSON.stringify(skipLines(both)));
    assert.match(skipLines(both)[0], /timing\.json lock not acquired within \d+ ms → fallback: no timing\.json written; condition: step-yield\.json lock not acquired within \d+ ms → fallback: no step-yield\.json written/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a yield that throws while the timing write also logged a SKIP: exactly one timing-family SKIP line carries both', async () => {
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    // No transcript under cfg: the timing write is phase rows only, with its own SKIP.
    const runDir = closedRun(root, 'run', path.join(root, 'wt'));
    await withStub(stepYield, 'deriveStepYield', () => { throw new Error('boom yield'); }, () => writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } }));
    const skips = skipLines(runDir);
    assert.equal(skips.length, 1, JSON.stringify(skips));
    assert.match(skips[0], /→ fallback: timing\.json phase rows written without token totals; condition: step yield could not be written \(boom yield\) → fallback: no step-yield\.json written/);
    assert.equal(fs.existsSync(path.join(runDir, YIELD)), false);
    assert.equal(fs.existsSync(path.join(runDir, 'timing.json')), true, 'the timing write is unaffected');
    // Called on its own (logBound true) the yield logs its one line itself.
    const alone = closedRun(root, 'run-alone', path.join(root, 'wt'));
    const r = await withStub(stepYield, 'deriveStepYield', () => { throw new Error('boom alone'); }, () => atClose.writeStepYieldSafe(alone));
    assert.equal(r.fold, true);
    assert.equal(skipLines(alone).length, 1);
    // logBound false returns it for the caller to fold and logs nothing.
    const folded = closedRun(root, 'run-folded', path.join(root, 'wt'));
    const f = await withStub(stepYield, 'deriveStepYield', () => { throw new Error('boom folded'); }, () => atClose.writeStepYieldSafe(folded, { logBound: false }));
    assert.equal(f.fold, true);
    assert.match(f.skip, /step yield could not be written \(boom folded\)/);
    assert.deepStrictEqual(skipLines(folded), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lock wait that spends the close bound: the yield logs its own one SKIP naming the file', () => {
  const root = tmpRoot();
  const { acquireLock, releaseLock } = require('../../../plugin/bin/lib/file-lock');
  try {
    const runDir = closedRun(root, 'run', path.join(root, 'wt'));
    const held = acquireLock(path.join(runDir, '.timing.lock'), { waitMs: 0, env: {} });
    assert.ok(held);
    let r;
    try {
      r = atClose.writeStepYieldSafe(runDir, { deadlineAt: Date.now() + 30, boundMs: 30 });
    } finally {
      releaseLock(held);
    }
    assert.equal(r.status, 'skipped');
    assert.equal(r.bound, true);
    assert.equal(skipLines(runDir).length, 1);
    assert.match(skipLines(runDir)[0], /no step-yield\.json written/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unrelatedTwin: a run dir that never had a run-state.json is written in place even when an archive twin of that name exists', () => {
  const root = tmpRoot();
  try {
    const runDir = path.join(root, 'run');
    fs.mkdirSync(runDir, { recursive: true });
    writeEvents(runDir);
    const twin = path.join(root, 'archive', 'run');
    fs.mkdirSync(twin, { recursive: true });
    assert.equal(fs.existsSync(path.join(runDir, 'run-state.json')), false);
    assert.equal(atClose.writeStepYieldSafe(runDir).status, 'written');
    assert.ok(fs.existsSync(path.join(runDir, YIELD)));
    assert.equal(fs.existsSync(path.join(twin, YIELD)), false, 'an unrelated twin is not written');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deadline: a close already past its time bound derives no yield — one SKIP naming the bound, nothing written', async () => {
  const root = tmpRoot();
  try {
    const runDir = closedRun(root, 'run', path.join(root, 'wt'));
    let derived = 0;
    const r = await withStub(stepYield, 'deriveStepYield', () => { derived++; return { schemaVersion: 1, steps: [] }; },
      () => atClose.writeStepYieldSafe(runDir, { deadlineAt: Date.now() - 1, boundMs: 123 }));
    assert.equal(derived, 0, 'the yield was derived past the deadline');
    assert.equal(r.status, 'failed');
    assert.match(r.skip, /close passed the 123 ms time bound before the step yield was derived → fallback: no step-yield\.json written/);
    assert.equal(fs.existsSync(path.join(runDir, YIELD)), false);
    assert.equal(skipLines(runDir).length, 1);
    // inside the bound it writes
    assert.equal(atClose.writeStepYieldSafe(runDir, { deadlineAt: Date.now() + 60000 }).status, 'written');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('vanishedDir: the dir moves to the twin between the derive and the write → retried once at the twin', async () => {
  const root = tmpRoot();
  try {
    const runDir = closedRun(root, 'run', path.join(root, 'wt'));
    const twin = path.join(root, 'archive', 'run');
    fs.mkdirSync(path.dirname(twin), { recursive: true });
    const real = stepYield.deriveStepYield;
    let moved = false;
    const r = await withStub(stepYield, 'deriveStepYield', (d, o) => {
      const y = real(d, o);
      if (!moved) { moved = true; fs.renameSync(d, twin); }
      return y;
    }, () => atClose.writeStepYieldSafe(runDir));
    assert.equal(r.status, 'written');
    assert.equal(fs.existsSync(runDir), false);
    assert.ok(readYield(twin).steps.length > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- #5647: a dispatched run counts the Task-call transcripts naming it ----
const RUN_1 = '2026-11-16T100000-record-1';
const RUN_2 = '2026-11-16T100000-record-2';

// {cfg}/projects/{slug of dir}/{sid}.jsonl (one non-usage row, so it never feeds totals) plus its
// subagents: each agent has meta {spawnDepth, parentAgentId}, a first-line user prompt, and two
// assistant rows (10:01, 10:09) both carrying `usage`, with message ids unique per file.
// agents: [{ id, depth, parent?, prompt?, usage?, stamps? }] -> the subagents dir.
function agentSession(cfg, dir, sid, agents) {
  const slugDir = path.join(cfg, 'projects', transcript.slugForCwd(dir));
  const subDir = path.join(slugDir, sid, 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, `${sid}.jsonl`), JSON.stringify({ type: 'user', timestamp: '2026-11-16T10:00:00.000Z', message: { role: 'user', content: 'main' } }) + '\n');
  for (const a of agents) {
    fs.writeFileSync(path.join(subDir, `agent-${a.id}.meta.json`), JSON.stringify({ spawnDepth: a.depth, description: a.id, ...(a.parent ? { parentAgentId: a.parent } : {}) }));
    const [s1, s2] = a.stamps || ['2026-11-16T10:01:00.000Z', '2026-11-16T10:09:00.000Z'];
    const u = a.usage || A;
    const row = (n, ts) => JSON.stringify({ timestamp: ts, message: { role: 'assistant', id: `m-${a.id}-${n}`, model: 'claude-test', content: [], usage: { input_tokens: u[0], output_tokens: u[1], cache_read_input_tokens: u[2], cache_creation_input_tokens: u[3] } } });
    const first = JSON.stringify({ type: 'user', message: { role: 'user', content: a.prompt || 'no run named' } });
    fs.writeFileSync(path.join(subDir, `agent-${a.id}.jsonl`), [first, row(1, s1), row(2, s2)].join('\n') + '\n');
  }
  return subDir;
}
const names = (root, id) => `Run the next phase in ${path.join(root, '.claude-tweaks', 'pipelines', id)}`;
const twice = (u) => sum(u, u);
const plus = (a, b) => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheCreate: a.cacheCreate + b.cacheCreate });

// A run dir stamped by the real writer (record-worktree, --dispatch unless dispatch:false) from `sid`,
// then closed. resumeSid adds a plain re-stamp from that session (a human resume). -> { runDir, wt }.
async function dispatchedRun(root, id, { sid = 'sess-d1', resumeSid, dispatch = true } = {}) {
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', id);
  fs.mkdirSync(runDir, { recursive: true });
  writeEvents(runDir);
  const wt = path.join(root, `wt-${id}`);
  const stamp = async (session, flags) => {
    const res = await runCli(HOOKS_JS, ['record-worktree', '--run', runDir, wt, ...flags], {
      cwd: root, env: { ...cleanGitEnv(), CLAUDE_CODE_SESSION_ID: session, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1' },
    });
    assert.equal(res.code, 0, res.stderr);
  };
  await stamp(sid, dispatch ? ['--dispatch'] : []);
  if (resumeSid) await stamp(resumeSid, []);
  assert.equal(closeRunState(runDir, { explicit: true }).status, 'closed');
  return { runDir, wt };
}

test('AC1.1: a dispatched run whose session transcript sits only under the main checkout slug gets token totals from the Task-call transcript that names its run id', async () => {
  const root = gitRepo();
  try {
    const cfg = path.join(root, 'cfg');
    agentSession(cfg, root, 'sess-d1', [
      { id: 't1', depth: 1, prompt: names(root, RUN_1), usage: A },
      { id: 't2', depth: 1, prompt: names(root, RUN_2), usage: B },
      { id: 'c1', depth: 2, parent: 't1', usage: OTHER },
      { id: 'c2', depth: 2, parent: 't2', usage: OTHER },
    ]);
    const r1 = await dispatchedRun(root, RUN_1);
    const r2 = await dispatchedRun(root, RUN_2);
    const env = { CLAUDE_CONFIG_DIR: cfg };
    assert.equal((await writeTimingAtClose(r1.runDir, { env })).status, 'written');
    assert.equal((await writeTimingAtClose(r2.runDir, { env })).status, 'written');
    const t1 = readTiming(r1.runDir);
    const t2 = readTiming(r2.runDir);
    assert.deepStrictEqual(pickTokens(t1.totals.tokens), twice(A));
    assert.deepStrictEqual(pickTokens(t2.totals.tokens), twice(B));
    assert.deepStrictEqual(t1.dispatches.items.map((d) => d.agentId), ['c1']);
    assert.deepStrictEqual(t2.dispatches.items.map((d) => d.agentId), ['c2']);
    assert.deepStrictEqual(skipLines(r1.runDir), []);
    assert.deepStrictEqual(skipLines(r2.runDir), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC1.1: a dispatched run whose Task-call transcripts name a different run id gets none', async () => {
  const root = gitRepo();
  try {
    const cfg = path.join(root, 'cfg');
    agentSession(cfg, root, 'sess-d1', [{ id: 't2', depth: 1, prompt: names(root, RUN_2), usage: B }]);
    const { runDir } = await dispatchedRun(root, RUN_1);
    assert.equal((await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } })).status, 'written');
    const timing = readTiming(runDir);
    assertPhaseRows(timing);
    assert.equal(Object.hasOwn(timing.totals, 'tokens'), false);
    const skips = timingSkips(runDir);
    assert.equal(skips.length, 1);
    assert.ok(skips[0].includes(`and no Task-call transcript of session(s) sess-d1 names run ${RUN_1}`), skips[0]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC1.1 gate: a non-dispatched run with a Task-call transcript naming it still gets none', async () => {
  // Guard `rs.dispatched === true` in ownTranscripts: deleting it turns this red (the run would get totals).
  const root = gitRepo();
  try {
    const cfg = path.join(root, 'cfg');
    // The session sits under neither the worktree's nor the run root's slug, so only a Task-call lookup could reach it.
    agentSession(cfg, path.join(root, 'elsewhere'), 'sess-d1', [{ id: 't1', depth: 1, prompt: names(root, RUN_1), usage: A }]);
    const { runDir, wt } = await dispatchedRun(root, RUN_1, { dispatch: false });
    assert.equal((await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } })).status, 'written');
    const timing = readTiming(runDir);
    assertPhaseRows(timing);
    assert.equal(Object.hasOwn(timing.totals, 'tokens'), false);
    const skips = timingSkips(runDir);
    assert.equal(skips.length, 1);
    assert.ok(skips[0].includes(`condition: no sess-d1.jsonl under the slug of ${wt} or of its run root ${root} → fallback:`), skips[0]);
    assert.ok(!skips[0].includes('Task-call'), skips[0]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC1.1 runId guard: a dispatched run state with no string runId asks for no Task calls', async () => {
  // Guard `typeof runId === 'string'` in ownTranscripts: deleting it turns this red (the stub's path would be returned).
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const rs = { sessionId: SID, dispatchSessionId: SID, dispatched: true, worktree: path.join(root, 'wt') };
    let asked = 0;
    await withStub(transcript, 'locateTaskTranscripts', () => { asked += 1; return { paths: ['/stubbed/agent-x.jsonl'], notes: [] }; }, () => {
      const r = ownTranscripts(rs, { env: { CLAUDE_CONFIG_DIR: cfg } });
      assert.deepStrictEqual(r.paths, []);
      assert.deepStrictEqual(r.taskCalls, []);
      assert.equal(r.reason, `no ${SID}.jsonl under the slug of ${rs.worktree}`);
      assert.equal(asked, 0);
      const withId = ownTranscripts(rs, { env: { CLAUDE_CONFIG_DIR: cfg }, runId: RUN_1 });
      assert.deepStrictEqual(withId.taskCalls, ['/stubbed/agent-x.jsonl']);
      assert.equal(withId.reason, null);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC1.1 union: a dispatched run with an own-slug transcript counts it plus its Task calls', async () => {
  const root = gitRepo();
  try {
    const cfg = path.join(root, 'cfg');
    agentSession(cfg, root, 'sess-d1', [{ id: 't1', depth: 1, prompt: names(root, RUN_1), usage: OTHER }]);
    const { runDir, wt } = await dispatchedRun(root, RUN_1);
    writeTranscript(cfg, wt, [A, B], 'sess-d1');
    assert.equal((await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } })).status, 'written');
    const timing = readTiming(runDir);
    assert.deepStrictEqual(pickTokens(timing.totals.tokens), plus(sum(A, B), twice(OTHER)));
    assert.deepStrictEqual(skipLines(runDir), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC1.1 resume: a resumed dispatched run counts the resumer\'s own-slug transcript and the dispatching session\'s Task calls', async () => {
  const root = gitRepo();
  try {
    const cfg = path.join(root, 'cfg');
    agentSession(cfg, root, 'S1', [{ id: 't1', depth: 1, prompt: names(root, RUN_1), usage: A }]);
    const { runDir, wt } = await dispatchedRun(root, RUN_1, { sid: 'S1', resumeSid: 'S2' });
    const rs = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
    assert.equal(rs.dispatchSessionId, 'S1');
    assert.equal(rs.sessionId, 'S2');
    writeTranscript(cfg, wt, [B, B], 'S2');
    assert.equal((await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } })).status, 'written');
    assert.deepStrictEqual(pickTokens(readTiming(runDir).totals.tokens), plus(twice(A), twice(B)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC1.1 resume: the resumer\'s own Task calls count in place of an own-slug transcript', async () => {
  const root = gitRepo();
  try {
    const cfg = path.join(root, 'cfg');
    agentSession(cfg, root, 'S1', [{ id: 't1', depth: 1, prompt: names(root, RUN_1), usage: A }]);
    agentSession(cfg, path.join(root, 'elsewhere'), 'S2', [{ id: 't9', depth: 1, prompt: names(root, RUN_1), usage: B }]);
    const { runDir } = await dispatchedRun(root, RUN_1, { sid: 'S1', resumeSid: 'S2' });
    assert.equal((await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } })).status, 'written');
    assert.deepStrictEqual(pickTokens(readTiming(runDir).totals.tokens), plus(twice(A), twice(B)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC1.1 no rows in window: the SKIP names the Task-call transcripts', async () => {
  const root = gitRepo();
  try {
    const cfg = path.join(root, 'cfg');
    const old = ['2026-11-15T10:01:00.000Z', '2026-11-15T10:09:00.000Z'];
    agentSession(cfg, root, 'sess-d1', [{ id: 't1', depth: 1, prompt: names(root, RUN_1), usage: A, stamps: old }]);
    const { runDir } = await dispatchedRun(root, RUN_1);
    const r = await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(r.status, 'written');
    assert.equal(r.tokens, false);
    assertPhaseRows(readTiming(runDir));
    const skips = timingSkips(runDir);
    assert.equal(skips.length, 1);
    assert.ok(skips[0].includes('own and Task-call transcripts yielded no token totals'), skips[0]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC1.1 no worktree: a dispatched run whose run-state has worktree nulled and no worktreeAtClose still gets its totals', async () => {
  // Red without it: ownTranscripts' worktree/sessionId early returns running before the dispatched lookup (that run never reaches
  // locateTaskTranscripts). The real writer (record-worktree --dispatch, via dispatchedRun) stamps the dispatch ids; the worktree is then
  // blanked with ctxLib.writeRunState, the shape a pre-#3023 close left (no worktreeAtClose existed then; null is its absent value).
  const root = gitRepo();
  try {
    const cfg = path.join(root, 'cfg');
    agentSession(cfg, root, 'sess-d1', [{ id: 't1', depth: 1, prompt: names(root, RUN_1), usage: A }]);
    const { runDir } = await dispatchedRun(root, RUN_1);
    ctxLib.writeRunState(runDir, { worktree: null, worktreeAtClose: null });
    assert.equal((await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } })).status, 'written');
    assert.deepStrictEqual(pickTokens(readTiming(runDir).totals.tokens), twice(A));
    assert.deepStrictEqual(skipLines(runDir), []);
    // And a miss names the no-worktree reason first, then the Task-call lookup.
    const other = await dispatchedRun(root, RUN_2);
    ctxLib.writeRunState(other.runDir, { worktree: null, worktreeAtClose: null });
    assert.equal((await writeTimingAtClose(other.runDir, { env: { CLAUDE_CONFIG_DIR: cfg } })).status, 'written');
    const skips = timingSkips(other.runDir);
    assert.equal(skips.length, 1);
    assert.ok(skips[0].includes(`no worktree or worktreeAtClose in run-state.json, and no Task-call transcript of session(s) sess-d1 names run ${RUN_2}`), skips[0]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC1.1 gate: a non-dispatched run with no worktree returns its reason without reading homeDir', () => {
  // Red without it: deleting ownTranscripts' `missing && !dispatched` early return -- homeDir() then runs (env has no
  // CLAUDE_CONFIG_DIR) and its throw turns the reason into "transcript lookup failed".
  const r = ownTranscripts({ sessionId: SID, dispatched: false }, { env: {}, homeDir: () => { throw new Error('homeDir read'); }, runId: RUN_1 });
  assert.deepStrictEqual(r, { paths: [], taskCalls: [], reason: 'no worktree or worktreeAtClose in run-state.json' });
});

test('run root: a non-dispatched run whose transcript sits only under its run root\'s slug gets totals from it; another worktree\'s slug still gives none', async () => {
  // Red without ownTranscripts' run-root fallback (or without at-close passing runRoot): the first run gets no totals.
  const root = gitRepo();
  try {
    const cfg = path.join(root, 'cfg');
    const { runDir, wt } = await dispatchedRun(root, RUN_1, { sid: 'S-root', dispatch: false });
    writeTranscript(cfg, root, [A, B], 'S-root');
    assert.equal((await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } })).status, 'written');
    assert.deepStrictEqual(pickTokens(readTiming(runDir).totals.tokens), sum(A, B));
    assert.deepStrictEqual(skipLines(runDir), []);
    // The own slug still wins over the run root's.
    writeTranscript(cfg, wt, [OTHER, OTHER], 'S-root');
    assert.deepStrictEqual(ownTranscripts({ sessionId: 'S-root', worktree: wt }, { env: { CLAUDE_CONFIG_DIR: cfg }, runRoot: root }).paths,
      [fs.realpathSync(path.join(cfg, 'projects', transcript.slugForCwd(wt), 'S-root.jsonl'))]);
    // AC9.2 holds: a transcript under a sibling worktree's slug is not the run's.
    const other = await dispatchedRun(root, RUN_2, { sid: 'S-sib', dispatch: false });
    writeTranscript(cfg, path.join(root, 'wt-sibling'), [A, B], 'S-sib');
    assert.equal((await writeTimingAtClose(other.runDir, { env: { CLAUDE_CONFIG_DIR: cfg } })).status, 'written');
    assert.equal(Object.hasOwn(readTiming(other.runDir).totals, 'tokens'), false);
    const skips = timingSkips(other.runDir);
    assert.equal(skips.length, 1);
    assert.ok(skips[0].includes(`no S-sib.jsonl under the slug of ${other.wt} or of its run root ${root}`), skips[0]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('run root: a dispatched run never falls back to the run root\'s slug', () => {
  // Red without the `!dispatched` term: the dispatcher's own transcript under the run root would be counted.
  const root = tmpRoot();
  try {
    const cfg = path.join(root, 'cfg');
    const wt = path.join(root, 'wt');
    writeTranscript(cfg, root, [A, B], SID);
    const rs = { sessionId: SID, dispatchSessionId: SID, dispatched: true, worktree: wt };
    const r = ownTranscripts(rs, { env: { CLAUDE_CONFIG_DIR: cfg }, runId: RUN_1, runRoot: root });
    assert.deepStrictEqual(r.paths, []);
    assert.ok(r.reason.startsWith(`no ${SID}.jsonl under the slug of ${wt}, and no Task-call transcript`), r.reason);
    // A run dir outside a .claude-tweaks/pipelines tree has no run root, so the reason is unchanged.
    assert.equal(ownTranscripts({ sessionId: SID, worktree: wt }, { env: { CLAUDE_CONFIG_DIR: cfg } }).reason, `no ${SID}.jsonl under the slug of ${wt}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC1.1 notes: an empty result carries the lookup notes', async () => {
  const root = gitRepo();
  try {
    const cfg = path.join(root, 'cfg');
    fs.mkdirSync(path.join(cfg, 'projects'), { recursive: true });
    const { runDir } = await dispatchedRun(root, RUN_1, { sid: 'sess-none' });
    assert.equal((await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } })).status, 'written');
    const skips = timingSkips(runDir);
    assert.equal(skips.length, 1);
    assert.ok(skips[0].includes(`names run ${RUN_1} (session sess-none: no sess-none.jsonl found)`), skips[0]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC1.1 no session ids: the SKIP says no session id was recorded, not an empty session list', () => {
  // Red without the `!sessionIds.length` branch: the reason reads "of session(s)  names run …".
  const root = gitRepo();
  try {
    const cfg = path.join(root, 'cfg');
    fs.mkdirSync(path.join(cfg, 'projects'), { recursive: true });
    const r = ownTranscripts({ dispatched: true, dispatchSessionId: null }, { env: { CLAUDE_CONFIG_DIR: cfg }, runId: RUN_1 });
    assert.deepEqual(r.paths, []);
    assert.equal(r.reason, `no worktree or worktreeAtClose in run-state.json, and no dispatchSessionId or sessionId in run-state.json to look up Task-call transcripts of run ${RUN_1}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC1.1 archive twin: attribution keys on the basename', async () => {
  const root = gitRepo();
  try {
    const cfg = path.join(root, 'cfg');
    agentSession(cfg, root, 'sess-d1', [{ id: 't1', depth: 1, prompt: names(root, RUN_1), usage: A }]);
    const { runDir } = await dispatchedRun(root, RUN_1);
    const twin = path.join(root, '.claude-tweaks', 'pipelines', 'archive', RUN_1);
    fs.mkdirSync(path.dirname(twin), { recursive: true });
    fs.renameSync(runDir, twin);
    assert.equal((await writeTimingAtClose(twin, { env: { CLAUDE_CONFIG_DIR: cfg } })).status, 'written');
    assert.deepStrictEqual(pickTokens(readTiming(twin).totals.tokens), twice(A));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC1.1 dispatches scope is per directory: the own-slug directory keeps its window view minus the attributed agents, the Task-call-only directory keeps descendants', async () => {
  // Red without it: a provenance-blind scope (collectDispatches' ownDirs / scopeDirItems' ownSlug) -- treating S2's own-slug
  // directory like a Task-call-only one drops r2 (no parent chain); treating S1's like an own-slug one keeps x1; and an
  // attributed r1 left in `dispatches` double-counts its rows (they are in totals.tokens).
  const root = gitRepo();
  try {
    const cfg = path.join(root, 'cfg');
    agentSession(cfg, root, 'S1', [
      { id: 't1', depth: 1, prompt: names(root, RUN_1), usage: A },
      { id: 'c1', depth: 2, parent: 't1', usage: OTHER },
      { id: 'x1', depth: 1, usage: OTHER },
    ]);
    const { runDir, wt } = await dispatchedRun(root, RUN_1, { sid: 'S1', resumeSid: 'S2' });
    agentSession(cfg, wt, 'S2', [
      { id: 'r1', depth: 1, prompt: names(root, RUN_1), usage: B },
      { id: 'r2', depth: 1, usage: OTHER },
    ]);
    writeTranscript(cfg, wt, [B, B], 'S2');
    assert.equal((await writeTimingAtClose(runDir, { env: { CLAUDE_CONFIG_DIR: cfg } })).status, 'written');
    const timing = readTiming(runDir);
    assert.deepStrictEqual(timing.dispatches.items.map((d) => d.agentId).sort(), ['c1', 'r2']);
    assert.deepStrictEqual(pickTokens(timing.totals.tokens), plus(twice(A), plus(twice(B), twice(B))));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- manifest fill at close (#6009) ----
const { initRunManifest } = require('../../../plugin/bin/lib/run-manifest/write');

const manifestFile = (runDir) => path.join(runDir, 'manifest.json');
const readManifestJson = (runDir) => JSON.parse(fs.readFileSync(manifestFile(runDir), 'utf8'));
const MINT = { pluginVersion: '6.174.0', policyHash: `sha256:${'a'.repeat(64)}`, baseCommit: 'b'.repeat(40), modelProfile: { stance: 'default', ceiling: null } };

// A closed run (real closeRunState stamp) with a minted manifest and its transcript.
function manifestRun(root, { transcripts = true } = {}) {
  const cfg = path.join(root, 'cfg');
  const wt = path.join(root, 'wt');
  const runDir = closedRun(root, 'run', wt);
  assert.equal(initRunManifest(runDir, { cwd: root, lane: 'standard' }, { gatherFacts: () => ({ ...MINT }), now: () => new Date(Date.now() - 60000) }).written, true);
  if (transcripts) writeTranscript(cfg, wt, [A, B]);
  return { cfg, wt, runDir, env: { CLAUDE_CONFIG_DIR: cfg } };
}

test('AC6.1: after a token-total timing write the manifest has v 1, non-null costUsd, tokensByModel, minutes, closedAt, and every pre-existing field unchanged', async () => {
  const root = tmpRoot();
  try {
    const { runDir, env } = manifestRun(root);
    const before = readManifestJson(runDir);
    assert.equal((await writeTimingAtClose(runDir, { env })).status, 'written');
    const after = readManifestJson(runDir);
    assert.equal(after.v, 1);
    for (const k of Object.keys(before)) assert.deepStrictEqual(after[k], before[k], k);
    assert.equal(typeof after.costUsd, 'number');
    assert.deepStrictEqual(Object.keys(after.tokensByModel), ['claude-test']);
    assert.equal(after.costPartial, false);
    assert.equal(typeof after.minutes, 'number');
    assert.equal(typeof after.closedAt, 'string');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC6.2: closedAt is the close\'s run-state stamp, not the test\'s clock', async () => {
  const root = tmpRoot();
  try {
    const { runDir, env } = manifestRun(root);
    const rs = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
    assert.equal(rs.status, 'clean');
    const realNow = Date.now;
    const later = realNow() + 3 * 3600 * 1000;
    Date.now = () => later;
    try { await writeTimingAtClose(runDir, { env }); } finally { Date.now = realNow; }
    assert.equal(readManifestJson(runDir).closedAt, rs.updatedAt);
    assert.notEqual(readManifestJson(runDir).closedAt, new Date(later).toISOString());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC6.3: closing again changes nothing in the manifest', async () => {
  const root = tmpRoot();
  try {
    const { runDir, env } = manifestRun(root);
    await writeTimingAtClose(runDir, { env });
    assert.equal(typeof readManifestJson(runDir).costUsd, 'number');
    const bytes = fs.readFileSync(manifestFile(runDir), 'utf8');
    assert.equal((await writeTimingAtClose(runDir, { env })).status, 'kept');
    assert.equal(fs.readFileSync(manifestFile(runDir), 'utf8'), bytes);
    assert.equal(writePhaseTimingSync(runDir).status, 'kept');
    assert.equal(fs.readFileSync(manifestFile(runDir), 'utf8'), bytes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC7.1: a spec-N child gets no fill, and a fill into a non-object manifest leaves it untouched with one stderr line', async () => {
  const root = tmpRoot();
  try {
    const parent = path.join(root, 'parent');
    const child = path.join(parent, 'spec-1');
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(parent, 'run-state.json'), '{}');
    writeEvents(child);
    assert.equal((await writeTimingAtClose(child, { env: {} })).status, 'not-top-level');
    assert.equal(fs.existsSync(manifestFile(child)), false);

    const { runDir, env } = manifestRun(root);
    fs.writeFileSync(manifestFile(runDir), '[1,2]\n');
    const lines = [];
    const realWrite = process.stderr.write;
    process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
    try { await writeTimingAtClose(runDir, { env }); } finally { process.stderr.write = realWrite; }
    assert.equal(fs.readFileSync(manifestFile(runDir), 'utf8'), '[1,2]\n');
    assert.equal(lines.filter((l) => l.startsWith('claude-tweaks: run-manifest:')).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC8.12: a fill-created manifest takes minutes from the first event, and minutes null with no events', () => {
  const root = tmpRoot();
  try {
    const { runDir } = manifestRun(root, { transcripts: false });
    fs.rmSync(manifestFile(runDir));
    writePhaseTimingSync(runDir);
    const m = readManifestJson(runDir);
    // closedAt is the close's run-state stamp, the first event is 2026-11-16T10:00:00Z.
    const expected = Math.round((Date.parse(m.closedAt) - Date.parse('2026-11-16T10:00:00.000Z')) / 6000) / 10;
    assert.equal(m.minutes, expected);

    const bare = path.join(root, 'bare');
    fs.mkdirSync(bare);
    fs.writeFileSync(path.join(bare, 'run-state.json'), JSON.stringify({ status: 'active' }));
    assert.equal(initRunManifest(bare, { cwd: root }, { gatherFacts: () => ({ ...MINT }) }).written, true);
    writePhaseTimingSync(bare);
    // No event and no clean stamp: nothing to fill, so the keys stay unset (read as null).
    assert.equal(readManifestJson(bare).minutes ?? null, null);
    assert.equal(readManifestJson(bare).closedAt ?? null, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fills the archive twin when the run dir moved', async () => {
  const root = tmpRoot();
  try {
    const { runDir, env } = manifestRun(root);
    const twin = path.join(path.dirname(runDir), 'archive', path.basename(runDir));
    const realRead = transcript.readUsage;
    transcript.readUsage = async (p, o) => {
      fs.mkdirSync(path.dirname(twin), { recursive: true });
      fs.renameSync(runDir, twin);
      return realRead(p, o);
    };
    try {
      assert.equal((await writeTimingAtClose(runDir, { env })).status, 'written');
    } finally {
      transcript.readUsage = realRead;
    }
    assert.equal(fs.existsSync(runDir), false);
    assert.equal(typeof readManifestJson(twin).costUsd, 'number');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('phase-rows-only write fills closedAt and minutes only', () => {
  const root = tmpRoot();
  try {
    const { runDir } = manifestRun(root, { transcripts: false });
    assert.equal(writePhaseTimingSync(runDir).status, 'written');
    const m = readManifestJson(runDir);
    assert.equal(typeof m.closedAt, 'string');
    assert.equal(typeof m.minutes, 'number');
    assert.equal('costUsd' in m, false);
    assert.equal('tokensByModel' in m, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC8.6+AC8.7: a kept close over a partial stored group upgrades it once transcripts are readable, timing.json byte-identical', async () => {
  const root = tmpRoot();
  try {
    const { cfg, wt, runDir, env } = manifestRun(root, { transcripts: false });
    const subDir = agentSession(cfg, wt, SID, [{ id: 'a1', usage: OTHER }]);
    writeTranscript(cfg, wt, [A, B]);
    const agentFile = path.join(subDir, 'agent-a1.jsonl');
    const held = fs.readFileSync(agentFile);
    fs.rmSync(agentFile);
    assert.equal((await writeTimingAtClose(runDir, { env })).status, 'written');
    assert.equal(readManifestJson(runDir).costPartial, true);
    const timingBytes = fs.readFileSync(path.join(runDir, 'timing.json'), 'utf8');
    fs.writeFileSync(agentFile, held);
    assert.equal((await writeTimingAtClose(runDir, { env })).status, 'kept');
    assert.equal(readManifestJson(runDir).costPartial, false);
    assert.equal(fs.readFileSync(path.join(runDir, 'timing.json'), 'utf8'), timingBytes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC8.8: a kept close over a complete stored group reads no transcript rows for cost', async () => {
  const root = tmpRoot();
  try {
    const { runDir, env } = manifestRun(root);
    await writeTimingAtClose(runDir, { env });
    assert.equal(readManifestJson(runDir).costPartial, false);
    const bytes = fs.readFileSync(manifestFile(runDir), 'utf8');
    let calls = 0;
    await withStub(atClose, 'deriveCloseCost', async () => { calls += 1; return { costRows: null, deadlineHit: false }; }, async () => {
      assert.equal((await writeTimingAtClose(runDir, { env })).status, 'kept');
    });
    assert.equal(calls, 0);
    assert.equal(fs.readFileSync(manifestFile(runDir), 'utf8'), bytes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
