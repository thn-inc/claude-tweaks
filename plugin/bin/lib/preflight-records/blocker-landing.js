// bin/lib/preflight-records/blocker-landing.js
// Out-of-run blocker landing check (#4553). /flow's pre-flight used to read a
// CLOSED blocked-by prerequisite as satisfied even when the commit that closed
// it never reached the integration branch (a PR merged into `production`, say,
// while the run builds on `dev`). This module judges each out-of-run blocker
// with one of five verdicts: `open`, `landed`, `unlanded`, `not-applicable`
// (closed NOT_PLANNED / DUPLICATE — nothing was meant to land), and
// `undetermined` (this one blocker cannot be judged: unresolvable number, no
// candidate commit, a failed reachability probe, or a closing-PR read cut at
// first:10 with nothing reachable). Each result is exactly
// `{ blocker, verdict, commit, via }`; `via` says why — closer-pr, closer-commit
// or closing-pr-ref (where the deciding commit came from), state, state-reason,
// no-candidate, probe-failed, references-truncated, not-found, or records-json.
//
// Candidate commits are the UNION of the recorded closer (a merged PR's
// mergeCommit, or a closing Commit) and every merged closedByPullRequests
// reference, closer first, deduped by sha; the blocker is `landed` when ANY
// candidate is reachable from the integration branch — a fix merged into
// `dev` by a second PR counts, whatever the closer was.
//
// A whole-query failure (a blocker that is not a positive safe integer, the
// GraphQL call throwing, unparseable output, no data.repository, any
// non-NOT_FOUND error, or a `b{n}` alias that is not a non-null, non-array
// object and that no NOT_FOUND error names) is never `undetermined`:
// fetchBlockerLanding returns `{results: null, error}` and the CLI stops the
// run — a malformed response fails whole, as
// bin/lib/issues/native-dependencies.js's does (#723). The one
// recovery is NOT_FOUND-only: `gh api graphql` exits 1 when any alias fails to
// resolve but still prints the partial data, so when every error (thrown or
// on exit-0 stdout) is a NOT_FOUND on a requested `b{n}` alias the call counts
// as succeeded, and exactly the aliases those errors name read
// `undetermined`/`not-found`.
//
// Reachability goes through the REST compare API, not local git: the local
// clone may be shallow or stale (a cloud sandbox's usually is), and answering
// locally would need a `git fetch` of the integration branch — a side effect
// pre-flight must not have. `buildNativeDependencyQuery` is deliberately not
// reused: it reads a dependent's blockedBy edges, while this needs each
// blocker's own state, stateReason, and closing sources.
//
// The runner is a required parameter (no defaultRunner here): runner(args) is
// invoked as if `gh ${args.join(' ')}` and returns stdout; a throw is a
// failed call — the bin/lib/issues/native-dependencies.js contract.
'use strict';

const { errorText } = require('./preflight-records');

const NOT_APPLICABLE_REASONS = new Set(['NOT_PLANNED', 'DUPLICATE']);

function result(blocker, verdict, commit, via) {
  return { blocker, verdict, commit, via };
}

// blockers: number[] -> the aliased query string, or null for empty/non-array.
// Each blocker is interpolated, so one that is not a positive safe integer throws.
// closedByPullRequestsReferences is read first:10 — a blocker closed by more PRs
// than that is far outside realistic range, and pageInfo{hasNextPage} marks the
// cut so classifyBlocker reads an otherwise-unlanded verdict as undetermined
// instead of stopping the run on a commit it never saw.
function buildBlockerLandingQuery(blockers) {
  if (!Array.isArray(blockers) || blockers.length === 0) return null;
  const bad = blockers.findIndex((n) => !(Number.isSafeInteger(n) && n > 0));
  if (bad !== -1) throw new Error(`invalid blocker number: ${String(blockers[bad])}`);
  const fields = blockers
    .map((n) => `b${n}: issue(number:${n}){ number state stateReason timelineItems(itemTypes:[CLOSED_EVENT], last:1){ nodes{ ... on ClosedEvent { closer { __typename ... on PullRequest { number merged baseRefName mergeCommit{ oid } } ... on Commit { oid } } } } } closedByPullRequestsReferences(first:10, includeClosedPrs:true){ pageInfo{ hasNextPage } nodes{ number merged baseRefName mergeCommit{ oid } } } }`)
    .join(' ');
  return `query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ ${fields} } }`;
}

const mergedOid = (p) => (p && p.merged === true && p.mergeCommit && p.mergeCommit.oid) || null;

// A b{n} issue node -> [{sha, via}]: the closer first, then each merged
// closing-PR reference, deduped by sha keeping the first. An unmerged PR
// (closer or reference) contributes nothing.
function candidateCommits(node) {
  const out = [];
  const seen = new Set();
  const add = (sha, via) => {
    if (typeof sha !== 'string' || !sha || seen.has(sha)) return;
    seen.add(sha);
    out.push({ sha, via });
  };
  const events = (node && node.timelineItems && Array.isArray(node.timelineItems.nodes)) ? node.timelineItems.nodes : [];
  const lastEvent = events[events.length - 1];
  const closer = lastEvent && lastEvent.closer;
  if (closer && closer.__typename === 'PullRequest') add(mergedOid(closer), 'closer-pr');
  else if (closer && closer.__typename === 'Commit') add(closer.oid, 'closer-commit');
  const refs = (node && node.closedByPullRequestsReferences && Array.isArray(node.closedByPullRequestsReferences.nodes))
    ? node.closedByPullRequestsReferences.nodes : [];
  for (const ref of refs) add(mergedOid(ref), 'closing-pr-ref');
  return out;
}

// compare API `.status` stdout -> reachable | unreachable | error.
function reachabilityFromStatus(status) {
  const s = typeof status === 'string' ? status.trim() : '';
  if (s === 'identical' || s === 'behind') return 'reachable';
  if (s === 'ahead' || s === 'diverged') return 'unreachable';
  return 'error';
}

// The REST path is caller-built, so its interpolated owner/repo get their own
// guard (gh-api-module-pattern: no bound-variable escape hatch for a path).
function repoSegmentError(owner, repo) {
  for (const [name, v] of [['owner', owner], ['repo', repo]]) {
    if (typeof v !== 'string' || !v || v === '.' || v === '..') return `invalid ${name} for the compare API path: ${JSON.stringify(v)}`;
  }
  return null;
}

// The reachability read. No -f/-F field (it would flip gh api to POST); the
// branch is encoded per segment so `#`/`%` cannot address another ref.
function compareArgs({ owner, repo, host, integrationBranch, sha }) {
  const bad = repoSegmentError(owner, repo);
  if (bad) throw new Error(bad);
  const encodedBase = integrationBranch.split('/').map(encodeURIComponent).join('/');
  const args = ['api', `repos/${owner}/${repo}/compare/${encodedBase}...${sha}`, '--jq', '.status'];
  if (host && host !== 'github.com') args.push('--hostname', host);
  return args;
}

// A b{n} alias value that is an issue object: non-null, non-array.
const isIssueNode = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// blocker, its b{n} node (anything else when a NOT_FOUND named it), sha ->
// reachability map -> one result. Rules apply in order.
function classifyBlocker(blocker, node, reach) {
  if (!isIssueNode(node)) return result(blocker, 'undetermined', null, 'not-found');
  if (node.state === 'OPEN') return result(blocker, 'open', null, 'state');
  if (NOT_APPLICABLE_REASONS.has(node.stateReason)) return result(blocker, 'not-applicable', null, 'state-reason');
  const candidates = candidateCommits(node);
  if (!candidates.length) return result(blocker, 'undetermined', null, 'no-candidate');
  const landed = candidates.find((c) => reach.get(c.sha) === 'reachable');
  if (landed) return result(blocker, 'landed', landed.sha, landed.via);
  const failed = candidates.find((c) => reach.get(c.sha) !== 'unreachable');
  if (failed) return result(blocker, 'undetermined', failed.sha, 'probe-failed');
  // `unlanded` claims no candidate is reachable; a references read cut at first:10
  // has not seen them all, so it cannot make that claim.
  const refs = node.closedByPullRequestsReferences;
  if (refs && refs.pageInfo && refs.pageInfo.hasNextPage === true) {
    return result(blocker, 'undetermined', candidates[0].sha, 'references-truncated');
  }
  return result(blocker, 'unlanded', candidates[0].sha, candidates[0].via);
}

function undeterminedAll(blockers, via) {
  return blockers.map((n) => result(n, 'undetermined', null, via));
}

// The gh-absent (--blocker-states-json) classifier over one MCP-fetched
// `{state, stateReason|state_reason}` entry. A closed blocker cannot be
// judged for landing without gh, so it reads undetermined unless its reason
// says nothing was meant to land. null = no recognisable state (the CLI
// turns it into exit 2).
function classifyFromState(blocker, entry) {
  if (!entry || typeof entry !== 'object') return null;
  const state = typeof entry.state === 'string' ? entry.state.toLowerCase() : null;
  if (state === 'open') return result(blocker, 'open', null, 'records-json');
  if (state !== 'closed') return null;
  const reason = entry.stateReason ?? entry.state_reason;
  if (typeof reason === 'string' && NOT_APPLICABLE_REASONS.has(reason.toUpperCase())) {
    return result(blocker, 'not-applicable', null, 'state-reason');
  }
  return result(blocker, 'undetermined', null, 'records-json');
}

// parsed response -> the repository object when `errors` is non-empty and
// every entry is a NOT_FOUND on a requested b{n} alias; else null.
function notFoundOnlyRepository(parsed, blockers) {
  const repository = parsed && parsed.data && parsed.data.repository;
  if (!repository || typeof repository !== 'object') return null;
  const errors = parsed.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const requested = new Set(blockers.map((n) => `b${n}`));
  const ok = errors.every((e) => e && e.type === 'NOT_FOUND'
    && Array.isArray(e.path) && e.path.length === 2 && e.path[0] === 'repository' && requested.has(e.path[1]));
  return ok ? repository : null;
}

// A thrown GraphQL call -> its parsed stdout when that carries a NOT_FOUND-only
// error list; else null (a whole-query failure).
function recoveredResponse(err, blockers) {
  if (!err || err.stdout == null) return null;
  let parsed;
  try { parsed = JSON.parse(String(err.stdout)); } catch { return null; }
  return notFoundOnlyRepository(parsed, blockers) ? parsed : null;
}

const errorMessages = (errors) => errors.map((e) => (e && (e.message || e.type)) || JSON.stringify(e)).join('; ');

// Runs the GraphQL call -> { parsed } (a response with a usable data.repository
// whose errors, if any, are all NOT_FOUND on a requested alias) | { error } (a
// whole-query failure). A thrown call counts only when its stdout recovers.
function queryRepository(runner, args, blockers) {
  let out;
  try {
    out = runner(args);
  } catch (err) {
    const recovered = recoveredResponse(err, blockers);
    return recovered ? { parsed: recovered } : { error: errorText(err) };
  }
  let parsed;
  try { parsed = JSON.parse(out); } catch (err) {
    return { error: `unparseable GraphQL response: ${errorText(err)}` };
  }
  const errors = Array.isArray(parsed && parsed.errors) ? parsed.errors : [];
  const data = parsed && parsed.data;
  if (!data || !data.repository || typeof data.repository !== 'object') {
    return { error: `GraphQL response has no data.repository${errors.length ? `: ${errorMessages(errors)}` : ''}` };
  }
  if (errors.length && !notFoundOnlyRepository(parsed, blockers)) {
    return { error: `GraphQL errors: ${errorMessages(errors)}` };
  }
  return { parsed };
}

// -> { results: Map<number, result>|null, error: string|null, probeErrors? };
// results is null exactly when error is set (a whole-query failure — never
// per-blocker undetermined). probeErrors lists each compare call that threw,
// {sha, message}: the verdict stays per-blocker undetermined, but a systematic
// failure (a wrong integration branch, a 403, a rate limit) is no longer silent.
function fetchBlockerLanding({ blockers, owner, repo, host, integrationBranch, runner }) {
  if (!Array.isArray(blockers) || blockers.length === 0) return { results: new Map(), error: null, probeErrors: [] };
  const repoError = repoSegmentError(owner, repo);
  if (repoError) return { results: null, error: repoError };
  if (typeof integrationBranch !== 'string' || !integrationBranch) return { results: null, error: 'integrationBranch is required' };

  let query;
  try { query = buildBlockerLandingQuery(blockers); } catch (err) { return { results: null, error: errorText(err) }; }
  const args = ['api', 'graphql', ...(host && host !== 'github.com' ? ['--hostname', host] : []),
    '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`];
  const { parsed, error } = queryRepository(runner, args, blockers);
  if (!parsed) return { results: null, error };
  const { repository } = parsed.data;
  // Every error left is a NOT_FOUND on a requested alias; only the aliases those
  // errors name may be anything other than an issue object.
  const notFound = new Set((Array.isArray(parsed.errors) ? parsed.errors : []).map((e) => e.path[1]));
  const missing = blockers.map((n) => `b${n}`).filter((a) => !isIssueNode(repository[a]) && !notFound.has(a));
  if (missing.length) {
    return { results: null, error: `GraphQL response has no node for ${missing.join(', ')} and no NOT_FOUND error naming it` };
  }

  // One compare call per distinct candidate sha. Only a CLOSED blocker that
  // carries code is probed — the same cases classifyBlocker's rules 1-3 leave
  // to rule 4 onward (keep the two in step). A blocker stops probing at its
  // first reachable candidate: classifyBlocker reads `landed` off the first
  // reachable one in candidate order, so later probes could not change it.
  const reach = new Map();
  const probeErrors = [];
  for (const n of blockers) {
    const node = repository[`b${n}`];
    if (!node || node.state !== 'CLOSED' || NOT_APPLICABLE_REASONS.has(node.stateReason)) continue;
    for (const { sha } of candidateCommits(node)) {
      if (!reach.has(sha)) {
        try {
          reach.set(sha, reachabilityFromStatus(runner(compareArgs({ owner, repo, host, integrationBranch, sha }))));
        } catch (err) {
          reach.set(sha, 'error');
          probeErrors.push({ sha, message: errorText(err) });
        }
      }
      if (reach.get(sha) === 'reachable') break;
    }
  }
  const results = new Map();
  for (const n of blockers) results.set(n, classifyBlocker(n, repository[`b${n}`], reach));
  return { results, error: null, probeErrors };
}

module.exports = {
  buildBlockerLandingQuery, candidateCommits, reachabilityFromStatus, compareArgs,
  classifyBlocker, undeterminedAll, classifyFromState, fetchBlockerLanding,
};
