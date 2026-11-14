// plugin/bin/lib/learned-skills/layout.js — where a run's learned-skills manifest and patches live, the
// statuses a manifest entry can carry, and the shape check every reader applies (#5290). One source for
// learned-skills.js and land.js (the writers) and delivered.js (the verify backstop). Leaf module: path
// only, so delivered.js stays a leaf too.
'use strict';

const path = require('path');

// Every status a writer puts on an entry: capture writes captured (or staged, its fallback), land and
// stage move a captured entry to landed, staged or superseded.
const STATUS = Object.freeze({
  CAPTURED: 'captured', STAGED: 'staged', SUPERSEDED: 'superseded', LANDED: 'landed',
});
const STATUSES = Object.freeze(Object.values(STATUS));

function patchDir(runDir) { return path.join(runDir, 'learned-skills'); }

function manifestPath(runDir) { return path.join(patchDir(runDir), 'manifest.json'); }

// A captured patch named where it now lives, beside the manifest: the manifest stores an absolute path,
// which goes stale once the run dir is archived.
function localPatchPath(runDir, patch) { return path.join(patchDir(runDir), path.basename(String(patch))); }

// Why entry `e` is not one a writer produces, or null: an object whose status is one of STATUSES, and
// a captured one names its patch file.
function entryProblem(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return 'is not an object';
  if (typeof e.status !== 'string' || !STATUSES.includes(e.status)) return `has an unknown status (${JSON.stringify(e.status)})`;
  if (e.status === STATUS.CAPTURED && (typeof e.patch !== 'string' || !e.patch)) return 'is captured but names no patch file';
  return null;
}

// The first bad entry as { index, problem }, or null when every entry is well formed.
function firstBadEntry(entries) {
  for (let i = 0; i < entries.length; i++) {
    const problem = entryProblem(entries[i]);
    if (problem) return { index: i, problem };
  }
  return null;
}

module.exports = { STATUS, patchDir, manifestPath, localPatchPath, firstBadEntry };
