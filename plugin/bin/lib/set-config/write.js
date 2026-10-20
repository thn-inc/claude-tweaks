// bin/lib/set-config/write.js — validate and write one config.yml policy
// lever into a pipeline run directory. The config.yml third of the
// sanctioned-write family (#637/#686 precedent: bin/lib/stage-item/write.js
// for staged/, bin/lib/log-decision/append.js for decisions.md) — closes
// #1376's gap: a worktree-isolated session has no Edit/Write path to the
// run dir, so the ceremony escape hatch's "downgrade ceremony-profile in
// place" needs a CLI.
//
// Anchoring reuses bin/lib/stage-item/write.js's exported resolveTarget
// verbatim (the caller, bin/set-config.js, invokes it) — that predicate's
// header documents why it is duplicated across the two SMALL siblings and
// not a third time; importing is the record's own Technical Approach
// ("directly reusable").
//
// Lever names validate against the canonical Manifesto lever set (pinned
// against manifesto.md's config.yml example block by
// tests/bin-lib/set-config/write.test.js), plus RUN_PINS — run-scoped keys
// (integration-model) validated the same way but never Manifesto levers.
// Values validate against POLICY_KEYS enums where a schema row exists;
// `mode` and `ceremony-profile` are config.yml-only levers with no
// POLICY_KEYS row (flow/manifesto.md computes them per run), so their enums
// live here.
//
// Caveat: bin/resolve-policy.js --run resolves only POLICY_KEYS-backed
// levers — `ceremony-profile` and `mode` return unknown-key there, by
// design (they have no POLICY_KEYS row; see above). Skills read those two
// straight from config.yml, so this CLI's write is still effective without
// resolve-policy.js's involvement — this is not a gap to "fix" there.
'use strict';

const fs = require('fs');
const path = require('path');
const { POLICY_KEYS } = require('../policy-schema');

// Ordered per manifesto.md's canonical lever numbering (1=Mode ... 13=Merge
// authorization). spec:/created: are run bookkeeping, not levers — excluded.
const MANIFESTO_LEVERS = Object.freeze([
  'mode', 'scope-creep', 'overlap', 'design-intent', 'leftover-default',
  'auto-fix-threshold', 'review-auto-apply-ceiling', 'tidy-aggressiveness',
  'ceremony-profile', 'model-stance', 'merge-verification', 'design-critique',
  'merge-authorization',
]);

// Run pins: config.yml keys a run records once at its start, validated like
// levers (enum from POLICY_KEYS) but deliberately NOT Manifesto levers — no
// Manifesto prompt asks for them and the FYI table does not show them. They
// stay out of MANIFESTO_LEVERS because integration-model is run-scoped
// (_shared/integration-model.md's Run-scoped stability): the value is fixed
// for the run's life, not a policy the operator tunes at the Manifesto gate.
const RUN_PINS = Object.freeze(['integration-model']);

function isConfigKey(key) {
  return MANIFESTO_LEVERS.includes(key) || RUN_PINS.includes(key);
}

// The two levers with no POLICY_KEYS row: their value sets are defined by
// flow/manifesto.md (mode table; ceremony fold), stated here as data.
const CONFIG_ONLY_VALUES = Object.freeze({
  mode: Object.freeze(['auto', 'hybrid', 'interactive']),
  'ceremony-profile': Object.freeze(['fast-lane', 'standard']),
});

// key -> allowed values array, or null when key is not a config.yml lever OR
// is a lever or run pin with no known enum (name-only validation; none
// exists today). validateLever below tells the two null cases apart itself —
// it checks isConfigKey before calling this — so this function's null return
// does not by itself mean "unknown key".
function leverValues(key) {
  if (!isConfigKey(key)) return null;
  if (CONFIG_ONLY_VALUES[key]) return [...CONFIG_ONLY_VALUES[key]];
  const row = POLICY_KEYS.find((r) => r.key === key);
  if (row && row.type === 'enum') return [...row.values];
  return null; // a lever with no known enum would validate name-only; none exists today
}

// (key, value) -> { ok } | { ok:false, reason:'unknown-key' } |
// { ok:false, reason:'invalid-value', allowed }
function validateLever(key, value) {
  if (!isConfigKey(key)) return { ok: false, reason: 'unknown-key' };
  const allowed = leverValues(key);
  if (allowed === null) return { ok: true }; // a lever with no known enum: name-only validation
  if (!allowed.includes(value)) return { ok: false, reason: 'invalid-value', allowed };
  return { ok: true };
}

// { runDir, key, value } -> { file, previous }. Idempotent set: replace the
// first column-0 `key:` line in place (dropping any trailing comment on that
// line — the value change is the point), delete any subsequent duplicate
// `key:` line (policy-schema.js's parseFlatLines takes the LAST occurrence
// of a duplicated key, so a stale earlier line would silently read back as
// live — leaving it in place defeats the write), append when absent, create
// the file when missing. `previous` is the parse-effective prior value —
// the LAST occurrence's value, matching parseFlatLines semantics — not
// necessarily the first line's. Every other line is preserved byte-for-byte.
// Throws on fs errors — the CLI maps those to exit 3.
function setConfigLever({ runDir, key, value }) {
  const file = path.join(runDir, 'config.yml');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* config.yml not yet created */ }
  const lines = text ? text.split('\n') : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const re = new RegExp(`^${key}:\\s*([^#]*)`);
  let previous = null;
  let firstIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    previous = m[1].trim() || null; // last occurrence wins, matching parseFlatLines
    if (firstIdx === -1) firstIdx = i;
  }
  if (firstIdx === -1) {
    lines.push(`${key}: ${value}`);
  } else {
    lines[firstIdx] = `${key}: ${value}`;
    for (let i = lines.length - 1; i > firstIdx; i--) {
      if (re.test(lines[i])) lines.splice(i, 1);
    }
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return { file, previous };
}

module.exports = { MANIFESTO_LEVERS, RUN_PINS, isConfigKey, leverValues, validateLever, setConfigLever };
