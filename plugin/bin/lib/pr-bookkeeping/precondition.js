'use strict';

const path = require('path');
const {
  hasMaterializeCommit, hasLoggedPrDegrade, resolveRunPinnedIntegrationModel,
} = require('../hooks/pre-tool-use');
const { readRunState } = require('../hooks/context');
const { mainCheckoutRoot, repoInfo } = require('../hooks/worktree-detect');

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

  // Where run-state.json lives for a /flow multi-spec run (#2664, traced
  // from the writers and every sibling reader -- #2571 Deliverable 2): the
  // run's shared worktree and PR stamps live on the PARENT run dir. Every
  // plugin/bin write goes through hooks/context.js's writeRunState(runDir,
  // patch) (the skill-side standalone mints in wrap-up/release SKILL.md
  // printf a fresh file of their own); the stamp writers are bin/hooks.js's
  // record-worktree (--run required, #1124) and record-pr (--run, else
  // resolveImplicitRunUnambiguous) handlers. Run-dir enumeration lists only
  // top-level run-id-shaped dirs (context.js's iterRunDirsWithState), so any
  // resolution not handed the per-spec {parent-run-id}/spec-{N}/ path inline
  // lands on the parent -- /flow's run-start PR-early lifecycle stamps it
  // there, and the PreToolUse bookkeeping-stamps gate, wrap-up/pack.js's
  // resolveState (#1930 review C1), wrap-up/engine-verify.js's
  // resolvePrNumber and flow/multispec-review-console.md all read the parent
  // for them. A per-spec dir carries its own status (and its own copy of the
  // stamps only when a skill passed that path as --run), so read it first
  // and fill a missing worktree/pr/prExempt -- and the PR-early degrade line
  // below -- from the parent, the same fallback pack.js's resolveState
  // applies. Reading only the per-spec dir falsely denied a correctly-stamped
  // multi-spec run (exit 4 on run 2026-09-30T190052-spec-2633-2664).
  let runState;
  let parentRunDir = null;
  try {
    runState = readRunState(runDir) || {};
    if (/^spec-/.test(path.basename(runDir))) {
      parentRunDir = path.dirname(runDir);
      const parent = readRunState(parentRunDir) || {};
      runState = { ...runState };
      if (!runState.worktree && parent.worktree) runState.worktree = parent.worktree;
      if (!runState.pr && parent.pr) runState.pr = parent.pr;
      if (!runState.prExempt && parent.prExempt) runState.prExempt = parent.prExempt;
    }
  } catch {
    return { ok: true, reason: 'unreadable-run-state' };
  }
  if (runState.status === 'clean') return { ok: true, reason: 'clean' };

  let worktreeRoot;
  try {
    worktreeRoot = runState.worktree ? path.resolve(runState.worktree) : cwd;
  } catch {
    // A hand-corrupted run-state.json can carry a non-string `worktree`
    // field (path.resolve throws a TypeError on anything but a string) --
    // this is the same "can't trust what we read" shape as the JSON-parse
    // failure above, so it fails open the same way rather than crashing the
    // CLI with an undocumented exit code.
    return { ok: true, reason: 'unreadable-run-state' };
  }

  let materialized;
  try {
    materialized = hasMaterializeCommit(worktreeRoot, runDir);
  } catch {
    return { ok: true, reason: 'materialize-check-failed' };
  }
  if (!materialized) return { ok: true, reason: 'not-materialized-yet' };

  if (!runState.worktree) {
    // `git-strategy: current-branch` skips build/worktree-setup.md entirely,
    // so record-worktree (Step 4.5) legitimately never runs and a materialize
    // commit lands with no `worktree` field -- correct-by-design, not a
    // violation. Mirror pre-tool-use.js's checkBookkeepingStampsGate: only a
    // CONFIRMED linked-worktree cwd makes the missing stamp meaningful.
    // Indeterminate (git never answered) resolves the same as "not linked" --
    // this check's whole posture is fail-open on ambiguity (see header
    // comment), so an unprovable case is not grounds to deny either.
    const { isLinkedWorktree, indeterminate } = repoInfo(cwd);
    if (indeterminate || !isLinkedWorktree) {
      return { ok: true, reason: 'not-linked-worktree' };
    }
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

  if (hasLoggedPrDegrade(runDir) || (parentRunDir && hasLoggedPrDegrade(parentRunDir))) {
    return { ok: true, reason: 'degrade-logged' };
  }

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
