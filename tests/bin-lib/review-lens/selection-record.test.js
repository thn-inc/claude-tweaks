'use strict';
// plugin/bin/lib/review-lens/selection-record.js (#6001): the lens-selection.json writer/reader and the skip streaks.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../../helpers/tmp-dir');
const { chmodDenialSkip } = require('../../helpers/root');
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

test('a document whose selected and skipped do not partition the tier is malformed, never a streak end', () => {
  const root = scratchDir('sel-part-');
  const bad = (selected, skipped, tier = 'high') => JSON.stringify({ v: 1, tier, selected, skipped, fallback: null });
  const sk = (l) => ({ lens: l, reason: 'r' });
  for (const text of [
    bad([], []), // empty lists
    bad(['3b', '3c', '3a', '3f', '3d', '3e', '3g'], []), // 3h missing
    bad(['3b', '3c', '3a', '3f', '3d', '3e', '3g', '3h'], [sk('3d')]), // overlap
    bad(['3b', '3b', '3a', '3f', '3d', '3e', '3g', '3h'], []), // duplicate
    bad(['3b', '3c', '3a', '3f', '3d', '3e'], [sk('3g'), sk('3h')], 'medium'), // lenses outside the tier
    bad(['3b', '3c', '3a', '3d'], [], 'medium'), // the right count, one lens outside the tier in place of 3f
  ]) {
    fs.writeFileSync(path.join(root, LENS_SELECTION_FILE), text);
    assert.strictEqual(readLensSelection(root).state, 'error', text);
  }
  const run = makeRun(root, ID(5), sel('high', ['3d']));
  fs.writeFileSync(path.join(run, LENS_SELECTION_FILE), bad([], []));
  const r = readSkipStreaks({ roots: [root] });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /lens-selection\.json/);
});

test('writeLensSelection refuses a malformed selection and writes nothing', () => {
  const root = scratchDir('sel-wr-');
  assert.throws(() => writeLensSelection(root, { tier: 'high', selected: [], skipped: [], fallback: null }), TypeError);
  assert.throws(() => writeLensSelection(root, { tier: 'nope', selected: [], skipped: [], fallback: null }), TypeError);
  assert.strictEqual(fs.existsSync(path.join(root, LENS_SELECTION_FILE)), false);
});

test('the scan stops once every streak has ended: a malformed file older than that leaves ok:true', () => {
  const root = scratchDir('sel-old-');
  makeRun(root, ID(5), sel('high', ['3d']));
  makeRun(root, ID(4), sel('high', []));
  const old = makeRun(root, ID(3));
  fs.writeFileSync(path.join(old, LENS_SELECTION_FILE), '{oops');
  const r = readSkipStreaks({ roots: [root] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.byLens['3d'], 1);
  // a lens that has not ended yet (a low-tier history never reaches 3d) keeps the scan going into the malformed file
  const root2 = scratchDir('sel-old2-');
  makeRun(root2, ID(5), sel('low'));
  const old2 = makeRun(root2, ID(3));
  fs.writeFileSync(path.join(old2, LENS_SELECTION_FILE), '{oops');
  assert.strictEqual(readSkipStreaks({ roots: [root2] }).ok, false);
});

test('a live twin holding the file beats an archive twin without one; otherwise archive beats live', () => {
  const root = scratchDir('sel-twin2-');
  makeRun(root, ID(4), sel('high', ['3d'])); // live copy holds the file, the archive twin has none
  makeRun(path.join(root, 'archive'), ID(4));
  makeRun(root, ID(3), sel('high', ['3d'])); // both twins hold a file: archive wins
  makeRun(path.join(root, 'archive'), ID(3), sel('high', []));
  const r = readSkipStreaks({ roots: [root] });
  // ID(4) -> skips 3d (the live copy's file); ID(3) -> archive copy selects 3d, so the streak ends at 1
  assert.strictEqual(r.byLens['3d'], 1);
});

test('a symlinked pipelines root and archive are read through; an archive that is a file is ignored', (t) => {
  if (process.platform === 'win32') return t.skip('symlink creation needs privileges on Windows');
  const base = scratchDir('sel-link-');
  const real = path.join(base, 'real');
  makeRun(real, ID(4), sel('high', ['3d']));
  makeRun(path.join(real, 'archive'), ID(3), sel('high', ['3d']));
  const link = path.join(base, 'link');
  fs.symlinkSync(real, link, 'dir');
  assert.strictEqual(readSkipStreaks({ roots: [link] }).byLens['3d'], 2);
  const realArchive = path.join(base, 'elsewhere');
  makeRun(realArchive, ID(2), sel('high', ['3d']));
  const root = path.join(base, 'root');
  makeRun(root, ID(4), sel('high', ['3d']));
  fs.symlinkSync(realArchive, path.join(root, 'archive'), 'dir');
  assert.strictEqual(readSkipStreaks({ roots: [root] }).byLens['3d'], 2);
  const fileArchive = path.join(base, 'filearch');
  makeRun(fileArchive, ID(4), sel('high', ['3d']));
  fs.writeFileSync(path.join(fileArchive, 'archive'), 'not a directory');
  // history.js (childDirs) treats ENOTDIR as a missing archive, not an error; so does this reader.
  const r = readSkipStreaks({ roots: [fileArchive] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.byLens['3d'], 1);
});

test('I2: multi-spec member runs count as runs, dated by their parent', () => {
  const root = scratchDir('sel-member-');
  const parent = makeRun(root, ID(5));
  makeRun(parent, 'spec-1', sel('high', ['3d']));
  makeRun(parent, 'spec-2', sel('high', ['3d']));
  makeRun(root, ID(4), sel('high', ['3d']));
  makeRun(root, ID(3), sel('high', []));
  assert.strictEqual(readSkipStreaks({ roots: [root] }).byLens['3d'], 3);
  // The current member is excluded by its run-relative identity; the basename `spec-2` excludes nothing.
  assert.strictEqual(readSkipStreaks({ roots: [root], excludeRunId: `${ID(5)}/spec-2` }).byLens['3d'], 2);
  assert.strictEqual(readSkipStreaks({ roots: [root], excludeRunId: 'spec-2' }).byLens['3d'], 3);
  // A directory that is not a spec-N member is not a run.
  makeRun(parent, 'evidence', sel('high', ['3d']));
  assert.strictEqual(readSkipStreaks({ roots: [root] }).byLens['3d'], 3);
});

test('I2: members order by number under their parent; a member twin in archive/ counts once', () => {
  const root = scratchDir('sel-member-order-');
  const parent = makeRun(root, ID(5));
  makeRun(parent, 'spec-2', sel('high', ['3d']));
  makeRun(parent, 'spec-10', sel('high', [])); // member 10 ran after member 2: it is the newest and ends the streak
  assert.strictEqual(readSkipStreaks({ roots: [root] }).byLens['3d'], 0);
  const root2 = scratchDir('sel-member-twin-');
  makeRun(makeRun(root2, ID(5)), 'spec-1', sel('high', ['3d']));
  makeRun(makeRun(path.join(root2, 'archive'), ID(5)), 'spec-1', sel('high', ['3d']));
  makeRun(root2, ID(4), sel('high', []));
  assert.strictEqual(readSkipStreaks({ roots: [root2] }).byLens['3d'], 1);
});

test('I2: a run whose members cannot be listed is ok:false once the scan reaches it', chmodDenialSkip('root bypasses mode bits'), () => {
  const root = scratchDir('sel-member-deny-');
  makeRun(root, ID(5), sel('high', ['3d']));
  const locked = makeRun(root, ID(4));
  fs.chmodSync(locked, 0o311);
  try {
    const r = readSkipStreaks({ roots: [root] });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /unreadable spec members/);
    // Older than every ended streak: never reached.
    const root2 = scratchDir('sel-member-deny2-');
    makeRun(root2, ID(5), sel('high', []));
    const old = makeRun(root2, ID(4));
    fs.chmodSync(old, 0o311);
    try {
      assert.strictEqual(readSkipStreaks({ roots: [root2] }).ok, true);
    } finally {
      fs.chmodSync(old, 0o755); // root-safe
    }
  } finally {
    fs.chmodSync(locked, 0o755); // root-safe
  }
});
