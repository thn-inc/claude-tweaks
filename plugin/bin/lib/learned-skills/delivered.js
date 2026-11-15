// plugin/bin/lib/learned-skills/delivered.js — the learned-skills-delivered verdict (#5290), shared by
// bin/lib/wrap-up/engine-verify.js's check of that name (one run dir) and bin/console-residue.js
// --require-verify's multi-spec parent scan (the parent run dir holds a consolidated wrap-up's
// manifest, which no spec-*/ verify reads). Leaf module: fs and the path-only layout.js.
//
// bin/learned-skills-pr.js capture leaves an applied Skills-row edit only as a patch beside
// {run}/learned-skills/manifest.json until land or stage delivers it. An entry still `captured` was
// never delivered, and nothing else reads the manifest. An entry no writer produces (not an object, an
// unknown status) may be an undelivered one, so it fails too, never reads as delivered. Each patch is
// named where it now lives, beside the manifest: the manifest's absolute paths predate the run dir's
// archival.
'use strict';

const fs = require('fs');
const { STATUS, manifestPath, localPatchPath, firstBadEntry } = require('./layout');

// runDir -> { result: 'skip' | 'pass' | 'fail', detail }.
function learnedSkillsDelivered(runDir) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath(runDir), 'utf8'));
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return { result: 'skip', detail: 'no learned-skills captures this run' };
    return { result: 'fail', detail: `learned-skills manifest unreadable: ${err.message}` };
  }
  if (!Array.isArray(manifest)) return { result: 'fail', detail: 'learned-skills manifest unreadable: not an array' };
  const bad = firstBadEntry(manifest);
  if (bad) return { result: 'fail', detail: `learned-skills manifest entry ${bad.index} ${bad.problem}: ${manifestPath(runDir)}` };
  const captured = manifest.filter((e) => e.status === STATUS.CAPTURED);
  if (!captured.length) return { result: 'pass', detail: '' };
  const patches = captured.map((e) => localPatchPath(runDir, e.patch));
  return {
    result: 'fail',
    detail: `${captured.length} captured learned-skills patch(es) never delivered: ${patches.join(', ')} — run learned-skills-pr.js land (pr-first) or stage (local-merge) with --run ${runDir}`,
  };
}

module.exports = { learnedSkillsDelivered };
