'use strict';
// run-timing.js (#5555 Task 1): the timing derivation phase-timing.js used to
// own, as a library the closing paths call in-process.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { runCli } = require('../../helpers/run-cli');
const { derivePhaseTiming, deriveTiming, collectDispatches, hasTokenTotals, writeTimingFile, runWindow } = require('../../../plugin/bin/lib/timing/run-timing');
const { readUsage, readDispatches } =require('../../../plugin/bin/lib/timing/transcript');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'phase-timing.js');
const FIX = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'record-1535');

function fixtureCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-run-timing-'));
  for (const f of ['events.jsonl', 'manifest.yml']) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
  return dir;
}

function withoutRunSpecific(timing) {
  const { generatedAt, runDir, ...rest } = timing;
  return rest;
}

test('AC6.2: deriveTiming over the golden fixture equals the timing.json phase-timing.js writes', async () => {
  const a = fixtureCopy();
  const b = fixtureCopy();
  try {
    const r = await runCli(CLI, ['--run', a]);
    assert.equal(r.code, 0, r.stderr);
    const written = JSON.parse(fs.readFileSync(path.join(a, 'timing.json'), 'utf8'));
    const derived = await deriveTiming(b);
    assert.equal(derived.ok, true);
    assert.deepStrictEqual(withoutRunSpecific(derived.timing), withoutRunSpecific(written));
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});

test('derivePhaseTiming has no token keys and matches deriveTiming without transcripts', async () => {
  const dir = fixtureCopy();
  try {
    const p = derivePhaseTiming(dir);
    assert.equal(p.ok, true);
    assert.equal(Object.hasOwn(p.timing, 'unattributed'), false);
    assert.equal(Object.hasOwn(p.timing, 'dispatches'), false);
    assert.equal(Object.hasOwn(p.timing.totals, 'tokens'), false);
    assert.equal(Object.hasOwn(p.timing, 'budget'), false);
    assert.ok(Array.isArray(p.events) && p.events.length > 0);
    const d = await deriveTiming(dir);
    assert.deepStrictEqual(withoutRunSpecific(d.timing), withoutRunSpecific(p.timing));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('derivePhaseTiming reports an unreadable events.jsonl', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-run-timing-'));
  try {
    fs.mkdirSync(path.join(dir, 'events.jsonl'));
    const r = derivePhaseTiming(dir);
    assert.equal(r.ok, false);
    assert.match(r.error, /^events\.jsonl unreadable \(/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hasTokenTotals: absent totals.tokens, all-zero sum, and positive sum', () => {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  assert.equal(hasTokenTotals({ totals: { minutes: 1 } }), false);
  assert.equal(hasTokenTotals({ totals: { tokens: zero } }), false);
  assert.equal(hasTokenTotals({ totals: { tokens: { ...zero, cacheCreate: 3 } } }), true);
});

test('writeTimingFile carries budget forward and leaves no temp file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-run-timing-'));
  try {
    fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify({ budget: { profile: 'standard' } }));
    const written = writeTimingFile(dir, { runDir: dir, phases: [], totals: { minutes: 0 } });
    assert.equal(written, path.join(dir, 'timing.json'));
    const back = JSON.parse(fs.readFileSync(written, 'utf8'));
    assert.deepStrictEqual(back.budget, { profile: 'standard' });
    assert.deepStrictEqual(back.totals, { minutes: 0 });
    assert.equal(fs.readdirSync(dir).some((n) => n.startsWith('timing.json.tmp-')), false);
    // An own budget key wins over the carried one.
    writeTimingFile(dir, { phases: [], budget: { skipped: true } });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(written, 'utf8')).budget, { skipped: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeTimingFile treats an unparseable existing timing.json as absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-run-timing-'));
  try {
    fs.writeFileSync(path.join(dir, 'timing.json'), '{not json');
    writeTimingFile(dir, { phases: [] });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8')), { phases: [] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeTimingFile throws and creates nothing when runDir is gone', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-run-timing-'));
  const gone = path.join(base, 'vanished');
  try {
    assert.throws(() => writeTimingFile(gone, { phases: [] }));
    assert.deepStrictEqual(fs.readdirSync(base), []);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('deriveTiming with a readUsageImpl that never resolves returns deadlineHit within the deadline', { timeout: 5000 }, async () => {
  const dir = fixtureCopy();
  // Mock timers drive the deadline (no wall-clock budget): pending just before it, settled at it.
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    let entered = false;
    let settled = false;
    const p = deriveTiming(dir, {
      transcriptPaths: ['never.jsonl'],
      cwd: dir,
      deadlineAt: Date.now() + 200,
      readUsageImpl: () => { entered = true; return new Promise(() => {}); },
    }).finally(() => { settled = true; });
    for (let i = 0; i < 5000 && !entered; i++) await new Promise((res) => setImmediate(res));
    assert.equal(entered, true, 'the hung reader was never reached');
    mock.timers.tick(199);
    for (let i = 0; i < 20; i++) await new Promise((res) => setImmediate(res));
    assert.equal(settled, false, 'deriveTiming returned before its deadline');
    mock.timers.tick(1);
    const r = await p;
    assert.equal(r.ok, true);
    assert.equal(r.deadlineHit, true);
    assert.equal(Object.hasOwn(r.timing.totals, 'tokens'), false);
    assert.equal(Object.hasOwn(r.timing, 'dispatches'), false);
    assert.equal(Object.hasOwn(r.timing, 'transcripts'), false);
  } finally {
    mock.timers.reset();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deriveTiming passes an abort signal to readUsageImpl and aborts it at the deadline', { timeout: 5000 }, async () => {
  const dir = fixtureCopy();
  try {
    let seen = null;
    const r = await deriveTiming(dir, {
      transcriptPaths: ['never.jsonl'],
      cwd: dir,
      deadlineAt: Date.now() + 100,
      readUsageImpl: (p, opts) => { seen = opts.signal; return new Promise(() => {}); },
    });
    assert.equal(r.deadlineHit, true);
    assert.ok(seen && seen.aborted === true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deriveTiming wantTokens true with no transcript still yields the zero-row token object', async () => {
  const dir = fixtureCopy();
  try {
    const r = await deriveTiming(dir, { wantTokens: true, notes: ['tokens: transcript not found (x)'] });
    assert.equal(r.ok, true);
    assert.ok(r.tokens);
    assert.equal(r.tokens.totals.rows, 0);
    assert.deepStrictEqual(r.timing.notes, ['tokens: transcript not found (x)']);
    assert.equal(hasTokenTotals(r.timing), false);
    assert.ok(Object.hasOwn(r.timing.totals, 'tokens'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readUsage with an aborted signal destroys a real slow stream', { timeout: 5000 }, async () => {
  let stream = null;
  const fsImpl = {
    statSync: () => ({ isFile: () => true }),
    createReadStream: () => {
      stream = new Readable({ read() {} });
      const timer = setInterval(() => stream.push('{"not":"a row"}\n'), 50);
      stream.on('close', () => clearInterval(timer));
      return stream;
    },
  };
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 100);
  await assert.rejects(readUsage('slow.jsonl', { fsImpl, signal: ctl.signal }), (err) => err.code === 'ABORT_ERR');
  assert.equal(stream.destroyed, true);
});

test('deriveTiming returns deadlineHit when the deadline passes between the transcript reads and collectDispatches', { timeout: 5000 }, async (t) => {
  const dir = fixtureCopy();
  try {
    // The clock is pinned until the one transcript read finishes, then jumps past
    // the deadline, so the read itself wins its race and only collectDispatches sees it expire.
    const start = Date.now();
    let now = start;
    t.mock.method(Date, 'now', () => now);
    const r = await deriveTiming(dir, {
      transcriptPaths: [path.join(dir, 'main.jsonl')],
      cwd: dir,
      deadlineAt: start + 10000,
      readUsageImpl: async () => { now = start + 20000; return []; },
    });
    assert.equal(r.ok, true);
    assert.equal(r.deadlineHit, true);
    assert.equal(Object.hasOwn(r.timing, 'dispatches'), false);
    assert.equal(Object.hasOwn(r.timing.totals, 'tokens'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('phase-timing run derives each CLI run once: events.jsonl is read a single time', async (t) => {
  const dir = fixtureCopy();
  try {
    const original = fs.readFileSync;
    let eventReads = 0;
    t.mock.method(fs, 'readFileSync', (file, ...rest) => {
      if (typeof file === 'string' && path.basename(file) === 'events.jsonl') eventReads += 1;
      return original.call(fs, file, ...rest);
    });
    const r = await runCli(CLI, ['--run', dir]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(eventReads, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readUsage with an already-aborted signal rejects without opening a stream', { timeout: 5000 }, async () => {
  let opened = false;
  const fsImpl = { statSync: () => ({ isFile: () => true }), createReadStream: () => { opened = true; return new Readable({ read() {} }); } };
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(readUsage('x.jsonl', { fsImpl, signal: ctl.signal }), (err) => err.code === 'ABORT_ERR');
  assert.equal(opened, false);
});

test('collectDispatches past its deadline, or with an aborted signal, returns null', { timeout: 5000 }, async () => {
  const dir = fixtureCopy();
  try {
    const events = [{ ts: '2026-09-05T14:00:00.000Z', type: 'session-end' }];
    const transcript = path.join(dir, 'main.jsonl');
    assert.equal(await collectDispatches([transcript], events, dir, { deadlineAt: Date.now() - 1 }), null);
    const ctl = new AbortController();
    ctl.abort();
    assert.equal(await collectDispatches([transcript], events, dir, { signal: ctl.signal }), null);
    // Control: unbounded, the same call resolves to a dispatches value, not null.
    const free = await collectDispatches([transcript], events, dir);
    assert.equal(typeof free.notFound, 'string');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readDispatches passes its signal to readUsage', { timeout: 5000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-run-timing-'));
  try {
    fs.writeFileSync(path.join(dir, 'agent-a.jsonl'), '');
    const ctl = new AbortController();
    ctl.abort();
    const r = await readDispatches(dir, { signal: ctl.signal });
    assert.match(r.items[0].notFound, /transcript not readable \(ABORT_ERR\)/);
    const free = await readDispatches(dir);
    assert.doesNotMatch(free.items[0].notFound, /ABORT_ERR/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deriveTiming uses a given base instead of reading the run directory again', async () => {
  const dir = fixtureCopy();
  try {
    const base = derivePhaseTiming(dir);
    fs.rmSync(path.join(dir, 'events.jsonl'));
    const r = await deriveTiming(dir, { base });
    assert.equal(r.ok, true);
    assert.deepStrictEqual(r.timing, base.timing);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A run created at 09:55 (its run id, UTC), with events at 10:00 and 10:10 and
// closed at 10:30 (run-state updatedAt), and a main transcript holding one row
// per region: before creation (another run's), pre-flight, in the event span,
// after the last event but before the close, and after the close.
function lifetimeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-run-timing-'));
  const dir = path.join(root, '2020-01-06T095500-record-1');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [
    { skill: 'claude-tweaks:build', ts: '2020-01-06T10:00:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:wrap-up', ts: '2020-01-06T10:10:00.000Z', type: 'skill_invoked' },
    // worktree-reaped fires hours later and never stretches the window.
    { ts: '2020-01-06T15:00:00.000Z', type: 'worktree-reaped' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ status: 'clean', worktree: null, updatedAt: '2020-01-06T10:30:00.000Z' }));
  const line = (id, ts, n) => JSON.stringify({ timestamp: ts, message: { role: 'assistant', id, model: 'claude-test', content: [], usage: { input_tokens: n, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  const transcript = path.join(root, 'main.jsonl');
  fs.writeFileSync(transcript, [
    line('m0', '2020-01-06T09:50:00.000Z', 1000), // before creation: another run's
    line('m1', '2020-01-06T09:57:00.000Z', 1), // pre-flight, before the first event
    line('m2', '2020-01-06T10:05:00.000Z', 2),
    line('m3', '2020-01-06T10:20:00.000Z', 4), // after the last event, before the close
    line('m4', '2020-01-06T12:00:00.000Z', 50000), // after the close
  ].join('\n') + '\n');
  return { root, dir, transcript };
}

test('deriveTiming clipToRunWindow: rows from run creation through close count — pre-flight and after the last event included; the default is unclipped', async () => {
  const { root, dir, transcript } = lifetimeFixture();
  try {
    const clipped = await deriveTiming(dir, { transcriptPaths: [transcript], cwd: dir, clipToRunWindow: true });
    assert.equal(clipped.ok, true);
    assert.equal(clipped.timing.totals.tokens.input, 7);
    assert.equal(clipped.timing.transcripts[0].rows, 3);
    const whole = await deriveTiming(dir, { transcriptPaths: [transcript], cwd: dir });
    assert.equal(whole.timing.totals.tokens.input, 51007);
    assert.equal(whole.timing.transcripts[0].rows, 5);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runWindow: run id or an earlier createdAt starts it, updatedAt ends it; without them the event span; nothing bounding it → null', () => {
  const { root, dir } = lifetimeFixture();
  try {
    const ev = [{ ts: '2020-01-06T10:00:00.000Z' }, { ts: '2020-01-06T10:10:00.000Z' }];
    const at = (iso) => Date.parse(iso);
    assert.deepStrictEqual(runWindow(dir, ev, { updatedAt: '2020-01-06T10:30:00.000Z' }), { start: at('2020-01-06T09:55:00Z'), end: at('2020-01-06T10:30:00.000Z') });
    assert.deepStrictEqual(runWindow(dir, ev, { createdAt: '2020-01-06T09:40:00.000Z', updatedAt: '2020-01-06T10:30:00.000Z' }).start, at('2020-01-06T09:40:00.000Z'));
    const plain = path.join(root, 'not-a-run-id');
    assert.deepStrictEqual(runWindow(plain, ev, {}), { start: at('2020-01-06T10:00:00.000Z'), end: at('2020-01-06T10:10:00.000Z') });
    assert.equal(runWindow(plain, [{ type: 'x' }], null), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deriveTiming clipToRunWindow: no row in the lifetime → zero rows and a note naming it', async () => {
  const { root, dir, transcript } = lifetimeFixture();
  try {
    fs.writeFileSync(transcript, JSON.stringify({ timestamp: '2026-11-16T09:00:00.000Z', message: { role: 'assistant', id: 'x', model: 'claude-test', content: [], usage: { input_tokens: 9, output_tokens: 0 } } }) + '\n');
    const none = await deriveTiming(dir, { transcriptPaths: [transcript], cwd: dir, clipToRunWindow: true });
    assert.equal(none.timing.totals.tokens.input, 0);
    assert.equal(none.timing.transcripts[0].rows, 0);
    assert.ok(none.notes.some((n) => /no usage rows in the run's lifetime/.test(n)), JSON.stringify(none.notes));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deriveTiming clipToRunWindow: a dispatch inside the run window but before the first event is counted; the default event window excludes it', async () => {
  const { root, dir, transcript } = lifetimeFixture();
  try {
    const sub = path.join(root, 'main', 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    // 09:57 is after the run's creation (09:55 from the run id) and before its first event (10:00).
    fs.writeFileSync(path.join(sub, 'agent-pre.jsonl'), JSON.stringify({ type: 'assistant', timestamp: '2020-01-06T09:57:00.000Z', message: { id: 'pre1', role: 'assistant', model: 'claude-test', content: [], usage: { input_tokens: 3, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + '\n');
    const clipped = await deriveTiming(dir, { transcriptPaths: [transcript], cwd: dir, clipToRunWindow: true });
    assert.equal(clipped.timing.dispatches.items.length, 1);
    assert.equal(clipped.timing.dispatches.excludedOutsideWindow, 0);
    const whole = await deriveTiming(dir, { transcriptPaths: [transcript], cwd: dir });
    assert.equal(whole.timing.dispatches.items.length, 0);
    assert.equal(whole.timing.dispatches.excludedOutsideWindow, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// #5556: timing.questions from the kept rows.
function questionsFixture(lines) {
  const base = lifetimeFixture();
  fs.writeFileSync(base.transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return base;
}
const qAsk = (id, ts, questions) => ({ timestamp: ts, message: { role: 'assistant', id: 'm-' + id, model: 'claude-test', content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions: questions.map((question) => ({ question })) } }], usage: {} } });
const qRes = (id, ts) => ({ timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });

test('#5556: deriveTiming sets timing.questions with ask and answer times, ordered by ask time', async () => {
  const { root, dir, transcript } = questionsFixture([
    qAsk('toolu_b', '2020-01-06T10:06:00.000Z', ['Second?']),
    qAsk('toolu_q1', '2020-01-06T10:05:00.000Z', ['Pick?']),
    qRes('toolu_q1', '2020-01-06T10:08:30.000Z'),
  ]);
  try {
    const r = await deriveTiming(dir, { transcriptPaths: [transcript], cwd: dir });
    assert.deepEqual(r.timing.questions, [
      { id: 'toolu_q1', askTs: '2020-01-06T10:05:00.000Z', answerTs: '2020-01-06T10:08:30.000Z', questions: ['Pick?'] },
      { id: 'toolu_b', askTs: '2020-01-06T10:06:00.000Z', answerTs: null, questions: ['Second?'] },
    ]);
    const keys = Object.keys(r.timing);
    assert.ok(keys.indexOf('questions') > keys.indexOf('dispatches'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#5556: timing.questions is [] with no ask, absent without tokens, and clipped like the usage rows', async () => {
  const none = lifetimeFixture();
  try {
    const r = await deriveTiming(none.dir, { transcriptPaths: [none.transcript], cwd: none.dir });
    assert.deepEqual(r.timing.questions, []);
    const bare = await deriveTiming(none.dir, { wantTokens: false });
    assert.equal('questions' in bare.timing, false);
  } finally {
    fs.rmSync(none.root, { recursive: true, force: true });
  }
  const { root, dir, transcript } = questionsFixture([
    qAsk('toolu_old', '2020-01-06T09:50:00.000Z', ['Before?']),
    qRes('toolu_old', '2020-01-06T09:51:00.000Z'),
    qRes('toolu_clipped', '2020-01-06T10:01:00.000Z'),
    qAsk('toolu_in', '2020-01-06T10:02:00.000Z', ['In?']),
    qAsk('toolu_in', '2020-01-06T10:03:00.000Z', ['Dup?']),
    qRes('toolu_in', '2020-01-06T12:00:00.000Z'),
  ]);
  try {
    const r = await deriveTiming(dir, { transcriptPaths: [transcript], cwd: dir, clipToRunWindow: true });
    assert.deepEqual(r.timing.questions, [{ id: 'toolu_in', askTs: '2020-01-06T10:02:00.000Z', answerTs: null, questions: ['In?'] }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- #5647: scopeDispatchesTo ----
// Guards -> tests: the empty/absent-scope no-op ("an empty or absent scope keeps all five"), the
// own-slug-vs-Task-call-only provenance split ("an own-slug path" here, and at-close.test.js's
// per-directory case), the chain walk ("keeps only descendants": g1 is two hops from t1), the drop
// of scoped items ("drops every scoped agent").
function scopedSession() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-scope-'));
  const sub = path.join(dir, 'sess', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const main = path.join(dir, 'sess.jsonl');
  fs.writeFileSync(main, '');
  for (const [id, parent] of [['t1', null], ['c1', 't1'], ['g1', 'c1'], ['t2', null], ['c2', 't2']]) {
    fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify({ spawnDepth: parent ? 2 : 1, description: id, ...(parent ? { parentAgentId: parent } : {}) }));
    fs.writeFileSync(path.join(sub, `agent-${id}.jsonl`), JSON.stringify({ timestamp: '2026-11-16T10:01:00.000Z', message: { role: 'assistant', id: `m-${id}`, model: 'claude-test', content: [], usage: { input_tokens: 1, output_tokens: 1 } } }) + '\n');
  }
  return { dir, sub, main };
}

test('scopeDispatchesTo keeps only descendants of the scoped agents', async () => {
  const { dir, sub } = scopedSession();
  try {
    const t1 = path.join(fs.realpathSync(sub), 'agent-t1.jsonl');
    const d = await collectDispatches([t1], [], dir, { scopeDispatchesTo: [t1] });
    assert.deepEqual(d.items.map((i) => i.agentId).sort(), ['c1', 'g1']);
    assert.equal(Object.values(d.byRole).reduce((n, b) => n + b.dispatches, 0), 2);
    assert.equal(Object.values(d.byTier).reduce((n, b) => n + b.dispatches, 0), 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scopeDispatchesTo: an empty or absent scope keeps all five', async () => {
  const { dir, main } = scopedSession();
  try {
    for (const opts of [{ scopeDispatchesTo: [] }, {}]) {
      const d = await collectDispatches([main], [], dir, opts);
      assert.deepEqual(d.items.map((i) => i.agentId).sort(), ['c1', 'c2', 'g1', 't1', 't2']);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scopeDispatchesTo: a directory reached through an own-slug path keeps its window view minus the scoped agents', async () => {
  // Red without it: scoping every directory to descendants (no own-slug rule) leaves only c1 and g1.
  const { dir, sub, main } = scopedSession();
  try {
    const t1 = path.join(fs.realpathSync(sub), 'agent-t1.jsonl');
    const d = await collectDispatches([main, t1], [], dir, { scopeDispatchesTo: [t1] });
    assert.deepEqual(d.items.map((i) => i.agentId).sort(), ['c1', 'c2', 'g1', 't2']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scopeDispatchesTo: agents in a parentAgentId cycle never reach a scoped agent and are excluded', async () => {
  // Red without it: the chain walk's last-resort `return false` (hop cap / cycle) mutated to `return true` keeps x and y.
  const { dir, sub } = scopedSession();
  try {
    for (const [id, parent] of [['x', 'y'], ['y', 'x']]) {
      fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify({ spawnDepth: 2, description: id, parentAgentId: parent }));
      fs.writeFileSync(path.join(sub, `agent-${id}.jsonl`), JSON.stringify({ timestamp: '2026-11-16T10:01:00.000Z', message: { role: 'assistant', id: `m-${id}`, model: 'claude-test', content: [], usage: { input_tokens: 1, output_tokens: 1 } } }) + '\n');
    }
    const t1 = path.join(fs.realpathSync(sub), 'agent-t1.jsonl');
    const d = await collectDispatches([t1], [], dir, { scopeDispatchesTo: [t1] });
    assert.deepEqual(d.items.map((i) => i.agentId).sort(), ['c1', 'g1']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scopeDispatchesTo drops every scoped agent, even one whose parent is scoped too', async () => {
  const { dir, sub } = scopedSession();
  try {
    const real = fs.realpathSync(sub);
    const scope = ['t1', 'c1'].map((id) => path.join(real, `agent-${id}.jsonl`));
    const d = await collectDispatches(scope, [], dir, { scopeDispatchesTo: scope });
    assert.deepEqual(d.items.map((i) => i.agentId), ['g1']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
