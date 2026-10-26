// plugin/bin/lib/verify/impact.js — the test-impact map format and the pure
// selection over it (#4024). A map produced by a traced full-suite run
// records, per test file, the repo-relative POSIX paths it read, by kind — f
// content reads, s existence probes, d directory listings, c content prefixes
// ('' = repo root). On disk the map is interned: one sorted `paths` table,
// per-test index lists (sorted, empty kinds omitted).
//
// Selection fails CLOSED: a changed non-test path no traced read covers makes
// selectImpactTests return {ok:false}, and mapProblem names why a map must not
// be used at all — the caller then runs the full suite. What counts as a test
// file is the caller's predicate; this module never guesses.
//
// The codec and selection are pure. The I/O helpers at the bottom
// (gitLocations, loadImpactContext) read the map file, the test files present
// at HEAD, the map commit's ancestry and the test files that differ between
// the map commit and HEAD (the drift), every git call through an injectable
// execImpl; they never throw — an unreadable input is a named problem.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { globToRegExp } = require('../issues/blast-radius');
const { GIT_COMMON_DIR_TOKEN } = require('./declaration');
const { lstatType } = require('../path-guard');
const { LARGE_MAX_BUFFER_BYTES } = require('../shared-primitives');

const IMPACT_MAP_VERSION = 1;
const DEFAULT_MAP_NAME = 'claude-tweaks-test-impact.json';
const KINDS = ['f', 's', 'd', 'c'];
const SHA_RE = /^[0-9a-f]{40}$/;

const sortedUnique = (list) => [...new Set(list)].sort();
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// `prefix === ''` is the repo root, which covers every path.
function under(p, prefix) {
  return prefix === '' || p === prefix || p.startsWith(prefix + '/');
}

function encodeImpactMap({ commit, tracedAt, exitCode, node, tests }) {
  const names = Object.keys(tests).sort();
  const paths = sortedUnique(names.flatMap((t) => KINDS.flatMap((k) => tests[t][k] || [])));
  const index = new Map(paths.map((p, i) => [p, i]));
  const encoded = {};
  for (const t of names) {
    const entry = {};
    for (const k of KINDS) {
      const list = tests[t][k] || [];
      if (list.length) entry[k] = [...new Set(list.map((p) => index.get(p)))].sort((a, b) => a - b);
    }
    encoded[t] = entry;
  }
  return { version: IMPACT_MAP_VERSION, commit, tracedAt, exitCode, node, paths, tests: encoded };
}

function decodeTests(raw, paths) {
  if (!isPlainObject(raw)) return null;
  const tests = {};
  for (const [t, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry)) return null;
    if (Object.keys(entry).some((k) => !KINDS.includes(k))) return null;
    const decoded = {};
    for (const k of KINDS) {
      const list = entry[k] === undefined ? [] : entry[k];
      if (!Array.isArray(list)) return null;
      if (!list.every((i) => Number.isInteger(i) && i >= 0 && i < paths.length)) return null;
      decoded[k] = list.map((i) => paths[i]);
    }
    tests[t] = decoded;
  }
  return tests;
}

function parseImpactMap(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
  if (!isPlainObject(raw)) return { ok: false, reason: 'bad-shape' };
  if (raw.version !== IMPACT_MAP_VERSION) return { ok: false, reason: 'wrong-version' };
  if (typeof raw.commit !== 'string' || !SHA_RE.test(raw.commit)) return { ok: false, reason: 'bad-commit' };
  if (!Number.isInteger(raw.exitCode)) return { ok: false, reason: 'bad-shape' };
  if (!Array.isArray(raw.paths) || !raw.paths.every((p) => typeof p === 'string')) return { ok: false, reason: 'bad-shape' };
  const tests = decodeTests(raw.tests, raw.paths);
  if (tests === null) return { ok: false, reason: 'bad-shape' };
  return {
    ok: true,
    map: {
      version: raw.version, commit: raw.commit, tracedAt: raw.tracedAt, exitCode: raw.exitCode, node: raw.node,
      paths: raw.paths, tests,
    },
  };
}

// Status M (content changed) reaches only content readers; A or D (the path
// appeared or vanished) also reaches existence probes and directory listings,
// and an f or s entry on an ancestor directory — adding a directory's first
// file or deleting its last changes whether it exists, and its stat. The repo
// root ('') always exists, so an f or s entry of '' is never an ancestor.
function reads(entry, p, status) {
  if (entry.f.includes(p) || entry.c.some((pre) => under(p, pre))) return true;
  if (status === 'M') return false;
  const ancestorOrSelf = (e) => e !== '' && under(p, e);
  return entry.f.some(ancestorOrSelf) || entry.s.some(ancestorOrSelf) || entry.d.some((pre) => under(p, pre));
}

// `driftTests`: the test files that differ between the map commit and HEAD. One the map knows and HEAD still
// has is selected like an untraced one — its traced reads describe the old file; unknown ones are untraced already,
// and a changed test is selected as changed, so neither counts as drift-selected.
function selectImpactTests({ map, changed, headTests, isTestFile, driftTests = [] }) {
  const atHead = new Set(headTests);
  // A map reader no longer present at HEAD cannot run, so it never selects.
  const readers = Object.keys(map.tests).filter((t) => atHead.has(t));
  const matched = new Set();
  const changedTests = new Set();
  const untraced = [];
  for (const { path: p, status } of changed) {
    // A changed test file runs itself and selects the OTHER tests that read it
    // (a conformance test reading or listing every test file); with no such
    // reader it is still traced — never untraced-path.
    const testFile = isTestFile(p);
    if (testFile && atHead.has(p)) changedTests.add(p);
    const hits = readers.filter((t) => !(testFile && t === p) && reads(map.tests[t], p, status));
    if (hits.length === 0 && !testFile) untraced.push(p);
    for (const t of hits) matched.add(t);
  }
  if (untraced.length) return { ok: false, reason: `untraced-path: ${untraced.sort()[0]}` };
  const untracedTests = sortedUnique(headTests.filter((t) => !Object.hasOwn(map.tests, t)));
  const drift = sortedUnique(driftTests.filter((t) => atHead.has(t) && Object.hasOwn(map.tests, t) && !changedTests.has(t)));
  return {
    ok: true,
    tests: sortedUnique([...matched, ...changedTests, ...untracedTests, ...drift]),
    matched: [...matched].sort(),
    changedTests: [...changedTests].sort(),
    untracedTests,
    driftTests: drift,
  };
}

// `parsed` is parseImpactMap's result, or null when no map was found.
function mapProblem({ parsed, isAncestor, distance, maxAgeCommits }) {
  if (parsed === null || parsed === undefined) return 'map-missing';
  if (!parsed.ok) return `map-invalid: ${parsed.reason}`;
  if (parsed.map.exitCode !== 0) return 'map-from-failing-suite';
  if (!isAncestor) return 'map-not-ancestor';
  // An unknown age (a failed rev-list) is never read as fresh.
  if (!Number.isInteger(distance)) return `map-stale: unknown commits > ${maxAgeCommits}`;
  if (distance > maxAgeCommits) return `map-stale: ${distance} commits > ${maxAgeCommits}`;
  return null;
}

// maxBuffer is the shared list-dump ceiling: `ls-files` over a large checkout overflows the 1 MiB default,
// which would turn every impact run into a `head-tests-unreadable` full run.
function git(execImpl, cwd, args) {
  return String(execImpl('git', args, { cwd, encoding: 'utf8', maxBuffer: LARGE_MAX_BUFFER_BYTES, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
}

// The checkout's root and its git common dir (shared by every worktree, so a
// map fetched once serves them all). null when git cannot answer.
function gitLocations({ cwd, execImpl = execFileSync }) {
  try {
    const repoRoot = git(execImpl, cwd, ['rev-parse', '--show-toplevel']).trim();
    const commonDir = git(execImpl, cwd, ['rev-parse', '--git-common-dir']).trim();
    if (repoRoot === '' || commonDir === '') return null;
    return { repoRoot, commonDir: path.resolve(cwd, commonDir) };
  } catch {
    return null;
  }
}

function resolveMapPath({ decl, commonDir, repoRoot }) {
  const m = decl.impact.map;
  if (m === null || m === undefined) return path.join(commonDir, DEFAULT_MAP_NAME);
  const prefix = `${GIT_COMMON_DIR_TOKEN}/`;
  return m.startsWith(prefix) ? path.join(commonDir, m.slice(prefix.length)) : path.join(repoRoot, m);
}

// Every test file at HEAD the impact globs name — tracked, or untracked and not
// ignored — still on disk (only a definite `missing` drops one: an unreadable
// entry stays, which can only select more). null when git cannot list them.
function listHeadTests({ decl, repoRoot, execImpl, fsImpl }) {
  let out;
  try {
    out = git(execImpl, repoRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  } catch {
    return null;
  }
  const patterns = decl.impact.tests.map((g) => globToRegExp(g));
  return sortedUnique(out.split('\0').filter((p) => p !== ''
    && patterns.some((re) => re.test(p)) && lstatType(path.join(repoRoot, p), { fsImpl }).type !== 'missing'));
}

// The test files that differ between the map commit and HEAD — a two-revision tree diff, defined whether or
// not the commit is an ancestor of the base. null when git cannot answer.
function listDriftTests({ decl, repoRoot, commit, execImpl }) {
  let out;
  try {
    out = git(execImpl, repoRoot, ['diff', '--name-only', '-z', '--no-renames', '--end-of-options', commit, 'HEAD']);
  } catch {
    return null;
  }
  const patterns = decl.impact.tests.map((g) => globToRegExp(g));
  return sortedUnique(out.split('\0').filter((p) => p !== '' && patterns.some((re) => re.test(p))));
}

function readMap({ decl, mapPath, repoRoot, execImpl, fsImpl }) {
  let parsed;
  try {
    parsed = parseImpactMap(fsImpl.readFileSync(mapPath, 'utf8'));
  } catch (err) {
    // A directory, a permission error, ...: present but unusable.
    parsed = err && err.code === 'ENOENT' ? null : { ok: false, reason: 'unreadable' };
  }
  let isAncestor = false;
  let distance = null;
  if (parsed && parsed.ok) {
    const commit = parsed.map.commit;
    try {
      git(execImpl, repoRoot, ['merge-base', '--is-ancestor', '--end-of-options', commit, 'HEAD']);
      isAncestor = true;
    } catch { /* not an ancestor, or not a commit here */ }
    if (isAncestor) {
      try {
        const count = git(execImpl, repoRoot, ['rev-list', '--count', '--end-of-options', `${commit}..HEAD`]).trim();
        if (/^\d+$/.test(count)) distance = Number(count);
      } catch { /* unknown age — mapProblem reads it as stale */ }
    }
  }
  return {
    map: parsed && parsed.ok ? parsed.map : null,
    mapCommit: parsed && parsed.ok ? parsed.map.commit : null,
    distance,
    problem: mapProblem({ parsed, isAncestor, distance, maxAgeCommits: decl.impact.maxAgeCommits }),
  };
}

// The impact context scope.js's selectScope reads, plus what the report shows.
// A map problem with a declared impact.fetch runs `runFetch(command)` once
// (→ {ran, exitCode, durationMs, timedOut, signal}); only a fetch that exits
// 0 reloads the map, so a failed fetch leaves the original problem standing.
function loadImpactContext({ decl, repoRoot, commonDir, execImpl = execFileSync, fsImpl = fs, runFetch = null }) {
  const mapPath = resolveMapPath({ decl, commonDir, repoRoot });
  let state = readMap({ decl, mapPath, repoRoot, execImpl, fsImpl });
  let fetch = null;
  if (state.problem && decl.impact.fetch && runFetch) {
    fetch = runFetch(decl.impact.fetch);
    if (fetch.exitCode === 0) state = readMap({ decl, mapPath, repoRoot, execImpl, fsImpl });
  }
  // Only a usable map has a drift to read; an unreadable one fails closed like the head-test listing.
  let driftTests = [];
  let driftProblem = null;
  if (!state.problem) {
    const drift = listDriftTests({ decl, repoRoot, commit: state.mapCommit, execImpl });
    if (drift === null) driftProblem = 'map-drift-unreadable';
    else driftTests = drift;
  }
  const headTests = listHeadTests({ decl, repoRoot, execImpl, fsImpl });
  // A listing that succeeded but names no test file (a sparse checkout, a pathspec oddity) would make
  // every reader "absent at HEAD" and a changed test select nothing — it fails closed like a failed one.
  let headProblem = null;
  if (headTests === null) headProblem = 'head-tests-unreadable';
  else if (headTests.length === 0) headProblem = 'head-tests-empty';
  const problem = state.problem || driftProblem || headProblem;
  return { ...state, problem, headTests: headTests || [], driftTests, mapPath, fetch };
}

// The same context, loaded on first read instead of up front: selectScope only reads it when an
// impact rule actually selected something (or the run is unanchored), so a change no impact rule
// matches never pays the map read, the HEAD test listing or the up-to-120 s `impact.fetch`.
// `loaded` says whether anything read it — the report prints map fields only then.
function lazyImpactContext(load) {
  let ctx = null;
  const get = () => {
    if (ctx === null) ctx = load();
    return ctx;
  };
  return {
    get loaded() { return ctx !== null; },
    get map() { return get().map; },
    get problem() { return get().problem; },
    get headTests() { return get().headTests; },
    get driftTests() { return get().driftTests; },
    get mapPath() { return get().mapPath; },
    get mapCommit() { return get().mapCommit; },
    get distance() { return get().distance; },
    get fetch() { return get().fetch; },
  };
}

module.exports = {
  IMPACT_MAP_VERSION, DEFAULT_MAP_NAME, KINDS,
  encodeImpactMap, parseImpactMap, under, selectImpactTests, mapProblem,
  gitLocations, resolveMapPath, loadImpactContext, lazyImpactContext,
};
