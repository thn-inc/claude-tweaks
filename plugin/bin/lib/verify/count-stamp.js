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
const { globToRegExp } = require('../issues/blast-radius');

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
//
// flaggedFiles (#3062) is every file this run flagged as flaky by either
// mechanism the runner has: a retried allowlisted file (always already on
// `allowlist` — planRetry only retries when every failing file matches it)
// and a baseline-adjudicated `flakyPassed` file (which may not be on
// `allowlist` at all — that is the whole point of the escalation-to-proposal
// path below). A flagged file that is NOT on `allowlist` would otherwise be
// pruned back to zero at the top of the very next run (it is never in
// `allowlist`'s own set), permanently capping its count at 1 and making the
// escalation threshold unreachable — so the keep-set below is `allowlist`
// UNION this run's flagged files, not `allowlist` alone.
function nextFlakyHits(previous, flaggedFiles, allowlist) {
  const prior = previous && previous.flakyHits && typeof previous.flakyHits === 'object' && !Array.isArray(previous.flakyHits)
    ? previous.flakyHits : {};
  const next = {};
  const flagged = [...new Set(flaggedFiles)];
  const keep = allowlist === null ? Object.keys(prior) : [...new Set([...allowlist, ...flagged])];
  for (const file of keep) {
    const n = prior[file];
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) next[file] = n;
  }
  for (const file of flagged) next[file] = (next[file] || 0) + 1;
  return next;
}

// allowlist here is the same declaration array nextFlakyHits took (or null —
// treated as "nothing is declared allowlisted", never as "everything is").
// `onAllowlist` (#3062) tells the caller which of the two escalation paths
// applies: true is the pre-existing "already on flaky.files" case (fix or
// remove the entry); false is a file the baseline adjudicator has caught
// going flaky `hits` times without ever being declared — that path stages a
// proposal to add it, never applies one silently (escalationCaveatLine and
// verify.js's own staged-item write both key off this field).
function flakyEscalations(hits, allowlist) {
  const patterns = Array.isArray(allowlist) ? allowlist : [];
  return Object.entries(hits)
    .filter(([, n]) => n >= FLAKY_ESCALATION_HITS)
    .map(([file, n]) => ({ file, hits: n, onAllowlist: patterns.some((entry) => globToRegExp(entry).test(file)) }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

function escalationCaveatLine({ file, hits, onAllowlist }) {
  return onAllowlist
    ? `CAVEAT: flaky-allowlist: ${file} retried ${hits} times — file a fix or remove it from the allowlist`
    : `CAVEAT: flaky-allowlist: ${file} baseline-flaky ${hits} times — not on flaky.files; a staged proposal to add it is pending review`;
}

module.exports = {
  readStamp, detectRegression, caveatLine,
  nextFlakyHits, flakyEscalations, escalationCaveatLine, FLAKY_ESCALATION_HITS,
};
