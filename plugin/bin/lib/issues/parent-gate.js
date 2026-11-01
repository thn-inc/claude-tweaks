// bin/lib/issues/parent-gate.js
// The one Node implementation of the Parent-Gate Procedure's Resolve the parent,
// Enumerate the parent's sub-issues, Self-inclusion rule and Evaluate the gate
// sections (wrap-up/verification-brief-parent-gate.md), and of the below-floor
// close's idempotence check (#4603). The gathers keep #4599's gh call shapes,
// except that native enumeration runs through bin/fetch-sub-issues.js's `run`,
// called in-process, so its probe, page and retry ladder are reused, not
// re-derived, and that every `gh issue view` read carries `--repo {slug}` (the legend below),
// so one gate never splits its reads between gh's base repo and the caller's.
// bin/parent-gate.js and below-floor-parent-close.js both compose it. It
// replaces the prose snippets that #4466's review found eight defects in.
//
// Four parts: two gh gathers (gatherGateFacts, gatherIdempotenceFacts) that
// take a `caller` from ghCaller(gh) and throw GhFailure on a failing or
// unreadable read, and two pure evaluators (evaluateParentGate,
// evaluateIdempotence) that turn the gathered facts into the verdict, which
// evaluateGateWithIdempotence sequences for bin/parent-gate.js.
//
// The gh reads, numbered as the comments below and the tests' `shape N:` labels cite them.
// {slug} is repoSlug({ host, owner, repo }) (`owner/repo` on github.com, `host/owner/repo`
// off it); off github.com every `gh api` read also carries `--hostname {host}`.
//   1   sub-issue -> parent, body-text: issue view {n} --repo {slug} --json body -q .body, then parseParent.
//   2   sub-issue -> parent, native: fetchNativeParent's api graphql -f query=<parent> -f owner= -f repo=.
//   3   parent -> sub-issues, body-text: issue view {parent} --repo {slug} --json body -q .body, then parseSubIssues.
//   4   parent -> sub-issues, native: fetch-sub-issues.js's run([parent, --repo {slug}, --resolve-retries]), whose runner sends
//   4a    the schema probe: api graphql -f query={ __type(name: "Issue") { fields { name } } };
//   4b    the batched page: api graphql -f query=<subIssues(first:100)> -f owner= -f repo=;
//   4c    on hasNextPage or a missing alias only: api --paginate repos/{owner}/{repo}/issues/{parent}/sub_issues --jq .[].number;
//   4d  when run exits EXIT_SUBISSUES_UNAVAILABLE: 4c's argv, sent by this file instead.
//   5   each sub-issue, ascending: issue view {n} --repo {slug} --json state,stateReason,labels,title,closedByPullRequestsReferences.
//   6   the parent's labels: issue view {parent} --repo {slug} --json labels -q [.labels[].name].
//   7   idempotence: issue view {parent} --repo {slug} --json state,stateReason,comments.
//   8   the login: api user --jq .login, only when needsIdempotenceReads(7's state, stateReason).
'use strict';

const { fetchNativeParent } = require('./native-dependencies');
const { parseSubIssues, parseParent } = require('./record');
const { parseRecordFacets, normalizeLabelNames, LABELS } = require('./record-vocabulary');
const { parentGateState } = require('./acceptance');
const { maxRiskTier, exceedsOversightFloor } = require('./oversight-floor');
const { isTrustedComment, untrustedSkipNote } = require('./comment-trust');
const { sameRepoNumbers } = require('../flow/closing-links');
const { POLICY_KEYS } = require('../policy-schema');
const { repoSlug } = require('../repo-resolve');
const { run: runFetchSubIssues, EXIT_SUBISSUES_UNAVAILABLE } = require('../../fetch-sub-issues');

const CLOSE_HEADING = '## Closed below the oversight floor';
// The floor values `exceedsOversightFloor` evaluates, read from the policy schema's
// `risk-floor` enum so a new value there is never rejected here. `null` (and undefined) must not
// reach it: a null floor switches the unscored check off too, which would close a
// parent whose sub-issues carry no risk label.
const VALID_RISK_FLOORS = POLICY_KEYS.find((k) => k.key === 'risk-floor').values;
const HEADING_LINE_RE = /^## Closed below the oversight floor\s*$/m;

// The verdict's keys, in emission order.
const VERDICT_FIELDS = [
  'parent', 'state', 'exceeds', 'closeReason', 'idempotence', 'maxTier', 'riskFloor', 'parentIssue', 'needs', 'held', 'subIssues', 'skipped',
];
// The idempotence values, in the order they are checked.
const IDEMPOTENCE_VALUES = ['already-closed', 'reopened', 'close-only', 'comment-and-close'];

const QUALIFIED_TOKEN_RE = /^([^/\s#]+)\/([^/\s#]+)#(\d+)$/;

// Whether a comment is #4466's close marker: the heading on a line of its own, from a trusted
// author or the current `gh` login. The GitHub parent-gate scan (#4600) asks the same question.
function isCloseMarkerComment(comment, login) {
  if (!comment || !HEADING_LINE_RE.test(String(comment.body || ''))) return false;
  return isTrustedComment(comment) || Boolean(login && comment.author && comment.author.login === login);
}

// Thrown for a failing or unreadable gh call, so a parent skipped as
// `gh-failed` is distinguishable from a bug in this file.
class GhFailure extends Error {}

// gh(args, input?) -> stdout, throwing on failure  ->  { call, callJson }, each
// turning a failure into a GhFailure that names the call's first three args.
// callJson(args, expect) also rejects JSON that is not the container its reader
// expects (`'object'`, not an array or `null`; or `'array'`), which that reader
// would otherwise dereference into a TypeError.
function ghCaller(gh) {
  const call = (args, input) => {
    try {
      return gh(args, input);
    } catch (err) {
      throw new GhFailure(`gh ${args.slice(0, 3).join(' ')}: ${err && err.message}`);
    }
  };
  const callJson = (args, expect) => {
    const out = call(args);
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch (err) {
      throw new GhFailure(`gh ${args.slice(0, 3).join(' ')}: unparseable output (${err.message})`);
    }
    const fits = expect === 'array' ? Array.isArray(parsed) : parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    if (!fits) {
      throw new GhFailure(`gh ${args.slice(0, 3).join(' ')}: unexpected output (not a JSON ${expect}: ${JSON.stringify(parsed)})`);
    }
    return parsed;
  };
  return { call, callJson };
}

// Distinct positive integers, ascending.
function distinctAscending(values) {
  return [...new Set(values.filter((v) => Number.isInteger(v) && v > 0))].sort((a, b) => a - b);
}

// A `gh api` argv aimed at `host`: `--hostname host` appended off github.com, unless the argv
// already carries one (fetch-sub-issues.js adds its own to 4c). Any other argv, or no host or
// github.com, is returned unchanged. fetchNativeParent and fetch-sub-issues.js's GraphQL reads
// take no host, so their runners pass each argv through this.
function onHost(args, host) {
  if (!host || host === 'github.com' || args[0] !== 'api' || args.includes('--hostname')) return args;
  return [...args, '--hostname', host];
}

// Whether the idempotence check needs the parent's comments and the gh login (7's comments, 8):
// only for a parent neither CLOSED nor REOPENED. Takes the uppercased state and stateReason.
function needsIdempotenceReads(state, stateReason) {
  return state !== 'CLOSED' && stateReason !== 'REOPENED';
}

// Shape 1 (body-text) or 2 (native): the sub-issue's parent number, or null.
function resolveParent({ subIssue, owner, repo, host, workLinks, caller }) {
  if (workLinks === 'body-text') {
    return parseParent(String(caller.call(['issue', 'view', String(subIssue), '--repo', repoSlug({ host, owner, repo }), '--json', 'body', '-q', '.body'])));
  }
  // fetchNativeParent throws only for a failed or malformed GraphQL read.
  try {
    return fetchNativeParent({ number: subIssue, owner, repo, runner: (args) => caller.call(onHost(args, host)) });
  } catch (err) {
    throw err instanceof GhFailure ? err : new GhFailure(`gh api graphql (parent): ${err.message}`);
  }
}

// Shape 3 (body-text: the parent's task list) or shape 4 (native: fetch-sub-issues.js's
// `run` in-process, or the one REST read 4d when it reports the field unavailable).
// -> the parent's sub-issue numbers, ascending. `fetcher` is that `run`; tests inject
// one to reach the exit-0 branches the real CLI never takes (unparseable stdout, no key).
function enumerateSubIssues({
  parent, owner, repo, host, workLinks, caller, fetcher = runFetchSubIssues,
}) {
  const slug = repoSlug({ host, owner, repo });
  if (workLinks === 'body-text') {
    return distinctAscending(parseSubIssues(String(caller.call(['issue', 'view', String(parent), '--repo', slug, '--json', 'body', '-q', '.body']))));
  }
  const restArgs = onHost(['api', '--paginate', `repos/${owner}/${repo}/issues/${parent}/sub_issues`, '--jq', '.[].number'], host);
  let out = '';
  let err = '';
  const code = fetcher([String(parent), '--repo', slug, '--resolve-retries'], {
    ghAvailable: () => true,
    remoteUrl: () => null,
    runner: (args) => caller.call(onHost(args, host)),
    stdout: (s) => { out += s; },
    stderr: (s) => { err += s; },
  });
  if (code === EXIT_SUBISSUES_UNAVAILABLE) {
    return distinctAscending(String(caller.call(restArgs)).split('\n').map((line) => Number(line.trim())));
  }
  if (code !== 0) throw new GhFailure(`fetch-sub-issues.js exit ${code}: ${err.trim()}`);
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    throw new GhFailure(`fetch-sub-issues.js: unparseable output (${e.message})`);
  }
  const list = parsed && parsed.byParent && parsed.byParent[String(parent)];
  if (!Array.isArray(list)) throw new GhFailure(`fetch-sub-issues.js: no sub-issue list for #${parent}`);
  return distinctAscending(list);
}

// Exactly one of `subIssue`/`parent` -> { parent, parentLabels, subIssues } (shapes 1-6, in order).
// With no resolvable parent it stops after resolution; so does a body-text `Parent: #N` whose
// task list does not list `subIssue` (the parent's task list wins), before any shape 5 or 6 read.
// An empty or missing task list is not an omission: it keeps the parent, as before.
// `host` is the origin's host; absent or 'github.com' leaves every argv as on github.com.
function gatherGateFacts({
  subIssue, parent, owner, repo, host, workLinks, caller,
}) {
  const given = (v) => v !== null && v !== undefined;
  if (given(subIssue) === given(parent)) {
    throw new TypeError('gatherGateFacts takes exactly one of subIssue and parent');
  }
  const noParent = { parent: null, parentLabels: [], subIssues: [] };
  let resolved = parent;
  if (resolved === null || resolved === undefined) {
    resolved = resolveParent({ subIssue, owner, repo, host, workLinks, caller });
    if (resolved === null || resolved === undefined) return noParent;
  }
  const slug = repoSlug({ host, owner, repo });
  const numbers = enumerateSubIssues({ parent: resolved, owner, repo, host, workLinks, caller });
  if (!given(parent) && workLinks === 'body-text' && numbers.length > 0 && !numbers.includes(subIssue)) return noParent;
  const subIssues = numbers.map((num) => {
    const live = caller.callJson(['issue', 'view', String(num), '--repo', slug, '--json', 'state,stateReason,labels,title,closedByPullRequestsReferences'], 'object');
    // Absent or null is no closing PR; any other non-array is a malformed answer, as on the MCP path.
    const rawRefs = live.closedByPullRequestsReferences;
    if (rawRefs !== undefined && rawRefs !== null && !Array.isArray(rawRefs)) {
      throw new GhFailure(`gh issue view ${num}: unexpected output (closedByPullRequestsReferences is not an array: ${JSON.stringify(rawRefs)})`);
    }
    const refs = rawRefs || [];
    // An element that is not a { number } reference is as malformed as a non-array, as on the MCP
    // path: filtering it out would drop a closing PR and its {pr} suffix without a trace.
    if (!refs.every((ref) => ref !== null && typeof ref === 'object' && Number.isInteger(ref.number) && ref.number > 0)) {
      throw new GhFailure(`gh issue view ${num}: unexpected output (closedByPullRequestsReferences holds an element that is not a { number } reference: ${JSON.stringify(rawRefs)})`);
    }
    return {
      number: num,
      title: String(live.title || '').trim(),
      state: String(live.state || '').toUpperCase(),
      stateReason: String(live.stateReason || '').toUpperCase(),
      labels: normalizeLabelNames(live.labels),
      closedBy: refs.map((ref) => ref.number),
    };
  });
  const parentLabels = normalizeLabelNames(caller.callJson(['issue', 'view', String(resolved), '--repo', slug, '--json', 'labels', '-q', '[.labels[].name]'], 'array'));
  return { parent: resolved, parentLabels, subIssues };
}

// Shapes 7 and 8: the parent's live state and comments, and the current gh login,
// read only when the parent is neither CLOSED nor REOPENED. A state that is not a
// string, a present stateReason that is not one, or (when the comments are read) a
// comments value that is not an array is a GhFailure: read as '' or [], it would
// post a duplicate close comment.
function gatherIdempotenceFacts({
  parent, owner, repo, host, caller,
}) {
  const live = caller.callJson(['issue', 'view', String(parent), '--repo', repoSlug({ host, owner, repo }), '--json', 'state,stateReason,comments'], 'object');
  const malformed = (what, value) => new GhFailure(`gh issue view ${parent}: unexpected output (${what}: ${JSON.stringify(value)})`);
  if (typeof live.state !== 'string') throw malformed('state is not a string', live.state);
  if (live.stateReason !== undefined && live.stateReason !== null && typeof live.stateReason !== 'string') {
    throw malformed('stateReason is not a string', live.stateReason);
  }
  const state = live.state.toUpperCase();
  const stateReason = String(live.stateReason || '').toUpperCase();
  const reads = needsIdempotenceReads(state, stateReason);
  if (reads && !Array.isArray(live.comments)) throw malformed('comments is not an array', live.comments);
  const comments = Array.isArray(live.comments) ? live.comments : [];
  const login = reads ? String(caller.call(onHost(['api', 'user', '--jq', '.login'], host))).trim() : null;
  return { state, stateReason, comments, login };
}

function numberSet(values) {
  return new Set(Array.from(values || []).map(Number).filter(Number.isInteger));
}

// Pure: gathered facts plus the caller's closing set, held set and floor -> the
// verdict, keys in VERDICT_FIELDS order. `idempotence` and `skipped` are always
// null and []; a Close-running caller fills them from evaluateIdempotence.
function evaluateParentGate({
  parent, parentLabels, subIssues, closingSet = [], selfInclude = true, held = [], mergingPr = null, riskFloor,
} = {}) {
  if (!VALID_RISK_FLOORS.includes(riskFloor)) {
    throw new TypeError(`riskFloor must be one of ${VALID_RISK_FLOORS.join(', ')}; got ${String(riskFloor)}`);
  }
  if (parent === null || parent === undefined) {
    return {
      parent: null, state: 'no-parent', exceeds: null, closeReason: null, idempotence: null, maxTier: null,
      riskFloor, parentIssue: null, needs: [], held: [], subIssues: [], skipped: [],
    };
  }
  const labels = normalizeLabelNames(parentLabels);
  const closing = numberSet(closingSet);
  const heldSet = numberSet(held);
  const gateSubIssues = (Array.isArray(subIssues) ? subIssues : [])
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((s) => {
      const inClosingSet = closing.has(s.number);
      // Self-inclusion: the merge closing these records may not show on GitHub yet,
      // so each closing-set member counts CLOSED/COMPLETED. It never adds sub-issues.
      const selfIncluded = selfInclude && inClosingSet;
      const closedBy = Array.isArray(s.closedBy) ? s.closedBy : [];
      return {
        number: s.number,
        title: s.title,
        state: selfIncluded ? 'CLOSED' : s.state,
        stateReason: selfIncluded ? 'COMPLETED' : s.stateReason,
        // Keyed on inClosingSet, not selfIncluded: the merging PR is known only for the members
        // this merge closes, and it names them even under selfInclude: false (the reconciler's
        // listing lines). Any other sub-issue's live closedBy is all there is; its last entry is
        // the latest closing PR.
        pr: inClosingSet && mergingPr ? mergingPr : closedBy[closedBy.length - 1] || null,
        facets: parseRecordFacets(s.labels),
      };
    });

  const state = parentGateState({ subIssues: gateSubIssues, parentLabels: labels });
  const maxTier = maxRiskTier(gateSubIssues.map((s) => s.facets)) ?? null;
  // sizeFloor is the literal null: parents carry no size scoring of their own.
  const exceeds = state === 'due' ? exceedsOversightFloor({ risk: maxTier }, { riskFloor, sizeFloor: null }).exceeds : null;
  let closeReason = null;
  if (state === 'due' && exceeds === false) {
    closeReason = gateSubIssues.some((s) => s.stateReason === 'COMPLETED') ? 'completed' : 'not planned';
  }
  return {
    parent,
    state,
    exceeds,
    closeReason,
    idempotence: null,
    maxTier,
    riskFloor,
    parentIssue: labels.includes(LABELS.PARENT_ISSUE),
    needs: labels.filter((name) => name.startsWith('needs:')),
    held: gateSubIssues.map((s) => s.number).filter((n) => heldSet.has(n)),
    subIssues: gateSubIssues.map(({ number, title, state: subState, stateReason, pr }) => ({
      number, title, state: subState, stateReason, pr,
    })),
    skipped: [],
  };
}

// The `source` values evaluateIdempotence takes.
const IDEMPOTENCE_SOURCES = ['comments', 'body'];

// Pure: idempotence facts -> { idempotence, skipped }. `source` names the facts' shape:
// 'comments' (the default) is the gh/MCP `{ state, stateReason, comments, login }`;
// 'body' is local-files' `{ state, body }`, where the close marker is a heading in the
// record body. Any other `source` throws a TypeError.
function evaluateIdempotence(facts, { source = 'comments' } = {}) {
  if (!IDEMPOTENCE_SOURCES.includes(source)) {
    throw new TypeError(`source must be one of ${IDEMPOTENCE_SOURCES.join(', ')}; got ${String(source)}`);
  }
  const f = facts || {};
  const state = String(f.state || '').toUpperCase();
  if (state === 'CLOSED') return { idempotence: 'already-closed', skipped: [] };
  if (source === 'body') {
    return { idempotence: HEADING_LINE_RE.test(String(f.body || '')) ? 'close-only' : 'comment-and-close', skipped: [] };
  }
  // Before the comment scan: a human's reopen holds even over the bot's own close marker.
  if (!needsIdempotenceReads(state, String(f.stateReason || '').toUpperCase())) return { idempotence: 'reopened', skipped: [] };
  let counted = false;
  const skipped = [];
  for (const comment of Array.isArray(f.comments) ? f.comments : []) {
    if (!comment || !HEADING_LINE_RE.test(String(comment.body || ''))) continue;
    if (isCloseMarkerComment(comment, f.login)) counted = true;
    else skipped.push(untrustedSkipNote(comment));
  }
  return { idempotence: counted ? 'close-only' : 'comment-and-close', skipped };
}

// evaluateParentGate(gateInput), then, when `idempotence` is true and the parent is due below
// the floor, evaluateIdempotence merged into the verdict -> the verdict. `readIdempotenceFacts`
// (verdict -> idempotence facts) is called for that verdict only, so a caller's idempotence
// reads (gh shapes 7-8, the facts file's two keys) never run for any other; whatever it throws
// propagates. `source` passes through to evaluateIdempotence. bin/parent-gate.js's paths share
// it; the reconciler does not (its skip reasons need the steps apart).
function evaluateGateWithIdempotence(gateInput, { idempotence = false, readIdempotenceFacts, source } = {}) {
  const verdict = evaluateParentGate(gateInput);
  if (!idempotence || verdict.state !== 'due' || verdict.exceeds !== false) return verdict;
  if (typeof readIdempotenceFacts !== 'function') throw new TypeError('readIdempotenceFacts must be a function');
  const checked = evaluateIdempotence(readIdempotenceFacts(verdict), { source });
  return { ...verdict, idempotence: checked.idempotence, skipped: checked.skipped };
}

// A digit string -> its positive safe-integer value, or null (`Number('')` is 0 and
// `Number(' 5')`/`Number('0x5')` parse, so test the digits first). bin/parent-gate.js's flags share it.
function positive(text) {
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// `--closing` tokens (`N` or `owner/repo#N`) -> { numbers } (ascending, de-duplicated)
// or { error }. An unqualified N is kept as-is; a qualified token needs owner/repo
// and is kept only when sameRepoNumbers judges it this repo's.
function parseClosingTokens(tokens, { owner, repo } = {}) {
  if (!Array.isArray(tokens)) return { error: 'closing tokens must be an array' };
  const unqualified = [];
  const qualified = [];
  for (const token of tokens) {
    const text = typeof token === 'string' ? token : '';
    if (/^\d+$/.test(text)) {
      const n = positive(text);
      if (n === null) return { error: `malformed closing token (must be a positive integer): ${JSON.stringify(token)}` };
      unqualified.push(n);
      continue;
    }
    const match = QUALIFIED_TOKEN_RE.exec(text);
    if (!match || positive(match[3]) === null) {
      return { error: `malformed closing token (expected N or owner/repo#N): ${JSON.stringify(token)}` };
    }
    if (!owner || !repo) return { error: `closing token ${token} names a repository, but owner/repo is not resolved` };
    qualified.push({ number: positive(match[3]), repository: { name: match[2], owner: { login: match[1] } } });
  }
  return { numbers: distinctAscending([...unqualified, ...sameRepoNumbers(qualified, { owner, repo })]) };
}

module.exports = {
  CLOSE_HEADING,
  HEADING_LINE_RE,
  VALID_RISK_FLOORS,
  VERDICT_FIELDS,
  IDEMPOTENCE_VALUES,
  IDEMPOTENCE_SOURCES,
  isCloseMarkerComment,
  needsIdempotenceReads,
  positive,
  distinctAscending,
  numberSet,
  GhFailure,
  ghCaller,
  resolveParent,
  enumerateSubIssues,
  gatherGateFacts,
  gatherIdempotenceFacts,
  evaluateParentGate,
  evaluateIdempotence,
  evaluateGateWithIdempotence,
  parseClosingTokens,
};
