'use strict';
// plugin/bin/lib/review-lens/selection-record.js (#6001): the lens-selection.json writer/reader and the skip streaks.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../../helpers/tmp-dir');
const { LENS_IDS } = require('../../../plugin/bin/lib/review-lens/dispatch-record');
const { TIER_LENSES } = require('../../../plugin/bin/lib/review-lens/select');
const { LENS_SELECTION_FILE, writeLensSelection, readLensSelection, readSkipStreaks } = require('../../../plugin/bin/lib/review-lens/selection-record');

// A selection for `tier` that skips `skipped` and selects the rest of the tier's lenses.
const sel = (tier, skipped = [], fallback = null) => ({
  tier,
  selected: TIER_LENSES[tier].filter((l) => !skipped.includes(l)),
  skipped: skipped.map((lens) => ({ lens, reason: `${lens}: below floor` })),
  fallback,
});
function makeRun(root, runId, selection) {
  const dir = path.join(root, runId);
  fs.mkdirSync(dir, { recursive: true });
  if (selection !== undefined) writeLensSelection(dir, selection);
  return dir;
}
const ID = (n) => `2026-11-0${n}T100000-record-${n}`;

test('round-trips a selection', () => {
  const root = scratchDir('sel-rt-');
  const s = sel('high', ['3d']);
  writeLensSelection(root, s);
  assert.deepStrictEqual(readLensSelection(root), { state: 'ok', doc: { v: 1, ...s } });
  assert.strictEqual(LENS_SELECTION_FILE, 'lens-selection.json');
});

test('absent and malformed files read distinctly', () => {
  const root = scratchDir('sel-bad-');
  assert.deepStrictEqual(readLensSelection(root), { state: 'absent' });
  for (const text of ['{not json', '[]', '{"v":2,"tier":"high","selected":[],"skipped":[],"fallback":null}',
    '{"v":1,"tier":"nope","selected":[],"skipped":[],"fallback":null}',
    '{"v":1,"tier":"high","selected":"3a","skipped":[],"fallback":null}',
    '{"v":1,"tier":"high","selected":[],"skipped":[{"lens":"9z"}],"fallback":null}',
    '{"v":1,"tier":"high","selected":[],"skipped":[],"fallback":5}']) {
    fs.writeFileSync(path.join(root, LENS_SELECTION_FILE), text);
    assert.strictEqual(readLensSelection(root).state, 'error', text);
  }
});

test('streak counts consecutive newest runs where the tier allowed the lens and it was skipped', () => {
  const root = scratchDir('sel-streak-');
  makeRun(root, ID(5), sel('high', ['3d']));
  makeRun(root, ID(4), sel('high', ['3d']));
  makeRun(root, ID(3), sel('high', []));
  makeRun(root, ID(2), sel('high', ['3d']));
  const r = readSkipStreaks({ roots: [root] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.byLens['3d'], 2);
  for (const l of LENS_IDS) assert.ok(Number.isInteger(r.byLens[l]) && r.byLens[l] >= 0, l);
  assert.strictEqual(r.byLens['3e'], 0);
});

test('a run whose tier lacks the lens neither counts nor breaks; a fallback run breaks', () => {
  const root = scratchDir('sel-tier-');
  makeRun(root, ID(5), sel('high', ['3d']));
  makeRun(root, ID(4), sel('low'));
  makeRun(root, ID(3), sel('high', ['3d']));
  assert.strictEqual(readSkipStreaks({ roots: [root] }).byLens['3d'], 2);
  const root2 = scratchDir('sel-fb-');
  makeRun(root2, ID(5), sel('high', ['3d']));
  makeRun(root2, ID(4), sel('high', [], 'history unreadable'));
  makeRun(root2, ID(3), sel('high', ['3d']));
  assert.strictEqual(readSkipStreaks({ roots: [root2] }).byLens['3d'], 1);
});

test('orders by run id timestamp, not directory order; undated ids and runs without a file are ignored', () => {
  const root = scratchDir('sel-order-');
  makeRun(root, 'zzz-undated', sel('high', []));
  makeRun(root, ID(1), sel('high', []));
  makeRun(root, ID(2), sel('high', ['3d']));
  makeRun(root, ID(3));
  assert.strictEqual(readSkipStreaks({ roots: [root] }).byLens['3d'], 1);
});

test('excludes the current run id and dedupes archive twins', () => {
  const root = scratchDir('sel-twin-');
  makeRun(root, ID(5), sel('high', []));
  makeRun(root, ID(4), sel('high', ['3d']));
  makeRun(path.join(root, 'archive'), ID(4), sel('high', ['3d']));
  assert.strictEqual(readSkipStreaks({ roots: [root] }).byLens['3d'], 0);
  assert.strictEqual(readSkipStreaks({ roots: [root], excludeRunId: ID(5) }).byLens['3d'], 1);
});

test('Review Focus 5: one malformed lens-selection.json makes streaks unreadable', () => {
  const root = scratchDir('sel-mal-');
  makeRun(root, ID(5), sel('high', ['3d']));
  const bad = makeRun(root, ID(4));
  fs.writeFileSync(path.join(bad, LENS_SELECTION_FILE), '{oops');
  const r = readSkipStreaks({ roots: [root] });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /lens-selection\.json/);
});

test('an unreadable root is ok:false; a root with no selection files is ok:true with all zeros', () => {
  const missing = path.join(scratchDir('sel-miss-'), 'nope');
  const r = readSkipStreaks({ roots: [missing] });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /unreadable root/);
  const empty = scratchDir('sel-empty-');
  makeRun(empty, ID(1));
  assert.deepStrictEqual(readSkipStreaks({ roots: [empty] }), { ok: true, byLens: Object.fromEntries(LENS_IDS.map((l) => [l, 0])) });
  assert.throws(() => readSkipStreaks({ roots: [] }), TypeError);
});
