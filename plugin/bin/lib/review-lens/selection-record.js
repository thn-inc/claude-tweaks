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
// consecutive newest runs skipped it. A run is a run directory under a root or `{root}/archive`, or one of its
// `spec-{N}` member directories (a multi-spec /flow run exports `PIPELINE_RUN_DIR` as `{parent}/spec-{N}/`, so the CLI
// writes the member's lens-selection.json there; history.js reads the same members). `excludeRunId` is the current
// run's run-relative identity, `{id}` or `{id}/spec-{N}`. Runs are ordered by the run id's (a member: its parent's)
// leading UTC timestamp, newest first; ties by the parent id, then the higher member first. Undated ids and runs with
// no lens-selection.json are ignored. For each run, a lens its tier allows
// (TIER_LENSES) is either skipped (the streak grows) or selected (including every lens of a fallback run: the
// streak ends); a lens its tier excludes neither grows nor ends the streak. A document is valid only when `selected`
// and `skipped` partition TIER_LENSES[tier] exactly (select.js's guarantee), so a lens counts as having run only
// because it is in `selected`. `byLens` holds a non-negative integer for every lens of LENS_IDS, 0 included —
// select.js forces a lens missing from it. The scan stops once every lens's streak has ended, so a malformed file
// older than that cannot change a count and is never read. A malformed lens-selection.json inside the counted window,
// a run directory inside it whose members cannot be listed, or an unreadable root/archive makes the whole result
// `ok: false` (select.js then forces every below-floor lens: the safe direction, never a streak of 0). Roots and
// `archive/` are read through symlinks and a missing or non-directory `archive/` is simply absent, as history.js reads
// them. A run identity under a root and `{root}/archive` counts once: the copy holding a lens-selection.json wins,
// then `archive/` over the live copy, then the first root (history.js's twin order, with this file as the evidence).

const fs = require('node:fs');
const path = require('node:path');
const { writeFileAtomic } = require('../atomic-write');
const { lstatType } = require('../path-guard');
const { LENS_IDS } = require('./dispatch-record');
const { startedAtOf } = require('./history');
const { TIERS, TIER_LENSES } = require('./select');

const LENS_SELECTION_FILE = 'lens-selection.json';
const SELECTION_SCHEMA_VERSION = 1;
// A multi-spec /flow run's member directory (flow/materialize.md), as history.js's dispatchSources matches it.
const MEMBER_RE = /^spec-\d+$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const codeOf = (err) => (err && err.code) || 'unknown';

function writeLensSelection(runDir, selection) {
  const problem = docProblem({ v: SELECTION_SCHEMA_VERSION, ...selection });
  if (problem) throw new TypeError(`invalid lens selection: ${problem}`);
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
  const all = [...doc.selected, ...doc.skipped.map((s) => s.lens)];
  const tierSet = TIER_LENSES[doc.tier];
  if (all.length !== tierSet.length || new Set(all).size !== all.length || !all.every((l) => tierSet.includes(l))) {
    return `selected and skipped must partition the ${doc.tier} tier's lenses (${tierSet.join(', ')})`;
  }
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

const childDirNames = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

// Runs under a root and its archive, or { problem } when a root or archive cannot be listed. Each run is
// { dir, id, parent, member, archive, rootIndex }: `id` is the run-relative identity, `{parent}` for a run directory and
// `{parent}/spec-{N}` (member N) for each multi-spec member directory under it (member 0 is the parent itself). A run
// directory whose members cannot be listed carries a `problem`, read only if the scan reaches it.
function listRuns(roots) {
  const found = [];
  for (const [rootIndex, root] of roots.entries()) {
    for (const [dir, archive] of [[root, false], [path.join(root, 'archive'), true]]) {
      let names;
      try {
        names = childDirNames(dir).filter((n) => n !== 'archive');
      } catch (err) {
        if (archive && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) continue;
        return { problem: `${archive ? 'unreadable archive' : 'unreadable root'} ${dir} (${codeOf(err)})` };
      }
      for (const name of names) {
        const runDir = path.join(dir, name);
        const base = { parent: name, archive, rootIndex };
        let members;
        try {
          members = childDirNames(runDir).filter((n) => MEMBER_RE.test(n));
        } catch (err) {
          found.push({ ...base, dir: runDir, id: name, member: 0, problem: `unreadable spec members ${runDir} (${codeOf(err)})` });
          continue;
        }
        found.push({ ...base, dir: runDir, id: name, member: 0 });
        for (const m of members) found.push({ ...base, dir: path.join(runDir, m), id: `${name}/${m}`, member: Number(m.slice(5)) });
      }
    }
  }
  return { found };
}

// Newest first: the parent id's timestamp, then the parent id, then the higher member.
function newestFirst(x, y) {
  if (x.startedAt !== y.startedAt) return x.startedAt < y.startedAt ? 1 : -1;
  if (x.parent !== y.parent) return x.parent < y.parent ? 1 : -1;
  return y.member - x.member;
}

function readSkipStreaks({ roots, excludeRunId } = {}) {
  if (!Array.isArray(roots) || roots.length === 0 || !roots.every((r) => typeof r === 'string' && r !== '')) {
    throw new TypeError('roots must be a non-empty array of strings');
  }
  const listed = listRuns(roots);
  if (listed.problem) return { ok: false, reason: listed.problem };
  const groups = new Map();
  for (const run of listed.found) {
    if (!groups.has(run.id)) groups.set(run.id, []);
    groups.get(run.id).push(run);
  }
  const hasFile = (r) => (readLensSelection(r.dir).state !== 'absent' ? 1 : 0);
  const kept = [];
  for (const group of groups.values()) {
    if (group.length === 1) { kept.push(group[0]); continue; }
    const ranked = group.map((r) => ({ r, file: hasFile(r) }))
      .sort((x, y) => (y.file - x.file) || (Number(y.r.archive) - Number(x.r.archive)) || (x.r.rootIndex - y.r.rootIndex));
    kept.push(ranked[0].r);
  }
  const runs = kept
    .filter((r) => r.id !== excludeRunId)
    .map((r) => ({ ...r, startedAt: startedAtOf(r.parent) }))
    .filter((r) => r.startedAt !== null)
    .sort(newestFirst);
  const byLens = Object.fromEntries(LENS_IDS.map((l) => [l, 0]));
  const ended = new Set();
  for (const run of runs) {
    if (ended.size === LENS_IDS.length) break;
    if (run.problem) return { ok: false, reason: run.problem };
    const read = readLensSelection(run.dir);
    if (read.state === 'absent') continue;
    if (read.state === 'error') return { ok: false, reason: `${path.join(run.dir, LENS_SELECTION_FILE)} is malformed (${read.reason})` };
    const selected = new Set(read.doc.selected);
    for (const lens of TIER_LENSES[read.doc.tier]) {
      if (ended.has(lens)) continue;
      if (selected.has(lens)) ended.add(lens);
      else byLens[lens] += 1;
    }
  }
  return { ok: true, byLens };
}

module.exports = { LENS_SELECTION_FILE, writeLensSelection, readLensSelection, readSkipStreaks };
