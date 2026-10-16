// bin/lib/issues/label-write.js
// Pure: compute the correct full label-name array for a single-issue label write.
// Exists because mcp__github__issue_write's `labels` parameter REPLACES the full
// array rather than merging (unlike `gh issue edit --add-label`/`--remove-label`,
// which are inherently additive/subtractive) — see _shared/github-write-transport.md's
// CRUD mapping "Edit labels / body" row / Full-replace hazard section. A caller on
// the gh-absent MCP transport must read the issue's current labels, compute the
// desired full set with this function, and pass THAT array to issue_write — never
// a single-label array.
// #2789: a naive `labels: ["bot:in-progress"]` call wiped every other label on
// two live issues this way.
'use strict';

function ensureLabelNameArray(value, argName) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${argName}: expected an array of label names (got ${typeof value})`);
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new TypeError(`${argName}: every entry must be a non-empty string (got ${JSON.stringify(entry)})`);
    }
  }
  return value;
}

// mergeLabelNames(current, { add, remove }) -> string[]
// `remove` is applied first, then `add` is appended for any name not already
// present post-removal — so a name listed in both `add` and `remove` ends up
// removed, never re-added (remove wins). Duplicate names already present in
// `current` are preserved as-is (never de-duplicated) since this function's
// job is computing the write payload, not repairing a pre-existing malformed
// label list.
function mergeLabelNames(current, { add = [], remove = [] } = {}) {
  ensureLabelNameArray(current, 'current');
  ensureLabelNameArray(add, 'add');
  ensureLabelNameArray(remove, 'remove');

  const removeSet = new Set(remove);
  const result = current.filter((name) => !removeSet.has(name));
  for (const name of add) {
    if (!removeSet.has(name) && !result.includes(name)) {
      result.push(name);
    }
  }
  return result;
}

module.exports = { mergeLabelNames, ensureLabelNameArray };
