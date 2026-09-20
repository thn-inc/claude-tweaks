// bin/lib/hooks/teardown-run.js — `bin/hooks.js teardown-run --run <dir> [--merged|--abandoned]`
// (#594). Composes five existing, separately-tested mechanics behind one subcommand instead of
// the 4-5 hand-assembled commands a finished /flow run needed before this: (1) close-run's
// terminal-state flip (close-run-state.js), (2) archive-merged.js's git-mv-and-commit archival,
// (3) worktree-reap.js's lock/eligibility predicate for worktree removal, (4) a local branch
// delete, (5) the remote ref delete `pr-first-merge-post-merge.md` Step 5 already specifies.
//
// Cardinal invariant (bin/hooks.js's own header comment): this is dispatched the same way
// close-run is, so it never sets a non-zero exit and never throws past its own boundary — every
// step is try/skip/report. A locked worktree, `--abandoned`, or a branch-name-matches-integration
// guard all SKIP their step and report why; none of them abort the remaining steps, since a
// locked worktree doesn't block branch/ref cleanup that doesn't depend on it.
'use strict';
const path = require('path');
const { closeRunState } = require('./close-run-state');
const { archiveRunDir } = require('../reconcile/archive-merged');
const { runGit } = require('./git-exec');
const { parseWorktreeList, isWorktreeLocked, resolveIntegrationBranch, bareIntegrationName } = require('./worktree-reap');
const { mainCheckoutRoot } = require('./worktree-detect');
const { fallbackBranch, worktreePathForBranch } = require('./run-integrity');

const GH_TIMEOUT_MS = 15000;

// Injectable seam (gh-api-module-pattern): real `gh` shelled out to by default; a fixture test
// passes a fake here instead of touching the network. Mirrors reconcile/release-merged.js's own
// ghApi() shape (encoding, stdio, timeout) rather than inventing a second one.
function defaultGhApiDelete(args) {
  const cp = require('child_process');
  try {
    cp.execFileSync('gh', ['api', '--method', 'DELETE', ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GH_TIMEOUT_MS,
    });
    return { ok: true };
  } catch (e) {
    const stderr = String((e && e.stderr) || (e && e.message) || '');
    // Tolerate "reference does not exist" (already deleted — GitHub's own
    // branch-protection auto-delete, or a re-run of this step) as success,
    // per pr-first-merge-post-merge.md Step 5.
    if (/reference does not exist/i.test(stderr)) return { ok: true, alreadyGone: true };
    return { ok: false, error: stderr || 'gh api delete failed' };
  }
}

// Shared gating for Steps 4-5 below: both delete something keyed on `branch` and skip for the
// same three reasons (no --merged, nothing recorded, or the integration branch itself) with only
// the label differing. Returns the skip line, or null when the caller should proceed with its own
// (differing) delete action.
function modeGateSkip(mode, branch, isIntegrationBranch, label) {
  if (mode !== 'merged') return `${label}: skipped — ${mode === 'abandoned' ? 'abandoned' : 'no --merged/--abandoned given'}`;
  if (!branch) return `${label}: skipped — no branch recorded`;
  if (isIntegrationBranch) return `${label}: skipped — refusing to delete the integration branch (${branch})`;
  return null;
}

function repoSlugOf(root) {
  const remote = runGit(['remote', 'get-url', 'origin'], root);
  if (remote.failure || !remote.stdout) return null;
  const m = /[:/]([^/]+\/[^/]+?)(\.git)?$/.exec(remote.stdout);
  return m ? m[1] : null;
}

// Branch registered for `worktreePath` in `git worktree list --porcelain`, or null when the
// worktree isn't registered at all. Deliberately independent from run-integrity.js's own
// deriveBranch — that one derives branch to build shipped-unclosed EVIDENCE and stays scoped to
// that read-only advisory; this one is a plain lookup for a step about to actually mutate state.
function branchOfWorktree(root, worktreePath) {
  if (!worktreePath) return null;
  const list = runGit(['worktree', 'list', '--porcelain'], root);
  if (list.failure || list.stdout === null) return null;
  for (const entry of parseWorktreeList(list.stdout)) {
    if (entry.path === worktreePath) return entry.branch || null;
  }
  return null;
}

// `runDir` — the run directory (already resolved/anchored by the caller, same contract as
// close-run). `opts.mode` — 'merged' | 'abandoned' | null (neither flag given — treated the same
// as 'abandoned' for steps 4-5: skip branch/ref deletion rather than guess intent). `opts.deps`
// — test seam for the gh call only; every git call goes through the real runGit (fixture repos
// are real git repos, matching this codebase's existing convention for reconcile/archive tests).
function teardownRun(runDir, opts = {}) {
  const mode = opts.mode || null;
  const sessionId = opts.sessionId || null;
  // #1012: closeRunState's foreignOwner guard now runs through
  // classifyOwnership, which needs a cwd alongside the session id — hooks.js
  // threads process.cwd() through as opts.cwd; a caller that omits it (e.g.
  // an existing test fixture) degrades to classifyOwnership's own
  // 'indeterminate' fail-open behavior for a missing cwd, never 'foreign'.
  const cwd = opts.cwd || null;
  const ghApiDelete = (opts.deps && opts.deps.ghApiDelete) || defaultGhApiDelete;
  // Git-based anchoring (same mechanism `_shared/pipeline-run-dir.md`'s Anchoring section
  // documents as canonical for every other `--run`-accepting subcommand): walks up from `runDir`
  // to the nearest `.git`, so it resolves the correct root regardless of how many levels `runDir`
  // sits below it — 3 for a live run (.claude-tweaks/pipelines/{run-id}), 4 for an
  // already-archived one (.claude-tweaks/pipelines/archive/{run-id}). Replaces the former fixed
  // `path.resolve(runDir, '..', '..', '..')`, which silently assumed the 3-level case and, given
  // the 4-level archived case, landed one directory short — {root}/.claude-tweaks instead of
  // {root} — corrupting every downstream git-rooted call (most visibly a doubled
  // .claude-tweaks/.claude-tweaks/... path out of archiveRunDir).
  const root = mainCheckoutRoot(runDir);
  const lines = [];

  // Read the worktree/branch this run recorded BEFORE Step 1 flips run-state.json to
  // `{status:'clean', worktree:null}` and BEFORE Step 2 archives it out from under `runDir`
  // entirely (archiveRunDir moves it to archive/{run-id}/run-state.json) — both destroy the very
  // fields this needs, so this must run first regardless of read-order convenience.
  const ctxLib = require('./context');
  const prevState = ctxLib.readRunState(runDir) || {};
  const worktreePath = typeof prevState.worktree === 'string' && prevState.worktree ? prevState.worktree : null;
  // Every root-rooted lookup below is guarded: `root` can be null (no `.git` found walking up
  // from `runDir`, or an unreadable/unparseable gitdir) — a failure mode the old fixed arithmetic
  // had no equivalent for, since it always returned SOME path, right or wrong. branchOfWorktree
  // and resolveIntegrationBranch both shell out to git with `root` as cwd, so a null root must
  // never reach them; falling back to the recorded state's own `branch` field (no git needed)
  // keeps the foreign-owner refusal check below meaningful even when root can't be resolved.
  // `worktreePath` is null exactly when #2362's gap fires — run-state.json never
  // got a `worktree` field written (EnterWorktree entered the worktree, but the
  // formal record-worktree stamp never landed). Recover the branch the same way
  // run-integrity.js's shipped-unclosed check already does for a torn-down
  // worktree: state.pr.branch first, then the PR-early-lifecycle log lines in
  // decisions.md. `prevState.branch` is kept as a defensive first check even
  // though nothing in this codebase writes that top-level field today — it
  // costs nothing and protects a future writer that might.
  const branch = (root ? branchOfWorktree(root, worktreePath) : null)
    || (prevState && prevState.branch)
    || (!worktreePath && root ? fallbackBranch(root, runDir, prevState) : null)
    || null;
  // Fallback worktree-path recovery (#2362): only attempted when nothing was
  // recorded at all. Never overrides a recorded (even if now-stale) worktree
  // path — a caller that explicitly recorded one gets exactly that one's own
  // skip/lock/removal handling, unchanged.
  const recoveredWorktreePath = (!worktreePath && root && branch) ? worktreePathForBranch(root, branch) : null;
  const effectiveWorktreePath = worktreePath || recoveredWorktreePath;
  // #1688: resolveIntegrationBranch's policy-configured path can now return
  // an `origin/{name}` remote-tracking ref (preferRemoteTrackingRef,
  // worktree-reap.js). `branch` above is always bare, so the equality check
  // below needs a bare `integration` too — otherwise this refusal-to-delete
  // guard silently stops recognizing the integration branch as itself.
  const integration = root ? bareIntegrationName(resolveIntegrationBranch(root)) : null;
  const isIntegrationBranch = !!(branch && integration && branch === integration);

  // `explicit: false` here is deliberate, not a copy-paste of close-run's default: teardown-run
  // has no "override the refusal" input of its own the way close-run's --run does (--run here
  // just names which run to act on) — extending close-run's foreignOwner refusal means it applies
  // unconditionally, the same shape as close-run's own implicit path. A foreign-owned run refuses
  // the WHOLE teardown (no archive, no worktree removal, no branch/ref delete) rather than
  // partially acting — tearing down another session's live run out from under it is the hazard.
  // `state.notYetArchived` (closeRunState's #1103 advisory field, surfaced as a warning by
  // hooks.js's standalone close-run verb) is deliberately left unread here — Step 2 immediately
  // below calls archiveRunDir itself, so by the time a caller could see this value the content
  // it describes is already being archived. Do not wire up the same warning here too.
  //
  // `checkLiveWorktree: false` — the #1502 "worktree still exists on disk" heuristic assumes
  // an implicit fallback resolution ("newest non-terminal run", no specific target named).
  // teardown-run always operates on a run its own caller explicitly identified, and Step 3
  // below removes that same worktree moments later in this same invocation — so the worktree
  // is guaranteed present here regardless of ownership, making the check fire unconditionally
  // (never a real signal) for any run whose sessionId was never recorded, permanently refusing
  // a legitimate self-teardown. The foreignOwner check just above is teardown-run's actual
  // protection and stays active.
  const state = closeRunState(runDir, {
    explicit: false, callerIdentity: { sessionId, cwd }, checkLiveWorktree: false,
  });

  if (state.status === 'refused-foreign') {
    return { lines: ['state: refused — run recorded by another session; teardown-run does not override this'] };
  }
  if (state.status === 'refused-live-worktree') {
    return { lines: ['state: refused — run has no recorded owner and its worktree still exists on disk; teardown-run does not override this'] };
  }

  // Step 1 (state).
  if (!state.writeOk) {
    lines.push('state: failed — run-state.json could not be written');
  } else {
    lines.push('state: closed' + (state.wrapupSeen ? '' : ' (no wrap-up event recorded)'));
  }

  // `root === null` means mainCheckoutRoot couldn't find a `.git` walking up from `runDir` (or hit
  // an unreadable/unparseable gitdir) — every remaining step needs a real root to run git against,
  // so skip them all individually here (same try/skip/report posture as every other step) rather
  // than letting a null root reach runGit/archiveRunDir and produce a confusing downstream failure.
  if (!root) {
    lines.push('archive: skipped — could not determine main checkout root from run dir');
    lines.push('worktree: skipped — could not determine main checkout root from run dir');
    lines.push('branch: skipped — could not determine main checkout root from run dir');
    lines.push('remote ref: skipped — could not determine main checkout root from run dir');
    return { lines };
  }

  // Step 2 (archive) — reuse archive-merged.js's git-mv-and-commit sequence verbatim rather than
  // a second, divergent archival path.
  const archived = archiveRunDir(root, runDir);
  if (archived.ok) {
    lines.push(`archive: moved to archive/${path.basename(runDir)}/`);
  } else {
    lines.push(`archive: skipped — ${archived.reason}`);
  }

  // Step 3 (worktree removal) — never forced; a locked worktree means either a live session
  // (including this session's own ground, per [IL-58] — that removal path is ExitWorktree only)
  // or an unresolvable state, and worktree-reap.js's predicates fail CLOSED either way.
  if (!effectiveWorktreePath) {
    lines.push('worktree: skipped — no worktree recorded');
  } else if (isWorktreeLocked(effectiveWorktreePath, { cwd: root })) {
    lines.push('worktree: skipped — worktree locked');
  } else {
    const rm = runGit(['worktree', 'remove', effectiveWorktreePath], root);
    if (rm.failure) lines.push(`worktree: skipped — removal failed${rm.stderr ? ` (${rm.stderr})` : ''}`);
    else {
      lines.push(`worktree: removed ${effectiveWorktreePath}${recoveredWorktreePath ? ' (resolved via branch-name fallback — no worktree recorded in run-state.json)' : ''}`);
    }
  }

  // Step 4 (local branch delete) — only under --merged.
  const branchSkip = modeGateSkip(mode, branch, isIntegrationBranch, 'branch');
  if (branchSkip) {
    lines.push(branchSkip);
  } else {
    const del = runGit(['branch', '-D', branch], root);
    if (del.failure) lines.push(`branch: skipped — delete failed for ${branch}`);
    else lines.push(`branch: deleted ${branch}`);
  }

  // Step 5 (remote ref delete) — same --merged-only gating as Step 4; never `git push --delete`
  // (denied by worktree.always from the main checkout) — the contents/refs API only.
  const refSkip = modeGateSkip(mode, branch, isIntegrationBranch, 'remote ref');
  if (refSkip) {
    lines.push(refSkip);
  } else {
    const slug = repoSlugOf(root);
    if (!slug) {
      lines.push('remote ref: skipped — could not resolve owner/repo');
    } else {
      const result = ghApiDelete([`repos/${slug}/git/refs/heads/${branch}`]);
      if (result.ok) lines.push(`remote ref: deleted${result.alreadyGone ? ' (already gone)' : ''} refs/heads/${branch}`);
      else lines.push(`remote ref: skipped — ${result.error}`);
    }
  }

  return { lines };
}

module.exports = { teardownRun, branchOfWorktree, repoSlugOf, defaultGhApiDelete };
