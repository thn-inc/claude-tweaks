'use strict';

const MARK_STATUSES = new Set(['declined']);

// Shared `mark <fingerprint> <status>` command — byte-identical across
// harness-health.js, journey-health.js, and docs-health.js before this
// extraction (code-health.js has no mark command, so it doesn't consume
// this). toolName parameterizes the usage message's script name.
//
// The 'declined' mark is always written to the local gitignored cache (the
// pre-existing behavior — every caller must keep working unmodified with no
// other params supplied). Two capabilities are additive and OPTIONAL,
// activated only when the caller supplies them:
//   - `updateCache` (from health-core/cache.js's createCache): if supplied,
//     the local write goes through an atomic read-modify-write instead of a
//     bare readCache-then-writeCache pair, closing the race where two
//     near-simultaneous `mark` invocations against the same cache.json
//     silently clobber one another.
//   - `readDurableState`/`writeDurableState` (from a skill's own cache.js,
//     wrapping health-core/durable-state.js's createDurableState with
//     includeDeclined: true): if BOTH are supplied, the declined mark is
//     ALSO persisted to the health-state git branch — durable across a
//     scheduled Routine firing's fresh, stateless container, unlike the
//     local cache, which does not survive that. Without this, a 'declined'
//     finding (by definition never filed as a GitHub issue, so nothing for
//     dedup to reconstruct from) would silently reappear on the next
//     Routine firing despite the skill's own documented "suppressed
//     forever" promise.
function makeCmdMark({ readCache, writeCache, updateCache, readDurableState, writeDurableState, toolName }) {
  return function cmdMark(args) {
    const root = args.root || process.cwd();
    const fp = args._[1];
    const status = args._[2];
    if (!fp || !MARK_STATUSES.has(status)) {
      process.stderr.write(`usage: ${toolName}.js mark <fingerprint> <${[...MARK_STATUSES].join('|')}> [--root <dir>]\n`);
      return 2;
    }
    const entry = { status, lastSeenMs: Date.now() };
    let cache;
    if (updateCache) {
      cache = updateCache(root, (current) => ({ ...current, [fp]: entry }));
    } else {
      cache = readCache(root);
      cache[fp] = entry;
      writeCache(root, cache);
    }
    if (readDurableState && writeDurableState) {
      const result = writeDurableState(root, (current) => ({
        ...current,
        declined: { ...(current.declined || {}), [fp]: { lastSeenMs: entry.lastSeenMs } },
      }));
      if (!result.ok) {
        process.stderr.write(`mark: durable health-state persistence failed (declined mark is still saved locally): ${result.error}\n`);
      }
    }
    process.stdout.write(JSON.stringify(cache[fp], null, 2) + '\n');
  };
}

// Pure: merges durable `declined` marks (from the health-state branch) into
// a local cache object as status:'declined' entries, so a declined mark
// survives a scheduled Routine's fresh container even though the local
// cache does not. Durable declined entries take precedence over whatever
// (if anything) is already in the local cache for that fingerprint,
// matching each skill's own dedup.js decide()'s precedence (its optional
// durableDeclined-equivalent argument is checked before the local-cache
// status branch). Shared by every skill wired with includeDeclined: true —
// only meaningful when readDurableState/writeDurableState are also passed
// to makeCmdMark above for the same skill.
function mergeDeclinedIntoCache(cache, declined) {
  const merged = { ...cache };
  for (const fp of Object.keys(declined || {})) {
    merged[fp] = { status: 'declined', lastSeenMs: declined[fp].lastSeenMs };
  }
  return merged;
}

// Pure: folds the fingerprints a run suppressed because their matching GitHub
// issue carried the `wontfix` label into the durable `declined` slice, so the
// suppression survives a later firing that cannot rebuild the issue index at
// all (`gh` absent AND no MCP transport, or GitHub unreachable outright). The
// local gitignored cache is not a substitute: it does not survive a scheduled
// Routine firing's fresh container, which is precisely the environment these
// skills run in unattended.
//
// Shared by all three health builders (harness/journey/docs
// buildValidateFindingsUpdate) rather than triplicated in each, so the entry
// shape and the first-write-wins rule below are defined once.
//
// First write wins: an existing entry is never overwritten. A human `mark
// ... declined` and a label-derived suppression both mean "never re-propose
// this," so clobbering would only churn `lastSeenMs` and lose the original
// provenance — and the human mark is the stronger statement of the two.
//
// `origin` records which path created the entry. Entries written by `mark`
// carry no `origin` (pre-existing shape, left untouched for compatibility);
// only label-derived ones are tagged, so provenance is readable off the
// health-state branch without a schema migration. mergeDeclinedIntoCache
// reads only `lastSeenMs`, so the extra key is inert to every consumer.
function mergeWontfixIntoDeclined(declined, fingerprints, { now = Date.now() } = {}) {
  const next = { ...(declined || {}) };
  for (const fp of fingerprints || []) {
    if (!fp || next[fp]) continue;
    next[fp] = { lastSeenMs: now, origin: 'wontfix-label' };
  }
  return next;
}

module.exports = {
  makeCmdMark, MARK_STATUSES, mergeDeclinedIntoCache, mergeWontfixIntoDeclined,
};
