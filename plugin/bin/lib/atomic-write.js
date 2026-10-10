// Shared tmp-file-plus-rename atomic write primitive, factored out of four
// independent hand-rolled copies: bin/lib/json-store.js's writeJsonFile,
// bin/lib/log-decision/append.js's appendEntry, bin/lib/flow/manifest.js's
// writeManifest, and bin/lib/hooks/context.js's writeRunState (#1653). All
// four now wrap this one primitive.
//
// This module owns exactly the write mechanics: write to a per-process tmp
// file in the same directory as the target, rename it into place, and on
// any failure best-effort unlink the tmp file before rethrowing the
// original error unchanged. It deliberately does NOT create the target
// directory (only json-store.js's callers need that — the other three
// always write into an already-existing run dir) and does NOT decide
// whether a failure should propagate or degrade — every call site keeps
// that policy for itself (log-decision/append.js lets it propagate;
// flow/manifest.js and hooks/context.js catch it and return false/null).
'use strict';
const fs = require('fs');
const path = require('path');

// On Windows a rename onto a target another process is renaming or holding
// open fails transiently with EPERM/EACCES/EBUSY — the same race graceful-fs
// retries. Bounded: a handful of short waits, then the original error.
const WIN_TRANSIENT_RENAME = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_RETRIES = 8;
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function renameWithRetry(from, to, { rename, platform, sleep }) {
  for (let attempt = 0; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      if (platform !== 'win32' || !WIN_TRANSIENT_RENAME.has(err && err.code) || attempt >= RENAME_RETRIES) throw err;
      sleep(5 * (attempt + 1));
    }
  }
}

// Overwrites `filePath` with `content` (a string), via a pid-suffixed tmp
// file in the same directory, then an atomic rename (retried on Windows'
// transient rename races). Throws on a real failure (permissions, disk
// full, ENOSPC, EXDEV, etc.) after a best-effort attempt to remove the tmp
// file — the caller decides how to degrade.
function writeFileAtomic(filePath, content, {
  writeFile = fs.writeFileSync, rename = fs.renameSync, unlink = fs.unlinkSync,
  platform = process.platform, sleep = sleepSync,
} = {}) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `${path.basename(filePath)}.tmp-${process.pid}`);
  try {
    writeFile(tmpPath, content);
    renameWithRetry(tmpPath, filePath, { rename, platform, sleep });
  } catch (err) {
    try { unlink(tmpPath); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

module.exports = { writeFileAtomic };
