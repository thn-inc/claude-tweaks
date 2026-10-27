// The v1 test-impact map reader exactly as shipped before #4131 added the optional `dirty` field
// (plugin/bin/lib/verify/impact.js at 3ad36593f). It is a frozen fixture: NEVER edit it. A reader
// built before the field existed must keep parsing a map that carries `dirty`, which is what keeps
// IMPACT_MAP_VERSION at 1.
'use strict';

const IMPACT_MAP_VERSION = 1;
const KINDS = ['f', 's', 'd', 'c'];
const SHA_RE = /^[0-9a-f]{40}$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

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

module.exports = { parseImpactMap };
