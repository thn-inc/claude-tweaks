'use strict';
// plugin/bin/lib/review-lens/history.js (#5998): the per-lens confirmed-finding rate over the last N runs.
// Every test passes a `liveness` stub returning 'dead' unless it says otherwise, so none spawns a real probe.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../../helpers/tmp-dir');
const { readLensHistory, confirmedCount, startedAtOf, DEFAULT_N } = require('../../../plugin/bin/lib/review-lens/history');
const { appendLensDispatch, LENS_IDS, LENS_DISPATCH_FILE } = require('../../../plugin/bin/lib/review-lens/dispatch-record');
const { SCHEMA_VERSION, deriveStepYield, writeStepYield } = require('../../../plugin/bin/lib/timing/step-yield');
const { formatEntry } = require('../../../plugin/bin/lib/log-decision/append');
const { appendEvent } = require('../../../plugin/bin/lib/hooks/context');

const dead = () => 'dead';
const entry = (lens, over = {}) => ({ lens, reviewers: 2, path: 'task', round: 1, status: 'completed', ...over });
const yieldDoc = (byLens) => ({
  schemaVersion: SCHEMA_VERSION,
  steps: [{ phase: 'review', findings: { byLens } }],
  unattributed: { findings: null },
  unparsed: { count: 0, samples: [] },
});

// opts: dispatch [entries] | null, yieldObj (byLens map) | 'missing' | 'malformed', yieldDoc (whole doc),
// specDispatch {N: [entries]}, state 'clean' | 'active' | null, rawDispatch (verbatim parent file text).
function makeRun(root, runId, opts = {}) {
  const { dispatch = null, yieldObj = {}, specDispatch = {}, state = 'clean', rawDispatch } = opts;
  const dir = path.join(root, runId);
  fs.mkdirSync(dir, { recursive: true });
  if (state !== null) fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ status: state }));
  if (rawDispatch !== undefined) fs.writeFileSync(path.join(dir, LENS_DISPATCH_FILE), rawDispatch);
  for (const e of dispatch || []) appendLensDispatch({ runDir: dir, entry: e });
  for (const [n, entries] of Object.entries(specDispatch)) {
    const sub = path.join(dir, `spec-${n}`);
    fs.mkdirSync(sub, { recursive: true });
    for (const e of entries) appendLensDispatch({ runDir: sub, entry: e });
  }
  if (opts.yieldDoc) fs.writeFileSync(path.join(dir, 'step-yield.json'), JSON.stringify(opts.yieldDoc));
  else if (yieldObj === 'malformed') fs.writeFileSync(path.join(dir, 'step-yield.json'), 'not json');
  else if (yieldObj !== 'missing') fs.writeFileSync(path.join(dir, 'step-yield.json'), JSON.stringify(yieldDoc(yieldObj)));
  return dir;
}
const id = (day, n, hms = '090000') => `2026-03-${String(day).padStart(2, '0')}T${hms}-record-${n}`;
const root = () => scratchDir('lens-history-');
const history = (roots, extra = {}) => readLensHistory({ roots: [].concat(roots), liveness: dead, ...extra });

test('AC1.1: 25 qualifying runs for 3d report the newest 20', () => {
  const r = root();
  const withFinding = new Set([4, 5, 21, 22, 23]);
  for (let i = 1; i <= 25; i++) {
    // Record numbers alternate so name order differs from time order (…-record-590 later than …-record-5770).
    makeRun(r, id(i, i % 2 ? 5770 + i : 590 + i), { dispatch: [entry('3d')], yieldObj: withFinding.has(i) ? { '3d': { both: 1 } } : {} });
  }
  const res = history(r);
  assert.deepStrictEqual(res.lenses['3d'], { runs: 20, confirmed: 3, perRun: 0.15, shareWithFinding: 0.15, insufficient: false });
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(DEFAULT_N, 20);
});

test('AC2.1/AC2.2: a dispatched lens with no finding line counts 0; no evidence does not count', () => {
  const r = root();
  makeRun(r, id(1, 1), { dispatch: [entry('3b')], yieldObj: {} });
  makeRun(r, id(2, 2), { dispatch: null, yieldObj: { '3b': { both: 4 } } });
  const res = history(r);
  assert.strictEqual(res.lenses['3b'].runs, 1);
  assert.strictEqual(res.lenses['3b'].confirmed, 0);
  assert.deepStrictEqual(res.errors, []);
});

test('AC2.3/AC2.4/AC2.5: failed, blocked and single-reviewer dispatches do not qualify', () => {
  const r = root();
  makeRun(r, id(1, 1), { dispatch: [entry('3c', { status: 'failed' })], yieldObj: { '3c': { both: 1 } } });
  makeRun(r, id(2, 2), { dispatch: [entry('3c', { status: 'blocked' })], yieldObj: { '3c': { both: 1 } } });
  makeRun(r, id(3, 3), { dispatch: [entry('3c', { reviewers: 1 })], yieldObj: { '3c': { both: 1 } } });
  const c = history(r).lenses['3c'];
  assert.strictEqual(c.runs, 0);
  assert.strictEqual(c.perRun, null);
  assert.strictEqual(c.insufficient, true);
});

test('a lens dispatched in several rounds counts as one run', () => {
  const r = root();
  makeRun(r, id(1, 1), { dispatch: [entry('3a'), entry('3a', { round: 2 })], yieldObj: { '3a': { both: 2 } } });
  const a = history(r).lenses['3a'];
  assert.strictEqual(a.runs, 1);
  assert.strictEqual(a.confirmed, 2);
});

test('AC3.1: an unclosed run is skipped as run not closed, never an error', () => {
  const r = root();
  const calls = [];
  const liveness = (dir) => { calls.push(path.basename(dir)); return 'live'; };
  const a = makeRun(r, id(1, 1), { dispatch: [entry('3e')], state: 'active', yieldObj: 'missing' });
  const b = makeRun(r, id(2, 2), { dispatch: [entry('3e')], state: 'active', yieldObj: { '3e': { both: 1 } } });
  const c = makeRun(r, id(3, 3), { dispatch: [entry('3e')], state: 'clean', yieldObj: { '3e': { both: 1 } } });
  const d = makeRun(r, id(4, 4), { state: 'active', yieldObj: 'missing', rawDispatch: '{"v":2,"entries":[]}' });
  const res = readLensHistory({ roots: [r], liveness });
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.lenses['3e'].runs, 0);
  for (const dir of [a, b, c, d]) assert.ok(res.skipped.some((s) => s.path === dir && s.reason === 'run not closed'), dir);
  assert.ok(!calls.includes(path.basename(a)), 'no probe when the file evidence already decides');
  assert.ok(!calls.includes(path.basename(d)));
});

test('AC3.2/AC3.4: a closed run with a missing or malformed step-yield.json is an error, never counted as 0', () => {
  const r = root();
  const a = makeRun(r, id(1, 1), { dispatch: [entry('3e')], yieldObj: 'missing' });
  const b = makeRun(r, id(2, 2), { dispatch: [entry('3e')], yieldObj: 'malformed' });
  const res = history(r);
  assert.strictEqual(res.lenses['3e'].runs, 0);
  const err = (dir) => res.errors.find((e) => e.path.startsWith(dir));
  assert.match(err(a).reason, /missing/);
  assert.match(err(b).reason, /unparseable/);
  assert.deepStrictEqual(res.skipped, []);
});

test('AC3.3: a run with no live owner and a yield or clean state is closed', () => {
  const r = root();
  makeRun(r, id(1, 1), { dispatch: [entry('3e')], state: 'clean', yieldObj: { '3e': { both: 1 } } });
  makeRun(r, id(2, 2), { dispatch: [entry('3e')], state: 'active', yieldObj: { '3e': { both: 1 } } });
  makeRun(r, id(3, 3), { dispatch: [entry('3e')], state: null, yieldObj: { '3e': { both: 1 } } });
  const verdicts = { [id(1, 1)]: 'dead', [id(2, 2)]: 'unknown', [id(3, 3)]: 'dead' };
  const res = readLensHistory({ roots: [r], liveness: (dir) => verdicts[path.basename(dir)] });
  assert.strictEqual(res.lenses['3e'].runs, 3);
  assert.deepStrictEqual(res.skipped, []);
});

test('AC6.3: a malformed yield in a closed run with no dispatch file is reported', () => {
  const r = root();
  const bad = makeRun(r, id(1, 1), { yieldObj: 'malformed' });
  makeRun(r, id(2, 2), { yieldObj: 'missing' });
  makeRun(r, id(3, 3), { yieldObj: { '3a': { both: 1 } } });
  const res = history(r);
  assert.strictEqual(res.errors.length, 1);
  assert.ok(res.errors[0].path.startsWith(bad));
  assert.match(res.errors[0].reason, /unparseable/);
  assert.deepStrictEqual(res.skipped, []);
  for (const l of LENS_IDS) assert.strictEqual(res.lenses[l].runs, 0);
});

test('AC6.3: a malformed yield in a not-closed run with no dispatch file is skipped', () => {
  const r = root();
  const dir = makeRun(r, id(1, 1), { state: 'active', yieldObj: 'malformed' });
  const res = readLensHistory({ roots: [r], liveness: () => 'live' });
  assert.deepStrictEqual(res.errors, []);
  assert.deepStrictEqual(res.skipped, [{ path: dir, reason: 'run not closed' }]);
});

test('AC4.1: two members dispatching the same lens exclude the parent for that lens', () => {
  const r = root();
  const dir = makeRun(r, id(1, 1), {
    yieldObj: { '3d': { both: 2 }, '3a': { both: 1 } },
    specDispatch: { 1: [entry('3d'), entry('3a')], 2: [entry('3d')] },
  });
  const res = history(r);
  assert.strictEqual(res.lenses['3d'].runs, 0);
  const s = res.skipped.find((x) => x.path === dir);
  assert.ok(s.reason.startsWith('multi-member dispatch'));
  for (const t of ['3d', 'spec-1', 'spec-2']) assert.ok(s.reason.includes(t), t);
  assert.strictEqual(res.lenses['3a'].runs, 1);
  assert.strictEqual(res.lenses['3a'].confirmed, 1);
});

test('AC4.2: a lens dispatched by exactly one member counts once with the parent yield', () => {
  const r = root();
  makeRun(r, id(1, 1), { yieldObj: { '3b': { both: 3 } }, specDispatch: { 12: [entry('3b'), entry('3b', { round: 2 })] } });
  const b = history(r).lenses['3b'];
  assert.strictEqual(b.runs, 1);
  assert.strictEqual(b.confirmed, 3);
});

test('AC5.1: 7 qualifying runs read insufficient', () => {
  const r = root();
  for (let i = 1; i <= 7; i++) makeRun(r, id(i, i), { dispatch: [entry('3f')] });
  const f = history(r).lenses['3f'];
  assert.strictEqual(f.runs, 7);
  assert.strictEqual(f.insufficient, true);
});

test('AC6.1: an unreadable root is reported, not read as empty', () => {
  const missing = path.join(root(), 'nope');
  const res = history(missing);
  assert.strictEqual(res.errors[0].path, missing);
  assert.match(res.errors[0].reason, /unreadable root/);
  for (const l of LENS_IDS) assert.strictEqual(res.lenses[l].runs, 0);
});

test('AC6.2: a yield of another schemaVersion is an error, never read', () => {
  const r = root();
  const dir = makeRun(r, id(1, 1), { dispatch: [entry('3a')], yieldDoc: { ...yieldDoc({ '3a': { both: 9 } }), schemaVersion: 99 } });
  const res = history(r);
  assert.strictEqual(res.lenses['3a'].runs, 0);
  assert.ok(res.errors.some((e) => e.path.startsWith(dir) && /not a schemaVersion 1 yield/.test(e.reason)));
});

test('AC7.1/AC7.2: relabeled adds to no confirmed count', () => {
  const r = root();
  makeRun(r, id(1, 1), {
    dispatch: [entry('3f'), entry('3b')],
    yieldObj: { '3f': { both: 2, relabeled: 1, tiebreak: { byVerdict: { confirmed: 1 } } }, '3b': { one: 1, relabeled: 1 } },
  });
  const res = history(r);
  assert.strictEqual(res.lenses['3f'].confirmed, 3);
  assert.strictEqual(res.lenses['3b'].confirmed, 0);
});

test('a run id with no parseable start time is skipped and listed', () => {
  const r = root();
  const dir = makeRun(r, 'unresolved-provenance', { dispatch: [entry('3a')] });
  const res = history(r);
  assert.ok(res.skipped.some((s) => s.path === dir && /start time/.test(s.reason)));
  assert.strictEqual(res.lenses['3a'].runs, 0);
});

test('an archived twin counts once, from the kept copy', () => {
  const r = root();
  const id1 = id(1, 1);
  const live = makeRun(r, id1, { dispatch: [entry('3a')], state: 'active', yieldObj: 'missing' });
  const arch = makeRun(path.join(r, 'archive'), id1, { dispatch: [entry('3a')], state: 'clean', yieldObj: { '3a': { both: 1 } } });
  const res = history(r);
  assert.strictEqual(res.lenses['3a'].runs, 1);
  assert.strictEqual(res.lenses['3a'].confirmed, 1);
  const dup = res.skipped.filter((s) => s.path === live);
  assert.strictEqual(dup.length, 1);
  assert.match(dup[0].reason, /duplicate run id \(kept .*archive/);
  assert.ok(dup[0].reason.includes(arch));
  assert.ok(!res.skipped.some((s) => s.reason === 'run not closed'));

  const r2 = root();
  const a = makeRun(r2, id1, { dispatch: [entry('3a')], yieldObj: { '3a': { both: 5 } } });
  const b = makeRun(path.join(r2, 'archive'), id1, { dispatch: [entry('3a')], yieldObj: { '3a': { both: 1 } } });
  const res2 = history(r2);
  assert.strictEqual(res2.lenses['3a'].confirmed, 1, 'both clean: the archive copy is kept');
  assert.ok(res2.skipped.some((s) => s.path === a && s.reason.includes(b)));
});

test('a malformed dispatch file is an error, not absence', () => {
  const r = root();
  const dir = makeRun(r, id(1, 1), { rawDispatch: '{"v":2,"entries":[]}' });
  const res = history(r);
  assert.ok(res.errors.some((e) => e.path === path.join(dir, LENS_DISPATCH_FILE)));
  for (const l of LENS_IDS) assert.strictEqual(res.lenses[l].runs, 0);
});

test('lens keys outside 3a-3h are ignored', () => {
  const r = root();
  const byLens = JSON.parse('{"__proto__":{"both":5},"unknown":{"both":5},"constructor":{"both":5},"3a":{"both":1}}');
  makeRun(r, id(1, 1), { dispatch: [entry('3a')], yieldObj: byLens });
  const res = history(r);
  assert.deepStrictEqual(Object.keys(res.lenses), LENS_IDS);
  assert.strictEqual(res.lenses['3a'].confirmed, 1);
});

test('confirmedCount matches the report formula', () => {
  const cases = [null, {}, { both: 2 }, { both: 'x', tiebreak: { byVerdict: { confirmed: NaN } } }, { both: 1, tiebreak: { byVerdict: { confirmed: 2 } } }];
  assert.deepStrictEqual(cases.map(confirmedCount), [0, 0, 2, 0, 3]);
});

test('startedAtOf reads the run id as UTC and refuses a non-instant', () => {
  assert.strictEqual(startedAtOf('2026-03-01T090000-record-1'), '2026-03-01T09:00:00.000Z');
  assert.strictEqual(startedAtOf('2026-13-01T090000-record-1'), null);
  assert.strictEqual(startedAtOf('unresolved'), null);
});

test('real writers: a derived step-yield.json and a recorded dispatch', () => {
  const r = root();
  const dir = path.join(r, '2026-11-12T090000-record-1');
  fs.mkdirSync(dir, { recursive: true });
  const BASE = Date.UTC(2026, 10, 12, 9, 0, 0);
  const at = (sec) => new Date(BASE + sec * 1000);
  for (const [sec, type, data] of [
    [0, 'skill_invoked', { skill: 'claude-tweaks:build' }],
    [1200, 'skill_invoked', { skill: 'claude-tweaks:review' }],
    [2400, 'skill_invoked', { skill: 'claude-tweaks:wrap-up' }],
    [2700, 'close-run', {}],
  ]) {
    const Real = Date;
    class Frozen extends Real {
      constructor(...a) { if (a.length === 0) super(at(sec).getTime()); else super(...a); }
      static now() { return at(sec).getTime(); }
    }
    global.Date = Frozen;
    try { appendEvent(dir, type, data); } finally { global.Date = Real; }
  }
  fs.writeFileSync(path.join(dir, 'decisions.md'), [
    '# Decisions', '',
    formatEntry({ status: 'AUTO', now: at(1210), step: 'Reproduction', text: 'lens "3a" finding plugin/a.js:10 reproduced. Confirmed.', reversibility: 'high' }),
    '',
  ].join('\n'));
  writeStepYield(dir, deriveStepYield(dir, { now: at(3000) }));
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  appendLensDispatch({ runDir: dir, entry: entry('3a') });
  const res = history(r);
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.lenses['3a'].runs, 1);
  assert.strictEqual(res.lenses['3a'].confirmed, 1);
});

test('the default liveness is runLiveness', () => {
  const r = root();
  const d = new Date(Date.now() - 30 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const runId = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-record-1`;
  makeRun(r, runId, { dispatch: [entry('3a')], state: 'clean', yieldObj: {} });
  const res = readLensHistory({ roots: [r] });
  assert.strictEqual(res.lenses['3a'].runs, 1);
});

test('argument validation', () => {
  const r = root();
  assert.throws(() => readLensHistory({ roots: [r], n: 0 }), TypeError);
  assert.throws(() => readLensHistory({ roots: [r], n: 1.5 }), TypeError);
  assert.throws(() => readLensHistory({ roots: [] }), TypeError);
  assert.throws(() => readLensHistory({ roots: [1] }), TypeError);
  assert.throws(() => readLensHistory({ roots: [r], liveness: 'x' }), TypeError);
});
