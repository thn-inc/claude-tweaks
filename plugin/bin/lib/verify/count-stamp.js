// plugin/bin/lib/verify/count-stamp.js — suite-count regression stamp (#881).
// Persists the "tests" check's executed-test count across runs so a quieter
// suite is surfaced as a caveat instead of reading identical to a clean pass
// (IL-84: an enumerated glob silently excluded a whole test directory —
// fifteen tests never ran, and `npm test` still exited 0). This is a
// caveat/surfacing mechanism, not a hard gate: a legitimate removal also
// drops the count, so the caveat flags the drop for a human to judge rather
// than failing the run.
//
// Counts fail toward absence, matching extract.js's own rule (a wrong count
// would poison this module's comparison): a missing, unreadable, or
// malformed stamp reads as "no baseline yet" — bootstrap, never a false
// regression.
//
// Also home to the flaky-allowlist hit counter (#1925): `flakyHits` rides in
// the same stamp.
'use strict';

const fs = require('fs');

// Read-side only: the stamp is written by bin/verify.js via atomic-write.js.
function readStamp(stampPath, fsImpl = fs) {
  let parsed;
  try {
    parsed = JSON.parse(fsImpl.readFileSync(stampPath, 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  if (typeof parsed.tests !== 'number' || !Number.isFinite(parsed.tests)) return null;
  return parsed;
}

// previous/current are stamp-shaped objects ({tests, ...}) or null. Returns
// null when there is nothing to compare (no previous baseline, or this run
// produced no parseable count) — callers render no caveat in that case. Only
// a strict decrease counts as a regression; an equal or higher count does
// not, and a removed-then-readded suite naturally clears itself next run.
function detectRegression(previous, current) {
  if (previous === null || current === null) return null;
  if (typeof previous.tests !== 'number' || typeof current.tests !== 'number') return null;
  if (current.tests >= previous.tests) return null;
  return {
    previousTests: previous.tests,
    currentTests: current.tests,
    droppedBy: previous.tests - current.tests,
  };
}

function caveatLine(regression) {
  if (regression === null) return null;
  return `CAVEAT: test count dropped from ${regression.previousTests} to `
    + `${regression.currentTests} (−${regression.droppedBy}) since the last recorded run. `
    + 'A quieter suite can mean tests were silently excluded, not that fewer are failing '
    + '(see docs/incident-log.md IL-84). Confirm the drop is an intentional removal before '
    + 'treating this run as a clean pass.';
}

// Flaky-allowlist hit counter (#1925). Persisted in this stamp (the one
// per-checkout file the runner already rewrites) as `flakyHits: {file: n}`;
// a key is dropped the moment its file leaves the allowlist, so the map can
// never outlive the declaration. The threshold is a stated literal, not a
// policy lever: an allowlisted file retried this often needs a fix or its
// entry removed, and the caveat keeps saying so on every run until one of
// those happens — an allowlist with no pressure to shrink becomes permanent.
const FLAKY_ESCALATION_HITS = 5;

// allowlist is the declaration's flaky.files array, or null when no
// declaration was read at all (no --scope, or --scope with a missing file) —
// a run without a declaration says nothing about which files are still
// allowlisted, so it must not be read as "the allowlist is empty" (parse-
// signal discipline). null carries every finite positive prior count forward
// untouched before applying this run's increments; only a real array prunes
// entries whose file has left the allowlist.
function nextFlakyHits(previous, retriedFiles, allowlist) {
  const prior = previous && previous.flakyHits && typeof previous.flakyHits === 'object' && !Array.isArray(previous.flakyHits)
    ? previous.flakyHits : {};
  const next = {};
  for (const file of allowlist === null ? Object.keys(prior) : allowlist) {
    const n = prior[file];
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) next[file] = n;
  }
  for (const file of retriedFiles) next[file] = (next[file] || 0) + 1;
  return next;
}

function flakyEscalations(hits) {
  return Object.entries(hits)
    .filter(([, n]) => n >= FLAKY_ESCALATION_HITS)
    .map(([file, n]) => ({ file, hits: n }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

function escalationCaveatLine({ file, hits }) {
  return `CAVEAT: flaky-allowlist: ${file} retried ${hits} times — file a fix or remove it from the allowlist`;
}

module.exports = {
  readStamp, detectRegression, caveatLine,
  nextFlakyHits, flakyEscalations, escalationCaveatLine, FLAKY_ESCALATION_HITS,
};
