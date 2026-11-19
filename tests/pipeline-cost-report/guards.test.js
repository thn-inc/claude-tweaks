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
const { selectColumns, parseReviewCounts, readTiming, readReport, collectWholeBranch } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'guards.js'));

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
