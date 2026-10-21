// plugin/bin/lib/health-core/read-commit.js — resolves the git sha a health
// sweep should stamp its filed issues with (#117).
//
// Shared by the four health-sweep CLIs' validate-findings command: each
// resolves this ONCE, at the point it starts reading the repo for this run,
// and threads the same value through every finding filed during that run —
// never re-resolved per finding, and never resolved lazily at issue-create
// time. A sweep that queues findings and files them later (a retry queue, a
// dry-run replay) must still stamp the commit it actually READ, not the
// commit HEAD happens to be at whenever the write finally happens — a value
// resolved at write time is worse than no stamp at all (see issue #117's
// Gotchas): it reads as authoritative freshness that isn't real.
'use strict';

const { execFileSync } = require('child_process');

// root -> git sha string, or null when `git rev-parse` fails (not a repo,
// no git on PATH, detached-but-unborn HEAD). Fails toward null rather than
// throwing — a health sweep's own filing must not hard-stop over a stamp
// it cannot resolve; the four issue-payload.js builders simply omit the
// Verified-as-of: line when this returns null (specShapedBody already
// treats an empty/undefined verifiedAsOf as "not supplied").
function resolveReadCommit(root, execImpl = execFileSync) {
  try {
    return String(execImpl('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true })).trim() || null;
  } catch {
    return null;
  }
}

module.exports = { resolveReadCommit };
