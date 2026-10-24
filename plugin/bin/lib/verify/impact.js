// plugin/bin/lib/verify/impact.js — the test-impact map format and the pure
// selection over it (#4024). No fs, no git: a map produced by a traced
// full-suite run records, per test file, the repo-relative POSIX paths it
// read, by kind — f content reads, s existence probes, d directory listings,
// c content prefixes ('' = repo root). On disk the map is interned: one sorted
// `paths` table, per-test index lists (sorted, empty kinds omitted).
//
// Selection fails CLOSED: a changed non-test path no traced read covers makes
// selectImpactTests return {ok:false}, and mapProblem names why a map must not
// be used at all — the caller then runs the full suite. What counts as a test
// file is the caller's predicate; this module never guesses.
'use strict';

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
// appeared or vanished) also reaches existence probes and directory listings.
function reads(entry, p, status) {
  if (entry.f.includes(p) || entry.c.some((pre) => under(p, pre))) return true;
  if (status === 'M') return false;
  return entry.s.includes(p) || entry.d.some((pre) => under(p, pre));
}

function selectImpactTests({ map, changed, headTests, isTestFile }) {
  const atHead = new Set(headTests);
  // A map reader no longer present at HEAD cannot run, so it never selects.
  const readers = Object.keys(map.tests).filter((t) => atHead.has(t));
  const matched = new Set();
  const changedTests = new Set();
  const untraced = [];
  for (const { path: p, status } of changed) {
    if (isTestFile(p)) {
      if (atHead.has(p)) changedTests.add(p);
      continue;
    }
    const hits = readers.filter((t) => reads(map.tests[t], p, status));
    if (hits.length === 0) untraced.push(p);
    for (const t of hits) matched.add(t);
  }
  if (untraced.length) return { ok: false, reason: `untraced-path: ${untraced.sort()[0]}` };
  const untracedTests = sortedUnique(headTests.filter((t) => !Object.hasOwn(map.tests, t)));
  return {
    ok: true,
    tests: sortedUnique([...matched, ...changedTests, ...untracedTests]),
    matched: [...matched].sort(),
    changedTests: [...changedTests].sort(),
    untracedTests,
  };
}

// `parsed` is parseImpactMap's result, or null when no map was found.
function mapProblem({ parsed, isAncestor, distance, maxAgeCommits }) {
  if (parsed === null || parsed === undefined) return 'map-missing';
  if (!parsed.ok) return `map-invalid: ${parsed.reason}`;
  if (parsed.map.exitCode !== 0) return 'map-from-failing-suite';
  if (!isAncestor) return 'map-not-ancestor';
  if (distance > maxAgeCommits) return `map-stale: ${distance} commits > ${maxAgeCommits}`;
  return null;
}

module.exports = {
  IMPACT_MAP_VERSION, DEFAULT_MAP_NAME, KINDS,
  encodeImpactMap, parseImpactMap, under, selectImpactTests, mapProblem,
};
