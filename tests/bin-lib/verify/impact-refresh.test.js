'use strict';
// Drift-triggered impact-map refresh (#5947): loadImpactContext runs impact.fetch once when a usable map's
// drift-selected test files exceed DRIFT_REFRESH_TESTS, rate-limited by a marker beside the shared map.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  DEFAULT_MAP_NAME, DRIFT_REFRESH_TESTS, REFRESH_WINDOW_MS, REFRESH_MARKER_NAME,
  encodeImpactMap, loadImpactContext,
} = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'impact.js'));

const OLD = '0123456789abcdef0123456789abcdef01234567';
const NEW = 'fedcba9876543210fedcba9876543210fedcba98';
const ROOT = path.join(path.sep, 'repo');
const COMMON = path.join(ROOT, '.git');
const MAP_PATH = path.join(COMMON, DEFAULT_MAP_NAME);
const MARKER = path.join(COMMON, REFRESH_MARKER_NAME);
const NOW = 1_000_000_000;
const DECL = { impact: { suite: 'tests', command: 'run {files}', tests: ['tests/**/*.test.js'], maxAgeCommits: 5, map: null, fetch: 'fetch-map' } };

// The map knows a.test.js and d000..d099 (the "selectable" drift files); u### files are unknown to it.
const KNOWN = Array.from({ length: 100 }, (_, i) => `tests/d${String(i).padStart(3, '0')}.test.js`);
const UNKNOWN = Array.from({ length: 100 }, (_, i) => `tests/u${String(i).padStart(3, '0')}.test.js`); // at HEAD, not in the map
const mapText = (commit) => JSON.stringify(encodeImpactMap({
  commit, tracedAt: 't', exitCode: 0, node: 'v',
  tests: Object.fromEntries(['tests/a.test.js', ...KNOWN].map((t) => [t, { f: ['src/x.js'] }])),
}));
// A drift spec is a count of selectable files (known to the map, listed at HEAD), or { sel, unknown } to add
// raw drift files the map does not know.
const driftOf = (spec) => {
  const { sel, unknown = 0 } = typeof spec === 'number' ? { sel: spec } : spec;
  return [...KNOWN.slice(0, sel), ...Array.from({ length: unknown }, (_, i) => `tests/u${String(i).padStart(3, '0')}.test.js`)].join('\0') + '\0';
};

// opts: drift (by commit -> drift spec), distance (by commit), marker (mtime ms or undefined), absentAtHead (drift
// files ls-files omits), statThrows, writeThrows.
function world({ drift, distance = {}, marker, absentAtHead = 0, statThrows = false, writeThrows = false }) {
  const files = { [MAP_PATH]: mapText(OLD) };
  const writes = [];
  const fsImpl = {
    readFileSync(p) {
      if (Object.hasOwn(files, p)) return files[p];
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    },
    lstatSync() { return { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false }; },
    statSync(p) {
      if (statThrows) throw new Error('EACCES');
      if (p === MARKER && marker !== undefined) return { mtimeMs: marker };
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    },
    writeFileSync(p, content) {
      if (writeThrows) throw new Error('EROFS');
      writes.push({ p, content });
    },
  };
  const execImpl = (cmd, args) => {
    if (args[0] === 'ls-files') return ['tests/a.test.js', ...KNOWN.slice(absentAtHead), ...UNKNOWN].join('\0') + '\0';
    if (args[0] === 'merge-base') return '';
    if (args[0] === 'rev-list') return `${distance[args[3].split('..')[0]] ?? 2}\n`;
    if (args[0] === 'diff') return driftOf(drift[args[5]] ?? 0);
    // (a drift file the map knows but ls-files omits is "absent at HEAD": the first `absentAtHead` of KNOWN)
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return { files, writes, fsImpl, execImpl };
}

// A runFetch that counts calls and, on success, swaps in a map at `newCommit`.
function fetcher(w, { exitCode = 0, timedOut = false, newCommit = NEW, newText = null } = {}) {
  const f = { calls: 0 };
  f.run = (command) => {
    f.calls += 1;
    assert.strictEqual(command, 'fetch-map');
    if (exitCode === 0) w.files[MAP_PATH] = newText || mapText(newCommit);
    return { ran: true, exitCode: timedOut ? null : exitCode, durationMs: 1, timedOut, signal: null };
  };
  return f;
}

const load = (w, f, extra = {}) => loadImpactContext({
  decl: DECL, repoRoot: ROOT, commonDir: COMMON, execImpl: w.execImpl, fsImpl: w.fsImpl, runFetch: f ? f.run : null, now: NOW, ...extra,
});

test('constants', () => {
  assert.strictEqual(DRIFT_REFRESH_TESTS, 50);
  assert.strictEqual(REFRESH_WINDOW_MS, 600000);
  assert.strictEqual(REFRESH_MARKER_NAME, 'claude-tweaks-test-impact.refresh-attempt');
});

test('drift above the threshold fetches once and adopts the reloaded map with less drift', () => {
  const w = world({ drift: { [OLD]: 51, [NEW]: 3 } });
  const f = fetcher(w);
  const ctx = load(w, f);
  assert.strictEqual(f.calls, 1);
  assert.strictEqual(ctx.problem, null);
  assert.strictEqual(ctx.mapCommit, NEW);
  assert.strictEqual(ctx.driftTests.length, 3);
  assert.strictEqual(ctx.fetch.exitCode, 0);
  assert.deepStrictEqual(w.writes, [{ p: MARKER, content: String(NOW) }]);
});

test('drift of exactly the threshold does not fetch', () => {
  const w = world({ drift: { [OLD]: 50 } });
  const f = fetcher(w);
  const ctx = load(w, f);
  assert.strictEqual(f.calls, 0);
  assert.strictEqual(ctx.driftTests.length, 50);
  assert.strictEqual(ctx.fetch, null);
  assert.deepStrictEqual(w.writes, []);
});

test('raw drift above the threshold but not selectable (unknown to the map, or absent at HEAD) does not fetch', () => {
  const unknown = world({ drift: { [OLD]: { sel: 10, unknown: 60 } } });
  const f1 = fetcher(unknown);
  const ctx1 = load(unknown, f1);
  assert.strictEqual(f1.calls, 0);
  assert.strictEqual(ctx1.driftTests.length, 70, 'the returned drift list stays raw');
  const absent = world({ drift: { [OLD]: 60 }, absentAtHead: 20 });
  const f2 = fetcher(absent);
  load(absent, f2);
  assert.strictEqual(f2.calls, 0, '60 raw, 40 present at HEAD');
  const present = world({ drift: { [OLD]: 60, [NEW]: 1 }, absentAtHead: 9 });
  const f3 = fetcher(present);
  assert.strictEqual(load(present, f3).mapCommit, NEW);
  assert.strictEqual(f3.calls, 1, '51 present at HEAD triggers');
});

test('adoption compares selectable drift, not raw drift', () => {
  // The reload has more raw drift (70) but less selectable (10): adopted.
  const lessSelectable = world({ drift: { [OLD]: 60, [NEW]: { sel: 10, unknown: 60 } } });
  const ctx1 = load(lessSelectable, fetcher(lessSelectable));
  assert.strictEqual(ctx1.mapCommit, NEW);
  assert.strictEqual(ctx1.driftTests.length, 70);
  // The reload has less raw drift (55) but more selectable (55 > 51): kept.
  const moreSelectable = world({ drift: { [OLD]: { sel: 51, unknown: 40 }, [NEW]: 55 } });
  const ctx2 = load(moreSelectable, fetcher(moreSelectable));
  assert.strictEqual(ctx2.mapCommit, OLD);
  assert.strictEqual(ctx2.driftTests.length, 91);
});

test('a future-dated marker (clock correction) does not block the fetch', () => {
  const w = world({ drift: { [OLD]: 60, [NEW]: 1 }, marker: NOW + 5 * 60 * 1000 });
  const f = fetcher(w);
  assert.strictEqual(load(w, f).mapCommit, NEW);
  assert.strictEqual(f.calls, 1);
});

test('a marker inside the window blocks the fetch; one older than the window allows it', () => {
  const fresh = world({ drift: { [OLD]: 60, [NEW]: 1 }, marker: NOW - REFRESH_WINDOW_MS + 1000 });
  const f1 = fetcher(fresh);
  assert.strictEqual(load(fresh, f1).mapCommit, OLD);
  assert.strictEqual(f1.calls, 0);
  const old = world({ drift: { [OLD]: 60, [NEW]: 1 }, marker: NOW - REFRESH_WINDOW_MS - 1000 });
  const f2 = fetcher(old);
  assert.strictEqual(load(old, f2).mapCommit, NEW);
  assert.strictEqual(f2.calls, 1);
});

for (const [label, opts] of [['a non-zero exit', { exitCode: 3 }], ['a timeout', { timedOut: true, exitCode: 1 }]]) {
  test(`${label} keeps the original map and drift, writes the marker, and is not retried inside the window`, () => {
    const w = world({ drift: { [OLD]: 60, [NEW]: 1 } });
    const f = fetcher(w, opts);
    const ctx = load(w, f);
    assert.strictEqual(f.calls, 1);
    assert.strictEqual(ctx.mapCommit, OLD);
    assert.strictEqual(ctx.driftTests.length, 60);
    assert.strictEqual(ctx.problem, null);
    assert.deepStrictEqual(w.writes, [{ p: MARKER, content: String(NOW) }]);
    // A second load within the window: the marker the first one wrote is now present.
    const again = world({ drift: { [OLD]: 60 }, marker: NOW });
    const f2 = fetcher(again, opts);
    load(again, f2, { now: NOW + 1000 });
    assert.strictEqual(f2.calls, 0);
  });
}

test('a reloaded map with a problem, or with more drift, is not adopted', () => {
  const broken = world({ drift: { [OLD]: 60, [NEW]: 1 } });
  const ctx1 = load(broken, fetcher(broken, { newText: '{not json' }));
  assert.strictEqual(ctx1.mapCommit, OLD);
  assert.strictEqual(ctx1.driftTests.length, 60);
  assert.strictEqual(ctx1.problem, null);
  const stale = world({ drift: { [OLD]: 60, [NEW]: 1 }, distance: { [NEW]: 9 } });
  const ctx2 = load(stale, fetcher(stale));
  assert.strictEqual(ctx2.mapCommit, OLD);
  const bigger = world({ drift: { [OLD]: 60, [NEW]: 61 } });
  const ctx3 = load(bigger, fetcher(bigger));
  assert.strictEqual(ctx3.mapCommit, OLD);
  assert.strictEqual(ctx3.driftTests.length, 60);
});

test('a hard-stale map still fetches with a fresh marker, and the drift refresh does not fetch again', () => {
  const fresh = world({ drift: { [OLD]: 60, [NEW]: 60 }, distance: { [OLD]: 9 }, marker: NOW });
  const f0 = fetcher(fresh);
  assert.strictEqual(load(fresh, f0).mapCommit, NEW);
  assert.strictEqual(f0.calls, 1);
  // No marker at all: the reloaded map still has drift above the threshold, yet one load fetches once.
  const w = world({ drift: { [OLD]: 60, [NEW]: 60 }, distance: { [OLD]: 9 } });
  const f = fetcher(w);
  const ctx = load(w, f);
  assert.strictEqual(f.calls, 1);
  assert.strictEqual(ctx.mapCommit, NEW);
  assert.strictEqual(ctx.driftTests.length, 60);
  assert.deepStrictEqual(w.writes, []);
});

test('no fetch command or no runFetch never fetches', () => {
  const w = world({ drift: { [OLD]: 60 } });
  const f = fetcher(w);
  const noCmd = loadImpactContext({
    decl: { impact: { ...DECL.impact, fetch: null } }, repoRoot: ROOT, commonDir: COMMON, execImpl: w.execImpl, fsImpl: w.fsImpl, runFetch: f.run, now: NOW,
  });
  assert.strictEqual(f.calls, 0);
  assert.strictEqual(noCmd.driftTests.length, 60);
  const noRunner = load(w, null);
  assert.strictEqual(noRunner.driftTests.length, 60);
  assert.deepStrictEqual(w.writes, []);
});

test('a marker that cannot be read or written never breaks loading', () => {
  const noStat = world({ drift: { [OLD]: 60, [NEW]: 1 }, statThrows: true });
  const f1 = fetcher(noStat);
  assert.strictEqual(load(noStat, f1).mapCommit, NEW);
  assert.strictEqual(f1.calls, 1);
  const noWrite = world({ drift: { [OLD]: 60, [NEW]: 1 }, writeThrows: true });
  const f2 = fetcher(noWrite);
  assert.strictEqual(load(noWrite, f2).mapCommit, NEW);
  assert.strictEqual(f2.calls, 1);
});
