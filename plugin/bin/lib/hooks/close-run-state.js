// bin/lib/hooks/close-run-state.js — the terminal-state-flip logic shared by
// `bin/hooks.js`'s `close-run` subcommand and `teardown-run`'s Step 1 (#594).
// Extracted verbatim from close-run's own inline block so a future change to
// either the foreign-owner refusal or the wrap-up warn-tier check only needs
// to land once. Pure decision + one write; callers own their own message text.
'use strict';
const fs = require('fs');
const path = require('path');
const ctxLib = require('./context');

// A run dir still holds un-archived work/ content if either the top-level
// work/ (single-spec layout) or any spec-*/work/ (multi-spec layout,
// materialize.md's Multi-record layout) exists on disk — this is a plain
// fs.existsSync check, not a git-tracked-ness check, so it can't (and
// doesn't try to) distinguish tracked from untracked work/ content (#1103's
// own originally-reported scenario had untracked work/{n}-spec.md). This is
// the routine, expected state right after close-run in the normal wrap-up
// sequence (archive-run always runs after, never before) — this check
// surfaces it as an advisory field rather than blocking the close (the
// escape-hatch use case — closing a stuck/foreign run manually — must still
// work even when work/ hasn't landed).
function hasUnarchivedWork(runDir) {
  if (fs.existsSync(path.join(runDir, 'work'))) return true;
  let entries;
  try {
    entries = fs.readdirSync(runDir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((e) => e.isDirectory() && e.name.startsWith('spec-') && fs.existsSync(path.join(runDir, e.name, 'work')));
}

// Returns one of:
//   { status: 'refused-foreign' }
//     — an implicit (`explicit: false`) run resolution landed on a run
//       recorded by a different, still-active session (or bound to a
//       different, still-live worktree — see the classifyOwnership note
//       below); nothing was written.
//   { status: 'refused-live-worktree' }
//     — an implicit close landed on a run whose worktree directory still
//       physically exists; nothing was written (see #1502 comment below).
//   { status: 'closed', foreignOwner, wrapupSeen, writeOk, notYetArchived }
//     — the run-state write was attempted (and `writeOk` reports whether it
//       succeeded); `foreignOwner`/`wrapupSeen`/`notYetArchived` let the
//       caller render the same advisory lines close-run always has.
//
// #1012: `foreignOwner` is decided via `classifyOwnership` (#1098) —
// composite session+worktree-binding identity — instead of a raw
// `prev.sessionId !== sessionId` comparison, which the shared
// `CLAUDE_CODE_SESSION_ID` (#965: identical across every subagent of one
// session) defeated for a sibling closing a DIFFERENT sibling's bound run.
// `callerIdentity = { sessionId, cwd }` replaces the bare `sessionId`
// option; hooks.js's callers thread `process.cwd()` through as `cwd`.
// #2553: `treatCleanAsAlreadyClosed` (default true) distinguishes the two
// genuinely different shapes that share this one function. For `hooks.js`'s
// `close-run` verb and `teardown-run.js`'s own Step 1 — the "ExitWorktree/
// close teardown path" the issue names — a run whose run-state.json already
// reads `status: clean` at entry means a PRIOR closeRunState call already
// resolved the wrapupSeen question for this exact run (e.g. wrap-up's own
// close, moments before ExitWorktree's teardown redundantly calls close
// again on the same, already-settled run) — re-emitting close-without-wrapup
// here is a false terminal-state signal, not a new finding, so the default
// suppresses it. `archive-merged.js`'s own internal call is different: its
// caller (`archiveRunDir`) ALREADY wrote `status: 'clean'` as its own
// bookkeeping step moments earlier in the SAME synchronous archive sequence —
// never via a prior closeRunState call — so for that one caller, this is the
// FIRST (and only) real close-without-wrapup check for this run, and must
// run exactly as before; that caller passes `treatCleanAsAlreadyClosed:
// false` to opt out.
function closeRunState(runDir, {
  explicit = false, callerIdentity = null, checkLiveWorktree = true, treatCleanAsAlreadyClosed = true,
} = {}) {
  const prev = ctxLib.readRunState(runDir);
  const verdict = ctxLib.classifyOwnership(callerIdentity || {}, prev);
  const foreignOwner = verdict === 'foreign';
  if (foreignOwner && !explicit) {
    // The implicit fallback ("newest non-terminal run") landed on a run
    // recorded by a DIFFERENT, still-active session — closing it here
    // would silently disarm that session's E1/E2/E3 enforcement with no
    // way for it to know (see CLAUDE.md's Hooks section). Refuse rather
    // than act; pass an explicit --run if closing someone else's run is
    // genuinely intended.
    return { status: 'refused-foreign' };
  }
  // #1502: the foreign-owner check above only catches a PROVABLE ownership
  // mismatch — a run whose run-state.json never recorded ANY sessionId AND
  // carries no worktree binding classifyOwnership can prove foreign from
  // (an 'indeterminate' verdict) reads as `foreignOwner: false` no matter
  // who calls, so an implicit close (no --run, landing on "the newest
  // non-terminal run" by the fallback resolver) could still close a run it
  // does not own, with no identity signal to catch it. Narrow and
  // deliberate: fires ONLY when `prev.sessionId` is absent. `explicit: true`
  // (a caller who named `--run` themselves) always bypasses this, same as
  // the foreign-owner check above.
  //
  // `checkLiveWorktree` (default true) exists because this heuristic — "the
  // worktree still exists on disk, so it's presumptively still in progress"
  // — is only meaningful for close-run's own implicit fallback ("newest
  // non-terminal run"), where the caller never named which run it meant.
  // teardown-run's Step 1 call is never that: it always names a specific
  // run its OWN caller identified, and its Step 3 (worktree removal) runs
  // moments later in the same invocation — so the worktree is GUARANTEED
  // to still exist at this point regardless of whether the run is actually
  // foreign, making the check fire unconditionally (never a real signal)
  // for any run whose sessionId was never recorded, permanently refusing a
  // legitimate self-teardown with no override path. teardown-run passes
  // `checkLiveWorktree: false` and relies on the foreignOwner check above
  // (still active) for its actual protection.
  const hasUnrecordedLiveWorktree = checkLiveWorktree && !!(prev && !prev.sessionId
    && typeof prev.worktree === 'string' && prev.worktree && fs.existsSync(prev.worktree));
  if (hasUnrecordedLiveWorktree && !explicit) {
    return { status: 'refused-live-worktree' };
  }

  // Warn-tier check (#373): closing a run whose ledger never recorded a wrap-up
  // invocation. Warn, never block — dispatch's close-before-merge is sanctioned,
  // and a human-typed /claude-tweaks:wrap-up leaves no event at all (measured,
  // #371 finding (e)), so absence is not proof the procedure was skipped.
  // #2553: a run whose run-state.json already reads `status: clean` at this
  // point is already closed (clean) and mid-archival elsewhere (e.g. wrap-up's
  // own flow calling close-run a second time, or ExitWorktree racing a close
  // wrap-up itself just performed) — emitting `close-without-wrapup` for that
  // case is a false terminal-state signal, not a real skipped-wrapup finding.
  // `prev` was already read above (before the foreign-owner check), so this
  // costs no extra read.
  const alreadyClean = treatCleanAsAlreadyClosed && !!(prev && prev.status === 'clean');
  const wrapupSeen = !!(ctxLib.scanWrapupEvents(runDir) || {}).wrapup;
  if (!wrapupSeen && !alreadyClean) {
    ctxLib.appendEvent(runDir, 'close-without-wrapup', {});
  }

  const notYetArchived = hasUnarchivedWork(runDir);
  const writeOk = !!ctxLib.writeRunState(runDir, { status: 'clean', worktree: null });
  return { status: 'closed', foreignOwner, wrapupSeen, writeOk, notYetArchived };
}

module.exports = { closeRunState, hasUnarchivedWork };
