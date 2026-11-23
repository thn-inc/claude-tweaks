// bin/lib/preflight-records/blocker-landing.js
// Out-of-run blocker landing check (#4553). /flow's pre-flight used to read a
// CLOSED blocked-by prerequisite as satisfied even when the commit that closed
// it never reached the integration branch (a PR merged into `production`, say,
// while the run builds on `dev`). This module judges each out-of-run blocker
// with one of six verdicts: `open`, `landed`, `unlanded`, `not-applicable`
// (closed NOT_PLANNED / DUPLICATE — nothing was meant to land), and
// `undetermined` (this one blocker cannot be judged: unresolvable number, no
// candidate commit, a failed reachability probe, an unreadable changed-file
// list, or a closing-PR read cut at first:10 with nothing reachable), and
// `hollow` (#6142: closed, and every reachable candidate commit touches no Key
// File of the blocker — or, with no Key Files, only bookkeeping paths — so the
// closing PR landed paperwork, not the work). Each result is exactly
// `{ blocker, verdict, commit, via }` — `hollow` adds `pr`, the PR whose merge
// commit is the named candidate (null for a direct Commit closer); `via` says why
// — closer-pr, closer-commit
// or closing-pr-ref (where the deciding commit came from), state, state-reason,
// no-candidate, probe-failed, files-unreadable, references-truncated, not-found, records-json,
// cross-repository, or cross-repository-state-unreadable. The last two (#4793)
// belong to a native blocker that lives in ANOTHER repository
// (classifyCrossRepository): its result adds a fifth key, `repository`
// (`owner/name`), present only there, and its `open` verdict can come from them
// too — its number names that repository's issue, so it is never queried or
// probed here.
//
// A reachable candidate counts as landing only when its changed files (REST
// commits API, previous_filename included) touch a Key File of the blocker (see
// isHollow); the blocker is `landed` when ANY reachable non-hollow candidate exists.
//
// Candidate commits are the UNION of the recorded closer (a merged PR's
// mergeCommit, or a closing Commit) and every merged closedByPullRequests
// reference, closer first, deduped by sha; the blocker is `landed` when ANY
// reachable non-hollow candidate exists on the integration branch — a fix merged
// into `dev` by a second PR counts, whatever the closer was.
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
// `undetermined`/`not-found`. `recoveredResponse` is exported for
// `bin/preflight-records.js`'s native call, which recovers `i{n}` aliases the
// same way (#4792).
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
const { extractKeyFiles } = require('../issues/grouping');
const { globToRegExp, canonicalPath } = require('../issues/blast-radius');

const NOT_APPLICABLE_REASONS = new Set(['NOT_PLANNED', 'DUPLICATE']);

function result(blocker, verdict, commit, via) {
  return { blocker, verdict, commit, via };
}

// Paths a closing commit may touch without delivering a blocker's work (#6142).
const BOOKKEEPING_PATH_RE = /^(?:\.claude-tweaks\/pipelines\/|docs\/superpowers\/plans\/|docs\/plans\/[^/]+-ledger\.md$)/;

// A Key File entry keeps its first backticked span verbatim: strip a trailing
// `:N`, `:N-M` or `#L…` suffix; a trailing `/` prefix-matches; `*` globs
// (`**` spans directories, `*` stays in one segment); anything else is equality.
function keyMatches(file, rawKey) {
  const stripped = String(rawKey).replace(/(?:#L.*|:\d+(?:-\d+)?)$/, '');
  if (!stripped) return false;
  const key = canonicalPath(stripped);
  if (key.includes('*')) return globToRegExp(key).test(file);
  if (key.endsWith('/')) return file.startsWith(key);
  return file === key;
}

// files: a commit's changed paths (read successfully); keys: the blocker's Key
// Files. With keys, hollow = no file matches one (an empty list included); with
// none, hollow = a non-empty list that is all bookkeeping (an empty list is not).
function isHollow(files, keys) {
  if (keys.length > 0) return !files.some((f) => keys.some((k) => keyMatches(f, k)));
  return files.length > 0 && files.every((f) => BOOKKEEPING_PATH_RE.test(f));
}

const keyFilesOf = (node) => extractKeyFiles({
  body: node && node.body,
  labels: ((node && node.labels && Array.isArray(node.labels.nodes)) ? node.labels.nodes : []).map((l) => l && l.name),
});

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
    .map((n) => `b${n}: issue(number:${n}){ number state stateReason body labels(first:100){ nodes{ name } } timelineItems(itemTypes:[CLOSED_EVENT], last:1){ nodes{ ... on ClosedEvent { closer { __typename ... on PullRequest { number merged baseRefName mergeCommit{ oid } } ... on Commit { oid } } } } } closedByPullRequestsReferences(first:10, includeClosedPrs:true){ pageInfo{ hasNextPage } nodes{ number merged baseRefName mergeCommit{ oid } } } }`)
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

// The changed-files read for a candidate commit: filename plus previous_filename
// (a rename away from a Key File still touches it), one path per line.
function commitFilesArgs({ owner, repo, host, sha }) {
  const bad = repoSegmentError(owner, repo);
  if (bad) throw new Error(bad);
  const args = ['api', '--paginate', `repos/${owner}/${repo}/commits/${sha}`, '--jq', '.files[] | .filename, (.previous_filename // empty)'];
  if (host && host !== 'github.com') args.push('--hostname', host);
  return args;
}

// The PR number whose merge commit is `sha`, among the closer and the references.
function prForSha(node, sha) {
  const events = (node && node.timelineItems && Array.isArray(node.timelineItems.nodes)) ? node.timelineItems.nodes : [];
  const closer = events.length && events[events.length - 1] && events[events.length - 1].closer;
  if (closer && closer.__typename === 'PullRequest' && mergedOid(closer) === sha) return closer.number;
  const refs = (node && node.closedByPullRequestsReferences && Array.isArray(node.closedByPullRequestsReferences.nodes))
    ? node.closedByPullRequestsReferences.nodes : [];
  const hit = refs.find((r) => mergedOid(r) === sha);
  return hit ? hit.number : null;
}

// A b{n} alias value that is an issue object: non-null, non-array.
const isIssueNode = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// blocker, its b{n} node (anything else when a NOT_FOUND named it), sha ->
// reachability map, optional sha -> string[]|null changed-files map (null = the
// read failed; absent map = no hollow judgment) -> one result. Rules apply in order.
function classifyBlocker(blocker, node, reach, files) {
  if (!isIssueNode(node)) return result(blocker, 'undetermined', null, 'not-found');
  if (node.state === 'OPEN') return result(blocker, 'open', null, 'state');
  if (NOT_APPLICABLE_REASONS.has(node.stateReason)) return result(blocker, 'not-applicable', null, 'state-reason');
  const candidates = candidateCommits(node);
  if (!candidates.length) return result(blocker, 'undetermined', null, 'no-candidate');
  const reachable = candidates.filter((c) => reach.get(c.sha) === 'reachable');
  if (files && reachable.length) {
    const keys = keyFilesOf(node);
    const read = (c) => files.get(c.sha);
    const solid = reachable.find((c) => Array.isArray(read(c)) && !isHollow(read(c), keys));
    if (solid) return result(blocker, 'landed', solid.sha, solid.via);
    // No reachable candidate is non-hollow: fail closed before claiming hollow.
    const unreadable = reachable.find((c) => !Array.isArray(read(c)));
    if (unreadable) return result(blocker, 'undetermined', unreadable.sha, 'files-unreadable');
    const probeFailed = candidates.find((c) => reach.get(c.sha) !== 'unreachable' && reach.get(c.sha) !== 'reachable');
    if (probeFailed) return result(blocker, 'undetermined', probeFailed.sha, 'probe-failed');
    const cut = node.closedByPullRequestsReferences;
    if (cut && cut.pageInfo && cut.pageInfo.hasNextPage === true) {
      return result(blocker, 'undetermined', reachable[0].sha, 'references-truncated');
    }
    return { ...result(blocker, 'hollow', reachable[0].sha, reachable[0].via), pr: prForSha(node, reachable[0].sha) };
  }
  const landed = reachable[0];
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

// One crossRepoBlockers entry {number, repository, state} -> a result judged from
// the native node's state alone (#4793, Decisions Q1 and Q5). The number names
// another repository's issue, so it is never queried or probed here: a GraphQL
// lookup or compare call against this repository would read an unrelated issue.
// OPEN reads open; CLOSED reads undetermined (landing in the other repository is
// not checkable from here); any other state is unreadable and fails closed as open.
function classifyCrossRepository({ number, repository, state }) {
  if (state === 'OPEN') return { ...result(number, 'open', null, 'cross-repository'), repository };
  if (state === 'CLOSED') return { ...result(number, 'undetermined', null, 'cross-repository'), repository };
  return { ...result(number, 'open', null, 'cross-repository-state-unreadable'), repository };
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

// parsed response, requested alias names -> the repository object when `errors`
// is non-empty and every entry is a NOT_FOUND on a requested alias; else null.
function notFoundOnlyRepository(parsed, aliases) {
  const repository = parsed && parsed.data && parsed.data.repository;
  if (!repository || typeof repository !== 'object') return null;
  const errors = parsed.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const requested = new Set(aliases);
  const ok = errors.every((e) => e && e.type === 'NOT_FOUND'
    && Array.isArray(e.path) && e.path.length === 2 && e.path[0] === 'repository' && requested.has(e.path[1]));
  return ok ? repository : null;
}

// A thrown GraphQL call -> its parsed stdout when that carries a NOT_FOUND-only
// error list; else null (a whole-query failure).
function recoveredResponse(err, aliases) {
  if (!err || err.stdout == null) return null;
  let parsed;
  try { parsed = JSON.parse(String(err.stdout)); } catch { return null; }
  return notFoundOnlyRepository(parsed, aliases) ? parsed : null;
}

const errorMessages = (errors) => errors.map((e) => (e && (e.message || e.type)) || JSON.stringify(e)).join('; ');

// Runs the GraphQL call -> { parsed } (a response with a usable data.repository
// whose errors, if any, are all NOT_FOUND on a requested alias) | { error } (a
// whole-query failure). A thrown call counts only when its stdout recovers.
function queryRepository(runner, args, blockers) {
  const aliases = blockers.map((n) => `b${n}`);
  let out;
  try {
    out = runner(args);
  } catch (err) {
    const recovered = recoveredResponse(err, aliases);
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
  if (errors.length && !notFoundOnlyRepository(parsed, aliases)) {
    return { error: `GraphQL errors: ${errorMessages(errors)}` };
  }
  return { parsed };
}

// -> { results: Map<number, result>|null, error: string|null, probeErrors? };
// results is null exactly when error is set (a whole-query failure — never
// per-blocker undetermined). probeErrors lists each compare or commits-read call that threw,
// {kind: 'compare'|'files', sha, message}: the verdict stays per-blocker undetermined, but a systematic
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

  // One compare call per distinct candidate sha, and one commits read per
  // distinct REACHABLE sha. Only a CLOSED blocker that carries code is probed —
  // the same cases classifyBlocker's rules 1-3 leave to rule 4 onward (keep the
  // two in step). A blocker stops probing at its first reachable candidate whose
  // files read succeeded and touch its Key Files (#6142 Q1): a hollow or
  // unreadable reachable candidate never ends the loop, a later one may land it.
  const reach = new Map();
  const files = new Map();
  const probeErrors = [];
  for (const n of blockers) {
    const node = repository[`b${n}`];
    if (!node || node.state !== 'CLOSED' || NOT_APPLICABLE_REASONS.has(node.stateReason)) continue;
    const keys = keyFilesOf(node);
    for (const { sha } of candidateCommits(node)) {
      if (!reach.has(sha)) {
        try {
          reach.set(sha, reachabilityFromStatus(runner(compareArgs({ owner, repo, host, integrationBranch, sha }))));
        } catch (err) {
          reach.set(sha, 'error');
          probeErrors.push({ kind: 'compare', sha, message: errorText(err) });
        }
      }
      if (reach.get(sha) !== 'reachable') continue;
      if (!files.has(sha)) {
        try {
          const out = runner(commitFilesArgs({ owner, repo, host, sha }));
          files.set(sha, String(out).split('\n').map((l) => l.trim()).filter(Boolean));
        } catch (err) {
          files.set(sha, null);
          probeErrors.push({ kind: 'files', sha, message: errorText(err) });
        }
      }
      const read = files.get(sha);
      if (Array.isArray(read) && !isHollow(read, keys)) break;
    }
  }
  const results = new Map();
  for (const n of blockers) results.set(n, classifyBlocker(n, repository[`b${n}`], reach, files));
  return { results, error: null, probeErrors };
}

module.exports = {
  buildBlockerLandingQuery, candidateCommits, reachabilityFromStatus, compareArgs,
  BOOKKEEPING_PATH_RE, commitFilesArgs, isHollow, classifyBlocker, classifyCrossRepository, undeterminedAll, classifyFromState, fetchBlockerLanding, recoveredResponse,
};
