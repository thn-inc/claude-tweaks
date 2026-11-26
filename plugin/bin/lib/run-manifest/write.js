// bin/lib/run-manifest/write.js
//
// Writer for a run's manifest.json (#5903): the run-start facts (plugin version, policy hash, base
// commit, model profile, lane, ceremony profile) in one file at `{run-dir}/manifest.json`.
//
//   initRunManifest — the mint writes the file once, with the gathered facts. Never overwrites.
//   fillRunManifest — a later step sets a field that was still null. Fields are only ever added;
//                     the one overwrite is `ceremonyProfile`, which tracks the latest verdict.
//                     The close fills `closedAt` and `minutes` (fill-only-null) and the cost group
//                     (#6009) as one unit: written while no cost is stored, upgraded once from a
//                     partial or null-cost group to a complete one, never after a complete group.
//
// Nothing here throws and nothing changes a caller's outcome: a failed write is dropped with one
// stderr line. manifest.json is not run initialization — it carries none of the files (decisions.md,
// run-state.json, config.yml) whose presence makes a directory look like a started run.
//
// Both writes are best-effort and last-writer-wins: a fill is a read-modify-write with no lock, and
// the atomic rename prevents only a torn file, not a lost update between two concurrent fills.
//
// Not the unrelated `manifest.yml` (flow/manifest.js) or acceptance-packet.js's manifest.json.
'use strict';
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../atomic-write');
const { canonicalJson, gatherFacts } = require('./facts');
const { leverValues } = require('../set-config/write');

const MANIFEST_FILE = 'manifest.json';
const MANIFEST_VERSION = 1;
const LANES = Object.freeze(['standard', 'express', 'driver', 'unknown']);
// The run-config lever's own value sets, so a profile or stance added there is accepted here too.
const CEREMONY_PROFILES = Object.freeze(leverValues('ceremony-profile'));
const MODEL_STANCES = Object.freeze(leverValues('model-stance'));
// The facts a fill sets only while they are still null.
const FILL_ONLY_NULL = Object.freeze(['pluginVersion', 'policyHash', 'baseCommit', 'modelProfile']);
// The shape each of those facts must have to be written; anything else is ignored.
const FILL_VALID = Object.freeze({
  pluginVersion: (v) => typeof v === 'string' && v.length > 0,
  policyHash: (v) => typeof v === 'string' && /^sha256:[0-9a-f]{64}$/.test(v),
  baseCommit: (v) => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v),
  modelProfile: (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
    && MODEL_STANCES.includes(v.stance)
    && (v.ceiling === null || typeof v.ceiling === 'string'),
});
// The close-out times, filled only while still null.
const CLOSE_FIELDS = Object.freeze(['closedAt', 'minutes']);
const CLOSE_VALID = Object.freeze({
  closedAt: (v) => typeof v === 'string' && v.length > 0 && !Number.isNaN(Date.parse(v)),
  minutes: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
});
// The cost fields, validated and written as one unit.
const COST_GROUP = Object.freeze(['tokensByModel', 'costUsd', 'priceDate', 'unpricedModels', 'costPartial']);
const TOKEN_KEYS = Object.freeze(['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h']);
const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const COST_VALID = Object.freeze({
  tokensByModel: (v) => v === null || (isObject(v)
    && Object.values(v).every((t) => isObject(t) && TOKEN_KEYS.every((k) => isCount(t[k])))),
  costUsd: (v) => v === null || isCount(v),
  priceDate: (v) => v === null || typeof v === 'string',
  unpricedModels: (v) => v === null || (Array.isArray(v) && v.every((m) => typeof m === 'string')),
  costPartial: (v) => v === null || typeof v === 'boolean',
});
const validCostGroup = (g) => isObject(g) && COST_GROUP.every((k) => g[k] !== undefined && COST_VALID[k](g[k]));

// Whether a valid new group may be stored over what the manifest holds: freely while no cost is
// stored, and once from a partial / null-cost group to a complete one.
function mayWriteCost(manifest, group) {
  if (manifest.costUsd == null) return true;
  const storedOpen = manifest.costPartial === true || manifest.costUsd === null;
  return storedOpen && group.costPartial === false && group.costUsd !== null;
}

// A multi-spec parent's per-spec child directory: one manifest lives at the top-level run dir.
const SPEC_CHILD_DIR = /^spec-\d+$/;

function defaults(deps = {}) {
  return {
    gatherFacts: deps.gatherFacts || gatherFacts,
    writeFileAtomic: deps.writeFileAtomic || writeFileAtomic,
    readFileSync: deps.readFileSync || ((p) => fs.readFileSync(p, 'utf8')),
    existsSync: deps.existsSync || fs.existsSync,
    now: deps.now || (() => new Date()),
    stderr: deps.stderr || ((line) => process.stderr.write(line)),
  };
}

// Sorted keys at every depth, two-space indent, one trailing newline.
function serialize(manifest) {
  return `${JSON.stringify(JSON.parse(canonicalJson(manifest)), null, 2)}\n`;
}

function drop(d, err) {
  try {
    d.stderr(`claude-tweaks: run-manifest: ${err && err.message ? err.message : String(err)}\n`);
  } catch { /* a broken stderr must not break the caller either */ }
}

function pick(vocabulary, value, fallback) {
  return typeof value === 'string' && vocabulary.includes(value) ? value : fallback;
}

// A manifest with every fact still unset; init and fill each set the fields they have.
function blankManifest(runDir, d) {
  return {
    v: MANIFEST_VERSION,
    runId: path.basename(runDir),
    createdAt: new Date(d.now()).toISOString(),
    lane: 'unknown',
    ceremonyProfile: null,
    pluginVersion: null,
    policyHash: null,
    baseCommit: null,
    modelProfile: null,
  };
}

function initRunManifest(runDir, facts = {}, deps = {}) {
  const d = defaults(deps);
  try {
    if (!d.existsSync(runDir)) throw new Error(`run directory does not exist, no manifest written: ${runDir}`);
    const file = path.join(runDir, MANIFEST_FILE);
    if (d.existsSync(file)) return { written: false };
    const gathered = d.gatherFacts({ cwd: facts.cwd || process.cwd(), env: facts.env });
    const manifest = {
      ...blankManifest(runDir, d),
      lane: pick(LANES, facts.lane, 'unknown'),
      pluginVersion: gathered.pluginVersion ?? null,
      policyHash: gathered.policyHash ?? null,
      baseCommit: gathered.baseCommit ?? null,
      modelProfile: gathered.modelProfile ?? null,
    };
    d.writeFileAtomic(file, serialize(manifest));
    return { written: true };
  } catch (err) {
    drop(d, err);
    return { written: false };
  }
}

function readExisting(file, d) {
  let text;
  try {
    text = d.readFileSync(file);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { missing: true };
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${MANIFEST_FILE} is not valid JSON, left untouched (${err.message})`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${MANIFEST_FILE} is not a JSON object, left untouched`);
  }
  return { manifest: parsed };
}

function fillRunManifest(runDir, fields = {}, deps = {}) {
  const d = defaults(deps);
  try {
    if (!d.existsSync(runDir)) throw new Error(`run directory does not exist, no manifest written: ${runDir}`);
    const file = path.join(runDir, MANIFEST_FILE);
    const existing = readExisting(file, d);
    // A spec-N child dir with no manifest of its own is never given one: it would nest a second,
    // misleading manifest under the parent run's.
    if (existing.missing && SPEC_CHILD_DIR.test(path.basename(runDir))) return { changed: [] };
    // A manifest the mint did not leave starts blank: only the passed fields get values, no fact is gathered.
    const manifest = existing.missing ? blankManifest(runDir, d) : existing.manifest;
    const input = fields || {};
    const changed = [];

    for (const key of FILL_ONLY_NULL) {
      const value = input[key];
      if (value === undefined || value === null || manifest[key] != null || !FILL_VALID[key](value)) continue;
      manifest[key] = value;
      changed.push(key);
    }

    // The first known lane wins: only an unset/unknown lane is replaced, and never by unknown.
    const lane = pick(LANES, input.lane, null);
    if (lane && lane !== 'unknown' && (manifest.lane == null || manifest.lane === 'unknown')) {
      manifest.lane = lane;
      changed.push('lane');
    }

    // The one overwrite: the ceremony profile tracks the latest verdict.
    const profile = pick(CEREMONY_PROFILES, input.ceremonyProfile, null);
    if (profile && manifest.ceremonyProfile !== profile) {
      manifest.ceremonyProfile = profile;
      changed.push('ceremonyProfile');
    }

    for (const key of CLOSE_FIELDS) {
      const value = input[key];
      if (value === undefined || value === null || manifest[key] != null || !CLOSE_VALID[key](value)) continue;
      manifest[key] = value;
      changed.push(key);
    }

    const group = input.cost;
    if (validCostGroup(group) && mayWriteCost(manifest, group)) {
      for (const key of COST_GROUP) {
        if (key in manifest && canonicalJson(group[key]) === canonicalJson(manifest[key])) continue;
        manifest[key] = group[key];
        changed.push(key);
      }
    }

    if (changed.length > 0) d.writeFileAtomic(file, serialize(manifest));
    return { changed };
  } catch (err) {
    drop(d, err);
    return { changed: [] };
  }
}

module.exports = { MANIFEST_FILE, MANIFEST_VERSION, LANES, CEREMONY_PROFILES, CLOSE_FIELDS, COST_GROUP, initRunManifest, fillRunManifest };
