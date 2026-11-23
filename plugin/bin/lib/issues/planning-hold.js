'use strict';

// Pure: decide from a record's comments whether `/claude-tweaks:specify`'s
// planning step holds it (#6059). The source is the held-comment template and
// the Held-questions schema in `plugin/skills/specify/planning.md` (`## Hold`):
// `Held-by: specify-planning` on the line directly above a
// `<!-- held-questions:start -->` ... `<!-- held-questions:end -->` block of
// `- Question:` / `  Option:` x2 / `  Recommended:` groups, inside the canonical
// `<!-- needs-decision: specify -->` comment.
//
// Selection follows `_shared/work-record.md`'s Resolution rule: a decision
// comment carries `<!-- needs-decision: `, it is unresolved when its body has no
// `**Resolved:**`, only a trusted author's comment counts (comment-trust.js; each
// untrusted decision comment adds its skip note), and the newest unresolved one
// decides. No timestamp, an unparseable one, or a tie for newest is `ambiguous`:
// the reader never guesses which of two comments is the hold. Option, question
// and Recommended values are trimmed before they are compared or returned.
//
// `otherUnresolved` and `supersededHolds` are meaningful only on a `held`
// verdict. There, `supersededHolds` lists the other unresolved trusted
// comments that are themselves specify planning holds (the specify marker and
// the Held-by line: an older hold a failed re-hold left behind), which the
// answer path resolves with the newest; `otherUnresolved` counts only the
// remaining unresolved trusted decision comments (another unit's, or any that
// is not a planning hold), which keep `needs:decision` on the record. On a `not-held` verdict
// `supersededHolds` is `[]` and `otherUnresolved` is not a label decision.
//
// `readBack` (#6100) is the pure read-back of `specify/planning-answer.md`'s
// `## Read-back and outcome`: given the re-fetched labels, body and comments plus
// the write results, it runs the assertions in a fixed order (`labels`, `rehold`
// on a re-held branch only, `resolved`, `plan-line`, `plan-check`) and returns
// the verdict, the failed ids, the outcome line and the `next` action word. It
// does no I/O; a CLI verb wraps it.

const { isTrustedComment, untrustedSkipNote } = require('./comment-trust');
const { parsePlanLine } = require('./plan-line');
const { fencedLineMask } = require('../markdown-blocks');

const HELD_BY_LINE = 'Held-by: specify-planning';
const BLOCK_START = '<!-- held-questions:start -->';
const BLOCK_END = '<!-- held-questions:end -->';
const DECISION_MARKER = '<!-- needs-decision: ';
const SPECIFY_MARKER = '<!-- needs-decision: specify -->';
const RESOLVED = '**Resolved:**';

const QUESTION = '- Question: ';
const OPTION = '  Option: ';
const RECOMMENDED = '  Recommended: ';

function bodyOf(comment) {
  return comment && typeof comment.body === 'string' ? comment.body.replace(/\r\n/g, '\n') : '';
}

function stamp(comment) {
  const raw = comment.createdAt ?? comment.created_at;
  if (typeof raw !== 'string' || raw === '') return NaN;
  return Date.parse(raw);
}

function notHeld(reason, extra = {}) {
  return { verdict: 'not-held', reason, comment: null, otherUnresolved: 0, supersededHolds: [], questions: [], skipped: [], ...extra };
}

// The questions in `lines` (the block's interior), or null when any line breaks the schema.
function parseQuestions(lines) {
  if (lines.length % 4 !== 0) return null;
  const questions = [];
  for (let i = 0; i < lines.length; i += 4) {
    const [q, a, b, r] = lines.slice(i, i + 4);
    if (!q.startsWith(QUESTION) || !a.startsWith(OPTION) || !b.startsWith(OPTION) || !r.startsWith(RECOMMENDED)) return null;
    const question = q.slice(QUESTION.length).trim();
    const first = a.slice(OPTION.length).trim();
    const second = b.slice(OPTION.length).trim();
    const recommended = r.slice(RECOMMENDED.length).trim();
    if (question === '' || first === '' || second === '' || recommended === '' || recommended !== first) return null;
    questions.push({ question, options: [first, second], recommended });
  }
  return questions;
}

// The held questions of a planning hold body, or null when the block does not parse.
function parseBlock(body) {
  const lines = body.split('\n');
  const starts = lines.reduce((acc, line, i) => (line.trim() === BLOCK_START ? [...acc, i] : acc), []);
  if (starts.length !== 1) return null;
  const start = starts[0];
  if (start === 0 || lines[start - 1].trim() !== HELD_BY_LINE) return null;
  const end = lines.findIndex((line, i) => i > start && line.trim() === BLOCK_END);
  if (end === -1) return null;
  return parseQuestions(lines.slice(start + 1, end));
}

function carriesHeldBy(body) {
  return body.split('\n').some((line) => line.trim() === HELD_BY_LINE);
}

// A specify planning hold: the specify unit's marker and the Held-by line.
function isSpecifyHold(body) {
  return carriesHeldBy(body) && body.includes(SPECIFY_MARKER);
}

function ref(comment) {
  return { id: comment.node_id ?? comment.id ?? null, url: comment.url ?? comment.html_url ?? null };
}

// comments: a `gh issue view --json comments` array (camelCase) or a REST/MCP
// array (snake_case). -> { verdict, reason, comment: { id, url } | null,
// otherUnresolved, supersededHolds: [{ id, url }], questions, skipped }.
function readPlanningHold(comments) {
  const list = Array.isArray(comments) ? comments.filter((c) => c !== null && typeof c === 'object') : [];
  const unresolved = list.filter((c) => bodyOf(c).includes(DECISION_MARKER) && !bodyOf(c).includes(RESOLVED));
  const trusted = unresolved.filter(isTrustedComment);
  const untrusted = unresolved.filter((c) => !isTrustedComment(c));
  const skipped = untrusted.map(untrustedSkipNote);

  if (trusted.length === 0) {
    return notHeld(untrusted.some((c) => carriesHeldBy(bodyOf(c))) ? 'untrusted' : 'no-decision-comment', { skipped });
  }

  const stamps = trusted.map(stamp);
  if (stamps.some(Number.isNaN)) return notHeld('ambiguous', { skipped });
  const newestStamp = Math.max(...stamps);
  const newest = trusted.filter((c, i) => stamps[i] === newestStamp);
  if (newest.length !== 1) return notHeld('ambiguous', { skipped });

  const selected = newest[0];
  const body = bodyOf(selected);
  const otherUnresolved = trusted.length - 1;
  if (!isSpecifyHold(body)) return notHeld('not-planning', { skipped, otherUnresolved });

  const questions = parseBlock(body);
  if (questions === null) return notHeld('unparseable', { skipped, otherUnresolved });
  const superseded = trusted.filter((c) => c !== selected && isSpecifyHold(bodyOf(c)));
  return {
    verdict: 'held',
    reason: null,
    comment: ref(selected),
    otherUnresolved: otherUnresolved - superseded.length,
    supersededHolds: superseded.map(ref),
    questions,
    skipped,
  };
}

const READBACK_BRANCHES = ['answered', 'kept', 're-held'];
const NEXT_ACTIONS = ['ready', 'still-needs-decision', 'kept-needs-decision', 'held-or-failed'];
const OUTCOME_TEMPLATES = {
  ready: 'answered — {k} planning question(s), ready (Plan: {short commit})',
  still: 'answered — {k} planning question(s); still needs:decision ({m} other decision comment(s))',
  kept: 'answered — {k} planning question(s); needs:decision kept (decision comments could not be re-read)',
  reheld: 'held — {j} answered, {k} re-held',
  failedAfterReHold: 'failed — read-back ({what}); re-run /claude-tweaks:specify #{n}',
  failedAfterWrite: 'failed — read-back ({what}); check the decision comments and remove needs:decision by hand once none is unresolved',
};

const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isCount = (v) => Number.isInteger(v) && v >= 0;

function validateReadBack(input) {
  const bad = (field, why) => { throw new TypeError(`readBack: ${field} ${why}`); };
  if (input === null || typeof input !== 'object') bad('input', 'must be an object');
  if (!Number.isInteger(input.record) || input.record <= 0) bad('record', 'must be a positive integer');
  if (!READBACK_BRANCHES.includes(input.branch)) bad('branch', `must be one of ${READBACK_BRANCHES.join(', ')}`);
  if (!isStringArray(input.labels)) bad('labels', 'must be a string array');
  if (typeof input.body !== 'string') bad('body', 'must be a string');
  if (!Array.isArray(input.comments)) bad('comments', 'must be an array');
  if (typeof input.planLine !== 'string') bad('planLine', 'must be a string');
  if (!isStringArray(input.resolvedIds)) bad('resolvedIds', 'must be a string array');
  if (!isCount(input.answered)) bad('answered', 'must be an integer >= 0');
  if (input.branch === 'answered') {
    if (!isCount(input.otherUnresolved)) bad('otherUnresolved', 'is required on answered and must be an integer >= 0');
  } else if (input.otherUnresolved !== undefined) bad('otherUnresolved', 'is allowed only on answered');
  if (input.branch === 're-held') {
    if (!isStringArray(input.reheldQuestions) || input.reheldQuestions.length === 0) bad('reheldQuestions', 'is required on re-held and must be a non-empty string array');
  } else if (input.reheldQuestions !== undefined) bad('reheldQuestions', 'is allowed only on re-held');
}

const sortedTrim = (arr) => arr.map((q) => q.trim()).sort();

function labelsAssertion(input) {
  const ready = input.labels.includes('ready');
  const needs = input.labels.includes('needs:decision');
  const wantReady = input.branch === 'answered' && input.otherUnresolved === 0;
  const pass = wantReady ? ready && !needs : needs && !ready;
  const expected = wantReady ? 'ready present, needs:decision absent' : 'needs:decision present, ready absent';
  return { id: 'labels', pass, detail: `expected ${expected}; got [${input.labels.join(', ')}]` };
}

function reholdAssertion(input) {
  const hold = readPlanningHold(input.comments);
  const expected = sortedTrim(input.reheldQuestions);
  const got = sortedTrim(hold.questions.map((q) => q.question));
  const pass = hold.verdict === 'held' && got.length === expected.length && got.every((q, i) => q === expected[i]);
  const detail = hold.verdict === 'held'
    ? `expected held questions [${expected.join(' | ')}]; got [${got.join(' | ')}]`
    : `expected a held verdict; got not-held (${hold.reason})`;
  return { id: 'rehold', pass, detail };
}

function resolvedAssertion(input) {
  const comments = input.comments.filter((c) => c !== null && typeof c === 'object');
  const problems = [];
  for (const id of input.resolvedIds) {
    const match = comments.filter((c) => String(ref(c).id) === id || String(c.id) === id);
    if (match.length === 0) problems.push(`${id} (comment not found)`);
    else if (!match.some((c) => bodyOf(c).includes(RESOLVED))) problems.push(`${id} (no ${RESOLVED})`);
  }
  if (input.resolvedIds.length === 0) problems.push('no resolved ids given');
  return {
    id: 'resolved',
    pass: problems.length === 0,
    detail: problems.length === 0 ? `resolved: ${input.resolvedIds.join(', ')}` : `expected every id resolved; got ${problems.join(', ')}`,
  };
}

function planLineAssertion(input) {
  const parsed = parsePlanLine(input.planLine);
  const lines = input.body.replace(/\r\n/g, '\n').split('\n');
  const mask = fencedLineMask(lines);
  const found = lines.filter((line, i) => !mask[i] && line.replace(/[ \t]+$/, '').startsWith('Plan:')).map((line) => line.replace(/[ \t]+$/, ''));
  const want = input.planLine.replace(/[ \t\r]+$/, '');
  const pass = parsed.ok && found.length === 1 && found[0] === want;
  const detail = !parsed.ok
    ? `expected a parseable plan line; got ${parsed.reason ?? 'unparseable'}`
    : `expected exactly one body Plan: line equal to the written line; got ${found.length} (${found.length === 1 ? 'differs' : 'count'})`;
  return { id: 'plan-line', pass, detail: pass ? 'body carries the written Plan: line once' : detail };
}

function planCheckAssertion(input) {
  const pc = input.planCheck;
  const pass = pc !== null && typeof pc === 'object' && pc.valid === true;
  return { id: 'plan-check', pass, detail: pass ? 'plan-check valid' : `expected plan-check valid === true; got ${JSON.stringify(pc)}` };
}

const render = (tpl, vars) => tpl.replace(/\{(k|m|j|n|what|short commit)\}/g, (_, key) => String(vars[key]));

// input: field list and checks: `validateReadBack` above. -> { ok, branch, assertions, failed, outcome, next }.
function readBack(input) {
  validateReadBack(input);
  const assertions = [labelsAssertion(input)];
  if (input.branch === 're-held') assertions.push(reholdAssertion(input));
  assertions.push(resolvedAssertion(input), planLineAssertion(input), planCheckAssertion(input));
  const failed = assertions.filter((a) => !a.pass).map((a) => a.id);
  const ok = failed.length === 0;
  const { branch, record, answered } = input;
  const T = OUTCOME_TEMPLATES;
  let outcome;
  let next;
  if (!ok) {
    const vars = { what: failed.join(', '), n: record };
    if (branch === 're-held') { outcome = render(T.failedAfterReHold, vars); next = 'held-or-failed'; }
    else { outcome = render(T.failedAfterWrite, vars); next = 'kept-needs-decision'; }
  } else if (branch === 're-held') {
    outcome = render(T.reheld, { j: answered, k: input.reheldQuestions.length }); next = 'held-or-failed';
  } else if (branch === 'kept') {
    outcome = render(T.kept, { k: answered }); next = 'kept-needs-decision';
  } else if (input.otherUnresolved === 0) {
    outcome = render(T.ready, { k: answered, 'short commit': parsePlanLine(input.planLine).commit.slice(0, 7) }); next = 'ready';
  } else {
    outcome = render(T.still, { k: answered, m: input.otherUnresolved }); next = 'still-needs-decision';
  }
  return { ok, branch, assertions, failed, outcome, next };
}

module.exports = {
  readPlanningHold, HELD_BY_LINE, BLOCK_START, BLOCK_END,
  readBack, READBACK_BRANCHES, NEXT_ACTIONS, OUTCOME_TEMPLATES,
};
