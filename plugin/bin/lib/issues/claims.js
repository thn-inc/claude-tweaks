// bin/lib/issues/claims.js
// Pure: build claim/release payloads for the claims-registry blob store
// (`claims/issue-<n>.json` on the `claims-registry` branch — the one lock
// keyspace both the gh-CLI and MCP transports write to) and classify a
// claim blob's current content. The SKILL.md runs gh (or the MCP tools)
// and passes results back — no network here. `classifyClaimBlob` below is
// the one classification function both transports' write paths share.
// Time-dependent functions take `now` (epoch ms).
// Contract: skills/_shared/issue-claims.md.
'use strict';

const DEFAULT_TTL_HOURS = 72;
const CLAIMS_BRANCH = 'claims-registry';

function claimFilePath(issueNumber) {
  return `claims/issue-${issueNumber}.json`;
}

// opts: { issueNumber, runId, sessionId, ttlHours?, host?, owner?, repo?, note?, now }
// owner/repo default to gh's {owner}/{repo} placeholders (auto-filled from the current repo).
// Returns { owner, repo, claimPath, fileContent, commentBody }.
// Both transports write `fileContent` to `claimPath` on `CLAIMS_BRANCH`
// (create-only when absent, conditional-update with the blob's current sha
// when reclaiming a tombstone/stale claim — see `_shared/issue-claims.md`'s
// "The lock" section for the full read-classify-write procedure).
function claimPayload({ issueNumber, runId, sessionId, ttlHours = DEFAULT_TTL_HOURS, host = '', owner = '{owner}', repo = '{repo}', note, now }) {
  const claimedAt = new Date(now).toISOString();
  const marker = { runId, sessionId, claimedAt, ttlHours, host };
  const humanLines = [`Claimed by claude-tweaks run ${runId} at ${claimedAt} (TTL ${ttlHours}h).`];
  if (note) humanLines.push(note);
  return {
    owner,
    repo,
    claimPath: claimFilePath(issueNumber),
    fileContent: JSON.stringify(marker, null, 2),
    commentBody: `<!-- agent-claim: ${JSON.stringify(marker)} -->\n${humanLines.join('\n')}`,
  };
}

// opts: { issueNumber, runId, reason, link?, sweptFrom?, owner?, repo?, now }
// Returns { owner, repo, claimPath, tombstoneContent, commentBody }.
// Both transports overwrite the blob at `claimPath` with `tombstoneContent`
// (conditional-update, `sha` = the target file's current blob sha from a
// fresh read) rather than deleting it. A sha mismatch here means someone
// else already broke/re-claimed — treat as a release race, not this run's
// problem (mirrors the "release fails -> log, TTL is the backstop" posture).
// `sweptFrom` (#2090) is the original holder's `runId` when this release is a
// `/tidy` sweep of a claim this run does not own — the tombstone's own
// `runId` stays this (sweep) run's id, exactly as an ordinary release's does;
// `sweptFrom` is the only thing that distinguishes "I released my own claim"
// from "I swept someone else's". Omitted (undefined) for every non-sweep
// release, so an ordinary tombstone's shape is byte-for-byte unchanged.
function releasePayload({
  issueNumber, runId, reason, link, sweptFrom, owner = '{owner}', repo = '{repo}', now,
}) {
  const releasedAt = new Date(now).toISOString();
  const marker = { runId, reason, releasedAt };
  if (link) marker.link = link;
  if (sweptFrom) marker.sweptFrom = sweptFrom;
  const human = `Released by run ${runId}: ${reason}.` + (link ? ` See ${link}.` : '');
  return {
    owner,
    repo,
    claimPath: claimFilePath(issueNumber),
    tombstoneContent: JSON.stringify({ released: true, ...marker }, null, 2),
    commentBody: `<!-- agent-claim-release: ${JSON.stringify(marker)} -->\n${human}`,
  };
}

// claim: a parsed claim marker. now: epoch ms.
// Stale iff now >= claimedAt + ttlHours. Unparseable claimedAt → never stale
// (fail-closed: a claim you cannot read is not yours to break; /tidy surfaces it).
function isStale(claim, now) {
  const t = Date.parse(claim && claim.claimedAt);
  if (Number.isNaN(t)) return false;
  const ttl = typeof claim.ttlHours === 'number' ? claim.ttlHours : DEFAULT_TTL_HOURS;
  return now >= t + ttl * 3600 * 1000;
}

// Classify a claim blob's *current* content — the same read-then-classify
// step both transports now run against the one `claimPath` keyspace before
// deciding create-only vs conditional-update vs contested. `content` is the
// raw string read from the blob, or `null`/`undefined` when the file does
// not exist yet (never-claimed). Never throws.
//
//   'absent'     — file does not exist. Reclaimable via a create-only write
//                  (no `sha`) — a concurrent create-only write from the
//                  other transport racing for the same path is exactly the
//                  cross-transport collision this unification closes: only
//                  one create-only write can land, GitHub rejects the other.
//   'unreadable' — file exists but isn't valid claim JSON. Fails closed to
//                  *not* reclaimable — an unprovable claim must not be
//                  released: a blob you cannot parse might still be a live,
//                  legitimate lock (a partial write, a format this reader
//                  doesn't yet know), and reclaiming it on a guess risks the
//                  exact double-build this lock exists to prevent. Fails
//                  closed the same way `isStale`'s unparseable-date case
//                  does, for the identical reason. The domain rule this
//                  lock keyspace is built on — one arbiter (the GitHub API)
//                  covers every concurrency topology, and only a positively
//                  provable release condition (tombstone or expired TTL) may
//                  reclaim a claim — is `docs/decisions/0002-issue-claims-atomic-ref-lock.md`
//                  (superseded by the create-only/conditional-update blob
//                  scheme below, but still the decision record for this
//                  module and its `_shared/issue-claims.md` contract).
//   'tombstone'  — a past claim already released (`released: true`).
//                  Reclaimable via a conditional-update write (`sha` = the
//                  blob's current sha, from the same read).
//   'stale'      — a live claim past its TTL (`isStale`). Reclaimable the
//                  same conditional-update way as a tombstone.
//   'live'       — an active, non-stale claim. Not reclaimable — contested.
function classifyClaimBlob(content, now) {
  if (content === null || content === undefined) return { state: 'absent', reclaimable: true };
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    /* stays null */
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { state: 'unreadable', reclaimable: false };
  }
  if (parsed.released === true) return { state: 'tombstone', reclaimable: true };
  if (isStale(parsed, now)) return { state: 'stale', reclaimable: true };
  return { state: 'live', reclaimable: false };
}

module.exports = {
  DEFAULT_TTL_HOURS, CLAIMS_BRANCH, claimFilePath, claimPayload, releasePayload,
  isStale, classifyClaimBlob,
};
