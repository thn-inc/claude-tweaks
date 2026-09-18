// plugin/bin/lib/declined-learning/store.js
// One shared, project-local declined-learning store — see docs/skill-graph.md's `feedback` and
// `reflect`/`wrap-up` sections for the citing skills; this header states the degrade-open
// contract once, per CLAUDE.md's cross-reference rule.
//
// Records fingerprints of findings/insights a human explicitly declined, so a later run can
// annotate a re-surfaced match ("previously declined {date}: {reason}") instead of presenting
// it as a fresh proposal. One flat, non-per-consumer file (unlike
// bin/lib/transcript-judge/watermark.js's per-consumer subdirectories) because every entry
// already carries a `source` field distinguishing origin — nothing needs path-level isolation.
//
// Each entry may also carry a `subject` (#1033) — the human-legible text behind the fingerprint.
// Fingerprint-only matching cannot support this store's own consumers: an LLM judge dispatch has
// no way to compute a *candidate* finding's fingerprint to compare against a stored hash, and
// free-form insight prose rarely reproduces byte-identical across runs even when it means the
// same thing. `subject` is what lets a consumer (or the agent reading this store) judge
// equivalence directly instead of relying on exact-hash comparison alone — see lookupDecline
// (hash lookup, unchanged) vs listDeclined (subject scan, new) below.
//
// readStore degrades open: a missing or corrupt store file returns {}, never a throw — the same
// contract as watermark.js's readWatermark (both now go through ../json-store.js's shared
// read/write pair). writeStore (and therefore recordDecline/clearDecline, which read-modify-write
// through it) lets a real write failure propagate; the caller decides how to degrade. Every fs
// call is an injectable default param so tests never touch real disk.
//
// recordDecline/clearDecline hold ../file-lock.js's mkdir-based mutex around their
// read-modify-write, the same mechanism bin/lib/hooks/context.js's writeRunState uses for
// run-state.json — without it, two sessions declining different fingerprints near-simultaneously
// could each read the same pre-write store and the second write would silently drop the first's
// entry (review finding). Best-effort/fail-open, same posture as writeRunState: a write that
// can't acquire the lock in time still proceeds unlocked rather than hang the caller.
//
// Risk-tolerance decision (#1400, review of #1033's Security lens): `subject` is agent-authored,
// not raw user input — an indirect channel, since a human never types it directly. The mitigation
// chosen is storage-time length capping here (MAX_SUBJECT_LENGTH below) plus render-time
// delimiting in transcript-judge/watermark.js's formatOffsetClause (the two call sites review
// flagged), not "accept and document" alone — both are cheap, mechanical, and additive with no
// behavior change for a well-formed subject. This fix is scoped to declined-learning only; it does
// NOT generalize to the wider ledger-entry/decisions.md/staged-proposal pattern of recirculating
// agent-authored prose into future prompts — that pattern is pervasive, already shipped, and
// carries a different risk profile (much of it passes through the Review Console before reaching
// another prompt), so generalizing it needs its own separately-scoped decision, not a bundle-in
// here. Full reasoning: docs/superpowers/plans/2026-09-18-declined-learning-subject-sanitization.md's
// "Decision" section (this plan is deleted once #1400 ships and closes, per this repo's specs/
// close-out convention — this comment is the durable copy).
'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonFile, writeJsonFile } = require('../json-store');
const { withLock } = require('../file-lock');

const STORE_PATH = path.join('.claude-tweaks', 'declined-learning', 'store.json');
const LOCK_PATH = path.join('.claude-tweaks', 'declined-learning', '.store.lock');

// Age-based pruning default (#1399): the store has no expiry, so every decline ever recorded
// (across /feedback and /wrap-up reflect) accumulates forever. 180 days is a generous window —
// long enough that an active decline never lapses mid-project, short enough to bound growth for
// a store that otherwise never shrinks. No count-based cap: age alone is sufficient to bound
// growth for a file that only ever gains one entry per declined finding/insight, and a count cap
// would need its own eviction-order policy (oldest-first? — reintroducing the same "stale entry
// suppresses a live finding" risk this file's header already documents) for no added benefit.
const DEFAULT_PRUNE_MAX_AGE_DAYS = 180;

// Storage-time bound on `subject` (#1400 — review of #1033's Security lens flagged this field as
// unbounded free text). 300 characters is generous for a "human-legible summary a consumer already
// has on hand" (this file's header) — a sentence or two — while bounding how much of an adversarial
// blob any single decline can carry forward into a future rendered prompt (watermark.js's
// formatOffsetClause, the render-time half of this same fix). Independent of and complementary to
// that render-time delimiting: this cap bounds volume; the delimiter in watermark.js bounds whether
// the content can be read as instructions rather than data. See "Decision" in
// docs/superpowers/plans/2026-09-18-declined-learning-subject-sanitization.md for the full
// risk-tolerance decision and why this fix stays scoped to this store.
const MAX_SUBJECT_LENGTH = 300;
const TRUNCATION_MARKER = '… [truncated]';

// Pure — bounds `subject`'s stored length. A subject at or under the cap round-trips unchanged
// (the common case: every subject written before this cap existed, and every well-formed one
// going forward, is untouched). Only a subject that itself exceeds the cap loses its tail, with a
// marker that makes the truncation visible to any human or agent reading the entry back — never a
// silent cut.
function truncateSubject(subject) {
  if (typeof subject !== 'string' || subject.length <= MAX_SUBJECT_LENGTH) return subject;
  return `${subject.slice(0, MAX_SUBJECT_LENGTH)}${TRUNCATION_MARKER}`;
}

// Pure — the store has exactly one on-disk location; no per-transcript/per-consumer derivation.
function storePath() {
  return STORE_PATH;
}

// Returns the parsed store object, or {} when none exists (ENOENT), the file is present but not
// valid JSON, or the parsed value isn't a plain object (corrupt/foreign content == empty store,
// degrade-open contract).
function readStore({ readFile = fs.readFileSync } = {}) {
  const parsed = readJsonFile(storePath(), { readFile, fallback: {} });
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

// Overwrites the whole store with `data`. Creates the containing directory if needed. Throws on
// a real failure (permissions, disk full, etc.) — this module doesn't silently eat the error.
function writeStore(data, { mkdirSync = fs.mkdirSync, writeFile = fs.writeFileSync, rename = fs.renameSync } = {}) {
  writeJsonFile(storePath(), data, { mkdirSync, writeFile, rename });
}

// Records (or overwrites) a decline entry for `fingerprint`. Read-modify-write through
// readStore/writeStore under the store's lock, so it inherits both their degrade-open (read) and
// propagate (write) behavior, plus protection from a concurrent recordDecline/clearDecline
// clobbering it mid-write. Returns the entry that was written.
//
// `subject` (#1033, rationale in this file's header) is the human-legible text a consumer already
// has on hand when it declines something — the draft's `fingerprintBasis.summary` for feedback,
// the insight's own description text for reflect. Optional and omitted from the written entry when
// not passed, so an entry recorded before this field existed round-trips unchanged (no forced
// `subject: null`) and every existing caller that doesn't pass one keeps writing the same
// three-key shape as before.
function recordDecline(fingerprint, {
  reason = null, source, subject, declinedAt = new Date().toISOString(),
} = {}, deps = {}) {
  return withLock(LOCK_PATH, () => {
    const current = readStore(deps);
    const entry = { declinedAt, reason, source };
    if (subject !== undefined) entry.subject = truncateSubject(subject);
    current[fingerprint] = entry;
    writeStore(current, deps);
    return entry;
  });
}

// The annotation-lookup function: returns the stored { declinedAt, reason, source, subject? }
// entry for `fingerprint`, or null when no decline is on record. Never throws — readStore already
// degrades open. Exact-hash lookup only — a byte-identical (or near-identical, per the caller's
// own normalization) re-fingerprint. See listDeclined below for the subject-scan alternative this
// can't cover.
function lookupDecline(fingerprint, deps = {}) {
  const current = readStore(deps);
  return Object.prototype.hasOwnProperty.call(current, fingerprint) ? current[fingerprint] : null;
}

// All declined fingerprints (opaque hashes only, no subject text), optionally filtered to one
// `source`. Superseded as feedback's own watermark-payload source by listDeclined below (#1033:
// session-evaluation.md now reads dismissedSubjects, not a bare fingerprint list) — kept as a
// lighter-weight primitive for a caller that genuinely only needs the hash keys.
function listDeclinedFingerprints({ source } = {}, deps = {}) {
  const current = readStore(deps);
  const keys = Object.keys(current);
  return source ? keys.filter((k) => current[k] && current[k].source === source) : keys;
}

// Full entries (fingerprint + declinedAt/reason/source/subject), optionally filtered to one
// `source` — the subject-scan counterpart to listDeclinedFingerprints above. Where that function
// hands a consumer only opaque hashes, this one hands back the human-legible `subject` text
// alongside each fingerprint, so a consumer can render or compare declined subjects directly
// instead of being limited to exact-hash matching (header). An entry recorded before `subject`
// existed simply has no `subject` key on its returned object — callers that render subjects
// handle that omission themselves (e.g. falling back to the fingerprint).
function listDeclined({ source } = {}, deps = {}) {
  const current = readStore(deps);
  return Object.keys(current)
    .filter((fp) => !source || (current[fp] && current[fp].source === source))
    .map((fp) => ({ fingerprint: fp, ...current[fp] }));
}

// Removes a decline entry — "approving it anyway clears the entry" (a human re-affirms a
// previously-declined finding/insight, so it should surface as fresh next time rather than
// staying annotated forever). No-op (no write) when the fingerprint has no entry, so an
// idempotent clear never touches disk twice. Returns whether an entry was actually removed.
function clearDecline(fingerprint, deps = {}) {
  return withLock(LOCK_PATH, () => {
    const current = readStore(deps);
    if (!Object.prototype.hasOwnProperty.call(current, fingerprint)) return false;
    delete current[fingerprint];
    writeStore(current, deps);
    return true;
  });
}

// Removes every entry older than `maxAgeDays` (#1399), read-modify-write through
// readStore/writeStore under the same lock recordDecline/clearDecline use. Age is measured from
// each entry's own `declinedAt` against `now` (injectable for deterministic tests, defaulting to
// the real clock). An entry whose `declinedAt` is missing or unparseable is KEPT, never treated
// as infinitely old and swept — this module's own degrade-open contract (header) never silently
// discards data it can't judge the age of. Mirrors clearDecline's idempotent-no-write behavior:
// a clean sweep (nothing to remove) never touches disk. Returns the number of entries removed.
function pruneDeclines({ maxAgeDays = DEFAULT_PRUNE_MAX_AGE_DAYS, now = Date.now() } = {}, deps = {}) {
  return withLock(LOCK_PATH, () => {
    const current = readStore(deps);
    const cutoffMs = now - maxAgeDays * 24 * 60 * 60 * 1000;
    const next = {};
    let removed = 0;
    for (const [fingerprint, entry] of Object.entries(current)) {
      const declinedAtMs = entry && entry.declinedAt ? Date.parse(entry.declinedAt) : NaN;
      if (Number.isFinite(declinedAtMs) && declinedAtMs < cutoffMs) {
        removed += 1;
      } else {
        next[fingerprint] = entry;
      }
    }
    if (removed > 0) writeStore(next, deps);
    return removed;
  });
}

module.exports = {
  storePath,
  readStore,
  writeStore,
  recordDecline,
  lookupDecline,
  listDeclinedFingerprints,
  listDeclined,
  clearDecline,
  pruneDeclines,
  DEFAULT_PRUNE_MAX_AGE_DAYS,
  MAX_SUBJECT_LENGTH,
};
