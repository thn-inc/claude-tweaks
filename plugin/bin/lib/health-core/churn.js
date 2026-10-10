'use strict';
const { execFileSync } = require('child_process');

// ─── domainChurn ─────────────────────────────────────────────────────────────
// Count commits touching any of `relPaths` since `sinceMs` (epoch ms). Returns
// 0 (not an error) when git is unavailable, paths don't exist, or there is no
// churn — the caller treats 0 as "nothing changed," not a failure signal.
// relPaths may be exact file paths or glob pathspecs — git's pathspec
// matching accepts both.
//
// Shared by harness-health/scope.js, journey-health/scope.js, and
// docs-health/scope.js — previously three near-identical copies of this
// function (down to an identical epoch-boundary date-parsing bug
// independently discovered and fixed three separate times before this
// extraction; see git history for journey-health/scope.js commit 7f6993f and
// docs-health/scope.js commit 8bbb3af).
//
// Memoized per exact (root, relPaths, sinceMs) triple, module-level and
// process-lifetime: selectTarget is called once per slot in a --budget > 1
// loop, and nothing on disk changes between slots of the same run — without
// caching, every slot re-spawns a `git log` subprocess (up to a 30s timeout)
// per remaining candidate, purely wasted I/O that scales with budget times
// candidate count. A call whose inputs genuinely changed (a different
// sinceMs after a cursor bump) still gets a fresh read. The cache is never
// invalidated against external git-history changes made mid-process — this
// is intentional for the one-shot-CLI-process usage this function is built
// for (each CLI invocation is a fresh Node process, so the cache never
// outlives a single command); see the "caches identical calls" test
// alongside this module for the explicit, deliberately-tested contract.
const churnCache = new Map(); // "root relPaths sinceMs" -> count

function domainChurn(root, relPaths, sinceMs) {
  if (!relPaths || relPaths.length === 0) return 0;
  const key = `${root} ${relPaths.join(' ')} ${sinceMs || 0}`;
  if (churnCache.has(key)) return churnCache.get(key);
  let count;
  try {
    // Full ISO 8601 datetime (with time-of-day and a Z/UTC suffix), not a
    // bare YYYY-MM-DD date string. A bare date string is parsed by git as
    // local midnight and then converted to UTC, which underflows to a
    // pre-epoch boundary (silently matching zero commits) in any positive
    // UTC-offset timezone when sinceMs is 0. git's numeric `@<seconds>`
    // epoch-literal syntax was tried as a fix but verified (via direct
    // experimentation) to be unreliable for small values: git's fuzzy
    // approxidate parser treats a small `@<N>` as an ambiguous relative
    // offset from "now" rather than an absolute timestamp, so `--since=@0`
    // silently degrades to "since right now" once any time at all has
    // elapsed since the commit — worse than the original bug. A full ISO
    // 8601 string is parsed by git's strict (non-fuzzy) date parser and
    // was verified robust across timezones and timing.
    const since = new Date(sinceMs || 0).toISOString();
    const out = execFileSync(
      'git',
      ['-C', root, 'log', '--oneline', `--since=${since}`, '--', ...relPaths],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000, windowsHide: true },
    );
    count = out.split('\n').filter(Boolean).length;
  } catch {
    count = 0;
  }
  churnCache.set(key, count);
  return count;
}

module.exports = { domainChurn };
