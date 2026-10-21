// bin/lib/wrap-up/verify-results.js — the writer/reader for a run directory's
// verify.json (#3783), the per-check result rows `wrap-up-engine.js verify`
// produced, persisted so a later step (bin/console-residue.js's
// --require-verify, the merge-site acceptance guard) can tell whether a check
// — acceptance labeling in particular — actually ran and landed.
//
// Run-dir anchoring is the caller's job (wrap-up-engine.js's main() guards
// --run-dir itself) — this module writes into whatever directory it is given.
//
// Replace semantics, not merge: every verify run recomputes the full row set,
// so a write replaces any prior file whole — a stale row from an earlier run
// must never survive into the new one. The reader is strict the other way: an
// absent, unparseable, wrong-version, or wrong-shape file reads as null, never
// as a partial result.
//
// Write shape: lands via lib/atomic-write.js's tmp+rename under
// lib/file-lock.js's withLock (best-effort, fail-open) — the same pairing
// lib/verify-expectations/write.js uses for verify-expectations.json.
'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../atomic-write');
const { withLock } = require('../file-lock');

const FILE_NAME = 'verify.json';
const VERSION = 1;

// { runDir, rows: {check, result, detail}[], base, now? } -> { file, data }.
// Throws when the file is unwritable, or when runDir is not an existing
// directory — checked before the lock, whose parent-bootstrap mkdir would
// otherwise recreate a run dir a reconcile archived mid-verify.
function writeVerifyResults({ runDir, rows, base, now = Date.now }) {
  const file = path.join(runDir, FILE_NAME);
  if (!fs.statSync(runDir).isDirectory()) throw new Error(`verify.json: run dir is not a directory: ${runDir}`);
  return withLock(path.join(runDir, '.verify-results.lock'), () => {
    const data = { version: VERSION, base, writtenAt: new Date(now()).toISOString(), checks: rows };
    writeFileAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
    return { file, data };
  });
}

// runDir -> the stored object, or null when absent / unparseable / not an
// object / not version 1 / `checks` not an array of {check, result} rows.
function readVerifyResults(runDir) {
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(runDir, FILE_NAME), 'utf8')); } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.version !== VERSION || !Array.isArray(data.checks)) return null;
  if (!data.checks.every((r) => r && typeof r.check === 'string' && typeof r.result === 'string')) return null;
  return data;
}

module.exports = { FILE_NAME, VERSION, writeVerifyResults, readVerifyResults };
