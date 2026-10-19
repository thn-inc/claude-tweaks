// bin/lib/flow/consolidated-pass.js — the one eligibility rule for re-entering
// a multi-spec run's consolidated Review Console pass after its parent session
// ended (#3497). The old premise was "a pass whose session ended is gone";
// the run dir, manifest and per-spec artifacts all outlive the session, so the
// only real question is whether the work is still unmerged, unclosed and
// unconsolidated. Consumed by the SessionStart banner (offline) and the
// review-console skill (opts.online), so both read the same verdict.
//
// Read-only: no writes, no event appends, no git mutation. File reads treat
// any failure as "absent" and surface as that file's own reason; only the
// parent-liveness, PR-state and merge-evidence calls are wrapped, because they
// shell out to git or gh and any throw there is "cannot tell", never "dead" or
// "not landed".
'use strict';
const fs = require('fs');
const path = require('path');
const { readManifest } = require('./manifest');
const { lstatType } = require('../path-guard');
const { checkBranchLanded, repoRootOf } = require('../hooks/run-integrity');
const { resolvePrStateByNumber } = require('../reconcile/pr-state');
const { checkResumeFreshness } = require('../hooks/resume-freshness');
const { parseWorktreeList, lockVerdict } = require('../hooks/worktree-reap');
const { mainCheckoutRoot, safeReal } = require('../hooks/worktree-detect');
const { runGit } = require('../hooks/git-exec');

// Evaluation order == this order; the first failing check wins.
const REENTRY_REASONS = Object.freeze([
  'archived', 'no-manifest', 'closed', 'mode', 'console-exists',
  'spec-unfinished', 'parent-live', 'landed', 'landed-unknown', 'eligible',
]);

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function readRunState(runDir) {
  const text = readText(path.join(runDir, 'run-state.json'));
  if (text === null) return null;
  try {
    const state = JSON.parse(text);
    return state && typeof state === 'object' && !Array.isArray(state) ? state : null;
  } catch { return null; }
}

function readMode(runDir) {
  const text = readText(path.join(runDir, 'config.yml'));
  if (text === null) return null;
  const m = text.match(/^mode:[ \t]*(\S+)/m);
  return m ? m[1] : null;
}

// The recorded worktree's porcelain listing — the same lookup resume-freshness.js
// runs for its lock check. An unresolvable main checkout is a failed listing.
function listWorktrees(worktree) {
  const root = mainCheckoutRoot(worktree);
  if (!root) return { stdout: '', failure: 'no-main-checkout' };
  return runGit(['worktree', 'list', '--porcelain'], root);
}

// Detail text when the parent session may still be live, else null. Reuses the
// existing probes: an `interrupted` run gets resume-freshness's full verdict;
// any other status gets the recorded worktree's lock. Every "cannot tell"
// reads as live — fail toward not re-entering a pass someone may be running.
function parentLiveDetail(runDir, runState, opts, deps) {
  if (!runState) return null;
  if (opts.sessionId && runState.sessionId === opts.sessionId) return null;
  if (runState.status === 'interrupted') {
    const fresh = (deps.checkResumeFreshness || checkResumeFreshness)(runDir, { sessionId: opts.sessionId });
    return fresh && fresh.safe === false ? `interrupted run ${fresh.verdict}: ${fresh.reason}` : null;
  }
  const worktree = typeof runState.worktree === 'string' && runState.worktree ? runState.worktree : null;
  if (!worktree || lstatType(worktree).type === 'missing') return null;
  const listing = (deps.listWorktrees || listWorktrees)(worktree);
  if (!listing || listing.failure) return 'indeterminate: could not list worktrees to check the parent lock';
  const target = safeReal(worktree) || worktree;
  const entry = parseWorktreeList(listing.stdout).find(
    (e) => (safeReal(e.path) || e.path) === target || e.path === worktree
  );
  if (!entry) return null;
  const lock = (deps.lockVerdict || lockVerdict)(entry);
  return lock === 'in-use' || lock === 'unknown' ? `worktree lock ${lock} (${entry.lockReason || 'no reason'})` : null;
}

// opts.cache      — passed through to checkBranchLanded.
// opts.online     — true only from the review-console skill: lets a squash-
//                   merged PR prove "landed" that offline merge evidence reads
//                   as unmerged. SessionStart never sets it.
// opts.sessionId  — the caller's own CLAUDE_CODE_SESSION_ID; a run that session
//                   owns skips the parent-liveness check. SessionStart passes
//                   none, so a live lock always blocks there.
// opts.deps       — { checkBranchLanded, resolvePrStateByNumber,
//                   checkResumeFreshness, listWorktrees, lockVerdict } injection.
function checkPassReentry(runDir, opts = {}) {
  const deps = opts.deps || {};
  const landedCheck = deps.checkBranchLanded || checkBranchLanded;
  const prResolver = deps.resolvePrStateByNumber || resolvePrStateByNumber;

  const manifest = readManifest(runDir);
  const specs = manifest && Array.isArray(manifest.multispec.specs) ? manifest.multispec.specs : [];
  const specIds = specs.map((s) => s.id);
  const verdict = (reason, detail = '') => ({ eligible: reason === 'eligible', reason, specIds, detail });

  // Real path, so a symlink into pipelines/archive/ still reads as archived.
  if (path.basename(path.dirname(safeReal(runDir) || path.resolve(runDir))) === 'archive') {
    return verdict('archived', 'run dir is under pipelines/archive/');
  }
  if (specs.length === 0) return verdict('no-manifest', 'no manifest.yml with specs');

  const runState = readRunState(runDir);
  if (runState && runState.status === 'clean') return verdict('closed', 'run-state status is clean');

  const mode = readMode(runDir);
  if (mode !== 'auto' && mode !== 'hybrid') {
    return verdict('mode', `config.yml mode is ${mode === null ? 'absent' : mode}`);
  }

  // Anything but a clean "missing" counts as present (dir, symlink, unreadable):
  // fail toward not re-entering a pass that may already have a console.
  const consoleLeaf = lstatType(path.join(runDir, 'console.json'));
  if (consoleLeaf.type !== 'missing') {
    return verdict('console-exists', `console.json already present (${consoleLeaf.type})`);
  }

  const unfinished = specs.filter((s) => s.status === 'pending' || s.status === 'running');
  if (unfinished.length > 0) {
    return verdict('spec-unfinished', unfinished.map((s) => `#${s.id} ${s.status}`).join(', '));
  }

  let liveDetail;
  try {
    liveDetail = parentLiveDetail(runDir, runState, opts, deps);
  } catch {
    liveDetail = 'indeterminate: parent liveness probe failed';
  }
  if (liveDetail) return verdict('parent-live', liveDetail);

  // Online PR check runs first: under pr-first squash merges `git cherry` reads
  // a multi-commit branch as unmerged, so offline evidence can never prove
  // non-landing — only a PR state can prove landing there.
  let degraded = '';
  let prOpen = false;
  const prNumber = runState && runState.pr ? runState.pr.number : null;
  if (opts.online === true && Number.isInteger(prNumber) && prNumber > 0) {
    let pr;
    try { pr = prResolver(repoRootOf(runDir), prNumber); } catch { pr = 'threw'; }
    if (pr && typeof pr === 'object') {
      if (pr.state === 'MERGED') return verdict('landed', `PR #${prNumber} merged`);
      prOpen = pr.state === 'OPEN';
    } else {
      degraded = `online PR check unavailable (${pr == null ? 'no result' : pr})`;
    }
  }
  const withDegrade = (text) => [text, degraded].filter(Boolean).join('; ');

  let landed = null;
  try {
    const result = landedCheck(runDir, { cache: opts.cache });
    landed = result ? result.landed : null;
  } catch { landed = null; }

  if (landed === true) return verdict('landed', withDegrade('branch work already merged'));
  // An open PR answers what indeterminate offline evidence cannot: not landed.
  if (landed !== false && prOpen) return verdict('eligible', `PR #${prNumber} open`);
  if (landed !== false) {
    const why = runState ? 'merge evidence indeterminate' : 'no valid run-state.json, so no recorded branch or PR';
    return verdict('landed-unknown', withDegrade(why));
  }
  return verdict('eligible', withDegrade(''));
}

module.exports = { checkPassReentry, REENTRY_REASONS };
