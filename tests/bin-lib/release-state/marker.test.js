'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MARKER_FILE, MARKER_VERSION, SHA_RE, RUN_RE, REASON_RE, INIT_RUN, ISO_UTC_RE,
  parseMarker, serializeMarker, VERDICTS, descentVerdict, compareVerdict, compareOnLine,
  createLocalHistory, createCompareHistory, createHistory,
  OUTCOMES, storeFacade, advanceMarker, initMarker, resetMarker, resetMessageFits,
} = require('../../../plugin/bin/lib/release-state/marker');
const { readStateFile, writeStateFile, createStateFile } = require('../../../plugin/bin/lib/release-state/store');
const {
  makeLine, realRunner, rewriteMain, pushMainCommit, shallowClone, setupGit, commitRawState,
  VALID_MARKER: VALID, MALFORMED_MARKERS,
} = require('./fixtures');

// The malformed shapes live in fixtures.js, so another suite imports them from there
// rather than requiring this file (which would re-register every test here).
function assertRejected(value) {
  const r = parseMarker(value);
  assert.equal(r.marker, undefined, `parsed as a marker: ${JSON.stringify(value)}`);
  assert.equal(typeof r.error, 'string');
  assert.ok(r.error.length > 0);
}

test('marker: constants are the frozen contract', () => {
  assert.equal(MARKER_FILE, 'reviewed-through.json');
  assert.equal(MARKER_VERSION, 1);
  assert.equal(SHA_RE.source, '^[0-9a-f]{40}$');
  assert.equal(RUN_RE.source, '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$');
  assert.equal(REASON_RE.source, '^[^\\r\\n#]{1,200}$');
  assert.equal(INIT_RUN, 'init');
  assert.equal(ISO_UTC_RE.source, '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$');
});

test('AC8.2/AC8.3: each malformed marker shape is an error, never a marker', () => {
  for (const [label, value] of MALFORMED_MARKERS) assert.doesNotThrow(() => assertRejected(value), label);
  // Control: a valid marker with an extra key parses, and the extra key is dropped.
  assert.deepEqual(parseMarker({ ...VALID, note: 'kept out' }), { marker: VALID });
  assert.deepEqual(parseMarker({ ...VALID, run: INIT_RUN }), { marker: { ...VALID, run: INIT_RUN } });
  assert.deepEqual(parseMarker({ ...VALID, advancedAt: '2026-11-18T10:00:00Z' }).marker.advancedAt, '2026-11-18T10:00:00Z');
});

test('marker: serializeMarker bytes are pinned', () => {
  const bytes = serializeMarker({ sha: 'a'.repeat(40), advancedAt: '2026-11-18T10:00:00.000Z', run: 'r1' });
  assert.equal(bytes, `{\n  "version": 1,\n  "sha": "${'a'.repeat(40)}",\n  "advancedAt": "2026-11-18T10:00:00.000Z",\n  "run": "r1"\n}\n`);
  assert.deepEqual(parseMarker(JSON.parse(bytes)), { marker: VALID });
  // It never writes a marker a reader would refuse.
  assert.throws(() => serializeMarker({ ...VALID, sha: 'A'.repeat(40) }), TypeError);
});

test('descentVerdict: the decision table', () => {
  const line = new Set(['p1', 'p2', 'p3']);
  const never = () => { throw new Error('isAncestor must not be asked'); };
  const v = (from, to, complete, isAncestor = never) => descentVerdict(from, to, { line, complete, isAncestor }).verdict;
  const rows = [
    [v('x', 'p3', true), 'orphaned'],
    [v('x', 'p3', false), 'undetermined'],
    [v('p2', 'p2', true), 'same'],
    [v('p1', 'x', true), 'off-line'],
    [v('p1', 'x', false), 'undetermined'],
    [v('p1', 'p3', true, () => true), 'descendant'],
    [v('p3', 'p1', true, () => false), 'backward'],
    [v('p1', 'p3', true, () => 'undetermined'), 'undetermined'],
  ];
  for (const [got, want] of rows) assert.equal(got, want);
  assert.deepEqual([...new Set(rows.map(([, want]) => want))].sort(), [...VERDICTS].sort());
  const r = descentVerdict('x', 'p3', { line, complete: true, isAncestor: never });
  assert.equal(typeof r.reason, 'string');
  assert.ok(r.reason.length > 0);
});

// A first-parent line F <- A <- M <- T, where M is a merge whose second parent is the side
// commit S (forked from F). Shas are 40-hex so the compare history's path guard admits them.
const F = '1'.repeat(40);
const A = '2'.repeat(40);
const S = '3'.repeat(40);
const M = '4'.repeat(40);
const T = '5'.repeat(40);
const X = '6'.repeat(40);
const commit = (sha, ...parents) => ({ sha, parents });
const AHEAD_FROM_F = {
  status: 'ahead', total_commits: 4, commits: [commit(A, F), commit(S, F), commit(M, A, S), commit(T, M)],
};

test('compareVerdict: walks parents[0] only', () => {
  const on = { tip: T, compare: AHEAD_FROM_F };
  assert.equal(compareVerdict(F, S, on).verdict, 'off-line');
  assert.equal(compareVerdict(F, M, on).verdict, 'descendant');
  assert.equal(compareVerdict(F, T, on).verdict, 'descendant');
  assert.equal(compareVerdict(F, F, on).verdict, 'same');
  assert.equal(compareVerdict(F, X, on).verdict, 'off-line');
  assert.equal(compareOnLine(F, on), true);
  // S...T lists A, M, T: the walk T -> M -> A -> F leaves the set without reaching S.
  const fromS = { tip: T, compare: { status: 'ahead', total_commits: 3, commits: [commit(A, F), commit(M, A, S), commit(T, M)] } };
  assert.equal(compareVerdict(S, T, fromS).verdict, 'orphaned');
  assert.equal(compareOnLine(S, fromS), false);
  const behind = { tip: T, compare: { status: 'behind', total_commits: 0, commits: [] } };
  assert.equal(compareVerdict(X, T, behind).verdict, 'orphaned');
  assert.equal(compareOnLine(X, behind), false);
  const diverged = { tip: T, compare: { status: 'diverged', total_commits: 1, commits: [commit(T, M)] } };
  assert.equal(compareVerdict(X, T, diverged).verdict, 'orphaned');
  const partial = { tip: T, compare: { ...AHEAD_FROM_F, total_commits: 3, commits: AHEAD_FROM_F.commits.slice(0, 2) } };
  assert.equal(compareVerdict(F, T, partial).verdict, 'undetermined');
  assert.equal(compareOnLine(F, partial), 'undetermined');
  const notFound = { tip: T, compare: { notFound: true } };
  assert.equal(compareVerdict(X, T, notFound).verdict, 'orphaned');
  assert.equal(compareOnLine(X, notFound), false);
  const malformed = { tip: T, compare: { status: 'sideways', total_commits: 0, commits: [] } };
  assert.equal(compareVerdict(F, T, malformed).verdict, 'undetermined');
});

test('compareVerdict: a malformed parents entry is undetermined, never orphaned', () => {
  const withM = (parents) => ({
    tip: T,
    compare: {
      status: 'ahead', total_commits: 4, commits: [commit(A, F), commit(S, F), { sha: M, parents }, commit(T, M)],
    },
  });
  assert.equal(compareVerdict(F, T, withM([null])).verdict, 'undetermined');
  assert.equal(compareVerdict(F, T, withM(['not-a-sha'])).verdict, 'undetermined');
  assert.equal(compareVerdict(F, T, withM([A, 'A'.repeat(40)])).verdict, 'undetermined');
  assert.equal(compareOnLine(F, withM([null])), 'undetermined');
  const badSha = { tip: T, compare: { ...AHEAD_FROM_F, commits: [...AHEAD_FROM_F.commits, { sha: 'x', parents: [T] }] } };
  assert.equal(compareVerdict(F, T, badSha).verdict, 'undetermined');
  // A sha-valid listing that loops (M's first parent is A, A's is M) passes the shape check
  // and reaches the walk's loop guard: undetermined, never orphaned.
  const cyclic = { tip: T, compare: { status: 'ahead', total_commits: 3, commits: [commit(A, M), commit(M, A), commit(T, M)] } };
  assert.equal(compareVerdict(F, T, cyclic).verdict, 'undetermined');
  // An empty `parents` is a root commit, where the first-parent walk legitimately ends: the
  // base was reached only through a second parent, so it is orphaned.
  const rootOnWalk = { tip: T, compare: { status: 'ahead', total_commits: 3, commits: [commit(A), commit(M, A, F), commit(T, M)] } };
  assert.equal(compareVerdict(F, T, rootOnWalk).verdict, 'orphaned');
});

test('compareVerdict: identical is never walked', () => {
  const identical = { tip: T, compare: { status: 'identical', total_commits: 0, commits: [] } };
  assert.equal(compareOnLine(T, identical), true);
  assert.equal(compareVerdict(T, T, identical).verdict, 'same');
  assert.equal(compareVerdict(T, X, identical).verdict, 'off-line');
});

const COMPARE_Q = '{status, total_commits, commits: [.commits[] | {sha, parents: [.parents[].sha]}]}';
const ok = (stdout) => ({ stdout, failure: null, status: null });
const notFound = () => ({
  stdout: null, failure: null, status: 404, error: 'Not Found (HTTP 404)',
});

// A fake ghApi that records every call and throws on any path no route names.
function fakeGh(routes) {
  const calls = [];
  const ghApi = (args) => {
    calls.push(args);
    const route = routes[args[0]];
    if (!route) throw new Error(`unexpected ${args.join(' ')}`);
    return typeof route === 'function' ? route(args) : route;
  };
  return { ghApi, calls };
}

const hex = (n) => n.toString(16).padStart(40, '0');

test('createCompareHistory: argv and pagination', () => {
  const base = hex(0x1000);
  const chain = Array.from({ length: 101 }, (_, i) => commit(hex(i + 1), i === 0 ? base : hex(i)));
  const tip = hex(101);
  const page = (n) => `repos/o/r/compare/${base}...${tip}?per_page=100&page=${n}`;
  const gh = fakeGh({
    'repos/o/r/git/ref/heads/main': ok(`${tip}\n`),
    [page(1)]: ok(JSON.stringify({ status: 'ahead', total_commits: 101, commits: chain.slice(0, 100) })),
    [page(2)]: ok(JSON.stringify({ status: 'ahead', total_commits: 101, commits: chain.slice(100) })),
  });
  const h = createCompareHistory({ ghApi: gh.ghApi, slug: 'o/r' });
  assert.equal(h.verdict(base, hex(50)).verdict, 'descendant');
  assert.deepEqual(gh.calls, [
    ['repos/o/r/git/ref/heads/main', '-q', '.object.sha'],
    [page(1), '-q', COMPARE_Q],
    [page(2), '-q', COMPARE_Q],
  ]);
  assert.ok(gh.calls.flat().every((a) => a !== '-f' && a !== '-F'));

  const encoded = fakeGh({ 'repos/o/r/git/ref/heads/release/v1%23x': ok(`${T}\n`), [`repos/o/r/compare/${T}...${T}?per_page=100&page=1`]: ok(JSON.stringify({ status: 'identical', total_commits: 0, commits: [] })) });
  assert.deepEqual(createCompareHistory({ ghApi: encoded.ghApi, slug: 'o/r', branch: 'release/v1#x' }).onLine(T), { onLine: true });
  assert.deepEqual(encoded.calls[0], ['repos/o/r/git/ref/heads/release/v1%23x', '-q', '.object.sha']);
});

test('createCompareHistory: a 404 is notFound, any other failure is undetermined', () => {
  const tipPath = 'repos/o/r/git/ref/heads/main';
  const range = `repos/o/r/compare/${X}...${T}?per_page=100&page=1`;
  const lost = fakeGh({ [tipPath]: ok(`${T}\n`), [range]: notFound() });
  assert.equal(createCompareHistory({ ghApi: lost.ghApi, slug: 'o/r' }).verdict(X, T).verdict, 'orphaned');
  const down = fakeGh({ [tipPath]: ok(`${T}\n`), [range]: { stdout: null, failure: 'network-failure', status: null } });
  assert.equal(createCompareHistory({ ghApi: down.ghApi, slug: 'o/r' }).verdict(X, T).verdict, 'undetermined');
  // A tip that cannot be read (an inaccessible repository 404s too) is never orphaned.
  const noTip = fakeGh({ [tipPath]: notFound() });
  assert.equal(createCompareHistory({ ghApi: noTip.ghApi, slug: 'o/r' }).verdict(X, T).verdict, 'undetermined');
  assert.ok('undetermined' in createCompareHistory({ ghApi: noTip.ghApi, slug: 'o/r' }).onLine(X));
});

test('history: a compare-history membership miss re-reads the tip once: a newer tip from a competitor is seen, never orphaned', () => {
  // The tip read first answers M, then T: a competitor's T landed past the snapshot.
  const tips = [M, T, T];
  const gh = fakeGh({
    'repos/o/r/git/ref/heads/main': () => ok(`${tips.shift()}\n`),
    [`repos/o/r/compare/${F}...${M}?per_page=100&page=1`]: ok(JSON.stringify({ status: 'ahead', total_commits: 3, commits: [commit(A, F), commit(S, F), commit(M, A, S)] })),
    [`repos/o/r/compare/${F}...${T}?per_page=100&page=1`]: ok(JSON.stringify(AHEAD_FROM_F)),
  });
  const h = createCompareHistory({ ghApi: gh.ghApi, slug: 'o/r' });
  assert.equal(h.verdict(F, A).verdict, 'descendant');
  assert.equal(h.verdict(F, T).verdict, 'descendant');
  assert.equal(h.verdict(F, S).verdict, 'off-line');
  assert.equal(gh.calls.filter((a) => a[0].endsWith('/git/ref/heads/main')).length, 2);
});

test('history: a failed compare-history tip re-read keeps the previous tip and listings', () => {
  const tips = [ok(`${M}\n`), { stdout: null, failure: 'network-failure', status: null }];
  const gh = fakeGh({
    'repos/o/r/git/ref/heads/main': () => tips.shift(),
    [`repos/o/r/compare/${F}...${M}?per_page=100&page=1`]: ok(JSON.stringify({ status: 'ahead', total_commits: 3, commits: [commit(A, F), commit(S, F), commit(M, A, S)] })),
  });
  const h = createCompareHistory({ ghApi: gh.ghApi, slug: 'o/r' });
  assert.equal(h.verdict(F, A).verdict, 'descendant');
  // The miss that triggered the failed re-read is undetermined: the fresh state is unknown.
  assert.equal(h.verdict(F, T).verdict, 'undetermined');
  // Later calls still answer from the tip and listing read before.
  assert.equal(h.verdict(F, M).verdict, 'descendant');
  assert.equal(h.verdict(F, S).verdict, 'off-line');
  assert.equal(gh.calls.filter((a) => a[0].endsWith('/git/ref/heads/main')).length, 2);
});

// A ghApi serving `per` fresh commits on every compare page, for the pagination bounds.
function pagingGh(base, tip, { total, per, emptyFrom = Infinity }) {
  const pages = [];
  const ghApi = (args) => {
    if (args[0] === 'repos/o/r/git/ref/heads/main') return ok(`${tip}\n`);
    const m = /^repos\/o\/r\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})\?per_page=100&page=(\d+)$/.exec(args[0]);
    if (!m || m[1] !== base || m[2] !== tip) throw new Error(`unexpected ${args.join(' ')}`);
    const n = Number(m[3]);
    pages.push(n);
    const commits = n >= emptyFrom ? [] : Array.from({ length: per }, (_, i) => commit(hex(n * 1000 + i), hex(n * 1000 + i + 1)));
    return ok(JSON.stringify({ status: 'ahead', total_commits: total, commits }));
  };
  return { ghApi, pages };
}

test('createCompareHistory: an empty page stops the listing, and a short listing is undetermined', () => {
  const gh = pagingGh(F, T, { total: 150, per: 100, emptyFrom: 2 });
  const r = createCompareHistory({ ghApi: gh.ghApi, slug: 'o/r' }).verdict(F, T);
  assert.equal(r.verdict, 'undetermined');
  assert.match(r.reason, /listed 100 of 150 commits/);
  assert.deepEqual(gh.pages, [1, 2]);
});

test('createCompareHistory: a listing past 100 pages is undetermined after exactly 100 page reads', () => {
  const gh = pagingGh(F, T, { total: 1000000, per: 100 });
  const r = createCompareHistory({ ghApi: gh.ghApi, slug: 'o/r' }).verdict(F, T);
  assert.equal(r.verdict, 'undetermined');
  assert.match(r.reason, /past 100 pages/);
  assert.equal(gh.pages.length, 100);
  assert.deepEqual(gh.pages.slice(-1), [100]);
});

// The scratch refs a local history leaves in a clone: none, once each answer returns.
function scratchRefs(clone) {
  return setupGit(['for-each-ref', '--format=%(refname)', 'refs/release-state-history/'], clone);
}

test('AC1.1 (descent): P1->P3 descendant', () => {
  const fx = makeLine();
  const h = createLocalHistory({ git: realRunner(fx.cloneA) });
  assert.equal(h.verdict(fx.P1, fx.P3).verdict, 'descendant');
  assert.deepEqual(h.onLine(fx.P3), { onLine: true });
  assert.equal(scratchRefs(fx.cloneA), '');
});

test('AC2.1 (descent): P3->P1 backward; P1->S off-line', () => {
  const fx = makeLine();
  // Precondition: S is an ancestor of the branch, only not on its first-parent line.
  setupGit(['merge-base', '--is-ancestor', fx.S, `origin/${fx.branch}`], fx.cloneA);
  const h = createLocalHistory({ git: realRunner(fx.cloneA) });
  assert.equal(h.verdict(fx.P3, fx.P1).verdict, 'backward');
  assert.equal(h.verdict(fx.P1, fx.S).verdict, 'off-line');
  assert.deepEqual(h.onLine(fx.S), { onLine: false });
});

test('AC7.1 (descent): P2->P2 same', () => {
  const fx = makeLine();
  assert.equal(createLocalHistory({ git: realRunner(fx.cloneA) }).verdict(fx.P2, fx.P2).verdict, 'same');
});

test("AC8.4/AC8.5 (descent): after rewriteMain, P3->P3' is orphaned", () => {
  const fx = makeLine();
  const rewritten = rewriteMain(fx);
  const h = createLocalHistory({ git: realRunner(fx.cloneA) });
  assert.equal(h.verdict(fx.P3, rewritten).verdict, 'orphaned');
  assert.deepEqual(h.onLine(fx.P3), { onLine: false });
  assert.deepEqual(h.onLine(rewritten), { onLine: true });
});

test('AC8.1 (descent): a shallow clone answers what it holds and is undetermined on a miss, never refused or orphaned', () => {
  const fx = makeLine();
  const h = createLocalHistory({ git: realRunner(shallowClone(fx, 2)) });
  assert.equal(h.verdict(fx.P4, fx.P5).verdict, 'descendant');
  assert.equal(h.verdict(fx.P1, fx.P5).verdict, 'undetermined');
  assert.ok('undetermined' in h.onLine(fx.P1));
});

test('AC8.1 (descent): a failed fetch is undetermined', () => {
  const fx = makeLine();
  setupGit(['remote', 'set-url', 'origin', path.join(fx.root, 'missing.git')], fx.cloneA);
  const h = createLocalHistory({ git: realRunner(fx.cloneA) });
  const r = h.verdict(fx.P1, fx.P3);
  assert.equal(r.verdict, 'undetermined');
  assert.match(r.reason, /^fetch failed — /);
  assert.match(h.onLine(fx.P1).undetermined, /^fetch failed — /);
  assert.equal(scratchRefs(fx.cloneA), '');
});

test('history: a membership miss refreshes the snapshot once: a newer commit from a competitor is seen, never orphaned', () => {
  const fx = makeLine();
  const run = realRunner(fx.cloneA);
  let fetches = 0;
  const git = (args, opts) => {
    if (args[0] === 'fetch') fetches += 1;
    return run(args, opts);
  };
  const h = createLocalHistory({ git });
  assert.equal(h.verdict(fx.P1, fx.P3).verdict, 'descendant');
  const P6 = pushMainCommit(fx, fx.cloneB);
  assert.equal(h.verdict(fx.P5, P6).verdict, 'descendant');
  // The refresh is spent: a second miss answers from the refreshed snapshot.
  assert.equal(h.verdict(fx.P5, fx.S).verdict, 'off-line');
  assert.equal(fetches, 2);
});

test('history: the local history argv is pinned, and FETCH_HEAD is never written', () => {
  const fx = makeLine();
  const run = realRunner(fx.cloneA);
  const calls = [];
  const git = (args, opts) => {
    calls.push(args);
    return run(args, opts);
  };
  assert.equal(createLocalHistory({ git }).verdict(fx.P1, fx.P3).verdict, 'descendant');
  const fetch = calls[0];
  assert.deepEqual(fetch.slice(0, 5), ['fetch', '-q', '--no-tags', '--no-write-fetch-head', 'origin']);
  assert.equal(fetch.length, 6);
  assert.match(fetch[5], /^\+refs\/heads\/main:refs\/release-state-history\/\d+-\d+-[a-z0-9]*$/);
  const scratch = fetch[5].split(':')[1];
  // Pin the contract, not the call order: the scratch ref is deleted again, and every
  // later call that names a ref passes it after --end-of-options.
  assert.ok(calls.some((a) => a[0] === 'update-ref' && a[1] === '-d' && a[2] === scratch));
  for (const a of calls.slice(1)) {
    if (['rev-list', 'merge-base'].includes(a[0]) || (a[0] === 'rev-parse' && a.includes('--verify'))) {
      assert.ok(a.includes('--end-of-options'), `${a.join(' ')} names a ref without --end-of-options`);
    }
  }
  assert.equal(fs.existsSync(path.join(fx.cloneA, '.git', 'FETCH_HEAD')), false);
});

test('history: a failed refresh keeps the previous snapshot', () => {
  const fx = makeLine();
  const run = realRunner(fx.cloneA);
  let fetches = 0;
  const git = (args, opts) => {
    if (args[0] === 'fetch') fetches += 1;
    return run(args, opts);
  };
  const h = createLocalHistory({ git });
  assert.equal(h.verdict(fx.P1, fx.P3).verdict, 'descendant');
  setupGit(['remote', 'set-url', 'origin', path.join(fx.root, 'missing.git')], fx.cloneA);
  // The miss that triggered the failed refresh is undetermined: the fresh state is unknown.
  const missed = h.verdict(fx.P5, fx.S);
  assert.equal(missed.verdict, 'undetermined');
  assert.match(missed.reason, /^fetch failed — /);
  // Later calls answer from the snapshot taken before.
  assert.equal(h.verdict(fx.P2, fx.P5).verdict, 'descendant');
  assert.equal(h.verdict(fx.P5, fx.S).verdict, 'off-line');
  assert.deepEqual(h.onLine(fx.P4), { onLine: true });
  assert.equal(fetches, 2);
});

test('history: consumer branch name', () => {
  const fx = makeLine({ branch: 'trunk' });
  assert.equal(createLocalHistory({ git: realRunner(fx.cloneA), branch: 'trunk' }).verdict(fx.P1, fx.P3).verdict, 'descendant');
  const onMain = createLocalHistory({ git: realRunner(fx.cloneA) }).verdict(fx.P1, fx.P3);
  assert.equal(onMain.verdict, 'undetermined');
  assert.match(onMain.reason, /^fetch failed — /);
});

test('createHistory: local undetermined falls to compare; neither gives undetermined', () => {
  const answering = (verdict, onLine) => {
    const calls = [];
    return {
      calls,
      verdict: (from, to) => { calls.push(['verdict', from, to]); return { verdict, reason: `${verdict} reason` }; },
      onLine: (sha) => { calls.push(['onLine', sha]); return onLine; },
    };
  };
  const unsure = answering('undetermined', { undetermined: 'shallow' });
  const remote = answering('descendant', { onLine: true });
  const both = createHistory({ local: unsure, compare: remote });
  assert.equal(both.verdict(F, T).verdict, 'descendant');
  assert.deepEqual(both.onLine(F), { onLine: true });
  assert.equal(remote.calls.length, 2);

  const sure = answering('backward', { onLine: false });
  const untouched = answering('descendant', { onLine: true });
  const localFirst = createHistory({ local: sure, compare: untouched });
  assert.equal(localFirst.verdict(T, F).verdict, 'backward');
  assert.deepEqual(localFirst.onLine(X), { onLine: false });
  assert.equal(untouched.calls.length, 0);

  assert.equal(createHistory({ local: answering('undetermined', { undetermined: 'shallow' }) }).verdict(F, T).verdict, 'undetermined');
  const neither = createHistory({});
  assert.deepEqual(neither.verdict(F, T), { verdict: 'undetermined', reason: 'no local clone and gh unavailable' });
  assert.deepEqual(neither.onLine(F), { undetermined: 'no local clone and gh unavailable' });
});

// ---- marker operations ----

const NOW = new Date('2026-11-18T12:00:00.000Z');
const STATE_REF = 'refs/heads/release-state';
const throwingGh = (args) => { throw new Error(`unexpected ${args.join(' ')}`); };
const short12 = (sha) => sha.slice(0, 12);

// A scenario ctx: the real store on the clone's git leg (any gh call fails loudly), the real
// local history, and a fixed now. `counts.historyFetches` counts the history's own fetches.
function ctxFor(clone) {
  const run = realRunner(clone);
  const counts = { historyFetches: 0 };
  const git = (args, opts) => {
    if (args[0] === 'fetch' && args.some((a) => a.includes(':refs/release-state-history/'))) counts.historyFetches += 1;
    return run(args, opts);
  };
  return {
    counts,
    store: storeFacade({ gitRunner: run, ghApi: throwingGh }, 'o/r'),
    history: createHistory({ local: createLocalHistory({ git }) }),
    now: () => NOW,
  };
}

// The origin's release-state tip sha, or '' when the branch does not exist.
const stateTip = (fx) => setupGit(['for-each-ref', '--format=%(objectname)', STATE_REF], fx.originDir);
const tipSubject = (fx) => setupGit(['log', '-1', '--format=%s', STATE_REF], fx.originDir);
const commitsPastBase = (fx) => setupGit(['rev-list', '--count', `${fx.P5}..${STATE_REF}`], fx.originDir);

function readMarkerAt(clone) {
  const r = storeFacade({ gitRunner: realRunner(clone), ghApi: throwingGh }, 'o/r').read();
  assert.equal(r.state, 'present');
  return parseMarker(JSON.parse(r.content)).marker;
}

function initAt(fx, sha) {
  assert.deepEqual(initMarker(ctxFor(fx.cloneA), { to: sha }), { outcome: 'ok', initialized: true, sha });
}

test('marker: OUTCOMES is the frozen outcome vocabulary', () => {
  assert.deepEqual(OUTCOMES, ['ok', 'refused', 'unreadable', 'contested', 'insufficient-history', 'orphaned']);
  assert.ok(Object.isFrozen(OUTCOMES));
});

test('AC1.1: init at P1, advance to P3, read prints P3', () => {
  const fx = makeLine();
  initAt(fx, fx.P1);
  assert.deepEqual(advanceMarker(ctxFor(fx.cloneA), { to: fx.P3, run: 'r1' }), {
    outcome: 'ok', advanced: true, from: fx.P1, to: fx.P3,
  });
  const read = ctxFor(fx.cloneB).store.read();
  const { marker } = parseMarker(JSON.parse(read.content));
  assert.equal(marker.sha, fx.P3);
  assert.equal(marker.run, 'r1');
  assert.equal(marker.advancedAt, NOW.toISOString());
  assert.equal(tipSubject(fx), `Advance reviewed-through to ${short12(fx.P3)} from ${short12(fx.P1)} — run r1`);
});

test('AC2.1: advancing backward or off the first-parent line is refused and writes nothing', () => {
  const fx = makeLine();
  initAt(fx, fx.P3);
  const tip = stateTip(fx);
  for (const to of [fx.P1, fx.S]) {
    const r = advanceMarker(ctxFor(fx.cloneA), { to, run: 'r2' });
    assert.equal(r.outcome, 'refused', to);
    assert.equal(typeof r.reason, 'string');
    assert.equal(stateTip(fx), tip);
  }
});

test("AC7.1: advancing to the marker's own sha is ok and writes nothing", () => {
  const fx = makeLine();
  initAt(fx, fx.P2);
  const tip = stateTip(fx);
  assert.deepEqual(advanceMarker(ctxFor(fx.cloneA), { to: fx.P2, run: 'r2' }), {
    outcome: 'ok', advanced: false, sha: fx.P2, reason: 'same',
  });
  assert.equal(stateTip(fx), tip);
});

test('AC8.5: an orphaned marker gives orphaned, not refused', () => {
  const fx = makeLine();
  initAt(fx, fx.P3);
  const rewritten = rewriteMain(fx);
  const tip = stateTip(fx);
  assert.equal(advanceMarker(ctxFor(fx.cloneA), { to: rewritten, run: 'r2' }).outcome, 'orphaned');
  assert.equal(stateTip(fx), tip);
});

test('AC8.1: a shallow clone with the marker below the boundary gives insufficient-history', () => {
  const fx = makeLine();
  initAt(fx, fx.P1);
  const tip = stateTip(fx);
  const shallow = shallowClone(fx, 2);
  assert.equal(advanceMarker(ctxFor(shallow), { to: fx.P5, run: 'r2' }).outcome, 'insufficient-history');
  assert.equal(initMarker(ctxFor(shallowClone(fx, 2)), { to: fx.P1 }).outcome, 'insufficient-history');
  assert.equal(resetMarker(ctxFor(shallow), { to: fx.P5, run: 'r9' }).outcome, 'insufficient-history');
  assert.equal(stateTip(fx), tip);
});

// An in-memory store and history, for the outcomes a real remote cannot stage on demand.
// `reads` answers in order (the last one repeats); a verdict or onLine nobody listed throws.
function fakeCtx({
  reads, write = () => assert.fail('no write'), create = () => assert.fail('no create'), verdicts = {}, onLine = {},
}) {
  const calls = { read: 0, write: [], create: [] };
  const store = {
    read: () => {
      const r = reads[Math.min(calls.read, reads.length - 1)];
      calls.read += 1;
      return r;
    },
    write: (args) => { calls.write.push(args); return write(args); },
    create: (args) => { calls.create.push(args); return create(args); },
  };
  const history = {
    verdict: (from, to) => {
      const v = verdicts[`${from}>${to}`];
      if (!v) throw new Error(`unexpected verdict ${from}>${to}`);
      return { verdict: v, reason: `${v} reason` };
    },
    onLine: (sha) => {
      if (!(sha in onLine)) throw new Error(`unexpected onLine ${sha}`);
      return onLine[sha];
    },
  };
  return { ctx: { store, history, now: () => NOW }, calls };
}

function presentAt(sha, lease = 'b'.repeat(40)) {
  const content = serializeMarker({ sha, advancedAt: '2026-11-18T10:00:00.000Z', run: 'r0' });
  return {
    state: 'present', content, value: JSON.parse(content), lease, via: 'git',
  };
}

test('AC5.1: an unreadable read gives unreadable and never refused', () => {
  const unreadable = { state: 'unreadable', failure: 'network-failure', reason: 'gh api failed' };
  const { ctx, calls } = fakeCtx({ reads: [unreadable] });
  assert.deepEqual(advanceMarker(ctx, { to: T, run: 'r2' }), { outcome: 'unreadable', reason: 'gh api failed' });
  // A transport failure carries no bytes to overwrite, so even --force cannot reset over it.
  for (const opts of [{}, { force: true, reason: 'history rewritten by hand' }]) {
    const r = resetMarker(ctx, { to: T, run: 'r9', ...opts });
    assert.equal(r.outcome, 'unreadable');
    assert.equal(r.from, null);
  }
  assert.equal(calls.write.length, 0);
});

test('AC8.3: a stored marker of each malformed shape gives unreadable', () => {
  // One fixture; each shape is planted as its own real commit on release-state, over the
  // previous one. Object shapes go through the store (created, then compare-and-set
  // updates); the non-object ones through commitRawState, since the store refuses them.
  const fx = makeLine();
  const deps = { gitRunner: realRunner(fx.cloneA), ghApi: throwingGh };
  const planted = [...MALFORMED_MARKERS, ['a raw {', undefined, '{']];
  for (const [label, value, raw] of planted) {
    const before = stateTip(fx);
    const isObject = raw === undefined && value !== null && typeof value === 'object' && !Array.isArray(value);
    if (isObject) {
      const content = `${JSON.stringify(value, null, 2)}\n`;
      const message = 'Plant a malformed marker';
      const cur = readStateFile(deps, 'o/r', MARKER_FILE);
      const w = cur.state === 'absent'
        ? createStateFile(deps, 'o/r', MARKER_FILE, { content, message })
        : writeStateFile(deps, 'o/r', MARKER_FILE, {
          content, message, lease: cur.lease, via: cur.via, expectedContent: cur.content,
        });
      assert.equal(w.ok, true, label);
    } else {
      commitRawState(fx, fx.cloneA, MARKER_FILE, raw === undefined ? JSON.stringify(value) : raw);
    }
    const tip = stateTip(fx);
    assert.notEqual(tip, before, `${label} planted as a new commit`);
    assert.equal(advanceMarker(ctxFor(fx.cloneA), { to: fx.P5, run: 'r2' }).outcome, 'unreadable', label);
    assert.equal(stateTip(fx), tip, label);
  }
});

// lock-race-test-seam: the competitor runs in-process from inside A's first read, after A has
// read the marker and before A writes, the one window the compare-and-set exists to protect.
function withReadSeam(ctx, competitor) {
  const realRead = ctx.store.read;
  let reads = 0;
  return {
    ...ctx,
    store: {
      ...ctx.store,
      read: () => {
        reads += 1;
        const r = realRead();
        if (reads === 1) competitor();
        return r;
      },
    },
  };
}

function competitorAtOrPast(target) {
  const fx = makeLine();
  initAt(fx, fx.P1);
  let b;
  const ctxA = withReadSeam(ctxFor(fx.cloneA), () => {
    b = advanceMarker(ctxFor(fx.cloneB), { to: fx[target], run: 'rb' });
  });
  const a = advanceMarker(ctxA, { to: fx.P3, run: 'ra' });
  assert.deepEqual(b, {
    outcome: 'ok', advanced: true, from: fx.P1, to: fx[target],
  });
  assert.deepEqual(a, {
    outcome: 'ok', advanced: false, sha: fx[target], reason: 'at-or-past',
  });
  assert.equal(commitsPastBase(fx), '2', 'init and B, nothing from A');
  const m = readMarkerAt(fx.cloneA);
  assert.equal(m.sha, fx[target]);
  assert.equal(m.run, 'rb');
}

test('AC3.1/AC3.2: a concurrent advance past our target, seen through the injected read seam, is at-or-past', () => {
  competitorAtOrPast('P5');
});

test('AC3.1/AC3.2: a concurrent advance to exactly our target, seen through the injected read seam, is at-or-past', () => {
  competitorAtOrPast('P3');
});

test('AC3.1: a competitor behind our target makes us retry once and land', () => {
  const fx = makeLine();
  initAt(fx, fx.P1);
  let b;
  const ctxA = withReadSeam(ctxFor(fx.cloneA), () => {
    b = advanceMarker(ctxFor(fx.cloneB), { to: fx.P2, run: 'rb' });
  });
  const a = advanceMarker(ctxA, { to: fx.P3, run: 'ra' });
  assert.equal(b.outcome, 'ok');
  assert.deepEqual(a, {
    outcome: 'ok', advanced: true, from: fx.P2, to: fx.P3,
  });
  assert.equal(commitsPastBase(fx), '3');
  const m = readMarkerAt(fx.cloneA);
  assert.equal(m.sha, fx.P3);
  assert.equal(m.run, 'ra');
  assert.equal(tipSubject(fx), `Advance reviewed-through to ${short12(fx.P3)} from ${short12(fx.P2)} — run ra`);
});

test('AC3.1: the retry re-validates against the fresh marker', () => {
  const fx = makeLine();
  initAt(fx, fx.P1);
  let planted;
  const ctxA = withReadSeam(ctxFor(fx.cloneA), () => {
    planted = commitRawState(fx, fx.cloneB, MARKER_FILE, serializeMarker({ sha: fx.S, advancedAt: NOW.toISOString(), run: 'rb' }));
  });
  // A blind write on the fresh lease would land advanced:true over S.
  assert.equal(advanceMarker(ctxA, { to: fx.P3, run: 'ra' }).outcome, 'orphaned');
  assert.equal(stateTip(fx), planted, 'no write after the re-validation');
});

test('advance: a competitor landing past our fetched main snapshot is at-or-past after one refresh, never orphaned', () => {
  const fx = makeLine();
  initAt(fx, fx.P1);
  const ctxA = ctxFor(fx.cloneA);
  const realWrite = ctxA.store.write;
  let writes = 0;
  let P6;
  let b;
  let tipAfterB;
  // The window after A's first verdict (its snapshot of main) and before its write: B pushes
  // a new main commit P6 and advances the marker to it, so P6 is newer than A's snapshot.
  ctxA.store = {
    ...ctxA.store,
    write: (args) => {
      writes += 1;
      if (writes === 1) {
        P6 = pushMainCommit(fx, fx.cloneB);
        b = advanceMarker(ctxFor(fx.cloneB), { to: P6, run: 'rb' });
        tipAfterB = stateTip(fx);
      }
      return realWrite(args);
    },
  };
  const a = advanceMarker(ctxA, { to: fx.P3, run: 'ra' });
  assert.deepEqual(b, {
    outcome: 'ok', advanced: true, from: fx.P1, to: P6,
  });
  assert.deepEqual(a, {
    outcome: 'ok', advanced: false, sha: P6, reason: 'at-or-past',
  });
  assert.equal(writes, 1);
  assert.equal(ctxA.counts.historyFetches, 2, 'one snapshot, then the one refresh the at-or-past check needed');
  assert.equal(stateTip(fx), tipAfterB);
});

test('AC3.1: a second conflict is contested; a fresh read that fails stops; any other write failure is unreadable', () => {
  const first = presentAt(F, 'b'.repeat(40));
  const second = presentAt(A, 'c'.repeat(40));
  const verdicts = { [`${F}>${T}`]: 'descendant', [`${T}>${A}`]: 'backward', [`${A}>${T}`]: 'descendant' };
  // The read after the second conflict still shows A, behind the target: contested.
  const { ctx, calls } = fakeCtx({ reads: [first, second], write: () => ({ ok: false, conflict: true }), verdicts });
  assert.equal(advanceMarker(ctx, { to: T, run: 'ra' }).outcome, 'contested');
  assert.equal(calls.read, 3);
  assert.equal(calls.write.length, 2);
  const content = serializeMarker({ sha: T, advancedAt: NOW.toISOString(), run: 'ra' });
  assert.deepEqual(calls.write[0], {
    content, lease: 'b'.repeat(40), via: 'git', expectedContent: first.content, message: `Advance reviewed-through to ${short12(T)} from ${short12(F)} — run ra`,
  });
  assert.deepEqual(calls.write[1], {
    content, lease: 'c'.repeat(40), via: 'git', expectedContent: second.content, message: `Advance reviewed-through to ${short12(T)} from ${short12(A)} — run ra`,
  });

  const lostRead = fakeCtx({ reads: [first, { state: 'unreadable', failure: 'x', reason: 'gone' }], write: () => ({ ok: false, conflict: true }), verdicts });
  assert.deepEqual(advanceMarker(lostRead.ctx, { to: T, run: 'ra' }), { outcome: 'unreadable', reason: 'gone' });
  assert.equal(lostRead.calls.write.length, 1);

  for (const failed of [{ ok: false, branchMissing: true }, { ok: false, failure: 'transport-failure', reason: 'push rejected' }]) {
    const f = fakeCtx({ reads: [first], write: () => failed, verdicts });
    assert.equal(advanceMarker(f.ctx, { to: T, run: 'ra' }).outcome, 'unreadable', JSON.stringify(failed));
    assert.equal(f.calls.write.length, 1);
    assert.equal(f.calls.read, 1);
  }
});

test('AC3.1: after a second conflict, a marker a third writer moved to or past the target is at-or-past', () => {
  const first = presentAt(F, 'b'.repeat(40));
  const second = presentAt(A, 'c'.repeat(40));
  const base = { [`${F}>${T}`]: 'descendant', [`${T}>${A}`]: 'backward', [`${A}>${T}`]: 'descendant' };
  const conflict = () => ({ ok: false, conflict: true });
  const cases = [
    ['at the target', presentAt(T, 'd'.repeat(40)), {}, { outcome: 'ok', advanced: false, sha: T, reason: 'at-or-past' }],
    ['past the target', presentAt(X, 'd'.repeat(40)), { [`${T}>${X}`]: 'descendant' }, { outcome: 'ok', advanced: false, sha: X, reason: 'at-or-past' }],
    ['undetermined against the target', presentAt(M, 'd'.repeat(40)), { [`${T}>${M}`]: 'undetermined' }, { outcome: 'contested' }],
    ['unreadable', { state: 'unreadable', failure: 'x', reason: 'gone' }, {}, { outcome: 'contested' }],
    ['vanished', { state: 'absent', lease: null, via: 'git', branchMissing: false }, {}, { outcome: 'contested' }],
  ];
  for (const [label, third, extra, want] of cases) {
    const { ctx, calls } = fakeCtx({ reads: [first, second, third], write: conflict, verdicts: { ...base, ...extra } });
    const r = advanceMarker(ctx, { to: T, run: 'ra' });
    if (want.outcome === 'contested') assert.equal(r.outcome, 'contested', label);
    else assert.deepEqual(r, want, label);
    assert.equal(calls.write.length, 2, `${label}: never a third write`);
    assert.equal(calls.read, 3, label);
  }
});

test('AC3.1: a marker that vanished after the first lost write is contested (a competing writer changed it), without init advice', () => {
  const vanished = { state: 'absent', lease: null, via: 'git', branchMissing: false };
  const { ctx, calls } = fakeCtx({ reads: [presentAt(F), vanished], write: () => ({ ok: false, conflict: true }), verdicts: { [`${F}>${T}`]: 'descendant' } });
  const r = advanceMarker(ctx, { to: T, run: 'ra' });
  assert.equal(r.outcome, 'contested');
  assert.match(r.reason, /disappeared after a lost compare-and-set/);
  assert.doesNotMatch(r.reason, /init/);
  assert.equal(calls.write.length, 1);
  // Absent on the first read is still the plain "no marker" refusal.
  const fresh = fakeCtx({ reads: [vanished] });
  assert.deepEqual(advanceMarker(fresh.ctx, { to: T, run: 'ra' }), { outcome: 'refused', reason: 'no marker — run marker init' });
});

test('advanceMarker: a verdict outside the table fails closed as insufficient-history, even a prototype key', () => {
  for (const verdict of ['constructor', 'toString', 'sideways']) {
    const { ctx, calls } = fakeCtx({ reads: [presentAt(F)], verdicts: { [`${F}>${T}`]: verdict } });
    assert.equal(advanceMarker(ctx, { to: T, run: 'ra' }).outcome, 'insufficient-history', verdict);
    assert.equal(calls.write.length, 0);
  }
});

test('AC6.1: init refuses when a marker exists', () => {
  const fx = makeLine();
  assert.equal(stateTip(fx), '');
  initAt(fx, fx.P1);
  const m = readMarkerAt(fx.cloneA);
  assert.equal(m.sha, fx.P1);
  assert.equal(m.run, 'init');
  assert.equal(tipSubject(fx), `Initialize reviewed-through at ${short12(fx.P1)}`);
  const tip = stateTip(fx);
  const again = initMarker(ctxFor(fx.cloneB), { to: fx.P3 });
  assert.equal(again.outcome, 'refused');
  assert.match(again.reason, /a marker already exists/);
  assert.equal(stateTip(fx), tip);

  const off = makeLine();
  assert.equal(initMarker(ctxFor(off.cloneA), { to: off.S }).outcome, 'refused');
  assert.equal(stateTip(off), '', 'no branch created');

  const failing = fakeCtx({ reads: [], onLine: { [T]: { onLine: true } }, create: () => ({ ok: false, failure: 'branch-uncreatable', reason: 'denied' }) });
  assert.equal(initMarker(failing.ctx, { to: T }).outcome, 'unreadable');
  assert.deepEqual(failing.calls.create, [{ content: serializeMarker({ sha: T, advancedAt: NOW.toISOString(), run: INIT_RUN }), message: `Initialize reviewed-through at ${short12(T)}` }]);
});

test('AC8.6: an orphaned marker resets to an on-line target, and the commit message logs it', () => {
  const fx = makeLine();
  initAt(fx, fx.P3);
  const rewritten = rewriteMain(fx);
  assert.deepEqual(resetMarker(ctxFor(fx.cloneA), { to: rewritten, run: 'r9' }), {
    outcome: 'ok', reset: true, from: fx.P3, to: rewritten, basis: 'orphaned',
  });
  assert.equal(tipSubject(fx), `Reset reviewed-through from ${short12(fx.P3)} to ${short12(rewritten)} — run r9 — orphaned`);
  const m = readMarkerAt(fx.cloneA);
  assert.equal(m.sha, rewritten);
  assert.equal(m.run, 'r9');
});

test('AC8.7: a reset of a marker still on the line is refused without force', () => {
  const fx = makeLine();
  initAt(fx, fx.P1);
  const tip = stateTip(fx);
  const r = resetMarker(ctxFor(fx.cloneA), { to: fx.P3, run: 'r9' });
  assert.equal(r.outcome, 'refused');
  assert.match(r.reason, /not orphaned/);
  assert.equal(r.from, fx.P1);
  assert.equal(stateTip(fx), tip);
});

test('AC8.8: a forced reset logs its reason', () => {
  const fx = makeLine();
  initAt(fx, fx.P1);
  assert.deepEqual(resetMarker(ctxFor(fx.cloneA), {
    to: fx.P3, run: 'r9', force: true, reason: 'history rewritten by hand',
  }), {
    outcome: 'ok', reset: true, from: fx.P1, to: fx.P3, basis: 'forced',
  });
  assert.equal(tipSubject(fx), `Reset reviewed-through from ${short12(fx.P1)} to ${short12(fx.P3)} — run r9 — forced: history rewritten by hand`);
});

test('AC8.8: a forced reset over an orphaned marker is forced and logs the reason, whatever the line state', () => {
  const fx = makeLine();
  initAt(fx, fx.P3);
  const rewritten = rewriteMain(fx);
  assert.deepEqual(resetMarker(ctxFor(fx.cloneA), {
    to: rewritten, run: 'r9', force: true, reason: 'history rewritten by hand',
  }), {
    outcome: 'ok', reset: true, from: fx.P3, to: rewritten, basis: 'forced',
  });
  assert.equal(tipSubject(fx), `Reset reviewed-through from ${short12(fx.P3)} to ${short12(rewritten)} — run r9 — forced: history rewritten by hand`);
});

test("AC8.8: a forced reset never consults the marker's line state, so an undetermined one still resets", () => {
  // The fake history throws on any onLine it was not given: F (the marker) is absent from
  // the table, so the test fails if the forced reset asks about it.
  const { ctx, calls } = fakeCtx({ reads: [presentAt(F)], write: () => ({ ok: true, via: 'git' }), onLine: { [T]: { onLine: true } } });
  assert.deepEqual(resetMarker(ctx, {
    to: T, run: 'r9', force: true, reason: 'history rewritten by hand',
  }), {
    outcome: 'ok', reset: true, from: F, to: T, basis: 'forced',
  });
  assert.equal(calls.write[0].message, `Reset reviewed-through from ${short12(F)} to ${short12(T)} — run r9 — forced: history rewritten by hand`);
  // Unforced, the same undetermined marker is insufficient-history, with no write.
  const unforced = fakeCtx({ reads: [presentAt(F)], onLine: { [F]: { undetermined: 'shallow' }, [T]: { onLine: true } } });
  assert.equal(resetMarker(unforced.ctx, { to: T, run: 'r9' }).outcome, 'insufficient-history');
  assert.equal(unforced.calls.write.length, 0);
});

test('AC8.9: a reset target off the line, or no marker, is refused', () => {
  const fx = makeLine();
  initAt(fx, fx.P3);
  rewriteMain(fx);
  const tip = stateTip(fx);
  // Orphaned, but P3 is no longer on the line either.
  assert.equal(resetMarker(ctxFor(fx.cloneA), { to: fx.P3, run: 'r9' }).outcome, 'refused');
  assert.equal(stateTip(fx), tip);

  const forced = makeLine();
  initAt(forced, forced.P1);
  const forcedTip = stateTip(forced);
  assert.equal(resetMarker(ctxFor(forced.cloneA), {
    to: forced.S, run: 'r9', force: true, reason: 'history rewritten by hand',
  }).outcome, 'refused');
  assert.equal(stateTip(forced), forcedTip);

  const none = makeLine();
  const r = resetMarker(ctxFor(none.cloneA), { to: none.P3, run: 'r9', force: true, reason: 'history rewritten by hand' });
  assert.equal(r.outcome, 'refused');
  assert.equal(r.from, null);
  assert.equal(stateTip(none), '');
});

test('AC8.6: an unreadable marker resets only with force, from null', () => {
  const plants = [
    ['a raw {', (fx) => commitRawState(fx, fx.cloneA, MARKER_FILE, '{')],
    ['version 2', (fx) => commitRawState(fx, fx.cloneA, MARKER_FILE, `${JSON.stringify({ ...VALID, version: 2 }, null, 2)}\n`)],
  ];
  for (const [label, plant] of plants) {
    const fx = makeLine();
    plant(fx);
    const tip = stateTip(fx);
    const refused = resetMarker(ctxFor(fx.cloneA), { to: fx.P3, run: 'r9' });
    assert.equal(refused.outcome, 'unreadable', label);
    assert.equal(refused.from, null, label);
    assert.match(refused.reason, /--force --reason/, label);
    assert.equal(stateTip(fx), tip, label);
    assert.deepEqual(resetMarker(ctxFor(fx.cloneA), {
      to: fx.P3, run: 'r9', force: true, reason: 'history rewritten by hand',
    }), {
      outcome: 'ok', reset: true, from: null, to: fx.P3, basis: 'forced',
    }, label);
    assert.equal(tipSubject(fx), `Reset reviewed-through from unreadable to ${short12(fx.P3)} — run r9 — forced: history rewritten by hand`, label);
    assert.equal(readMarkerAt(fx.cloneA).sha, fx.P3, label);
  }
});

test('AC8.6: a reset write conflict is contested with no retry; any other write failure is unreadable', () => {
  const cases = [
    [{ ok: false, conflict: true }, 'contested'],
    [{ ok: false, failure: 'transport-failure', reason: 'push rejected' }, 'unreadable'],
    [{ ok: false, branchMissing: true }, 'unreadable'],
  ];
  for (const [failed, outcome] of cases) {
    const { ctx, calls } = fakeCtx({ reads: [presentAt(F)], write: () => failed, onLine: { [F]: { onLine: false }, [T]: { onLine: true } } });
    const r = resetMarker(ctx, { to: T, run: 'r9' });
    assert.equal(r.outcome, outcome, JSON.stringify(failed));
    assert.equal(r.from, F);
    assert.equal(calls.read, 1);
    assert.equal(calls.write.length, 1);
  }
});

// A ctx whose every store and history method records and throws: the proof that a caller bug
// is a TypeError before anything is read or written.
function trapCtx() {
  const touched = [];
  const trap = (name) => () => {
    touched.push(name);
    throw new Error(`${name} must not be called`);
  };
  return {
    touched,
    ctx: {
      store: { read: trap('read'), write: trap('write'), create: trap('create') },
      history: { verdict: trap('verdict'), onLine: trap('onLine') },
      now: () => NOW,
    },
  };
}

test('marker: TypeError on bad arguments, thrown before anything is read', () => {
  const { ctx, touched } = trapCtx();
  const forced = { force: true };
  const cases = [
    () => advanceMarker(ctx, { to: T, run: 'init' }),
    () => advanceMarker(ctx, { to: T, run: '-x' }),
    () => advanceMarker(ctx, { to: T }),
    () => advanceMarker(ctx, { to: T.slice(1), run: 'r1' }),
    () => advanceMarker(ctx, { to: 'A'.repeat(40), run: 'r1' }),
    () => initMarker(ctx, { to: '-x' }),
    () => initMarker(ctx, {}),
    () => resetMarker(ctx, { to: T, run: 'init' }),
    () => resetMarker(ctx, { to: T, run: '-x' }),
    () => resetMarker(ctx, { to: '-x', run: 'r1' }),
    () => resetMarker(ctx, { to: T, run: 'r1', ...forced, reason: 'fix #12' }),
    () => resetMarker(ctx, { to: T, run: 'r1', ...forced, reason: 'a\nb' }),
    () => resetMarker(ctx, { to: T, run: 'r1', ...forced }),
    () => resetMarker(ctx, { to: T, run: 'r1', ...forced, reason: 'x'.repeat(201) }),
  ];
  // The module's own TypeError, never a TypeError some later call threw by accident.
  const ownTypeError = (err) => err instanceof TypeError && /^release-state marker: /.test(err.message);
  for (const c of cases) assert.throws(c, ownTypeError, c.toString());
  assert.deepEqual(touched, []);
});

test('marker: a reset whose commit message would pass 200 characters is a TypeError before any read', () => {
  const { ctx, touched } = trapCtx();
  const longRun = `r${'x'.repeat(127)}`;
  const longReason = 'y'.repeat(200);
  assert.ok(RUN_RE.test(longRun));
  assert.ok(REASON_RE.test(longReason));
  const names200 = (err) => err instanceof TypeError && /^release-state marker: .*200/.test(err.message);
  assert.throws(() => resetMarker(ctx, {
    to: T, run: longRun, force: true, reason: longReason,
  }), names200);
  // Even the orphaned basis overflows with a 128-char run: 202 characters.
  assert.throws(() => resetMarker(ctx, { to: T, run: longRun }), names200);
  assert.deepEqual(touched, []);
});

test('resetMessageFits: the shared commit-message budget check, at its 200-character boundary', () => {
  const run = (n) => `r${'x'.repeat(n - 1)}`;
  // Unforced: 74 characters plus the run, so a 126-char run fits and a 127-char one does not.
  assert.deepEqual(resetMessageFits({ run: run(126) }), { fits: true, length: 200 });
  assert.deepEqual(resetMessageFits({ run: run(127) }), { fits: false, length: 201 });
  // Forced: 74 characters plus the run and the reason ('forced: ' replaces 'orphaned').
  assert.deepEqual(resetMessageFits({ run: 'r9', force: true, reason: 'z'.repeat(124) }), { fits: true, length: 200 });
  assert.deepEqual(resetMessageFits({ run: 'r9', force: true, reason: 'z'.repeat(125) }), { fits: false, length: 201 });
  assert.deepEqual(resetMessageFits({ run: run(128), force: true, reason: 'y'.repeat(200) }), { fits: false, length: 402 });
  // resetMarker uses the same check: the boundary throws there too, before any call.
  const { ctx, touched } = trapCtx();
  assert.throws(() => resetMarker(ctx, { to: T, run: run(127) }), TypeError);
  assert.throws(() => resetMarker(ctx, { to: T, run: run(126) }), /read must not be called/);
  assert.deepEqual(touched, ['read']);
});

test('marker: the longest messages that fit land on the real store', () => {
  // The longest legal advance message: a 128-char run gives 193 characters.
  const fx = makeLine();
  initAt(fx, fx.P1);
  const longRun = `r${'x'.repeat(127)}`;
  assert.deepEqual(advanceMarker(ctxFor(fx.cloneA), { to: fx.P3, run: longRun }), {
    outcome: 'ok', advanced: true, from: fx.P1, to: fx.P3,
  });
  assert.equal(tipSubject(fx).length, 193);
  // A forced reset whose message is exactly 200 characters passes the pre-check and lands.
  const reason = 'z'.repeat(200 - `Reset reviewed-through from ${short12(fx.P3)} to ${short12(fx.P5)} — run r9 — forced: `.length);
  assert.equal(resetMarker(ctxFor(fx.cloneA), {
    to: fx.P5, run: 'r9', force: true, reason,
  }).outcome, 'ok');
  assert.equal(tipSubject(fx).length, 200);
});
