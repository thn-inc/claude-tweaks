'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MARKER_FILE, MARKER_VERSION, SHA_RE, RUN_RE, REASON_RE, INIT_RUN, ISO_UTC_RE,
  parseMarker, serializeMarker, VERDICTS, descentVerdict, compareVerdict, compareOnLine,
  createLocalHistory, createCompareHistory, createHistory,
} = require('../../../plugin/bin/lib/release-state/marker');
const {
  makeLine, realRunner, rewriteMain, pushMainCommit, shallowClone, setupGit,
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

test('history: a compare-history membership miss re-reads the tip once (Review Focus 1)', () => {
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

test('history: a membership miss refreshes the snapshot once (Review Focus 1)', () => {
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
  assert.deepEqual(calls.slice(1), [
    ['rev-parse', '--verify', '--end-of-options', scratch],
    ['rev-parse', '--is-shallow-repository'],
    ['rev-list', '--first-parent', '--end-of-options', fx.P5, '--'],
    ['update-ref', '-d', scratch],
    ['merge-base', '--is-ancestor', '--end-of-options', fx.P1, fx.P3],
  ]);
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
