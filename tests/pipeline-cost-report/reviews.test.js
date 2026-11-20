// tests/pipeline-cost-report/reviews.test.js
//
// #5925: tools/pipeline-cost-report/reviews.js parses a task review's verdict, a plan review's findings table and a
// review lens's findings table out of a subagent's final report. The samples are trimmed real reports kept under
// tests/fixtures/pipeline-cost-report/reviews/; each file holds several, opened by a `=== {name} ({run}, {agentId}) ===` line.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readText } = require('../helpers/read-skill');

const ROOT = path.join(__dirname, '..', '..');
const { lensIdOf, parseTaskVerdict, parsePlanReview, parseLensReport, walkRuns, readVerdicts, isHumanStop, collectTaskReview, collectPlanReview, collectReviews, lensAgentsOf, collectLensAgents, collectPerRun, classifyRouting, collectOutcomes, collectYield } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'reviews.js'));
const { parseReviewCounts, resolveRun } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'guards.js'));
const { listRuns } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'runs.js'));

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pcr-reviews-'));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));
let tmpN = 0;
const fresh = (label) => {
  const d = path.join(DIR, `${label}${tmpN++}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

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

test('parsePlanReview: the table ends at the first non-table line, even when a later table has severity rows and an overflow row', () => {
  const row = '| low | spec gap | — | a.md:1 | f | e | s |\n';
  const later = '| Severity | Count |\n|---|---|\n| high | 3 |\n| low | 2 |\n| info | +4 more |';
  const got = parsePlanReview(`${PLAN_HEAD}${row}\n${later}`);
  assert.strictEqual(got.findings, 1);
  assert.strictEqual(got.byKind.other, 0);
});

test('parsePlanReview: a table directly under the findings table counts only rows that start with a severity word', () => {
  const row = '| low | spec gap | — | a.md:1 | f | e | s |\n';
  const got = parsePlanReview(`${PLAN_HEAD}${row}| Task | Risk |\n|---|---|\n| 1 | high |\n| 2 | low |`);
  assert.strictEqual(got.findings, 1);
  assert.strictEqual(got.byKind.other, 0);
});

test('parseLensReport counts only the first table: a later summary table with severity rows is not findings', () => {
  const got = parseLensReport(`${LENS_HEAD}| low | a.js:1 | x | y |\n\nSummary:\n\n| Severity | Count |\n|---|---|\n| low | 2 |\n| info | +4 more |`);
  assert.strictEqual(got.low, 1);
  assert.strictEqual(got.overflow, 0);
  // Severity rows with no `Severity` header row are no table: unparsed unless the reply states No findings.
  assert.strictEqual(parseLensReport('| low | a.js:1 | x | y |'), null);
  assert.strictEqual(parseLensReport('No findings.\n\n| low | a.js:1 | x | y |').low, 0);
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

// --- run walk, task review, plan review, human stops (Task 2) ---

// Writes {pipelines}/{name}/timing.json; returns the run object listRuns would produce.
function writeRun(pipelines, name, { items = [], sessions = [] } = {}, projects = 'projects') {
  const dir = path.join(pipelines, name);
  fs.mkdirSync(dir, { recursive: true });
  const transcripts = sessions.map((s) => ({ path: path.join(projects, 'slug-main', `${s}.jsonl`) }));
  fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify({ dispatches: { items }, transcripts }));
  return runObj(pipelines, name);
}
function writeReport(projects, session, agentId, text) {
  const d = path.join(projects, 'slug-sub', session, 'subagents');
  fs.mkdirSync(d, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'user', message: { content: 'go' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
  ];
  fs.writeFileSync(path.join(d, `agent-${agentId}.jsonl`), lines.join('\n') + '\n');
}
const item = (agentId, role, tier, description = 'Task 1: x') => ({ agentId, description, role, tier, parentAgentId: null, startTs: '2026-11-18T10:00:00Z' });
function runObj(pipelines, name) {
  const dir = path.join(pipelines, name);
  const members = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const m = /^spec-(\d+)$/.exec(e.name);
    if (m && e.isDirectory()) members.push({ id: Number(m[1]), dir: path.join(dir, e.name) });
  }
  return { name, date: name.slice(0, 10), dir, archived: false, members };
}
const writeDecisions = (dir, text) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'decisions.md'), text);
};
const KEPT = '- KEPT-PROMPT 08:28:18 — Common Step 1.6 (plan review): plan review: 2 needs-human spec gap(s) asked inline. Reversibility: n/a.';
const REFUSED = '- REFUSED 00:38:24 — Common Step 1.6 (plan review): plan review: 1 needs-human spec gap (AC1 baseline comparability) — dispatched call cannot ask; question posted as issuecomment-6903297698; HARD-GATE plan-review-needs-human; 5 plan-amendment rows and 1 low row not applied. Reversibility: n/a.';
const POSTED = '- AUTO 23:02:28 — Common Step 1.6 (plan review): plan review returned 6 rows (1 needs-human spec gap). First round, no AskUserQuestion in this subagent session, so the needs-human gate took the dispatched-call branch: question posted on the record. Reversibility: n/a.';
const SETTLED = '- AUTO 03:03:43 — Common Step 1.6 (plan review): amended spec and plan for 4 finding(s) (1 needs-human spec gap settled in a converged round; 2 cross-task contract; 1 undecided behaviour); commit 625421378. Reversibility: high.';
const RELEASED = '- AUTO 00:32:10 — Section E: released claim on #5540 (failed: plan-review-needs-human). Reversibility: high.';
const STUB = { dispatches: { notFound: 'no transcript resolved' }, transcripts: [] };

// One run with four capable task reviews: t1 Important, t2 approved, t3 Minor-only, t4 Important.
function fourTaskReviews() {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const items = ['t1', 't2', 't3', 't4'].map((id) => item(id, 'task review', 'capable'));
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items, sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 't1', task('needs-fixes-important'));
  writeReport(projects, 's1', 't2', task('approved-unbolded'));
  writeReport(projects, 's1', 't3', task('needs-fixes-minor-only'));
  writeReport(projects, 's1', 't4', task('needs-fixes-important'));
  return { pipelines, projects, run, items };
}
const taskFigures = (pipelines, projects, since = null, until = null) => collectReviews({ runs: listRuns(pipelines).runs, since, until, n: 20, roots: [projects] }, { fsImpl: fs });

test('AC1.1: four capable task reviews, three needing fixes, one Minor-only', () => {
  const { run, projects } = fourTaskReviews();
  const got = collectTaskReview(walkRuns([run], { since: null, until: null, fsImpl: fs }), { roots: [projects], fsImpl: fs }).byTier.capable;
  assert.strictEqual(got.n, 4);
  assert.strictEqual(got.needsFixes, 0.75);
  assert.strictEqual(got.approved, 0.25);
  assert.deepStrictEqual(got.minorOnly, { count: 1, of: 3, share: 1 / 3 });
  assert.deepStrictEqual(got.items, { critical: 0, important: 2, minor: 7, n: 3, unparsed: 0 });
});

test('AC2.1: a report with no verdict line is in neither share', () => {
  const { pipelines, projects } = fourTaskReviews();
  const dir = path.join(pipelines, '2026-11-18T1-spec-1');
  const timing = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
  timing.dispatches.items.push(item('t5', 'task review', 'capable'), item('t6', 'task review', 'capable'));
  fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(timing));
  writeReport(projects, 's1', 't5', task('fix-round-no-verdict'));
  const got = collectTaskReview(walkRuns(listRuns(pipelines).runs, { since: null, until: null, fsImpl: fs }), { roots: [projects], fsImpl: fs }).byTier.capable;
  assert.strictEqual(got.n, 4);
  assert.strictEqual(got.unparsed, 2);
  assert.strictEqual(got.needsFixes, 0.75);
});

test('re-reviews are counted beside the table, not in it', () => {
  const { pipelines, projects } = fourTaskReviews();
  const dir = path.join(pipelines, '2026-11-18T1-spec-1');
  const timing = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
  timing.dispatches.items.push(item('r1', 're-review', 'capable'), item('r2', 're-review', 'standard'));
  fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(timing));
  const got = collectTaskReview(walkRuns(listRuns(pipelines).runs, { since: null, until: null, fsImpl: fs }), { roots: [projects], fsImpl: fs });
  assert.deepStrictEqual(got.reReviews, { n: 2, byTier: { capable: 1, standard: 1 } });
  assert.deepStrictEqual(Object.keys(got.byTier), ['capable']);
  assert.strictEqual(got.byTier.capable.n, 4);
});

test('a task review with no tier is bucketed unknown', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const noTier = item('u1', 'task review', undefined);
  delete noTier.tier;
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items: [noTier], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 'u1', task('approved-unbolded'));
  const got = collectTaskReview(walkRuns([run], { since: null, until: null, fsImpl: fs }), { roots: [projects], fsImpl: fs });
  assert.strictEqual(got.byTier.unknown.n, 1);
});

test('AC3.1: two plan reviews, three finding rows and none, give 50% and 1.5', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items: [item('p1', 'plan review', 'capable'), item('p2', 'plan review', 'capable')], sessions: ['s1'] }, projects);
  const rows = ['| Severity | Class | Resolution | Path:Line | Finding | Evidence | Suggested resolution |', '|---|---|---|---|---|---|---|', '| high | spec gap | — | a.md:1 | f | e | s |', '| medium | cross-task contract | — | a.md:2 | f | e | s |', '| low | undecided behaviour | — | a.md:3 | f | e | s |'];
  writeReport(projects, 's1', 'p1', rows.join('\n'));
  writeReport(projects, 's1', 'p2', 'No findings.');
  const walked = walkRuns([run], { since: null, until: null, fsImpl: fs });
  const got = collectPlanReview(walked, walked.map((w) => w.units.map((u) => readVerdicts(u, fs))), { roots: [projects], fsImpl: fs });
  assert.strictEqual(got.reviews, 2);
  assert.strictEqual(got.n, 2);
  assert.strictEqual(got.withFindings, 0.5);
  assert.strictEqual(got.findingsPerReview, 1.5);
  assert.strictEqual(got.unparsed, 0);
  assert.strictEqual(got.byKind['spec gap'], 1);
  assert.strictEqual(got.byKind['cross-task contract'], 1);
  assert.strictEqual(got.byKind['undecided behaviour'], 1);
});

test('a plan review with no transcript is unparsed, not a clean review', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items: [item('p1', 'plan review', 'capable')], sessions: ['s1'] }, projects);
  const walked = walkRuns([run], { since: null, until: null, fsImpl: fs });
  const got = collectPlanReview(walked, [[]], { roots: [projects], fsImpl: fs });
  assert.strictEqual(got.reviews, 0);
  assert.strictEqual(got.unparsed, 1);
  assert.strictEqual(got.withFindings, null);
  assert.strictEqual(got.findingsPerReview, null);
});

test('human stops: a SKIP line naming needs-human and a posted question is not a stop', () => {
  // A SKIP line records a plan review that did not run, so it is outside planReviewUnits and must never count as a stop.
  const SKIP = '- SKIP 10:00:00 — Common Step 1.6: condition: needs-human question posted on #9 earlier → fallback: no plan review. Reversibility: n/a.';
  assert.strictEqual(isHumanStop(SKIP), false);
});

test('human stops: the KEPT, REFUSED and POSTED forms count, a settled gap does not', () => {
  assert.strictEqual(isHumanStop(KEPT), true);
  assert.strictEqual(isHumanStop(REFUSED), true);
  assert.strictEqual(isHumanStop(POSTED), true);
  assert.strictEqual(isHumanStop(SETTLED), false);
  assert.strictEqual(isHumanStop(RELEASED), false);
  const pipelines = fresh('pl');
  const a = writeRun(pipelines, '2026-11-18T1-spec-1');
  const b = writeRun(pipelines, '2026-11-18T2-spec-2');
  const c = writeRun(pipelines, '2026-11-18T3-spec-3');
  writeDecisions(a.dir, `${KEPT}\n${SETTLED}\n`);
  writeDecisions(b.dir, `${SETTLED}\n${RELEASED}\n`);
  const walked = walkRuns([a, b, c], { since: null, until: null, fsImpl: fs });
  const got = collectPlanReview(walked, walked.map((w) => w.units.map((u) => readVerdicts(u, fs))), { roots: [], fsImpl: fs });
  assert.deepStrictEqual(got.humanStops, { runs: 1, n: 2, unparsed: 1, planReviewUnits: 2 });
});

test('human stops: planReviewUnits counts only the units whose log has a Common Step 1.6 line', () => {
  const pipelines = fresh('pl');
  const a = writeRun(pipelines, '2026-11-18T1-spec-1');
  const b = writeRun(pipelines, '2026-11-18T2-spec-2');
  const c = writeRun(pipelines, '2026-11-18T3-spec-3');
  writeDecisions(a.dir, `${KEPT}\n`);
  writeDecisions(b.dir, `${RELEASED}\n`);
  writeDecisions(c.dir, `${SETTLED}\n${RELEASED}\n`);
  const walked = walkRuns([a, b, c], { since: null, until: null, fsImpl: fs });
  const got = collectPlanReview(walked, walked.map((w) => w.units.map((u) => readVerdicts(u, fs))), { roots: [], fsImpl: fs });
  assert.deepStrictEqual(got.humanStops, { runs: 1, n: 3, unparsed: 0, planReviewUnits: 2 });
});

test('human stops: a unit whose only Common Step 1.6 line is a SKIP is not a unit with a plan review', () => {
  const pipelines = fresh('pl');
  const a = writeRun(pipelines, '2026-11-18T1-spec-1');
  const b = writeRun(pipelines, '2026-11-18T2-spec-2');
  writeDecisions(a.dir, '- SKIP 14:54:02 — Common Step 1.6 plan review (skipped): condition: ceremony-profile fast-lane → fallback: no plan review. Reversibility: n/a.\n');
  writeDecisions(b.dir, `${KEPT}\n`);
  const walked = walkRuns([a, b], { since: null, until: null, fsImpl: fs });
  const got = collectPlanReview(walked, walked.map((w) => w.units.map((u) => readVerdicts(u, fs))), { roots: [], fsImpl: fs });
  assert.deepStrictEqual(got.humanStops, { runs: 1, n: 2, unparsed: 0, planReviewUnits: 1 });
});

test('readVerdicts reads confirmed, refuted and cant-tell locations and the decisions text', () => {
  const dir = fresh('unit');
  const text = [
    'Reproduction: lens "correctness" finding a.js:1 reproduced',
    'x lens "tests" finding b.js:2 confirmed by tiebreak:0123456789ab',
    'x lens "tests" finding c.js:3 dropped: refuted by tiebreak',
    'Tiebreak tiebreak:0123456789ac: lens "docs" finding d.js:4 digested: verdict:cant-tell',
  ].join('\n');
  writeDecisions(dir, text);
  const got = readVerdicts({ name: 'u', dir }, fs);
  assert.strictEqual(got.excluded, null);
  assert.strictEqual(got.text, text);
  assert.deepStrictEqual(got.confirmed, [{ lens: 'correctness', path: 'a.js', line: 1, how: 'pair' }, { lens: 'tests', path: 'b.js', line: 2, how: 'tiebreak' }]);
  assert.strictEqual(got.refuted.length, 1);
  assert.strictEqual(got.cantTell.length, 1);
});

test('readVerdicts: no decisions.md is excluded with null text and no locations; no review line is excluded too', () => {
  const none = readVerdicts({ name: 'u', dir: fresh('unit') }, fs);
  assert.strictEqual(none.excluded, 'no-decisions');
  assert.strictEqual(none.text, null);
  assert.deepStrictEqual([none.confirmed, none.refuted, none.cantTell], [[], [], []]);
  const dir = fresh('unit');
  writeDecisions(dir, SETTLED);
  const quiet = readVerdicts({ name: 'u', dir }, fs);
  assert.strictEqual(quiet.excluded, 'no-review');
  assert.strictEqual(quiet.text, SETTLED);
});

test('AC7.1: a run at the top level and under archive/ is counted once', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  writeRun(pipelines, '2026-11-18T1-spec-1', { items: [item('t1', 'task review', 'capable')], sessions: ['s1'] }, projects);
  writeRun(path.join(pipelines, 'archive'), '2026-11-18T1-spec-1', { items: [item('t2', 'task review', 'capable')], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 't1', task('approved-unbolded'));
  writeReport(projects, 's1', 't2', task('approved-unbolded'));
  const got = taskFigures(pipelines, projects);
  assert.strictEqual(got.taskReview.byTier.capable.n, 1);
  assert.strictEqual(got.window.runs, 1);
});

test('a top-level stub reads its archived copy', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  fs.mkdirSync(path.join(pipelines, '2026-11-18T2-spec-2', 'work'), { recursive: true });
  writeRun(path.join(pipelines, 'archive'), '2026-11-18T2-spec-2', { items: [item('t1', 'task review', 'capable')], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 't1', task('approved-unbolded'));
  const runs = listRuns(pipelines).runs;
  const walked = walkRuns(runs, { since: null, until: null, fsImpl: fs });
  assert.strictEqual(walked[0].run.dir, path.join(pipelines, 'archive', '2026-11-18T2-spec-2'));
  assert.deepStrictEqual(walked[0].run, resolveRun(runs[0], fs));
  assert.strictEqual(taskFigures(pipelines, projects).taskReview.byTier.capable.n, 1);
});

test('a stub whose archived copy has decisions but no timing.json reads its decisions from the archive', () => {
  const pipelines = fresh('pl');
  fs.mkdirSync(path.join(pipelines, '2026-11-16T1-record-7', 'work'), { recursive: true });
  writeDecisions(path.join(pipelines, 'archive', '2026-11-16T1-record-7'), `${KEPT}\n`);
  const got = taskFigures(pipelines, fresh('pr'));
  assert.strictEqual(got.window.noTiming, 1);
  assert.deepStrictEqual(got.planReview.humanStops, { runs: 1, n: 1, unparsed: 0, planReviewUnits: 1 });
});

test('an agentId listed by two runs counts once', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  writeRun(pipelines, '2026-11-18T1-a', { items: [item('dup', 'task review', 'capable')], sessions: ['s1'] }, projects);
  writeRun(pipelines, '2026-11-18T2-b', { items: [item('dup', 'task review', 'capable')], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 'dup', task('approved-unbolded'));
  assert.strictEqual(taskFigures(pipelines, projects).taskReview.byTier.capable.n, 1);
});

test("a multi-spec run's dispatches are read once from the parent", () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  writeRun(pipelines, '2026-11-18T1-spec-1-2', { items: [item('t1', 'task review', 'capable'), item('t2', 'task review', 'capable')], sessions: ['s1'] }, projects);
  for (const id of [1, 2]) {
    fs.mkdirSync(path.join(pipelines, '2026-11-18T1-spec-1-2', `spec-${id}`), { recursive: true });
    fs.writeFileSync(path.join(pipelines, '2026-11-18T1-spec-1-2', `spec-${id}`, 'timing.json'), JSON.stringify(STUB));
  }
  writeReport(projects, 's1', 't1', task('approved-unbolded'));
  writeReport(projects, 's1', 't2', task('approved-unbolded'));
  const got = taskFigures(pipelines, projects);
  assert.strictEqual(got.taskReview.byTier.capable.n, 2);
  assert.strictEqual(got.window.units, 2);
  assert.strictEqual(got.window.timingUnparsed, 0);
  assert.strictEqual(got.window.noTiming, 0);
});

test('a run with no timing.json is counted, not dropped', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  writeRun(pipelines, '2026-11-18T1-spec-1', { items: [item('t1', 'task review', 'capable')], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 't1', task('approved-unbolded'));
  writeDecisions(path.join(pipelines, '2026-11-18T2-spec-2'), `${KEPT}\n`);
  fs.mkdirSync(path.join(pipelines, '2026-11-18T3-spec-3'), { recursive: true });
  fs.writeFileSync(path.join(pipelines, '2026-11-18T3-spec-3', 'timing.json'), '{');
  const got = taskFigures(pipelines, projects);
  assert.deepStrictEqual({ runs: got.window.runs, units: got.window.units, noTiming: got.window.noTiming, timingUnparsed: got.window.timingUnparsed }, { runs: 3, units: 3, noTiming: 1, timingUnparsed: 1 });
  assert.strictEqual(got.taskReview.byTier.capable.n, 1);
  assert.strictEqual(got.planReview.humanStops.runs, 1);
  assert.strictEqual(got.lens.unreadable, 1); // the `{` run counts; the no-timing run does not
});

test('--since/--until bound the runs read; a null since has no lower bound', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  for (const [name, id] of [['2026-11-16T1-spec-1', 'a'], ['2026-11-17T1-spec-2', 'b'], ['2026-11-19T1-spec-3', 'c']]) {
    writeRun(pipelines, name, { items: [item(id, 'task review', 'capable')], sessions: ['s1'] }, projects);
    writeReport(projects, 's1', id, task('approved-unbolded'));
  }
  const got = taskFigures(pipelines, projects, '2026-11-17', '2026-11-18');
  assert.strictEqual(got.taskReview.byTier.capable.n, 1);
  assert.strictEqual(got.window.runs, 1);
  assert.deepStrictEqual([got.window.since, got.window.until], ['2026-11-17', '2026-11-18']);
  const open = walkRuns(listRuns(pipelines).runs, { since: null, until: '2026-11-17', fsImpl: fs });
  assert.deepStrictEqual(open.map((w) => w.run.name), ['2026-11-16T1-spec-1', '2026-11-17T1-spec-2']);
});

test('a needs-fixes report whose three headings read None is in items.n and minorOnly.of, not minorOnly.count', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items: [item('n1', 'task review', 'capable'), item('n2', 'task review', 'capable')], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 'n1', '#### Critical\nNone.\n\n#### Important\nNone.\n\n#### Minor\nNone.\n\n**Task quality:** Needs fixes');
  writeReport(projects, 's1', 'n2', task('needs-fixes-minor-only'));
  const got = collectTaskReview(walkRuns([run], { since: null, until: null, fsImpl: fs }), { roots: [projects], fsImpl: fs }).byTier.capable;
  assert.strictEqual(got.items.n, 2);
  assert.deepStrictEqual(got.minorOnly, { count: 1, of: 2, share: 0.5 });
});

test('a needs-fixes report with no severity headings is in n and needsFixes, in items.unparsed and not items.n', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items: [item('u1', 'task review', 'capable')], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 'u1', 'The change drifts from the spec in two places.\n\n**Task quality:** Needs fixes');
  const got = collectTaskReview(walkRuns([run], { since: null, until: null, fsImpl: fs }), { roots: [projects], fsImpl: fs }).byTier.capable;
  assert.strictEqual(got.n, 1);
  assert.strictEqual(got.needsFixes, 1);
  assert.deepStrictEqual(got.items, { critical: 0, important: 0, minor: 0, n: 0, unparsed: 1 });
  assert.deepStrictEqual(got.minorOnly, { count: 0, of: 0, share: null });
});

test('a run resolved to its archive copy does not look for archive/archive/{name}', () => {
  const pipelines = fresh('pl');
  const name = '2026-11-18T2-spec-2';
  fs.mkdirSync(path.join(pipelines, name, 'work'), { recursive: true });
  writeRun(path.join(pipelines, 'archive'), name);
  writeDecisions(path.join(pipelines, 'archive', 'archive', name), `${KEPT}\n`);
  const got = taskFigures(pipelines, fresh('pr'));
  assert.deepStrictEqual(got.planReview.humanStops, { runs: 0, n: 0, unparsed: 1, planReviewUnits: 0 });
});

test('a top-level multi-spec run reads its members, never the archive copy of its decisions', () => {
  const pipelines = fresh('pl');
  const name = '2026-11-18T1-spec-1-2';
  const parent = writeRun(pipelines, name);
  for (const id of [1, 2]) writeDecisions(path.join(parent.dir, `spec-${id}`), `${SETTLED}\n`);
  writeDecisions(path.join(pipelines, 'archive', name), `${KEPT}\n`);
  const got = taskFigures(pipelines, fresh('pr'));
  assert.deepStrictEqual(got.planReview.humanStops, { runs: 0, n: 2, unparsed: 0, planReviewUnits: 2 });
});

test('a top-level run with its own decisions.md never reads the archive copy', () => {
  const pipelines = fresh('pl');
  const name = '2026-11-18T1-spec-1';
  const run = writeRun(pipelines, name);
  writeDecisions(run.dir, `${SETTLED}\n`);
  writeDecisions(path.join(pipelines, 'archive', name), `${KEPT}\n`);
  const got = taskFigures(pipelines, fresh('pr'));
  assert.deepStrictEqual(got.planReview.humanStops, { runs: 0, n: 1, unparsed: 0, planReviewUnits: 1 });
});

test("a KEPT-PROMPT line in a multi-spec parent's own decisions.md is ignored", () => {
  const pipelines = fresh('pl');
  const parent = writeRun(pipelines, '2026-11-18T1-spec-1-2');
  writeDecisions(parent.dir, `${KEPT}\n`);
  for (const id of [1, 2]) writeDecisions(path.join(parent.dir, `spec-${id}`), `${SETTLED}\n`);
  const got = taskFigures(pipelines, fresh('pr'));
  assert.deepStrictEqual(got.planReview.humanStops, { runs: 0, n: 2, unparsed: 0, planReviewUnits: 2 });
});

test('walkRuns sorts by date then name and reports timing state', () => {
  const pipelines = fresh('pl');
  const b = writeRun(pipelines, '2026-11-18T2-b');
  const a = writeRun(pipelines, '2026-11-18T1-a');
  const bare = runObj(pipelines, writeRun(pipelines, '2026-11-17T1-c').name);
  fs.rmSync(path.join(bare.dir, 'timing.json'));
  const walked = walkRuns([b, a, bare], { since: null, until: null, fsImpl: fs });
  assert.deepStrictEqual(walked.map((w) => [w.run.name, w.timing]), [['2026-11-17T1-c', 'missing'], ['2026-11-18T1-a', 'ok'], ['2026-11-18T2-b', 'ok']]);
  assert.deepStrictEqual(walked[0].items, []);
  assert.deepStrictEqual(walked[0].units, [{ name: '2026-11-17T1-c', dir: bare.dir }]);
});

// --- lens agents and per-run verdicts (Task 3) ---

const lensItem = (agentId, lensName, kind, tier) => item(agentId, 'lens reviewer', tier, `Lens ${lensName} ${kind}`);
const DECISIONS = readText(path.join(FIXTURES, 'decisions.md'));
const DECISION_LINES = DECISIONS.split('\n');
// A fixture line picked by a substring, so an edit to the shared fixture cannot silently re-point a test.
const decisionLine = (needle) => {
  const found = DECISION_LINES.filter((l) => l.includes(needle));
  assert.strictEqual(found.length, 1, `fixture line for ${needle}`);
  return found[0];
};
const lensFigures = (run, projects) => {
  const walked = walkRuns([run], { since: null, until: null, fsImpl: fs });
  return collectLensAgents(walked, { roots: [projects], fsImpl: fs });
};

function lensRun() {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const items = [lensItem('a1', '3a', 'convention A', 'fast'), lensItem('a2', '3a', 'convention B', 'fast'), lensItem('b1', '3b', 'security A', 'standard'), lensItem('b2', '3b', 'security B', 'standard')];
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items, sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 'a1', `${LENS_HEAD}| low | a.js:1 | x | y |\n| low | a.js:2 | x | y |`);
  writeReport(projects, 's1', 'a2', 'No findings.');
  writeReport(projects, 's1', 'b1', 'No findings.');
  writeReport(projects, 's1', 'b2', 'No findings.');
  return { pipelines, projects, run };
}

test('AC4.1: per-lens no-finding share and findings per agent', () => {
  const { run, projects } = lensRun();
  const got = lensFigures(run, projects);
  assert.deepStrictEqual({ agents: got.byLens['3a'].agents, n: got.byLens['3a'].n, unparsed: got.byLens['3a'].unparsed, noFinding: got.byLens['3a'].noFinding, total: got.byLens['3a'].perAgent.total }, { agents: 2, n: 2, unparsed: 0, noFinding: 0.5, total: 1 });
  assert.strictEqual(got.byLens['3b'].noFinding, 1);
  assert.strictEqual(got.byLens['3b'].perAgent.total, 0);
  assert.strictEqual(got.byTier.fast.perAgent.low, 1);
  assert.strictEqual(got.byTier.standard.agents, 2);
});

test('AC9.2: a lens reviewer whose transcript is missing is unparsed and in neither part of the share', () => {
  const { run, projects } = lensRun();
  const timing = JSON.parse(fs.readFileSync(path.join(run.dir, 'timing.json'), 'utf8'));
  timing.dispatches.items.push(lensItem('a3', '3a', 'convention C', 'fast'));
  fs.writeFileSync(path.join(run.dir, 'timing.json'), JSON.stringify(timing));
  const a = lensFigures(run, projects).byLens['3a'];
  assert.deepStrictEqual({ agents: a.agents, n: a.n, unparsed: a.unparsed, noFinding: a.noFinding }, { agents: 3, n: 2, unparsed: 1, noFinding: 0.5 });
});

test('AC9.1: a "No findings" opening followed by prose counts as no-finding for its agent', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items: [lensItem('c1', '3c', 'error handling A', 'fast')], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 'c1', lens('no-findings-then-prose'));
  const c = lensFigures(run, projects).byLens['3c'];
  assert.strictEqual(c.noFinding, 1);
  assert.strictEqual(c.unparsed, 0);
});

test('overflow rows count in overflow and in the per-agent total', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items: [lensItem('o1', '3d', 'x A', 'fast')], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 'o1', `${LENS_HEAD}| high | a.js:1 | x | y |\n| info | — | +3 more | — |`);
  const d = lensFigures(run, projects).byLens['3d'];
  assert.deepStrictEqual(d.perAgent, { total: 4, critical: 0, high: 1, medium: 0, low: 0, info: 0, overflow: 3 });
  assert.strictEqual(d.noFinding, 0);
});

test('the real decisions excerpt: confirmed, pair, tiebreak, refuted and can\'t-tell', () => {
  const pipelines = fresh('pl');
  const run = writeRun(pipelines, '2026-11-18T1-spec-1');
  writeDecisions(run.dir, DECISIONS);
  const walked = walkRuns([run], { since: null, until: null, fsImpl: fs });
  const got = collectPerRun(walked.map((w) => w.units.map((u) => readVerdicts(u, fs))));
  assert.deepStrictEqual(got.rows.map((r) => ({ confirmed: r.confirmed, pair: r.pair, tiebreak: r.tiebreak, refuted: r.refuted, cantTell: r.cantTell })), [{ confirmed: 5, pair: 3, tiebreak: 2, refuted: 1, cantTell: 1 }]);
  assert.deepStrictEqual(got.byLens['3a'], { confirmed: 2, pair: 1, tiebreak: 1, refuted: 1, cantTell: 0 });
  assert.strictEqual(got.byLens['3g'].cantTell, 1);
  assert.deepStrictEqual(got.totals, { confirmed: 5, pair: 3, tiebreak: 2, refuted: 1, cantTell: 1 });
  assert.deepStrictEqual([got.n, got.unparsed], [1, 0]);
});

test('AC5.1: one pair-confirmed, one tiebreak-confirmed, one refuted', () => {
  const pipelines = fresh('pl');
  const run = writeRun(pipelines, '2026-11-18T1-spec-1');
  writeDecisions(run.dir, [decisionLine('lens "3a" finding plugin/skills/release/disposition.md:71'), decisionLine('confirmed by tiebreak:2a37952f7854'), decisionLine('Tiebreak tiebreak:4e1515328d51')].join('\n') + '\n');
  const walked = walkRuns([run], { since: null, until: null, fsImpl: fs });
  const got = collectPerRun(walked.map((w) => w.units.map((u) => readVerdicts(u, fs))));
  const r = got.rows[0];
  assert.deepStrictEqual({ confirmed: r.confirmed, pair: r.pair, tiebreak: r.tiebreak, refuted: r.refuted, cantTell: r.cantTell }, { confirmed: 2, pair: 1, tiebreak: 1, refuted: 1, cantTell: 0 });
});

test('AC8.1: two spec members count two runs and none from the parent', () => {
  const pipelines = fresh('pl');
  const parent = writeRun(pipelines, '2026-11-18T1-spec-1-2');
  writeDecisions(parent.dir, `${decisionLine('lens "3b" finding plugin/skills/release/disposition.md:71')}\n`);
  const memberLines = [decisionLine('lens "3a" finding plugin/skills/release/disposition.md:71'), decisionLine('lens "3f" finding plugin/bin/release-block.js:181')];
  for (const id of [1, 2]) {
    const dir = path.join(parent.dir, `spec-${id}`);
    writeDecisions(dir, `${memberLines[id - 1]}\n`);
    fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(STUB));
    fs.writeFileSync(path.join(dir, 'review-findings.json'), '[]');
  }
  const walked = walkRuns(listRuns(pipelines).runs, { since: null, until: null, fsImpl: fs });
  const got = collectPerRun(walked.map((w) => w.units.map((u) => readVerdicts(u, fs))));
  assert.strictEqual(got.n, 2);
  assert.deepStrictEqual(got.rows.map((r) => r.run), ['2026-11-18T1-spec-1-2/spec-1', '2026-11-18T1-spec-1-2/spec-2']);
  assert.strictEqual(got.totals.confirmed, 2);
  assert.strictEqual(got.byLens['3b'], undefined);
});

test('a unit with no review lines is unparsed for the verdict figures, never zero', () => {
  const pipelines = fresh('pl');
  const a = writeRun(pipelines, '2026-11-18T1-spec-1');
  writeRun(pipelines, '2026-11-18T2-spec-2');
  writeDecisions(a.dir, '- AUTO 10:00:00 — Step 1: started. Reversibility: n/a.\n');
  const walked = walkRuns(listRuns(pipelines).runs, { since: null, until: null, fsImpl: fs });
  const got = collectPerRun(walked.map((w) => w.units.map((u) => readVerdicts(u, fs))));
  assert.deepStrictEqual({ n: got.n, unparsed: got.unparsed, rows: got.rows }, { n: 0, unparsed: 2, rows: [] });
});

test('lens agents come from the parent of a multi-spec run and honour the dedupe', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  writeRun(pipelines, '2026-11-18T0-earlier', { items: [lensItem('a1', '3a', 'convention A', 'fast')], sessions: ['s1'] }, projects);
  const parent = writeRun(pipelines, '2026-11-18T1-spec-1-2', { items: [lensItem('a1', '3a', 'convention A', 'fast'), lensItem('b1', '3b', 'security A', 'standard')], sessions: ['s1'] }, projects);
  for (const id of [1, 2]) {
    fs.mkdirSync(path.join(parent.dir, `spec-${id}`), { recursive: true });
    fs.writeFileSync(path.join(parent.dir, `spec-${id}`, 'timing.json'), JSON.stringify(STUB));
  }
  writeReport(projects, 's1', 'a1', 'No findings.');
  writeReport(projects, 's1', 'b1', 'No findings.');
  const walked = walkRuns(listRuns(pipelines).runs, { since: null, until: null, fsImpl: fs });
  const got = collectLensAgents(walked, { roots: [projects], fsImpl: fs });
  assert.strictEqual(got.byLens['3a'].agents, 1);
  assert.strictEqual(got.byLens['3b'].agents, 1);
  assert.deepStrictEqual(walked.map((w) => lensAgentsOf(w, fs).map((a) => a.agentId)), [['a1'], ['b1']]);
});

test("a top-level stub's lens agents are read from its archived copy", () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  fs.mkdirSync(path.join(pipelines, '2026-11-18T2-spec-2', 'work'), { recursive: true });
  writeRun(path.join(pipelines, 'archive'), '2026-11-18T2-spec-2', { items: [lensItem('a1', '3a', 'convention A', 'fast')], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 'a1', 'No findings.');
  const walked = walkRuns(listRuns(pipelines).runs, { since: null, until: null, fsImpl: fs });
  const a = collectLensAgents(walked, { roots: [projects], fsImpl: fs }).byLens['3a'];
  assert.deepStrictEqual({ agents: a.agents, n: a.n, noFinding: a.noFinding }, { agents: 1, n: 1, noFinding: 1 });
});

test('a lens dispatch with no agentId is kept and unparsed', () => {
  const pipelines = fresh('pl');
  const noId = lensItem(null, '3b', 'security A', 'standard');
  delete noId.agentId;
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items: [noId] });
  const got = lensFigures(run, fresh('pr'));
  const b = got.byLens['3b'];
  assert.deepStrictEqual({ agents: b.agents, n: b.n, unparsed: b.unparsed }, { agents: 1, n: 0, unparsed: 1 });
  assert.strictEqual(got.byTier.standard.agents, 1);
  assert.strictEqual(b.perAgent, null);
  assert.strictEqual(b.noFinding, null);
});

test('a lens agentId listed twice in one timing.json counts once', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items: [lensItem('a1', '3a', 'convention A', 'fast'), lensItem('a1', '3a', 'convention A', 'fast')], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 'a1', 'No findings.');
  const walked = walkRuns([run], { since: null, until: null, fsImpl: fs });
  assert.deepStrictEqual(lensAgentsOf(walked[0], fs).map((a) => a.agentId), ['a1']);
  assert.strictEqual(lensFigures(run, projects).byLens['3a'].agents, 1);
});

test('lens items with no agentId take their own tier by order, past a non-lens item, and no tier is unknown', () => {
  const pipelines = fresh('pl');
  const anon = (role, tier, description) => {
    const d = item('x', role, tier, description);
    delete d.agentId;
    if (tier === undefined) delete d.tier;
    return d;
  };
  const items = [anon('task review', 'capable', 'Task 1: x'), anon('lens reviewer', 'fast', 'Lens 3a convention A'), anon('lens reviewer', 'standard', 'Lens 3b security A'), anon('lens reviewer', undefined, 'Lens 3c error handling A')];
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items });
  const walked = walkRuns([run], { since: null, until: null, fsImpl: fs });
  assert.deepStrictEqual(lensAgentsOf(walked[0], fs).map((a) => [a.lens, a.tier]), [['3a', 'fast'], ['3b', 'standard'], ['3c', 'unknown']]);
});

test('a null entry in dispatches.items makes the run unreadable for the lens figures, never zero, and never throws', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items: [null, lensItem('a1', '3a', 'convention A', 'fast')], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 'a1', 'No findings.');
  const walked = walkRuns([run], { since: null, until: null, fsImpl: fs });
  assert.strictEqual(walked[0].timing, 'ok');
  assert.deepStrictEqual(lensAgentsOf(walked[0], fs), []);
  const got = collectLensAgents(walked, { roots: [projects], fsImpl: fs });
  assert.strictEqual(got.unreadable, 1);
  assert.deepStrictEqual(got.byLens, {});
  assert.strictEqual(taskFigures(pipelines, projects).lens.unreadable, 1);
});

test('a run whose timing.json is not valid JSON is unreadable for the lens figures; a run with no timing.json is not', () => {
  const pipelines = fresh('pl');
  const bad = writeRun(pipelines, '2026-11-18T1-spec-1');
  fs.writeFileSync(path.join(bad.dir, 'timing.json'), '{ not json');
  const none = writeRun(pipelines, '2026-11-18T2-spec-2');
  fs.rmSync(path.join(none.dir, 'timing.json'));
  const walked = walkRuns([bad, none], { since: null, until: null, fsImpl: fs });
  assert.deepStrictEqual(walked.map((w) => w.timing), ['unparsed', 'missing']);
  assert.strictEqual(collectLensAgents([walked[0]], { roots: [], fsImpl: fs }).unreadable, 1);
  assert.strictEqual(collectLensAgents([walked[1]], { roots: [], fsImpl: fs }).unreadable, 0);
});

test('collectReviews adds lens: { byTier, byLens, unreadable, perRun, outcomes, yield }', () => {
  const { pipelines, projects } = lensRun();
  const got = taskFigures(pipelines, projects);
  assert.deepStrictEqual(Object.keys(got.lens), ['byTier', 'byLens', 'unreadable', 'perRun', 'outcomes', 'yield']);
  assert.strictEqual(got.lens.unreadable, 0);
  assert.strictEqual(got.lens.byLens['3a'].agents, 2);
  assert.strictEqual(got.lens.perRun.unparsed, 1);
});

// --- lens outcomes and the per-lens yield (Task 4) ---

// The outcome figures of one decisions.md text read as one unit.
function outcomesOf(text) {
  const dir = fresh('unit');
  writeDecisions(dir, text);
  return collectOutcomes([[readVerdicts({ name: 'u', dir }, fs)]]);
}
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

test('classifyRouting reads the four real classes', () => {
  assert.strictEqual(classifyRouting('- AUTO 16:20:58 — Step 3 Routing: applied medium-severity security fix at plugin/skills/release/disposition.md:71. Reversibility: high (commit e4ce36e0c).'), 'fixed');
  assert.strictEqual(classifyRouting(decisionLine('16:21:21')), 'staged');
  assert.strictEqual(classifyRouting('- AUTO 23:31:55 — Step 3 Routing: materiality-floor: Test quality at tests/bin-lib/wrap-up/engine-cli.test.js:707 routed below floor (tiebreak-cant-tell) → digest. Reversibility: high.'), 'deferred');
  assert.strictEqual(classifyRouting("- AUTO 07:05:57 — Step 3 Routing: Don't fix (refuted by tiebreak): low Architecture at plugin/bin/lib/hooks/worktree-reap.js:91 — three existing tests already fail on a quiet-set rename. Reversibility: high."), 'dismissed');
  assert.strictEqual(classifyRouting('- AUTO 18:09:05 — Review Console: Console item review-contested-1.md (Contested findings): dismissed — superseded. Reversibility: n/a.'), null);
  assert.strictEqual(classifyRouting(decisionLine('16:08:35')), null);
});

test('classifyRouting reads each alternative of the deferred and dismissed patterns', () => {
  assert.strictEqual(classifyRouting('- AUTO 23:40:12 — Step 3 Routing: low Test quality at tests/bin-lib/wrap-up/engine-cli.test.js:707 routed to digest. Reversibility: high.'), 'deferred');
  assert.strictEqual(classifyRouting('- AUTO 07:12:30 — Step 3 Routing: low Architecture at plugin/bin/lib/hooks/worktree-reap.js:91 → declined: not worth a change. Reversibility: high.'), 'dismissed');
  assert.strictEqual(classifyRouting('- AUTO 07:13:02 — Step 3 Routing: low Architecture at plugin/bin/lib/hooks/worktree-reap.js:91 not fixed: existing behaviour. Reversibility: high.'), 'dismissed');
});

test('AC10.1: one fixed, one staged and one unrouted location print 50%, 50% and one unrouted', () => {
  const text = ['release-block.js:181 reproduced', 'release-block.md:3 confirmed by tiebreak', 'release-block-cli.test.js:413', '16:21:01', '16:21:21'].map(decisionLine).join('\n');
  const got = outcomesOf(text);
  assert.deepStrictEqual(pick(got, ['fixed', 'staged', 'dismissed', 'deferred', 'unrouted', 'n']), { fixed: 0.5, staged: 0.5, dismissed: 0, deferred: 0, unrouted: 1, n: 2 });
  assert.deepStrictEqual(pick(got.allRouted, ['fixed', 'staged', 'dismissed', 'deferred', 'n']), { fixed: 0.5, staged: 0.5, dismissed: 0, deferred: 0, n: 2 });
});

test("the real decisions excerpt's outcomes", () => {
  const got = outcomesOf(DECISIONS);
  assert.deepStrictEqual(got.counts, { fixed: 2, staged: 1, deferred: 0, dismissed: 0 });
  assert.strictEqual(got.unrouted, 1);
  assert.strictEqual(got.n, 3);
  assert.strictEqual(got.unparsed, 0);
});

test('allRouted divides by every routed location, refuted ones included', () => {
  const got = outcomesOf(DECISIONS);
  assert.deepStrictEqual(got.allRouted.counts, { fixed: 2, staged: 1, deferred: 0, dismissed: 1 });
  assert.strictEqual(got.allRouted.n, 4);
  assert.strictEqual(got.allRouted.dismissed, 0.25);
  assert.strictEqual(got.dismissed, 0);
});

test('with nothing routed the shares are null, and an excluded unit is unparsed', () => {
  const none = outcomesOf(decisionLine('lens "3a" finding plugin/skills/release/disposition.md:71'));
  assert.deepStrictEqual(pick(none, ['fixed', 'n', 'unrouted']), { fixed: null, n: 0, unrouted: 1 });
  assert.deepStrictEqual(pick(none.allRouted, ['fixed', 'n']), { fixed: null, n: 0 });
  const got = collectOutcomes([[readVerdicts({ name: 'u', dir: fresh('unit') }, fs)]]);
  assert.deepStrictEqual(pick(got, ['n', 'unparsed']), { n: 0, unparsed: 1 });
});

test("a location's first class by precedence wins", () => {
  const text = [
    'Reproduction: lens "3a" finding a.js:1 reproduced. Confirmed.',
    "- AUTO 10:00:00 — Step 3 Routing: Don't fix (refuted by tiebreak): low X at a.js:1 — nope. Reversibility: high.",
    '- AUTO 10:00:05 — Step 3 Routing: applied low-severity fix at a.js:1. Reversibility: high (commit abc1234).',
  ].join('\n');
  const got = outcomesOf(text);
  assert.deepStrictEqual(got.counts, { fixed: 1, staged: 0, deferred: 0, dismissed: 0 });
});

test('a confirmed location routed only as deferred, and another only as dismissed, count in deferred and dismissed', () => {
  const text = [
    'Reproduction: lens "3a" finding a.js:1 reproduced. Confirmed.',
    'Reproduction: lens "3a" finding b.js:2 reproduced. Confirmed.',
    '- AUTO 10:00:07 — Step 3 Routing: materiality-floor: Test quality at a.js:1 routed below floor → digest. Reversibility: high.',
    "- AUTO 10:00:09 — Step 3 Routing: Don't fix (refuted by tiebreak): low X at b.js:2 — nope. Reversibility: high.",
  ].join('\n');
  const got = outcomesOf(text);
  assert.deepStrictEqual(got.counts, { fixed: 0, staged: 0, deferred: 1, dismissed: 1 });
  assert.deepStrictEqual(pick(got, ['deferred', 'dismissed', 'unrouted', 'n']), { deferred: 0.5, dismissed: 0.5, unrouted: 0, n: 2 });
});

test('precedence, not line order: an applied line then a Don\'t fix line is fixed, a staged line then a deferred one is staged', () => {
  const confirmed = 'Reproduction: lens "3a" finding a.js:1 reproduced. Confirmed.';
  const applied = '- AUTO 10:00:05 — Step 3 Routing: applied low-severity fix at a.js:1. Reversibility: high (commit abc1234).';
  const dismissed = "- AUTO 10:00:00 — Step 3 Routing: Don't fix (refuted by tiebreak): low X at a.js:1 — nope. Reversibility: high.";
  const staged = '- STAGED 10:00:06 — Step 3 Routing: medium-severity architecture finding at a.js:1: x. Stage path: staged/b-1.md. Reversibility: high.';
  const deferred = '- AUTO 10:00:07 — Step 3 Routing: materiality-floor: Test quality at a.js:1 routed below floor → digest. Reversibility: high.';
  assert.deepStrictEqual(outcomesOf([confirmed, applied, dismissed].join('\n')).counts, { fixed: 1, staged: 0, deferred: 0, dismissed: 0 });
  assert.deepStrictEqual(outcomesOf([confirmed, staged, deferred].join('\n')).counts, { fixed: 0, staged: 1, deferred: 0, dismissed: 0 });
});

// A run `name` with `agents` 3a lens agents (and one 3b agent when `with3b`) and `confirms` 3a confirmed lines in its decisions.
const threeA = (n) => Array.from({ length: n }, (_, i) => `- AUTO 10:00:0${i} — Reproduction: lens "3a" finding f${i}.js:${i + 1} reproduced. Confirmed. Reversibility: high.`).join('\n') + '\n';
function yieldRun(pipelines, name, { agents = 2, confirms = 0, text, with3b = false }) {
  const items = [...Array.from({ length: agents }, (_, i) => lensItem(`${name}-a${i}`, '3a', `convention ${i}`, 'fast')), ...(with3b ? [lensItem(`${name}-b`, '3b', 'security A', 'standard')] : [])];
  const run = writeRun(pipelines, name, { items });
  writeDecisions(run.dir, text === undefined ? threeA(confirms) : text);
  return run;
}
const yieldOf = (pipelines, n, until = null) => collectYield(walkRuns(listRuns(pipelines).runs, { since: null, until, fsImpl: fs }), { n, fsImpl: fs });
function ac61(pipelines, with3b = false) {
  yieldRun(pipelines, '2026-11-16T1-spec-1', { confirms: 4, with3b });
  yieldRun(pipelines, '2026-11-17T1-spec-2', { confirms: 1, with3b });
  yieldRun(pipelines, '2026-11-18T1-spec-3', { confirms: 2, with3b });
}

test('AC6.1: --runs 2 uses the two latest runs in which the lens ran', () => {
  const pipelines = fresh('pl');
  ac61(pipelines);
  assert.deepStrictEqual(yieldOf(pipelines, 2, '2026-11-18').byLens['3a'], { runs: 2, agents: 4, confirmed: 3, rate: 0.75, unparsed: 0 });
  assert.strictEqual(yieldOf(pipelines, 3, '2026-11-18').byLens['3a'].rate, 7 / 6);
});

test('the yield ignores --since and stops at --until', () => {
  const pipelines = fresh('pl');
  ac61(pipelines);
  yieldRun(pipelines, '2026-11-20T1-spec-9', { confirms: 5 });
  const got = collectReviews({ runs: listRuns(pipelines).runs, since: '2026-11-18', until: '2026-11-18', n: 2, roots: [] }, { fsImpl: fs });
  const a = got.lens.yield.byLens['3a'];
  assert.deepStrictEqual(pick(a, ['runs', 'agents', 'confirmed', 'rate']), { runs: 2, agents: 4, confirmed: 3, rate: 0.75 });
  assert.strictEqual(got.lens.perRun.n, 1);
});

test('an unreadable run takes no yield slot and counts unparsed', () => {
  const pipelines = fresh('pl');
  ac61(pipelines);
  yieldRun(pipelines, '2026-11-19T1-spec-4', { text: '- AUTO 10:00:00 — Step 1: started. Reversibility: n/a.\n' });
  assert.deepStrictEqual(yieldOf(pipelines, 2).byLens['3a'], { runs: 2, agents: 4, confirmed: 3, rate: 0.75, unparsed: 1 });
});

test('a run with no timing.json counts unparsed for a lens it shows ran, and is passed over for one it does not', () => {
  const pipelines = fresh('pl');
  ac61(pipelines, true);
  writeDecisions(path.join(pipelines, '2026-11-19T2-spec-5'), 'Reproduction: lens "3a" finding a.js:1 reproduced. Confirmed.\n');
  const got = yieldOf(pipelines, 2).byLens;
  assert.deepStrictEqual(pick(got['3a'], ['runs', 'agents', 'confirmed', 'unparsed']), { runs: 2, agents: 4, confirmed: 3, unparsed: 1 });
  assert.deepStrictEqual(got['3b'], { runs: 2, agents: 2, confirmed: 0, rate: 0, unparsed: 0 });
});

test('runs with no usable timing.json or with unreadable lens agents, older than the filled slots, add no unparsed', () => {
  const pipelines = fresh('pl');
  ac61(pipelines);
  writeDecisions(path.join(pipelines, '2026-11-10T1-spec-7'), threeA(1));
  const bad = writeRun(pipelines, '2026-11-11T1-spec-8', { items: [null, lensItem('c', '3a', 'convention A', 'fast')] });
  writeDecisions(bad.dir, threeA(1));
  assert.deepStrictEqual(yieldOf(pipelines, 2).byLens['3a'], { runs: 2, agents: 4, confirmed: 3, rate: 0.75, unparsed: 0 });
});

test('a lens only a run with no usable timing.json records a verdict for appears with no agents and its unparsed count', () => {
  const pipelines = fresh('pl');
  ac61(pipelines);
  writeDecisions(path.join(pipelines, '2026-11-19T2-spec-5'), 'Reproduction: lens "9z" finding a.js:1 reproduced. Confirmed.\n');
  assert.deepStrictEqual(yieldOf(pipelines, 2).byLens['9z'], { runs: 0, agents: 0, confirmed: 0, rate: null, unparsed: 1 });
});

test('a run whose timing.json cannot be parsed counts unparsed for a lens its decisions show ran', () => {
  const pipelines = fresh('pl');
  ac61(pipelines);
  const dir = path.join(pipelines, '2026-11-19T3-spec-6');
  writeDecisions(dir, threeA(1));
  fs.writeFileSync(path.join(dir, 'timing.json'), '{');
  const walked = walkRuns(listRuns(pipelines).runs, { since: null, until: null, fsImpl: fs });
  assert.strictEqual(walked[walked.length - 1].timing, 'unparsed');
  assert.deepStrictEqual(collectYield(walked, { n: 2, fsImpl: fs }).byLens['3a'], { runs: 2, agents: 4, confirmed: 3, rate: 0.75, unparsed: 1 });
});

test('collectYield throws a TypeError when n is not a positive integer', () => {
  for (const bad of [undefined, 0, -1, 1.5, '2', NaN]) assert.throws(() => collectYield([], { n: bad }), TypeError);
  assert.throws(() => collectYield([]), TypeError);
  assert.throws(() => collectReviews({ runs: [], since: null, until: null, roots: [] }, { fsImpl: fs }), TypeError);
});

test('a run whose lens agents are unreadable is unparsed for every lens, never zero agents', () => {
  const pipelines = fresh('pl');
  ac61(pipelines, true);
  const bad = writeRun(pipelines, '2026-11-19T1-spec-4', { items: [null, lensItem('c', '3a', 'convention A', 'fast')] });
  writeDecisions(bad.dir, threeA(1));
  const got = yieldOf(pipelines, 2).byLens;
  assert.deepStrictEqual(pick(got['3a'], ['runs', 'agents', 'confirmed', 'unparsed']), { runs: 2, agents: 4, confirmed: 3, unparsed: 1 });
  assert.strictEqual(got['3b'].unparsed, 1);
});

test('a multi-spec run is one yield slot, readable only when every member is', () => {
  const pipelines = fresh('pl');
  const parent = writeRun(pipelines, '2026-11-18T1-spec-1-2', { items: [lensItem('a0', '3a', 'convention A', 'fast'), lensItem('a1', '3a', 'convention B', 'fast')] });
  for (const [id, confirms] of [[1, 1], [2, 2]]) {
    const dir = path.join(parent.dir, `spec-${id}`);
    writeDecisions(dir, threeA(confirms));
    fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(STUB));
  }
  assert.deepStrictEqual(pick(yieldOf(pipelines, 2).byLens['3a'], ['runs', 'agents', 'confirmed']), { runs: 1, agents: 2, confirmed: 3 });
  fs.rmSync(path.join(parent.dir, 'spec-2', 'decisions.md'));
  assert.deepStrictEqual(yieldOf(pipelines, 2).byLens['3a'], { runs: 0, agents: 0, confirmed: 0, rate: null, unparsed: 1 });
});

test('a lens with no agents is absent; an empty window gives an empty byLens', () => {
  const pipelines = fresh('pl');
  ac61(pipelines);
  assert.deepStrictEqual(Object.keys(yieldOf(pipelines, 2).byLens), ['3a']);
  assert.deepStrictEqual(collectYield([], { n: 20 }), { runs: 20, byLens: {} });
});

// --- the reviews section through the CLI (Task 5) ---

const { run: cliRun } = require(path.join(ROOT, 'tools', 'pipeline-cost-report.js'));

function cliDeps(extra = {}) {
  const logs = [];
  const errs = [];
  const main = fresh('main');
  const deps = {
    gh: (args) => (args[0] === 'repo' ? 'o/r\n' : args[0] === 'api' ? '0\n' : '[]'),
    check: async () => '{"admitted":true,"reasons":[]}',
    now: () => new Date('2026-11-19T12:00:00Z'),
    pluginVersion: () => '9.9.9',
    git: () => path.join(main, '.git'),
    cwd: ROOT,
    home: fresh('home'),
    log: (s) => logs.push(s),
    err: (s) => errs.push(s),
    ...extra,
  };
  return { deps, logs, errs };
}
async function reviewsCli(pipelines, projects, flags = [], extra = {}) {
  const h = cliDeps(extra);
  const code = await cliRun({ argv: ['--section', 'reviews', '--since', '2026-11-18', '--until', '2026-11-18', '--pipelines', pipelines, '--projects', projects, '--repo', 'o/r', ...flags], deps: h.deps });
  return { code, text: h.logs.join('\n'), errs: h.errs.join('\n') };
}

test('AC1.1 markdown: 75% needing fixes and 1 of 3 Minor only', async () => {
  const { pipelines, projects } = fourTaskReviews();
  const got = await reviewsCli(pipelines, projects);
  assert.strictEqual(got.code, 0, got.errs);
  assert.match(got.text, /^\| capable \| 4 \| 25% \| 75% \|.*\| 1 of 3 \|/m);
  assert.ok(got.text.includes('| 1 of 3 | 0; items 0 |'), got.text);
  assert.ok(got.text.includes('1 runs dated 2026-11-18 to 2026-11-18 (1 run units: a multi-spec run counts once per spec member for the verdict figures); 0 without a timing.json, 0 with an unreadable one.'), got.text);
  assert.ok(got.text.includes('Re-reviews (not in the table): 0.'), got.text);
});

test('AC3.1 markdown', async () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  writeRun(pipelines, '2026-11-18T1-spec-1', { items: [item('p1', 'plan review', 'capable'), item('p2', 'plan review', 'capable')], sessions: ['s1'] }, projects);
  const rows = ['| Severity | Class | Resolution | Path:Line | Finding | Evidence | Suggested resolution |', '|---|---|---|---|---|---|---|', '| high | spec gap | — | a.md:1 | f | e | s |', '| medium | cross-task contract | — | a.md:2 | f | e | s |', '| low | undecided behaviour | — | a.md:3 | f | e | s |'];
  writeReport(projects, 's1', 'p1', rows.join('\n'));
  writeReport(projects, 's1', 'p2', 'No findings.');
  writeDecisions(path.join(pipelines, '2026-11-18T1-spec-1'), `${KEPT}\n${threeA(1)}`);
  const got = await reviewsCli(pipelines, projects);
  assert.ok(got.text.includes('Reviews: 2; with a finding: 50%; findings per review: 1.50; unparsed: 0.'), got.text);
  assert.ok(got.text.includes('Stopped to ask a human: 1 of 1 run units with a plan review (1 readable, 0 unparsed).'), got.text);
  assert.ok(got.text.includes('| spec gap | 1 |'), got.text);
  assert.ok(got.text.indexOf('| cross-task contract | 1 |') < got.text.indexOf('| spec gap | 1 |'), 'PLAN_KINDS order');
  assert.ok(got.text.includes('| other | 0 |'), got.text);
});

test('AC4.1 markdown: lens rows per lens, the profile note under the tier table', async () => {
  const { pipelines, projects } = lensRun();
  const got = await reviewsCli(pipelines, projects);
  assert.match(got.text, /^\| 3a \| 2 \| 50% \| 1\.00 \|.*\| 0 \|$/m);
  assert.match(got.text, /^\| 3b \| 2 \| 100% \| 0\.00 \|.*\| 0 \|$/m);
  assert.match(got.text, /### Lens review by tier\n\nEach lens runs on one fixed model profile, so this table compares lenses, not models\./);
  assert.ok(got.text.indexOf('| fast |') < got.text.indexOf('| standard |'), 'tiers ordered fast first');
  assert.ok(got.text.includes('0 runs with unreadable lens dispatches, counted in no lens figure.'), got.text);
});

test('a run whose lens dispatches cannot be read prints the unreadable line, never zero agents', async () => {
  const pipelines = fresh('pl');
  const bad = writeRun(pipelines, '2026-11-18T1-spec-1', { items: [null, lensItem('c', '3a', 'convention A', 'fast')] });
  writeDecisions(bad.dir, threeA(1));
  yieldRun(pipelines, '2026-11-18T2-spec-2', { agents: 2, confirms: 2 });
  const got = await reviewsCli(pipelines, fresh('pr'), ['--json']);
  assert.strictEqual(got.code, 0, got.errs);
  const r = JSON.parse(got.text).reviews;
  assert.strictEqual(r.lens.unreadable, 1);
  assert.strictEqual(r.lens.perRun.unparsed, 1);
  assert.strictEqual(r.lens.perRun.n, 1);
  assert.strictEqual(r.lens.perRun.totals.confirmed, 2);
  assert.strictEqual(r.lens.outcomes.unparsed, 1);
  assert.strictEqual(r.planReview.humanStops.n, 2);
  assert.strictEqual(r.window.runs, 2);
  assert.strictEqual(r.lens.byLens['3a'].agents, 2);
  const md = await reviewsCli(pipelines, fresh('pr'));
  assert.strictEqual(md.code, 0, md.errs);
  assert.ok(md.text.includes('1 runs with unreadable lens dispatches, counted in no lens figure.'), md.text);
  assert.ok(md.text.includes('Run units read: 1; unparsed: 1.'), md.text);
});

test('readVerdicts: a unit whose timing.json readRun throws on is excluded timing-unreadable, text kept', () => {
  const dir = fresh('unit');
  fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify({ dispatches: { items: [null] } }));
  writeDecisions(dir, threeA(1));
  const v = readVerdicts({ name: 'u', dir }, fs);
  assert.deepStrictEqual([v.excluded, v.confirmed, v.refuted, v.cantTell], ['timing-unreadable', [], [], []]);
  assert.strictEqual(v.text, threeA(1));
  assert.deepStrictEqual(collectPerRun([[v]]).unparsed, 1);
  assert.strictEqual(collectOutcomes([[v]]).unparsed, 1);
});

test('a multi-spec yield run with a member whose timing.json readRun cannot read takes no slot and counts unparsed', () => {
  const pipelines = fresh('pl');
  const parent = writeRun(pipelines, '2026-11-18T1-spec-1-2', { items: [lensItem('a0', '3a', 'convention A', 'fast')] });
  for (const id of [1, 2]) writeDecisions(path.join(parent.dir, `spec-${id}`), threeA(1));
  fs.writeFileSync(path.join(parent.dir, 'spec-1', 'timing.json'), JSON.stringify({ dispatches: { items: [null] } }));
  fs.writeFileSync(path.join(parent.dir, 'spec-2', 'timing.json'), JSON.stringify(STUB));
  assert.deepStrictEqual(yieldOf(pipelines, 2).byLens['3a'], { runs: 0, agents: 0, confirmed: 0, rate: null, unparsed: 1 });
});

test('a verdict-line lens name led by a lens id counts under the id; any other name is kept verbatim', () => {
  const dir = fresh('unit');
  writeDecisions(dir, [
    'Reproduction: lens "3b Security" finding a.js:1 reproduced. Confirmed.',
    'Reproduction: lens "delta" finding b.js:2 reproduced. Confirmed.',
    'Reproduction: lens "3bx" finding c.js:3 reproduced. Confirmed.',
    '- AUTO 10:00:00 — lens "3c: errors" finding d.js:4 dropped: refuted by tiebreak:aaaaaaaaaaaa.',
  ].join('\n'));
  const v = readVerdicts({ name: 'u', dir }, fs);
  assert.deepStrictEqual(v.confirmed.map((c) => c.lens), ['3b', 'delta', '3bx']);
  assert.deepStrictEqual(v.refuted.map((c) => c.lens), ['3c']);
});

test('the yield counts a timing-less run naming "3b Security" under 3b, and keeps "delta" as its own lens', () => {
  const pipelines = fresh('pl');
  ac61(pipelines, true);
  writeDecisions(path.join(pipelines, '2026-11-19T2-spec-5'), 'Reproduction: lens "3b Security" finding a.js:1 reproduced. Confirmed.\nReproduction: lens "delta" finding b.js:2 reproduced. Confirmed.\n');
  const got = yieldOf(pipelines, 2).byLens;
  assert.strictEqual(got['3b'].unparsed, 1);
  assert.ok(!('3b Security' in got), Object.keys(got).join(','));
  assert.deepStrictEqual(got.delta, { runs: 0, agents: 0, confirmed: 0, rate: null, unparsed: 1 });
});

test('a lens named by its word folds to its id, whatever the case, hyphens or spaces; an unknown name stays verbatim', () => {
  const dir = fresh('unit');
  writeDecisions(dir, [
    'Reproduction: lens "architecture" finding a.js:1 reproduced. Confirmed.',
    'Reproduction: lens "Test quality" finding b.js:2 reproduced. Confirmed.',
    'Reproduction: lens "Error handling" finding c.js:3 reproduced. Confirmed.',
    'Reproduction: lens "error-handling" finding d.js:4 reproduced. Confirmed.',
    'Reproduction: lens "Ownability" finding e.js:5 reproduced. Confirmed.',
    'Reproduction: lens "gap-sweep" finding f.js:6 reproduced. Confirmed.',
    '- AUTO 10:00:00 — lens "security" finding g.js:7 dropped: refuted by tiebreak:aaaaaaaaaaaa.',
  ].join('\n'));
  const v = readVerdicts({ name: 'u', dir }, fs);
  assert.deepStrictEqual(v.confirmed.map((c) => c.lens), ['3e', '3f', '3c', '3c', '3g', 'gap-sweep']);
  assert.deepStrictEqual(v.refuted.map((c) => c.lens), ['3b']);
});

test('lensIdOf resolves every lens-name table entry, in any case and with spaces for hyphens', () => {
  const expected = {
    convention: '3a', 'convention-compliance': '3a', security: '3b', 'error-handling': '3c', performance: '3d',
    architecture: '3e', 'test-quality': '3f', ownability: '3g', 'ux-analysis': '3h',
  };
  for (const [name, id] of Object.entries(expected)) {
    assert.strictEqual(lensIdOf(name), id, name);
    assert.strictEqual(lensIdOf(name.toUpperCase().replace(/-/g, ' ')), id, name);
  }
});

test('lensIdOf keeps an inherited object key verbatim', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.strictEqual(lensIdOf(name), name);
});

test('the yield and the per-run rows count a word-named verdict under its lens id', () => {
  const pipelines = fresh('pl');
  ac61(pipelines, true);
  writeDecisions(path.join(pipelines, '2026-11-19T2-spec-5'), 'Reproduction: lens "architecture" finding a.js:1 reproduced. Confirmed.\n');
  const got = yieldOf(pipelines, 2).byLens;
  assert.strictEqual(got['3e'].unparsed, 1);
  assert.ok(!('architecture' in got), Object.keys(got).join(','));
});

test('the human-stop line is a rate over the run units with a plan review', async () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  writeRun(pipelines, '2026-11-18T1-spec-1', { items: [item('p1', 'plan review', 'capable')], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 'p1', 'No findings.');
  writeRun(pipelines, '2026-11-18T2-adhoc-2');
  writeRun(pipelines, '2026-11-18T3-adhoc-3');
  writeDecisions(path.join(pipelines, '2026-11-18T1-spec-1'), `${KEPT}\n${threeA(1)}`);
  writeDecisions(path.join(pipelines, '2026-11-18T2-adhoc-2'), `${RELEASED}\n${threeA(1)}`);
  const got = await reviewsCli(pipelines, projects);
  assert.ok(got.text.includes('Stopped to ask a human: 1 of 1 run units with a plan review (2 readable, 1 unparsed).'), got.text);
});

test('AC10.1 markdown', async () => {
  const pipelines = fresh('pl');
  const run = writeRun(pipelines, '2026-11-18T1-spec-1');
  writeDecisions(run.dir, ['release-block.js:181 reproduced', 'release-block.md:3 confirmed by tiebreak', 'release-block-cli.test.js:413', '16:21:01', '16:21:21'].map(decisionLine).join('\n'));
  const got = await reviewsCli(pipelines, fresh('pr'));
  assert.ok(got.text.includes('Of 2 routed confirmed locations: fixed 50%, dismissed 0%, staged 50%, deferred 0%; 1 unrouted (left out of the shares); 0 run units unparsed.'), got.text);
  assert.ok(got.text.includes("Of 2 routed locations, refuted ones included (the 2026-11-18 measurement's division): fixed 50%, dismissed 0%, staged 50%, deferred 0%."), got.text);
  assert.ok(got.text.indexOf('Of 2 routed confirmed') < got.text.indexOf('Of 2 routed locations'), 'confirmed line first');
});

test('with nothing routed the outcome shares print none, never 0%', async () => {
  const pipelines = fresh('pl');
  const run = writeRun(pipelines, '2026-11-18T1-spec-1');
  writeDecisions(run.dir, decisionLine('lens "3a" finding plugin/skills/release/disposition.md:71'));
  const got = await reviewsCli(pipelines, fresh('pr'));
  assert.ok(got.text.includes('Of 0 routed confirmed locations: fixed none, dismissed none, staged none, deferred none; 1 unrouted'), got.text);
});

test('AC6.1 --json: the 3a rate uses the two latest runs, whatever --since says', async () => {
  const pipelines = fresh('pl');
  ac61(pipelines);
  const got = await reviewsCli(pipelines, fresh('pr'), ['--runs', '2', '--json']);
  assert.strictEqual(got.code, 0, got.errs);
  const y = JSON.parse(got.text).reviews.lens.yield;
  assert.deepStrictEqual(y, { runs: 2, byLens: { '3a': { runs: 2, agents: 4, confirmed: 3, rate: 0.75, unparsed: 0 } } });
  const md = await reviewsCli(pipelines, fresh('pr'), ['--runs', '2']);
  assert.ok(md.text.includes('Up to 2 most recent runs per lens dated on or before 2026-11-18, whatever --since says.'), md.text);
  assert.ok(md.text.includes('A run with no recorded verdict line (a fully clean review included) takes no slot and is counted unparsed.'), md.text);
  assert.match(md.text, /^\| 3a \| 2 \| 4 \| 3 \| 0\.75 \| 0 \|$/m);
});

test('a yield lens with no agent prints its confirmed per agent as none, never 0', async () => {
  const pipelines = fresh('pl');
  ac61(pipelines);
  writeDecisions(path.join(pipelines, '2026-11-18T2-spec-5'), 'Reproduction: lens "9z" finding a.js:1 reproduced. Confirmed.\n');
  const got = await reviewsCli(pipelines, fresh('pr'), ['--runs', '2']);
  assert.match(got.text, /^\| 9z \| 0 \| 0 \| 0 \| none \| 1 \|$/m);
});

test('--json carries every figure under reviews with n and unparsed', async () => {
  const pipelines = fresh('pl');
  ac61(pipelines);
  const got = await reviewsCli(pipelines, fresh('pr'), ['--runs', '2', '--json']);
  const r = JSON.parse(got.text).reviews;
  assert.deepStrictEqual(Object.keys(r.window).sort(), ['noTiming', 'runs', 'since', 'timingUnparsed', 'units', 'until']);
  assert.deepStrictEqual(Object.keys(r.taskReview).sort(), ['byTier', 'reReviews']);
  for (const k of ['reviews', 'n', 'unparsed', 'withFindings', 'findingsPerReview', 'byKind', 'humanStops']) assert.ok(k in r.planReview, k);
  for (const k of ['byTier', 'byLens', 'unreadable', 'perRun', 'outcomes', 'yield']) assert.ok(k in r.lens, k);
  assert.ok('allRouted' in r.lens.outcomes);
  assert.deepStrictEqual(Object.keys(r.lens.yield.byLens['3a']).sort(), ['agents', 'confirmed', 'rate', 'runs', 'unparsed']);
});

test('the task-review and verdict notes print', async () => {
  const { pipelines, projects } = fourTaskReviews();
  const got = await reviewsCli(pipelines, projects);
  assert.ok(got.text.includes("The task-review tier follows the plan's review-risk flag, so the capable tier reviews the riskier tasks; the tiers are printed side by side, not compared."), got.text);
  assert.ok(got.text.includes('"Confirmed" is the tiebreak judge\'s verdict or a pair\'s agreement, not ground truth.'), got.text);
});

test('an empty table prints none.', async () => {
  const pipelines = fresh('pl');
  const got = await reviewsCli(pipelines, fresh('pr'));
  assert.ok(got.text.includes('### Task review'), got.text);
  assert.ok(!/^\| Tier \|/m.test(got.text), 'no table header without rows');
  // task, lens by tier, lens by lens, verdicts by run, verdicts by lens, yield (the plan-kind table always has rows)
  assert.strictEqual(got.text.split('\n').filter((l) => l === 'none.').length, 6, got.text);
});

test('a pipelines listing failure: --section reviews exits 1, --section all leaves the code alone', async () => {
  const projects = fresh('pr');
  const throwing = { git: () => { throw new Error('fatal: not a git repository'); } };
  const h = cliDeps(throwing);
  const code = await cliRun({ argv: ['--section', 'reviews', '--since', '2026-11-18', '--until', '2026-11-18', '--projects', projects, '--repo', 'o/r'], deps: h.deps });
  assert.strictEqual(code, 1);
  assert.ok(h.logs.join('\n').includes('reviews: unavailable — cannot resolve the pipelines directory'), h.logs.join('\n'));
  const j = cliDeps(throwing);
  const allCode = await cliRun({ argv: ['--section', 'all', '--all-projects', '--json', '--since', '2026-11-18', '--until', '2026-11-18', '--projects', projects, '--repo', 'o/r'], deps: j.deps });
  const json = JSON.parse(j.logs.join('\n'));
  assert.match(json.reviews.error, /cannot resolve the pipelines directory/);
  for (const k of ['spend', 'funnel', 'records', 'guards']) assert.ok(!json[k].error, `${k}: ${json[k].error}`);
  assert.strictEqual(allCode, 0);
});

test('--section reviews is accepted; an unknown section lists it', async () => {
  const h = cliDeps();
  assert.strictEqual(await cliRun({ argv: ['--section', 'bogus'], deps: h.deps }), 2);
  assert.ok(h.errs.join('\n').includes('--section spend|funnel|records|guards|reviews|all]'), h.errs.join('\n'));
});

test('--runs 0 is refused by option validation, never an uncaught TypeError', async () => {
  const h = cliDeps();
  assert.strictEqual(await cliRun({ argv: ['--section', 'reviews', '--runs', '0'], deps: h.deps }), 2);
  assert.ok(h.errs.join('\n').includes('--runs needs a positive integer'), h.errs.join('\n'));
});
