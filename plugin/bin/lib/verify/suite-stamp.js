// plugin/bin/lib/verify/suite-stamp.js — per-suite pass records (#3002):
// composing a full verified-HEAD stamp from chunked `--no-stamp` runs that
// each cover only part of the declared check set (the two-call dispatch
// form's 600s foreground cap forces this split). bin/verify.js is the ONLY
// writer, same posture as the single pass stamp in stamp.js (#1921/#1784) —
// this file never reads argv or decides when to write, it only stores and
// composes what verify.js tells it to.
//
// One JSON file per checkout (`claude-tweaks-verify-suites.json`, beside the
// pass stamp in the checkout's own git dir), keyed by declared check name:
// { "<name>": { sha, dirty, at, reportPath[, generatedExempt] } } — the
// optional `generatedExempt` lists declared-generated paths that were dirty
// when the record was written (#2987), so `dirty: false` stays auditable. A
// record only ever means
// "this check passed, on this sha, with this tree state" — composing reads
// every field itself rather than trusting a caller's summary, the same
// fail-toward-absence posture stamp.js's readStamp applies to the single
// stamp's `baseline`/`preExisting` keys: a malformed per-check entry is
// dropped (treated as no record for that check), never trusted as a pass.
'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../atomic-write');

const SUITE_STAMP_NAME = 'claude-tweaks-verify-suites.json';
const SHA_RE = /^[0-9a-f]{40}$/;

function isValidEntry(entry) {
  return Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
    && typeof entry.sha === 'string' && SHA_RE.test(entry.sha)
    && typeof entry.dirty === 'boolean'
    && typeof entry.at === 'string';
}

// Reads the whole map, dropping any entry that doesn't parse as a well-formed
// record (fail toward absence, per-entry — one corrupt check name must not
// invalidate every other check's genuine record). Absent file, unreadable
// file, or a file that doesn't parse as a plain object all read as {}.
function readSuiteStamps(gitDir, fsImpl = fs) {
  let text;
  try { text = fsImpl.readFileSync(path.join(gitDir, SUITE_STAMP_NAME), 'utf8'); } catch { return {}; }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return {}; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out = {};
  for (const [name, entry] of Object.entries(parsed)) {
    if (isValidEntry(entry)) out[name] = entry;
  }
  return out;
}

// Applies `updates` ({name: entry|null}) over whatever is currently on disk
// and writes the merged map back atomically. `null` clears that check's
// record (a failing chunk — #3002 Deliverable 3: "a failing chunk clears or
// never writes its record"); any other value replaces it outright. Returns
// the merged map. Read-merge-write, same as every other small sidecar file
// in this module family (count-stamp.js) — two chunks for DIFFERENT checks
// never race on the same key, and this project's own chunked usage runs them
// sequentially within one pipeline phase, so the narrow same-key race this
// leaves open is an accepted, documented limitation rather than a silent one.
function writeSuiteStamps(gitDir, updates, fsImpl = fs) {
  const filePath = path.join(gitDir, SUITE_STAMP_NAME);
  const current = readSuiteStamps(gitDir, fsImpl);
  const merged = { ...current };
  for (const [name, entry] of Object.entries(updates)) {
    if (entry === null) delete merged[name];
    else merged[name] = entry;
  }
  writeFileAtomic(filePath, `${JSON.stringify(merged, null, 2)}\n`, {
    writeFile: fsImpl.writeFileSync,
    rename: fsImpl.renameSync,
    unlink: fsImpl.unlinkSync || (() => {}),
  });
  return merged;
}

// declaredChecks: the full list of names a project's verify-scope.json
// declares (types/lint when present, plus every suite). headSha/headDirty:
// this checkout's CURRENT state, read fresh (never from a stored stamp) —
// the same "recompute live, never trust what was written" rule
// bin/verify.js's stampStatus() already applies to the single pass stamp.
// A record counts only when its own sha matches headSha exactly and its own
// dirty is strictly false (#3002 AC3: an earlier-sha or dirty-tree record
// never counts, regardless of what the live tree looks like now).
function composeSuiteCoverage({ declaredChecks, suiteStamps, headSha, headDirty }) {
  if (!Array.isArray(declaredChecks) || declaredChecks.length === 0) return null;
  const covered = [];
  const missing = [];
  for (const name of declaredChecks) {
    const entry = suiteStamps[name];
    const ok = headDirty === false && typeof headSha === 'string'
      && entry && entry.sha === headSha && entry.dirty === false;
    if (ok) covered.push(name);
    else missing.push(name);
  }
  return { declared: declaredChecks, covered, missing, complete: missing.length === 0 };
}

module.exports = {
  SUITE_STAMP_NAME, readSuiteStamps, writeSuiteStamps, composeSuiteCoverage,
};
