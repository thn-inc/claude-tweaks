// bin/lib/issues/native-dependencies.js
// Executes bin/lib/issues/record.js's buildNativeDependencyQuery — the pure
// batched, aliased GraphQL query builder for work-links: native's blocked-by
// check — via an injectable runner, and parses the response into the
// {blockedBy: number[], openBlocker: boolean, openBlockerIds: number[]} shape
// every caller expects. Extracted from
// bin/lib/preflight-records/preflight-records.js (#538) so
// bin/resolve-blockers.js's single-record CLI and preflight-records.js's own
// N-record batch call the same underlying function instead of each carrying
// its own copy of the GraphQL-call-and-parse logic. Not pure (network via
// the injected runner) — deliberately kept out of record.js, which stays a
// pure, no-network module.
'use strict';

const { buildNativeDependencyQuery, hasOpenNativeBlocker, buildNativeSubIssuesQuery, buildNativeParentQuery } = require('./record');

// { numbers, owner, repo, runner } -> Map<number, {blockedBy: number[],
// openBlocker: boolean, openBlockerIds: number[]}>.
// ONE batched, aliased GraphQL call (buildNativeDependencyQuery) resolving
// every candidate's native blockedBy connection at once — work-links: native.
// owner/repo are already-resolved String! values, so -f (never -F — -F would
// type-coerce an all-numeric name, gh-api-module-pattern's flag table).
//
// Throws — never returns a partial map — when `data.repository` is
// null/missing, or any candidate's `i{n}` alias is absent from the
// response: the same "throw on a partial result rather than returning a
// partial map" rule bin/lib/issues/link.js's resolveDatabaseIds follows.
// Without this, a malformed/error GraphQL response silently read as
// `blockedBy: [], openBlocker: false` for every affected record — a
// dependency-satisfied false positive (#723). Callers' own try/catch around
// this call routes the thrown message to their exit-1, all-failures-named
// path (preflight-records.js) or a dedicated non-zero exit (resolve-blockers.js).
function fetchNativeDependencies({ numbers, owner, repo, runner } = {}) {
  const result = new Map();
  const query = buildNativeDependencyQuery(numbers);
  if (!query) return result;
  const out = runner(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`]);
  const parsed = JSON.parse(out);
  const repository = parsed && parsed.data && parsed.data.repository;
  const missing = repository ? numbers.filter((n) => !repository[`i${n}`]) : numbers.slice();
  if (missing.length) {
    const errs = Array.isArray(parsed && parsed.errors) ? parsed.errors.map((e) => e && e.message).filter(Boolean) : [];
    const suffix = errs.length ? ` (GraphQL: ${errs.join('; ')})` : '';
    const reason = repository ? 'missing dependency data for' : 'missing repository — no dependency data for';
    throw new Error(`${reason} ${missing.map((n) => `#${n}`).join(', ')}${suffix}`);
  }
  for (const n of numbers) {
    const node = repository[`i${n}`];
    const nodes = (node.blockedBy && node.blockedBy.nodes) || [];
    result.set(n, {
      blockedBy: nodes.map((b) => b && b.number).filter((v) => v !== undefined),
      openBlocker: hasOpenNativeBlocker(node),
      // The identical OPEN-state filter partitionByOpenNativeBlockers
      // (bin/lib/issues/record.js) applies, precomputed here so a caller holding
      // only this output — dispatch/queue-pull-script.md via resolve-blockers.js
      // — names the blocker ids without a raw GraphQL response (#1309).
      openBlockerIds: nodes.filter((b) => b && b.state === 'OPEN').map((b) => b.number),
    });
  }
  return result;
}

// { numbers, owner, repo, runner } -> { byParent: Map<number, number[]>, retry: number[] }.
// ONE batched, aliased GraphQL call (buildNativeSubIssuesQuery) resolving every
// parent's native subIssues connection at once — work-links: native.
//
// Error posture differs from fetchNativeDependencies above by design (#1097's
// error ladder): a null/missing data.repository still THROWS (whole-response
// failure, same as above), but a single missing alias — or an alias whose
// pageInfo.hasNextPage is true (more sub-issues than one first:100 page) —
// routes that parent onto `retry` for the caller's per-parent REST fallback
// instead of failing the whole batch. Never lands in byParent as [] — an
// empty entry would read as "confirmed no sub-issues" and re-admit that
// parent's sub-issues into trust cells as ungraded evidence (#723's shape).
function fetchNativeSubIssues({ numbers, owner, repo, runner } = {}) {
  const result = { byParent: new Map(), retry: [] };
  const query = buildNativeSubIssuesQuery(numbers);
  if (!query) return result;
  const out = runner(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`]);
  const parsed = JSON.parse(out);
  const repository = parsed && parsed.data && parsed.data.repository;
  if (!repository) {
    const errs = Array.isArray(parsed && parsed.errors) ? parsed.errors.map((e) => e && e.message).filter(Boolean) : [];
    throw new Error(`missing repository — no sub-issue data for ${numbers.map((n) => `#${n}`).join(', ')}${errs.length ? ` (GraphQL: ${errs.join('; ')})` : ''}`);
  }
  for (const n of numbers) {
    const node = repository[`i${n}`];
    const conn = node && node.subIssues;
    if (!conn || (conn.pageInfo && conn.pageInfo.hasNextPage)) {
      result.retry.push(n);
      continue;
    }
    result.byParent.set(n, (conn.nodes || []).map((s) => s && s.number).filter((v) => Number.isInteger(v)));
  }
  return result;
}

// { number, owner, repo, runner } -> number|null -- the resolved native
// parent's issue number, or null when the issue has no parent. Wraps
// buildNativeParentQuery for a single candidate: bin/lib/wrap-up/engine-verify.js's
// resolveParent uses this instead of `gh issue view --json parent`, which gh
// <2.96 rejects as an unknown JSON field (#1841) -- GraphQL's Issue.parent
// works on every gh version that can run GraphQL at all.
//
// Throws on a whole-response failure (missing repository, or this candidate's
// own alias absent from the response) -- same "throw on a partial result"
// posture fetchNativeDependencies above documents; there is no per-item
// fallback for a single-candidate call, so a partial result here is simply a
// failure.
function fetchNativeParent({ number, owner, repo, runner } = {}) {
  const query = buildNativeParentQuery([number]);
  if (!query) return null;
  const out = runner(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`]);
  const parsed = JSON.parse(out);
  const repository = parsed && parsed.data && parsed.data.repository;
  const node = repository && repository[`i${number}`];
  if (!node) {
    const errs = Array.isArray(parsed && parsed.errors) ? parsed.errors.map((e) => e && e.message).filter(Boolean) : [];
    const reason = repository ? 'missing parent data for' : 'missing repository — no parent data for';
    throw new Error(`${reason} #${number}${errs.length ? ` (GraphQL: ${errs.join('; ')})` : ''}`);
  }
  return node.parent ? node.parent.number : null;
}

module.exports = { fetchNativeDependencies, fetchNativeSubIssues, fetchNativeParent };
