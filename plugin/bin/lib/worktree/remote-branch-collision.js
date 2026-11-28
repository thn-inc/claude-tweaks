// bin/lib/worktree/remote-branch-collision.js — classifies a same-name branch
// on `origin` for a run that ADOPTED its worktree instead of creating one
// (#2844).
//
// `build/worktree-setup.md` Step 1.6 (Remote-only stale branch check) runs
// only on the creation path, before `EnterWorktree`. A run that arrives
// already inside a worktree — a dispatched group, a multi-spec shared
// worktree, an interactive session's adopted worktree — skips Steps 1-3, so
// nothing probed `origin` for the adopted branch's name before the PR-early
// push, and an unrelated stale branch surfaced only as a non-fast-forward
// rejection. This module is the adopt-path counterpart.
//
// Step 1.6 can treat any remote ref as a collision because its precondition
// is "no local branch of this name exists yet". The adopt path cannot: the
// local branch exists and may legitimately already be on origin (this run's
// own earlier push — a resumed build, or records 2..N of a multi-spec run).
// Ancestry is the mechanical distinction: a remote tip contained in local
// HEAD is this branch's own history and a push fast-forwards it; a remote
// tip that is not contained would reject the push.
//
// #3887: a dispatched retry is the one adopt-path run whose fresh local branch
// legitimately meets its own record's earlier, failed attempt on origin (PR
// closed, branch left behind) — `foreign` by ancestry, though not unrelated.
// `findPriorAttemptPr` recognizes it by PR identity, and checks that the closed
// PR's head is an ancestor of origin's tip (not that the tip equals it): commits
// pushed after the PR closed must still count as the same attempt (Review Focus 1).
//
// #4058: PR identity alone also matched a PR a human closed to reject the branch, so a
// retry silently merged the rejected commits. A closed PR is now this record's own
// tombstone only with evidence: a trusted `Attempt N failed` issue comment within
// TOMBSTONE_CLOSE_WINDOW_MS before its `closedAt` (what settle-and-merge.md Step 6 step 5
// leaves). Reading A: only the newest closed same-repo PR on the branch is judged, so
// an older tombstone never legitimizes a newer human close. Reading B: a newer
// same-repo OPEN/draft/MERGED PR blocks adoption, so live or merged work is never
// merged into a retry.
// #5589: `checkAdoptedBranch` composes the whole check — classify, PR lookup,
// prior-attempt recognition, stop card — into one call, so the build skill's
// collision check is one CLI invocation instead of an inline script.
'use strict';

const { execFileSync } = require('child_process');
const { GH_TIMEOUT_MS } = require('../shared-primitives');
const { ghOptions } = require('../repo-resolve');
const { firstLineRunId } = require('../flow/pr-checklist');
const { prClosesIssue } = require('../reconcile/release-merged');
const { isValidBranchName } = require('../branch-name');
const { ATTEMPT_RE } = require('../issues/retry');
const { isTrustedComment } = require('../issues/comment-trust');

// Throws on a non-zero exit; the thrown error carries `.status`.
function defaultGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
    windowsHide: true,
  });
}

function defaultGh(args) {
  return execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, windowsHide: true,
  }));
}

// settle-and-merge.md Step 6 step 5 posts the `Attempt N failed` comment, then closes the
// PR, so a real tombstone's comment lands within seconds of its `closedAt`. The window is
// generous slack for clock skew and a slow close; a comment older than it is a stale marker
// from an earlier attempt, not evidence about this close.
const TOMBSTONE_CLOSE_WINDOW_MS = 15 * 60 * 1000;

const SHA_RE = /^[0-9a-f]{40,64}$/;

// Reads origin's tip for exactly `refs/heads/{branch}`. The full ref is passed
// (never the bare name) because `ls-remote` tail-matches a bare pattern, so
// `x` would also match `refs/heads/team/x`; the output is filtered on the
// exact ref for the same reason.
function readRemoteTip({ branch, git }) {
  const ref = `refs/heads/${branch}`;
  let out;
  try {
    out = git(['ls-remote', '--heads', 'origin', ref]);
  } catch (err) {
    return { ok: false, error: err };
  }
  for (const line of String(out).split('\n')) {
    const [sha, name] = line.trim().split(/\s+/);
    if (name === ref && SHA_RE.test(sha || '')) return { ok: true, sha };
  }
  return { ok: true, sha: null };
}

// `git merge-base --is-ancestor` exits 0 (ancestor), 1 (not an ancestor), or
// something else (typically 128 — the object is not in this repository).
function isAncestorOfHead({ sha, git }) {
  try {
    git(['merge-base', '--is-ancestor', sha, 'HEAD']);
    return { known: true, ancestor: true };
  } catch (err) {
    if (err && err.status === 1) return { known: true, ancestor: false };
    return { known: false, error: err };
  }
}

// Returns one of:
//   { state: 'absent' }                       — no such branch on origin; push creates it
//   { state: 'mine', remoteSha }              — origin's tip is in local HEAD's history (resume)
//   { state: 'foreign', remoteSha }           — origin's tip is NOT in local HEAD's history
//   { state: 'unreachable', reason, error }   — could not determine; caller fails open
//
// `unreachable` is never folded into `absent`: "could not look" and "looked,
// nothing there" must stay distinguishable in the caller's log.
function classifyRemoteBranch({ branch, git = defaultGit }) {
  // A malformed name degrades to `unreachable` rather than reaching git.
  if (!isValidBranchName(branch)) {
    return { state: 'unreachable', reason: 'invalid-branch-name' };
  }

  const tip = readRemoteTip({ branch, git });
  if (!tip.ok) return { state: 'unreachable', reason: 'ls-remote-failed', error: tip.error };
  if (!tip.sha) return { state: 'absent' };

  let verdict = isAncestorOfHead({ sha: tip.sha, git });
  if (!verdict.known) {
    // The remote tip is not in the local object store. Fetch it and ask again
    // — only then is "not an ancestor" a fact rather than a guess.
    try {
      git(['fetch', 'origin', `refs/heads/${branch}`]);
    } catch (err) {
      return { state: 'unreachable', reason: 'fetch-failed', remoteSha: tip.sha, error: err };
    }
    verdict = isAncestorOfHead({ sha: tip.sha, git });
    if (!verdict.known) {
      return {
        state: 'unreachable', reason: 'ancestry-check-failed', remoteSha: tip.sha, error: verdict.error,
      };
    }
  }

  return { state: verdict.ancestor ? 'mine' : 'foreign', remoteSha: tip.sha };
}

// Best-effort PR context for the stop card. A failed lookup is `ok: false` —
// rendered as "PR status unknown", distinct from a confirmed empty result.
function findPrsForBranch({ branch, repo, gh = defaultGh }) {
  try {
    const out = gh([
      'pr', 'list', '--repo', repo, '--head', branch, '--state', 'all',
      '--json', 'number,url,state,isDraft,headRefOid,closingIssuesReferences,body,isCrossRepository,closedAt,comments',
    ]);
    return { ok: true, prs: JSON.parse(out || '[]') };
  } catch (err) {
    return { ok: false, error: err, prs: [] };
  }
}

// A record's issue comments (the tombstone's `Attempt N failed` lives on the issue, not the
// PR). Never throws: a failed or malformed read is `ok: false`, which yields no evidence.
function readIssueComments({ number, repo, gh = defaultGh }) {
  try {
    const parsed = JSON.parse(gh(['issue', 'view', String(number), '--repo', repo, '--json', 'comments']));
    if (!Array.isArray(parsed.comments)) return { ok: false, comments: [] };
    return { ok: true, comments: parsed.comments };
  } catch (err) {
    return { ok: false, error: err, comments: [] };
  }
}

// True when `lookup` is a complete read holding a trusted `Attempt N failed` comment created
// in [closedAt - TOMBSTONE_CLOSE_WINDOW_MS, closedAt]. An unparseable time compares false.
function hasTombstoneEvidence(closedAt, lookup) {
  if (!lookup || typeof lookup !== 'object' || lookup.ok !== true || !Array.isArray(lookup.comments)) return false;
  const closed = Date.parse(closedAt);
  return lookup.comments.some((comment) => {
    if (!comment || typeof comment !== 'object' || typeof comment.body !== 'string') return false;
    if (!ATTEMPT_RE.test(comment.body) || !isTrustedComment(comment)) return false;
    const created = Date.parse(comment.createdAt);
    return created <= closed && closed - created <= TOMBSTONE_CLOSE_WINDOW_MS;
  });
}

// #4792: the blocker-landing stop closes its PR as a tombstone with a `failure`-kind pointer
// comment ON THE PR and posts no `Attempt N failed` comment on the issue, so that pointer is
// this producer's evidence: a trusted comment carrying the run-comment failure marker and the
// stop sentence, created in the same window before `closedAt`. A read without `comments` is no evidence.
const BLOCKER_STOP_MARKER = '<!-- run-comment: failure -->';
const BLOCKER_STOP_SENTENCE = 'Stopped: an out-of-run blocker has not landed.';
function hasBlockerLandingEvidence(pr) {
  if (!Array.isArray(pr.comments)) return false;
  const closed = Date.parse(pr.closedAt);
  return pr.comments.some((comment) => {
    if (!comment || typeof comment !== 'object' || typeof comment.body !== 'string') return false;
    if (!comment.body.includes(BLOCKER_STOP_MARKER) || !comment.body.includes(BLOCKER_STOP_SENTENCE)) return false;
    if (!isTrustedComment(comment)) return false;
    const created = Date.parse(comment.createdAt);
    return created <= closed && closed - created <= TOMBSTONE_CLOSE_WINDOW_MS;
  });
}

// The one closed same-repo PR with the greatest `closedAt` (Reading A), or null when there is
// none, any candidate's `closedAt` is unparseable, or the greatest is shared (newest unknown).
function newestClosedPr(prs) {
  let newest = null;
  let newestMs = -Infinity;
  let tied = false;
  for (const pr of prs) {
    if (!pr || typeof pr !== 'object' || pr.state !== 'CLOSED' || pr.isCrossRepository === true) continue;
    const ms = Date.parse(pr.closedAt);
    if (Number.isNaN(ms)) return null;
    if (ms > newestMs) { newest = pr; newestMs = ms; tied = false; } else if (ms === newestMs) tied = true;
  }
  return tied ? null : newest;
}

// Reading B: true when a same-repo PR that is not CLOSED is OPEN (draft included), or else
// lacks a `closedAt` strictly before the newest closed PR's (a NaN compares false, so an
// unknown time blocks). Such a PR is live or merged work the retry must not merge in.
function newerLivePr(prs, closedMs) {
  return prs.some((pr) => {
    if (!pr || typeof pr !== 'object' || pr.state === 'CLOSED' || pr.isCrossRepository === true) return false;
    return pr.state === 'OPEN' || !(Date.parse(pr.closedAt) < closedMs);
  });
}

// The newest CLOSED same-repo PR on the branch (Reading A, by `closedAt`) when it is a
// claude-tweaks PR (run marker on its body's first line) that closes one of `records`
// in `repo` (`owner/name`), whose head is an ancestor of `remoteSha`, and that carries
// tombstone evidence (a trusted `Attempt N failed` comment on a record it closes, or the
// blocker-landing stop's pointer comment on the PR itself, in the window before its `closedAt`) — the record's own failed earlier attempt — as
// `{ number, url }`, else null. Only the newest closed PR is judged: failing any check, it
// is null, never a fallback to an older PR, so commits a human rejected are not adopted.
// A newer same-repo OPEN, draft or MERGED PR (Reading B) also yields null, before any check
// or comment read. "Closes" is `prClosesIssue`'s three-valued verdict (closing references
// matched on number and repository, else a closing-keyword line of the PR body);
// only `true` links, so a PR read without `closingIssuesReferences` stays foreign.
// Any doubt (failed lookup, bad sha, ancestry error, unreadable comments, newest unknown)
// is null: the branch stays foreign. `readComments({ number, repo })` is injectable.
function findPriorAttemptPr({ remoteSha, prLookup, records, repo, git = defaultGit, readComments = readIssueComments }) {
  const wanted = [...new Set((Array.isArray(records) ? records : []).filter(Number.isInteger))];
  if (!SHA_RE.test(remoteSha || '') || wanted.length === 0 || !repo) return null;
  if (!prLookup || !prLookup.ok || !Array.isArray(prLookup.prs)) return null;
  const pr = newestClosedPr(prLookup.prs);
  if (!pr || newerLivePr(prLookup.prs, Date.parse(pr.closedAt))) return null;
  // `gh pr list --head` also matches fork PRs; only a same-repo PR is this record's own.
  if (pr.isCrossRepository !== false || !firstLineRunId(pr.body)) return null;
  const linked = wanted.filter((n) => prClosesIssue(pr, n, repo, pr.body) === true);
  if (linked.length === 0 || !SHA_RE.test(pr.headRefOid || '')) return null;
  try {
    git(['merge-base', '--is-ancestor', pr.headRefOid, remoteSha]);
  } catch {
    return null;
  }
  // `some` stops at the first record with evidence. `wanted` is deduplicated and only this
  // one PR is judged, so each linked record's comments are read at most once.
  if (!hasBlockerLandingEvidence(pr) && !linked.some((n) => hasTombstoneEvidence(pr.closedAt, readComments({ number: n, repo })))) return null;
  return { number: pr.number, url: pr.url };
}

function describePrs(prLookup) {
  if (!prLookup || !prLookup.ok) return 'PR status unknown (lookup failed)';
  if (prLookup.prs.length === 0) return 'no PR found for it';
  return prLookup.prs
    .map((pr) => `${String(pr.state || '').toLowerCase()} PR #${pr.number} (${pr.url})`)
    .join(', ');
}

// `reason` set → the unknown-relation card (`unreachable` with a remoteSha:
// fetch-failed / ancestry-check-failed, adopted-branch-collision-check.md item 3):
// the branch is confirmed on origin but its relation to HEAD could not be
// determined, so the card must not claim the commit is outside HEAD's history.
function formatStopCard({ branch, remoteSha, prLookup, reason }) {
  const short = String(remoteSha || '').slice(0, 9);
  const relation = reason
    ? `its relation to this worktree's history could not be determined (\`${reason}\`)`
    : "that commit is not in this worktree's history";
  const outcome = reason ? 'may be rejected' : 'would be rejected';
  return [
    '## Build: Adopted branch collides with an unrelated branch on origin',
    '',
    `\`${branch}\` already exists on \`origin\` at \`${short}\`, and ${relation} — ` +
      `${describePrs(prLookup)}. Pushing this branch ${outcome} non-fast-forward.`,
    '',
    `Options: (1) rename this worktree's local branch (\`git branch -m ${branch}-{suffix}\`) and ` +
      're-run, (2) delete the stale remote branch ' +
      `(\`git push origin --delete ${branch}\`) and re-run, (3) stop and resume the existing ` +
      'remote branch/PR instead.',
  ].join('\n');
}

// The adopted-branch collision check as one call (#5589): classify, then — for a
// `foreign` branch, or an `unreachable` one whose tip is known — look up PRs and
// compose the stop card, or recognize a dispatched retry's own earlier attempt.
// `records` is an array of positive integers (the CLI parses it). The result keys
// are `state`, `reason`, `remoteSha` (null, never absent), plus `pr` when the
// state became `prior-attempt`, or `card` when a stop card was composed.
function checkAdoptedBranch({ branch, repo = null, records = [], git = defaultGit, gh = defaultGh }) {
  const r = classifyRemoteBranch({ branch, git });
  const out = { state: r.state, reason: r.reason || null, remoteSha: r.remoteSha || null };
  if (r.state === 'foreign' || (r.state === 'unreachable' && r.remoteSha)) {
    const reason = r.state === 'foreign' ? null : r.reason;
    const prLookup = repo ? findPrsForBranch({ branch, repo, gh }) : null;
    const prior = r.state === 'foreign' ? findPriorAttemptPr({
      remoteSha: r.remoteSha, prLookup, records, repo, git,
      readComments: (args) => readIssueComments({ ...args, gh }),
    }) : null;
    if (prior) { out.state = 'prior-attempt'; out.pr = prior; }
    else out.card = formatStopCard({ branch, remoteSha: r.remoteSha, prLookup, reason });
  }
  return out;
}

module.exports = {
  checkAdoptedBranch,
  readRemoteTip,
  classifyRemoteBranch,
  findPrsForBranch,
  findPriorAttemptPr,
  readIssueComments,
  TOMBSTONE_CLOSE_WINDOW_MS,
  formatStopCard,
};
