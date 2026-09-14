// bin/lib/shared-primitives.js
// Small, previously-duplicated primitives, consolidated per #977:
//
//   - GH_TIMEOUT_MS: the `gh` subprocess timeout (ms) shared by every direct
//     `execFileSync('gh', ...)` / `execFileAsync('gh', ...)` call in the
//     claim machinery. Before this extraction it was defined identically in
//     `plugin/bin/claim-targets.js`, `plugin/bin/lib/issues/claim-store.js`,
//     and `plugin/bin/lib/reconcile/release-merged.js` — a 4th copy lived in
//     `claim-engine.js` until that file was retired (#787), which is why
//     #977 originally counted 4. NOT the hook-teardown timeout —
//     `plugin/bin/lib/hooks/teardown-run.js` deliberately uses a different,
//     longer value and stays out of scope here.
//   - escapeRegExp: a one-line "escape regex metacharacters" helper, also
//     defined identically in `plugin/bin/lib/skill-audit/skill-catalog.js`
//     and `plugin/bin/lib/code-health/candidates-dead-code.js` before this
//     extraction. Unrelated in purpose to GH_TIMEOUT_MS, but consolidated
//     into this same file per #977's single-shared-module deliverable
//     rather than a second one-export file.
//   - LARGE_MAX_BUFFER_BYTES: the 64 MiB `execFileSync`/`execSync` `maxBuffer`
//     override for a call whose output can exceed Node's 1MB default (a full
//     `git log`/`gh issue list --state all` dump). Previously defined
//     identically (in two different multiplication orders) in
//     `plugin/bin/residue.js` (both its generic runner and its `npm test`
//     call) and `plugin/bin/lib/issues/backlog.js`'s `deriveCreatedAtFromGit`
//     — a third pattern-copy landed in `plugin/bin/backlog-grant-gate.js`'s
//     `gh`/`git` runners before this consolidation, which is what prompted it.
//   - runClassified / runClassifiedAsync: the try/execute/catch scaffold
//     shared by the sync/async primitive pairs below
//     — `runGit`/`runGitAsync` (bin/lib/hooks/git-exec.js) and
//     `ghHealthCheck`/`ghHealthCheckAsync` (bin/lib/reconcile/preflight.js)
//     each previously retyped this shape once per twin. #1652: a
//     whole-branch pre-release review (pre-v6.110.0) found runGit's stderr
//     field had been added without updating runGitAsync to match, despite a
//     header comment claiming "identical return shape" — this extraction,
//     paired with each pair's own single buildSuccess/buildFailure shaping
//     functions (defined once, called from both twins), makes that class of
//     drift structurally impossible rather than merely documented against.
//   - isPathContained: the `candidate === root || candidate.startsWith(root +
//     path.sep)` (or the strict, no-equals-branch half of it alone) idiom for
//     "is this resolved path inside that resolved path". Previously retyped
//     independently in `bin/lib/reconcile/reap-merged.js` (`isOwnCwd`, and its
//     own domain-boundary check), `bin/lib/hooks/worktree-reap.js` (the same
//     two checks), `bin/lib/timing/transcript.js`, and
//     `bin/lib/hooks/pre-tool-use.js` (two call sites, one of each shape) —
//     found during #2324's review when its own new `--extra-file` containment
//     check turned out to be a 6th independent copy of the pattern. Every
//     caller passes its own already-resolved (`path.resolve`/`realpathSync`)
//     paths in — this is a pure string check, never a filesystem call, so it
//     does not change any caller's resolution strategy (lexical vs.
//     symlink-real), only the containment comparison itself.
'use strict';

const path = require('path');

const GH_TIMEOUT_MS = 5000;
const LARGE_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPathContained(candidate, root, { orEqual = false } = {}) {
  if (orEqual && candidate === root) return true;
  return candidate.startsWith(root + path.sep);
}

function runClassified(fn, mapError) {
  try {
    return fn();
  } catch (err) {
    return mapError(err);
  }
}

async function runClassifiedAsync(fn, mapError) {
  try {
    return await fn();
  } catch (err) {
    return mapError(err);
  }
}

module.exports = { GH_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES, escapeRegExp, isPathContained, runClassified, runClassifiedAsync };
