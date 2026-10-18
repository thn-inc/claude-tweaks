// bin/lib/commit-scope.js — the pure precedence resolver for the
// Conventional-Commits scope of a merge subject (#3298). Consumed by
// bin/lib/compose-subject.js, which reads the `commit-scope` /
// `commit-scope-paths` policy keys and the branch's changed paths, then hands
// them here. No fs, no process, no policy read — every input is a parameter.
//
// Precedence: explicit (--scope) > path-prefix match (exactly one distinct
// token) > constant (`commit-scope`) > unscoped. A path-prefix match that is
// zero or ambiguous falls through to the constant; an ambiguous one also
// returns the sorted distinct tokens as `note` so the caller can surface it.
// Token characters are never validated here — composeSubject in
// bin/lib/release/subject.js owns that.
'use strict';

class CommitScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommitScopeError';
  }
}

// entries: readListKey's already-split, trimmed `commit-scope-paths` list.
// Each is {path-prefix}={token}, split on the first `=`, both sides trimmed.
function parseScopePaths(entries) {
  return entries.map((entry) => {
    const eq = entry.indexOf('=');
    const prefix = eq === -1 ? '' : entry.slice(0, eq).trim();
    const token = eq === -1 ? '' : entry.slice(eq + 1).trim();
    if (!prefix || !token) {
      throw new CommitScopeError(`commit-scope-paths entry ${JSON.stringify(entry)} is not {path-prefix}={token}`);
    }
    return { prefix, token };
  });
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

// The distinct tokens the changed paths map to, first-seen order. Each path
// takes the pair with the longest matching prefix; an unmatched path
// contributes nothing.
function matchedTokens(pairs, changedPaths) {
  const tokens = [];
  for (const path of changedPaths) {
    let best = null;
    for (const pair of pairs) {
      if (path.startsWith(pair.prefix) && (best === null || pair.prefix.length > best.prefix.length)) best = pair;
    }
    if (best !== null && !tokens.includes(best.token)) tokens.push(best.token);
  }
  return tokens;
}

function resolveCommitScope({ explicit, constant, pairs, changedPaths }) {
  const explicitScope = nonBlank(explicit);
  if (explicitScope !== null) return { scope: explicitScope, source: 'explicit', note: null };

  let note = null;
  if (pairs.length > 0) {
    const tokens = matchedTokens(pairs, changedPaths);
    if (tokens.length === 1) return { scope: tokens[0], source: 'paths', note: null };
    if (tokens.length > 1) note = tokens.slice().sort();
  }

  const constantScope = nonBlank(constant);
  if (constantScope !== null) return { scope: constantScope, source: 'constant', note };
  return { scope: null, source: 'none', note };
}

module.exports = { CommitScopeError, parseScopePaths, resolveCommitScope };
