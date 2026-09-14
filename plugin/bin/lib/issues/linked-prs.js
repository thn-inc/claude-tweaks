// bin/lib/issues/linked-prs.js
// Executes bin/lib/issues/record.js's buildLinkedPRQuery — the pure batched,
// aliased GraphQL query builder for the open-linked-PR exclusion (#1224) —
// via an injectable runner, and parses the response into the
// {openPR: number|null} shape bin/resolve-linked-prs.js's CLI and
// dispatch/queue-pull-script.md's eligibility pipeline both need. Mirrors
// native-dependencies.js's fetchNativeDependencies exactly (same
// throw-on-partial-result posture, same injectable-runner seam) but for the
// closedByPullRequestsReferences connection instead of blockedBy. Not pure
// (network via the injected runner) — deliberately kept out of record.js,
// which stays a pure, no-network module.
'use strict';

const { buildLinkedPRQuery } = require('./record');

// { numbers, owner, repo, runner } -> Map<number, { openPR: number|null,
// mentions: {number, title, state, merged, mergedAt}[] }>. ONE batched,
// aliased GraphQL call (buildLinkedPRQuery) resolving every candidate's
// closedByPullRequestsReferences connection AND its cross-reference
// timeline (#1984) at once. owner/repo are already-resolved String! values,
// so -f (never -F — -F would type-coerce an all-numeric name,
// gh-api-module-pattern's flag table). `mentions` is every PR (in this same
// repo) that has ever cross-referenced the issue, closing keyword or not —
// consumed by `shipped-candidate.js`'s `classifyShipped` to catch a record
// resolved by an already-merged PR that never used a closing keyword.
//
// Throws — never returns a partial map — when `data.repository` is
// null/missing, or any candidate's `i{n}` alias is absent from the
// response: the same "throw on a partial result rather than returning a
// partial map" rule fetchNativeDependencies follows above it — a malformed
// or error GraphQL response must never silently read as `openPR: null` for
// every affected record (an open-PR-in-flight false negative, the same
// #723 shape fetchNativeDependencies' own comment describes). Callers'
// own try/catch around this call routes the thrown message to their
// exit-1/exit-3 failure path, same as resolve-blockers.js does for
// fetchNativeDependencies.
function fetchLinkedPRs({ numbers, owner, repo, runner } = {}) {
  const result = new Map();
  const query = buildLinkedPRQuery(numbers);
  if (!query) return result;
  const out = runner(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`]);
  const parsed = JSON.parse(out);
  const repository = parsed && parsed.data && parsed.data.repository;
  const missing = repository ? numbers.filter((n) => !repository[`i${n}`]) : numbers.slice();
  if (missing.length) {
    const errs = Array.isArray(parsed && parsed.errors) ? parsed.errors.map((e) => e && e.message).filter(Boolean) : [];
    const suffix = errs.length ? ` (GraphQL: ${errs.join('; ')})` : '';
    const reason = repository ? 'missing linked-PR data for' : 'missing repository — no linked-PR data for';
    throw new Error(`${reason} ${missing.map((n) => `#${n}`).join(', ')}${suffix}`);
  }
  const nameWithOwner = `${owner}/${repo}`;
  for (const n of numbers) {
    const node = repository[`i${n}`];
    const rawNodes = node.closedByPullRequestsReferences && node.closedByPullRequestsReferences.nodes;
    const nodes = Array.isArray(rawNodes) ? rawNodes : [];
    const openPR = nodes.find((p) => p && p.state === 'OPEN');
    // Cross-reference timeline (#1984): filter to same-repo PR sources only
    // (a non-PR source, or a cross-repo PR, resolves to a falsy/mismatched
    // entry and is dropped rather than misclassified).
    const rawTimeline = node.timelineItems && node.timelineItems.nodes;
    const timelineNodes = Array.isArray(rawTimeline) ? rawTimeline : [];
    const mentions = timelineNodes
      .map((item) => item && item.source)
      .filter((pr) => pr && pr.repository && pr.repository.nameWithOwner === nameWithOwner)
      .map((pr) => ({ number: pr.number, title: pr.title, state: pr.state, merged: !!pr.merged, mergedAt: pr.mergedAt || null }));
    result.set(n, { openPR: openPR ? openPR.number : null, mentions });
  }
  return result;
}

module.exports = { fetchLinkedPRs };
