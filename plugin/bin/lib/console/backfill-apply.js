// plugin/bin/lib/console/backfill-apply.js — the Review Console backlog
// backfill's apply step (#3950), and the only code that ever writes a
// console.json for it. Each entry settles one work item from backfill.js's
// list: the stored item gets the outcome as its resolution plus a `settled`
// audit record. A legacy `decision:` group is persisted split — one entry per
// finding, the unsettled ones carrying their `backfillSource` line and the
// `backfillFinding` they were split into, so the next listing lists them as
// they were. Once nothing in the console is
// unresolved it is acknowledged; an existing acknowledgement is never touched.
// Pure: no fs. The CLI (console-backfill.js) reads and writes the files.
'use strict';

const { consoleWorkItems } = require('./backfill');
const { UNRESOLVED_RESOLUTIONS } = require('./residue');

// None of these is in UNRESOLVED_RESOLUTIONS, and the backfill applies nothing,
// so `applied`/`apply`/`approve` are never written.
const BACKFILL_OUTCOMES = ['filed', 'dropped', 'digested', 'dismissed'];
const BACKFILL_SOURCES = ['tiebreak', 'staged-kind', 'digest'];
const FILED_REF_RE = /^#\d+$/;

const nonEmpty = (v) => typeof v === 'string' && v !== '';

// The entry's own shape, before it is matched against the console. `ref` is
// required for every outcome; a `filed` ref names the record (`#N`).
function entryProblem(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !nonEmpty(entry.itemId) || !nonEmpty(entry.itemHash)) return 'malformed';
  if (!BACKFILL_OUTCOMES.includes(entry.outcome)) return 'bad-outcome';
  if (!BACKFILL_SOURCES.includes(entry.source)) return 'bad-source';
  if (!nonEmpty(entry.ref) || (entry.outcome === 'filed' && !FILED_REF_RE.test(entry.ref))) return 'missing-ref';
  return null;
}

function settledFields({ itemId, outcome, source, ref }, at) {
  return { resolution: outcome, reason: `backfill: ${source} → ${outcome} (${ref})`, settled: { outcome, source, ref, at }, backfillId: itemId };
}

// The finding an unsettled split sibling was split into, persisted so the next
// listing uses it as written instead of re-splitting the line: a change to the
// split or claim heuristics between passes (a plugin upgrade) then cannot lose
// it. `claimText` is '' for a claim-empty sibling. Null for a sibling with no
// location (a no-path line), which re-splits from `backfillSource`.
function persistedFinding(w) {
  if (!w.finding) return null;
  const { lens, path, line } = w.finding;
  const locations = Array.isArray(w.locations) ? { locations: w.locations } : {};
  return { lens, path, line, claimText: typeof w.claimText === 'string' ? w.claimText : '', ...locations };
}

// The entries that replace one touched group's stored items. A work item with
// no `bundleLine` is non-split: it is its group's only item, settled in place
// on the group's first stored item (its id and section kept). A split item is
// written under its own `bf:` id, settled or carrying its source line and the
// finding it was split into.
function groupEntries(group, stored, settledBy, at) {
  const first = stored[group[0].storedIndices[0]];
  return group.map((w) => {
    const entry = settledBy.get(w.itemId);
    if (!w.bundleLine) return { ...first, ...settledFields(entry, at) };
    if (entry) return { id: w.itemId, section: w.section, ...settledFields(entry, at) };
    const finding = persistedFinding(w);
    return {
      id: w.itemId, section: w.section, resolution: first.resolution, reason: first.reason, backfillSource: w.bundleLine, ...(finding ? { backfillFinding: finding } : {}),
    };
  });
}

// `at` is the ISO timestamp the caller stamps every settled record with.
// `json` is null when nothing changed; `acknowledged` is true only when this
// call set `residueAcknowledgedAt`.
function applyToConsole({ consoleDir, consoleJson, decisions, readStaged, runId, entries, at }) {
  if (!nonEmpty(at)) throw new TypeError('applyToConsole: `at` must be an ISO timestamp string');
  const stored = consoleJson && Array.isArray(consoleJson.items) ? consoleJson.items : [];
  // One listing over the console as it is before the write: every sibling of a
  // rewritten group comes from it.
  const work = consoleWorkItems({ consoleDir, consoleJson, decisions, readStaged, runId });
  const byId = new Map(work.map((w) => [w.itemId, w]));
  // One id listed by two stored groups (an old-shape and a new-shape decision id both matching one
  // line) names two different stored items: an entry for it is refused, never applied to both or either.
  const listedTimes = new Map();
  for (const w of work) listedTimes.set(w.itemId, (listedTimes.get(w.itemId) || 0) + 1);
  const counts = new Map();
  for (const e of entries) {
    if (e && nonEmpty(e.itemId)) counts.set(e.itemId, (counts.get(e.itemId) || 0) + 1);
  }
  const isSettled = (id) => stored.some((s) => s && s.settled && (s.id === id || s.backfillId === id));

  const applied = [];
  const refused = [];
  const settledBy = new Map();
  for (const e of entries) {
    const reason = entryProblem(e)
      || (counts.get(e.itemId) > 1 ? 'duplicate-entry' : null)
      || (isSettled(e.itemId) ? 'already-settled' : null)
      || (byId.has(e.itemId) ? null : 'unknown-item')
      || (listedTimes.get(e.itemId) > 1 ? 'ambiguous-item' : null)
      || (byId.get(e.itemId).itemHash === e.itemHash ? null : 'stale-hash');
    if (reason) {
      refused.push({ itemId: e && typeof e === 'object' ? e.itemId : undefined, reason });
    } else {
      settledBy.set(e.itemId, e);
      applied.push(e.itemId);
    }
  }
  if (applied.length === 0) return { json: null, applied, refused, acknowledged: false };

  // Work items group by the stored items they came from; a touched group is
  // replaced at its first stored index, in work-item order. Every other stored
  // item keeps its place and its bytes.
  const groups = new Map();
  for (const w of work) {
    const key = w.storedIndices.join(',');
    groups.set(key, [...(groups.get(key) || []), w]);
  }
  const replaced = new Map();
  for (const group of groups.values()) {
    if (!group.some((w) => settledBy.has(w.itemId))) continue;
    const [head, ...rest] = group[0].storedIndices;
    replaced.set(head, groupEntries(group, stored, settledBy, at));
    for (const i of rest) replaced.set(i, []);
  }
  const items = stored.flatMap((item, i) => (replaced.has(i) ? replaced.get(i) : [item]));

  const json = { ...consoleJson, items };
  const acknowledged = consoleJson.residueAcknowledgedAt === undefined && !items.some((i) => i && UNRESOLVED_RESOLUTIONS.has(i.resolution));
  if (acknowledged) json.residueAcknowledgedAt = at;
  return { json, applied, refused, acknowledged };
}

module.exports = { BACKFILL_OUTCOMES, BACKFILL_SOURCES, entryProblem, applyToConsole };
