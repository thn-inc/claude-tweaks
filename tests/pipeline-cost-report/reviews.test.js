// tests/pipeline-cost-report/reviews.test.js
//
// #5925: tools/pipeline-cost-report/reviews.js parses a task review's verdict, a plan review's findings table and a
// review lens's findings table out of a subagent's final report. The samples are trimmed real reports kept under
// tests/fixtures/pipeline-cost-report/reviews/; each file holds several, opened by a `=== {name} ({run}, {agentId}) ===` line.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('../helpers/read-skill');

const ROOT = path.join(__dirname, '..', '..');
const { parseTaskVerdict, parsePlanReview, parseLensReport } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'reviews.js'));
const { parseReviewCounts } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'guards.js'));

const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'pipeline-cost-report', 'reviews');

// The text between the `=== {name} (` header and the next `=== ` line, trimmed.
function sample(file, name) {
  const lines = readText(path.join(FIXTURES, file)).split('\n');
  const start = lines.findIndex((l) => l.startsWith(`=== ${name} (`));
  assert.ok(start >= 0, `no sample ${name} in ${file}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('=== '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}
const task = (name) => sample('task-reviews.txt', name);
const plan = (name) => sample('plan-reviews.txt', name);
const lens = (name) => sample('lens-reports.txt', name);

const NO_KINDS = { 'cross-task contract': 0, 'undecided behaviour': 0, 'spec gap': 0, 'missing review risk': 0, other: 0 };
const LENS_HEAD = '| Severity | Path:Line | Finding | Evidence |\n|---|---|---|---|\n';

test('parseTaskVerdict reads the bold, unbolded and trailing-clause verdicts', () => {
  assert.strictEqual(parseTaskVerdict(task('needs-fixes-important')), 'needs-fixes');
  assert.strictEqual(parseTaskVerdict(task('needs-fixes-minor-only')), 'needs-fixes');
  assert.strictEqual(parseTaskVerdict(task('approved-unbolded')), 'approved');
  assert.strictEqual(parseTaskVerdict('**Task quality:** Needs fixes (one cheap Important item).'), 'needs-fixes');
  assert.strictEqual(parseTaskVerdict('**Task quality:** Approved, with one recommended follow-up'), 'approved');
});

test('AC2.1: a task-review report with no verdict line is unparsed', () => {
  assert.strictEqual(parseTaskVerdict(task('fix-round-no-verdict')), null);
  assert.strictEqual(parseTaskVerdict('API Error 403'), null);
});

test("the real needs-fixes reports' items", () => {
  assert.deepStrictEqual(parseReviewCounts(task('needs-fixes-important')), { critical: 0, important: 1, minor: 2 });
  assert.deepStrictEqual(parseReviewCounts(task('needs-fixes-minor-only')), { critical: 0, important: 0, minor: 3 });
});

test('parsePlanReview reads the real table, kinds and overflow', () => {
  assert.deepStrictEqual(parsePlanReview(plan('rows-with-overflow')), {
    findings: 5,
    byKind: { 'cross-task contract': 1, 'undecided behaviour': 0, 'spec gap': 1, 'missing review risk': 1, other: 2 },
  });
  const one = parsePlanReview(plan('undecided-behaviour'));
  assert.strictEqual(one.findings, 1);
  assert.strictEqual(one.byKind['undecided behaviour'], 1);
});

test('parsePlanReview: a stated no-findings report is zero, an unstructured one is null', () => {
  assert.deepStrictEqual(parsePlanReview(plan('no-findings')), { findings: 0, byKind: NO_KINDS });
  assert.strictEqual(parsePlanReview('Agent crashed: API Error 529'), null);
});

test('parsePlanReview buckets an unknown kind and normalises case and hyphens', () => {
  const head = '| Severity | Class | Resolution | Path:Line | Finding | Evidence | Suggested resolution |\n|---|---|---|---|---|---|---|\n';
  const row = (kind) => `| low | ${kind} | — | a.md:1 | f | e | s |\n`;
  const got = parsePlanReview(head + row('Mischaracterized-Role') + row('Missing Review Risk') + row('undecided behavior'));
  assert.strictEqual(got.findings, 3);
  assert.strictEqual(got.byKind.other, 1);
  assert.strictEqual(got.byKind['missing review risk'], 1);
  assert.strictEqual(got.byKind['undecided behaviour'], 1);
});

const PLAN_HEAD = '| Severity | Class | Resolution | Path:Line | Finding | Evidence | Suggested resolution |\n|---|---|---|---|---|---|---|\n';

test('parsePlanReview counts only the first table: a later unrelated table is not findings', () => {
  const got = parsePlanReview(`${PLAN_HEAD}| low | spec gap | — | a.md:1 | f | e | s |\n\nRisk by task:\n\n| Task | Risk |\n|---|---|\n| 1 | high |\n| 2 | low |`);
  assert.strictEqual(got.findings, 1);
  assert.strictEqual(got.byKind['spec gap'], 1);
  assert.strictEqual(got.byKind.other, 0);
});

test('parsePlanReview: a header with no row is unparsed unless "No findings" is stated', () => {
  assert.strictEqual(parsePlanReview(PLAN_HEAD), null);
  assert.deepStrictEqual(parsePlanReview(`${PLAN_HEAD}\nNo findings.`), { findings: 0, byKind: NO_KINDS });
});

test('parseLensReport: a header with no row is unparsed unless "No findings" is stated', () => {
  assert.strictEqual(parseLensReport(LENS_HEAD), null);
  assert.deepStrictEqual(parseLensReport(`${LENS_HEAD}\nNo findings.`), { critical: 0, high: 0, medium: 0, low: 0, info: 0, overflow: 0 });
});

test('parseLensReport counts rows by severity', () => {
  assert.deepStrictEqual(parseLensReport(lens('table')), { critical: 0, high: 0, medium: 1, low: 2, info: 0, overflow: 0 });
});

test('parseLensReport counts a "+N more" overflow row in overflow, never as a finding', () => {
  const a = parseLensReport(`${LENS_HEAD}| low | a.js:1 | x | y |\n| info | — | +3 more | — |`);
  assert.strictEqual(a.low, 1);
  assert.strictEqual(a.info, 0);
  assert.strictEqual(a.overflow, 3);
  const b = parseLensReport(`${LENS_HEAD}| medium | a.js:1 | x | y |\n| +2 more | | | |`);
  assert.strictEqual(b.medium, 1);
  assert.strictEqual(b.overflow, 2);
});

test('AC9.1: a lens report opening "No findings" and continuing in prose with no row is no-finding', () => {
  const zero = { critical: 0, high: 0, medium: 0, low: 0, info: 0, overflow: 0 };
  assert.deepStrictEqual(parseLensReport(lens('no-findings-then-prose')), zero);
  assert.deepStrictEqual(parseLensReport(lens('prose-then-no-findings')), zero);
  assert.deepStrictEqual(parseLensReport(lens('no-findings')), zero);
});

test('parseLensReport: rows win over a "No findings" opening; no structure is null', () => {
  const got = parseLensReport(`No findings in scope.\n\n${LENS_HEAD}| low | a.js:1 | x | y |`);
  assert.strictEqual(got.low, 1);
  assert.strictEqual(parseLensReport('Agent crashed'), null);
});
