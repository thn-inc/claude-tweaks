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
// merge-evidence call is wrapped, because it shells out to git and any throw
// there is "cannot tell", never "not landed".
'use strict';
const fs = require('fs');
const path = require('path');
const { readManifest } = require('./manifest');
const { lstatType } = require('../path-guard');
const { checkBranchLanded, repoRootOf } = require('../hooks/run-integrity');
const { resolvePrStateByNumber } = require('../reconcile/pr-state');

// Evaluation order == this order; the first failing check wins.
const REENTRY_REASONS = Object.freeze([
  'archived', 'no-manifest', 'closed', 'mode', 'console-exists',
  'spec-unfinished', 'landed', 'landed-unknown', 'eligible',
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
  const m = text.match(/^mode:\s*(\S+)/m);
  return m ? m[1] : null;
}

// opts.cache      — passed through to checkBranchLanded.
// opts.online     — true only from the review-console skill: lets a squash-
//                   merged PR prove "landed" that offline merge evidence reads
//                   as unmerged. SessionStart never sets it.
// opts.deps       — { checkBranchLanded, resolvePrStateByNumber } injection.
function checkPassReentry(runDir, opts = {}) {
  const deps = opts.deps || {};
  const landedCheck = deps.checkBranchLanded || checkBranchLanded;
  const prResolver = deps.resolvePrStateByNumber || resolvePrStateByNumber;

  const manifest = readManifest(runDir);
  const specs = manifest && Array.isArray(manifest.multispec.specs) ? manifest.multispec.specs : [];
  const specIds = specs.map((s) => s.id);
  const verdict = (reason, detail = '') => ({ eligible: reason === 'eligible', reason, specIds, detail });

  if (path.basename(path.dirname(path.resolve(runDir))) === 'archive') {
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

  // Online PR check runs first: under pr-first squash merges `git cherry` reads
  // a multi-commit branch as unmerged, so offline evidence can never prove
  // non-landing — only a PR state can prove landing there.
  let degraded = '';
  const prNumber = runState && runState.pr ? runState.pr.number : null;
  if (opts.online === true && Number.isInteger(prNumber) && prNumber > 0) {
    const pr = prResolver(repoRootOf(runDir), prNumber);
    if (pr && typeof pr === 'object') {
      if (pr.state === 'MERGED') return verdict('landed', `PR #${prNumber} merged`);
    } else {
      degraded = `online PR check unavailable (${pr === null ? 'null' : pr})`;
    }
  }
  const withDegrade = (text) => [text, degraded].filter(Boolean).join('; ');

  let landed = null;
  try {
    const result = landedCheck(runDir, { cache: opts.cache });
    landed = result ? result.landed : null;
  } catch { landed = null; }

  if (landed === true) return verdict('landed', withDegrade('branch work already merged'));
  if (landed !== false) return verdict('landed-unknown', withDegrade('merge evidence indeterminate'));
  return verdict('eligible', withDegrade(''));
}

module.exports = { checkPassReentry, REENTRY_REASONS };
