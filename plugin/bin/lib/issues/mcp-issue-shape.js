// bin/lib/issues/mcp-issue-shape.js
// Normalizes issue objects returned by the GitHub MCP tools (list_issues,
// issue_read) for the dispatch consumers (#3691). The MCP tools return
// snake_case created_at/updated_at; grouping.js (bundleFastLaneSingletons),
// dispatch's next-ranking.md, and queue-order.js (buildFreshnessSignal) read
// camelCase createdAt/updatedAt. aliasMcpTimestamps adds the camelCase keys
// alongside the originals, so no consumer loses a field it already reads.
'use strict';

const TIMESTAMP_ALIASES = { created_at: 'createdAt', updated_at: 'updatedAt' };

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Returns a new array of shallow copies; the input is never mutated. A
// non-array input yields []. A non-object element (null, a primitive) passes
// through unchanged. A camelCase key is set only when its value on the
// copy is undefined (any other value is kept) and the snake_case source is a string.
function aliasMcpTimestamps(issues) {
  if (!Array.isArray(issues)) return [];
  return issues.map((issue) => {
    if (!isPlainObject(issue)) return issue;
    const copy = { ...issue };
    for (const [snake, camel] of Object.entries(TIMESTAMP_ALIASES)) {
      if (copy[camel] === undefined && typeof issue[snake] === 'string') {
        copy[camel] = issue[snake];
      }
    }
    return copy;
  });
}

module.exports = { aliasMcpTimestamps, TIMESTAMP_ALIASES };
