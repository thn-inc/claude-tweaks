// bin/lib/reconcile/archive-branches.js — convergence check: archive or
// delete abandoned plugin-owned LOCAL branches, and age out the archive/*
// tags the archival path creates. Pure decision functions with I/O at the
// edges, matching release-merged.js's pattern. All mutations are local to
// this checkout — never a pushed deletion, never a pushed tag; different
// checkouts converge independently. Origin-side cleanup belongs to PR
// merges, tidy's remote-ref pruning, and — for plugin-owned branches
// proven merged (MERGED PR + cherry-equivalence or squash provenance) —
// the sibling prune-remote.js check, the family's one pushed mutation.
//
// Tags created here are annotated local tags (`git tag -a -f`), aged from
// their own tagger date — the clock starts when the tag is created, not
// when the tagged commit was authored, since the tip commit can already be
// >90 days old at archival time (an aged branch is exactly what this check
// tags). A legacy lightweight tag (no tagger date) falls back to aging from
// its tagged commit's committer date.
//
// `git cherry {integration} {branch}` is the merged-in-substance evidence —
// it catches single-commit squash merges and rebases that ancestry checks
// and `git branch -d` both miss; that is why execution uses `-D` behind
// this decision table and never trusts `-d`'s verdict. It cannot see a
// multi-commit branch squashed into one commit (#2251's `gh pr merge
// --squash`): squash-provenance.js (#2252) is the second proof for that
// shape — the confirmed PR's own mergeCommit on the bounded first-parent
// history — evaluated only where cherry says no.
//
// Screen-then-confirm (#1083, adopting #1082's shape): in-scope branches are
// screened in one bulk call (resolvePrStatesBulk) before any per-branch
// work, and only a destructive provisional verdict (delete or
// tag-and-delete) re-reads PR state per-branch to confirm. NO preferOpen
// here, on screen or confirm: #664 deliberately scoped the destructive
// tie-break to prune-remote — archive's deletes are local-only and
// recoverable from origin.
//
// A screen failure degrades to per-branch gh-absent/network-failure skips
// (the pre-#1083 shape) rather than a check-level failure: the archive-tag
// aging sweep is wholly gh-independent and keeps running — a permanently
// gh-absent environment must not lose tag GC (#1083 review). prune-remote's
// check-level pr-screen-failed differs deliberately: it guards no secondary
// sweep.
'use strict';

const { runGit } = require('../hooks/git-exec');
const { parseWorktreeList } = require('../hooks/worktree-reap');
const { resolvePrState, resolvePrStatesBulk } = require('./pr-state');
const { isSquashMerged } = require('./squash-provenance');

const BRANCH_AGE_DAYS = 14; // hardcoded by design — no policy lever
const TAG_AGE_DAYS = 90; // matches git's default reflog window: past it, the tag's marginal recovery value is zero

// Plugin-owned branch namespaces. No canonical source elsewhere in the repo —
// maintained manually here; a future plugin-owned prefix must be added by
// hand or its branches silently never age out.
const SCOPE_PATTERNS = [/^build\//, /^worktree-/, /^demo\//];

// Scope guard — runs BEFORE decideArchive is ever called. `worktrees` is
// parseWorktreeList output (bin/lib/hooks/worktree-reap.js), reused not
// reimplemented; a branch attached to any live worktree is never touched.
function inScope(branch, worktrees) {
  if (!SCOPE_PATTERNS.some((re) => re.test(branch))) return false;
  return !worktrees.some((w) => w.branch === branch);
}

// One branch's evidence -> what to do. Pure — no I/O.
//   { action: 'delete' | 'tag-and-delete' | 'skip', reason }
// squashMerged (#2252) is the second merged-in-substance proof, consulted
// only where cherryEquivalent is false; screen-time callers omit it.
function decideArchive({ branch, tipAgeDays, cherryEquivalent, squashMerged = false, prState }) {
  if (prState === 'gh-absent' || prState === 'network-failure') {
    return { action: 'skip', reason: prState }; // evidence unknown — fail closed
  }
  if (prState && prState.state === 'OPEN') {
    return { action: 'skip', reason: 'pr-open' }; // an open PR means work may be landing
  }
  if (cherryEquivalent) {
    return { action: 'delete', reason: 'cherry-equivalent' }; // merged in substance — no tag needed
  }
  // No PR at all, or a PR closed without merging: nothing landed, so age
  // alone decides. #2252 review F4: this sits ABOVE the squashMerged clause
  // (moved from above it) — isSquashMerged only ever returns true alongside
  // a confirmed prState.state === 'MERGED', so `squashMerged: true` paired
  // with a null/CLOSED prState is not a real proof (a stale or malformed
  // caller), exactly the shape the age rules exist to guard; a young branch
  // must still read too-young rather than deleting on that unproven flag.
  const nothingLanded = prState === null || (prState && prState.state === 'CLOSED');
  if (nothingLanded) {
    if (tipAgeDays > BRANCH_AGE_DAYS) {
      return { action: 'tag-and-delete', reason: `unmerged-aged: ${Math.floor(tipAgeDays)}d > ${BRANCH_AGE_DAYS}d` };
    }
    return { action: 'skip', reason: 'too-young' };
  }
  if (squashMerged) {
    return { action: 'delete', reason: 'squash-merged' }; // merged in substance via the confirmed PR's own squash commit
  }
  // Exhaustive (order: gh-absent/network-failure -> OPEN -> cherry-equivalent
  // -> nothingLanded/age -> squashMerged -> here): only a MERGED PR reaches
  // this line, and neither proof holds — not patch-equivalent, and no squash
  // commit of its own on the tip.
  return { action: 'skip', reason: 'merged-pr-without-cherry-equivalence' }; // rebased remnant — human territory
}

// Tag aging: pure threshold check against a single ISO date. The call site
// selects which date (tagger, falling back to committer) to pass in.
// Unparseable/empty dates fail closed (kept).
function shouldAgeTag(dateIso, nowMs) {
  const t = Date.parse(dateIso);
  if (Number.isNaN(t)) return false;
  return nowMs - t > TAG_AGE_DAYS * 24 * 60 * 60 * 1000;
}

// branch name -> a flat (no '/'), injective tag suffix. Minimal percent-
// encoding: '/' -> '%2f' and a literal '%' -> '%25' (escaped so an
// already-percent-encoded-looking substring in the branch name, e.g.
// `a%2fb`, can never be mistaken for an encoded slash); every other
// character — including '-' — passes through unchanged. An earlier version
// of this function doubled literal '-' to '--' before the slash
// substitution: that scheme was NOT actually injective (a literal '-'
// immediately adjacent to a '/' collapses run-length information —
// `encodeArchiveTagSuffix('ab-/cd')` and `encodeArchiveTagSuffix('ab/-cd')`
// both produced `'ab---cd'`), which — combined with the tag-creation call
// site's `-f` force flag — could silently overwrite one branch's archive
// tag with another's. Percent-encoding avoids the whole class: '%' is
// escaped first (single pass, so the escape itself is never re-scanned),
// so every '%' surviving in the output unambiguously starts one of exactly
// two fixed 3-character sequences, and no other character ever produces a
// spurious '%' or '/'. '%' is valid in a git ref component (verified: git
// accepts `archive/build%2ffoo`; rejects tilde-based alternatives outright).
// Never returns a string containing '/'. See #548.
function encodeArchiveTagSuffix(branch) {
  return branch.replace(/[%/]/g, (ch) => '%' + ch.charCodeAt(0).toString(16));
}

// Cherry equivalence: every commit on the branch is patch-equivalent to one
// already on the integration branch (`git cherry` lines all start with '-';
// empty output = no unique commits at all). A cherry failure fails closed.
function isCherryEquivalent(root, integration, branch) {
  const r = runGit(['cherry', integration, branch], root);
  if (r.failure || r.stdout === null) return null; // unknown — fail closed at the call site
  const lines = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  return lines.every((l) => l.startsWith('-'));
}

function archiveBranches({ cwd, integration, dryRun, now, resolvePr, resolvePrBulk } = {}) {
  const root = cwd || process.cwd();
  const nowMs = now || Date.now();
  const resolve = resolvePr || resolvePrState;
  const resolveBulk = resolvePrBulk || resolvePrStatesBulk;
  const entries = [];

  const wtList = runGit(['worktree', 'list', '--porcelain'], root);
  if (wtList.failure) return { entries, failure: 'git-failure' };
  const worktrees = parseWorktreeList(wtList.stdout);

  const refs = runGit(['for-each-ref', '--format=%(refname:short)\t%(committerdate:iso8601-strict)\t%(objectname)', 'refs/heads'], root);
  if (refs.failure) return { entries, failure: 'git-failure' };

  // Collect in-scope branches (with their committerDate/tip) first — the
  // screen is one bulk call (#1083, adopting #1082's screen-then-confirm).
  // No preferOpen, screen or confirm — deliberate; see the module header (#664 census).
  const candidates = [];
  for (const line of refs.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const [branch, committerDate, tip] = line.split('\t');
    if (!inScope(branch, worktrees)) continue;
    candidates.push({ branch, committerDate, tip });
  }

  const screen = candidates.length > 0
    ? resolveBulk(root, candidates.map((c) => c.branch))
    : new Map();

  if (screen === 'gh-absent' || screen === 'network-failure') {
    // Degrade to per-branch skips (the pre-#1083 shape) rather than a
    // check-level failure: the archive-tag aging sweep below is wholly
    // gh-independent and must keep running in a gh-absent environment
    // (#1083 review, reproduced) — unlike prune-remote, whose check-level
    // pr-screen-failed return guards no such secondary sweep.
    for (const { branch } of candidates) {
      entries.push({ name: branch, kind: 'branch', action: 'skip', reason: screen });
    }
  } else {
    for (const { branch, committerDate, tip } of candidates) {
      const tipAgeDays = (nowMs - Date.parse(committerDate)) / (24 * 60 * 60 * 1000);
      const screenPr = screen.get(branch) || null;

      // OPEN-screened branches skip before cherry: decideArchive checks OPEN
      // before cherryEquivalent (order pinned by the existing 'open PR -> skip,
      // even when cherry-equivalent' test), so cherryEquivalent: true here is a
      // documented sentinel that never reaches the cherry-driven branches.
      if (screenPr && screenPr.state === 'OPEN') {
        // Provisional verdict on screen evidence, through the UNCHANGED decision
        // table — same shape as prune-remote's screen fast path. Falling through
        // (provisional.action !== 'skip') is never expected for an OPEN-screened
        // branch (decideArchive checks OPEN before cherryEquivalent), but is
        // deliberately NOT a silent skip: it drops to the normal cherry path below.
        const provisional = decideArchive({ branch, tipAgeDays, cherryEquivalent: true, prState: screenPr });
        if (provisional.action === 'skip') {
          entries.push({ name: branch, kind: 'branch', action: provisional.action, reason: provisional.reason });
          continue;
        }
      }

      const cherryEquivalent = isCherryEquivalent(root, integration, branch);
      if (cherryEquivalent === null) {
        entries.push({ name: branch, kind: 'branch', action: 'skip', reason: 'cherry-failed' });
        continue;
      }
      const provisional = decideArchive({ branch, tipAgeDays, cherryEquivalent, prState: screenPr });
      // #2252: a MERGED-screened branch cherry could not prove is the
      // squash-merge shape. Its verdict is not final on screen evidence —
      // mergeCommit rides only on the per-branch confirm — so it joins the
      // destructive candidates below instead of skipping here. ROUTING only
      // (#2252 review F2): squashCandidate decides whether a provisional
      // skip proceeds to the confirm — it does NOT gate whether squashMerged
      // gets computed below. A screen-null branch (the deleted-ref blind
      // spot, e.g. after `gh pr merge --delete-branch`) already reaches the
      // confirm via the age-driven tag-and-delete provisional with
      // squashCandidate false; hardcoding squashMerged to false in that case
      // would discard the confirm's own MERGED-with-mergeCommit verdict and
      // skip the branch forever.
      const squashCandidate = !cherryEquivalent && Boolean(screenPr) && screenPr.state === 'MERGED';
      if (provisional.action === 'skip' && !squashCandidate) {
        entries.push({ name: branch, kind: 'branch', action: 'skip', reason: provisional.reason });
        continue;
      }

      // Destructive candidate (delete or tag-and-delete) or squash candidate:
      // re-read PR state per-branch — today's exact evidence — and re-decide.
      // Cherry is reused, not recomputed: same pass, same local refs,
      // deterministically identical. Runs under dryRun too, so dry-run
      // reasons are confirmed reasons. squashMerged is computed unconditionally
      // off the confirm's own prState (#2252 review F2, matching
      // prune-remote.js) — never gated on squashCandidate, which only routes.
      const prState = resolve(root, branch);
      const squashMerged = cherryEquivalent ? false : isSquashMerged(root, integration, branch, prState);
      const decision = decideArchive({ branch, tipAgeDays, cherryEquivalent, squashMerged, prState });
      if (decision.action === 'skip' || dryRun) {
        entries.push({ name: branch, kind: 'branch', action: decision.action, reason: decision.reason });
        continue;
      }
      if (decision.action === 'tag-and-delete') {
        // Annotated + force-created: -f also fixes the retry dead-end where a
        // pre-existing archive/{encoded-branch} tag from an earlier failed
        // pass would permanently block archival — the tag is simply recreated
        // at the same tip.
        const tag = runGit(['tag', '-a', '-f', '-m', `archive of ${branch}`, `archive/${encodeArchiveTagSuffix(branch)}`, tip], root);
        if (tag.failure) {
          entries.push({ name: branch, kind: 'branch', action: 'skip', reason: 'tag-failed' }); // fail closed: never delete untagged
          continue;
        }
      }
      const del = runGit(['branch', '-D', branch], root); // -D behind the decision table's evidence — -d's verdict is explicitly not trusted
      entries.push(del.failure
        ? { name: branch, kind: 'branch', action: 'skip', reason: 'delete-failed' }
        : { name: branch, kind: 'branch', action: decision.action, reason: decision.reason });
    }
  }

  // Tag aging — archive/* tags whose age (from tagger date for annotated
  // tags this check creates, falling back to committer date for legacy
  // lightweight tags) exceeds TAG_AGE_DAYS.
  const tags = runGit(['for-each-ref', '--format=%(refname:short)\t%(taggerdate:iso8601-strict)\t%(committerdate:iso8601-strict)', 'refs/tags/archive'], root);
  if (!tags.failure) {
    for (const line of tags.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
      const [tag, taggerDate, committerDate] = line.split('\t');
      const ageDate = taggerDate || committerDate;
      if (!shouldAgeTag(ageDate, nowMs)) continue;
      if (dryRun) { entries.push({ name: tag, kind: 'tag', action: 'aged-out', reason: 'dry-run' }); continue; }
      const del = runGit(['tag', '-d', tag], root);
      entries.push(del.failure
        ? { name: tag, kind: 'tag', action: 'skip', reason: 'delete-failed' }
        : { name: tag, kind: 'tag', action: 'aged-out', reason: `> ${TAG_AGE_DAYS}d` });
    }
  }

  return { entries, failure: null };
}

module.exports = { decideArchive, inScope, shouldAgeTag, archiveBranches, BRANCH_AGE_DAYS, TAG_AGE_DAYS, isCherryEquivalent, encodeArchiveTagSuffix };
