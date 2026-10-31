// bin/lib/issues/mcp-pr-shape.js
// Normalizes the open-PR listing the GitHub MCP `list_pull_requests` tool
// returns into the shape `gh pr list --json url,body,isCrossRepository`
// returns, so claim-store.js's matchStaleClaimPr runs over one shape on both
// transports (#4596). Consumers: `bin/stale-claim-pr.js`, and through it the
// MCP paths of `_shared/issue-claims.md` and `tidy/scan-procedures.md`. MCP
// spells the url `html_url` and carries no cross-repository flag, so it is
// derived from `head.repo.full_name`; the step is a no-op on a gh-shaped entry.
'use strict';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Returns a new array of new objects; the input is never mutated. Throws when
// `entries` is not an array (the message matchStaleClaimPr uses, so both
// transports report one string) or an element is not a plain object — a read
// error the agent recorded as data must fail, never reach the matcher.
// full_name is compared exactly, as isSameRepoPrUrl compares owner/repo; a
// missing head repo (deleted fork) is cross-repository.
function normalizePrListing(entries, owner, repo) {
  if (!Array.isArray(entries)) throw new Error('open-PR listing is not an array');
  return entries.map((entry, i) => {
    if (!isPlainObject(entry)) throw new Error(`open-PR listing entry ${i} is not an object`);
    if ('html_url' in entry || 'head' in entry) {
      const fullName = entry.head && entry.head.repo ? entry.head.repo.full_name : undefined;
      return { url: entry.html_url, body: entry.body, isCrossRepository: fullName !== `${owner}/${repo}` };
    }
    return { url: entry.url, body: entry.body, isCrossRepository: entry.isCrossRepository };
  });
}

module.exports = { normalizePrListing };
