'use strict';
// run-timing.js (#5555 Task 1): the timing derivation phase-timing.js used to
// own, as a library the closing paths call in-process.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { runCli } = require('../../helpers/run-cli');
const { derivePhaseTiming, deriveTiming, hasTokenTotals, writeTimingFile } = require('../../../plugin/bin/lib/timing/run-timing');
const { readUsage } = require('../../../plugin/bin/lib/timing/transcript');

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

test('deriveTiming with a readUsageImpl that never resolves returns deadlineHit within the deadline', async () => {
  const dir = fixtureCopy();
  try {
    const started = Date.now();
    const r = await deriveTiming(dir, {
      transcriptPaths: ['never.jsonl'],
      cwd: dir,
      deadlineAt: Date.now() + 200,
      readUsageImpl: () => new Promise(() => {}),
    });
    assert.ok(Date.now() - started < 2000);
    assert.equal(r.ok, true);
    assert.equal(r.deadlineHit, true);
    assert.equal(Object.hasOwn(r.timing.totals, 'tokens'), false);
    assert.equal(Object.hasOwn(r.timing, 'dispatches'), false);
    assert.equal(Object.hasOwn(r.timing, 'transcripts'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deriveTiming passes an abort signal to readUsageImpl and aborts it at the deadline', async () => {
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

test('readUsage with an aborted signal destroys a real slow stream', async () => {
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

test('readUsage with an already-aborted signal rejects without opening a stream', async () => {
  let opened = false;
  const fsImpl = { statSync: () => ({ isFile: () => true }), createReadStream: () => { opened = true; return new Readable({ read() {} }); } };
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(readUsage('x.jsonl', { fsImpl, signal: ctl.signal }), (err) => err.code === 'ABORT_ERR');
  assert.equal(opened, false);
});
