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
const { parseTaskVerdict, parsePlanReview, parseLensReport, walkRuns, readVerdicts, isHumanStop, collectTaskReview, collectPlanReview, collectReviews } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'reviews.js'));
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

test('human stops: the two real forms count, a settled gap does not', () => {
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
  assert.deepStrictEqual(got.humanStops, { runs: 1, n: 2, unparsed: 1 });
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
  assert.deepStrictEqual(got.planReview.humanStops, { runs: 1, n: 1, unparsed: 0 });
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
