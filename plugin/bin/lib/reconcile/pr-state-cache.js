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
// the memo — one aliased GraphQL read first (pr-state-batch.js), the per-item
// twins only for what it left unanswered. Entries live in reconcile-cache.json's
// `prStates` key (cache.js) as `{ v, at }`, keyed `n:{number}` / `b:{branch}`;
// like the rest of that file this is best-effort — a miss costs one live call,
// never a wrong answer. A per-call `{ freshNull: true }` (by-branch calls and
// `prefetch`) refuses a PERSISTED "no PR" answer from a prior pass and queries
// live instead — for a caller whose verdict flips on a PR opened inside the
// null's 5-minute TTL (release); a null learned live in this pass still serves.
'use strict';
const {
  resolvePrState, resolvePrStateByNumber, resolvePrStateAsync, resolvePrStateByNumberAsync,
} = require('./pr-state');
const { readCache, writeCache } = require('./cache');
const { runWithConcurrency } = require('./gh-pool');
const { fetchBatch } = require('./pr-state-batch');

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
    fetchBatch,
    ...deps,
  };
  const memo = new Map(); // key -> answer, this pass only
  const learned = new Map(); // key -> { v, at }, persistable answers to merge on persist()
  let persisted = null; // lazy snapshot of reconcile-cache.json's prStates

  const keyFor = (kind, id) => (kind === 'number' ? `n:${id}` : `b:${id}`);

  function lookup(kind, key, { freshNull = false } = {}) {
    if (memo.has(key)) return { hit: true, value: memo.get(key) };
    if (persisted === null) persisted = readCache(root).prStates || {};
    const entry = persisted[key];
    if (entry && typeof entry === 'object' && typeof entry.at === 'number' && 'v' in entry) {
      if (freshNull && entry.v === null) return { hit: false };
      // A non-persistable value has TTL 0, so a tampered entry never matches. A
      // future `at` (clock stepped back, hand-edited file) has a negative age
      // that would sit under any TTL forever, so it never matches either.
      const age = now() - entry.at;
      if (age >= 0 && age < persistableTtl(kind, entry.v)) return { hit: true, value: entry.v };
    }
    return { hit: false };
  }

  function learn(kind, key, value) {
    if (!isMemoizable(value)) return;
    memo.set(key, value);
    if (persistableTtl(kind, value) > 0) learned.set(key, { v: value, at: now() });
  }

  function makeSync(kind, call) {
    return (id, { freshNull = false } = {}) => {
      if (kind === 'branch' && !id) return call(id); // falsy input -> null, nothing to cache
      const key = keyFor(kind, id);
      const found = lookup(kind, key, { freshNull });
      if (found.hit) return found.value;
      const value = call(id);
      learn(kind, key, value);
      return value;
    };
  }

  function makeAsync(kind, call) {
    return async (id, { freshNull = false } = {}) => {
      if (kind === 'branch' && !id) return call(id);
      const key = keyFor(kind, id);
      const found = lookup(kind, key, { freshNull });
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

  // Peek only: the memo or a still-valid persisted entry, never a live call.
  // `undefined` = no known answer (a null answer is a real answer).
  function peekNumber(n) {
    if (!n) return undefined;
    const found = lookup('number', keyFor('number', n));
    return found.hit ? found.value : undefined;
  }

  // Resolve every not-yet-known key. One batched read (pr-state-batch.js) answers
  // what it can through the same `learn` path; only the keys it left unanswered
  // — or all of them, if it threw or returned nothing — go through the async
  // twins under the concurrency cap. A failed item is simply left unknown: a
  // later sync call falls back to a live call.
  async function prefetch({ numbers = [], branches = [], freshNull = false } = {}) {
    const pending = [];
    const seen = new Set();
    const add = (kind, id, run) => {
      if (kind === 'branch' && !id) return;
      const key = keyFor(kind, id);
      if (seen.has(key) || lookup(kind, key, { freshNull }).hit) return;
      seen.add(key);
      pending.push({ kind, id, key, run });
    };
    for (const n of numbers) add('number', n, byNumberAsync);
    for (const b of branches) add('branch', b, byBranchAsync);
    if (pending.length === 0) return;

    // The batch only takes positive-integer numbers; anything else stays with
    // the per-item path, which owns the 'invalid-arguments' answer.
    const batchNumbers = pending.filter((p) => p.kind === 'number' && /^[1-9]\d*$/.test(String(p.id))).map((p) => Number(p.id));
    const batchHeads = pending.filter((p) => p.kind === 'branch').map((p) => p.id);
    if (batchNumbers.length > 0 || batchHeads.length > 0) {
      try {
        const got = await live.fetchBatch(root, { numbers: batchNumbers, heads: batchHeads });
        const answeredNumbers = got && got.byNumber instanceof Map ? got.byNumber : new Map();
        const answeredHeads = got && got.byHead instanceof Map ? got.byHead : new Map();
        for (const p of pending) {
          if (p.kind === 'number') {
            const n = Number(p.id);
            if (answeredNumbers.has(n)) learn('number', p.key, answeredNumbers.get(n));
          } else if (answeredHeads.has(p.id)) {
            learn('branch', p.key, answeredHeads.get(p.id));
          }
        }
      } catch {
        /* degrade to the per-item twins below */
      }
    }
    // memo.has, not lookup: a failure string `learn` refused is correctly "unanswered".
    const unanswered = pending.filter((p) => !memo.has(p.key));
    await runWithConcurrency(unanswered, (p) => p.run(p.id, { freshNull }), concurrency);
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
      if (entry && typeof entry === 'object' && typeof entry.at === 'number' && entry.at <= t && t - entry.at <= PR_STATE_RETENTION_MS) {
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

  return { byNumber, byBranch, byNumberAsync, byBranchAsync, peekNumber, prefetch, persist };
}

module.exports = { createPrStateResolver, persistableTtl, PR_STATE_RETENTION_MS, NO_PR_TTL_MS };
