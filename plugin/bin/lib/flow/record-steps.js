// lib/flow/record-steps.js — the per-record step grammar of a multi-spec run
// (#4358): `#A:none;#B:build,test` names each record's own remaining steps.
//
// Entries split on `;`, an entry on its first `:`, the steps on `,`; whitespace
// around any of the three is dropped. `none` is a record with nothing left, and
// stands alone in its entry. Each record's steps appear once, in FLOW_STEPS
// order, and at least one record has a step left: a mangled value must not
// become a resume that skips or repeats a step, so every departure is refused
// with its own `reason`. Only the record token meets a regex; the value itself
// is unbounded and is only ever split.
'use strict';

const { FLOW_STEPS } = require('../claim-targets/claim-targets');

const RECORD_RE = /^#[1-9]\d*$/;
const NONE = 'none';
// `review-console` is resume-only (claim-targets' FLOW_STEPS note), never a
// record's own remaining step, unless the caller's `allowed` says otherwise.
const DEFAULT_ALLOWED = Object.freeze(FLOW_STEPS.filter((s) => s !== 'review-console'));

function refuse(reason, message) {
  return { ok: false, reason, message };
}

// null when the entry's steps are valid, else the refusal.
function checkSteps(record, parts, permitted) {
  if (parts.length > 1 && parts.includes(NONE)) {
    return refuse('mixed-none', `${record}: "${NONE}" stands alone, not beside other steps`);
  }
  if (parts[0] === NONE) return null;
  const bad = parts.find((p) => !permitted.includes(p));
  if (bad !== undefined) {
    return refuse('invalid-step', `${record}: unknown step ${JSON.stringify(bad)} — accepted: ${permitted.join(', ')}`);
  }
  if (new Set(parts).size !== parts.length) {
    return refuse('duplicate-step', `${record}: names a step twice: ${parts.join(',')}`);
  }
  const rank = parts.map((p) => FLOW_STEPS.indexOf(p));
  if (rank.some((r, i) => i > 0 && r < rank[i - 1])) {
    return refuse('out-of-order', `${record}: steps out of lifecycle order: ${parts.join(',')} — the order is ${FLOW_STEPS.join(', ')}`);
  }
  return null;
}

function formatRecordSteps(recordSteps) {
  return Object.entries(recordSteps)
    .map(([record, steps]) => `${record}:${steps.length ? steps.join(',') : NONE}`)
    .join(';');
}

function parseRecordSteps(raw, { allowed = DEFAULT_ALLOWED, targets = null } = {}) {
  if (typeof raw !== 'string' || raw.trim() === '') return refuse('empty', 'the value is empty');
  const permitted = FLOW_STEPS.filter((s) => allowed.includes(s));
  const recordSteps = {};
  for (const entry of raw.split(';')) {
    const colon = entry.indexOf(':');
    const record = colon === -1 ? '' : entry.slice(0, colon).trim();
    const stepsText = colon === -1 ? '' : entry.slice(colon + 1).trim();
    if (!record || !stepsText) {
      return refuse('malformed-entry', `entry ${JSON.stringify(entry.trim())} is not #N:step[,step] or #N:${NONE}`);
    }
    if (!RECORD_RE.test(record)) return refuse('bad-record', `${JSON.stringify(record)} is not a record reference (#N)`);
    if (Object.hasOwn(recordSteps, record)) return refuse('duplicate-record', `${record} appears twice`);
    const parts = stepsText.split(',').map((s) => s.trim());
    const bad = checkSteps(record, parts, permitted);
    if (bad) return bad;
    recordSteps[record] = parts[0] === NONE ? [] : parts;
  }
  const records = Object.keys(recordSteps);
  if (targets !== null) {
    const missing = targets.filter((t) => !Object.hasOwn(recordSteps, t));
    const expected = new Set(targets);
    const extra = records.filter((r) => !expected.has(r));
    if (missing.length || extra.length) {
      return refuse('target-mismatch', `the records differ from the targets — missing: ${missing.join(', ') || '(none)'}; extra: ${extra.join(', ') || '(none)'}`);
    }
  }
  const named = new Set(records.flatMap((r) => recordSteps[r]));
  if (named.size === 0) return refuse('nothing-left', 'every record is none: no step is left to run');
  return {
    ok: true,
    records,
    recordSteps,
    steps: FLOW_STEPS.filter((s) => named.has(s)),
    canonical: formatRecordSteps(recordSteps),
  };
}

module.exports = { parseRecordSteps, formatRecordSteps, RECORD_RE };
