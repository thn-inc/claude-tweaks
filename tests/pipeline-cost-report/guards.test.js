// tests/pipeline-cost-report/guards.test.js
//
// #5916: tools/pipeline-cost-report/guards.js picks the before/after run columns, parses whole-branch review
// reports out of subagent transcripts, and computes guard 1 (the share of whole-branch reviews that found an issue).
// Fixtures are temp dirs; nothing here spawns a process.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { selectColumns, parseReviewCounts, readTiming, readReport, collectWholeBranch, collectFirstPass, keyFilesOf, collectPostMergeBugs } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'guards.js'));

const { run: runCli } = require(path.join(ROOT, 'tools', 'pipeline-cost-report.js'));

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pcr-guards-'));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));
let n = 0;
const fresh = (label) => {
  const d = path.join(DIR, `${label}${n++}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// Writes {pipelines}/{name}/timing.json; returns the run object listRuns would produce.
function writeRun(pipelines, name, { items = [], sessions = [] } = {}, projects = 'projects') {
  const dir = path.join(pipelines, name);
  fs.mkdirSync(dir, { recursive: true });
  const transcripts = sessions.map((s) => ({ path: path.join(projects, 'slug-main', `${s}.jsonl`) }));
  fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify({ dispatches: { items }, transcripts }));
  return { name, date: name.slice(0, 10), dir, archived: false, members: [] };
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
const review = (agentId, description = 'Whole-branch review', role = 'whole-branch review') => ({ agentId, description, role, tier: 'Capable', parentAgentId: null, startTs: '2026-11-18T10:00:00Z' });

// A bare run object with an (empty) timing.json so it is eligible.
function bare(pipelines, name) {
  return writeRun(pipelines, name);
}

test('parseReviewCounts counts only top-level items up to the next heading', () => {
  const text = ['### Issues', '#### Critical (Must Fix)', 'None.', '#### Important (Should Fix)', '1. **a**', '   - sub', '2. **b**', '#### Minor (Nice to Have)', '1. m', '### Ledger triage', '- t1', '- t2'].join('\n');
  assert.deepStrictEqual(parseReviewCounts(text), { critical: 0, important: 2, minor: 1 });
});

test('parseReviewCounts: a None or N/A item counts zero', () => {
  const text = ['#### Important', '- None', '- N/A.'].join('\n');
  assert.strictEqual(parseReviewCounts(text).important, 0);
});

test('parseReviewCounts: one heading is enough', () => {
  assert.deepStrictEqual(parseReviewCounts('#### Minor\n- x\n'), { critical: 0, important: 0, minor: 1 });
});

test('AC2.1: a report with none of the three headings is unparsed', () => {
  assert.strictEqual(parseReviewCounts('API Error 403 forbidden'), null);
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items: [review('a1'), review('a2'), review('a3')], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 'a1', '#### Important\n1. x\n');
  writeReport(projects, 's1', 'a2', '#### Minor\n1. y\n');
  writeReport(projects, 's1', 'a3', 'nothing structured here');
  const r = collectWholeBranch([run], { roots: [projects] });
  assert.strictEqual(r.n, 2);
  assert.strictEqual(r.unparsed, 1);
  assert.strictEqual(r.share, 0.5);
});

test('AC1.1: two Important and two Minor-only reports give 50%', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items: [review('b1'), review('b2'), review('b3'), review('b4')], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 'b1', '#### Important\n1. x\n');
  writeReport(projects, 's1', 'b2', '#### Important\n1. x\n');
  writeReport(projects, 's1', 'b3', '#### Minor\n1. m\n2. m\n');
  writeReport(projects, 's1', 'b4', '#### Minor\n1. m\n2. m\n');
  const r = collectWholeBranch([run], { roots: [projects] });
  assert.strictEqual(r.share, 0.5);
  assert.strictEqual(r.meanImportant, 0.5);
  assert.strictEqual(r.meanCritical, 0);
  assert.strictEqual(r.n, 4);
  assert.strictEqual(r.unparsed, 0);
});

test('guard 1: a missing transcript and an error reply are unparsed', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items: [review('c1'), review('c2'), review('c3')], sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 'c2', 'API Error 403');
  writeReport(projects, 's1', 'c3', '#### Critical\n1. boom\n');
  const r = collectWholeBranch([run], { roots: [projects] });
  assert.strictEqual(r.n, 1);
  assert.strictEqual(r.unparsed, 2);
  assert.strictEqual(r.share, 1);
  assert.strictEqual(r.meanCritical, 1);
});

test('AC6.1: --split 2026-11-19 --runs 2 picks the two latest before and two earliest on or after', () => {
  const pipelines = fresh('pl');
  const names = ['2026-11-19T1-a', '2026-11-16T1-a', '2026-11-20T1-a', '2026-11-18T1-a', '2026-11-17T1-a'];
  const runs = names.map((nm) => bare(pipelines, nm));
  const { before, after: aft } = selectColumns(runs, { split: '2026-11-19', n: 2 });
  assert.deepStrictEqual(before.map((r) => r.name), ['2026-11-17T1-a', '2026-11-18T1-a']);
  assert.deepStrictEqual(aft.map((r) => r.name), ['2026-11-19T1-a', '2026-11-20T1-a']);
});

test('selectColumns orders one date by full name and keeps a short column', () => {
  const pipelines = fresh('pl');
  const runs = ['2026-11-18T2-b', '2026-11-18T1-a', '2026-11-20T1-a'].map((nm) => bare(pipelines, nm));
  const { before, after: aft } = selectColumns(runs, { split: '2026-11-19', n: 5 });
  assert.deepStrictEqual(before.map((r) => r.name), ['2026-11-18T1-a', '2026-11-18T2-b']);
  assert.deepStrictEqual(aft.map((r) => r.name), ['2026-11-20T1-a']);
});

test('--runs counts only pipeline runs', () => {
  const pipelines = fresh('pl');
  const mk = (name, withTiming) => {
    if (withTiming) return writeRun(pipelines, name);
    const dir = path.join(pipelines, name);
    fs.mkdirSync(dir, { recursive: true });
    return { name, date: name.slice(0, 10), dir, archived: false, members: [] };
  };
  const runs = [
    mk('2026-11-17T1-spec-1', false),
    mk('2026-11-18T1-adhoc-standalone', true),
    mk('2026-11-18T2-release-standalone', false),
    mk('2026-11-18T3-x', true),
    mk('2026-11-18T4-record-2', false),
    mk('2026-11-18T5-deepen-driver-standalone', true),
  ];
  const { before } = selectColumns(runs, { split: '2026-11-19', n: 3 });
  assert.deepStrictEqual(before.map((r) => r.name), ['2026-11-17T1-spec-1', '2026-11-18T3-x', '2026-11-18T4-record-2']);
});

test('readReport reads a SubagentHandback report', () => {
  const projects = fresh('pr');
  const d = path.join(projects, 'slug-sub', 's1', 'subagents');
  fs.mkdirSync(d, { recursive: true });
  const asst = (content) => JSON.stringify({ type: 'assistant', message: { content } });
  fs.writeFileSync(path.join(d, 'agent-h1.jsonl'), [
    asst([{ type: 'text', text: 'early note' }]),
    asst([{ type: 'tool_use', name: 'SubagentHandback', input: { message: '#### Important\n1. x' } }]),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(d, 'agent-h2.jsonl'), [
    asst([{ type: 'tool_use', name: 'SubagentHandback', input: { message: 'early handback' } }]),
    asst([{ type: 'text', text: 'final' }]),
  ].join('\n') + '\n');
  assert.strictEqual(readReport({ roots: [projects], sessions: ['s1'], agentId: 'h1' }), '#### Important\n1. x');
  assert.strictEqual(readReport({ roots: [projects], sessions: ['s1'], agentId: 'h2' }), 'final');
  assert.strictEqual(readReport({ roots: [projects], sessions: ['s1'], agentId: 'nope' }), null);
  // An unreadable root is skipped, not fatal.
  assert.strictEqual(readReport({ roots: [path.join(projects, 'missing'), projects], sessions: ['s1'], agentId: 'h1' }), '#### Important\n1. x');
});

test('guard 1 also reads an unlabelled final review', () => {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const items = [
    review('d1'),
    review('d2', 'Final review for #5865', 'unlabelled'),
    review('d3', 'Implement Task 1', 'unlabelled'),
  ];
  const run = writeRun(pipelines, '2026-11-18T1-spec-1', { items, sessions: ['s1'] }, projects);
  writeReport(projects, 's1', 'd1', '#### Important\n1. x\n');
  writeReport(projects, 's1', 'd2', '#### Critical\n1. y\n');
  writeReport(projects, 's1', 'd3', '#### Critical\n1. z\n');
  const r = collectWholeBranch([run], { roots: [projects] });
  assert.strictEqual(r.n, 2);
  assert.strictEqual(r.meanCritical, 0.5);
  assert.strictEqual(r.unparsed, 0);
});

test('readTiming: absent is null, unparseable throws, and an unparseable run counts unparsed', () => {
  const pipelines = fresh('pl');
  const empty = path.join(pipelines, 'x');
  fs.mkdirSync(empty);
  assert.strictEqual(readTiming(empty), null);
  const bad = path.join(pipelines, '2026-11-18T1-spec-1');
  fs.mkdirSync(bad);
  fs.writeFileSync(path.join(bad, 'timing.json'), '{nope');
  assert.throws(() => readTiming(bad));
  const noItems = path.join(pipelines, '2026-11-18T2-spec-2');
  fs.mkdirSync(noItems);
  fs.writeFileSync(path.join(noItems, 'timing.json'), '{"dispatches":{}}');
  assert.throws(() => readTiming(noItems));
  const mkRun = (name, dir) => ({ name, date: '2026-11-18', dir, archived: false, members: [] });
  const r = collectWholeBranch([mkRun('2026-11-18T1-spec-1', bad), mkRun('2026-11-18T2-spec-2', noItems)], { roots: [] });
  assert.strictEqual(r.unparsed, 2);
  assert.strictEqual(r.n, 0);
  assert.strictEqual(r.share, null);
});

// Task-dispatch fixture: role, description, tier, startTs index, parent agent.
let agentSeq = 0;
const task = (role, description, tier = 'standard', t = 1, parentAgentId = null) => ({
  agentId: `t${agentSeq++}`,
  description,
  role,
  tier,
  parentAgentId,
  startTs: `2026-11-18T10:00:${String(t).padStart(2, '0')}Z`,
});
const impl = (description, tier, t, parent) => task('implementer', description, tier, t, parent);
const rev = (description, tier, t, parent) => task('task review', description, tier, t, parent);
const rerev = (description, tier, t, parent) => task('re-review', description, tier, t, parent);

function firstPass(items, { members = [], name = '2026-11-18T1-spec-1' } = {}) {
  const pipelines = fresh('pl');
  const run = { ...writeRun(pipelines, name, { items }), members };
  return collectFirstPass([run], {});
}

test('AC3.1: three tasks, one re-reviewed, give 67% and the first implementer\'s tier', () => {
  const r = firstPass([
    impl('Implement Task 1: a', 'standard', 1),
    rev('Review Task 1', 'capable', 2),
    impl('Implement Task 2: b', 'capable', 3),
    impl('Implement Task 2: b again', 'standard', 5),
    rev('Review Task 2', 'capable', 6),
    rerev('Re-review Task 2 fix round 1', 'capable', 7),
    impl('Implement Task 3: c', 'standard', 6),
    rev('Review Task 3', 'capable', 7),
  ]);
  assert.strictEqual(r.n, 3);
  assert.strictEqual(Math.round(r.share * 100), 67);
  assert.deepStrictEqual(r.byTier.standard, { share: 1, n: 2 });
  assert.deepStrictEqual(r.byTier.capable, { share: 0, n: 1 });
  assert.strictEqual(r.unparsed, 0);
});

test('AC4.1: task 1 of two runs counts twice', () => {
  const pipelines = fresh('pl');
  const mk = (name) => writeRun(pipelines, name, { items: [impl('Implement Task 1', 'standard', 1), rev('Review Task 1', 'capable', 2)] });
  const r = collectFirstPass([mk('2026-11-18T1-spec-1'), mk('2026-11-18T2-spec-2')], {});
  assert.strictEqual(r.n, 2);
});

test('first pass keys tasks by record number within a run', () => {
  const r = firstPass([
    impl('Implement #5830 Task 1', 'standard', 1),
    impl('Implement #5863 Task 1', 'standard', 2),
    rerev('Re-review Task 1 for #5863', 'capable', 3),
  ]);
  assert.strictEqual(r.n, 2);
  assert.strictEqual(r.share, 0.5);
});

test('a dispatch naming no record inherits its task\'s one implementer\'s record', () => {
  const r = firstPass([
    impl('Implement #5830 Task 1', 'standard', 1),
    rev('Review Task 1', 'capable', 2),
    rerev('Re-review Task 1 fix round 1', 'capable', 3),
  ]);
  assert.strictEqual(r.n, 1);
  assert.strictEqual(r.unparsed, 0);
  assert.strictEqual(r.share, 0);
});

test('first pass keys tasks by parent agent', () => {
  const r = firstPass([impl('Implement Task 1', 'standard', 1, 'p1'), impl('Implement Task 1', 'standard', 2, 'p2')]);
  assert.strictEqual(r.n, 2);
});

test('a review group with no implementer is unparsed; an untasked task dispatch is unparsed', () => {
  const r = firstPass([
    rev('Review Task 4', 'capable', 1),
    rerev('Re-review the final-review fix wave', 'capable', 2),
    impl('Implement Task 1', 'standard', 3),
    impl('Implement the fix wave', 'standard', 4),
  ]);
  assert.strictEqual(r.n, 1);
  assert.strictEqual(r.unparsed, 3);
});

test('a re-dispatched implementer naming one record still lends it', () => {
  const r = firstPass([
    impl('Implement #5228 Task 5: a', 'standard', 1),
    impl('Implement #5228 Task 5: a again', 'standard', 2),
    rev('Review Task 5', 'capable', 3),
    rerev('Re-review Task 5 fix round 1', 'capable', 4),
  ]);
  assert.strictEqual(r.n, 1);
  assert.strictEqual(r.unparsed, 0);
  assert.strictEqual(r.share, 0);
  const two = firstPass([
    impl('Implement #1 Task 1', 'standard', 1),
    impl('Implement #2 Task 1', 'standard', 2),
    rev('Review Task 1', 'capable', 3),
  ]);
  assert.strictEqual(two.n, 2);
  assert.strictEqual(two.unparsed, 1);
});

test('a record-less multi-spec group with differing implementers is unparsed', () => {
  const items = () => [
    impl('Implement Task 1: macOS workflow skeleton', 'standard', 1),
    impl('Implement Task 1: release-block check', 'standard', 2),
    rerev('Re-review Task 1 fix round 1', 'capable', 3),
    impl('Implement Task 2: x', 'standard', 4),
    rev('Review Task 2', 'capable', 5),
  ];
  const multi = firstPass(items(), { members: ['spec-1', 'spec-2'] });
  assert.strictEqual(multi.n, 1);
  assert.strictEqual(multi.unparsed, 1);
  assert.strictEqual(multi.share, 1);
  const single = firstPass(items(), { members: ['spec-1'] });
  assert.strictEqual(single.n, 2);
  assert.strictEqual(single.unparsed, 0);
});

test('a task\'s tier is the earliest implementer\'s; an implementer with no startTs sorts last', () => {
  const noTs = { ...impl('Implement Task 1: a', 'capable', 1), startTs: undefined };
  const r = firstPass([noTs, impl('Implement Task 1: a again', 'standard', 2), rev('Review Task 1', 'capable', 3)]);
  assert.deepStrictEqual(Object.keys(r.byTier), ['standard']);
  const r2 = firstPass([impl('Implement Task 1: a', 'standard', 2), noTs, rev('Review Task 1', 'capable', 3)]);
  assert.deepStrictEqual(Object.keys(r2.byTier), ['standard']);
});

test('guard 1 and 2 ignore a run with no timing.json', () => {
  const dir = fresh('pl');
  const run = { name: '2026-11-18T1-spec-1', date: '2026-11-18', dir, archived: false, members: [] };
  for (const r of [collectWholeBranch([run], { roots: [] }), collectFirstPass([run], {})]) {
    assert.strictEqual(r.n, 0);
    assert.strictEqual(r.unparsed, 0);
    assert.strictEqual(r.share, null);
  }
});

test('corrupt timing.json counts one unparsed in guards 1 and 2', () => {
  const dir = fresh('pl');
  fs.writeFileSync(path.join(dir, 'timing.json'), '{');
  const run = { name: '2026-11-18T1-spec-1', date: '2026-11-18', dir, archived: false, members: [] };
  assert.strictEqual(collectWholeBranch([run], { roots: [] }).unparsed, 1);
  assert.strictEqual(collectFirstPass([run], {}).unparsed, 1);
});

test('a timing.json with no dispatches.items counts one unparsed in guards 1 and 2', () => {
  const dir = fresh('pl');
  fs.writeFileSync(path.join(dir, 'timing.json'), '{"dispatches":{"notFound":"no subagents/ directory"}}');
  const run = { name: '2026-11-18T1-spec-1', date: '2026-11-18', dir, archived: false, members: [] };
  for (const r of [collectWholeBranch([run], { roots: [] }), collectFirstPass([run], {})]) {
    assert.strictEqual(r.n, 0);
    assert.strictEqual(r.unparsed, 1);
  }
});

test('first pass tier follows startTs, not array order', () => {
  const r = firstPass([
    impl('Implement Task 1: a again', 'standard', 5),
    impl('Implement Task 1: a', 'capable', 1),
    rev('Review Task 1', 'capable', 6),
  ]);
  assert.strictEqual(r.byTier.capable.n, 1);
  assert.strictEqual(r.byTier.standard, undefined);
});

test('keyFilesOf strips backticks, a trailing :line and a trailing note', () => {
  const body = [
    '## Overview', 'x', '### Key Files',
    '- `tools/a.js` \u2014 adds x',
    '- tools/b.js:42',
    '- `tools/c.js:10-20` \u2014 note',
    '',
    '## Gotchas',
    '- `tools/z.js`',
  ].join('\n');
  assert.deepStrictEqual(keyFilesOf(body), ['tools/a.js', 'tools/b.js', 'tools/c.js']);
  assert.strictEqual(keyFilesOf('## Overview\nno files here'), null);
});

// A fake gh: prs is [{ number, mergedAt, files: [path] }], bugs is [{ number, createdAt, body }].
function fakeGh(prs, bugs) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(prs.map(({ number, mergedAt }) => ({ number, mergedAt })));
    if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ files: prs.find((p) => String(p.number) === args[2]).files.map((f) => ({ path: f })) });
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(bugs);
    throw new Error('unexpected gh call ' + args.join(' '));
  };
  return { gh, calls };
}
const keyBody = (...files) => ['## Overview', 'x', '### Key Files', ...files.map((f) => '- `' + f + '`')].join('\n');
const col = (...dates) => dates.map((d) => ({ name: d + 'T1-spec-1', date: d, dir: '/x', archived: false, members: [] }));

test('AC5.1: a bug 10 days after a merge counts; one 20 days after does not', () => {
  const { gh } = fakeGh(
    [{ number: 7, mergedAt: '2026-11-03T12:00:00Z', files: ['tools/a.js'] }],
    [
      { number: 100, createdAt: '2026-11-13T12:00:00Z', body: keyBody('tools/a.js') },
      { number: 101, createdAt: '2026-11-23T12:00:00Z', body: keyBody('tools/a.js') },
    ],
  );
  const r = collectPostMergeBugs(col('2026-11-01', '2026-11-05'), { repo: 'o/r', gh });
  assert.deepStrictEqual(r, { count: 1, perPr: 1, mergedPrs: 1, unparsed: 0 });
});

test('guard 3 matches exactly and counts a bug once', () => {
  const { gh } = fakeGh(
    [
      { number: 7, mergedAt: '2026-11-03T12:00:00Z', files: ['tools/a.js'] },
      { number: 8, mergedAt: '2026-11-04T12:00:00Z', files: ['tools/a.js', 'tools/q.js'] },
    ],
    [
      { number: 100, createdAt: '2026-11-10T12:00:00Z', body: keyBody('tools/a.js') },
      { number: 101, createdAt: '2026-11-10T12:00:00Z', body: keyBody('tools/a.jsx') },
      { number: 102, createdAt: '2026-11-02T12:00:00Z', body: keyBody('tools/a.js') },
    ],
  );
  const r = collectPostMergeBugs(col('2026-11-01', '2026-11-05'), { repo: 'o/r', gh });
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.mergedPrs, 2);
  assert.strictEqual(r.perPr, 0.5);
  assert.strictEqual(r.unparsed, 0);
});

test('guard 3 window: created at the merge instant is out, exactly 14 days after is in; a longer path does not match', () => {
  const { gh } = fakeGh(
    [
      { number: 7, mergedAt: '2026-11-03T12:00:00Z', files: ['tools/a.js'] },
      { number: 8, mergedAt: '2026-11-03T12:00:00Z', files: ['tools/b.jsx'] },
    ],
    [
      { number: 100, createdAt: '2026-11-03T12:00:00Z', body: keyBody('tools/a.js') },
      { number: 101, createdAt: '2026-11-17T12:00:00Z', body: keyBody('tools/a.js') },
      { number: 102, createdAt: '2026-11-10T12:00:00Z', body: keyBody('tools/b.js') },
    ],
  );
  const r = collectPostMergeBugs(col('2026-11-01', '2026-11-05'), { repo: 'o/r', gh });
  assert.strictEqual(r.count, 1);
});

test('guard 3: a bug with no Key Files section is unparsed', () => {
  const { gh } = fakeGh(
    [{ number: 7, mergedAt: '2026-11-03T12:00:00Z', files: ['tools/a.js'] }],
    [{ number: 100, createdAt: '2026-11-10T12:00:00Z', body: 'just prose' }],
  );
  const r = collectPostMergeBugs(col('2026-11-01', '2026-11-05'), { repo: 'o/r', gh });
  assert.strictEqual(r.unparsed, 1);
  assert.strictEqual(r.count, 0);
});

test('guard 3 queries the column\'s merge window and 14 days past it', () => {
  const { gh, calls } = fakeGh([{ number: 7, mergedAt: '2026-11-03T12:00:00Z', files: ['tools/a.js'] }], []);
  const r = collectPostMergeBugs(col('2026-11-01', '2026-11-05'), { repo: 'o/r', gh });
  const prList = calls.find((c) => c[0] === 'pr' && c[1] === 'list');
  const prView = calls.find((c) => c[0] === 'pr' && c[1] === 'view');
  const issueList = calls.find((c) => c[0] === 'issue' && c[1] === 'list');
  assert.deepStrictEqual(prList, ['pr', 'list', '--repo', 'o/r', '--state', 'merged', '--search', 'merged:2026-11-01..2026-11-05', '--limit', '1000', '--json', 'number,mergedAt']);
  assert.deepStrictEqual(prView, ['pr', 'view', '7', '--repo', 'o/r', '--json', 'files']);
  assert.deepStrictEqual(issueList, ['issue', 'list', '--repo', 'o/r', '--state', 'all', '--label', 'type:bug', '--search', 'created:2026-11-01..2026-11-19', '--limit', '1000', '--json', 'number,createdAt,body']);
  assert.deepStrictEqual(r, { count: 0, perPr: 0,mergedPrs: 1, unparsed: 0 });
});

test('guard 3: an empty column makes no gh call and a gh throw propagates', () => {
  const { gh, calls } = fakeGh([], []);
  assert.deepStrictEqual(collectPostMergeBugs([], { repo: 'o/r', gh }), { count: 0, perPr: null, mergedPrs: 0, unparsed: 0 });
  assert.strictEqual(calls.length, 0);
  assert.throws(() => collectPostMergeBugs(col('2026-11-01'), { repo: 'o/r', gh: () => { throw new Error('boom'); } }), /boom/);
});

// ---- the guards section through run({ argv, deps }) ----

const CLI_PR = { number: 7, mergedAt: '2026-11-16T12:00:00Z', files: ['tools/a.js'] };
const CLI_BUG = { number: 100, createdAt: '2026-11-20T12:00:00Z', body: keyBody('tools/a.js') };

// A fake gh for the whole CLI: guard 3 sees one merged PR and one bug naming its file; every other call answers empty.
function cliGh({ failOn = null, repoView = 'o/r\n' } = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    const key = args.slice(0, 2).join(' ');
    if (failOn === key) throw new Error('gh: HTTP 502\nsecond line');
    if (key === 'repo view') return repoView;
    if (args[0] === 'api') return '0\n';
    if (key === 'pr list') return JSON.stringify([{ number: CLI_PR.number, mergedAt: CLI_PR.mergedAt }]);
    if (key === 'pr view') return JSON.stringify({ files: CLI_PR.files.map((f) => ({ path: f })) });
    if (key === 'issue list') return JSON.stringify(args.includes('type:bug') ? [CLI_BUG] : []);
    throw new Error('unexpected gh call ' + args.join(' '));
  };
  return { gh, calls };
}

// Runs 15-16 are outside --runs 2; the before column is 16-17 (the AC1.1 and AC3.1 fixtures in run 17), the after column 19-20.
function cliFixture() {
  const pipelines = fresh('pl');
  const projects = fresh('pr');
  const items = [
    review('k1'), review('k2'), review('k3'), review('k4'),
    impl('Implement Task 1: a', 'standard', 1),
    rev('Review Task 1', 'capable', 2),
    impl('Implement Task 2: b', 'capable', 3),
    impl('Implement Task 2: b again', 'standard', 5),
    rev('Review Task 2', 'capable', 6),
    rerev('Re-review Task 2 fix round 1', 'capable', 7),
    impl('Implement Task 3: c', 'standard', 6),
    rev('Review Task 3', 'capable', 7),
  ];
  writeRun(pipelines, '2026-11-15T1-spec-0');
  writeRun(pipelines, '2026-11-16T1-spec-9');
  writeRun(pipelines, '2026-11-17T1-spec-1', { items, sessions: ['s1'] }, projects);
  writeRun(pipelines, '2026-11-19T1-spec-2');
  writeRun(pipelines, '2026-11-20T1-spec-3');
  writeRun(pipelines, '2026-11-21T1-spec-4');
  writeReport(projects, 's1', 'k1', '#### Important\n1. x\n');
  writeReport(projects, 's1', 'k2', '#### Important\n1. x\n');
  writeReport(projects, 's1', 'k3', '#### Minor\n1. m\n');
  writeReport(projects, 's1', 'k4', '#### Minor\n1. m\n');
  return { pipelines, projects };
}

async function cli(extra, { gh = cliGh().gh, deps = {}, fixture = cliFixture() } = {}) {
  const logs = [];
  const errs = [];
  const main = fresh('main');
  const full = {
    gh,
    check: async () => '{}',
    now: () => new Date('2026-11-19T12:00:00Z'),
    pluginVersion: () => '9.9.9',
    git: () => path.join(main, '.git'),
    cwd: ROOT,
    home: fresh('home'),
    log: (s) => logs.push(s),
    err: (s) => errs.push(s),
    ...deps,
  };
  const argv = ['--projects', fixture.projects, '--pipelines', fixture.pipelines, ...extra];
  const code = await runCli({ argv, deps: full });
  return { code, text: logs.join('\n'), logs, errs };
}
const GUARDS = ['--section', 'guards', '--split', '2026-11-19', '--runs', '2', '--repo', 'o/r'];

test('AC7.1: --json prints the figures under a guards key', async () => {
  const r = await cli([...GUARDS, '--json']);
  assert.strictEqual(r.code, 0);
  const g = JSON.parse(r.logs[0]).guards;
  assert.strictEqual(g.split, '2026-11-19');
  assert.strictEqual(g.runs, 2);
  assert.strictEqual(g.before.runCount, 2);
  assert.strictEqual(g.before.from, '2026-11-16');
  assert.strictEqual(g.before.to, '2026-11-17');
  assert.deepStrictEqual(g.before.wholeBranch, { share: 0.5, meanCritical: 0, meanImportant: 0.5, n: 4, unparsed: 0 });
  assert.strictEqual(g.before.firstPass.n, 3);
  assert.strictEqual(g.before.firstPass.unparsed, 0);
  assert.deepStrictEqual(g.before.firstPass.byTier.capable, { share: 0, n: 1 });
  assert.deepStrictEqual(g.before.postMergeBugs, { count: 1, perPr: 1, mergedPrs: 1, unparsed: 0 });
  assert.strictEqual(g.after.runCount, 2);
  assert.strictEqual(g.after.from, '2026-11-19');
  assert.strictEqual(g.after.to, '2026-11-20');
  assert.strictEqual(g.after.wholeBranch.share, null);
  assert.strictEqual(g.after.wholeBranch.n, 0);
});

test('AC1.1/AC3.1: markdown prints 50% and 67%, each with its unparsed count', async () => {
  const r = await cli(GUARDS);
  assert.strictEqual(r.code, 0);
  assert.match(r.text, /^## Guards$/m);
  assert.match(r.text, /Split 2026-11-19; up to 2 runs per column\./);
  const rows = r.text.split('\n');
  const g1 = rows.find((l) => l.includes('Whole-branch reviews with a Critical or Important issue'));
  const g2 = rows.find((l) => l.includes('Tasks with no re-review'));
  const g3 = rows.find((l) => l.includes('Bug records within 14 days of a merge touching its Key Files'));
  assert.match(g1, /50% of 4; mean 0\.00 critical, 0\.50 important; 0 unparsed/);
  assert.match(g2, /67% of 3; 0 unparsed/);
  assert.match(g3, /1 over 1 merged PRs \(1\.00 per PR\); 0 unparsed/);
  assert.ok(rows.some((l) => l.startsWith('| Guard | Before (2 runs, 2026-11-16 to 2026-11-17) | After (2 runs, 2026-11-19 to 2026-11-20) |')), r.text);
  assert.ok(g1.includes('none of 0; 0 unparsed'), g1);
  assert.ok(rows.some((l) => /^\| First implementer tier \| Before \| After \|/.test(l)), r.text);
  assert.ok(rows.some((l) => /^\| capable \| 0% of 1 \|/.test(l)), r.text);
  assert.ok(rows.some((l) => /^\| standard \| 100% of 2 \|/.test(l)), r.text);
});

test('--section guards without a valid --split or --runs exits 2', async () => {
  for (const argv of [
    ['--section', 'guards'],
    ['--section', 'guards', '--split', '2026-13-01'],
    ['--section', 'guards', '--split', '2026-11-19', '--runs', '0'],
    ['--section', 'guards', '--split', '2026-11-19', '--runs', '2.5'],
    ['--section', 'all', '--runs', '0'],
  ]) {
    const r = await cli(argv);
    assert.strictEqual(r.code, 2, argv.join(' '));
    assert.strictEqual(r.logs.length, 0);
    assert.match(r.errs.join('\n'), /--split|--runs/);
  }
});

test('--section all without --split marks guards not run and exits 0', async () => {
  const r = await cli(['--since', '2026-11-18', '--until', '2026-11-18']);
  assert.strictEqual(r.code, 0, r.text + r.errs.join('\n'));
  assert.ok(r.text.includes('Guards: not run — --split <YYYY-MM-DD> not given.'), r.text);
  const j = await cli(['--since', '2026-11-18', '--until', '2026-11-18', '--json']);
  assert.strictEqual(j.code, 0);
  assert.deepStrictEqual(JSON.parse(j.logs[0]).guards, { skipped: '--split not given' });
});

test('guard 3 gh failure keeps guards 1 and 2 and exits 1', async () => {
  const r = await cli(GUARDS, { gh: cliGh({ failOn: 'pr list' }).gh });
  assert.strictEqual(r.code, 1);
  assert.match(r.text, /50% of 4/);
  assert.match(r.text, /67% of 3/);
  assert.ok(r.text.includes('unavailable — gh: HTTP 502'), r.text);
  assert.ok(!r.text.includes('second line'));
  const j = await cli([...GUARDS, '--json'], { gh: cliGh({ failOn: 'pr list' }).gh });
  const g = JSON.parse(j.logs[0]).guards;
  assert.deepStrictEqual(g.before.postMergeBugs, { error: 'gh: HTTP 502' });
  assert.strictEqual(g.before.wholeBranch.share, 0.5);
});

test('guard 3 resolves the repository itself; a failing gh repo view keeps guards 1 and 2', async () => {
  const argv = GUARDS.slice(0, -2);
  const ok = cliGh();
  const r = await cli(argv, { gh: ok.gh });
  assert.strictEqual(r.code, 0);
  const guard3 = ok.calls.filter((c) => (c[0] === 'pr' || c[0] === 'issue') && c.includes('--repo'));
  assert.ok(guard3.length >= 3);
  for (const c of guard3) assert.strictEqual(c[c.indexOf('--repo') + 1], 'o/r');
  const bad = await cli(argv, { gh: cliGh({ failOn: 'repo view' }).gh });
  assert.strictEqual(bad.code, 1);
  assert.match(bad.text, /50% of 4/);
  assert.match(bad.text, /67% of 3/);
  assert.ok(bad.text.includes('unavailable — gh: HTTP 502'), bad.text);
});

test('an empty column never resolves the repository', async () => {
  // --split 2026-11-22 leaves the after column empty; only the before column (runs 20 and 21) needs the repository.
  const r = await cli(['--section', 'guards', '--split', '2026-11-22', '--runs', '2', '--json'], { gh: cliGh({ failOn: 'repo view' }).gh });
  assert.strictEqual(r.code, 1);
  const g = JSON.parse(r.logs[0]).guards;
  assert.deepStrictEqual(g.after.postMergeBugs, { count: 0, perPr: null, mergedPrs: 0, unparsed: 0 });
  assert.strictEqual(g.after.runCount, 0);
  assert.strictEqual(g.after.from, null);
  assert.deepStrictEqual(g.before.postMergeBugs, { error: 'gh: HTTP 502' });
});

test('a pipelines listing error makes the section unavailable', async () => {
  const fixture = cliFixture();
  const logs = [];
  const code = await runCli({
    argv: ['--section', 'guards', '--split', '2026-11-19', '--projects', fixture.projects],
    deps: { gh: cliGh().gh, now: () => new Date('2026-11-19T12:00:00Z'), git: () => { throw new Error('not a repo\nmore'); }, cwd: ROOT, home: fresh('home'), log: (s) => logs.push(s), err: () => {} },
  });
  assert.strictEqual(code, 1);
  assert.ok(logs.join('\n').includes('guards: unavailable — cannot resolve the pipelines directory (not a repo)'), logs.join('\n'));
});

test('--runs defaults to 20 per column', async () => {
  const fixture = { pipelines: fresh('pl'), projects: fresh('pr') };
  for (let i = 1; i <= 22; i++) writeRun(fixture.pipelines, `2026-10-${String(i).padStart(2, '0')}T1-spec-${i}`);
  const r = await cli(['--section', 'guards', '--split', '2026-11-01', '--repo', 'o/r', '--json'], { fixture });
  const g = JSON.parse(r.logs[0]).guards;
  assert.strictEqual(g.runs, 20);
  assert.strictEqual(g.before.runCount, 20);
  assert.strictEqual(g.before.from, '2026-10-03');
  assert.strictEqual(g.after.runCount, 0);
});
