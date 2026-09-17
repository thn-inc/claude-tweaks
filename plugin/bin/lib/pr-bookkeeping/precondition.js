'use strict';

const path = require('path');
const {
  hasMaterializeCommit, hasLoggedPrDegrade, resolveRunPinnedIntegrationModel,
} = require('../hooks/pre-tool-use');
const { readRunState } = require('../hooks/context');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');

// checkPrBookkeepingPrecondition({ runDir, cwd }) -> { ok, reason, message? }
//
// Phase-boundary companion to pre-tool-use.js's checkBookkeepingStampsGate
// (per-tool-call enforcement keyed off an ambiguously-resolved ctx.runDir --
// see that file's own header comment on IL-131). This check runs against a
// KNOWN run dir (the caller already holds $PIPELINE_RUN_DIR, e.g.
// /claude-tweaks:test's own entry) so it needs none of that gate's
// foreign-session / cross-repo scoping machinery -- it only answers "does
// THIS run comply with its own pr-first bookkeeping contract" (#2472).
//
// Ambiguity resolves to { ok: true } throughout, mirroring the PreToolUse
// gate's own posture -- this is a defense-in-depth safety net layered on top
// of that gate and build/SKILL.md Common Step 7's bookkeeping assertion, not
// a replacement for either.
function checkPrBookkeepingPrecondition({ runDir, cwd = process.cwd() }) {
  if (!runDir) return { ok: true, reason: 'no-run-dir' };

  let runState;
  try {
    runState = readRunState(runDir) || {};
  } catch {
    return { ok: true, reason: 'unreadable-run-state' };
  }
  if (runState.status === 'clean') return { ok: true, reason: 'clean' };

  const worktreeRoot = runState.worktree ? path.resolve(runState.worktree) : cwd;

  let materialized;
  try {
    materialized = hasMaterializeCommit(worktreeRoot, runDir);
  } catch {
    return { ok: true, reason: 'materialize-check-failed' };
  }
  if (!materialized) return { ok: true, reason: 'not-materialized-yet' };

  if (!runState.worktree) {
    return {
      ok: false,
      reason: 'no-worktree-stamp',
      message: `pipeline run ${path.basename(runDir)} has a landed materialize commit but no recorded `
        + 'worktree assignment -- build/worktree-setup.md Step 4.5 (record-worktree) is non-skippable '
        + `[IL-131]. Run: node "\${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "${runDir}" "${worktreeRoot}"`,
    };
  }

  if (runState.pr || runState.prExempt) return { ok: true, reason: 'pr-stamped-or-exempt' };

  let model;
  try {
    const mainRoot = mainCheckoutRoot(worktreeRoot) || worktreeRoot;
    model = resolveRunPinnedIntegrationModel(mainRoot, runDir);
  } catch {
    model = 'local-merge';
  }
  if (model !== 'pr-first') return { ok: true, reason: 'not-pr-first' };

  if (hasLoggedPrDegrade(runDir)) return { ok: true, reason: 'degrade-logged' };

  return {
    ok: false,
    reason: 'no-pr-stamp',
    message: `this project resolves integration-model: pr-first and a materialize commit already landed in `
      + `${worktreeRoot}, but no PR is recorded for this run and no degrade line is logged -- `
      + 'build/worktree-setup.md Step 6 (_shared/pr-early-run-lifecycle.md) is non-skippable [IL-131]. '
      + 'Open the PR now, or if push/gh pr create genuinely failed, log the mandatory degrade line: '
      + `node "\${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "${runDir}" --section "/build" --status AUTO `
      + '--reversibility n/a --text "PR-early run lifecycle: <push|gh pr create> of <branch> FAILED (<reason>); '
      + 'run proceeds local-only, no PR opened"',
  };
}

module.exports = { checkPrBookkeepingPrecondition };
