'use strict';

// lens-dispatch.json — the per-run record of which review lens reviewers were dispatched and how each ended
// (#5998). It is the denominator of the per-lens review-history rate: only a `completed` entry with
// `reviewers: 2` qualifies for that rate; failed, blocked and single-reviewer entries are recorded but never
// counted, so a lost entry silently shrinks the rate.
//
// The one sanctioned writer is `bin/review-coordination.js record-lens-dispatch`; nothing hand-types this file
// and no other writer appends to it. The write is a locked read-modify-write (`{runDir}/.lens-dispatch.lock`,
// fail-closed: a lock that cannot be taken throws LOCK_TIMEOUT and writes nothing, because `withLock`'s default
// proceeds unlocked and two racing appends would drop an entry) finished by a tmp+rename.
//
// File shape: {"v": 1, "entries": [{lens, reviewers, path, round, status}, ...]}, entries in append order.
//   lens       one of LENS_IDS ('3a'..'3h')
//   reviewers  1 or 2 — how many reviewers the lens was dispatched with
//   path       'task' (Task-tool dispatch) or 'workflow' (the review-lens-fanout workflow)
//   round      integer >= 1 — the review round
//   status     'completed' (both of a pair's final replies were DONE / DONE_WITH_CONCERNS, or a single-reviewer
//              lens's one reply was usable), 'blocked' (either reviewer's final reply was BLOCKED / NEEDS_CONTEXT,
//              even when categorise-reproduction still ran), 'failed' (the replies never came)
//              (plugin/skills/review/step3-lens-dispatch-record.md is the writer-side definition)
// An identical entry already present is not appended again (idempotent on a retried call).
//
// A malformed existing file is an `error` state, never absence, and an append never overwrites it.

const fs = require('node:fs');
const path = require('node:path');
const { withLock } = require('../file-lock');
const { writeFileAtomic } = require('../atomic-write');
const { lstatType } = require('../path-guard');

const LENS_DISPATCH_FILE = 'lens-dispatch.json';
const DISPATCH_SCHEMA_VERSION = 1;
const LENS_IDS = Object.freeze(['3a', '3b', '3c', '3d', '3e', '3f', '3g', '3h']);
const STATUSES = Object.freeze(['completed', 'failed', 'blocked']);
const PATHS = Object.freeze(['task', 'workflow']);
const ENTRY_KEYS = ['lens', 'reviewers', 'path', 'round', 'status'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The refusal text for an entry, or null for a valid one.
function entryProblem(entry) {
  if (!isPlainObject(entry)) return 'entry must be an object';
  const extra = Object.keys(entry).filter((k) => !ENTRY_KEYS.includes(k));
  if (extra.length > 0) return `unknown key ${JSON.stringify(extra[0])}`;
  if (typeof entry.lens !== 'string' || !LENS_IDS.includes(entry.lens)) return `lens must be one of ${LENS_IDS.join(', ')}`;
  if (entry.reviewers !== 1 && entry.reviewers !== 2) return 'reviewers must be 1 or 2';
  if (typeof entry.path !== 'string' || !PATHS.includes(entry.path)) return `path must be one of ${PATHS.join(', ')}`;
  if (!Number.isInteger(entry.round) || entry.round < 1) return 'round must be an integer >= 1';
  if (typeof entry.status !== 'string' || !STATUSES.includes(entry.status)) return `status must be one of ${STATUSES.join(', ')}`;
  return null;
}

// {state:'absent'} | {state:'ok', entries} | {state:'error', reason}.
function readLensDispatch(dir) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(dir, LENS_DISPATCH_FILE), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { state: 'absent' };
    return { state: 'error', reason: `unreadable (${(err && err.code) || 'unknown'})` };
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { state: 'error', reason: 'unparseable' };
  }
  if (!isPlainObject(doc)) return { state: 'error', reason: 'not an object' };
  if (doc.v !== DISPATCH_SCHEMA_VERSION) return { state: 'error', reason: `v must be ${DISPATCH_SCHEMA_VERSION}` };
  if (!Array.isArray(doc.entries)) return { state: 'error', reason: 'entries is not an array' };
  for (const [i, e] of doc.entries.entries()) {
    const problem = entryProblem(e);
    if (problem) return { state: 'error', reason: `entry ${i}: ${problem}` };
  }
  return { state: 'ok', entries: doc.entries };
}

const sameEntry = (a, b) => ENTRY_KEYS.every((k) => a[k] === b[k]);

// Appends one entry under the lock. Returns { file, duplicate }; throws on a malformed entry (TypeError), a
// vanished run dir, a lock timeout (code LOCK_TIMEOUT) or a malformed existing file — never writing in any.
function appendLensDispatch({ runDir, entry, env }) {
  const problem = entryProblem(entry);
  if (problem) throw new TypeError(`invalid lens-dispatch entry: ${problem}`);
  // withLock creates a missing lock parent; refuse a vanished run dir first so an archived one is never resurrected.
  if (lstatType(runDir).type !== 'directory') throw new Error(`run dir does not exist: ${runDir}`);
  const file = path.join(runDir, LENS_DISPATCH_FILE);
  return withLock(path.join(runDir, '.lens-dispatch.lock'), () => {
    const current = readLensDispatch(runDir);
    if (current.state === 'error') throw new Error(`${LENS_DISPATCH_FILE} is malformed (${current.reason}); not overwriting it`);
    const entries = current.state === 'ok' ? current.entries : [];
    if (entries.some((e) => sameEntry(e, entry))) return { file, duplicate: true };
    const next = { v: DISPATCH_SCHEMA_VERSION, entries: [...entries, entry] };
    writeFileAtomic(file, JSON.stringify(next, null, 2) + '\n');
    return { file, duplicate: false };
  }, { env, failClosed: true, createParent: false });
}

module.exports = {
  LENS_DISPATCH_FILE, DISPATCH_SCHEMA_VERSION, LENS_IDS, STATUSES, PATHS,
  entryProblem, readLensDispatch, appendLensDispatch,
};
