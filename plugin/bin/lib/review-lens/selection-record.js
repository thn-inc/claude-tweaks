'use strict';

// lens-selection.json — the per-run record of which review lenses the adaptive selector ran and which it skipped
// (#6001). Its one writer is `bin/review-lens-select.js`; nothing hand-types it. The parked measurement record reads
// it beside `lens-dispatch.json` (dispatch-record.js).
//
// File shape: {"v": 1, "tier", "selected": [lens], "skipped": [{lens, reason}], "fallback": null | "<reason>"} —
// `v: 1` plus select.js's output object, unchanged.
//
// readLensSelection(dir) -> { state: 'absent' } | { state: 'ok', doc } | { state: 'error', reason }. A malformed file
// is `error`, never absence.
//
// readSkipStreaks({ roots, excludeRunId }) -> { ok: true, byLens } | { ok: false, reason }: per lens, how many
// consecutive newest runs skipped it. Runs are ordered by the run id's leading UTC timestamp, newest first (ties by
// run id; undated ids and runs with no lens-selection.json are ignored). For each run, a lens its tier allows
// (TIER_LENSES) is either skipped (the streak grows) or not (selected, including every lens of a fallback run: the
// streak ends); a lens its tier excludes neither grows nor ends the streak. `byLens` holds a non-negative integer for
// every lens of LENS_IDS, 0 included — select.js forces a lens missing from it. One malformed lens-selection.json
// or an unreadable root/archive makes the whole result `ok: false` (select.js then forces every below-floor lens:
// the safe direction, never a streak of 0). A run id under a root and `{root}/archive` counts once (first root, then
// the live copy over `archive/`, as history.js's twin rule).

const fs = require('node:fs');
const path = require('node:path');
const { writeFileAtomic } = require('../atomic-write');
const { lstatType } = require('../path-guard');
const { LENS_IDS } = require('./dispatch-record');
const { startedAtOf } = require('./history');
const { TIERS, TIER_LENSES } = require('./select');

const LENS_SELECTION_FILE = 'lens-selection.json';
const SELECTION_SCHEMA_VERSION = 1;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const codeOf = (err) => (err && err.code) || 'unknown';

function writeLensSelection(runDir, selection) {
  writeFileAtomic(path.join(runDir, LENS_SELECTION_FILE), JSON.stringify({ v: SELECTION_SCHEMA_VERSION, ...selection }, null, 2) + '\n');
}

// The refusal text for a parsed document, or null for a valid one.
function docProblem(doc) {
  if (!isObject(doc)) return 'not an object';
  if (doc.v !== SELECTION_SCHEMA_VERSION) return `v must be ${SELECTION_SCHEMA_VERSION}`;
  if (typeof doc.tier !== 'string' || !TIERS.includes(doc.tier)) return `tier must be one of ${TIERS.join(', ')}`;
  if (!Array.isArray(doc.selected) || !doc.selected.every((l) => LENS_IDS.includes(l))) return 'selected must be an array of lens ids';
  if (!Array.isArray(doc.skipped) || !doc.skipped.every((s) => isObject(s) && LENS_IDS.includes(s.lens) && typeof s.reason === 'string')) {
    return 'skipped must be an array of {lens, reason}';
  }
  if (doc.fallback !== null && typeof doc.fallback !== 'string') return 'fallback must be null or a string';
  return null;
}

function readLensSelection(dir) {
  const file = path.join(dir, LENS_SELECTION_FILE);
  const type = lstatType(file);
  if (type.type === 'missing') return { state: 'absent' };
  if (type.type !== 'file') return { state: 'error', reason: type.type === 'unreadable' ? `unreadable (${type.code})` : `not a regular file (${type.type})` };
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { state: 'error', reason: `unreadable (${codeOf(err)})` };
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { state: 'error', reason: 'unparseable' };
  }
  const problem = docProblem(doc);
  return problem ? { state: 'error', reason: problem } : { state: 'ok', doc };
}

// Run directories under a root and its archive, or a reason string when one cannot be listed.
function listRuns(roots) {
  const found = [];
  for (const [rootIndex, root] of roots.entries()) {
    for (const [dir, archive] of [[root, false], [path.join(root, 'archive'), true]]) {
      const type = lstatType(dir);
      if (type.type === 'missing' && archive) continue;
      if (type.type !== 'directory') return { problem: `${archive ? 'unreadable archive' : 'unreadable root'} ${dir} (${type.code || type.type})` };
      let names;
      try {
        names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'archive').map((d) => d.name);
      } catch (err) {
        return { problem: `${archive ? 'unreadable archive' : 'unreadable root'} ${dir} (${codeOf(err)})` };
      }
      for (const name of names) found.push({ dir: path.join(dir, name), name, archive, rootIndex });
    }
  }
  return { found };
}

function readSkipStreaks({ roots, excludeRunId } = {}) {
  if (!Array.isArray(roots) || roots.length === 0 || !roots.every((r) => typeof r === 'string' && r !== '')) {
    throw new TypeError('roots must be a non-empty array of strings');
  }
  const listed = listRuns(roots);
  if (listed.problem) return { ok: false, reason: listed.problem };
  const byName = new Map();
  for (const run of listed.found.sort((a, b) => (Number(a.archive) - Number(b.archive)) || (a.rootIndex - b.rootIndex))) {
    if (!byName.has(run.name)) byName.set(run.name, run);
  }
  const runs = [...byName.values()]
    .filter((r) => r.name !== excludeRunId)
    .map((r) => ({ ...r, startedAt: startedAtOf(r.name) }))
    .filter((r) => r.startedAt !== null)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : (a.name < b.name ? 1 : -1)));
  const byLens = Object.fromEntries(LENS_IDS.map((l) => [l, 0]));
  const ended = new Set();
  for (const run of runs) {
    const read = readLensSelection(run.dir);
    if (read.state === 'absent') continue;
    if (read.state === 'error') return { ok: false, reason: `${path.join(run.dir, LENS_SELECTION_FILE)} is malformed (${read.reason})` };
    const skipped = new Set(read.doc.skipped.map((s) => s.lens));
    for (const lens of TIER_LENSES[read.doc.tier]) {
      if (ended.has(lens)) continue;
      if (skipped.has(lens)) byLens[lens] += 1;
      else ended.add(lens);
    }
  }
  return { ok: true, byLens };
}

module.exports = { LENS_SELECTION_FILE, writeLensSelection, readLensSelection, readSkipStreaks };
