// bin/lib/issues/parent-gate.js
// The one Node implementation of the Parent-Gate Procedure's Resolve the parent,
// Enumerate the parent's sub-issues, Self-inclusion rule and Evaluate the gate
// sections (wrap-up/verification-brief-parent-gate.md), and of the below-floor
// close's idempotence check (#4603). The gathers keep #4599's gh call shapes,
// except that native enumeration runs through bin/fetch-sub-issues.js's `run`,
// called in-process, so its probe, page and retry ladder are reused, not
// re-derived, and that every `gh issue view` read carries `--repo owner/repo`,
// so one gate never splits its reads between gh's base repo and the caller's.
// bin/parent-gate.js and below-floor-parent-close.js both compose it. It
// replaces the prose snippets that #4466's review found eight defects in.
//
// Four parts: two gh gathers (gatherGateFacts, gatherIdempotenceFacts) that
// take a `caller` from ghCaller(gh) and throw GhFailure on a failing or
// unreadable read, and two pure evaluators (evaluateParentGate,
// evaluateIdempotence) that turn the gathered facts into the verdict.
'use strict';

const { fetchNativeParent } = require('./native-dependencies');
const { parseSubIssues } = require('./record');
const { parseRecordFacets, normalizeLabelNames, LABELS } = require('./record-vocabulary');
const { parentGateState } = require('./acceptance');
const { maxRiskTier, exceedsOversightFloor } = require('./oversight-floor');
const { isTrustedComment, untrustedSkipNote } = require('./comment-trust');
const { sameRepoNumbers } = require('../flow/closing-links');
const { POLICY_KEYS } = require('../policy-schema');
const { run: runFetchSubIssues, EXIT_SUBISSUES_UNAVAILABLE } = require('../../fetch-sub-issues');

const CLOSE_HEADING = '## Closed below the oversight floor';
// The floor values `exceedsOversightFloor` evaluates, read from the policy schema's
// `risk-floor` enum so a new value there is never rejected here. `null` (and undefined) must not
// reach it: a null floor switches the unscored check off too, which would close a
// parent whose sub-issues carry no risk label.
const VALID_RISK_FLOORS = POLICY_KEYS.find((k) => k.key === 'risk-floor').values;
const HEADING_LINE_RE = /^## Closed below the oversight floor\s*$/m;
const PARENT_LINE_RE = /^Parent: #(\d+)/m;

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

// Shape 1 (body-text) or 2 (native): the sub-issue's parent number, or null.
function resolveParent({ subIssue, owner, repo, workLinks, caller }) {
  if (workLinks === 'body-text') {
    const match = PARENT_LINE_RE.exec(String(caller.call(['issue', 'view', String(subIssue), '--repo', `${owner}/${repo}`, '--json', 'body', '-q', '.body'])));
    return match ? Number(match[1]) : null;
  }
  // fetchNativeParent throws only for a failed or malformed GraphQL read.
  try {
    return fetchNativeParent({ number: subIssue, owner, repo, runner: (args) => caller.call(args) });
  } catch (err) {
    throw err instanceof GhFailure ? err : new GhFailure(`gh api graphql (parent): ${err.message}`);
  }
}

// Shape 3 (body-text: the parent's task list) or shape 4 (native: fetch-sub-issues.js's
// `run` in-process, or the one REST read 4d when it reports the field unavailable).
// -> the parent's sub-issue numbers, ascending. `fetcher` is that `run`; tests inject
// one to reach the exit-0 branches the real CLI never takes (unparseable stdout, no key).
function enumerateSubIssues({
  parent, owner, repo, workLinks, caller, fetcher = runFetchSubIssues,
}) {
  if (workLinks === 'body-text') {
    return distinctAscending(parseSubIssues(String(caller.call(['issue', 'view', String(parent), '--repo', `${owner}/${repo}`, '--json', 'body', '-q', '.body']))));
  }
  const restArgs = ['api', '--paginate', `repos/${owner}/${repo}/issues/${parent}/sub_issues`, '--jq', '.[].number'];
  let out = '';
  let err = '';
  const code = fetcher([String(parent), '--repo', `${owner}/${repo}`, '--resolve-retries'], {
    ghAvailable: () => true,
    remoteUrl: () => null,
    runner: (args) => caller.call(args),
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
// With no resolvable parent it stops after resolution.
function gatherGateFacts({ subIssue, parent, owner, repo, workLinks, caller }) {
  const given = (v) => v !== null && v !== undefined;
  if (given(subIssue) === given(parent)) {
    throw new TypeError('gatherGateFacts takes exactly one of subIssue and parent');
  }
  let resolved = parent;
  if (resolved === null || resolved === undefined) {
    resolved = resolveParent({ subIssue, owner, repo, workLinks, caller });
    if (resolved === null || resolved === undefined) return { parent: null, parentLabels: [], subIssues: [] };
  }
  const slug = `${owner}/${repo}`;
  const subIssues = enumerateSubIssues({ parent: resolved, owner, repo, workLinks, caller }).map((num) => {
    const live = caller.callJson(['issue', 'view', String(num), '--repo', slug, '--json', 'state,stateReason,labels,title,closedByPullRequestsReferences'], 'object');
    // Absent or null is no closing PR; any other non-array is a malformed answer, as on the MCP path.
    const rawRefs = live.closedByPullRequestsReferences;
    if (rawRefs !== undefined && rawRefs !== null && !Array.isArray(rawRefs)) {
      throw new GhFailure(`gh issue view ${num}: unexpected output (closedByPullRequestsReferences is not an array: ${JSON.stringify(rawRefs)})`);
    }
    const refs = rawRefs || [];
    return {
      number: num,
      title: String(live.title || '').trim(),
      state: String(live.state || '').toUpperCase(),
      stateReason: String(live.stateReason || '').toUpperCase(),
      labels: normalizeLabelNames(live.labels),
      closedBy: refs.map((ref) => ref && ref.number).filter(Number.isInteger),
    };
  });
  const parentLabels = normalizeLabelNames(caller.callJson(['issue', 'view', String(resolved), '--repo', slug, '--json', 'labels', '-q', '[.labels[].name]'], 'array'));
  return { parent: resolved, parentLabels, subIssues };
}

// Shapes 7 and 8: the parent's live state and comments, and the current gh login,
// read only when the parent is neither CLOSED nor REOPENED.
function gatherIdempotenceFacts({ parent, owner, repo, caller }) {
  const live = caller.callJson(['issue', 'view', String(parent), '--repo', `${owner}/${repo}`, '--json', 'state,stateReason,comments'], 'object');
  const state = String(live.state || '').toUpperCase();
  const stateReason = String(live.stateReason || '').toUpperCase();
  const comments = Array.isArray(live.comments) ? live.comments : [];
  const login = state === 'CLOSED' || stateReason === 'REOPENED'
    ? null
    : String(caller.call(['api', 'user', '--jq', '.login'])).trim();
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
        pr: inClosingSet && mergingPr ? mergingPr : closedBy[closedBy.length - 1] || null,
        facets: parseRecordFacets(s.labels),
      };
    });

  const state = parentGateState({ subIssues: gateSubIssues, parentLabels: labels });
  const tier = maxRiskTier(gateSubIssues.map((s) => s.facets));
  const maxTier = tier === undefined ? null : tier;
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

// Pure: idempotence facts -> { idempotence, skipped }. `{ state, body }` is the
// local-files shape (the close marker is a heading in the record body);
// `{ state, stateReason, comments, login }` is the gh/MCP shape.
function evaluateIdempotence(facts) {
  const f = facts || {};
  const state = String(f.state || '').toUpperCase();
  if (state === 'CLOSED') return { idempotence: 'already-closed', skipped: [] };
  if (typeof f.body === 'string') {
    return { idempotence: HEADING_LINE_RE.test(f.body) ? 'close-only' : 'comment-and-close', skipped: [] };
  }
  if (String(f.stateReason || '').toUpperCase() === 'REOPENED') return { idempotence: 'reopened', skipped: [] };
  let counted = false;
  const skipped = [];
  for (const comment of Array.isArray(f.comments) ? f.comments : []) {
    if (!comment || !HEADING_LINE_RE.test(String(comment.body || ''))) continue;
    if (isCloseMarkerComment(comment, f.login)) counted = true;
    else skipped.push(untrustedSkipNote(comment));
  }
  return { idempotence: counted ? 'close-only' : 'comment-and-close', skipped };
}

// A digit string -> its positive safe-integer value, or null.
function positive(digits) {
  const n = Number(digits);
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
  PARENT_LINE_RE,
  VALID_RISK_FLOORS,
  VERDICT_FIELDS,
  IDEMPOTENCE_VALUES,
  isCloseMarkerComment,
  distinctAscending,
  GhFailure,
  ghCaller,
  resolveParent,
  enumerateSubIssues,
  gatherGateFacts,
  gatherIdempotenceFacts,
  evaluateParentGate,
  evaluateIdempotence,
  parseClosingTokens,
};
