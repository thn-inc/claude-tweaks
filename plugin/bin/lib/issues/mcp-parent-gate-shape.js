// bin/lib/issues/mcp-parent-gate-shape.js
// Normalizes the GitHub MCP `issue_read` results the Parent-Gate Procedure's
// facts file holds into the facts shape bin/lib/issues/parent-gate.js's gh
// gather returns, so `evaluateParentGate` and `evaluateIdempotence` run over one
// shape on both transports (#4603). Consumer: `bin/parent-gate.js --facts-json`,
// driven by wrap-up/verification-brief-parent-gate.md's Transport paragraph. Pure,
// no I/O: the CLI reads the file. A Node subprocess cannot call MCP, so the agent
// fetches and writes each result unreshaped (the mcp-agent-fetch-node-compute
// skill); this file is the compute half, and it is a no-op on a gh-shaped entry.
//
// Every entry is shape-guarded (rule 3): an MCP error object (`{message:'Not
// Found'}`) or a wrapper written as data fails its guard with a FactsError of exit
// 3 and is never read as content. A required key that is absent, or a
// `subIssueGets` key set that is not the enumerated numbers, is exit 1: the read
// never happened. Normalization (rules 9 and 10): `state`/`stateReason` are
// uppercased, label objects become names, `closedBy` is taken from either
// `closedByPullRequestsReferences` or MCP's `closed_by_pull_requests`
// (`_shared/github-write-transport.md`), and each comment is reshaped to gh's.
'use strict';

const { parseSubIssues } = require('./record');
const { normalizeLabelNames } = require('./record-vocabulary');
const { PARENT_LINE_RE } = require('./parent-gate');

// The agent's seven fact keys, each one MCP result written unreshaped:
//   parentLink    `get_parent` of the sub-issue in hand, or null when it has none (native).
//   subIssueGet   `get` of the sub-issue in hand (body-text).
//   subIssueList  every `get_sub_issues` entry, all pages concatenated (native).
//   parentGet     `get` of the parent.
//   subIssueGets  { "<n>": `get` of n }, exactly one key per enumerated number.
//   parentComments  every `get_comments` entry of the parent, all pages concatenated.
//   me            `get_me`.
const FACTS_KEYS = ['parentLink', 'subIssueGet', 'subIssueList', 'parentGet', 'subIssueGets', 'parentComments', 'me'];

// exit 1: the file as a whole is wrong (not an object, a key absent or unrequested), so
// the fetch never happened. exit 3: a present entry fails its guard (an MCP error
// recorded as data). `key` names the offending entry, e.g. `subIssueGets.12`.
class FactsError extends Error {
  constructor(exit, key, message) {
    super(message);
    this.name = 'FactsError';
    this.exit = exit;
    this.key = key;
  }
}

const absent = (key, message) => new FactsError(1, key, message);
const invalid = (key, message) => new FactsError(3, key, message);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// Whether the key was written at all (an explicit null counts: `parentLink: null` is an answer).
function has(raw, key) {
  return raw[key] !== undefined;
}

function need(raw, key) {
  if (!has(raw, key)) throw absent(key, 'required key is missing');
  return raw[key];
}

// An `issue_read` get entry: a plain object whose number is the one asked for and whose
// state is a string. `labels` and `body` are checked only where the caller reads them.
function guardIssue(entry, key, number, { labels = false, body = false } = {}) {
  if (!isPlainObject(entry)) throw invalid(key, 'is not an issue object');
  if (entry.number !== number) throw invalid(key, `is not issue #${number} (number ${JSON.stringify(entry.number)})`);
  if (typeof entry.state !== 'string') throw invalid(key, 'has no string state');
  const reason = entry.stateReason ?? entry.state_reason;
  if (reason !== undefined && reason !== null && typeof reason !== 'string') throw invalid(key, 'has a non-string state reason');
  if (body && typeof entry.body !== 'string') throw invalid(key, 'has no string body');
  if (labels) {
    const ok = Array.isArray(entry.labels)
      && entry.labels.every((l) => typeof l === 'string' || (isPlainObject(l) && typeof l.name === 'string'));
    if (!ok) throw invalid(key, 'has no labels array of names or { name } objects');
  }
}

// state / stateReason, uppercased: gh's `CLOSED`/`NOT_PLANNED` for MCP's `closed`/`not_planned`.
function upper(value) {
  return String(value ?? '').toUpperCase();
}

// The PR numbers that closed an issue: gh's `closedByPullRequestsReferences`, or MCP's
// `closed_by_pull_requests` as an array or as `{ references: [...] }`. [] when absent.
function closedByNumbers(entry, key) {
  const raw = entry.closedByPullRequestsReferences !== undefined ? entry.closedByPullRequestsReferences : entry.closed_by_pull_requests;
  if (raw === undefined) return [];
  const refs = Array.isArray(raw) ? raw : isPlainObject(raw) && Array.isArray(raw.references) ? raw.references : null;
  if (refs === null || !refs.every((ref) => isPlainObject(ref) && isPositiveInteger(ref.number))) {
    throw invalid(key, 'closed_by_pull_requests is not a list of { number } references');
  }
  return refs.map((ref) => ref.number);
}

function distinctAscending(numbers) {
  return [...new Set(numbers)].sort((a, b) => a - b);
}

// The sub-issue in hand -> its parent number, or null (shape 1 or 2 of the gate's resolution).
function resolveParent(raw, subIssue, workLinks) {
  if (workLinks === 'body-text') {
    const entry = need(raw, 'subIssueGet');
    guardIssue(entry, 'subIssueGet', subIssue, { body: true });
    const match = PARENT_LINE_RE.exec(entry.body);
    return match ? Number(match[1]) : null;
  }
  const link = need(raw, 'parentLink');
  if (link === null) return null;
  if (!isPlainObject(link) || !isPositiveInteger(link.number)) throw invalid('parentLink', 'is neither null nor a parent with a number');
  return link.number;
}

// The parent's sub-issue numbers, ascending: the task list (body-text) or `get_sub_issues` (native).
function enumerate(raw, parentEntry, workLinks) {
  if (workLinks === 'body-text') return distinctAscending(parseSubIssues(parentEntry.body));
  const list = need(raw, 'subIssueList');
  if (!Array.isArray(list)) throw invalid('subIssueList', 'is not an array');
  list.forEach((entry, i) => {
    if (!isPlainObject(entry) || !isPositiveInteger(entry.number)) throw invalid(`subIssueList.${i}`, 'is not a sub-issue with a number');
  });
  return distinctAscending(list.map((entry) => entry.number));
}

// A comment reshaped to gh's: author.login, authorAssociation and url.
function normalizeComment(c) {
  return {
    body: c.body,
    author: c.author || { login: c.user && c.user.login },
    authorAssociation: c.authorAssociation || c.author_association,
    url: c.url || c.html_url,
  };
}

// raw facts + { subIssue | parent, workLinks } -> { gate, idempotence }.
//   gate         { parent, parentLabels, subIssues: [{ number, title, state, stateReason, labels, closedBy }] }
//                (the facts shape gatherGateFacts returns; with no parent, { parent: null, parentLabels: [], subIssues: [] }).
//   idempotence  { state, stateReason, comments, login } for the parent, or null with no parent;
//                `comments` and `login` are undefined when their keys are absent.
// Throws FactsError.
function normalizeMcpFacts(raw, { subIssue, parent, workLinks } = {}) {
  if (!isPlainObject(raw)) throw absent('(top level)', 'must be a JSON object');
  const given = parent !== null && parent !== undefined;
  const resolved = given ? parent : resolveParent(raw, subIssue, workLinks);
  if (resolved === null || resolved === undefined) {
    return { gate: { parent: null, parentLabels: [], subIssues: [] }, idempotence: null };
  }

  const parentEntry = need(raw, 'parentGet');
  guardIssue(parentEntry, 'parentGet', resolved, { labels: true, body: workLinks === 'body-text' });
  const numbers = enumerate(raw, parentEntry, workLinks);

  const gets = need(raw, 'subIssueGets');
  if (!isPlainObject(gets)) throw invalid('subIssueGets', 'is not an object keyed by sub-issue number');
  const wanted = new Set(numbers.map(String));
  for (const n of numbers) if (!(String(n) in gets)) throw absent(`subIssueGets.${n}`, 'is missing');
  for (const key of Object.keys(gets)) if (!wanted.has(key)) throw absent(`subIssueGets.${key}`, 'is not an enumerated sub-issue');

  const subIssues = numbers.map((n) => {
    const key = `subIssueGets.${n}`;
    const entry = gets[String(n)];
    guardIssue(entry, key, n, { labels: true });
    return {
      number: n,
      title: String(entry.title || '').trim(),
      state: upper(entry.state),
      stateReason: upper(entry.stateReason ?? entry.state_reason),
      labels: normalizeLabelNames(entry.labels),
      closedBy: closedByNumbers(entry, key),
    };
  });

  let comments;
  if (has(raw, 'parentComments')) {
    if (!Array.isArray(raw.parentComments)) throw invalid('parentComments', 'is not an array');
    comments = raw.parentComments.map((c, i) => {
      if (!isPlainObject(c) || typeof c.body !== 'string') throw invalid(`parentComments.${i}`, 'is not a comment with a string body');
      return normalizeComment(c);
    });
  }
  let login;
  if (has(raw, 'me')) {
    if (!isPlainObject(raw.me) || typeof raw.me.login !== 'string' || raw.me.login === '') throw invalid('me', 'has no login');
    login = raw.me.login;
  }

  return {
    gate: { parent: resolved, parentLabels: normalizeLabelNames(parentEntry.labels), subIssues },
    idempotence: {
      state: upper(parentEntry.state), stateReason: upper(parentEntry.stateReason ?? parentEntry.state_reason), comments, login,
    },
  };
}

// The idempotence reads (`parentComments`, `me`) are optional in the file until the parent is
// open and not reopened: only then does evaluateIdempotence read them. A missing one is exit 1.
function requireIdempotenceReads(facts) {
  if (facts.state === 'CLOSED' || facts.stateReason === 'REOPENED') return;
  if (facts.comments === undefined) throw absent('parentComments', 'is required under --idempotence for an open parent below the floor');
  if (facts.login === undefined) throw absent('me', 'is required under --idempotence for an open parent below the floor');
}

module.exports = {
  FACTS_KEYS, FactsError, normalizeMcpFacts, requireIdempotenceReads,
};
