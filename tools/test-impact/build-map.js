'use strict';
// tools/test-impact/build-map.js — folds a traced run's trace files into a test-impact map (#4024).
//
// tools/test-impact/tracer.js leaves one `{pid}-{ms}-{rand}.trace` file per attributed process in the
// trace dir: a `["T", test]` header line, then `[kind, relPath]` lines (kinds f/s/d/c). Every file of a
// test (its worker and each node child) is unioned into that test's entry, and the result is encoded
// by plugin/bin/lib/verify/impact.js's encodeImpactMap; `dirty` (whether the traced tree had tracked
// changes) is passed through unchanged, and absent when the caller gives none.
//
// Fails closed: a line of a headed file that does not parse as a record is counted in `skipped` and
// gives its test `c: ['']` (the whole-repo prefix, selecting it for every change), since the lost
// line could have named any path. A file whose first line is no header cannot be attributed and is
// skipped whole (counted in `headerless`). Files not ending in `.trace` are ignored, except `.lost` files:
// tracer.js leaves one beside a trace file whose write failed. Each counts in `lost`, and its `["T", test]`
// line names a test in `lostTests`; a marker whose line does not parse still counts in `lost`.

const fs = require('fs');
const path = require('path');
const { encodeImpactMap, KINDS } = require('../../plugin/bin/lib/verify/impact');

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch (_) {
    return undefined;
  }
}

const isRecord = (r) => Array.isArray(r) && r.length === 2 && KINDS.includes(r[0]) && typeof r[1] === 'string';
const isHeader = (r) => Array.isArray(r) && r.length === 2 && r[0] === 'T' && typeof r[1] === 'string' && r[1] !== '';

// → { map (encoded), skipped (unparseable record lines), headerless (unattributable files), lost (`.lost`
// markers), lostTests (sorted unique test names the markers name) }.
function buildMap({ traceDir, commit, exitCode, node, dirty, now = Date.now, fsImpl = fs }) {
  const tests = new Map();
  let skipped = 0;
  let headerless = 0;
  let lost = 0;
  const lostTests = new Set();
  for (const name of fsImpl.readdirSync(traceDir).sort()) {
    if (name.endsWith('.lost')) {
      lost++;
      const header = parseLine(fsImpl.readFileSync(path.join(traceDir, name), 'utf8').split('\n')[0]);
      if (isHeader(header)) lostTests.add(header[1]);
      continue;
    }
    if (!name.endsWith('.trace')) continue;
    const lines = fsImpl.readFileSync(path.join(traceDir, name), 'utf8').split('\n').filter((l) => l !== '');
    const header = lines.length ? parseLine(lines[0]) : undefined;
    if (!isHeader(header)) {
      headerless++;
      continue;
    }
    const test = header[1];
    if (!tests.has(test)) tests.set(test, Object.fromEntries(KINDS.map((k) => [k, new Set()])));
    const entry = tests.get(test);
    for (const line of lines.slice(1)) {
      const rec = parseLine(line);
      if (isRecord(rec)) {
        entry[rec[0]].add(rec[1]);
      } else {
        skipped++;
        entry.c.add('');
      }
    }
  }
  const plain = {};
  for (const [test, entry] of tests) {
    plain[test] = Object.fromEntries(KINDS.map((k) => [k, [...entry[k]]]));
  }
  const map = encodeImpactMap({ commit, tracedAt: new Date(now()).toISOString(), exitCode, node, tests: plain, dirty });
  return { map, skipped, headerless, lost, lostTests: [...lostTests].sort() };
}

module.exports = { buildMap };
