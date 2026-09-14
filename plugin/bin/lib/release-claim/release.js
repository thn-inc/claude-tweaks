// bin/lib/release-claim/release.js
// The one claim-release write path: read the claim blob, classify it, honor the
// ownership rule, overwrite it with releasePayload's tombstone (conditional on
// the read sha), post the release comment, and optionally strip labels — the
// mechanics wrap-up/cleanup-procedures.md Section E steps 3-6 and the
// `bot:in-progress` half of step 7 describe, in one call. bin/release-claim.js
// is the thin CLI; bin/lib/reconcile/release-merged.js
// shares writeTombstone below instead of composing its own PUT. Injectable
// runner(args) is invoked as `gh ${args.join(' ')}` (gh-api-module-pattern);
// tests never touch real gh. Contract: skills/_shared/issue-claims.md.
'use strict';

const { execFileSync } = require('child_process');
const { classifyClaimBlob, releasePayload } = require('../issues/claims');
const claimStore = require('../issues/claim-store');

const GRANT_LABELS = ['auto:build', 'auto:merge-pending', 'auto:merge'];
const IN_PROGRESS_LABEL = 'bot:in-progress';

function defaultRunner(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function errorText(err) {
  const parts = [err && err.message, err && err.stderr, err && err.stdout].filter(Boolean).map(String);
  return parts.length ? parts.join(' ') : String(err);
}

function isNotFoundError(err) { return /\b404\b|Not Found/i.test(errorText(err)); }
// 404 (already swept), 409/422 (a compare-and-swap rejection — which may, but need not,
// mean someone re-claimed or released first; under git-CAS any concurrent commit on the
// branch rejects too, so releaseClaim re-reads before believing it — see its catch block).
// Anchored on the status-line shape (`HTTP <code>`) so a 500 whose body happens to mention
// "404" is never downgraded to already-released.
function isAlreadyReleasedError(err) { return /HTTP (404|409|422)\b/.test(errorText(err)); }

// -> { content, sha } | { content:null, sha:null, absent:true }; other failures throw.
// Delegates to claim-store.js's readClaimBlob (the surviving single
// write-path module, now with git-CAS tried first when `gitRunner` is
// supplied) instead of this module's own separate gh api call (#787
// consolidation). `gitRunner` is a new optional parameter — omitted
// (`undefined`), this behaves exactly as before (contents-API only).
function readClaimBlob({ owner, repo, issueNumber, runner = defaultRunner, gitRunner }) {
  const ghApi = (args) => {
    try {
      const stdout = runner(['api', ...args]);
      return { stdout, failure: null, status: null };
    } catch (err) {
      if (isNotFoundError(err)) return { stdout: null, failure: null, status: 404 };
      return { stdout: null, failure: 'network-failure', status: null };
    }
  };
  const result = claimStore.readClaimBlob({ ghApi, gitRunner }, `${owner}/${repo}`, issueNumber);
  if (result.failure) { const e = new Error(`claim-store read failure: ${result.failure}`); throw e; }
  return result.absent ? { content: null, sha: null, absent: true } : { content: result.content, sha: result.sha };
}

// Conditional overwrite (sha = the blob's current sha from the read) — now
// delegating to claim-store.js's writeClaimBlob (#787 consolidation), which
// tries git-CAS first per the amendment when `gitRunner` is supplied.
// release-merged.js's own call site never passes one (see that module's own
// header comment) and stays contents-API-only, unchanged by this task;
// bin/release-claim.js does pass a real one.
// `expectedContent` is the blob content the read that produced `sha` returned.
// It only matters on the git-CAS path, where claim-store uses it to tell a
// genuine contest from a push rejected by unrelated `claims-registry` activity,
// and to refuse a fallback write that would clobber a claim landed meanwhile
// (#787 final-review findings I1/C1). A contents-API-only caller
// (release-merged.js — no `gitRunner`) never exercises either check, so it
// stays byte-for-byte the same write it always made.
function writeTombstone({ owner, repo, issueNumber, sha, tombstoneContent, expectedContent, message, runner = defaultRunner, gitRunner }) {
  const ghApi = (args) => {
    try {
      const stdout = runner(['api', ...args]);
      return { stdout, failure: null, status: null };
    } catch (err) {
      // Mirror readClaimBlob's ghApi above: claim-store.js's contract says
      // ghApi never throws (see that file's header comment) — an uncaught
      // exception here bypassed writeClaimBlob's own conflict classification
      // entirely, so a genuine 409/422 rejection surfaced as a raw throw with
      // `.conflict` unset, skipping releaseClaim's re-verification safety net
      // below (a false 'already-released' with a still-live claim).
      const { failure, status } = claimStore.classifyGhApiError(err);
      return { stdout: null, failure, status };
    }
  };
  const result = claimStore.writeClaimBlob({ ghApi, gitRunner }, `${owner}/${repo}`, issueNumber, {
    content: tombstoneContent, sha, expectedContent, message,
  });
  if (!result.ok) {
    const e = new Error(result.conflict ? 'HTTP 409/422 sha mismatch' : (result.failure || 'write failed'));
    // Carry the store's own conflict flag on the error. `isAlreadyReleasedError`
    // can only read the message TEXT, and a compare-and-swap rejection and a
    // genuine "someone released this first" produce the same text — the caller
    // needs to know a real write conflict happened before it can decide which
    // one it was (see releaseClaim's catch block).
    e.conflict = result.conflict === true;
    throw e;
  }
  return '';
}

function postReleaseComment({ owner, repo, issueNumber, body, runner = defaultRunner }) {
  return runner(['issue', 'comment', String(issueNumber), '--repo', `${owner}/${repo}`, '--body', body]);
}

// Best-effort — never throws (a failed label edit never blocks a release).
function removeLabel({ owner, repo, issueNumber, label, runner = defaultRunner }) {
  try {
    runner(['issue', 'edit', String(issueNumber), '--repo', `${owner}/${repo}`, '--remove-label', label]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

// -> { outcome, holder?, calls, commentPosted, labelsRemoved, labelsFailed, error?, note? }
// `error` is set only when outcome === 'failed' (a read failure, a PUT
// failure that isn't already-released, or a write conflict the post-conflict
// re-read shows was spurious — see the catch block). Non-fatal diagnostics —
// the 404/409/422 PUT error text on the already-released path, and any
// comment-post failure — go into `note` instead (joined with '; ' if both
// occur). `outcome: 'unreadable'` (a corrupt/malformed claim blob) is
// deliberately distinct from `'skipped-not-owner'` (a live claim genuinely
// held by another run) — the two are not mechanically distinguishable
// otherwise, and a corrupt blob can never self-resolve the way a live
// holder's claim eventually expires.
// `removeInProgress` defaults `true` (#1631): every documented caller of this
// module's one consumer, `bin/release-claim.js`, unconditionally passes
// `--remove-in-progress` on every release outcome (success or failure) — the
// audit behind this default found zero legitimate case for a release to leave
// `bot:in-progress` in place, since a released claim means the run is no
// longer working the issue either way. Requiring every call site to opt in
// made a caller that composed its own ad hoc release command (deviating from
// the documented literal invocation, e.g. an inline dispatch shortcut) fail
// silently — `labelsRemoved`/`labelsFailed` both empty, no error, nothing to
// notice. `removeGrants` stays opt-in (default `false`): unlike
// `bot:in-progress`, grant retention on an `abandoned:` release is
// intentional (the grant is the standing retry request) — see
// `_shared/issue-claims.md`'s "Grant revocation" section.
function releaseClaim({
  owner, repo, issueNumber, runId, reason, link, sweep, removeGrants = false, removeInProgress = true, runner = defaultRunner, gitRunner, now = Date.now(),
}) {
  const result = { outcome: 'failed', calls: [], commentPosted: false, labelsRemoved: [], labelsFailed: [], note: null };
  let blob;
  try { blob = readClaimBlob({ owner, repo, issueNumber, runner, gitRunner }); } catch (err) { result.error = errorText(err); return result; }
  result.calls.push('read');
  const classified = classifyClaimBlob(blob.content, now);
  if (classified.state === 'unreadable') { result.outcome = 'unreadable'; return result; }
  const isHeld = classified.state === 'live' || classified.state === 'stale';
  // #2090: a sweep release (a /tidy run releasing a claim it never held)
  // replaces the plain ownership check with a narrower rule — the sweep may
  // break a 'stale' foreign claim (past its own TTL) unconditionally, or a
  // 'live' foreign claim only when the caller has already confirmed the
  // issue itself is closed (`sweep.issueClosed`); a 'live' claim on an OPEN
  // issue is never swept, sweep flag or not. `sweptFrom` records the
  // original holder so the tombstone (and this function's own result) never
  // claims a false owner.
  let sweptFrom;
  if (isHeld) {
    const holder = JSON.parse(blob.content).runId;
    const sweepOk = sweep && (classified.state === 'stale' || (classified.state === 'live' && sweep.issueClosed === true));
    if (holder !== runId && !sweepOk) { result.outcome = 'skipped-not-owner'; result.holder = holder; return result; }
    if (sweepOk && holder !== runId) sweptFrom = holder;
  }
  const payload = releasePayload({
    issueNumber, runId, reason, link: link || undefined, sweptFrom, now,
  });
  if (isHeld) {
    try {
      writeTombstone({
        owner, repo, issueNumber, sha: blob.sha, tombstoneContent: payload.tombstoneContent, expectedContent: blob.content, message: `Release claim on issue #${issueNumber}`, runner, gitRunner,
      });
      result.calls.push('put');
      result.outcome = 'released';
      if (sweptFrom) result.sweptFrom = sweptFrom;
    } catch (err) {
      if (!isAlreadyReleasedError(err)) { result.error = errorText(err); return result; }
      // A write CONFLICT is not by itself evidence that this claim was already
      // released. With git-CAS live (claim-store.js -> claims-git-cas.js), the
      // compare-and-swap lease is on the whole `claims-registry` branch tip, so
      // ANY concurrent commit — including one claiming a completely unrelated
      // issue — rejects the push and surfaces here as a conflict. Reporting that
      // as 'already-released' is a false success with teeth: the caller goes on
      // to post a release comment and strip auto:build/auto:merge/bot:in-progress
      // from an issue whose claim blob is still live and still held by this run.
      // So: re-read the claim and only fall through when the fresh state agrees
      // the release happened (absent, tombstoned, or held by a successor).
      if (err.conflict) {
        let fresh;
        try {
          fresh = readClaimBlob({ owner, repo, issueNumber, runner, gitRunner });
        } catch (readErr) {
          // Can't tell spurious contention from a genuine release — fail closed
          // rather than report a success we did not verify.
          result.error = `write conflict releasing #${issueNumber} (${errorText(err)}); could not re-read the claim to tell a lost branch-tip race from a real release: ${errorText(readErr)}`;
          return result;
        }
        result.calls.push('read');
        const after = classifyClaimBlob(fresh.content, now);
        if (after.state === 'live' || after.state === 'stale') {
          let holderAfter = null;
          try { holderAfter = JSON.parse(fresh.content).runId; } catch { holderAfter = null; }
          // Under a sweep, "still held by the ORIGINAL holder" is the same
          // fail-closed shape as "still held by this run" in the ordinary
          // case below — either way the tombstone never actually landed.
          if (holderAfter === runId || (sweptFrom && holderAfter === sweptFrom)) {
            // Nothing about THIS claim changed — the conflict came from unrelated
            // branch activity. The tombstone was never written; the claim is still held.
            result.error = `write conflict releasing #${issueNumber}, but the claim is still held by ${holderAfter === runId ? 'this run' : `the original holder (${holderAfter})`} — the release did NOT happen (unrelated claims-registry activity lost us the compare-and-swap; retry): ${errorText(err)}`;
            return result;
          }
        } else if (after.state === 'unreadable') {
          // A corrupt/partial re-read is none of the three states this
          // safety net requires before falling through (absent, tombstoned,
          // or held by a successor) — it proves nothing either way. Fail
          // closed rather than let it silently reach 'already-released'.
          result.error = `write conflict releasing #${issueNumber}, and the re-read claim blob is unreadable — could not verify whether the release happened or the claim is still live: ${errorText(err)}`;
          return result;
        }
      }
      result.outcome = 'already-released';
      result.note = errorText(err);
    }
  } else {
    // absent, or a tombstone (own or foreign) — nothing to overwrite. A
    // tombstone is not a held lock, so the ownership rule above (which
    // guards only a live/stale lock held by another run) deliberately does
    // not apply here: the comment and label removals still run.
    result.outcome = 'already-released';
  }
  try {
    postReleaseComment({ owner, repo, issueNumber, body: payload.commentBody, runner });
    result.calls.push('comment');
    result.commentPosted = true;
  } catch (err) {
    result.note = result.note ? `${result.note}; ${errorText(err)}` : errorText(err);
  }
  const labels = [...(removeGrants ? GRANT_LABELS : []), ...(removeInProgress ? [IN_PROGRESS_LABEL] : [])];
  for (const label of labels) {
    const r = removeLabel({ owner, repo, issueNumber, label, runner });
    result.calls.push(`label:${label}`);
    (r.ok ? result.labelsRemoved : result.labelsFailed).push(label);
  }
  return result;
}

module.exports = {
  defaultRunner, errorText, isNotFoundError, isAlreadyReleasedError,
  readClaimBlob, writeTombstone, postReleaseComment, removeLabel, releaseClaim,
  GRANT_LABELS, IN_PROGRESS_LABEL,
};
