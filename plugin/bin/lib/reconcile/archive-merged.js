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
const { withIndexLockRetry } = require('../git-retry');
const { splitNul } = require('../git-z');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');
const { parseWorktreeList } = require('../hooks/worktree-reap');
const { isPathContained } = require('../shared-primitives');
const {
  iterRunDirsWithState, writeRunState, readRunState, readEventLines, isAdHocRunDir,
} = require('../hooks/context');
const { resolvePrState, resolvePrStateByNumber, resolveIssueStateByNumber } = require('./pr-state');
const {
  recordResidueSuccess, trackResidue, pruneResidueFailures, beginCacheBatch, commitCacheBatch,
} = require('./cache');
const { escalateResidue } = require('./escalate-residue');
const { isWorktreeAlwaysOn } = require('../policy');
const { repoSlugOf, prClosesIssue } = require('./release-merged');
const { closeRunState } = require('../hooks/close-run-state');
const { checkRunIntegrity, fallbackBranch } = require('../hooks/run-integrity');
const { readManifest, readDeferredClosures, readSingleRecordDeferredClosure } = require('../flow/manifest');

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

// #1734: the one stat-and-compare shared by every staleness predicate in this
// file (isAdHocStandaloneSuperseded, isOrphanedMint, isStructurallyStuck all
// carried byte-identical copies). Fail-closed toward "not stale" on any stat
// failure (ENOENT, EACCES, …) — every caller relies on an unreadable directory
// being left alone rather than swept. Strict `>` (not `>=`): exactly-at-TTL is
// not yet stale.
function isStaleDir(dir, ttlMs, now = Date.now()) {
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(dir).mtimeMs;
  } catch {
    return false;
  }
  return (now - mtimeMs) > ttlMs;
}

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
  if (!isAdHocRunDir(dir)) return false;
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

// #1732: thin wrapper — see isOrphanedMint's comment on the `kinds` scoping
// pattern every one of these five wrappers now shares.
function isAdHocStandaloneSuperseded(dir, state, worktrees, now = Date.now()) {
  return classifyRunDir({ dir, state, worktrees, kinds: ['adhoc-superseded'] }, now).kind === 'adhoc-superseded';
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
  const listed = runGit(['ls-files', '--', dir], root); // git-path-read: not a path list (emptiness only)
  if (listed.failure) return true;
  return (listed.stdout || '').length > 0;
}

// A minted run dir that never got adopted: no config.yml (flow's Manifesto
// is what writes it), not an ad-hoc-standalone mint (see above — that check
// now reads run-state.json for corroboration, #1604), and older than the
// grace window. No I/O beyond what answering the question requires.
// #1732: thin wrapper over classifyRunDir (defined below, once every TTL
// constant it needs is in scope) — `kinds: ['orphaned-mint']` scopes the
// classifier to exactly this one question, so a standalone call here behaves
// identically to before the consolidation (unaffected by whether `dir` would
// ALSO match a lower-precedence kind — that only matters to the main loop's
// own full-precedence classify call).
function isOrphanedMint(dir, now = Date.now()) {
  return classifyRunDir({ dir, kinds: ['orphaned-mint'] }, now).kind === 'orphaned-mint';
}

// #1982: one constructor for every `{ ok: false, reason }` refusal this file
// returns, so each carries a `hint` key (string or `null`) beside its
// reason — co-locating the recovery story with the detector rather than
// leaving it to a dispatcher-side `if (reason === '…')` string match that
// drifts the moment a reason code is renamed. `hooks.js`'s `archive-run`
// verb reads only `ok`/`reason`/`hint`/`movedEntries` off the result; it no
// longer special-cases any specific reason string.
// Hints stay `null` for the codes whose one-line reason already says what
// happened — writing prose for all fourteen-odd reason codes here would be
// speculative work this file doesn't need. Only `audit-untracked` (hint
// built where `untrackedAuditFiles` is computed, below) and the
// `move-failed`/`git-mv-failed`/`git-mv-failed-partial-revert`/
// `work-twin-resolve-failed`/`work-twin-resolve-failed-partial-revert`
// refusals (hint set from `lastError` when present) carry one today.
// Not used by `decideArchive`'s pure `{ action: 'skip', reason }` skip path
// (`gh-absent`/`network-failure`/`console-unresolved`/`console-never-rendered*`,
// further down this file) — a different shape, consumed inside the
// reconcile loop rather than by `hooks.js`'s `archive-run` verb; left alone
// deliberately.
function refusal(reason, { hint = null, ...extra } = {}) {
  return { ok: false, reason, hint, ...extra };
}

// #2346: the one commit this file's archival path makes, wrapped so a
// transient `index.lock` collision (a sibling agent's git call or a
// PostToolUse hook holding the lock in the same shared main checkout) is
// retried rather than surfacing as a hard `commit-failed` refusal.
const commitGit = withIndexLockRetry(runGit);

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
    return refusal('move-failed', { lastError: err && err.message, hint: (err && err.message) || null });
  }
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    return refusal('move-failed', { lastError: err && err.message, hint: (err && err.message) || null });
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
      const reason = fullyReverted ? 'move-failed' : 'move-failed-partial-revert';
      return refusal(reason, {
        lastError: err && err.message,
        hint: reason === 'move-failed' ? ((err && err.message) || null) : null,
      });
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

// #1737: one read of events.jsonl (via context.js's shared readEventLines)
// answering both questions `isAbandonedInterrupted` used to ask via two
// separate reads. `readable` is distinct from `lastOwnMs`'s own `null`, which
// conflates two different things: "the log is readable but has no qualifying
// (non-fallback, parseable-ts) event" and "the log couldn't be read in the
// first place." Only the caller below needs to tell those apart (#1673 F9
// review finding): a genuinely unreadable/absent log is UNKNOWN evidence, not
// proof of staleness.
//
// `lastOwnMs` is the newest event this run can actually claim as its own, in
// ms — or null when there are none. Deliberately NOT run-state's `updatedAt`,
// and deliberately excluding `attribution: 'fallback'` lines: a fallback
// event is one ANOTHER session's hook guessed into this run because the run
// had no provable owner (context.js's resolveRun). Those lines advance
// `updatedAt` without this run being alive at all, which is precisely how an
// abandoned run looks perpetually busy and never becomes closeable (#1673
// Deliverable 4).
//
// Deliberately asymmetric with context.js's `scanWrapupEvents` (read by
// `checkRunIntegrity`), which does NOT filter fallback-attributed lines: a
// run whose events.jsonl holds ONLY fallback-attributed lines can therefore
// read as both "abandoned" here (no self-attributed activity) AND "shipped"
// there (>=1 skill_invoked still counts, fallback or not). That combination
// is coherent and intended, not a bug to reconcile: the work shipped, and
// nothing THIS run itself produced has touched it since — a future reader
// should not "fix" the two filters into agreement.
function ownEventRecency(runDir) {
  const lines = readEventLines(runDir);
  if (lines === null) return { readable: false, lastOwnMs: null };
  let newest = null;
  for (const ev of lines) {
    if (!ev || ev.attribution === 'fallback') continue;
    const t = Date.parse(ev.ts);
    if (Number.isNaN(t)) continue;
    if (newest === null || t > newest) newest = t;
  }
  return { readable: true, lastOwnMs: newest };
}

// Thin wrapper kept exported for existing callers (this file's own tests
// import it directly) — `ownEventRecency` above is the one real reader now.
function lastOwnEventMs(runDir) {
  return ownEventRecency(runDir).lastOwnMs;
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
// #1732: thin wrapper — the ownership+recency comparison itself now lives
// solely in classifyRunDir's 'abandoned-interrupted' branch (below); this
// function only asks the scoped question. The `checkRunIntegrity`
// shipped-unclosed companion gate deliberately stays OUT of both this
// function and classifyRunDir — it is call-site-only (archiveMerged's main
// loop applies it after reading this kind back) — see classifyRunDir's own
// comment for why folding it in would misattribute the `explicit: true`
// archival path's justification.
function isAbandonedInterrupted(runDir, state, sessionId, now = Date.now()) {
  return classifyRunDir({
    dir: runDir, state, sessionId, kinds: ['abandoned-interrupted'],
  }, now).kind === 'abandoned-interrupted';
}

// The run's records that its merged PR does NOT close -> ascending record
// numbers. Pure — no I/O. `undefined` when the verdict cannot be decided
// (no repo slug, or the PR carries no closingIssuesReferences array): the
// caller must fail closed, never read that as "all closed".
function unclosedRecords(prState, records, repoSlug) {
  if (!repoSlug) return undefined;
  const verdicts = records.map((n) => prClosesIssue(prState, n, repoSlug));
  if (verdicts.includes(undefined)) return undefined;
  return records.filter((_, i) => verdicts[i] === false).sort((a, b) => a - b);
}

// A run's PR state + its console state -> what to do. Pure — no I/O.
//   { action: 'archive' } | { action: 'skip', reason, unclosed? }
// `recordCheck` (#3503) is `{ records, repoSlug }`: a merged PR archives only
// when it closes every one of the run's records. Absent, or with no records,
// it is ignored and the decision is byte-identical to the pre-#3503 table.
// `unclosed` (ascending record numbers) rides on a `merged-partial` skip only.
// That skip is the gate's first word, not the last: the callers settle it with
// `settleMergedPartial` below (issue-state probe, empty-linkage fallback).
// #1732: the actual decision logic — classifyRunDir's 'merged' branch calls
// this directly (a `Core` suffix, not a class of its own, since it has no
// TTL of its own to own — only the mtime/recency kinds do), and so does
// archiveMergedRun (with real staged evidence, #3249); `decideArchive`
// below is the thin 2-arg wrapper kept for its direct unit tests.
function decideArchiveCore(prState, consoleState, hasStagedPending, recordCheck) {
  if (prState === 'gh-absent') return { action: 'skip', reason: 'gh-absent' };
  if (prState === 'network-failure') return { action: 'skip', reason: 'network-failure' };
  if (prState === 'invalid-arguments') return { action: 'skip', reason: 'invalid-arguments' };
  if (prState === 'pr-not-found') return { action: 'skip', reason: 'pr-not-found' };
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
  //
  // #3249: that protection is about a run with genuinely *pending, unresolved*
  // staged decisions — but the fast-lane auto-merge short-circuit
  // (wrap-up/auto-merge-short-circuit.md) renders its console content as a
  // non-blocking PushNotification FYI and never writes console.json at all,
  // making this skip permanent for every such run regardless of whether
  // anything was ever actually staged. `hasStagedPending` is computed by the
  // caller (this function stays pure — no I/O of its own) from the run's own
  // staged/ directory; only an explicit `false` unlocks the archive path, so
  // every existing 2-arg call site (and any caller that genuinely doesn't
  // know) keeps today's unconditional skip.
  // #3297: a true `hasStagedPending` gets its own reason — the run has real
  // pending items and no console will ever render, so only a human can
  // converge it (STRUCTURALLY_STUCK_REASONS tracks it). Unknown (undefined)
  // keeps the plain, untracked reason.
  if (consoleState === 'none' && hasStagedPending !== false) {
    if (hasStagedPending === true) return { action: 'skip', reason: 'console-never-rendered-staged-pending' };
    return { action: 'skip', reason: 'console-never-rendered' };
  }
  if (!recordCheck || !recordCheck.records || recordCheck.records.length === 0) return { action: 'archive' };
  if (!recordCheck.repoSlug) return { action: 'skip', reason: 'no-repo-slug' };
  const unclosed = unclosedRecords(prState, recordCheck.records, recordCheck.repoSlug);
  if (unclosed === undefined) return { action: 'skip', reason: 'closing-issues-unknown' };
  if (unclosed.length > 0) return { action: 'skip', reason: 'merged-partial', unclosed };
  return { action: 'archive' };
}

function decideArchive(prState, consoleState) {
  const result = classifyRunDir({ prState, consoleState, kinds: ['merged'] });
  if (result.kind === 'merged') return { action: 'archive' };
  return { action: 'skip', reason: result.evidence.skipReason };
}

// 'unresolved' | 'resolved' | 'none' (no console.json rendered — #1130:
// blocks this sweep's archival unless staged/ holds nothing pending, #3249 —
// see hasStagedItems; the empty-console fast path archives via the
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

// #3249: whether this run's staged/ directory holds any staged item —
// used to distinguish "nothing was ever staged, safe to archive on a
// never-rendered console" from "staged/ genuinely holds unapproved items"
// (the #657/#1130 protection this file's console-never-rendered skip
// exists for). Dotfiles (a stray .DS_Store) are not items: the console's
// own reader (console/resolve.js readSnapshot) filters names starting with
// `.` the same way — keep the two agreeing. Returns false when no staged/
// directory exists (ENOENT) or each one holds only dotfiles or nothing — an
// absent and an empty staged/ directory are the same signal (nothing
// pending). Any other read failure (EACCES, ENOTDIR, EIO, …) is not the
// same signal — it means the contents are genuinely unprovable, not
// genuinely empty — so it fails closed (true, "treat as pending") the same
// way readConsoleState's own catch two functions above fails closed on an
// unparseable console.json; this is the one function the #657/#1130
// protection's archive decision rests on, so an ambiguous read must never
// resolve toward "safe to archive" (review finding, #3249).
//
// #3416: a multi-spec run dir (`plugin/skills/flow/multispec-run-dir-layout.md`)
// keeps each spec's staged items under `spec-{N}/staged/`, so both the
// top-level staged/ and every spec-{N}/staged/ are checked. This is
// deliberately wider than console/resolve.js's readSnapshot, which reads only
// the top-level staged/: where the two disagree, this check fails toward NOT
// archiving (a pending per-spec proposal the console does not surface still
// blocks the archive), never toward archiving it.
//
// #3668: listStagedItems is the walk itself (names, not just a verdict) so the
// archive-run verb can name what is pending; hasStagedItems is its non-empty
// check. Spec dirs and names are sorted because readdir order is unspecified.
// An unreadable staged/ is reported as one `{rel}/ (unreadable: {code})` entry,
// so the refusal names the directory it could not prove empty.
function listStagedItems(runDir) {
  const stagedRels = [
    'staged',
    ...listSpecDirs(runDir).sort().map((name) => `${name}/staged`),
  ];
  const items = [];
  for (const rel of stagedRels) {
    try {
      for (const n of fs.readdirSync(path.join(runDir, rel)).sort()) {
        if (!n.startsWith('.')) items.push(`${rel}/${n}`);
      }
    } catch (err) {
      if (!err || err.code !== 'ENOENT') items.push(`${rel}/ (unreadable: ${(err && err.code) || 'unknown'})`);
    }
  }
  return items;
}

function hasStagedItems(runDir) {
  return listStagedItems(runDir).length > 0;
}

// #3668: the auto-merge short-circuit renders no console, so its staged/ items were
// never shown to a human. Its decisions.md line is the signal, and it has two
// producers: `Fast-lane auto-merge: issue #{n}` on the auto:merge-label path
// (wrap-up/auto-merge-short-circuit.md), and `Manifesto-authorized auto-merge:
// issue #{n}` on the merge-authorization-lever path (wrap-up/manifesto-authorized-merge.md,
// its "Log line" section). That is the one 'none'-console path this guard covers: other
// terminal runs keep staged/ by design (in-terminal consoles, fleet-approved closes,
// tidy --approve runs) and must still archive. The line's absence, or a missing
// decisions.md (ENOENT), leaves the guard off; any other read failure is unprovable
// and fails toward NOT archiving, like hasStagedItems and readConsoleState. Agents reuse the bare phrase "Fast-lane
// auto-merge: issue #N" in free-form text (a short-circuit that did not fire, a
// console that resolved afterward), so the match requires the canonical
// continuation the short-circuit's own log template writes (`, assess-agent-
// autonomy verdict auto-merge`), and a `Review Console: terminal decision` line
// turns the signal off: a console was presented and resolved.
function consoleReplacedByAutoMergeShortCircuit(runDir) {
  let raw;
  try { raw = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch (err) { return !(err && err.code === 'ENOENT'); }
  if (raw.includes('Review Console: terminal decision')) return false;
  return /(?:Fast-lane|Manifesto-authorized) auto-merge: issue #\d+, assess-agent-autonomy verdict auto-merge/.test(raw);
}

// #1130: gh's MERGED state is a remote fact; the local main checkout may not
// have fast-forwarded to include the merge commit yet. The run dir's tracked
// work/ subtree only reaches the main checkout via that merge, so archiving
// early moves only the gitignored half and strands work/ (the #657 symptom).
// true = merge commit is in local history; false = definitively not (safe to
// retry next pass); null = oid unavailable/malformed — treated by the caller
// as not-yet-verifiable, same skip-and-retry.
//
// #2565: `HEAD` is whatever happens to be checked out in the main checkout —
// not necessarily the integration branch. A checkout parked on some other
// local branch (one tracking `origin/{integration}` under another name, or
// mid-investigation of something unrelated) never advances HEAD to include
// the merge, so this check permanently reported `local-behind-merge` no
// matter how long ago the PR actually merged. `integration`, when the
// caller has it (reconcile/index.js's own policy-resolved branch name),
// targets the local integration-branch ref instead of HEAD, falling back to
// `origin/{integration}` (kept current by mirror-ff.js's own fetch even
// when that branch isn't checked out) when the local ref doesn't have it —
// covering both "not merged yet" and "local ref doesn't exist at all".
// `integration` is optional: omitting it (a standalone caller with no
// branch-name context) keeps checking HEAD exactly as before this fix, and
// a main checkout actually ON the integration branch is unaffected either
// way, since HEAD and `refs/heads/{integration}` then name the same commit.
function localHasMerge(root, mergeCommit, integration) {
  const oid = mergeCommit && typeof mergeCommit.oid === 'string' && /^[0-9a-f]{40}$/.test(mergeCommit.oid)
    ? mergeCommit.oid : null;
  if (!oid) return null;
  if (!integration) {
    const r = runGit(['merge-base', '--is-ancestor', oid, 'HEAD'], root);
    return !r.failure;
  }
  const local = runGit(['merge-base', '--is-ancestor', oid, `refs/heads/${integration}`], root);
  if (!local.failure) return true;
  // Local ref missing the merge (or missing entirely) — fall back to
  // origin/{integration}, which reconcile's own mirror/fetch step keeps
  // current independent of what's checked out here.
  const upstream = runGit(['merge-base', '--is-ancestor', oid, `origin/${integration}`], root);
  return !upstream.failure;
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
  const check = runGit(['ls-files', '--error-unmatch', targetPath], root); // git-path-read: not a path list (exit code only)
  if (check.failure) return false;
  const untracked = runGit(['ls-files', '--others', '--exclude-standard', targetPath], root); // git-path-read: not a path list (emptiness only)
  return !untracked.failure && !untracked.stdout;
}

// #2816: a `work/` directory left behind by a materialize hard-gate stop
// (the header never landed, so nothing was ever written under it) has
// nothing for `git mv` to move — git itself never tracks an empty
// directory, so `isTracked` above always reads false for one and offers no
// signal to distinguish "empty, nothing to move" from "non-empty but
// untracked" (#953's genuinely refusal-worthy case). Checked in the cheaper
// order: a non-empty `fs.readdirSync` already answers "not this case"
// without needing a git call at all; only a truly empty directory goes on
// to confirm via `git ls-files` that nothing is staged at this path either
// (belt-and-suspenders — an empty directory can't hold a tracked blob, but
// this keeps the check anchored to a real git read rather than a
// filesystem-only assumption). When `dir` is that empty, untracked case,
// removes it (best-effort) and returns true so the caller treats it as
// absent; otherwise leaves it alone and returns false — including for a
// missing or unreadable directory (never throws).
function removeIfEmptyUntrackedDir(root, dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return false;
  }
  if (entries.length !== 0) return false;
  const tracked = runGit(['ls-files', dir], root); // git-path-read: not a path list (emptiness only)
  if (tracked.failure || tracked.stdout) return false;
  try { fs.rmdirSync(dir); } catch { /* best-effort — already gone, or non-empty for an unexpected reason */ }
  return true;
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
      if (rm.failure) return refusal('work-twin-resolve-failed', { lastError: rm.stderr, hint: rm.stderr || null, resolved });
      resolved.push({ kind: 'twin-rm', srcFile, destFile });
    } else {
      const mv = runGit(['mv', '-f', srcFile, destFile], root);
      if (mv.failure) return refusal('work-twin-resolve-failed', { lastError: mv.stderr, hint: mv.stderr || null, resolved });
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

// #1811 Deliverable 3: a run dir shaped `{timestamp}-record-{n}[-{m}...]`
// whose own record number(s) — not a PR — are named in its slug. The one
// case this predicate exists for is a run dir with config.yml but NO
// run-state.json at all (materialize.md's own worktree-first commit never
// landed, or the process died before record-worktree stamped anything):
// every other lifecycle path in this file (the classifier's five kinds, the
// branch/by-number probes below) needs SOME evidence out of run-state.json
// or a live worktree to resolve a branch/PR — this shape has neither, so it
// escalates at `structurally-stuck` forever without ever resolving (see this
// record's own filed example, #1811's Original request). Terminal once every
// record in the slug is independently CLOSED — nothing left to build.
const RECORD_SLUG_RE = /-record-([\d-]+)$/;

// dir basename -> record numbers named in a `record-{n}[-{m}...]` slug, or
// null when the basename doesn't match that shape (a topic-name run, a
// `*-tidy-standalone*`/`*-sweep-standalone*` run, a multi-spec `spec-{n}/`
// slug, etc. — none of those are this predicate's concern).
function recordNumbersFromSlug(dir) {
  const m = RECORD_SLUG_RE.exec(path.basename(dir));
  if (!m) return null;
  const nums = m[1].split('-').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return nums.length ? nums : null;
}

// #3503: the run's required record ids — what the merged-partial archive guard
// (decideArchiveCore's recordCheck) must see closed before archiving. Manifest
// present with specs: every spec id except a `failed`/`not-run` spec (it never
// completed, so its record is not this run's to close) and a spec carrying a
// deferred-closure entry (the run deliberately withheld its closing keyword).
// No such manifest: the ids named in a `record-{n}`/`spec-{n}[-{m}]` slug,
// minus any with a top-level deferred-closure entry. Neither: null. Integers,
// deduplicated, first-occurrence order — prClosesIssue compares numbers strictly.
// Any manifest spec id that is not a positive-integer string (`abc`, `0x10`,
// `1e3`) yields null too: it is not a GitHub issue number, so closingIssuesReferences
// can never attest it, and the run is left unchecked rather than coerced.
// Separate from RECORD_SLUG_RE on purpose: that regex stays record-only for
// isClosedSlugStuck.
const RUN_RECORD_SLUG_RE = /-(?:record|spec)-(\d+(?:-\d+)*)$/;

function runRecordSet(dir) {
  const manifest = readManifest(dir);
  const ids = [];
  if (manifest && manifest.multispec.specs.length) {
    const specs = manifest.multispec.specs;
    if (specs.some((spec) => !/^[1-9]\d*$/.test(String(spec.id)))) return null;
    const deferred = readDeferredClosures(dir, specs);
    for (const spec of specs) {
      if (spec.status === 'failed' || spec.status === 'not-run') continue;
      if (deferred.has(String(spec.id))) continue;
      ids.push(Number(spec.id));
    }
    return [...new Set(ids)];
  }
  const m = RUN_RECORD_SLUG_RE.exec(path.basename(dir));
  if (!m) return null;
  for (const raw of m[1].split('-')) {
    const n = Number(raw);
    if (readSingleRecordDeferredClosure(dir, n) !== undefined) continue;
    ids.push(n);
  }
  return [...new Set(ids)];
}

// #3503: the manifest spec ids this run still has `pending` or `running`, as
// integers (any id that is not a positive-integer string is dropped, as in
// runRecordSet). [] when there is no manifest. Evidence of in-flight work for
// settleMergedPartial's empty-linkage fallback; runRecordSet is unchanged.
function inFlightRecords(dir) {
  const manifest = readManifest(dir);
  if (!manifest || !manifest.multispec.specs.length) return [];
  return manifest.multispec.specs
    .filter((spec) => (spec.status === 'pending' || spec.status === 'running') && /^[1-9]\d*$/.test(String(spec.id)))
    .map((spec) => Number(spec.id));
}

// { root, dir, state, now, resolveIssueState } -> boolean. `state` must be
// exactly null/undefined (readRunState's own "no run-state.json" answer) —
// a dir that HAS a run-state.json, however stale or malformed, is not this
// shape and is left to the ordinary classifier/branch-resolution path
// instead. Fails closed (false) on ANY unresolved or non-CLOSED record, or a
// gh-absent/network-failure probe on any one of them — never archives a slug
// this predicate could not fully confirm closed.
function isClosedSlugStuck(root, dir, state, now = Date.now(), resolveIssueState = resolveIssueStateByNumber) {
  if (state) return false;
  if (!fs.existsSync(path.join(dir, 'config.yml'))) return false;
  if (!isStaleDir(dir, STRUCTURALLY_STUCK_TTL_MS, now)) return false;
  const nums = recordNumbersFromSlug(dir);
  if (!nums) return false;
  return nums.every((n) => {
    const result = resolveIssueState(root, n);
    return !!(result && typeof result === 'object' && result.state === 'CLOSED');
  });
}

// #1103's own claim-survives-a-failure protection: a git/commit
// subprocess failure (real timing, real locks, a real pre-commit hook)
// can be transient, so its "archiving" claim deliberately survives the
// refusal — a concurrent, unlocked `reconcile` scan racing this same run
// dir moments later still sees a fresh claim and backs off, until
// context.js's own TTL eventually expires it. archiveRunDir's #2816
// `refuseAfterMarker` cleanup must not defeat that: these reason strings
// keep today's survive-on-failure behavior unconditionally (see the
// `#1103 follow-up` comment inside archiveRunDir, and its own pinning test).
const GIT_TIMING_REFUSAL_REASONS = new Set([
  'git-mv-failed', 'git-mv-failed-partial-revert',
  'commit-failed', 'commit-failed-partial-revert',
  'work-twin-resolve-failed', 'work-twin-resolve-failed-partial-revert',
]);

// #3198: decisions.md/events.jsonl are append-only logs that can legitimately
// accumulate across more than one archival pass of the same run id (a race
// where a stale caller recreates runDir after it was already archived, or a
// second reconcile pass observes the same recreated dir) — losing either
// pass's content is never acceptable. Every other entry refuses outright on
// a destination collision instead of silently overwriting real archived
// content (this record's own incident: a recreated run dir's fresh
// run-state.json replaced the real archived one).
const APPEND_ONLY_ARCHIVE_ENTRIES = new Set(['decisions.md', 'events.jsonl']);

class ArchiveDestinationExistsError extends Error {
  constructor(dest) {
    super(`archive destination already exists: ${dest}`);
    this.code = 'ARCHIVE_DEST_EXISTS';
  }
}

// Moves one archive entry from `src` to `dest`. When `dest` already exists:
// an append-only log (APPEND_ONLY_ARCHIVE_ENTRIES) gets src's bytes appended
// onto dest, then src is removed — dest's original content is never
// truncated or replaced. Anything else throws ArchiveDestinationExistsError
// without touching either path, so the caller can refuse cleanly — unless
// `allowOverwrite` is set (run-state.json's own interim "archiving" marker,
// written by this same call before the move loop runs — see
// `runStateDestIsRealPriorArchive` in archiveRunDir), in which case the collision is expected
// and the plain rename proceeds. A real fs failure (permissions, disk full)
// propagates unchanged — callers already catch that for their own
// revert/refusal handling.
function moveArchiveEntry(src, dest, name, { allowOverwrite = false } = {}) {
  if (fs.existsSync(dest) && !allowOverwrite) {
    if (APPEND_ONLY_ARCHIVE_ENTRIES.has(name)) {
      fs.appendFileSync(dest, fs.readFileSync(src));
      fs.unlinkSync(src);
      return { appended: true };
    }
    throw new ArchiveDestinationExistsError(dest);
  }
  fs.renameSync(src, dest);
  return { moved: true };
}

// #3198 review: the move loops' own collision refusal fires only after the
// "archiving" marker has already been merged into archiveDir/run-state.json
// — flipping a real prior archive's terminal status to 'archiving', so the
// NEXT pass reads it as this run's own retryable marker and overwrites it
// with the stale stub after all — and after any earlier append-only entry
// has already been irreversibly appended. Scanning every non-work/ entry
// (top-level and per spec-{N}/) for a refusing collision before anything
// is written makes the refusal leave both trees exactly as found. The
// in-loop checks stay as the backstop for an entry that appears after this
// scan. Returns the first colliding entry's relative name, or null.
function findRefusingArchiveCollision(runDir, archiveDir, runStateDestIsRealPriorArchive) {
  const specDirs = listSpecDirs(runDir);
  const pairs = [['', runDir, archiveDir]];
  for (const specName of specDirs) {
    pairs.push([specName, path.join(runDir, specName), path.join(archiveDir, specName)]);
  }
  for (const [prefix, srcDir, destDir] of pairs) {
    let names;
    try { names = fs.readdirSync(srcDir); } catch { continue; }
    for (const name of names) {
      if (name === 'work' || (prefix === '' && specDirs.includes(name))) continue;
      if (APPEND_ONLY_ARCHIVE_ENTRIES.has(name)) continue;
      if (prefix === '' && name === 'run-state.json' && !runStateDestIsRealPriorArchive) continue;
      if (fs.existsSync(path.join(destDir, name))) return prefix ? path.join(prefix, name) : name;
    }
  }
  return null;
}

function archiveRunDir(root, runDir) {
  const runId = path.basename(runDir);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  // #2816 follow-up: captured before mkdirSync below so `refuseAfterMarker`
  // can tell "this call created archiveDir" from "archiveDir already held
  // real content before this call ever started" (e.g. a prior partial
  // archive attempt's twin — exactly the shape `work-twin-conflict` guards
  // against). Only the former is safe to blanket-`rmSync` on refusal; a
  // pre-existing archiveDir's content did not come from THIS call's
  // `movedEntries`, so an empty `movedEntries` says nothing about whether
  // archiveDir itself is empty.
  const archiveDirPreexisted = fs.existsSync(archiveDir);
  // #3198: captured BEFORE the "archiving" marker write below (which always
  // creates/merges archiveDir/run-state.json) so the later move loop can
  // tell "this call's own marker already sits at the destination" (expected,
  // safe to overwrite with the real file) from "a REAL prior archival's
  // run-state.json is already there" (the actual #3198 collision — must
  // refuse, never silently replaced by a recreated run dir's stub). A
  // surviving `status: 'archiving'` marker from an earlier FAILED attempt at
  // THIS same run (#1103's own claim-survives-a-failure protection) is NOT
  // real prior content — a retry's overwrite of it is the existing,
  // intended behavior, so only a non-'archiving' status (e.g. 'clean', the
  // terminal status a completed archival writes) counts as a real collision.
  let priorArchiveRunState = null;
  if (archiveDirPreexisted) {
    try {
      priorArchiveRunState = JSON.parse(fs.readFileSync(path.join(archiveDir, 'run-state.json'), 'utf8'));
    } catch { /* missing or unreadable — treat as no real prior content */ }
  }
  const runStateDestIsRealPriorArchive = !!(priorArchiveRunState && priorArchiveRunState.status !== 'archiving');
  if (archiveDirPreexisted) {
    const collision = findRefusingArchiveCollision(runDir, archiveDir, runStateDestIsRealPriorArchive);
    if (collision) {
      return refusal('archive-destination-exists', {
        entry: collision,
        hint: `archive destination already exists: ${path.join(archiveDir, collision)}`,
      });
    }
  }
  try {
    fs.mkdirSync(archiveDir, { recursive: true });
  } catch {
    return refusal('mkdir-failed');
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

  // #2816: every refusal below this point runs after the `archiving`
  // marker (writeRunState above) already created `archiveDir` on disk — a
  // structural/content refusal (audit-untracked, tracked-entry, a
  // work-twin content conflict, a readdir/ls-files failure, close-failed)
  // that staged no real move would otherwise leave that half-written
  // archive twin behind forever, with no TTL-expiry mechanism ever
  // reclaiming it (unlike GIT_TIMING_REFUSAL_REASONS above, this class is
  // deterministic — a concurrent attempt would hit the identical refusal
  // regardless of whether the twin survives, so there is no race left to
  // protect). Wrap every such return: when nothing has landed in
  // `movedEntries` yet by the time this fires, AND this call is the one
  // that created `archiveDir` in the first place (`!archiveDirPreexisted`),
  // remove the twin and leave the filesystem exactly as this call found it.
  // Once `movedEntries` is non-empty, some content genuinely lives at
  // `archiveDir` now — a later refusal must not delete that, even though a
  // fully-reverted one may have left mkdir'd (empty) spec subdirectories
  // behind, which is cosmetic, not a stray archive twin. And when
  // `archiveDirPreexisted` is true — a prior partial-archive attempt (or a
  // genuine, pre-existing archive twin, exactly `work-twin-conflict`'s own
  // case) already put real content at `archiveDir` before this call ever
  // ran — an empty `movedEntries` this call built says nothing about
  // whether `archiveDir` itself is empty; blanket-deleting it would destroy
  // content this call never created and cannot safely diagnose as
  // disposable. That case is left exactly as every refusal left it
  // pre-#2816: refused, `archiveDir` untouched.
  function refuseAfterMarker(reason, extra) {
    if (!archiveDirPreexisted && movedEntries.length === 0 && !GIT_TIMING_REFUSAL_REASONS.has(reason)) {
      try { fs.rmSync(archiveDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    return refusal(reason, extra);
  }

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
  // passing an already-archived path as `runDir`
  // directly, where `path.basename` round-trips to the same archive twin).
  // `topWork === topWorkDest` there, and comparing a directory against
  // itself trivially reads "identical," which would route straight into
  // `resolveIdenticalWorkTwin`'s `git rm` — destroying the only copy. Twin
  // detection only applies when the destination is a genuinely different,
  // pre-existing path; the same-path case falls through to the ordinary
  // `workMoves` `git mv`, which git itself refuses ("can not move directory
  // into itself") — the pre-existing, correct behavior for that case.
  //
  // #2816: an empty, untracked `work/` (a materialize hard-gate stop's
  // mkdir with nothing ever written under it) has nothing to `git mv` —
  // `removeIfEmptyUntrackedDir` removes it on disk so it is never queued
  // into `workMoves`/`twinPlan`. A non-empty untracked `work/` (#953) falls
  // through unchanged to the twin/workMoves classification below.
  const topWork = path.join(runDir, 'work');
  if (fs.existsSync(topWork) && !removeIfEmptyUntrackedDir(root, topWork)) {
    const topWorkDest = path.join(archiveDir, 'work');
    if (path.resolve(topWork) !== path.resolve(topWorkDest) && fs.existsSync(topWorkDest)) {
      const twin = compareWorkTwin(root, topWork, topWorkDest);
      if (!twin.identical) {
        return refuseAfterMarker('work-twin-conflict', {
          conflict: { src: topWork, dest: topWorkDest, differing: twin.differing },
        });
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
    return refuseAfterMarker('audit-untracked', {
      untrackedAuditFiles,
      hint: `(${untrackedAuditFiles.join(', ')} exist here but are not tracked by this checkout's git index). `
        + 'A pr-first standalone run\'s decisions.md/report.md/staged only become tracked once their worktree '
        + 'copy has merged AND this checkout has pulled that merge — sync this checkout with origin (git pull, '
        + 'or reconcile\'s own mirror-ff) and retry. If no such merge exists (the content was never committed '
        + 'anywhere), it is not recoverable from git history — re-run whatever produced it.',
    });
  }
  for (const specName of specDirs) {
    const specWork = path.join(runDir, specName, 'work');
    if (!fs.existsSync(specWork)) continue;
    // #2816: same empty-untracked-directory treatment as topWork above,
    // for the multi-spec-parent shape of the identical materialize
    // hard-gate-stop leftover.
    if (removeIfEmptyUntrackedDir(root, specWork)) continue;
    const specArchiveDir = path.join(archiveDir, specName);
    try {
      fs.mkdirSync(specArchiveDir, { recursive: true });
    } catch {
      return refuseAfterMarker('mkdir-failed');
    }
    const specWorkDest = path.join(specArchiveDir, 'work');
    // #1323: same same-path guard as topWork above.
    if (path.resolve(specWork) !== path.resolve(specWorkDest) && fs.existsSync(specWorkDest)) {
      const twin = compareWorkTwin(root, specWork, specWorkDest);
      if (!twin.identical) {
        return refuseAfterMarker('work-twin-conflict', {
          conflict: { src: specWork, dest: specWorkDest, differing: twin.differing },
        });
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
        return refuseAfterMarker(fullyReverted ? result.reason : 'work-twin-resolve-failed-partial-revert', {
          lastError: result.lastError,
          hint: result.lastError || null,
        });
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
        const reason = fullyReverted ? 'git-mv-failed' : 'git-mv-failed-partial-revert';
        return refuseAfterMarker(reason, { lastError: mv.stderr, hint: mv.stderr || null });
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
    const commit = commitGit(['commit', '-m', `[reconcile] archive run ${runId}`, '--', ...commitPaths], root);
    if (commit.failure) {
      // A partial revert (some ops' `git reset`/`git checkout` or disk move
      // failed) is a distinct outcome from a clean one: the retry guard
      // below keys on `fs.existsSync(workSrc)`, which only sees a pair again
      // once it's genuinely back at its original path.
      // `commit-failed-partial-revert` makes that distinction visible to
      // callers/logs rather than collapsing both into the same reason
      // string.
      const fullyReverted = revertStagedOps(root, stagedOps);
      return refuseAfterMarker(fullyReverted ? 'commit-failed' : 'commit-failed-partial-revert');
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
    const lsFiles = runGit(['ls-files', '-z', '--', runDir], root);
    if (lsFiles.failure) return refuseAfterMarker('ls-files-failed');
    const workDir = path.join(runDir, 'work');
    const trackedOutsideWork = splitNul(lsFiles.stdout)
      .map((p) => path.join(root, p))
      .filter((abs) => path.relative(runDir, abs) !== '' && !isPathContained(abs, workDir, { orEqual: true }));
    if (trackedOutsideWork.length > 0) {
      return refuseAfterMarker('tracked-entry');
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
      return refuseAfterMarker('readdir-failed');
    }
    // spec-{N}/ dirs are excluded here — their archive twins may already
    // exist (created by the workMoves batch above), so a whole-dir rename
    // would fail ENOTEMPTY; their contents move entry-by-entry in the
    // dedicated spec loop below instead.
    const movedThisPass = [];
    // An append (moveArchiveEntry's append-only path) unlinks its src — it
    // cannot be reverted, so a later refusal in this pass is never "fully
    // reverted" once one has happened.
    let appendedThisPass = false;
    for (const name of entries.filter((n) => n !== 'work' && !specDirs.includes(n))) {
      const src = path.join(runDir, name);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(archiveDir, name);
      let outcome;
      try {
        outcome = moveArchiveEntry(src, dest, name, {
          allowOverwrite: name === 'run-state.json' && !runStateDestIsRealPriorArchive,
        });
      } catch (err) {
        const fullyReverted = revertPlainMoves(movedThisPass) && !appendedThisPass;
        if (err instanceof ArchiveDestinationExistsError) {
          const reason = fullyReverted ? 'archive-destination-exists' : 'archive-destination-exists-partial-revert';
          return refuseAfterMarker(reason, { entry: name, hint: err.message });
        }
        const reason = fullyReverted ? 'move-failed' : 'move-failed-partial-revert';
        return refuseAfterMarker(reason, {
          lastError: err && err.message,
          hint: reason === 'move-failed' ? ((err && err.message) || null) : null,
        });
      }
      if (outcome.moved) movedThisPass.push([src, dest]);
      else appendedThisPass = true;
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
      return refuseAfterMarker('readdir-failed');
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
        return refuseAfterMarker('move-failed', { lastError: err && err.message, hint: (err && err.message) || null });
      }
    }
    const specMovedThisPass = [];
    let specAppendedThisPass = false; // same non-revertible-append rule as the top-level loop

    for (const name of specRemaining) {
      const src = path.join(specDir, name);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(specArchiveDir, name);
      let outcome;
      try {
        outcome = moveArchiveEntry(src, dest, name);
      } catch (err) {
        const fullyReverted = revertPlainMoves(specMovedThisPass) && !specAppendedThisPass;
        if (err instanceof ArchiveDestinationExistsError) {
          const reason = fullyReverted ? 'archive-destination-exists' : 'archive-destination-exists-partial-revert';
          return refuseAfterMarker(reason, { entry: path.join(specName, name), hint: err.message });
        }
        const reason = fullyReverted ? 'move-failed' : 'move-failed-partial-revert';
        return refuseAfterMarker(reason, {
          lastError: err && err.message,
          hint: reason === 'move-failed' ? ((err && err.message) || null) : null,
        });
      }
      if (outcome.moved) specMovedThisPass.push([src, dest]);
      else specAppendedThisPass = true;
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
  if (!result) return refuseAfterMarker('close-failed');

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
        moveArchiveEntry(src, dest, name, {
          allowOverwrite: name === 'run-state.json' && !runStateDestIsRealPriorArchive,
        });
        movedEntries.push(name);
      } catch {
        /* best-effort — leave it on disk for the next archival pass to
           retry rather than fail this whole call over a residual
           straggler; the rmdirSync below naturally stays a no-op then.
           Covers both a real move failure and a non-append-only collision
           (#3198) — either way, nothing here should destroy existing
           archive content or block the rest of this call. */
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
// need this generic staleness backstop. 'console-never-rendered-pr-closed'
// (#2231) is one exception carved out of that exclusion: it fires only
// when the by-number fallback below confirms the run's PR is CLOSED
// (never merged) — at that point nothing drives the run's pipeline to
// wrap-up anymore, so no console will ever render, and the plain
// 'console-never-rendered' reason's "a human eventually answers it"
// rationale does not apply. The MERGED sub-case of that same fallback
// (and of the ordinary branch-joined path) archives when staged/ holds
// nothing pending (#3249). Plain, untracked 'console-never-rendered' stays
// for unknown staged state. When a merged run's staged/ holds pending items,
// the reason is 'console-never-rendered-staged-pending' (#3297), which is
// tracked: the fast-lane short-circuit writes no console, so none will ever
// render and only a human can converge it.
// 'merged-partial' (#3503) is tracked because a run whose merged PR left a
// record unclosed is waiting on a later PR; it must escalate rather than
// freeze, and the 7-day TTL keeps a legitimately split run quiet meanwhile.
// 'no-repo-slug' (#3503) is tracked because it never self-resolves: a repo whose
// GitHub remote is not named `origin` leaves every numeric-slug run unverifiable.
// With no repo slug the escalation issue itself cannot be filed (escalate-residue's
// findOrCreateIssue returns 'escalation-failed'), so for this reason the tracking
// only surfaces the run in the residue summary's stuck count.
// 'pr-not-found' (#3543) is also tracked: a stamped pr.number that GitHub
// confirms names no PR will never resolve without a human (fix or clear the
// stamp), and the by-number lookup deliberately never falls back to the
// branch (#3416), so the skip would otherwise repeat silently forever.
// 'network-failure' stays excluded — a long genuine outage must not page.
const STRUCTURALLY_STUCK_REASONS = new Set([
  'no-worktree', 'no-branch', 'no-pr', 'console-never-rendered-pr-closed', 'console-never-rendered-staged-pending',
  'pr-not-found', 'merged-partial', 'no-repo-slug',
]);

// #1732: thin wrapper — see isOrphanedMint's comment on the `kinds` scoping
// pattern. Pure except for the one mtime stat classifyRunDir performs.
function isStructurallyStuck(dir, reason, now = Date.now()) {
  return classifyRunDir({ dir, skipReason: reason, kinds: ['structurally-stuck'] }, now).kind === 'structurally-stuck';
}

// #1732: the single classifier every lifecycle-detection predicate above
// delegates to. Consolidates the five bolted-on mechanisms this file used to
// carry as independent early-return branches (isOrphanedMint,
// isAbandonedInterrupted, isAdHocStandaloneSuperseded, decideArchive's
// merged-PR path, isStructurallyStuck) into one first-match list, evaluated
// in the exact precedence order the pre-consolidation main loop checked them
// in: orphaned-mint -> abandoned-interrupted -> adhoc-superseded -> merged ->
// structurally-stuck -> none.
//
// `ctx.kinds` scopes evaluation to a subset (in the order given) — every
// wrapper predicate above passes its own single kind, so a standalone call
// (e.g. a unit test constructing a bare fixture dir with no config.yml)
// answers exactly the question it always asked, unaffected by whether the
// same dir would ALSO match some OTHER kind earlier in the full precedence
// list. Only archiveMerged's own main loop passes the full, ordered kind set
// (the module default below) to get precedence-respecting classification
// across all five at once.
//
// I/O-free apart from the one mtime stat (via isStaleDir) and the one
// events.jsonl read (via ownEventRecency) that the mtime-based kinds and
// abandoned-interrupted's recency check respectively need — every other
// input (state, worktrees, sessionId, prState, consoleState, skipReason) is
// pre-computed by the caller, per this file's own Gotchas: the merged-PR
// path's prState/consoleState inputs, and — deliberately excluded from this
// function entirely — the abandoned-interrupted kind's `checkRunIntegrity`
// shipped-unclosed companion gate, which stays a call-site-only decision so
// the `explicit: true` archival path's justification is never silently
// folded into a kind this function alone decided.
//
// -> { kind: 'orphaned-mint'|'abandoned-interrupted'|'adhoc-superseded'|
//            'merged'|'structurally-stuck'|'none',
//      ttlMs: number|null, evidence: object }
const CLASSIFY_ORDER = ['orphaned-mint', 'abandoned-interrupted', 'adhoc-superseded', 'merged', 'structurally-stuck'];

function classifyRunDir(ctx, now = Date.now()) {
  const {
    dir, state, worktrees, sessionId, prState, consoleState, skipReason, kinds,
  } = ctx;
  const order = kinds || CLASSIFY_ORDER;

  for (const kind of order) {
    if (kind === 'orphaned-mint') {
      if (dir && !fs.existsSync(path.join(dir, 'config.yml')) && !isAdHocStandaloneMint(dir)
        && isStaleDir(dir, ORPHAN_MINT_TTL_MS, now)) {
        return { kind: 'orphaned-mint', ttlMs: ORPHAN_MINT_TTL_MS, evidence: {} };
      }
    } else if (kind === 'abandoned-interrupted') {
      if (state && state.status === 'interrupted') {
        const owner = typeof state.sessionId === 'string' && state.sessionId ? state.sessionId : null;
        const ownLive = !!(owner && sessionId && owner === sessionId); // our own live run
        if (!ownLive) {
          // An unreadable/absent events.jsonl is UNKNOWN evidence of
          // activity, not proof of staleness — fail toward not-abandoned
          // rather than collapsing "we can't tell" into "definitely idle".
          const { readable, lastOwnMs: last } = ownEventRecency(dir);
          const stillRecent = last !== null && (now - last) <= STALE_INTERRUPTED_TTL_MS;
          if (readable && !stillRecent) {
            return { kind: 'abandoned-interrupted', ttlMs: STALE_INTERRUPTED_TTL_MS, evidence: { lastOwnMs: last } };
          }
        }
      }
    } else if (kind === 'adhoc-superseded') {
      if (dir && isAdHocStandaloneMint(dir) && state && typeof state.worktree === 'string' && state.worktree) {
        const stillLive = (worktrees || []).some((w) => path.resolve(w.path) === path.resolve(state.worktree));
        if (!stillLive && isStaleDir(dir, ADHOC_SUPERSEDED_TTL_MS, now)) {
          return { kind: 'adhoc-superseded', ttlMs: ADHOC_SUPERSEDED_TTL_MS, evidence: {} };
        }
      }
    } else if (kind === 'merged') {
      if (prState !== undefined) {
        // #3249: staged evidence is only computable when the caller passed
        // `dir`. decideArchive (the thin wrapper above) and the direct
        // prState-only classifyRunDir unit tests pass none, so
        // hasStagedPending stays undefined and the unconditional
        // console-never-rendered skip holds for them. The production merged
        // path (archiveMergedRun) does not route through here — it calls
        // decideArchiveCore with hasStagedItems(dir) directly.
        const hasStagedPending = dir ? hasStagedItems(dir) : undefined;
        const decision = decideArchiveCore(prState, consoleState, hasStagedPending);
        if (decision.action === 'archive') return { kind: 'merged', ttlMs: null, evidence: {} };
        return { kind: 'none', ttlMs: null, evidence: { skipReason: decision.reason } };
      }
    } else if (kind === 'structurally-stuck') {
      if (skipReason && STRUCTURALLY_STUCK_REASONS.has(skipReason) && isStaleDir(dir, STRUCTURALLY_STUCK_TTL_MS, now)) {
        return { kind: 'structurally-stuck', ttlMs: STRUCTURALLY_STUCK_TTL_MS, evidence: {} };
      }
    }
  }
  return { kind: 'none', ttlMs: null, evidence: {} };
}

// #1613: visibility only — never changes what archiveMerged does with the
// directory (still just skip; the existing archive-twin "leave it in place"
// test keeps passing unmodified). Reuses the same consecutive-count +
// escalate-once machinery move-failed already uses (cache.js's trackResidue),
// under its own 'structurally-stuck' key so the two failure classes never
// blur together. A no-op below the staleness gate above — most skips, on
// most passes, are perfectly healthy in-flight runs and never reach here.
// `cacheTarget` is either a plain root string (single-call behavior,
// unchanged) or a `beginCacheBatch` handle (#1235 — batched across
// `archiveMerged`'s item loops); see cache.js's own comment on the two
// shapes.
function trackStuckSkip(cacheTarget, repoSlug, dir, reason, { escalate = escalateResidue, runner } = {}) {
  if (!isStructurallyStuck(dir, reason)) return;
  trackResidue(cacheTarget, repoSlug, 'structurally-stuck', dir, { failed: true, lastError: `stuck at ${reason}` }, { escalate, runner });
}

// #644 Deliverable 2 — every archive attempt's outcome, whichever of the two
// archival paths (mint vs. full run dir) produced it, flows through this one
// choke point so the consecutive-failure counter and escalation live in
// exactly one place rather than duplicated per call site. `dir` is the run
// directory — the same granularity `iterRunDirsWithState` iterates and the
// same unit a retry re-examines whole, matching the issue's own observed
// symptom ("15 run dirs stuck at move-failed"). Only `move-failed` tracks:
// the other reasons (`mkdir-failed`, `git-mv-failed`, `commit-failed`,
// `ls-files-failed`, `readdir-failed`, `tracked-entry`, `close-failed`) are
// distinct failure classes the issue never named, and folding them into the
// same counter would blur reasons that need different diagnosis.
// `escalate` is injectable (defaults to the real `escalateResidue`, which
// shells to `gh`) so a test can assert escalation actually fired — and how
// many times — without touching real `gh` or the network.
// `cacheTarget` — plain root string, or a `beginCacheBatch` handle (#1235) —
// see `trackStuckSkip`'s own comment above.
function trackArchiveResult(cacheTarget, repoSlug, dir, result, { escalate = escalateResidue, runner } = {}) {
  if (result.ok) {
    recordResidueSuccess(cacheTarget, 'move-failed', dir);
    // #1613: a dir that just successfully archived can no longer be
    // structurally stuck — clear any prior tracking so a future, unrelated
    // reuse of this path (unlikely — paths are timestamp-uniqued, but cheap
    // to guard) starts a fresh count rather than resuming a stale one.
    recordResidueSuccess(cacheTarget, 'structurally-stuck', dir);
    return;
  }
  // Archive-specific vocabulary — not part of the shared branching cache.js's
  // trackResidue dedups (#1233) — so it stays here, ahead of the shared
  // call, rather than moving inside it.
  // #2330: a genuinely diverged work twin (`work-twin-conflict` and its
  // resolve-failed variants) is exactly as structurally stuck as
  // `move-failed` — route it into the same residue-escalation streak instead
  // of dropping it silently on every pass. Each reason keeps its own bucket
  // (passed through as `result.reason` rather than folded into the literal
  // `'move-failed'` string) so a filed escalation issue names the actual
  // failure — a `work-twin-resolve-failed-partial-revert` is a worse state
  // than a clean `work-twin-conflict` and a human resolving the escalation
  // needs to tell them apart.
  if (result.reason !== 'move-failed'
    && result.reason !== 'work-twin-conflict'
    && result.reason !== 'work-twin-resolve-failed'
    && result.reason !== 'work-twin-resolve-failed-partial-revert') return;
  // Mirrors reap-merged.js's trackReapResidue: forward the underlying error
  // (now captured at each move-failed catch site above) into the shared
  // residue-tracking/escalation choke point.
  trackResidue(cacheTarget, repoSlug, result.reason, dir, { failed: true, lastError: result.lastError }, { escalate, runner });
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
// #1738: reduced to the shared iterator's own `{ status: 'clean' }` filter —
// same anchor, ordering, archive-twin skip, and `archiving`-claim skip every
// other iterRunDirsWithState caller already gets, rather than this file's own
// third hand-rolled copy of the walk.
// #3503: this sweep is exempt from the merged-partial record check — wrap-up
// already closed a `clean` run, so no record is still being built. #3668: this
// loop tracks only console-never-rendered-staged-pending skips of auto-merge
// short-circuit runs (see the clean loop's onSkip). close-run has already run,
// so no later step renders a console or applies those staged items, and
// archive-run refuses exactly that subset — an untracked skip would freeze the
// dir silently. Other closed no-console staged-pending runs stay untracked:
// they are typically in-terminal consoles that retain staged/ by design. The
// other skip reasons stay untracked too: their states (no-pr, pr-open, …) have
// their own resolution paths or are pre-existing behavior the #1733 test pins.
function iterCleanRunDirs(root) {
  return [...iterRunDirsWithState(root, { status: 'clean' })];
}

// Shared dryRun/track/push tail for archiveMerged's main-loop branches below
// (isArchivedPendingTrackedMove, isClosedSlugStuck, orphaned-mint,
// adhoc-superseded, the by-number fallback) — each reaches this exact
// dryRun-short-circuit-else-archive-and-track sequence once its own branch-
// specific `produceResult` is ready to run. Pulled out only because the tail
// itself was five byte-identical copies; every branch keeps its own
// condition, comment, and `continue` at the call site.
function finishArchiveAttempt(cacheTarget, repoSlug, dir, dryRun, runner, archived, skipped, produceResult) {
  if (dryRun) { archived.push(dir); return; }
  const result = produceResult();
  trackArchiveResult(cacheTarget, repoSlug, dir, result, { runner });
  if (!result.ok) { skipped.push({ runDir: dir, reason: result.reason }); return; }
  archived.push(dir);
}

// #3503: the caller-side half of the merged-partial gate, shared by the
// branch-joined path (archiveMergedRun) and the by-number fallback
// (byNumberRecordSkip) so neither re-derives it. `decideArchiveCore` stays pure;
// everything that needs I/O lives here. Any decision but a merged-partial skip
// passes through untouched. Otherwise, from the gate's `unclosed` set U:
//   1. empty linkage: a merged PR whose `closingIssuesReferences` is `[]` (not
//      absent) says nothing — GitHub links no closing keyword into a non-default
//      base branch — so only a record the run's manifest still lists pending or
//      running stays in U; every other record counts as satisfied.
//   2. the issue itself: a record whose GitHub issue is CLOSED (a second PR,
//      closed by hand, closed at /release) is satisfied. A probe failure or a
//      non-object answer keeps the record in U — fails closed.
// An empty U' archives exactly as the fully-closed path does; otherwise the skip
// stays merged-partial with U'.
function settleMergedPartial(root, dir, prState, decision) {
  if (decision.action !== 'skip' || decision.reason !== 'merged-partial') return decision;
  let unclosed = decision.unclosed;
  if (Array.isArray(prState.closingIssuesReferences) && prState.closingIssuesReferences.length === 0) {
    const inFlight = new Set(inFlightRecords(dir));
    unclosed = unclosed.filter((n) => inFlight.has(n));
  }
  unclosed = unclosed.filter((n) => {
    const issue = resolveIssueStateByNumber(root, n);
    return !(issue && typeof issue === 'object' && issue.state === 'CLOSED');
  });
  return unclosed.length > 0 ? { ...decision, unclosed } : { action: 'archive' };
}

// #3503: `work-backend: local-files` records are not GitHub issues, so a PR's
// closingIssuesReferences can never attest them: the record check stays off. The
// main checkout's CLAUDE.md is read once per pass; an absent or unreadable file,
// or an absent line, returns null and keeps the check (pr-first is GitHub-backed
// by construction). Same regex shape as wrap-up/pack.js's WORK_BACKEND_RE.
const WORK_BACKEND_RE = /^work-backend:\s*(\S+)\s*$/m;

function readWorkBackend(root) {
  try {
    const m = WORK_BACKEND_RE.exec(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// #3503: `unclosed` rides along on a merged-partial skip only; every other
// reason keeps the bare {runDir, reason} shape.
function skippedEntry(dir, { reason, unclosed }) {
  return unclosed === undefined ? { runDir: dir, reason } : { runDir: dir, reason, unclosed };
}

// #3503: the by-number fallback's record guard, for the MERGED branches that
// would archive. Reuses decideArchiveCore's own rule (hasStagedPending is false
// on both call sites, which are reached only once staged/ is clear or the
// console is resolved), settled by settleMergedPartial. Returns the skip
// decision, or null to proceed.
function byNumberRecordSkip(root, dir, byNumber, consoleState, records, repoSlug) {
  const decision = settleMergedPartial(
    root, dir, byNumber, decideArchiveCore(byNumber, consoleState, false, { records, repoSlug }),
  );
  return decision.action === 'skip' ? decision : null;
}

// #3416: a run's PR identity is its stamped run-state.json `pr.number`, not
// its branch name — a worktree branch name is reused across runs, so
// `gh pr list --head {branch}` can return a MERGED PR from an earlier run that
// shared the name and archive a live run. The by-branch lookup is the fallback
// only when no number is stamped (or the by-number probe returns null). Any
// failure string from the by-number probe (`'gh-absent'`, `'network-failure'`,
// `'invalid-arguments'`, `'pr-not-found'`) is returned as-is, never falling
// back to the branch: the branch lookup would reintroduce the same
// misattribution on a transient gh failure.
function resolveRunPrState(root, state, branch) {
  if (state && state.pr && state.pr.number) {
    const byNumber = resolvePrStateByNumber(root, state.pr.number);
    if (byNumber !== null) return byNumber;
  }
  return resolvePrState(root, branch);
}

// #1733: the merged-PR archive sequence both the main loop and the
// #1544 clean-status sweep run. The run's PR is resolved via resolveRunPrState
// (#3416: stamped `pr.number` first, `branch` second) -> decideArchiveCore ->
// (skip, with the caller's own onSkip hook) -> localHasMerge ->
// (skip on not-yet-caught-up) -> dryRun short-circuit -> archiveRunDir ->
// trackArchiveResult. `onSkip` is the one place the two callers genuinely
// differ: the main loop calls `trackStuckSkip` on every `decideArchiveCore`
// skip (#1613's structurally-stuck visibility); the clean loop passes a hook
// that tracks only console-never-rendered-staged-pending on auto-merge
// short-circuit runs (#3668) — see iterCleanRunDirs' comment for why that
// subset, and why the rest stay untracked.
function archiveMergedRun({
  root, repoSlug, dir, branch, state, dryRun, onSkip, runner, cacheTarget = root, integration, recordCheck,
}) {
  const prState = resolveRunPrState(root, state, branch);
  const consoleState = readConsoleState(dir);
  // #3249: decideArchiveCore directly, not decideArchive — that thin wrapper
  // routes through classifyRunDir without a `dir`, so the staged-items
  // exception (hasStagedPending) could never fire on this, the ordinary
  // production path pr-first-merge-post-merge.md Step 4.2's reconcile hits.
  // #3503: `recordCheck` (the run's required records) is omitted by the clean
  // sweep on purpose — see iterCleanRunDirs.
  const decision = settleMergedPartial(
    root, dir, prState, decideArchiveCore(prState, consoleState, hasStagedItems(dir), recordCheck),
  );
  if (decision.action === 'skip') {
    if (onSkip) onSkip(decision.reason);
    return { outcome: 'skipped', reason: decision.reason, unclosed: decision.unclosed };
  }

  const hasMerge = localHasMerge(root, prState.mergeCommit, integration);
  if (hasMerge !== true) {
    return { outcome: 'skipped', reason: hasMerge === false ? 'local-behind-merge' : 'merge-commit-unknown' };
  }
  if (dryRun) return { outcome: 'archived' };

  const result = archiveRunDir(root, dir);
  trackArchiveResult(cacheTarget, repoSlug, dir, result, { runner });
  if (!result.ok) return { outcome: 'skipped', reason: result.reason };
  return { outcome: 'archived' };
}

function archiveMerged({
  cwd, dryRun = false, sessionId = process.env.CLAUDE_CODE_SESSION_ID || null, runner, integration,
} = {}) {
  const archived = [];
  const skipped = [];
  const start = cwd || process.cwd();
  const root = mainCheckoutRoot(start);
  if (!root) return { archived, skipped };
  const repoSlug = repoSlugOf(root);
  // #3503: read once per pass — see readWorkBackend.
  const recordCheckApplies = readWorkBackend(root) !== 'local-files';

  const wtList = runGit(['worktree', 'list', '--porcelain'], root);
  const worktrees = wtList.failure ? [] : parseWorktreeList(wtList.stdout);

  // #1235: one read before both loops below, one write after — instead of
  // one read-modify-write per archived/skipped/stuck item. See cache.js's
  // `beginCacheBatch` for the atomicity tradeoff this accepts.
  const cacheBatch = beginCacheBatch(root);

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
      finishArchiveAttempt(cacheBatch, repoSlug, dir, dryRun, runner, archived, skipped, () => archiveRunDir(root, dir));
      continue;
    }

    // #1811 Deliverable 3: a config.yml-only dir with no run-state.json at
    // all (the 1378-816 shape) has no branch, no PR, and nothing the
    // classifier below or the by-number probe further down can resolve — it
    // otherwise escalates at structurally-stuck forever. Terminal once every
    // record named in its own slug is independently CLOSED. Checked ahead of
    // the classifier (which requires a `state` object to say anything at all
    // about abandoned-interrupted/adhoc-superseded, and would answer
    // 'orphaned-mint' — wrongly — for this shape, since config.yml IS
    // present here) and never tracked toward move-failed/structurally-stuck
    // escalation on success (trackArchiveResult's own success branch clears
    // both).
    if (isClosedSlugStuck(root, dir, state)) {
      finishArchiveAttempt(cacheBatch, repoSlug, dir, dryRun, runner, archived, skipped, () => archiveRunDir(root, dir));
      continue;
    }

    // iterRunDirsWithState already excludes status: 'clean' — every dir
    // reached here is genuinely non-terminal.
    //
    // #1732: one classification call covering the three TTL-based lifecycle
    // kinds this loop used to check as separate, interleaved early-return
    // branches (orphaned-mint, abandoned-interrupted, adhoc-superseded), then
    // one dispatch per kind below — a per-kind action table, not a
    // detector-specific chain. Precedence is classifyRunDir's own
    // first-match order, unchanged from what this loop checked before
    // consolidation.
    const classification = classifyRunDir({
      dir, state, worktrees, sessionId, kinds: ['orphaned-mint', 'abandoned-interrupted', 'adhoc-superseded'],
    });
    let { kind } = classification;
    // #1673/#1732: the `checkRunIntegrity` shipped-unclosed evidence gate is
    // call-site-only (classifyRunDir's own comment explains why it can't be
    // folded into the kind itself). A dir that classifies
    // 'abandoned-interrupted' but fails this companion check is NOT actually
    // that kind — it falls through to the next-lower-precedence kind
    // (adhoc-superseded) exactly as the pre-consolidation `&&`-chained
    // early-return did, via one small follow-up classify call scoped to just
    // that remaining kind.
    if (kind === 'abandoned-interrupted' && checkRunIntegrity(dir).state !== 'shipped-unclosed') {
      kind = classifyRunDir({ dir, state, worktrees, kinds: ['adhoc-superseded'] }).kind;
    }

    if (kind === 'orphaned-mint') {
      // #2227: tracked content (a materialized work/ spec) needs archiveRunDir's
      // git mv + commit — same (root, dir) signature and {ok, reason} contract,
      // so the result handling below is shared. A bare mint with nothing
      // tracked keeps the fs-only move; see hasTrackedContent above.
      finishArchiveAttempt(cacheBatch, repoSlug, dir, dryRun, runner, archived, skipped, () => (
        hasTrackedContent(root, dir) ? archiveRunDir(root, dir) : archiveOrphanedMint(root, dir)
      ));
      continue;
    }

    // #1673: an abandoned `interrupted` run whose work actually shipped. This
    // has to sit ahead of the no-worktree/no-branch skips below: those are
    // exactly where such a run dies today, because its worktree was torn down
    // long ago and there is no live entry to derive a branch from. #1672's
    // fallback evidence is what lets checkRunIntegrity answer at all here.
    if (kind === 'abandoned-interrupted') {
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
      trackArchiveResult(cacheBatch, repoSlug, dir, archiveResult, { runner });
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
      // `explicit: true` is defensible ONLY because classifying
      // 'abandoned-interrupted' plus the shipped-unclosed evidence gate have
      // ALREADY made the ownership determination upstream, above — this call
      // site owns that decision instead of delegating it to closeRunState's
      // own foreign-owner refusal, rather than claiming ownership doesn't
      // matter here. Weakening either upstream gate would silently weaken
      // this bypass too.
      const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', path.basename(dir));
      // #1012: closeRunState now takes callerIdentity ({ sessionId, cwd })
      // instead of a bare sessionId — explicit: true still bypasses the
      // foreign-owner refusal regardless (see the comment above), so this
      // is a signature-consistency update, not a behavior change here.
      // #2553: `treatCleanAsAlreadyClosed: false` — archiveRunDir (just
      // above) already wrote `status: 'clean'` to archiveDir as its OWN
      // bookkeeping step in this same synchronous sequence, never via a
      // prior closeRunState call, so this is the first and only real
      // close-without-wrapup check for this run; closeRunState's own
      // already-clean suppression (meant for a genuinely repeated close —
      // see that function's header comment) must not fire here.
      const closeResult = closeRunState(archiveDir, {
        explicit: true, callerIdentity: { sessionId, cwd }, treatCleanAsAlreadyClosed: false,
      });
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
    // sweep a still-live ad-hoc session) is unchanged: classifyRunDir never
    // returns 'adhoc-superseded' while the worktree still resolves, regardless
    // of age.
    if (kind === 'adhoc-superseded') {
      // archiveRunDir, not archiveOrphanedMint: an ad-hoc-standalone dir is a
      // real dev session that can have materialized a spec (a git-tracked work/
      // subtree) before being abandoned. archiveOrphanedMint is a bare
      // fs.renameSync with no tracked-entry guard — archiveRunDir's #593 guard
      // (git-mv work/ + commit, refuse on any other tracked entry) is what this
      // path needs; same (root, dir) signature and {ok, reason} contract. The
      // orphaned-mint branch above makes the same choice per-dir via
      // hasTrackedContent (#2227) — this branch is unconditional because an
      // ad-hoc dir is always a real session, tracked spec or not.
      finishArchiveAttempt(cacheBatch, repoSlug, dir, dryRun, runner, archived, skipped, () => archiveRunDir(root, dir));
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
    // #3503: the run's required record ids, computed once for both the
    // branch-joined path below and the by-number fallback.
    const records = recordCheckApplies ? runRecordSet(dir) : null;
    const stampedWorktree = (state && state.worktree) || null;
    const wtEntry = stampedWorktree
      ? worktrees.find((w) => path.resolve(w.path) === path.resolve(stampedWorktree))
      : null;
    const branch = (wtEntry && wtEntry.branch) || fallbackBranch(root, dir, state);
    if (!branch) {
      const reason = stampedWorktree ? 'no-branch' : 'no-worktree';
      // #1962: a run dir whose branch can't be derived at all (fallbackBranch
      // above already tried and failed) has nothing to query `resolvePrState`
      // with — but run-state.json's `pr.number` (stamped once at PR-early
      // lifecycle time, never cleared) still names the PR. Probe it directly
      // by number instead of skipping 'no-branch'/'no-worktree' forever.
      // #2228: this fires whenever `state.pr.number` exists, regardless of
      // whether `stampedWorktree` was ever set — a run whose worktree was
      // never stamped in the first place (the #1684 gap) deserves the same
      // by-number probe as one whose stamped worktree just got torn down.
      // #2226: a closed-unmerged PR has nothing to wait for (no merge commit
      // to catch up on) and archives immediately once its console (if any)
      // is resolved; a MERGED PR reaches the same archive path, but only
      // once `localHasMerge` confirms the local checkout has actually caught
      // up on its merge commit — mirroring the general merged-PR path below.
      let skipReason = reason;
      if (state && state.pr && state.pr.number) {
        const byNumber = resolvePrStateByNumber(root, state.pr.number);
        // #3543: a stamped pr.number GitHub confirms names no PR is a stale
        // stamp, not an absent branch/worktree — report the real cause.
        if (byNumber === 'pr-not-found') skipReason = 'pr-not-found';
        if (byNumber && typeof byNumber === 'object' && (byNumber.state === 'CLOSED' || byNumber.state === 'MERGED')) {
          if (byNumber.state === 'MERGED') {
            const hasMerge = localHasMerge(root, byNumber.mergeCommit, integration);
            if (hasMerge !== true) {
              skipped.push({ runDir: dir, reason: hasMerge === false ? 'local-behind-merge' : 'merge-commit-unknown' });
              continue;
            }
          }
          const consoleState = readConsoleState(dir);
          if (consoleState === 'unresolved') {
            skipped.push({ runDir: dir, reason: 'console-unresolved' });
            continue;
          }
          if (consoleState === 'none') {
            // #3249: a MERGED PR with nothing pending in staged/ is the
            // fast-lane auto-merge short-circuit's own normal shape — its
            // console was never written at all, not left unresolved — so
            // archive it the same way the ordinary branch-joined path now
            // does (decideArchiveCore's hasStagedPending exception above).
            // A CLOSED (never-merged) PR keeps the distinct, tracked reason
            // below unconditionally — there's no run left to converge
            // toward regardless of staged/'s contents.
            if (byNumber.state === 'MERGED' && !hasStagedItems(dir)) {
              const guard = byNumberRecordSkip(root, dir, byNumber, consoleState, records, repoSlug);
              if (guard) {
                skipped.push(skippedEntry(dir, guard));
                trackStuckSkip(cacheBatch, repoSlug, dir, guard.reason, { runner });
                continue;
              }
              finishArchiveAttempt(cacheBatch, repoSlug, dir, dryRun, runner, archived, skipped, () => archiveRunDir(root, dir));
              continue;
            }
            // #2231: a CLOSED (never-merged) PR's console will never
            // render — nothing drives this run's pipeline to wrap-up
            // anymore, so the plain 'console-never-rendered' reason's
            // usual "a human answers the console" resolution path
            // (STRUCTURALLY_STUCK_REASONS' own comment above) does not
            // apply here. Use a distinct, tracked reason so this
            // genuinely dead-ended state escalates like no-branch/
            // no-worktree/no-pr, instead of silently freezing the
            // escalation cache the way plain 'console-never-rendered'
            // does. #3297: the MERGED sub-case reached here holds real
            // pending staged/ items a human must still resolve, so it gets
            // its own tracked reason too.
            const consoleReason = byNumber.state === 'CLOSED' ? 'console-never-rendered-pr-closed' : 'console-never-rendered-staged-pending';
            skipped.push({ runDir: dir, reason: consoleReason });
            trackStuckSkip(cacheBatch, repoSlug, dir, consoleReason, { runner });
            continue;
          }
          if (byNumber.state === 'MERGED') {
            const guard = byNumberRecordSkip(root, dir, byNumber, consoleState, records, repoSlug);
            if (guard) {
              skipped.push(skippedEntry(dir, guard));
              trackStuckSkip(cacheBatch, repoSlug, dir, guard.reason, { runner });
              continue;
            }
          }
          finishArchiveAttempt(cacheBatch, repoSlug, dir, dryRun, runner, archived, skipped, () => archiveRunDir(root, dir));
          continue;
        }
      }
      skipped.push({ runDir: dir, reason: skipReason });
      trackStuckSkip(cacheBatch, repoSlug, dir, skipReason, { runner });
      continue;
    }

    const runResult = archiveMergedRun({
      root, repoSlug, dir, branch, state, dryRun, runner, cacheTarget: cacheBatch, integration,
      recordCheck: { records, repoSlug },
      onSkip: (reason) => trackStuckSkip(cacheBatch, repoSlug, dir, reason, { runner }),
    });
    if (runResult.outcome === 'archived') { archived.push(dir); continue; }
    skipped.push(skippedEntry(dir, runResult));
  }

  // #1544: the clean-status sweep — see iterCleanRunDirs' own comment.
  // `state.worktree` is already null by construction (close-run's write), so
  // the ordinary worktree-list branch lookup above can't answer here; reuse
  // run-integrity.js's own torn-down-worktree fallback (state.pr.branch, or
  // decisions.md's PR-early lifecycle lines) instead. Otherwise identical to
  // the main loop: decideArchiveCore's merged-PR + resolved-console gate, then
  // the same local-fast-forward check before any move — via the same
  // archiveMergedRun helper. Its onSkip tracks only
  // console-never-rendered-staged-pending on auto-merge short-circuit runs:
  // archive-run refuses exactly that closed subset (#3668), so an untracked skip
  // would freeze the dir. Other closed no-console staged-pending runs stay
  // untracked (typically in-terminal consoles that retain staged/ by design).
  for (const { dir, state } of iterCleanRunDirs(root)) {
    const branch = fallbackBranch(root, dir, state);
    if (!branch) { skipped.push({ runDir: dir, reason: 'no-branch' }); continue; }

    const runResult = archiveMergedRun({
      root, repoSlug, dir, branch, state, dryRun, runner, cacheTarget: cacheBatch, integration,
      onSkip: (reason) => {
        if (reason === 'console-never-rendered-staged-pending' && consoleReplacedByAutoMergeShortCircuit(dir)) trackStuckSkip(cacheBatch, repoSlug, dir, reason, { runner });
      },
    });
    if (runResult.outcome === 'archived') { archived.push(dir); continue; }
    skipped.push({ runDir: dir, reason: runResult.reason });
  }

  // #1235: flush the batched residue updates from both loops above BEFORE
  // pruneResidueFailures reads the cache — that call does its own
  // independent readCache/writeCache round-trip (a single call per pass, not
  // per item, so it was never part of this record's batching scope), and
  // needs to see this pass's own updates rather than stale on-disk state.
  commitCacheBatch(cacheBatch);

  // #1892 Deliverable 3: prune residueFailures entries whose live path no
  // longer exists — after every archival attempt this pass made, so a path
  // this very pass just archived is pruned via recordResidueSuccess above,
  // never re-examined here. A real GitHub write (closing an escalated
  // record) belongs behind the same dry-run guard every other outward write
  // in this module already respects.
  if (!dryRun) pruneResidueFailures(root, repoSlug, { runner });

  return { archived, skipped };
}

module.exports = {
  archiveMerged, decideArchive, decideArchiveCore, unclosedRecords, readConsoleState, archiveRunDir, listSpecDirs,
  isStaleDir, classifyRunDir,
  isOrphanedMint, isAdHocStandaloneMint, archiveOrphanedMint, ORPHAN_MINT_TTL_MS, trackArchiveResult,
  localHasMerge, lastOwnEventMs, isAbandonedInterrupted, STALE_INTERRUPTED_TTL_MS,
  isAdHocStandaloneSuperseded, ADHOC_SUPERSEDED_TTL_MS,
  isStructurallyStuck, trackStuckSkip, STRUCTURALLY_STUCK_TTL_MS, STRUCTURALLY_STUCK_REASONS,
  isArchivedPendingTrackedMove, archivedPendingTrackedMoveCommand,
  compareWorkTwin, resolveIdenticalWorkTwin, listFilesRecursive,
  isClosedSlugStuck, recordNumbersFromSlug, runRecordSet, inFlightRecords,
  listStagedItems, hasStagedItems, consoleReplacedByAutoMergeShortCircuit,
  refusal,
};
