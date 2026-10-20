// bin/lib/hooks/teardown-run.js — `bin/hooks.js teardown-run --run <dir> [--merged|--abandoned]`
// (#594). Composes four existing, separately-tested mechanics behind one subcommand instead of
// the 4-5 hand-assembled commands a finished /flow run needed before this: (1) close-run's
// terminal-state flip (close-run-state.js), (2) worktree-reap.js's lock/eligibility predicate for
// worktree removal, (3) a local branch delete, (4) the remote ref delete `pr-first-merge-post-merge.md`
// Step 5 already specifies. Archival left this verb in #3490; it is `archive-run`'s (console-gated, #1130) and the
// reconciler's job.
//
// Cardinal invariant (bin/hooks.js's own header comment): it never sets a non-zero exit and
// never throws past its own boundary — every step is try/skip/report — unlike close-run's
// rejected-`--run` exit 1 (#3025). A locked worktree, `--abandoned`, or a branch-name-matches-integration
// guard all SKIP their step and report why; none of them abort the remaining steps, since a
// locked worktree doesn't block branch/ref cleanup that doesn't depend on it.
'use strict';
const fs = require('fs');
const { closeRunState } = require('./close-run-state');
const { runGit } = require('./git-exec');
const { parseWorktreeList, isWorktreeLocked, resolveIntegrationBranch, bareIntegrationName } = require('./worktree-reap');
const { mainCheckoutRoot } = require('./worktree-detect');
const { fallbackBranch, worktreePathForBranch } = require('./run-integrity');
const { parseRepo } = require('../repo-resolve');

const GH_TIMEOUT_MS = 15000;

// Injectable seam (gh-api-module-pattern): real `gh` shelled out to by default; a fixture test
// passes a fake here instead of touching the network. Mirrors reconcile/release-merged.js's own
// ghApi() shape (encoding, stdio, timeout) rather than inventing a second one.
// `host` (optional; omitted/'github.com' = no flag) threads --hostname onto the raw `gh api
// repos/{owner}/{repo}/...` call the same way release.js/link.js/native-dependencies.js already
// do (#2240 convention) — the REST path itself is never host-qualified, only owner/repo, so a
// GitHub Enterprise Server remote needs this separate flag or the call silently targets
// github.com instead.
function defaultGhApiDelete(args, host) {
  const cp = require('child_process');
  const hostArgs = host && host !== 'github.com' ? ['--hostname', host] : [];
  try {
    cp.execFileSync('gh', ['api', '--method', 'DELETE', ...args, ...hostArgs], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GH_TIMEOUT_MS,
      windowsHide: true,
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

// -> { host, owner, repo } | null. Delegates to repo-resolve.js's shared parseRepo (the one
// owner/repo/host regex in the codebase, #1177) instead of this module's own narrower
// owner/repo-only regex, which discarded the host segment a GitHub Enterprise Server remote
// carries — the discarded host was exactly what made Step 5's `gh api` call below always target
// github.com regardless of the actual remote.
function repoSpecOf(root) {
  const remote = runGit(['remote', 'get-url', 'origin'], root);
  if (remote.failure || !remote.stdout) return null;
  return parseRepo(remote.stdout);
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
// #3023: a failed git call's best available cause — stderr when git wrote any,
// else its exit status (plus stdout when present), else the failure category
// (e.g. timeout, spawn), so "no error text" only appears when nothing at all
// is known.
function describeGitFailure(r) {
  if (!r) return 'no error text';
  if (r.stderr) return r.stderr;
  if (typeof r.exitCode === 'number') {
    return `exit ${r.exitCode}${r.failureStdout ? `; stdout: ${r.failureStdout}` : ''}`;
  }
  if (typeof r.failure === 'string' && r.failure) return r.failure;
  return 'no error text';
}

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
  // {root} — corrupting every downstream root-rooted read (e.g. the policy.yml lookup behind
  // the integration-branch guard).
  const root = mainCheckoutRoot(runDir);
  const lines = [];

  // Read the worktree/branch this run recorded BEFORE Step 1 flips run-state.json to
  // `{status:'clean', worktree:null}` — that flip destroys the very fields this needs, so this
  // must run first regardless of read-order convenience.
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
  // #3088: when no worktree was ever recorded (the own-worktree path, after
  // close-run already cleared run-state.json's worktree field — see Section
  // C step 5.5), fallbackBranch()'s own branchExists gate correctly protects
  // run-integrity.js's shipped-unclosed detection (which needs a real local
  // ref to run merge-base against) but wrongly also suppresses the branch
  // NAME for this function's own remote-ref-delete purpose, which needs no
  // local existence at all. record-pr already writes run-state.json's
  // pr.branch via deriveBranch() at PR-creation time (#1672) specifically so
  // it survives the worktree's own later removal — read it directly here as
  // a final, narrower fallback, still gated the same `!worktreePath` way
  // fallbackBranch() itself is gated (never fires when a worktree WAS
  // recorded but is merely gone from disk — that case keeps its existing
  // "no branch recorded" behavior unchanged, per AC9 below).
  const branch = (root ? branchOfWorktree(root, worktreePath) : null)
    || (prevState && prevState.branch)
    || (!worktreePath && root
      ? (fallbackBranch(root, runDir, prevState)
        || (prevState && prevState.pr && typeof prevState.pr.branch === 'string' ? prevState.pr.branch : null))
      : null)
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
  // the WHOLE teardown (no worktree removal, no branch/ref delete) rather than
  // partially acting — tearing down another session's live run out from under it is the hazard.
  // `state.notYetArchived` (closeRunState's #1103 advisory field, surfaced as a warning by
  // hooks.js's standalone close-run verb) is deliberately left unread here — teardown-run never
  // archives (#3490), and Step 2's own line names `archive-run` as the archival step, so the
  // warning belongs to that verb's caller, not this one. Do not wire up the same warning here too.
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

  // Step 2 (archive) — teardown-run never archives (#3490). Archival is archive-run's job, gated by
  // the console (#1130), and runs as the caller's own last cleanup step after the later items
  // (ephemeral dev server teardown, issue claim release) that still need $RUN_DIR to resolve. This
  // line stays so the output names where archival lives.
  lines.push("archive: skipped — teardown-run does not archive (archival is the caller's own last cleanup step: hooks.js archive-run)");

  // `root === null` means mainCheckoutRoot couldn't find a `.git` walking up from `runDir` (or hit
  // an unreadable/unparseable gitdir) — every remaining step needs a real root to run git against,
  // so skip them all individually here (same try/skip/report posture as every other step) rather
  // than letting a null root reach runGit and produce a confusing downstream failure.
  if (!root) {
    lines.push('worktree: skipped — could not determine main checkout root from run dir');
    lines.push('branch: skipped — could not determine main checkout root from run dir');
    lines.push('remote ref: skipped — could not determine main checkout root from run dir');
    return { lines };
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
    if (rm.failure) {
      // #2747: a worktree removal can fail while having already half-reaped the worktree (its
      // `.git` file gone, but the registration in `git worktree list` still present) — git's own
      // porcelain output calls this `prunable`. Left alone, that stale registration then makes
      // Step 4's branch delete fail too, since git still considers the branch checked out there.
      // A plain `git worktree prune` clears it, so check for exactly that state and retry via
      // prune before giving up — never an unconditional prune-and-retry, since a *different*
      // failure (permissions, a dirty working tree) must still surface as a real failure rather
      // than being masked by a prune that wouldn't have helped it anyway.
      const listAfter = runGit(['worktree', 'list', '--porcelain'], root);
      const entryAfter = (!listAfter.failure && listAfter.stdout !== null)
        ? parseWorktreeList(listAfter.stdout).find((w) => w.path === effectiveWorktreePath)
        : null;
      if (entryAfter && entryAfter.prunable) {
        const prune = runGit(['worktree', 'prune'], root);
        if (!prune.failure) {
          // #3023: prune clears only the registration. Report what is actually on disk —
          // never retry-delete here (a Windows handle can hold the directory; looping on it
          // would hang teardown).
          if (fs.existsSync(effectiveWorktreePath)) {
            lines.push(`worktree: registration pruned but directory still present at ${effectiveWorktreePath} (removal had failed: ${describeGitFailure(rm)})`);
          } else {
            lines.push(`worktree: removed via prune ${effectiveWorktreePath} (removal had failed: ${describeGitFailure(rm)})`);
          }
        } else {
          lines.push(`worktree: skipped — removal failed (${describeGitFailure(rm)}); prune also failed (${describeGitFailure(prune)})`);
        }
      } else {
        lines.push(`worktree: skipped — removal failed (${describeGitFailure(rm)})`);
      }
    } else {
      lines.push(`worktree: removed ${effectiveWorktreePath}${recoveredWorktreePath ? ' (resolved via branch-name fallback — no worktree recorded in run-state.json)' : ''}`);
    }
  }

  // Step 4 (local branch delete) — only under --merged. Runs after Step 3's prune-retry above, so
  // a worktree that was merely left in a stale `prunable` registration no longer blocks this.
  const branchSkip = modeGateSkip(mode, branch, isIntegrationBranch, 'branch');
  if (branchSkip) {
    lines.push(branchSkip);
  } else {
    const del = runGit(['branch', '-D', branch], root);
    if (del.failure) lines.push(`branch: skipped — delete failed for ${branch}${del.stderr ? ` (${del.stderr})` : ''}`);
    else lines.push(`branch: deleted ${branch}`);
  }

  // Step 5 (remote ref delete) — same --merged-only gating as Step 4; never `git push --delete`
  // (denied by worktree.always from the main checkout) — the contents/refs API only.
  const refSkip = modeGateSkip(mode, branch, isIntegrationBranch, 'remote ref');
  if (refSkip) {
    lines.push(refSkip);
  } else {
    const repoSpec = repoSpecOf(root);
    if (!repoSpec) {
      lines.push('remote ref: skipped — could not resolve owner/repo');
    } else {
      const result = ghApiDelete(
        [`repos/${repoSpec.owner}/${repoSpec.repo}/git/refs/heads/${branch}`],
        repoSpec.host,
      );
      if (result.ok) lines.push(`remote ref: deleted${result.alreadyGone ? ' (already gone)' : ''} refs/heads/${branch}`);
      else lines.push(`remote ref: skipped — ${result.error}`);
    }
  }

  return { lines };
}

module.exports = { teardownRun, branchOfWorktree, repoSpecOf, defaultGhApiDelete, describeGitFailure };
