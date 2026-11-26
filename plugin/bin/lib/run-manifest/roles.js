'use strict';
// plugin/bin/lib/run-manifest/roles.js — a run's model and effort per role (#6010). Pure: reads no file.
//
// One source per lane, chosen by `manifest.lane`:
// - session lanes: the main session (`session`, from readUsage-shaped rows) plus each dispatched item
//   (role from item.role or roleOf(description)), `models` from the item's model (the transcript id wins
//   over the dispatch alias: what ran, not what was asked for) and `efforts` from the
//   item's per-turn usageRows;
// - the driver lane: each launch line in driver-events.jsonl whose step maps to a driver role.
// `models` counts agents; `efforts` counts assistant turns (launches on the driver lane, where no turns
// are read). `unknown` means no model or effort was recorded. Returns null when no source exists.
// Does not throw on any input shape; a thrown error is a bug, which the caller logs.
// Model ids and efforts come from transcripts, so counts are built with Object.fromEntries over a Map:
// `__proto__` is then an ordinary own key.

const { roleOf } = require('../timing/derive');

// Renaming a driver role changes the keys of manifest `roles` — a contract (#6010).
const DRIVER_STEP_ROLES = Object.freeze({ worker: 'implementer', review: 'reviewer', 'merge-check': 'merge-check', 'merge-acceptance': 'acceptance' });

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v !== '';
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

function tallyInto(m, rows) {
  for (const r of rows) {
    if (isObject(r) && r.role === 'assistant' && r.turnStart === true) bump(m, nonEmpty(r.effort) ? r.effort : 'unknown');
  }
}

function deriveRoles(args) {
  const { manifest, rows, items, events } = isObject(args) ? args : {};
  const acc = new Map(); // role -> { agents, models: Map, efforts: Map }
  const entry = (role) => {
    if (!acc.has(role)) acc.set(role, { agents: 0, models: new Map(), efforts: new Map() });
    return acc.get(role);
  };
  if (isObject(manifest) && manifest.lane === 'driver') {
    for (const line of Array.isArray(events) ? events : []) {
      if (!isObject(line) || typeof line.step !== 'string' || !Object.hasOwn(DRIVER_STEP_ROLES, line.step)) continue;
      if (!nonEmpty(line.model) && !isObject(line.usage)) continue;
      const e = entry(DRIVER_STEP_ROLES[line.step]);
      e.agents += 1;
      bump(e.models, nonEmpty(line.model) ? line.model : 'unknown');
      bump(e.efforts, nonEmpty(line.effort) ? line.effort : 'unknown');
    }
  } else {
    // A <synthetic> row is not a real model turn: neither models nor efforts count it.
    const list = (Array.isArray(rows) ? rows : []).filter((r) => !(isObject(r) && r.model === '<synthetic>'));
    if (list.some((r) => isObject(r) && r.role === 'assistant' && r.turnStart === true)) {
      const e = entry('session');
      e.agents = 1;
      for (const r of list) if (isObject(r) && nonEmpty(r.model)) e.models.set(r.model, 1);
      tallyInto(e.efforts, list);
    }
    for (const item of Array.isArray(items) ? items : []) {
      if (!isObject(item)) continue;
      const e = entry(nonEmpty(item.role) ? item.role : roleOf(item.description));
      e.agents += 1;
      const readable = isObject(item.tokens);
      bump(e.models, readable ? ([item.transcriptModel, item.rawModel, item.metaModel].find(nonEmpty) ?? 'unknown') : 'unknown');
      if (Array.isArray(item.usageRows)) tallyInto(e.efforts, item.usageRows);
      else if (readable) bump(e.efforts, 'unknown');
    }
  }
  if (acc.size === 0) return null;
  return Object.fromEntries([...acc].map(([role, e]) => [role, { agents: e.agents, models: Object.fromEntries(e.models), efforts: Object.fromEntries(e.efforts) }]));
}

const isCount = (n) => Number.isInteger(n) && n >= 0;
const countMap = (o) => isObject(o) && Object.values(o).every(isCount);

function validRoles(value) {
  if (!isObject(value)) return false;
  return Object.values(value).every((v) => isObject(v) && isCount(v.agents) && countMap(v.models) && countMap(v.efforts));
}

module.exports = { deriveRoles, validRoles, DRIVER_STEP_ROLES };
