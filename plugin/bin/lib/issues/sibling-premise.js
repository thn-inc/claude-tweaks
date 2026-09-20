// plugin/bin/lib/issues/sibling-premise.js — #2590: before materialize.js
// plans a fresh full-pipeline investigation for a record, scan closed PRs
// referencing that issue number for language showing a prior attempt
// already reached the same "premise no longer holds" conclusion.
'use strict';

// Matches the phrase shape this codebase already uses for the same
// conclusion elsewhere (materialize.js's own Premise-check: stderr text
// says "premise already satisfied at base") plus the closed-PR wording that
// motivated #2590 ("premise no longer holds"). Case-insensitive; the two
// alternatives on the right share the "already" stem so a single group
// covers resolved/satisfied/disproved without repeating "premise already".
const SIBLING_PREMISE_PATTERN = /premise\s+(?:no longer holds|already\s+(?:resolved|satisfied|disproved))/i;

// Array<{number, url, body}> -> {number, url, matchedPhrase} | null.
// Returns the first PR (in the array's own order) whose body matches the
// pattern above. A non-array/empty input or a PR with a non-string body is
// treated as no match, never thrown.
function findSiblingPremiseDisproof(prs) {
  for (const pr of prs || []) {
    if (!pr || typeof pr.body !== 'string') continue;
    const match = pr.body.match(SIBLING_PREMISE_PATTERN);
    if (match) return { number: pr.number, url: pr.url, matchedPhrase: match[0] };
  }
  return null;
}

module.exports = { SIBLING_PREMISE_PATTERN, findSiblingPremiseDisproof };
