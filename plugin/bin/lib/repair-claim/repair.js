// bin/lib/repair-claim/repair.js
// The one unreadable-claim repair write path: read the claim blob, confirm it
// classifies 'unreadable' on that same fresh read, conditionally overwrite it
// (sha = the read's blob sha) with releasePayload tombstone content (`release`
// mode) or claimPayload content (`reclaim` mode), and post the mirror comment —
// the mechanics _shared/issue-claims.md's "Repairing an unreadable claim blob"
// steps 1-4 describe, in one call. bin/repair-claim.js is the thin CLI. The
// gate here is the exact INVERSE of release.js's ('unreadable' -> proceed;
// anything else -> refuse) — kept in its own module so neither gate can invert
// the other (spec #1608 gotcha). Reuses release.js's readClaimBlob /
// writeTombstone (content-agnostic conditional PUT) rather than composing its
// own gh calls. Injectable runner(args) per gh-api-module-pattern.
// `mode` is NOT validated here — any value other than the literal string
// 'release' falls through to the reclaim branch and writes claim content
// (claimPayload shape), not a tombstone. bin/repair-claim.js's `run()` is the
// one validation gate restricting `--mode` to {release, reclaim}; a second
// consumer calling repairClaim directly with an unvalidated mode string would
// silently get reclaim behavior instead of a rejection.
'use strict';

const releaseLib = require('../release-claim/release');
const { classifyClaimBlob, releasePayload, claimPayload } = require('../issues/claims');
const { repoSlug } = require('../repo-resolve');

// -> { outcome: 'repaired'|'refused'|'cas-rejected'|'failed', state, calls,
//      commentPosted, note, error }
// `state` is the classify state from the fresh read (`null` only when the
// read itself threw, before classification could run).
// 'refused' carries the classify state that blocked the repair — a live,
// stale, tombstone, or absent blob is never overwritten by this tool: that
// mirrors release.js's own gate exactly inverted, so the two gates can never
// invert each other by drifting independently.
// 'cas-rejected' means the sha changed between read and write: re-read and
// reassess, never retried blind (the subsection's own instruction) — this
// function makes exactly one write attempt per call.
// `writeTombstone` is injectable (defaults to release.js's) so a CAS
// rejection can be modeled without needing a real gh 409/422 round trip
// through the fake runner.
// `ghHost` (optional; GitHub Enterprise Server host, #2240) is distinct from
// `host` below (the claiming machine's os.hostname(), per
// _shared/issue-claims.md's claimPayload `host` field) — the two are
// unrelated concepts that happen to share a name in that payload's shape.
function repairClaim({
  owner, repo, ghHost, issueNumber, runId, mode, reason, link, sessionId = '', host = '',
  runner = releaseLib.defaultRunner, gitRunner, now = Date.now(),
  writeTombstone = releaseLib.writeTombstone,
}) {
  const result = {
    outcome: 'failed', state: null, calls: [], commentPosted: false, note: null, error: null,
  };
  let blob;
  try {
    blob = releaseLib.readClaimBlob({
      owner, repo, host: ghHost, issueNumber, runner, gitRunner,
    });
  } catch (err) {
    result.error = releaseLib.errorText(err);
    return result;
  }
  result.calls.push('read');
  const classified = classifyClaimBlob(blob.content, now);
  result.state = classified.state;
  if (classified.state !== 'unreadable') {
    result.outcome = 'refused';
    return result;
  }
  const payload = mode === 'release'
    ? releasePayload({
      issueNumber, runId, reason: `repair-force-release: ${reason}`, link: link || undefined, now,
    })
    : claimPayload({
      issueNumber, runId, sessionId, host, note: `repair-and-claim: ${reason}`, now,
    });
  const content = mode === 'release' ? payload.tombstoneContent : payload.fileContent;
  try {
    writeTombstone({
      owner,
      repo,
      host: ghHost,
      issueNumber,
      sha: blob.sha,
      tombstoneContent: content,
      expectedContent: blob.content,
      message: `Repair unreadable claim on issue #${issueNumber} (${mode})`,
      runner,
      gitRunner,
    });
    result.calls.push('put');
    result.outcome = 'repaired';
  } catch (err) {
    result.error = releaseLib.errorText(err);
    result.outcome = (err && err.conflict === true) ? 'cas-rejected' : 'failed';
    return result;
  }
  try {
    postRepairComment({
      owner, repo, host: ghHost, issueNumber, body: payload.commentBody, runner,
    });
    result.calls.push('comment');
    result.commentPosted = true;
  } catch (err) {
    result.note = releaseLib.errorText(err);
  }
  return result;
}

// Best-effort human-visibility mirror, same posture as release.js's comment
// (a failed comment post never changes the repair outcome).
function postRepairComment({
  owner, repo, host, issueNumber, body, runner = releaseLib.defaultRunner,
}) {
  return runner(['issue', 'comment', String(issueNumber), '--repo', repoSlug({ host, owner, repo }), '--body', body]);
}

module.exports = { repairClaim, postRepairComment, defaultRunner: releaseLib.defaultRunner };
