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

// Line-anchored 'Parent: #N' back-link (work-links: body-text), written by
// /specify as a metadata line in a sub-issue's body. Non-global: first match wins.
const PARENT_RE = /^Parent: #(\d+)\b/m;

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

// sub-issue body -> its parent's issue number from the first line-anchored
// 'Parent: #N' line (written by /specify under work-links: body-text), or null
// for a null/undefined/empty/non-string body or one with no such line. Mid-line
// mentions don't count, exactly as with DEP_RE.
function parseParent(body) {
  if (typeof body !== 'string' || !body) return null;
  const m = body.match(PARENT_RE);
  return m ? Number(m[1]) : null;
}

// issue numbers + a per-alias field expression -> the one batched, aliased GraphQL
// query all four builders below share: `i{n}: {fieldExpr(n)}` per number, inside
// repository(owner:$owner,name:$repo){}. Returns null for a non-array or empty
// input. Module-private; the builders below own the per-alias selection sets.
function buildAliasedIssueQuery(numbers, fieldExpr) {
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  const fields = numbers
    .map((n) => `i${n}: ${fieldExpr(n)}`)
    .join('\n      ');
  return `query($owner:String!,$repo:String!){\n  repository(owner:$owner,name:$repo){\n      ${fields}\n  }\n}`;
}

// candidate issue numbers -> one batched, aliased GraphQL query requesting each
// candidate's native blockedBy connection (work-links: native). GraphQL aliases
// can't start with a digit, hence the 'i' prefix. Returns null for an empty or
// non-array input — nothing to query, and an empty repository{} selection set
// would be invalid GraphQL.
// #4793: also selects the dependent issue's and each blocker node's
// repository{ nameWithOwner } — a native blockedBy link can point at an issue
// in another repository, and `number` alone then reads as this repository's
// same-numbered issue. crossRepositoryBlockers below compares the two names.
function buildNativeDependencyQuery(numbers) {
  return buildAliasedIssueQuery(numbers, (n) => `issue(number:${n}){ number repository{ nameWithOwner } blockedBy(first:25){ nodes{ number state repository{ nameWithOwner } } } }`);
}

// candidate parent-issue numbers -> one batched, aliased GraphQL query requesting
// each parent's native subIssues connection (work-links: native). first:100 is the
// connection page size requested, not a claim about any platform-side cap on
// sub-issue count; pageInfo.hasNextPage is the actual guard callers must honor —
// it fires whenever a parent has more sub-issues than fit in one page, whatever
// that cap turns out to be, so a truncated page is never mistaken for a complete
// one. Same alias/null conventions as buildNativeDependencyQuery above.
function buildNativeSubIssuesQuery(numbers) {
  return buildAliasedIssueQuery(numbers, (n) => `issue(number:${n}){ number subIssues(first:100){ nodes{ number } pageInfo{ hasNextPage } } }`);
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
  return buildAliasedIssueQuery(numbers, (n) => `issue(number:${n}){ number parent{ number title state } }`);
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

// A readable repository name is a non-empty string; anything else is unreadable.
function readableRepoName(repository) {
  const name = repository && repository.nameWithOwner;
  return typeof name === 'string' && name ? name : null;
}

// one candidate's parsed aliased response value -> [{ number, repository, state }]
// for each blockedBy node living in another repository (#4793). Compared against
// the DEPENDENT node's own repository.nameWithOwner, case-insensitively — never
// the caller's owner/repo, so an `origin` left on a pre-transfer name cannot make
// every blocker read as foreign. A name is readable only when it is a non-empty
// string; a node with no readable name on either side is never foreign, so a
// response without the field keeps the old same-repository behavior. `state` is
// the node's state when a string, else null (the caller fails closed on it, see
// foreignBlockerBlocks). A malformed or missing blockedBy.nodes gives [].
function crossRepositoryBlockers(issueNode) {
  const home = readableRepoName(issueNode && issueNode.repository);
  const nodes = issueNode && issueNode.blockedBy && issueNode.blockedBy.nodes;
  if (!home || !Array.isArray(nodes)) return [];
  const result = [];
  for (const n of nodes) {
    const repository = readableRepoName(n && n.repository);
    if (!repository || repository.toLowerCase() === home.toLowerCase()) continue;
    result.push({ number: n.number, repository, state: typeof n.state === 'string' ? n.state : null });
  }
  return result;
}

// (numbers, crossRepoBlockers?) -> a copy of `numbers` with one occurrence removed
// per crossRepoBlockers entry's `number`, order kept. fetchNativeDependencies'
// blockedBy/openBlockerIds still carry a foreign blocker's bare number (existing
// consumers' shape is unchanged, #4793); a reader that names this repository's
// own blockers strips them with this first. A non-array `numbers` gives [] and a
// non-array `crossRepoBlockers` a plain copy.
function withoutCrossRepoBlockers(numbers, crossRepoBlockers) {
  if (!Array.isArray(numbers)) return [];
  const result = numbers.slice();
  if (!Array.isArray(crossRepoBlockers)) return result;
  for (const b of crossRepoBlockers) {
    const i = result.indexOf(b && b.number);
    if (i !== -1) result.splice(i, 1);
  }
  return result;
}

// Decisions Q5 (#4793): a foreign blocker blocks unless its native state is
// exactly CLOSED — an OPEN, missing, null or unrecognised state all fail closed,
// so an unreadable state can never read as landed.
function foreignBlockerBlocks(entry) {
  return entry.state !== 'CLOSED';
}

// A foreign blocker's qualified `owner/repo#N` name; a state that is neither
// OPEN nor CLOSED adds ' (state unreadable)' (Decisions Q5), so the stop it
// causes can be diagnosed instead of reading as a silent fallback.
function foreignBlockerRef(entry) {
  const ref = `${entry.repository}#${entry.number}`;
  return entry.state === 'OPEN' || entry.state === 'CLOSED' ? ref : `${ref} (state unreadable)`;
}

// { openBlockerIds, crossRepoBlockers } (a fetchNativeDependencies entry's fields)
// -> this repository's open blocker numbers (foreign OPEN ones stripped,
// deduplicated in first-appearance order), then each still-blocking foreign
// blocker's qualified ref in entry order. A non-object entry in
// crossRepoBlockers contributes nothing, as in withoutCrossRepoBlockers.
function openBlockerRefs({ openBlockerIds, crossRepoBlockers } = {}) {
  const foreign = Array.isArray(crossRepoBlockers) ? crossRepoBlockers.filter((b) => b && typeof b === 'object') : [];
  const local = withoutCrossRepoBlockers(openBlockerIds, foreign.filter((b) => b.state === 'OPEN'));
  return [...new Set(local), ...foreign.filter(foreignBlockerBlocks).map(foreignBlockerRef)];
}

// one candidate's parsed aliased response value -> the same list openBlockerRefs
// builds, straight from the raw node (partitionByOpenNativeBlockers' reader).
function openNativeBlockerRefs(issueNode) {
  const rawNodes = issueNode && issueNode.blockedBy && issueNode.blockedBy.nodes;
  const nodes = Array.isArray(rawNodes) ? rawNodes : [];
  return openBlockerRefs({
    openBlockerIds: nodes.filter((n) => n && n.state === 'OPEN').map((n) => n.number),
    crossRepoBlockers: crossRepositoryBlockers(issueNode),
  });
}

// candidates[] (each with .number), openBlockerIdsFn: candidate ->
// Array<number|string> of the open blockers excluding it (empty when none; a
// number is this repository's issue, a string a qualified foreign ref, #4793)
// -> { eligible, excluded }.
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
// #4793: each candidate's blocker list is openNativeBlockerRefs(node) — this
// repository's open numbers, then a still-blocking foreign blocker by its
// qualified `owner/repo#N` name (Decisions Q3), never as a bare `#N`.
function partitionByOpenNativeBlockers(candidates, repoData) {
  return partitionByOpenBlockers(candidates, (c) => openNativeBlockerRefs(repoData && repoData['i' + c.number]));
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
// #4314: also selects the source PR's createdAt — classifyShipped skips
// a mention whose PR was already open when the record was filed.
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
//
// #2934: each alias also selects the issue's own `state` (distinct from
// `closedByPullRequestsReferences.nodes[].state`, a PR's state) — additive,
// so existing consumers that ignore it are unaffected. `fetchLinkedPRs`
// (linked-prs.js) passes it through as `issueState` on each Map entry, so
// wrap-up's carrier-commit fallback can read whether the issue is CLOSED
// from this one batched call instead of a per-issue `gh issue view`.
function buildLinkedPRQuery(numbers) {
  return buildAliasedIssueQuery(numbers, (n) => `issue(number:${n}){ number state closedByPullRequestsReferences(first:10){ nodes{ number state } } timelineItems(itemTypes:[CROSS_REFERENCED_EVENT], last:20){ nodes{ ... on CrossReferencedEvent { source { ... on PullRequest { number title state createdAt merged mergedAt repository { nameWithOwner } } } } } } }`);
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
  hasOpenNativeBlocker, parseSubIssues, parseParent, buildNativeSubIssuesQuery, buildNativeParentQuery,
  partitionByOpenBodyBlockers, partitionByOpenNativeBlockers, buildLinkedPRQuery, partitionByOpenLinkedPR,
  crossRepositoryBlockers, withoutCrossRepoBlockers, foreignBlockerBlocks, foreignBlockerRef, openBlockerRefs, openNativeBlockerRefs,
};
