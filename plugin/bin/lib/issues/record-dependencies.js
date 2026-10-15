// bin/lib/issues/record-dependencies.js
// Pure: dependency/blocker/sub-issue query building — one of record.js's four
// split boundaries (#2805). Body-text ('Blocked by #N') parsing for
// work-links: body-text, the batched aliased GraphQL query builders for
// work-links: native, the OPEN-state partition helpers both link models
// share, and the linked-PR dedup query that stops wasted re-dispatch of a
// record already covered by an in-flight or merged PR. No network — callers
// run the built queries themselves.
'use strict';

// Line-anchored 'Blocked by #N' dependency declarations (multiline).
const DEP_RE = /^Blocked by #(\d+)\b/gm;

// Parent task-list entries (work-links: body-text), written by /specify as
// '- [ ] #{subIssueNum}' and checked off over time — both box states count.
const SUB_ISSUE_RE = /^- \[[ xX]\] #(\d+)\b/gm;

// Line-anchored 'Blocked by #N: {text}' assumption declarations (multiline) —
// a separate, additive sibling to DEP_RE/parseDependencies below, never a
// modification of either. DEP_RE already stops matching at the number, so a
// trailing ': {text}' parses under it with zero changes; this regex only
// exists to capture that trailing text when a caller wants it.
const DEP_ASSUMPTION_RE = /^Blocked by #(\d+):[ \t]*(.+)$/gm;

// (body, lineRe) -> deduped array of the numbers lineRe's first capture group
// matches, in order of first appearance; [] for a null/undefined/empty body.
// Shared by the two line-anchored body scans below. Both regexes carry the 'g'
// flag but matchAll clones them internally per call, so lastIndex state is never
// shared across calls.
function parseIssueNumbers(body, lineRe) {
  if (typeof body !== 'string' || !body) return [];
  const seen = new Set();
  const result = [];
  for (const match of body.matchAll(lineRe)) {
    const n = Number(match[1]);
    if (!seen.has(n)) {
      seen.add(n);
      result.push(n);
    }
  }
  return result;
}

// body -> deduped array of issue numbers from line-anchored 'Blocked by #N' lines,
// in order of first appearance. Mid-line occurrences (not at line start) don't
// count as a dependency declaration.
function parseDependencies(body) {
  return parseIssueNumbers(body, DEP_RE);
}

// parent body -> deduped array of sub-issue numbers from its task list, in order
// of first appearance. Mid-line occurrences don't count, exactly as with DEP_RE.
// Under work-links: native the parent body carries no task list at all — that
// caller reads sub_issues from the API and never calls this.
function parseSubIssues(body) {
  return parseIssueNumbers(body, SUB_ISSUE_RE);
}

// candidate issue numbers -> one batched, aliased GraphQL query requesting each
// candidate's native blockedBy connection (work-links: native). GraphQL aliases
// can't start with a digit, hence the 'i' prefix. Returns null for an empty or
// non-array input — nothing to query, and an empty repository{} selection set
// would be invalid GraphQL.
function buildNativeDependencyQuery(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  const fields = numbers
    .map((n) => `i${n}: issue(number:${n}){ number blockedBy(first:25){ nodes{ number state } } }`)
    .join('\n      ');
  return `query($owner:String!,$repo:String!){\n  repository(owner:$owner,name:$repo){\n      ${fields}\n  }\n}`;
}

// candidate parent-issue numbers -> one batched, aliased GraphQL query requesting
// each parent's native subIssues connection (work-links: native). first:100 is the
// connection page size requested, not a claim about any platform-side cap on
// sub-issue count; pageInfo.hasNextPage is the actual guard callers must honor —
// it fires whenever a parent has more sub-issues than fit in one page, whatever
// that cap turns out to be, so a truncated page is never mistaken for a complete
// one. Same alias/null conventions as buildNativeDependencyQuery above.
function buildNativeSubIssuesQuery(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  const fields = numbers
    .map((n) => `i${n}: issue(number:${n}){ number subIssues(first:100){ nodes{ number } pageInfo{ hasNextPage } } }`)
    .join('\n      ');
  return `query($owner:String!,$repo:String!){\n  repository(owner:$owner,name:$repo){\n      ${fields}\n  }\n}`;
}

// candidate sub-issue numbers -> one batched, aliased GraphQL query requesting each
// issue's native parent (work-links: native), read from the sub-issue's own side.
// Probed live on this repo 2026-08-24: issue(number:$n){ parent{ number title state } }
// returns { number, parent: { number, title, state } } for a sub-issue, and
// parent: null for a parentless record. Same alias/null conventions as
// buildNativeSubIssuesQuery above. Caller: demo/entry-paths.md's Full verification
// pointer sub-procedure. review/cross-spec-promise-check.md performs the equivalent
// native parent-resolution query independently — it does not call this function.
function buildNativeParentQuery(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  const fields = numbers
    .map((n) => `i${n}: issue(number:${n}){ number parent{ number title state } }`)
    .join('\n      ');
  return `query($owner:String!,$repo:String!){\n  repository(owner:$owner,name:$repo){\n      ${fields}\n  }\n}`;
}

// one candidate's parsed aliased response value (the { number, blockedBy: { nodes } }
// shape buildNativeDependencyQuery's query produces per alias) -> true when at least
// one blockedBy node is still OPEN. Mirrors parseDependencies' role for the
// work-links: body-text case, but judges a single already-parsed node instead of
// scanning body text for every candidate at once.
function hasOpenNativeBlocker(issueNode) {
  const nodes = issueNode && issueNode.blockedBy && issueNode.blockedBy.nodes;
  if (!Array.isArray(nodes)) return false;
  return nodes.some((n) => n && n.state === 'OPEN');
}

// candidates[] (each with .number), openBlockerIdsFn: candidate -> number[] of
// the open blocker ids excluding it (empty when none) -> { eligible, excluded }.
// The shared partition shape both blocked-by checks below need: split on
// whether the candidate has any open blocker, carrying the actual blocker
// id(s) for whichever candidates get dropped instead of discarding them
// (dispatch/SKILL.md's Blocked-exclusion report, #1101). A two-member
// dependency cycle needs no special handling here: each member's
// `openBlockerIdsFn` independently names the other, so both land in
// `excluded` — the cycle is visible as two entries pointing at each other,
// not a distinct code path.
function partitionByOpenBlockers(candidates, openBlockerIdsFn) {
  const eligible = [];
  const excluded = [];
  for (const c of candidates) {
    const openBlockers = openBlockerIdsFn(c);
    if (openBlockers.length > 0) excluded.push({ number: c.number, blockedBy: openBlockers });
    else eligible.push(c);
  }
  return { eligible, excluded };
}

// candidates[] (each with .number and .body), openNumbers: Set<number> -> { eligible, excluded }.
// The same open-body-text-dependency predicate dispatch/queue-pull-script.md's own
// eligibility filter already applies (parseDependencies + an open id), via
// partitionByOpenBlockers above.
function partitionByOpenBodyBlockers(candidates, openNumbers) {
  return partitionByOpenBlockers(candidates, (c) => parseDependencies(c.body).filter((dep) => openNumbers.has(dep)));
}

// candidates[] (each with .number), repoData: the native GraphQL response's
// repository{} object (i{number} aliases, buildNativeDependencyQuery's shape) ->
// { eligible, excluded }, same shape as partitionByOpenBodyBlockers above, for
// work-links: native. hasOpenNativeBlocker only ever returned a boolean; this is
// the identical OPEN-state filter, keeping the actual blocker numbers instead of
// discarding them. A candidate missing from repoData (no `i{n}` alias — e.g. the
// project isn't on work-links: native, per queue-pull-script.md's `{}` placeholder)
// has no nodes to check and stays eligible, matching hasOpenNativeBlocker's own
// no-array-of-nodes -> false behavior. Same fails-safe guard as hasOpenNativeBlocker:
// a malformed response (nodes present but not an array, e.g. a schema mismatch)
// degrades to "no blockers resolved", never throws .filter-is-not-a-function.
function partitionByOpenNativeBlockers(candidates, repoData) {
  return partitionByOpenBlockers(candidates, (c) => {
    const node = repoData && repoData['i' + c.number];
    const rawNodes = node && node.blockedBy && node.blockedBy.nodes;
    const nodes = Array.isArray(rawNodes) ? rawNodes : [];
    return nodes.filter((n) => n && n.state === 'OPEN').map((n) => n.number);
  });
}

// candidate issue numbers -> one batched, aliased GraphQL query requesting
// each candidate's closedByPullRequestsReferences connection (#1224) — the
// PRs that would close it via a closing keyword (Closes/Fixes/Resolves #N)
// or GitHub's native "Development" linkage, whether still open or already
// merged/closed. Runs unconditionally — unlike buildNativeDependencyQuery
// (work-links: native only), this check isn't gated behind a dependency-
// tracking policy: it exists purely to stop wasted re-dispatch of a record
// that already has a build in flight. Same alias/null conventions as
// buildNativeDependencyQuery above.
// Also carries each candidate's cross-reference timeline (#1984) — every PR
// that has ever mentioned the issue, closing keyword or not — beside the
// closedByPullRequestsReferences connection above. This is the "mentioned
// but never closed" case buildLinkedPRQuery's own connection can't see: a
// merged PR whose body says "refs #N" with no closing keyword leaves the
// record open with a live grant despite the work already having shipped
// (#1791/#1803, #1484/#1857). `source { ... on PullRequest { ... } }`
// resolves to null for a cross-reference from another Issue (not a PR),
// which linked-prs.js's fetchLinkedPRs filters out; `repository{
// nameWithOwner }` lets it filter to same-repo mentions only (a
// CrossReferencedEvent's source can live in an unrelated repository).
//
// #2449: `timelineItems` paginates oldest-first, so `first:N` fetches the
// OLDEST N cross-reference events — for a long-lived record that
// accumulates many issue-to-issue mentions over its life (other bug
// reports discussing the same subsystem, health-sweep dedup comments,
// etc.), a PR's own mention can be pushed out of that window entirely by
// older issue-based references, well before the classifier ever sees it.
// Confirmed live against #1892/PR#2287 (merged, `refs #1892`, no closing
// keyword): #1892 had accumulated 20+ issue-based cross-references before
// #2287 ever merged, so `first:20` returned zero PR sources — every node
// resolved to a non-PR (empty) source — even though `classifyShipped`
// itself correctly scores the pair `strong` once given the mention. Fetch
// the most recent N instead (`last:20`) — the freshest signal is what
// matters for "is this already shipped," not the earliest.
function buildLinkedPRQuery(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  const fields = numbers
    .map((n) => `i${n}: issue(number:${n}){ number closedByPullRequestsReferences(first:10){ nodes{ number state } } timelineItems(itemTypes:[CROSS_REFERENCED_EVENT], last:20){ nodes{ ... on CrossReferencedEvent { source { ... on PullRequest { number title state merged mergedAt repository { nameWithOwner } } } } } } }`)
    .join('\n      ');
  return `query($owner:String!,$repo:String!){\n  repository(owner:$owner,name:$repo){\n      ${fields}\n  }\n}`;
}

// candidates[] (each with .number), repoData: the linked-PR GraphQL response's
// repository{} object (i{number} aliases, buildLinkedPRQuery's shape) ->
// { eligible, excludedByOpenPR }. A candidate already covered by an open,
// unmerged PR that will close it is excluded from re-dispatch — building it
// again would race or duplicate a build already in flight (#1224). Mirrors
// partitionByOpenNativeBlockers's shape and fail-safe posture (a malformed
// or missing connection degrades to "no open linked PR", never throws), but
// carries the linked PR's own number for the excluded entry rather than a
// list of blocker ids, since there is exactly one PR to name per exclusion.
// A candidate missing from repoData (this query was never run for it) stays
// eligible, same no-alias -> eligible behavior as the native-blocker check.
function partitionByOpenLinkedPR(candidates, repoData) {
  const { eligible, excluded } = partitionByOpenBlockers(candidates, (c) => {
    const node = repoData && repoData['i' + c.number];
    const rawNodes = node && node.closedByPullRequestsReferences && node.closedByPullRequestsReferences.nodes;
    const nodes = Array.isArray(rawNodes) ? rawNodes : [];
    const openPR = nodes.find((n) => n && n.state === 'OPEN');
    return openPR ? [openPR.number] : [];
  });
  // partitionByOpenBlockers' generic shape carries a blocker LIST per
  // excluded candidate (a candidate can have several open blockers); this
  // caller only ever has exactly one linked PR to name, so unwrap back to
  // the single `pr` field this function's own callers expect.
  const excludedByOpenPR = excluded.map((e) => ({ number: e.number, pr: e.blockedBy[0] }));
  return { eligible, excludedByOpenPR };
}

// body -> array of {number, assumption} for every line-anchored
// 'Blocked by #N: {text}' declaration, in order of appearance. A bare
// 'Blocked by #N' line (no colon) contributes nothing here — parseDependencies
// above is still the only reader of bare dependency lines. Not deduped by
// number: a caller writing the same N twice with different text gets both
// entries back, same as matchAll would naturally produce.
function parseDependencyAssumptions(body) {
  if (typeof body !== 'string' || !body) return [];
  const result = [];
  for (const match of body.matchAll(DEP_ASSUMPTION_RE)) {
    result.push({ number: Number(match[1]), assumption: match[2] });
  }
  return result;
}

module.exports = {
  parseDependencies, parseDependencyAssumptions, buildNativeDependencyQuery,
  hasOpenNativeBlocker, parseSubIssues, buildNativeSubIssuesQuery, buildNativeParentQuery,
  partitionByOpenBodyBlockers, partitionByOpenNativeBlockers, buildLinkedPRQuery, partitionByOpenLinkedPR,
};
