// bin/lib/reconcile/pr-state.js — PR-state join: a branch name -> the PR(s)
// covering it, tie-broken to one governing state. Flat sibling, not nested
// under any one check module — reap-merged.js, release-merged.js, and
// archive-merged.js all need this exact join, and the alternative (each
// re-deriving its own `gh pr list` call and tie-break) is the duplication
// CLAUDE.md's Don'ts already warns against. Deliberately gh-CLI-only: a
// Node subprocess cannot see an agent session's MCP tools (see
// `_shared/integration-model.md`) — a gh-absent environment reports that
// reason rather than attempting an MCP path.
//
// Bulk-screen probe findings (2026-08-20, live repo, read-only — #1082 Task 0):
// a 50-alias ref(qualifiedName)+associatedPullRequests query costs 1 GraphQL
// rate-limit point and resolves LIVE (a PR opened hours earlier appears — no
// search-index lag). ref() returns null for a branch deleted after its PR
// merged and for never-pushed names — so a null screen entry can hide real
// PR history; callers gate every destructive verdict on a per-branch confirm
// (resolvePrState) for exactly this reason. Untested: fork-headed PRs (none
// exist here; a divergence could only under-screen, never wrongly delete)
// and degraded 200-with-errors responses (classification fails closed on any
// incomplete response by construction).
'use strict';
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');
const { classifyGhApiError } = require('../issues/claim-store');
const { repoSlugOf } = require('../hooks/git-exec');
const { runClassified, runClassifiedAsync } = require('../shared-primitives');

const execFileAsync = promisify(execFile);

// Shared with claim-store.js/preflight.js/release-merged.js rather than a
// fourth/fifth copy of the same ENOENT-vs-everything-else classification
// (review finding: 5 near-identical copies drifting independently).
function classifyExecError(e) {
  return classifyGhApiError(e).failure === 'gh-absent' ? 'gh-absent' : 'network-failure';
}

const FETCH_TIMEOUT_MS = 5000;
const PR_LIST_ARGS = ['pr', 'list', '--state', 'all', '--json', 'number,state,mergedAt,updatedAt,mergeCommit'];

// Pure: the parsed `gh pr list` JSON array -> the one governing PR. Shared by
// both the sync and async resolvers below so the tie-break logic (and any
// future fix to it) lives in exactly one place (#820 review).
//
// Multi-PR tie-break: merge is terminal, so any merged PR in the set wins
// regardless of how many others exist for the same branch (a re-opened PR
// after a first was closed unmerged, for instance).
//
// opts.preferOpen (#664): a destructive caller (prune-remote — a pushed,
// unrecoverable deletion) opts in to the inverse priority: ANY open PR in
// the set governs, whichever side is newer — an open PR is a do-not-touch
// signal regardless of age, and decideRemotePrune skips on OPEN. Every other
// consumer passes no opts and keeps the merged-wins tie-break — including
// archive-branches.js, whose deletes are local-only and recoverable from
// origin, so it deliberately does not opt in (#664).
function pickGoverningPr(prs, opts) {
  if (!Array.isArray(prs) || prs.length === 0) return null;
  if (opts && opts.preferOpen) {
    const open = prs.filter((pr) => pr.state === 'OPEN');
    if (open.length > 0) {
      // Which OPEN PR is returned is unobservable to today's one caller
      // (prune-remote reads only .state) — the recency sort is hygiene for
      // a shared resolver, not load-bearing.
      return open.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    }
  }
  const merged = prs.find((pr) => pr.state === 'MERGED');
  if (merged) return merged;
  // Otherwise the most recently updated PR governs.
  return prs.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}

// Shared by both resolvePrState and resolvePrStateAsync below — defined once
// so the two twins' success shaping cannot silently drift (#1652, mirrors
// git-exec.js's runGit/runGitAsync and preflight.js's ghHealthCheck/
// ghHealthCheckAsync consolidation). `opts` is optional and threaded through
// to pickGoverningPr — resolvePrStateAsync deliberately never passes it (see
// its own comment below), so it resolves to `undefined` there, same as
// pickGoverningPr's own no-opts default.
function buildSuccess(prs, opts) {
  return pickGoverningPr(prs, opts);
}

// Never use `gh pr list --search` — GitHub's search index lags fresh writes.
// `--head {branch}` resolves against the REST list, which does not.
//
// A malformed/unparseable `gh pr list` response and an exec-level failure
// (ENOENT, timeout, non-zero exit) both reach classifyExecError as the
// runClassified mapError below — it only ever distinguishes gh-absent from
// everything else, so a JSON.parse failure classifies identically to the
// previous hard-coded 'network-failure' return, just via the shared path.
function resolvePrState(repoRoot, branch, opts) {
  if (!branch) return null;
  return runClassified(
    () => {
      const stdout = execFileSync(
        'gh',
        ['pr', 'list', '--head', branch, ...PR_LIST_ARGS.slice(2)],
        { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: FETCH_TIMEOUT_MS, windowsHide: true },
      );
      return buildSuccess(JSON.parse(stdout), opts);
    },
    classifyExecError,
  );
}

// #1962: archive-merged.js's main sweep derives a branch name to query by
// (`resolvePrState` above needs one), but a run dir whose worktree is
// confirmably gone AND whose branch has since been deleted has no branch
// left to derive — `gh pr list --head {branch}` has nothing to query.
// `run-state.json`'s `pr.number` (stamped once at PR-early lifecycle time,
// never cleared) survives that branch deletion, so probe by number directly
// instead of giving up. Same JSON shape as `resolvePrState`'s governing PR
// (`{number, state, mergedAt, updatedAt, mergeCommit}`) — no tie-break
// needed, since a PR number resolves to at most one PR.
function resolvePrStateByNumber(repoRoot, number) {
  if (!number) return null;
  return runClassified(
    () => {
      const stdout = execFileSync(
        'gh',
        ['pr', 'view', String(number), '--json', 'number,state,mergedAt,updatedAt,mergeCommit'],
        { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: FETCH_TIMEOUT_MS, windowsHide: true },
      );
      return JSON.parse(stdout);
    },
    classifyExecError,
  );
}

// Deliberately no opts/preferOpen here — no destructive async caller exists (#664); add it only when one does.
//
// Async twin of resolvePrState — a real (non-blocking) execFile, so a caller
// can fan this out through gh-pool's runWithConcurrency the same way
// release-merged.js already does for its issue-state reads (#820 review: the
// prior release-merged.js only pooled the issue-state call, leaving this
// per-active-claim `gh pr list` call — a superset of what needs issue
// evidence — fully serial).
async function resolvePrStateAsync(repoRoot, branch) {
  if (!branch) return null;
  return runClassifiedAsync(
    async () => {
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'list', '--head', branch, ...PR_LIST_ARGS.slice(2)],
        { cwd: repoRoot, encoding: 'utf8', timeout: FETCH_TIMEOUT_MS, windowsHide: true },
      );
      return buildSuccess(JSON.parse(stdout));
    },
    classifyExecError,
  );
}

const BULK_TIMEOUT_MS = 15000; // one chunked call covers many branches — roomier than FETCH_TIMEOUT_MS's per-branch 5s
const BULK_CHUNK = 50; // probe-validated 2026-08-20: a 50-alias chunk costs 1 GraphQL rate-limit point (see header)

// branches chunk -> one aliased GraphQL query string. Branch names are
// JSON-escaped into the alias arguments (they come from for-each-ref, but
// escape anyway); owner/name travel as typed variables, never placeholders.
function buildBulkQuery(branches) {
  const fields = branches
    .map((b, i) => `b${i}: ref(qualifiedName:${JSON.stringify('refs/heads/' + b)}){ associatedPullRequests(first:10){ nodes{ number state mergedAt updatedAt } pageInfo{ hasNextPage } } }`)
    .join('\n    ');
  return `query($owner:String!,$name:String!){\n  repository(owner:$owner,name:$name){\n    ${fields}\n  }\n}`;
}

function defaultBulkRunner(args, cwd) {
  return execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: BULK_TIMEOUT_MS, windowsHide: true });
}

// The bulk screen (#1082): every requested branch's governing PR in
// ceil(N/50) GraphQL round trips instead of N REST calls. ALL-OR-NOTHING:
// chunks issue sequentially and short-circuit on the first failure; any
// transport failure, HTTP-200-with-errors, or unparseable/incomplete
// response fails the WHOLE call ('network-failure') — a partial map would
// make a missing chunk's branches indistinguishable from no-PR branches.
// A returned Map is complete for every requested branch; null means
// genuinely no governing PR/ref (including a ref deleted after merge —
// the probe-confirmed blind spot callers gate with per-branch confirms).
function resolvePrStatesBulk(repoRoot, branches, opts = {}) {
  const runner = opts.runner || ((args) => defaultBulkRunner(args, repoRoot));
  const map = new Map();
  if (!Array.isArray(branches) || branches.length === 0) return map;
  const slug = opts.repoSlug || repoSlugOf(repoRoot);
  if (!slug) return 'network-failure'; // no resolvable origin — fail closed, spawn nothing
  const [owner, name] = slug.split('/');
  for (let at = 0; at < branches.length; at += BULK_CHUNK) {
    const chunk = branches.slice(at, at + BULK_CHUNK);
    let parsed;
    try {
      // -f, never -F: String! variables must not be type-coerced (#610's shipped bug shape)
      const stdout = runner(['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', 'query=' + buildBulkQuery(chunk)]);
      parsed = JSON.parse(stdout);
    } catch (e) {
      return classifyExecError(e);
    }
    const repo = parsed && parsed.data && parsed.data.repository;
    if (!repo || (Array.isArray(parsed.errors) && parsed.errors.length > 0)) return 'network-failure';
    for (let i = 0; i < chunk.length; i += 1) {
      const key = 'b' + i;
      if (!(key in repo)) return 'network-failure'; // incomplete alias set — never a silent null
      const node = repo[key];
      const assoc = node && node.associatedPullRequests;
      // A branch with more than 10 associated PRs would otherwise have its true governing state
      // fall outside this page — silently mis-classifying it (review finding) rather than failing
      // loud. Same "never a silent partial" posture as the missing-alias check above: the sibling
      // sub-issues query (native-dependencies.js) instead routes a truncated parent onto a `retry`
      // list for a per-item fallback, but that contract doesn't fit here — this module's own
      // header already commits to "fails the WHOLE call on any incomplete response", so a
      // truncated page fails the whole chunk the same way an incomplete alias set does, rather
      // than inventing a second, narrower partial-result shape.
      if (assoc && assoc.pageInfo && assoc.pageInfo.hasNextPage) return 'network-failure';
      const prs = assoc && assoc.nodes;
      map.set(chunk[i], node === null ? null : pickGoverningPr(prs, opts));
    }
  }
  return map;
}

module.exports = {
  resolvePrState, resolvePrStateAsync, resolvePrStatesBulk, resolvePrStateByNumber, FETCH_TIMEOUT_MS, BULK_CHUNK,
};
