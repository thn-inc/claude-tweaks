// bin/lib/reconcile/pr-state-cache.js — a per-pass PR-state resolver with a
// persisted terminal-answer cache (#4032). archive-merged, reap-merged and
// release-merged each ask `gh` about the same PRs every pass, one blocking
// call at a time; the answers that dominate (MERGED, "no PR for this branch")
// never change or rarely do. The resolver sits in front of pr-state.js with
// the same return contract and adds three layers, consulted in order:
// in-pass memo -> persisted entry still inside its TTL -> live call.
//
// Only TERMINAL answers persist (see persistableTtl): a MERGED PR is final, a
// by-number `pr-not-found` is final, and a branch with no PR is trusted for a
// few minutes only (a PR may be opened any time). OPEN/CLOSED PRs and every
// failure string (`gh-absent`, `network-failure`, `invalid-arguments`) are
// never persisted, and failures are not memoized either — a transient failure
// must not be replayed as an answer. `prefetch` fills the memo through the
// async twins under a concurrency cap so a sequential caller loop then hits
// the memo. Entries live in reconcile-cache.json's `prStates` key
// (cache.js) as `{ v, at }`, keyed `n:{number}` / `b:{branch}`; like the rest
// of that file this is best-effort — a miss costs one live call, never a
// wrong answer.
'use strict';
const {
  resolvePrState, resolvePrStateByNumber, resolvePrStateAsync, resolvePrStateByNumberAsync,
} = require('./pr-state');
const { readCache, writeCache } = require('./cache');
const { runWithConcurrency } = require('./gh-pool');

const PR_STATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const NO_PR_TTL_MS = 5 * 60 * 1000;

const isMerged = (value) => !!value && typeof value === 'object' && value.state === 'MERGED';

// Pure — how long an answer may be served from a PRIOR pass; 0 = never persist.
function persistableTtl(kind, value) {
  if (kind === 'number') {
    if (isMerged(value) || value === 'pr-not-found') return PR_STATE_RETENTION_MS;
    return 0;
  }
  if (kind === 'branch') {
    if (isMerged(value)) return PR_STATE_RETENTION_MS;
    if (value === null) return NO_PR_TTL_MS;
  }
  return 0;
}

// Live answers worth remembering within this pass: PR objects, null, and
// by-number `pr-not-found`. Every other string is a failure.
const isMemoizable = (value) => value === null || typeof value === 'object' || value === 'pr-not-found';

function createPrStateResolver({ root, now = Date.now, concurrency = 8, deps = {} } = {}) {
  const live = {
    byNumber: (n) => resolvePrStateByNumber(root, n),
    byBranch: (b) => resolvePrState(root, b),
    byNumberAsync: (n) => resolvePrStateByNumberAsync(root, n),
    byBranchAsync: (b) => resolvePrStateAsync(root, b),
    ...deps,
  };
  const memo = new Map(); // key -> answer, this pass only
  const learned = new Map(); // key -> { v, at }, persistable answers to merge on persist()
  let persisted = null; // lazy snapshot of reconcile-cache.json's prStates

  const keyFor = (kind, id) => (kind === 'number' ? `n:${id}` : `b:${id}`);

  function lookup(kind, key) {
    if (memo.has(key)) return { hit: true, value: memo.get(key) };
    if (persisted === null) persisted = readCache(root).prStates || {};
    const entry = persisted[key];
    if (entry && typeof entry === 'object' && typeof entry.at === 'number' && 'v' in entry) {
      // A non-persistable value has TTL 0, so a tampered entry never matches.
      if (now() - entry.at < persistableTtl(kind, entry.v)) return { hit: true, value: entry.v };
    }
    return { hit: false };
  }

  function learn(kind, key, value) {
    if (!isMemoizable(value)) return;
    memo.set(key, value);
    if (persistableTtl(kind, value) > 0) learned.set(key, { v: value, at: now() });
  }

  function makeSync(kind, call) {
    return (id) => {
      if (kind === 'branch' && !id) return call(id); // falsy input -> null, nothing to cache
      const key = keyFor(kind, id);
      const found = lookup(kind, key);
      if (found.hit) return found.value;
      const value = call(id);
      learn(kind, key, value);
      return value;
    };
  }

  function makeAsync(kind, call) {
    return async (id) => {
      if (kind === 'branch' && !id) return call(id);
      const key = keyFor(kind, id);
      const found = lookup(kind, key);
      if (found.hit) return found.value;
      const value = await call(id);
      learn(kind, key, value);
      return value;
    };
  }

  const byNumber = makeSync('number', (n) => live.byNumber(n));
  const byBranch = makeSync('branch', (b) => live.byBranch(b));
  const byNumberAsync = makeAsync('number', (n) => live.byNumberAsync(n));
  const byBranchAsync = makeAsync('branch', (b) => live.byBranchAsync(b));

  // Resolve every not-yet-known key through the async twins, capped. A failed
  // item is simply left unknown — a later sync call falls back to a live call.
  async function prefetch({ numbers = [], branches = [] } = {}) {
    const work = [];
    const seen = new Set();
    const add = (kind, id, run) => {
      if (kind === 'branch' && !id) return;
      const key = keyFor(kind, id);
      if (seen.has(key) || lookup(kind, key).hit) return;
      seen.add(key);
      work.push(() => run(id));
    };
    for (const n of numbers) add('number', n, byNumberAsync);
    for (const b of branches) add('branch', b, byBranchAsync);
    await runWithConcurrency(work, (job) => job(), concurrency);
  }

  // Merge newly learned persistable entries into reconcile-cache.json. Re-reads
  // the file right before writing so another writer's prStates entries and every
  // other cache key survive; drops entries past retention (and malformed ones).
  function persist() {
    const t = now();
    const cache = readCache(root);
    const prStates = {};
    let changed = learned.size > 0;
    for (const [key, entry] of Object.entries(cache.prStates || {})) {
      if (entry && typeof entry === 'object' && typeof entry.at === 'number' && t - entry.at <= PR_STATE_RETENTION_MS) {
        prStates[key] = entry;
      } else {
        changed = true;
      }
    }
    for (const [key, entry] of learned) prStates[key] = entry;
    if (!changed) return;
    writeCache(root, { ...cache, prStates });
    learned.clear();
  }

  return { byNumber, byBranch, byNumberAsync, byBranchAsync, prefetch, persist };
}

module.exports = { createPrStateResolver, persistableTtl, PR_STATE_RETENTION_MS, NO_PR_TTL_MS };
