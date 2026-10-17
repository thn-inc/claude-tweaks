'use strict';
// bin/lib/installed-plugins.js — pick which ~/.claude/plugins/installed_plugins.json
// entry of one plugin a session actually runs. Shared by two resolvers:
//   - bin/lib/impeccable-engine/index.js (default rule — every project-scope
//     entry that is an ancestor of the session's path is a candidate);
//   - the superpowers version resolver (#3380), which passes
//     `{ excludeHome: true }`.
//
// Why excludeHome exists: a probe of real Claude Code sessions (#3380) showed
// that a project-scope install whose `projectPath` is the user's home directory
// is never applied to sessions under it, so a resolver reporting what a session
// really runs must skip it. Impeccable keeps today's rule (the option defaults
// off) — changing it there is a separate decision.

const { canonicalRealpath, isAncestorOrSelf } = require('./path-guard');

// The injected deps.realpath is passed through unchanged (superpowers-version
// injects the native form, impeccable-engine and the tests the JS form), and a
// failure falls back to the input so a stale projectPath still compares
// lexically.
function safeRealpath(p, deps) {
  if (!deps || typeof deps.realpath !== 'function') return p;
  const r = canonicalRealpath(p, { realpath: deps.realpath });
  return r === null ? p : r;
}

// Project-scope entries whose projectPath is an ancestor of (or equal to)
// `projectPath`, longest `projectPath` wins (first-encountered on a tie); falls
// back to the first user-scope entry; absent either, null. Non-object entries
// are skipped. deps: { realpath, homedir } — `homedir` is only read when
// `opts.excludeHome` is set, in which case a project entry whose realpathed
// `projectPath` is the realpathed home directory is skipped.
function selectEntry(entries, projectPath, deps, opts = {}) {
  const target = safeRealpath(projectPath, deps);
  const home = opts.excludeHome ? safeRealpath(deps.homedir(), deps) : null;
  let best = null;
  let bestLen = -1;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.scope !== 'project' || typeof entry.projectPath !== 'string') continue;
    const candidate = safeRealpath(entry.projectPath, deps);
    if (home !== null && candidate === home) continue;
    // One intended difference from the former inline test (#3417): that test
    // excluded any relative path starting with '..', so a child component named
    // like '..foo' was wrongly treated as outside the candidate. It now counts
    // as contained; only a whole '..' component is a parent escape.
    if (isAncestorOrSelf(candidate, target) && candidate.length > bestLen) {
      best = entry;
      bestLen = candidate.length;
    }
  }
  if (best) return best;
  return entries.find((e) => e && typeof e === 'object' && e.scope === 'user') || null;
}

module.exports = { selectEntry, safeRealpath };
