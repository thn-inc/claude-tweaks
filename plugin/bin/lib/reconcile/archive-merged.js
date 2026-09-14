// bin/lib/reconcile/archive-merged.js — convergence check 4: archive run
// dirs whose PR has merged. Reuses `wrap-up/cleanup-procedures.md` Section
// B's mechanics (mark terminal, `git mv` the tracked `work/` subdirectory,
// plain `mv` the gitignored rest) rather than inventing a second archival
// path — cite it, don't restate its rationale. A merged PR whose console is
// rendered but unresolved is NOT archived: it still needs a human answer.
'use strict';
const fs = require('fs');
const path = require('path');
const { runGit } = require('../hooks/git-exec');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');
const { parseWorktreeList } = require('../hooks/worktree-reap');
const {
  iterRunDirsWithState, writeRunState, readRunState, RUN_ID_RE,
} = require('../hooks/context');
const { resolvePrState, resolvePrStateByNumber } = require('./pr-state');
const { recordResidueSuccess, trackResidue, pruneResidueFailures } = require('./cache');
const { escalateResidue } = require('./escalate-residue');
const { isWorktreeAlwaysOn } = require('../policy');
const { repoSlugOf } = require('./release-merged');
const { withIndexLockRetry } = require('../git-retry');
const { closeRunState } = require('../hooks/close-run-state');
const { checkRunIntegrity, fallbackBranch } = require('../hooks/run-integrity');

// Orphan case introduced by the dispatch/flow run-identity unification:
// dispatch mints an empty, anchored run directory (mkdir only, no
// config.yml) before claiming, then hands it to flow's first Task call as
// PIPELINE_RUN_DIR. If that call dies before flow ever adopts the directory
// (writes config.yml), the mint is orphaned — no worktree, no branch, no PR
// to resolve a state from, so the merged-PR criterion below can never catch
// it. 24h mirrors worktree-reap.js's ORPHAN_GRACE_MS: longer than any
// plausible pause before a retry picks the group back up, short enough that
// a genuinely abandoned mint is swept the next day.
const ORPHAN_MINT_TTL_MS = 24 * 60 * 60 * 1000;

// An ad-hoc-standalone dir (`{ts}-adhoc-standalone`, minted by
// post-tool-use.js's `stampAdHocRunDir` — see `run-dir-resolve.js`'s
// `standalone` branch) never gets a config.yml either (only /flow's
// Manifesto writes one), so without this exemption it reads as an
// "abandoned pre-Manifesto mint" under the mtime rule below the moment a
// real dev session goes untouched for >24h before wrap-up finally runs —
// silently destroying the friction record #500's Friction lens depends on
// (#1117). Unlike a genuine orphaned mint (mkdir-only, no worktree, no
// branch, no PR — see this file's top comment), an ad-hoc dir's
// run-state.json always carries a real `worktree`, so its correct lifecycle
// answer is the eventual-supersession path below (isAdHocStandaloneSuperseded),
// not this blind mtime heuristic: exempt it here, permanently, rather than
// giving it a longer TTL that just moves the same race further out.
//
// #1604: the suffix match alone is not sufficient corroboration — a
// malformed or mkdir-only dir sharing the suffix would also fall through
// isOrphanedMint (exempt) and decideArchive (no-worktree/no-branch skip),
// leaking the same way a genuine ad-hoc mint used to before this fix.
// Require the invariant the comment above actually asserts: a real
// run-state.json with a non-empty `worktree` field. A dir that merely
// carries the suffix without that is NOT treated as ad-hoc here — it falls
// through to the ordinary isOrphanedMint mtime sweep instead, same as any
// other malformed mint.
function isAdHocStandaloneMint(dir) {
  if (!path.basename(dir).endsWith('-adhoc-standalone')) return false;
  const state = readRunState(dir);
  return !!(state && typeof state.worktree === 'string' && state.worktree);
}

// #1604: the "swept once genuinely superseded" half of #1117's own design
// that never shipped. A genuine ad-hoc mint (isAdHocStandaloneMint already
// corroborated) whose recorded worktree no longer resolves in a fresh
// `git worktree list` — the session has definitively ended — is pure
// clutter once ADHOC_SUPERSEDED_TTL_MS has passed since the dir was last
// touched. A still-live one (worktree still registered) is NEVER swept here,
// regardless of age — that is #1117's own invariant, unchanged. Longer than
// ORPHAN_MINT_TTL_MS by two orders of magnitude: a torn-down worktree is
// unambiguous "session over" evidence (unlike a bare mtime heuristic on a
// never-adopted mint), so this window exists only to give wrap-up's own
// reflect pass (or a human) a wide margin to consume the friction record
// before this backstop claims it, not to guard against a false positive.
const ADHOC_SUPERSEDED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function isAdHocStandaloneSuperseded(dir, state, worktrees, now = Date.now()) {
  if (!isAdHocStandaloneMint(dir)) return false;
  if (!state || typeof state.worktree !== 'string' || !state.worktree) return false;
  const stillLive = worktrees.some((w) => path.resolve(w.path) === path.resolve(state.worktree));
  if (stillLive) return false;
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(dir).mtimeMs;
  } catch {
    return false;
  }
  return (now - mtimeMs) > ADHOC_SUPERSEDED_TTL_MS;
}

// #2227: a state-less run dir can still hold git-tracked content — a
// materialized work/{n}-spec.md whose run-state.json only ever existed in
// the worktree copy (record #1594's shape; materialize.md commits work/ on
// the branch, and it reaches the main checkout by merge with none of the
// gitignored state files alongside it). archiveOrphanedMint's bare
// fs.renameSync would leave that as an unstaged deletion nothing commits;
// archiveRunDir's git mv + commit is what tracked content needs, and it
// does not require run-state.json. `git ls-files -- <dir>` lists nothing
// for a genuinely untracked mint, which keeps that case on the fs-only path.
// Only a successful, empty listing proves "untracked". Any probe failure —
// indeterminate (timeout/spawn/no-git, git-exec.js's isIndeterminate) or a
// definitive git-error (a corrupt index, an unreadable object store) — is
// not that proof: assume tracked and let archiveRunDir refuse visibly (its
// own ls-files guard fails closed on any failure, `ls-files-failed`) rather
// than let this helper be the one place a failed probe quietly selects the
// bare fs rename.
function hasTrackedContent(root, dir) {
  const listed = runGit(['ls-files', '--', dir], root);
  if (listed.failure) return true;
  return (listed.stdout || '').length > 0;
}

// #2346: `runGit` (git-exec.js) never throws — it returns
// `{ stdout, failure, stderr }` — but `withIndexLockRetry` is shaped around a
// throwing, execFileSync-style runner (matching every other plugin commit
// call site it wraps). Adapt one direction into the other at this single
// call site rather than changing `runGit`'s own non-throwing contract (every
// other caller in this file, and in classify.js/archive-branches.js, depends
// on it never throwing): wrap `runGit` in a throwing shim for the retry
// helper, then unwrap the outcome back into `runGit`'s own return shape so
// the `commit.failure` check right below this function's one call site is
// unaffected either way.
function runGitCommitWithIndexLockRetry(args, cwd) {
  const throwingRunner = (a) => {
    const r = runGit(a, cwd);
    if (r.failure) {
      const err = new Error(r.stderr || `git ${a.join(' ')} failed (${r.failure})`);
      err.stderr = r.stderr;
      err.result = r;
      throw err;
    }
    return r;
  };
  try {
    return withIndexLockRetry(throwingRunner)(args);
  } catch (err) {
    return err.result || { stdout: null, failure: 'git-error', stderr: err.stderr || '' };
  }
}

// A minted run dir that never got adopted: no config.yml (flow's Manifesto
// is what writes it), not an ad-hoc-standalone mint (see above — that check
// now reads run-state.json for corroboration, #1604), and older than the
// grace window. No I/O beyond what answering the question requires.
function isOrphanedMint(dir, now = Date.now()) {
  if (fs.existsSync(path.join(dir, 'config.yml'))) return false;
  if (isAdHocStandaloneMint(dir)) return false;
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(dir).mtimeMs;
  } catch {
    return false;
  }
  return (now - mtimeMs) > ORPHAN_MINT_TTL_MS;
}

// An orphaned mint that reaches this function has nothing to git-mv and
// nothing to finalize as terminal (no run-state.json, since record-worktree
// never ran on it) — moving each top-level entry into its archive twin is
// the whole operation. A state-less dir that DOES carry tracked content (a
// materialized work/ spec) never gets here: archiveMerged's orphaned-mint
// branch routes it to archiveRunDir instead (#2227, hasTrackedContent above).
//
// Entry-by-entry, not a single whole-dir fs.renameSync: the archive twin can
// already exist and be non-empty by the time this runs — a prior attempt
// (this same orphaned-mint path, or an earlier archiveRunDir attempt that
// moved some content there before failing on a later step) can leave a
// partially-populated destination — and POSIX rename() of a whole directory
// onto an existing NON-empty directory throws ENOTEMPTY unconditionally,
// permanently wedging this run dir at move-failed (#1713, #1714). Mirrors
// the same entry-by-entry pattern archiveRunDir already uses for its own
// top-level and per-spec-dir loops, for the identical reason — see that
// function's "spec-{N}/ dirs are excluded here" comment above.
function archiveOrphanedMint(root, dir) {
  const runId = path.basename(dir);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  try {
    fs.mkdirSync(archiveDir, { recursive: true });
  } catch (err) {
    return { ok: false, reason: 'move-failed', lastError: err && err.message };
  }
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    return { ok: false, reason: 'move-failed', lastError: err && err.message };
  }
  const movedThisPass = [];
  for (const name of entries) {
    const src = path.join(dir, name);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(archiveDir, name);
    try {
      fs.renameSync(src, dest);
    } catch (err) {
      const fullyReverted = revertPlainMoves(movedThisPass);
      return {
        ok: false,
        reason: fullyReverted ? 'move-failed' : 'move-failed-partial-revert',
        lastError: err && err.message,
      };
    }
    movedThisPass.push([src, dest]);
  }
  try {
    fs.rmdirSync(dir);
  } catch {
    /* best-effort — non-empty for an unexpected reason (a late write racing
       this pass, the same class context.js's own late-write guard exists
       for), or already gone; a genuinely non-empty leftover is picked up
       again by the next pass's isOrphanedMint check. */
  }
  return { ok: true };
}

// Same 24h window as ORPHAN_MINT_TTL_MS, and for the same reason — longer than
// any plausible pause before a session resumes its own run, short enough that
// a genuinely abandoned one is swept the next day. Deliberately not a second,
// differently-tuned constant.
const STALE_INTERRUPTED_TTL_MS = ORPHAN_MINT_TTL_MS;

// Newest event this run can actually claim as its own, in ms — or null when
// there are none (or the log is unreadable).
//
// Deliberately NOT run-state's `updatedAt`, and deliberately excluding
// `attribution: 'fallback'` lines: a fallback event is one ANOTHER session's
// hook guessed into this run because the run had no provable owner
// (context.js's resolveRun). Those lines advance `updatedAt` without this run
// being alive at all, which is precisely how an abandoned run looks
// perpetually busy and never becomes closeable (#1673 Deliverable 4).
//
// Deliberately asymmetric with context.js's `scanWrapupEvents` (read by
// `checkRunIntegrity`), which does NOT filter fallback-attributed lines: a
// run whose events.jsonl holds ONLY fallback-attributed lines can therefore
// read as both "abandoned" here (no self-attributed activity) AND "shipped"
// there (>=1 skill_invoked still counts, fallback or not). That combination
// is coherent and intended, not a bug to reconcile: the work shipped, and
// nothing THIS run itself produced has touched it since — a future reader
// should not "fix" the two filters into agreement.
function lastOwnEventMs(runDir) {
  let raw;
  try { raw = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8'); } catch { return null; }
  let newest = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!ev || ev.attribution === 'fallback') continue;
    const t = Date.parse(ev.ts);
    if (Number.isNaN(t)) continue;
    if (newest === null || t > newest) newest = t;
  }
  return newest;
}

// Whether runDir's events.jsonl exists and is readable at all — distinct
// from `lastOwnEventMs`'s own `null`, which conflates two different things:
// "the log is readable but has no qualifying (non-fallback, parseable-ts)
// event" and "the log couldn't be read in the first place." Only the caller
// below needs to tell those apart (#1673 F9 review finding): a genuinely
// unreadable/absent log is UNKNOWN evidence, not proof of staleness.
function hasReadableEventsLog(runDir) {
  try {
    fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
    return true;
  } catch {
    return false;
  }
}

// The ownership half of the criterion, inverted from close-run-state.js's
// `foreignOwner`: that check asks "does a DIFFERENT session own this?" to
// refuse a close; here the same comparison answers "is this session's own
// run?" — if it is, we are that session and the run is by definition alive, so
// never auto-close it. A run owned by nobody, or by some other session, is a
// candidate only if it ALSO shows no self-attributed activity inside the
// staleness window. Both halves must hold; neither alone is evidence.
//
// Honest scope of this ownership half: it only ever engages when BOTH
// `state.sessionId` and `sessionId` are non-null. `sessionId` is reliably
// present when this runs off the Bash-invoked `reconcile` subcommand (the
// calling shell's own `CLAUDE_CODE_SESSION_ID` — see the module default
// below), but is `null` in the path that actually matters most: the
// SessionStart-triggered background pass (`reconcile-background`, a detached
// child process spawned with no stdin), where no session id is ever threaded
// in. There, this half of the criterion never fires — it is not "the"
// protection, it is an ADDITIONAL guard that only engages when a session id
// happens to be known. The substantive protection for every caller, known
// session id or not, is the two checks below: the 24h staleness window
// (`STALE_INTERRUPTED_TTL_MS`) and, at the call site, the `shipped-unclosed`
// evidence gate from `checkRunIntegrity`.
function isAbandonedInterrupted(runDir, state, sessionId, now = Date.now()) {
  if (!state || state.status !== 'interrupted') return false;
  const owner = typeof state.sessionId === 'string' && state.sessionId ? state.sessionId : null;
  if (owner && sessionId && owner === sessionId) return false; // our own live run
  // An unreadable/absent events.jsonl is UNKNOWN evidence of activity, not
  // proof of staleness — fail toward not-abandoned rather than collapsing
  // "we can't tell" into "definitely idle" (review finding: `checkRunIntegrity`
  // happens to also require a readable log with >=1 skill_invoked before this
  // branch is ever reached, but that is a coincidence of two separate reads
  // at different moments, not a guarantee this function can rely on alone).
  if (!hasReadableEventsLog(runDir)) return false;
  const last = lastOwnEventMs(runDir);
  if (last !== null && (now - last) <= STALE_INTERRUPTED_TTL_MS) return false;
  return true;
}

// A run's PR state + its console state -> what to do. Pure — no I/O.
//   { action: 'archive' } | { action: 'skip', reason }
function decideArchive(prState, consoleState) {
  if (prState === 'gh-absent') return { action: 'skip', reason: 'gh-absent' };
  if (prState === 'network-failure') return { action: 'skip', reason: 'network-failure' };
  if (!prState) return { action: 'skip', reason: 'no-pr' };
  if (prState.state !== 'MERGED') {
    return { action: 'skip', reason: prState.state === 'OPEN' ? 'pr-open' : 'pr-closed-unmerged' };
  }
  if (consoleState === 'unresolved') return { action: 'skip', reason: 'console-unresolved' };
  // #1130: this sweep's population is non-terminal runs only
  // (iterRunDirsWithState skips status:'clean'), so an absent console.json
  // here always means wrap-up never rendered a console for this run — never
  // the empty-console fast path, which closes the run terminal and archives
  // via the archive-run verb without ever reaching this sweep. Archiving on
  // mere PR-merge swept live runs with pending staged decisions (#657).
  if (consoleState === 'none') return { action: 'skip', reason: 'console-never-rendered' };
  return { action: 'archive' };
}

// 'unresolved' | 'resolved' | 'none' (no console.json rendered — #1130:
// blocks this sweep's archival; the empty-console fast path archives via the
// archive-run verb instead). 'resolved' fires on `resolved === true` OR a
// non-empty (post-trim) string `executedAt` — the documented write order
// (`_shared/console-execution.md`) now sets both in the final console.json
// write, but consoles written before that change carry `executedAt` alone,
// so either counts. console-execute.js's preFetchSkipReason applies the
// same acceptance rule — keep the two readers agreeing, or an executed
// console classifies 'resolved' here while re-detecting as `ready` there.
function readConsoleState(runDir) {
  let raw;
  try { raw = fs.readFileSync(path.join(runDir, 'console.json'), 'utf8'); } catch { return 'none'; }
  try {
    const parsed = JSON.parse(raw);
    const resolved = parsed && (parsed.resolved === true
      || (typeof parsed.executedAt === 'string' && parsed.executedAt.trim().length > 0));
    return resolved ? 'resolved' : 'unresolved';
  } catch {
    return 'unresolved'; // unparseable console state fails closed — never silently archived
  }
}

// #1130: gh's MERGED state is a remote fact; the local main checkout may not
// have fast-forwarded to include the merge commit yet. The run dir's tracked
// work/ subtree only reaches the main checkout via that merge, so archiving
// early moves only the gitignored half and strands work/ (the #657 symptom).
// true = merge commit is in local history; false = definitively not (safe to
// retry next pass); null = oid unavailable/malformed — treated by the caller
// as not-yet-verifiable, same skip-and-retry.
function localHasMerge(root, mergeCommit) {
  const oid = mergeCommit && typeof mergeCommit.oid === 'string' && /^[0-9a-f]{40}$/.test(mergeCommit.oid)
    ? mergeCommit.oid : null;
  if (!oid) return null;
  const r = runGit(['merge-base', '--is-ancestor', oid, 'HEAD'], root);
  return !r.failure;
}

// Moves-first, close-last ordering (the reverse of cleanup-procedures.md
// Section B's own step numbering, which assumes a single successful pass
// with no partial-failure recovery need). Marking the run terminal BEFORE
// the moves succeed would make a failed move permanently invisible: this
// module's caller (iterRunDirsWithState) skips any run already `status:
// 'clean'`, so a failure between "mark terminal" and "actually move the
// files" would never be retried. Doing the moves first means a genuine
// failure leaves the run non-terminal and picked up again next pass; the
// fs.existsSync guards below make a retry over an already-partially-moved
// run dir a safe no-op on whatever already succeeded.
// Multi-spec parent run dirs (`multispec-run-dir-layout.md`'s Run directory
// layout) nest one `spec-{N}/` subdirectory per record, each carrying its own
// git-tracked `work/{N}-spec.md` plus its own gitignored
// config.yml/decisions.md/staged/ (`multispec-run-dir-layout.md`: "Each
// spec-{N}/ carries its own config.yml"). A
// single-spec run dir has none of these. Returns [] (not an error) when
// runDir is unreadable — the top-level work/ move below still runs.
function listSpecDirs(runDir) {
  try {
    return fs.readdirSync(runDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('spec-'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// #652: `git mv` physically moves the files and stages the rename before the
// commit runs, so a commit failure (gpgsign requirement, a failing
// pre-commit/commit-msg hook, a lock file, a worktree-always-style policy
// gate) would otherwise strand a staged, uncommitted rename in the shared main
// checkout indefinitely — archiveRunDir's `fs.existsSync` retry guards can
// never fire again once the old path is gone, so no later pass would clean it
// up. Undoing the rename in the index AND on disk leaves the tree exactly as
// this pass found it and restores what those guards look for. Best-effort and
// never throws: a revert failure must still degrade to the caller's reported
// skip, not an unhandled exception (this runs from SessionStart with no
// supervising human). Returns true only when every pair ended back at its
// original path in both index and disk; false means the tree is left partially
// moved, which the caller reports as a distinct reason.
function revertWorkMoves(root, workMoves) {
  let fullyReverted = true;
  for (const [src, dest] of workMoves) {
    const reset = runGit(['reset', '--', src, dest], root);
    if (reset.failure) {
      // The index still matches what `git mv` staged (src removed, dest
      // added) — leave the file where `git mv` physically put it too, so
      // disk and index stay mutually consistent (still in the "moved"
      // state, same as the pre-revert bug). Moving it back here would
      // desync disk from an index entry that was never actually unstaged —
      // a worse state than doing nothing, since `git status` would then
      // show a staged addition with no file behind it. The same lock/hook
      // cause that can fail the commit can plausibly also fail this reset.
      fullyReverted = false;
      continue;
    }
    try {
      fs.renameSync(dest, src);
    } catch {
      /* best-effort — the tree may stay partially dirty */
      fullyReverted = false;
    }
  }
  return fullyReverted;
}

// Review finding: the two plain fs.renameSync loops below (gitignored
// content — no git index involved, so revertWorkMoves' git-reset step
// doesn't apply) had no revert-on-failure, unlike the git-tracked workMoves
// loop above — the same partial-move hazard #1103 fixed for `git mv` was
// still reachable here. Best-effort and never throws, matching
// revertWorkMoves' contract; the failed entry itself is never included in
// movedPairs, same reasoning as revertWorkMoves' own failed-pair handling.
function revertPlainMoves(movedPairs) {
  let fullyReverted = true;
  for (const [src, dest] of movedPairs) {
    try {
      fs.renameSync(dest, src);
    } catch {
      fullyReverted = false;
    }
  }
  return fullyReverted;
}

// True only when `targetPath` is a tracked file in `root`'s index right now,
// or — when it names a directory — every file it recursively contains is
// tracked. `git ls-files --error-unmatch` alone is not sufficient for a
// directory: it treats the argument as a pathspec and exits 0 as soon as ONE
// contained file matches the index, even when a sibling file underneath is
// genuinely untracked (empirically verified). A caller about to `git mv` a
// whole directory (the `topStaged` case below) needs "fully tracked," not
// "partially tracked" — so a second check confirms no untracked file exists
// anywhere under targetPath.
function isTracked(root, targetPath) {
  const check = runGit(['ls-files', '--error-unmatch', targetPath], root);
  if (check.failure) return false;
  const untracked = runGit(['ls-files', '--others', '--exclude-standard', targetPath], root);
  return !untracked.failure && !untracked.stdout;
}

// #1892: a whole-dir `git mv` onto an already-existing, non-empty
// destination is not idempotent (the same ENOTEMPTY class #1713/#1714 fixed
// one level up, for the plain-fs-rename loops) — a `work/` archive twin can
// already exist by the time this runs: a prior partial archival attempt, or
// a merged worktree PR that completed the tracked-header move directly
// (see this file's header comment and #1892's own Gotchas). Every file
// under `dir` (recursively — `work/` normally holds exactly one
// `{n}-spec.md`, but this generalizes rather than assuming that), relative
// paths only. Empty for an unreadable/missing dir — never throws.
function listFilesRecursive(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  let out = [];
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      out = out.concat(listFilesRecursive(abs).map((rel) => path.join(e.name, rel)));
    } else if (e.isFile()) {
      out.push(e.name);
    }
  }
  return out;
}

// `git hash-object` computes a file's blob sha regardless of whether either
// copy is tracked (unlike `git diff`, which needs both sides in the index or
// working tree in a comparable way) — the comparison the twin-resolution
// logic below needs to tell "identical content, safe to dedupe" from
// "genuinely diverged, refuse rather than guess" (the Technical Approach's
// own choice of tool). Null on any failure (unreadable file, no git) — a
// caller treats null as "not provably identical," never as a match.
function fileHashObject(root, filePath) {
  const r = runGit(['hash-object', filePath], root);
  if (r.failure) return null;
  const hash = (r.stdout || '').trim();
  return hash || null;
}

// Compares every file under `srcDir` against its counterpart under
// `destDir` (the archive twin). A file missing at the twin path counts as
// differing — it still needs to actually move, not merely be discarded — as
// does a hash-object failure on either side (fail toward "not identical"
// rather than silently treating an unreadable file as a safe dedupe).
// -> { identical: boolean, differing: string[] } (relative paths).
function compareWorkTwin(root, srcDir, destDir) {
  const differing = [];
  for (const rel of listFilesRecursive(srcDir)) {
    const srcFile = path.join(srcDir, rel);
    const destFile = path.join(destDir, rel);
    if (!fs.existsSync(destFile)) { differing.push(rel); continue; }
    const srcHash = fileHashObject(root, srcFile);
    const destHash = fileHashObject(root, destFile);
    if (!srcHash || !destHash || srcHash !== destHash) differing.push(rel);
  }
  return { identical: differing.length === 0, differing };
}

// Resolves an ALREADY-CONFIRMED-identical work twin: the archive copy holds
// the same content, so the live copy is redundant and is removed through git
// (never a plain fs delete) so history stays intact. `git rm` when the
// twin's own copy is already tracked at its path — the ordinary case, since
// every prior archival commits `work/` at the archive path via `git mv` —
// `git mv -f` onto the twin path when the twin copy is untracked (content
// matches, but nothing has staged it there yet). Every resolved file is
// recorded in `resolved` (oldest-first) so a later failure in this same
// batch can be undone via `revertStagedOps` below.
// -> { ok: true, resolved: [{kind, srcFile, destFile}] } |
//    { ok: false, reason, lastError, resolved (partial) }
function resolveIdenticalWorkTwin(root, srcDir, destDir) {
  const resolved = [];
  for (const rel of listFilesRecursive(srcDir)) {
    const srcFile = path.join(srcDir, rel);
    const destFile = path.join(destDir, rel);
    if (isTracked(root, destFile)) {
      const rm = runGit(['rm', '-q', '--', srcFile], root);
      if (rm.failure) return { ok: false, reason: 'work-twin-resolve-failed', lastError: rm.stderr, resolved };
      resolved.push({ kind: 'twin-rm', srcFile, destFile });
    } else {
      const mv = runGit(['mv', '-f', srcFile, destFile], root);
      if (mv.failure) return { ok: false, reason: 'work-twin-resolve-failed', lastError: mv.stderr, resolved };
      resolved.push({ kind: 'twin-mv', srcFile, destFile });
    }
  }
  return { ok: true, resolved };
}

// One combined undo stack for every git operation `archiveRunDir` stages
// before its single closing commit — plain `git mv` pairs (`kind: 'mv'`,
// `revertWorkMoves`' own pair shape) alongside the per-file twin resolutions
// above (`twin-rm`/`twin-mv`) — so a failure anywhere in the batch (a later
// pair's `git mv`, or the commit itself) can undo everything already staged
// as one LIFO unit, not just the sub-batch that happened to fail. Best-effort
// and never throws, matching every other revert helper in this file; returns
// whether every operation in `ops` ended back at its original state.
function revertStagedOps(root, ops) {
  let fullyReverted = true;
  for (const op of [...ops].reverse()) {
    if (op.kind === 'mv') {
      if (!revertWorkMoves(root, [[op.src, op.dest]])) fullyReverted = false;
    } else if (op.kind === 'twin-rm') {
      // `git rm` only staged the removal (nothing committed yet) — checking
      // out HEAD's copy restores both the index entry and the working file.
      const co = runGit(['checkout', 'HEAD', '--', op.srcFile], root);
      if (co.failure) fullyReverted = false;
    } else if (op.kind === 'twin-mv') {
      const reset = runGit(['reset', '--', op.srcFile, op.destFile], root);
      if (reset.failure) { fullyReverted = false; continue; }
      try {
        // Pre-op, srcFile and destFile were two independent physical files
        // (identical content, but the twin's copy at destFile already
        // existed on disk before this batch touched anything — that's what
        // made it a twin). `git mv -f` is a single rename: only one physical
        // file survives the forward operation, at destFile. Reverting with
        // a rename back to srcFile would silently delete that pre-existing
        // destFile copy — a `copyFileSync` restores srcFile while leaving
        // destFile exactly as it was before this op, matching the real
        // pre-op state (both files present).
        fs.mkdirSync(path.dirname(op.srcFile), { recursive: true });
        fs.copyFileSync(op.destFile, op.srcFile);
      } catch {
        fullyReverted = false;
      }
    }
  }
  return fullyReverted;
}

// #1892 Deliverable 2: the split state itself — a run dir whose gitignored
// half already archived (a prior pass, or a merged worktree PR that
// completed that half) while its git-tracked `work/` headers are still live.
// The ordinary decideArchive path never reaches this case: no run-state.json
// survives at the live path once the gitignored half moved, so there is
// nothing to resolve a branch/PR from. Detected whenever the archive twin
// exists AND every entry still live under `dir` is a git-tracked `work/` (or
// `spec-{n}/work/`) path — nothing gitignored remains. Sits beside
// `isOrphanedMint` — same "answer a narrow structural question, no I/O
// beyond what answering it requires" shape.
function isArchivedPendingTrackedMove(root, dir) {
  const runId = path.basename(dir);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  if (!fs.existsSync(archiveDir)) return false;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return false;
  }
  if (entries.length === 0) return false;
  const specDirs = listSpecDirs(dir);
  return entries.every((name) => {
    if (name === 'work') return true;
    if (!specDirs.includes(name)) return false;
    let subEntries;
    try {
      subEntries = fs.readdirSync(path.join(dir, name));
    } catch {
      return false;
    }
    return subEntries.length > 0 && subEntries.every((n) => n === 'work');
  });
}

// The paste-ready command a human (or a worktree/PR-driven follow-up) runs
// to complete a split-state archival that this sweep declined to do
// in-process (`worktree-always: true` — see the skip site's own comment for
// why). `bin/hooks.js archive-run --run <dir>` is the existing, documented
// direct-archival verb (hooks.js's own `archive-run` handler already
// supports running from inside a worktree whose tracked content has since
// merged to the main checkout) — reused here rather than inventing a second
// completion path.
function archivedPendingTrackedMoveCommand(dir) {
  return `node "\${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" archive-run --run "${dir}"`;
}

function archiveRunDir(root, runDir) {
  const runId = path.basename(runDir);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  try {
    fs.mkdirSync(archiveDir, { recursive: true });
  } catch {
    return { ok: false, reason: 'mkdir-failed' };
  }
  // #1103 follow-up: mkdirSync above is the earliest point a second,
  // concurrent, UNLOCKED `reconcile` invocation (dispatch/tidy's own
  // pre-step, not `reconcile-background`, which holds a lock) could pick the
  // same run dir before this call finishes moving anything. The removed
  // existence-only check (see context.js's comment on the same #1103) used
  // to make that window near-zero; this interim, content-aware, TTL-bounded
  // claim restores that protection without reintroducing the
  // permanently-stranded-on-failure bug the existence-only check caused —
  // context.js's staleness check lets a crashed/failed attempt's claim
  // expire instead of blocking every future archival of this run forever.
  writeRunState(archiveDir, { status: 'archiving', worktree: null });

  // Collects the actual set of entries this call moves, in move order — so
  // a caller reporting what happened (e.g. hooks.js archive-run's "moved:"
  // lines) reads it from here rather than re-deriving or hardcoding its own
  // guess at the run dir's shape, which is the exact fixed-list drift this
  // function's own enumeration swap (above) exists to eliminate.
  const movedEntries = [];

  const specDirs = listSpecDirs(runDir);

  // Every git-tracked work/ subtree — the top-level one (single-spec
  // layout) and one per spec-{N}/ subdirectory (multi-spec parent layout,
  // #593) — moves via `git mv` in one batch, then one commit covers all of
  // them. `work/` is deliberately git-tracked (materialize.md, "committed
  // as audit trail, never gitignored") while the archive path itself is
  // gitignored, so a plain mv + git add would register as a deletion; a
  // multi-spec parent whose spec-{N}/work/ subtrees were previously left
  // out of this move is exactly the bug this fixes — they used to survive
  // untouched at the pre-archive path and resurrect on the next checkout,
  // same mechanism as the top-level case the rest of this function already
  // handled.
  const workMoves = [];
  // #1892: entries whose destination already exists (a pre-existing archive
  // twin) never join `workMoves` — a whole-dir `git mv` onto a non-empty
  // destination is not idempotent. Each is instead diffed via
  // `compareWorkTwin`: identical content queues here for per-file
  // `git rm`/`git mv -f` resolution below; a genuine content difference
  // aborts the whole archival immediately (`work-twin-conflict`, moves
  // nothing) rather than guessing which copy is canonical.
  const twinPlan = [];
  // #1323: `runDir` can itself already equal its own `archiveDir` (a caller
  // — e.g. teardown-run's AC7 — passing an already-archived path as `runDir`
  // directly, where `path.basename` round-trips to the same archive twin).
  // `topWork === topWorkDest` there, and comparing a directory against
  // itself trivially reads "identical," which would route straight into
  // `resolveIdenticalWorkTwin`'s `git rm` — destroying the only copy. Twin
  // detection only applies when the destination is a genuinely different,
  // pre-existing path; the same-path case falls through to the ordinary
  // `workMoves` `git mv`, which git itself refuses ("can not move directory
  // into itself") — the pre-existing, correct behavior for that case.
  const topWork = path.join(runDir, 'work');
  if (fs.existsSync(topWork)) {
    const topWorkDest = path.join(archiveDir, 'work');
    if (path.resolve(topWork) !== path.resolve(topWorkDest) && fs.existsSync(topWorkDest)) {
      const twin = compareWorkTwin(root, topWork, topWorkDest);
      if (!twin.identical) {
        return {
          ok: false,
          reason: 'work-twin-conflict',
          conflict: { src: topWork, dest: topWorkDest, differing: twin.differing },
        };
      }
      twinPlan.push([topWork, topWorkDest]);
    } else {
      workMoves.push([topWork, topWorkDest]);
    }
  }
  // #1493/#1494: a `*-tidy-standalone*` (or, since sweep's shared run dir,
  // `*-sweep-standalone*` — sweep's Step 1 runs tidy inside it) run dir's own
  // audit files (SKILL.md's pr-first Step 7.5 addition, `.gitignore`'s
  // matching carve-out) are git-tracked the same way `work/` always has
  // been — never spec-{N}/-nested (neither shape is ever a multi-spec
  // parent), so this joins the top-level `workMoves` batch only, not the
  // per-spec loop below. Without this, the tracked-entry guard a few lines
  // down would refuse to archive every tidy-standalone/sweep-standalone run
  // forever, since it treats any tracked path outside `work/` as the #593
  // corruption hazard. Folding these into the same `git mv` + single-commit
  // batch as `work/` means the guard never even sees them (they're already
  // moved out of `runDir` by the time it runs) — a genuinely stray tracked
  // file elsewhere in the run dir still refuses exactly as before.
  // #1493/#1494's own comment above documents the assumption this block
  // relies on ("git-tracked the same way work/ always has been") — but
  // unlike work/, which materialize.md guarantees is tracked before archival
  // is ever attempted, a standalone run's decisions.md/report.md/staged only
  // becomes tracked once its worktree copy (SKILL.md's pr-first Step 7.5)
  // has merged AND this checkout has pulled that merge. Between "exists on
  // disk" and "tracked here," there is a real, documented window
  // ("$RUN_ROOT's copies stay authoritative until merge lands the trail on
  // the integration branch" — SKILL.md) where these files are genuinely
  // untracked. `git mv` on an untracked source fails outright (`fatal: not
  // under version control` — verified directly, not assumed), so treating
  // "exists" as "safe to git mv" here — as the code did before this guard —
  // reliably hits that failure, and the failure+revert path two `git mv`
  // calls above shares with `work/` was never built for a source that was
  // never staged in the first place: a later, unrelated `git clean` sweeping
  // the working tree can permanently lose an untracked file sitting wherever
  // that revert left it. Never git-mv an untracked audit file — check first.
  const untrackedAuditFiles = [];
  if (/-(tidy|sweep)-standalone/.test(runId)) {
    // 'staged' folded into the same iterated list as the two audit files —
    // the join/isTracked/push-or-flag logic is identical regardless of
    // whether the entry names a file or (staged's case) a directory.
    for (const auditFile of ['decisions.md', 'report.md', 'staged']) {
      const src = path.join(runDir, auditFile);
      if (!fs.existsSync(src)) continue;
      if (isTracked(root, src)) workMoves.push([src, path.join(archiveDir, auditFile)]);
      else untrackedAuditFiles.push(auditFile);
    }
  }
  // Refuse the whole archival rather than proceeding with a partial batch —
  // moving `work/`/events.jsonl/run-state.json while leaving decisions.md
  // behind, still at its original (soon-to-be-archived) directory, is a
  // confusing half-migrated state with no clean recovery path. The operator
  // action is unambiguous and self-resolving: sync this checkout with
  // origin (the merge that tracks these files may already be sitting there
  // unpulled — exactly what happened in practice, #1494's follow-up), or
  // recognize the content never made it into any commit and needs re-filing.
  if (untrackedAuditFiles.length) {
    return { ok: false, reason: 'audit-untracked', untrackedAuditFiles };
  }
  for (const specName of specDirs) {
    const specWork = path.join(runDir, specName, 'work');
    if (!fs.existsSync(specWork)) continue;
    const specArchiveDir = path.join(archiveDir, specName);
    try {
      fs.mkdirSync(specArchiveDir, { recursive: true });
    } catch {
      return { ok: false, reason: 'mkdir-failed' };
    }
    const specWorkDest = path.join(specArchiveDir, 'work');
    // #1323: same same-path guard as topWork above.
    if (path.resolve(specWork) !== path.resolve(specWorkDest) && fs.existsSync(specWorkDest)) {
      const twin = compareWorkTwin(root, specWork, specWorkDest);
      if (!twin.identical) {
        return {
          ok: false,
          reason: 'work-twin-conflict',
          conflict: { src: specWork, dest: specWorkDest, differing: twin.differing },
        };
      }
      twinPlan.push([specWork, specWorkDest]);
    } else {
      workMoves.push([specWork, specWorkDest]);
    }
  }
  if (workMoves.length || twinPlan.length) {
    // One combined undo unit for everything staged below (twin resolutions
    // AND plain `git mv` pairs) — a failure on e.g. the 2nd of 3 `git mv`
    // pairs, or the closing commit itself, reverts every op already staged
    // in this pass, oldest-last (revertStagedOps' own LIFO order), never
    // just the sub-batch that happened to fail.
    const stagedOps = [];
    for (const [src, dest] of twinPlan) {
      const result = resolveIdenticalWorkTwin(root, src, dest);
      stagedOps.push(...result.resolved);
      if (!result.ok) {
        const fullyReverted = revertStagedOps(root, stagedOps);
        return {
          ok: false,
          reason: fullyReverted ? result.reason : 'work-twin-resolve-failed-partial-revert',
          lastError: result.lastError,
        };
      }
      // `resolveIdenticalWorkTwin` already removed every file under `src`
      // (via `git rm`/`git mv -f`) — the directory itself is not a git
      // object, so it's just an empty leftover on disk now.
      try { fs.rmdirSync(src); } catch { /* best-effort — non-empty for an unexpected reason, or already gone */ }
      movedEntries.push(path.relative(runDir, src));
    }
    // Pairs that succeeded before a later pair's `git mv` fails mid-loop —
    // recorded in the same `stagedOps` unit as the twin resolutions above
    // (assumed not mutated on a mid-operation failure — `git mv` renames on
    // disk before it writes the index, so a failure partway through its own
    // operation could in principle leave the file physically moved with the
    // index untouched; treated as "not moved" rather than attempting a
    // revert against an unknown partial state). Same partial-revert
    // reasoning as the commit-failure branch below, applied one loop
    // iteration earlier.
    for (const [src, dest] of workMoves) {
      const mv = runGit(['mv', src, dest], root);
      if (mv.failure) {
        const fullyReverted = revertStagedOps(root, stagedOps);
        return { ok: false, reason: fullyReverted ? 'git-mv-failed' : 'git-mv-failed-partial-revert' };
      }
      stagedOps.push({ kind: 'mv', src, dest });
      movedEntries.push(path.relative(runDir, src));
    }
    // The git mv/rm above only stage the change — this check runs headlessly
    // (SessionStart, dispatch's queue pull) with no interactive session
    // guaranteed to commit anything afterward, so an uncommitted change
    // would otherwise sit in the shared main checkout's index indefinitely.
    // #2241: scoped to exactly the paths this call staged (every workMoves
    // src/dest pair — the work/ rename(s) plus, on a tidy/sweep-standalone
    // run, the audit files folded into the same batch above) via a `--`
    // pathspec, so `git commit` picks only those changes out of the index
    // rather than sweeping whatever else a human or sibling session happens
    // to have staged in this shared main checkout at the same moment.
    const commitPaths = workMoves.flatMap(([src, dest]) => [src, dest]);
    // #2346: bounded-retry a transient index.lock collision (a sibling
    // agent's git call, or a PostToolUse hook, in the same checkout) rather
    // than hard-failing this archive pass on it.
    const commit = runGitCommitWithIndexLockRetry(['commit', '-m', `[reconcile] archive run ${runId}`, '--', ...commitPaths], root);
    if (commit.failure) {
      // A partial revert (some ops' `git reset`/`git checkout` or disk move
      // failed) is a distinct outcome from a clean one: the retry guard
      // below keys on `fs.existsSync(workSrc)`, which only sees a pair again
      // once it's genuinely back at its original path.
      // `commit-failed-partial-revert` makes that distinction visible to
      // callers/logs rather than collapsing both into the same reason
      // string.
      const fullyReverted = revertStagedOps(root, stagedOps);
      return { ok: false, reason: fullyReverted ? 'commit-failed' : 'commit-failed-partial-revert' };
    }
  }

  // Tracked-entry guard: a git-tracked file in the run dir outside work/
  // would otherwise be silently fs.renameSync'd (moved, not `git mv`'d) —
  // the tracked blob would still point at the OLD path, corrupting history.
  // #593 documents this class. work/ itself is already git-mv'd above — and,
  // for a `*-tidy-standalone*` run, so are `decisions.md`/`report.md`/`staged/`
  // (the workMoves batch above), so `git ls-files runDir` no longer finds them
  // here and this guard never sees them. Any OTHER tracked path — a stray
  // tracked file this function doesn't know how to move, on either a
  // tidy-standalone run or any other — still refuses exactly as before.
  if (fs.existsSync(runDir)) {
    const lsFiles = runGit(['ls-files', runDir], root);
    if (lsFiles.failure) return { ok: false, reason: 'ls-files-failed' };
    const trackedOutsideWork = (lsFiles.stdout || '')
      .split('\n')
      .filter(Boolean)
      .map((p) => path.relative(runDir, path.join(root, p)))
      .filter((rel) => rel && !rel.startsWith('work' + path.sep) && rel !== 'work');
    if (trackedOutsideWork.length > 0) {
      return { ok: false, reason: 'tracked-entry' };
    }

    // TOCTOU: runDir could be deleted between the fs.existsSync(runDir) guard
    // above and this read (review finding #902) — readdirSync would
    // otherwise throw uncaught, propagating past every caller's own
    // {ok, reason} contract (hooks.js's archive-run verb has no catch of
    // its own around this call).
    let entries;
    try {
      entries = fs.readdirSync(runDir);
    } catch {
      return { ok: false, reason: 'readdir-failed' };
    }
    // spec-{N}/ dirs are excluded here — their archive twins may already
    // exist (created by the workMoves batch above), so a whole-dir rename
    // would fail ENOTEMPTY; their contents move entry-by-entry in the
    // dedicated spec loop below instead.
    const movedThisPass = [];
    for (const name of entries.filter((n) => n !== 'work' && !specDirs.includes(n))) {
      const src = path.join(runDir, name);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(archiveDir, name);
      try {
        fs.renameSync(src, dest);
      } catch (err) {
        const fullyReverted = revertPlainMoves(movedThisPass);
        return {
          ok: false,
          reason: fullyReverted ? 'move-failed' : 'move-failed-partial-revert',
          lastError: err && err.message,
        };
      }
      movedThisPass.push([src, dest]);
      movedEntries.push(name);
    }
  }

  // Each spec-{N}/ subdirectory's own gitignored content moves the same
  // way, into its archive twin created above — then the now-empty
  // spec-{N}/ itself is removed, mirroring the top-level cleanup below.
  for (const specName of specDirs) {
    const specDir = path.join(runDir, specName);
    const specArchiveDir = path.join(archiveDir, specName);
    // Enumerated, never a fixed list — the same #662/#902 drift class the
    // top-level loop above eliminated: a fixed list here would strand any
    // spec-level file outside it (e.g. engine-state.json), leaving specDir
    // non-empty so the rmdir below silently fails and the half-archived
    // spec dir resurfaces forever. work/ is already git-mv'd above.
    if (!fs.existsSync(specDir)) continue;
    let specEntries;
    try {
      specEntries = fs.readdirSync(specDir);
    } catch {
      return { ok: false, reason: 'readdir-failed' };
    }
    const specRemaining = specEntries.filter((n) => n !== 'work');
    if (specRemaining.length) {
      // Created once per spec dir rather than once per entry — recursive
      // mkdirSync is idempotent either way, so this only drops redundant
      // syscalls, and only runs at all when there's something to move here
      // (it may already exist from the workMoves batch above).
      try {
        fs.mkdirSync(specArchiveDir, { recursive: true });
      } catch (err) {
        return { ok: false, reason: 'move-failed', lastError: err && err.message };
      }
    }
    const specMovedThisPass = [];
    for (const name of specRemaining) {
      const src = path.join(specDir, name);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(specArchiveDir, name);
      try {
        fs.renameSync(src, dest);
      } catch (err) {
        const fullyReverted = revertPlainMoves(specMovedThisPass);
        return {
          ok: false,
          reason: fullyReverted ? 'move-failed' : 'move-failed-partial-revert',
          lastError: err && err.message,
        };
      }
      specMovedThisPass.push([src, dest]);
      movedEntries.push(path.join(specName, name));
    }
    try {
      fs.rmdirSync(specDir);
    } catch {
      /* best-effort — non-empty for an unexpected reason, or already gone */
    }
  }

  // run-state.json moved above, so finalize the terminal state at its new
  // (archived) location, not the original runDir — writeRunState reads and
  // preserves whatever state already moved there.
  const result = writeRunState(archiveDir, { status: 'clean', worktree: null });
  if (!result) return { ok: false, reason: 'close-failed' };

  // Late-write guard (#990 — reproduced live during #893's own wrap-up even
  // with #902's dynamic enumeration already in place): the top-level
  // readdirSync above (and each spec dir's own readdirSync in the loop
  // above) is a one-time snapshot. A write landing in the run dir after that
  // snapshot but before the rmdirSync below — e.g. `wrap-up-engine.js
  // record`'s write to engine-state.json outrunning this call in some
  // multi-process ordering — is invisible to the entries this function has
  // already iterated, so it would otherwise sit unmoved and defeat the
  // rmdirSync (ENOTEMPTY, swallowed by the best-effort catch below),
  // orphaning it in the live run dir forever. Re-snapshot immediately before
  // the removal attempt and sweep any straggler that appeared in the gap —
  // gitignored content only, the same renameSync the top-level loop above
  // uses (the tracked-entry guard above already refused a git-tracked
  // stray, so nothing reaching this point is git-tracked).
  if (fs.existsSync(runDir)) {
    let stragglers;
    try {
      stragglers = fs.readdirSync(runDir);
    } catch {
      stragglers = [];
    }
    for (const name of stragglers) {
      const src = path.join(runDir, name);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(archiveDir, name);
      try {
        fs.renameSync(src, dest);
        movedEntries.push(name);
      } catch {
        /* best-effort — leave it on disk for the next archival pass to
           retry rather than fail this whole call over a residual
           straggler; the rmdirSync below naturally stays a no-op then. */
      }
    }
  }

  // runDir is empty now (everything moved out) — remove it so a future
  // iterRunDirsWithState pass doesn't re-yield a directory with no
  // run-state.json to read (readRunState returns null there, which is NOT
  // status: 'clean' and would otherwise resurface this run forever).
  try {
    fs.rmdirSync(runDir);
  } catch {
    /* best-effort — non-empty for an unexpected reason, or already gone */
  }

  return { ok: true, movedEntries };
}

// #1613: how long a run dir can sit in a "structurally stuck" skip reason
// (no-worktree/no-branch/no-pr) before this sweep starts tracking it toward
// escalation. Deliberately NOT ORPHAN_MINT_TTL_MS (24h — tuned for a
// pre-Manifesto mint that should resolve same-day or is abandoned) or
// ADHOC_SUPERSEDED_TTL_MS (30 days — tuned for "worktree gone, session
// definitely over"). This case sits between the two: the dir IS adopted
// (has config.yml) and no-worktree/no-branch/no-pr is the ordinary state
// for every run dir between mint and PR-merge — flagging it too eagerly
// would flood escalateResidue with false positives on perfectly healthy,
// still-in-review work (Deliverable 2's own warning). What actually gates
// this, though, isn't "how long can a build take" but the dir's own
// mtime — a run genuinely being worked (commits, decisions.md appends,
// work/ materializations) keeps touching its own directory, so a dir that
// has sat completely untouched for a full week is a much safer signal of
// abandonment than a build-duration estimate would be. A week also gives
// #1290's own archive-twin shape (still unbuilt as of this record — see
// this file's `isOrphanedMint`, which has no twin check yet) ample margin
// once that lands, without needing its own separate constant.
const STRUCTURALLY_STUCK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Skip reasons that might indicate a run dir stuck without external help,
// as opposed to a benign, transient in-flight state. 'console-unresolved'/
// 'console-never-rendered'/'local-behind-merge'/'merge-commit-unknown' are
// deliberately excluded — each already has its own clear resolution path
// (a human answering a console, a local fetch catching up) that doesn't
// need this generic staleness backstop.
const STRUCTURALLY_STUCK_REASONS = new Set(['no-worktree', 'no-branch', 'no-pr']);

// Pure except for the one mtime stat — no I/O beyond answering the question.
function isStructurallyStuck(dir, reason, now = Date.now()) {
  if (!STRUCTURALLY_STUCK_REASONS.has(reason)) return false;
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(dir).mtimeMs;
  } catch {
    return false;
  }
  return (now - mtimeMs) > STRUCTURALLY_STUCK_TTL_MS;
}

// #1613: visibility only — never changes what archiveMerged does with the
// directory (still just skip; the existing archive-twin "leave it in place"
// test keeps passing unmodified). Reuses the same consecutive-count +
// escalate-once machinery move-failed already uses (cache.js's trackResidue),
// under its own 'structurally-stuck' key so the two failure classes never
// blur together. A no-op below the staleness gate above — most skips, on
// most passes, are perfectly healthy in-flight runs and never reach here.
function trackStuckSkip(root, repoSlug, dir, reason, { escalate = escalateResidue } = {}) {
  if (!isStructurallyStuck(dir, reason)) return;
  trackResidue(root, repoSlug, 'structurally-stuck', dir, { failed: true, lastError: `stuck at ${reason}` }, { escalate });
}

// #644 Deliverable 2 / #2330 — every archive attempt's outcome, whichever of
// the two archival paths (mint vs. full run dir) produced it, flows through
// this one choke point so the consecutive-failure counter and escalation
// live in exactly one place rather than duplicated per call site. `dir` is
// the run directory — the same granularity `iterRunDirsWithState` iterates
// and the same unit a retry re-examines whole, matching the issue's own
// observed symptom ("15 run dirs stuck at move-failed"). Only the reasons in
// `TRACKED_FAILURE_REASONS` track: the other reasons (`mkdir-failed`,
// `git-mv-failed`, `commit-failed`, `ls-files-failed`, `readdir-failed`,
// `tracked-entry`, `close-failed`) are distinct failure classes neither #644
// nor #2330 ever named, and folding them into the same counter would blur
// reasons that need different diagnosis.
// `escalate` is injectable (defaults to the real `escalateResidue`, which
// shells to `gh`) so a test can assert escalation actually fired — and how
// many times — without touching real `gh` or the network.
//
// #2330: `work-twin-conflict` and `work-twin-resolve-failed[-partial-revert]`
// (the work-twin divergence paths above) were silently dropped by the old
// single-reason `!== 'move-failed'` guard — no streak, no eventual issue
// filing. Each tracked reason is passed through to `trackResidue` verbatim
// (never collapsed to a shared literal) so `escalate-residue.js`'s filed
// title/body names the actual failure — distinguishing a clean
// `work-twin-conflict` from a worse `work-twin-resolve-failed-partial-revert`
// (a partially-applied revert) rather than lumping both under one generic
// label.
const TRACKED_FAILURE_REASONS = [
  'move-failed',
  'work-twin-conflict',
  'work-twin-resolve-failed',
  'work-twin-resolve-failed-partial-revert',
];

function trackArchiveResult(root, repoSlug, dir, result, { escalate = escalateResidue } = {}) {
  if (result.ok) {
    for (const reason of TRACKED_FAILURE_REASONS) recordResidueSuccess(root, reason, dir);
    // #1613: a dir that just successfully archived can no longer be
    // structurally stuck — clear any prior tracking so a future, unrelated
    // reuse of this path (unlikely — paths are timestamp-uniqued, but cheap
    // to guard) starts a fresh count rather than resuming a stale one.
    recordResidueSuccess(root, 'structurally-stuck', dir);
    return;
  }
  // Archive-specific vocabulary — not part of the shared branching cache.js's
  // trackResidue dedups (#1233) — so it stays here, ahead of the shared
  // call, rather than moving inside it.
  if (!TRACKED_FAILURE_REASONS.includes(result.reason)) return;
  // Mirrors reap-merged.js's trackReapResidue: forward the underlying error
  // (now captured at each move-failed/work-twin catch site above) into the
  // shared residue-tracking/escalation choke point, keyed on the result's own
  // reason (#2330) rather than a hardcoded 'move-failed' literal.
  trackResidue(root, repoSlug, result.reason, dir, { failed: true, lastError: result.lastError }, { escalate });
}

// #1544: `iterRunDirsWithState` (context.js) excludes every `status:
// 'clean'` dir by design (line ~143 of that file) — most of its callers
// treat a clean run as "nothing left to do here," which is right for
// resolveRun/session-start but wrong for this sweep specifically. A run dir
// close-run already marked `{status: 'clean', worktree: null}` is normally
// archived within the same wrap-up pass (archive-run runs immediately
// after) — but a headless second call that completed close-run and then
// exited (or crashed) before archive-run leaves that dir sitting in
// `pipelines/` forever, invisible to the loop below. Scan the same
// top-level pipelines/ listing directly, filtered to `status: 'clean'` —
// gated below on a confirmed merged PR (never bare clean-status alone, per
// this issue's own gotcha: a clean status is not itself proof the PR
// merged).
function iterCleanRunDirs(root) {
  const base = path.join(root, '.claude-tweaks', 'pipelines');
  let entries;
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || !RUN_ID_RE.test(e.name)) continue;
    const dir = path.join(base, e.name);
    const state = readRunState(dir);
    if (state && state.status === 'clean') out.push({ dir, state });
  }
  return out;
}

function archiveMerged({ cwd, dryRun = false, sessionId = process.env.CLAUDE_CODE_SESSION_ID || null } = {}) {
  const archived = [];
  const skipped = [];
  const start = cwd || process.cwd();
  const root = mainCheckoutRoot(start);
  if (!root) return { archived, skipped };
  const repoSlug = repoSlugOf(root);

  const wtList = runGit(['worktree', 'list', '--porcelain'], root);
  const worktrees = wtList.failure ? [] : parseWorktreeList(wtList.stdout);

  for (const { dir, state } of iterRunDirsWithState(root)) {
    // #1892 Deliverable 2: the split state — archive twin already exists,
    // live path holds only tracked `work/` headers — sits ahead of every
    // other branch below, regardless of age: `isOrphanedMint`'s own
    // hasTrackedContent routing would eventually reach archiveRunDir's now-
    // idempotent twin-comparison fix (Deliverable 1) too, but only once the
    // dir is old enough AND config.yml is absent, and only by accident of
    // that unrelated gate. Checked unconditionally here instead. Under
    // `worktree-always: true`, this project's convention is that a git-
    // tracked commit against the main checkout goes out via a worktree/PR,
    // not straight from this in-process sweep — surface a distinct,
    // actionable skip with the completing command rather than committing
    // here; the reason is never tracked toward `move-failed` escalation
    // (Deliverable 2's own AC). Without `worktree-always`, archive it
    // directly via archiveRunDir, same as any other archival.
    if (isArchivedPendingTrackedMove(root, dir)) {
      if (isWorktreeAlwaysOn(root)) {
        skipped.push({
          runDir: dir,
          reason: 'archived-pending-tracked-move',
          command: archivedPendingTrackedMoveCommand(dir),
        });
        continue;
      }
      if (dryRun) { archived.push(dir); continue; }
      const result = archiveRunDir(root, dir);
      trackArchiveResult(root, repoSlug, dir, result);
      if (!result.ok) { skipped.push({ runDir: dir, reason: result.reason }); continue; }
      archived.push(dir);
      continue;
    }

    // iterRunDirsWithState already excludes status: 'clean' — every dir
    // reached here is genuinely non-terminal.
    if (isOrphanedMint(dir)) {
      if (dryRun) { archived.push(dir); continue; }
      // #2227: tracked content (a materialized work/ spec) needs archiveRunDir's
      // git mv + commit — same (root, dir) signature and {ok, reason} contract,
      // so the result handling below is shared. A bare mint with nothing
      // tracked keeps the fs-only move; see hasTrackedContent above.
      const result = hasTrackedContent(root, dir)
        ? archiveRunDir(root, dir)
        : archiveOrphanedMint(root, dir);
      trackArchiveResult(root, repoSlug, dir, result);
      if (!result.ok) { skipped.push({ runDir: dir, reason: result.reason }); continue; }
      archived.push(dir);
      continue;
    }

    // #1673: an abandoned `interrupted` run whose work actually shipped. This
    // has to sit ahead of the no-worktree/no-branch skips below: those are
    // exactly where such a run dies today, because its worktree was torn down
    // long ago and there is no live entry to derive a branch from. #1672's
    // fallback evidence is what lets checkRunIntegrity answer at all here.
    // Evaluated last of the three gates because it is the only one that spawns
    // git.
    if (isAbandonedInterrupted(dir, state, sessionId)
      && checkRunIntegrity(dir).state === 'shipped-unclosed') {
      if (dryRun) { archived.push(dir); continue; }
      // Moves-first, close-last — the same invariant this file's own header
      // comment above archiveRunDir (line ~185, "Moves-first, close-last
      // ordering") states for the pre-existing archive path: marking a run
      // terminal BEFORE its move succeeds would make a failed move
      // permanently invisible, since iterRunDirsWithState skips any run
      // already status: 'clean'. Archive FIRST — a failure here leaves the
      // run non-terminal (still 'interrupted') and retryable next pass, which
      // is the whole point — and only close it once the move has actually
      // landed.
      const archiveResult = archiveRunDir(root, dir);
      trackArchiveResult(root, repoSlug, dir, archiveResult);
      if (!archiveResult.ok) {
        // Non-'move-failed' reasons (mkdir-failed, git-mv-failed,
        // commit-failed, ls-files-failed, tracked-entry, readdir-failed) are
        // retried next pass — the run stays non-terminal above — but
        // trackArchiveResult only feeds the residue-escalation counter on
        // 'move-failed' (pre-existing behavior shared with the merged-PR
        // archive path, unchanged here), so a failure of one of those other
        // kinds is visible in `skipped` but will not self-escalate.
        skipped.push({ runDir: dir, reason: archiveResult.reason });
        continue;
      }
      // Only now, against the ARCHIVED directory — everything (events.jsonl,
      // run-state.json, work/) has already moved there — close the run
      // terminal. closeRunState, not a hand-rolled status write — it owns the
      // close-without-wrapup event and the un-archived-work advisory, which
      // is what makes an automated close indistinguishable from a manual one
      // in the ledger.
      //
      // `explicit: true` is defensible ONLY because isAbandonedInterrupted
      // plus the shipped-unclosed evidence gate have ALREADY made the
      // ownership determination upstream, above — this call site owns that
      // decision instead of delegating it to closeRunState's own
      // foreign-owner refusal, rather than claiming ownership doesn't matter
      // here. Weakening either upstream gate would silently weaken this
      // bypass too.
      const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', path.basename(dir));
      // #1012: closeRunState now takes callerIdentity ({ sessionId, cwd })
      // instead of a bare sessionId — explicit: true still bypasses the
      // foreign-owner refusal regardless (see the comment above), so this
      // is a signature-consistency update, not a behavior change here.
      const closeResult = closeRunState(archiveDir, { explicit: true, callerIdentity: { sessionId, cwd } });
      if (!closeResult.writeOk) {
        // The move already succeeded — never roll it back over a close-write
        // failure; the run is physically archived either way. Just make the
        // failure visible instead of silently reporting a clean archive: its
        // status may not actually read 'clean'.
        skipped.push({ runDir: dir, reason: 'close-write-failed' });
        continue;
      }
      archived.push(dir);
      continue;
    }

    // #1604: a genuine ad-hoc-standalone dir whose worktree is definitively
    // gone (session over) is otherwise permanently stuck below — it never
    // gets a console.json (decideArchive's console-never-rendered skip) and
    // its worktree lookup fails the moment the ordinary reap sweep tears it
    // down (no-worktree/no-branch skip). Intercept it here, ahead of both,
    // once ADHOC_SUPERSEDED_TTL_MS has passed — #1117's own invariant (never
    // sweep a still-live ad-hoc session) is unchanged: isAdHocStandaloneSuperseded
    // returns false while the worktree still resolves, regardless of age.
    if (isAdHocStandaloneSuperseded(dir, state, worktrees)) {
      if (dryRun) { archived.push(dir); continue; }
      // archiveRunDir, not archiveOrphanedMint: an ad-hoc-standalone dir is a
      // real dev session that can have materialized a spec (a git-tracked work/
      // subtree) before being abandoned. archiveOrphanedMint is a bare
      // fs.renameSync with no tracked-entry guard — archiveRunDir's #593 guard
      // (git-mv work/ + commit, refuse on any other tracked entry) is what this
      // path needs; same (root, dir) signature and {ok, reason} contract. The
      // orphaned-mint branch above makes the same choice per-dir via
      // hasTrackedContent (#2227) — this branch is unconditional because an
      // ad-hoc dir is always a real session, tracked spec or not.
      const result = archiveRunDir(root, dir);
      trackArchiveResult(root, repoSlug, dir, result);
      if (!result.ok) { skipped.push({ runDir: dir, reason: result.reason }); continue; }
      archived.push(dir);
      continue;
    }

    // #1684: `state.worktree` can be legitimately unstamped for a run that
    // shipped fine — e.g. a `/flow` run split across two Task-call sessions,
    // where `record-worktree`'s write from the second session gets classified
    // foreign and never lands. Hard-requiring the worktree-list lookup here
    // stranded such a run at 'no-worktree' forever, even once its PR
    // confirmably merged. Mirror the clean-status sweep's own fallback below
    // (and `checkRunIntegrity`'s "live wins, fallback only when it can't
    // answer" precedent, run-integrity.js): try the live worktree lookup first,
    // then fall back to `fallbackBranch` (state.pr.branch, or a decisions.md
    // PR-early lifecycle line) before giving up. Skip-reason vocabulary is
    // unchanged — 'no-worktree' when state itself carries no worktree stamp,
    // 'no-branch' when a stamped worktree just doesn't resolve to a live
    // entry — both still gated on the fallback also failing.
    const stampedWorktree = (state && state.worktree) || null;
    const wtEntry = stampedWorktree
      ? worktrees.find((w) => path.resolve(w.path) === path.resolve(stampedWorktree))
      : null;
    const branch = (wtEntry && wtEntry.branch) || fallbackBranch(root, dir, state);
    if (!branch) {
      const reason = stampedWorktree ? 'no-branch' : 'no-worktree';
      // #1962: a stamped worktree that's confirmably gone AND whose branch
      // has since been deleted (fallbackBranch above already tried and
      // failed) leaves nothing to derive a branch from — but run-state.json's
      // `pr.number` (stamped once at PR-early lifecycle time, never cleared)
      // still names the PR. Probe it directly by number instead of skipping
      // 'no-branch' forever: a closed-unmerged PR here has nothing to wait
      // for (no merge commit to catch up on, unlike the merged path below),
      // so it can archive immediately once its console (if any) is resolved.
      if (stampedWorktree && state && state.pr && state.pr.number) {
        const byNumber = resolvePrStateByNumber(root, state.pr.number);
        if (byNumber && typeof byNumber === 'object' && byNumber.state === 'CLOSED') {
          const consoleState = readConsoleState(dir);
          if (consoleState === 'unresolved') {
            skipped.push({ runDir: dir, reason: 'console-unresolved' });
            continue;
          }
          if (consoleState === 'none') {
            skipped.push({ runDir: dir, reason: 'console-never-rendered' });
            continue;
          }
          if (dryRun) { archived.push(dir); continue; }
          const result = archiveRunDir(root, dir);
          trackArchiveResult(root, repoSlug, dir, result);
          if (!result.ok) { skipped.push({ runDir: dir, reason: result.reason }); continue; }
          archived.push(dir);
          continue;
        }
      }
      skipped.push({ runDir: dir, reason });
      trackStuckSkip(root, repoSlug, dir, reason);
      continue;
    }

    const prState = resolvePrState(root, branch);
    const consoleState = readConsoleState(dir);
    const decision = decideArchive(prState, consoleState);
    if (decision.action === 'skip') {
      skipped.push({ runDir: dir, reason: decision.reason });
      trackStuckSkip(root, repoSlug, dir, decision.reason);
      continue;
    }

    const hasMerge = localHasMerge(root, prState.mergeCommit);
    if (hasMerge !== true) {
      skipped.push({ runDir: dir, reason: hasMerge === false ? 'local-behind-merge' : 'merge-commit-unknown' });
      continue;
    }
    if (dryRun) { archived.push(dir); continue; }

    const result = archiveRunDir(root, dir);
    trackArchiveResult(root, repoSlug, dir, result);
    if (!result.ok) { skipped.push({ runDir: dir, reason: result.reason }); continue; }
    archived.push(dir);
  }

  // #1544: the clean-status sweep — see iterCleanRunDirs' own comment.
  // `state.worktree` is already null by construction (close-run's write), so
  // the ordinary worktree-list branch lookup above can't answer here; reuse
  // run-integrity.js's own torn-down-worktree fallback (state.pr.branch, or
  // decisions.md's PR-early lifecycle lines) instead. Otherwise identical to
  // the main loop: decideArchive's merged-PR + resolved-console gate, then
  // the same local-fast-forward check before any move.
  for (const { dir, state } of iterCleanRunDirs(root)) {
    const branch = fallbackBranch(root, dir, state);
    if (!branch) { skipped.push({ runDir: dir, reason: 'no-branch' }); continue; }

    const prState = resolvePrState(root, branch);
    const consoleState = readConsoleState(dir);
    const decision = decideArchive(prState, consoleState);
    if (decision.action === 'skip') { skipped.push({ runDir: dir, reason: decision.reason }); continue; }

    const hasMerge = localHasMerge(root, prState.mergeCommit);
    if (hasMerge !== true) {
      skipped.push({ runDir: dir, reason: hasMerge === false ? 'local-behind-merge' : 'merge-commit-unknown' });
      continue;
    }
    if (dryRun) { archived.push(dir); continue; }

    const result = archiveRunDir(root, dir);
    trackArchiveResult(root, repoSlug, dir, result);
    if (!result.ok) { skipped.push({ runDir: dir, reason: result.reason }); continue; }
    archived.push(dir);
  }

  // #1892 Deliverable 3: prune residueFailures entries whose live path no
  // longer exists — after every archival attempt this pass made, so a path
  // this very pass just archived is pruned via recordResidueSuccess above,
  // never re-examined here. A real GitHub write (closing an escalated
  // record) belongs behind the same dry-run guard every other outward write
  // in this module already respects.
  if (!dryRun) pruneResidueFailures(root, repoSlug);

  return { archived, skipped };
}

module.exports = {
  archiveMerged, decideArchive, readConsoleState, archiveRunDir, listSpecDirs,
  isOrphanedMint, isAdHocStandaloneMint, archiveOrphanedMint, ORPHAN_MINT_TTL_MS, trackArchiveResult,
  localHasMerge, lastOwnEventMs, isAbandonedInterrupted, STALE_INTERRUPTED_TTL_MS,
  isAdHocStandaloneSuperseded, ADHOC_SUPERSEDED_TTL_MS,
  isStructurallyStuck, trackStuckSkip, STRUCTURALLY_STUCK_TTL_MS, STRUCTURALLY_STUCK_REASONS,
  isArchivedPendingTrackedMove, archivedPendingTrackedMoveCommand,
  compareWorkTwin, resolveIdenticalWorkTwin, listFilesRecursive,
};
