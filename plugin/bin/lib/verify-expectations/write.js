// bin/lib/verify-expectations/write.js — the one read-modify-write
// implementation for a run directory's verify-expectations.json (#2764),
// the file `wrap-up-engine.js verify` (lib/wrap-up/engine-verify.js's
// readExpectations) reads. Consumed by bin/set-verify-expectations.js — the
// fourth sanctioned run-dir writer, alongside log-decision.js (decisions.md),
// stage-item.js (staged/), and set-config.js (config.yml) — and by
// bin/wrap-up-engine.js's finish-console verb.
//
// Run-dir anchoring is the caller's job (the CLI goes through
// lib/stage-item/write.js's resolveTarget; wrap-up-engine.js's main() guards
// --run-dir itself) — this module writes into whatever directory it is given.
//
// Merge rules: every field this call does not provide is preserved, including
// keys this module does not know. `memory`, `upstream`, `deferred`, and
// `issues` are each owned whole by one wrap-up step, so a provided value
// replaces the stored one. `oversightExempt` accumulates one record at a time
// (verification-brief.md's Oversight-floor gate), so a provided value is
// unioned into the stored array. An existing file that is unparseable or not
// a JSON object is treated as empty — the same posture finish-console had
// before it moved here.
//
// Write shape: a read-modify-write of one shared file, so it runs under
// lib/file-lock.js's withLock (best-effort, fail-open) and lands via
// lib/atomic-write.js's tmp+rename — the pairing lib/log-decision/append.js
// uses for decisions.md.
'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../atomic-write');
const { withLock } = require('../file-lock');

const FILE_NAME = 'verify-expectations.json';
// The only version lib/wrap-up/engine-verify.js's readExpectations accepts.
const VERSION = 1;
const FIELD_KEYS = Object.freeze(['memory', 'upstream', 'deferred', 'issues', 'oversightExempt']);
// A deferred cleanup item is a plain lowercase token (cleanup-procedures.md's
// vocabulary: design-caches, worktree, ephemeral-server, claim-release,
// run-dir-archival). The shape is validated, not the membership — the reader
// only ever looks tokens up in a Set, so an unknown token is inert.
const SAFE_TOKEN = /^[a-z][a-z0-9-]*$/;

const isPositiveInt = (n) => Number.isSafeInteger(n) && n > 0;
const isNonEmptyString = (s) => typeof s === 'string' && s !== '';

// fields -> null when valid, else a one-line reason naming the offender.
function validateFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return 'fields must be an object';
  for (const key of Object.keys(fields)) {
    if (!FIELD_KEYS.includes(key)) return `unknown field ${JSON.stringify(key)} (allowed: ${FIELD_KEYS.join(', ')})`;
    if (!Array.isArray(fields[key])) return `"${key}" must be an array`;
  }
  for (const [i, m] of (fields.memory || []).entries()) {
    if (!m || !isNonEmptyString(m.file) || !isNonEmptyString(m.indexFile)) return `memory[${i}] must be {file, indexFile} (both non-empty strings)`;
  }
  for (const [i, u] of (fields.upstream || []).entries()) {
    if (!u || !isNonEmptyString(u.url)) return `upstream[${i}] must be {url} (a non-empty string)`;
  }
  for (const [i, d] of (fields.deferred || []).entries()) {
    if (typeof d !== 'string' || !SAFE_TOKEN.test(d)) return `deferred[${i}] must be a lowercase token (letters, digits, -): ${JSON.stringify(d)}`;
  }
  for (const key of ['issues', 'oversightExempt']) {
    for (const [i, n] of (fields[key] || []).entries()) {
      if (!isPositiveInt(n)) return `${key}[${i}] must be a positive integer`;
    }
  }
  return null;
}

function readExisting(file) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

// (existing object, validated fields) -> the object to store. Pure.
function mergeExpectations(existing, fields = {}) {
  const stored = (key) => (Array.isArray(existing[key]) ? existing[key] : []);
  const out = {
    ...existing,
    version: VERSION,
    memory: fields.memory ?? stored('memory'),
    upstream: fields.upstream ?? stored('upstream'),
  };
  if (fields.deferred) out.deferred = [...new Set(fields.deferred)];
  if (fields.issues) out.issues = [...new Set(fields.issues)];
  if (fields.oversightExempt) {
    const prior = stored('oversightExempt').map(Number).filter(isPositiveInt);
    out.oversightExempt = [...new Set([...prior, ...fields.oversightExempt])].sort((a, b) => a - b);
  }
  return out;
}

// { runDir, fields? } -> { file, data }. Throws when the file is unwritable.
function writeExpectations({ runDir, fields = {} }) {
  const file = path.join(runDir, FILE_NAME);
  return withLock(path.join(runDir, '.verify-expectations.lock'), () => {
    const data = mergeExpectations(readExisting(file), fields);
    writeFileAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
    return { file, data };
  });
}

module.exports = {
  FILE_NAME, VERSION, FIELD_KEYS, validateFields, mergeExpectations, writeExpectations,
};
