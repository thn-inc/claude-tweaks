'use strict';
// Binds machine-grant-outlook.md's `specified` outlook fence to execution
// (docs/skill-authoring.md, "Executable snippets in skill prose" — extract-and-run
// form, #5291): the doc is the only source of the executed text. The two
// session-tmp assignments are swapped for fixture paths and CLAUDE_PLUGIN_ROOT
// points at this checkout's plugin/, so the fence reads a fixture funnel and
// fixture trust rows and prints what the overview would render from.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const DOC = path.join(__dirname, '..', 'plugin', 'skills', 'backlog', 'machine-grant-outlook.md');
const PLUGIN_ROOT = path.join(__dirname, '..', 'plugin').split(path.sep).join('/');

// Anchored on the section heading and the fence delimiter, never on a sentence.
function extractFence(doc = readText(DOC)) {
  const match = /^## `specified` stage[^\n]*\n[\s\S]*?\n```bash\r?\n([\s\S]*?)```/m.exec(doc);
  assert.ok(match, 'extraction pattern is out of sync with machine-grant-outlook.md — update this test');
  return match[1];
}

// Swap one `VAR="$(… --value file)"` assignment for a literal fixture path; assert it matched.
function pinPath(fence, variable, fixturePath) {
  const pattern = new RegExp(`^${variable}="\\$\\(.*\\)"$`, 'm');
  const out = fence.replace(pattern, `${variable}="${fixturePath}"`);
  assert.notStrictEqual(out, fence, `fence has no ${variable} assignment to pin — update this test`);
  return out;
}

function runFence(fence, { specified, rows }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-snippet-'));
  const viewsPath = path.join(dir, 'views.json').split(path.sep).join('/');
  const rowsPath = path.join(dir, 'rows.json').split(path.sep).join('/');
  fs.writeFileSync(viewsPath, JSON.stringify({ funnel: { specified } }));
  fs.writeFileSync(rowsPath, JSON.stringify(rows));
  let script = pinPath(fence, 'ST_BACKLOG_OVERVIEW_VIEWS', viewsPath);
  script = pinPath(script, 'ST_BACKLOG_OVERVIEW_TRUST_ROWS', rowsPath);
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

const SPECIFIED = (number) => ({ number, labels: ['by:capture', 'ready', 'risk:low', 'size:low'], body: 'Surface: backend' });
const MIXED_ROW = {
  key: 'producer:capture|low',
  verdict: 'mixed',
  mixedReasons: ['follow-up-rate'],
  total: 3,
  followUpRecords: 1,
  followUpRateMaxPercent: 30,
};
const CLEAN_ROW = { key: 'producer:capture|low', verdict: 'clean' };

test('all-refused: a specified record refused at trust prints the one-line why', () => {
  const r = runFence(extractFence(), { specified: [SPECIFIED(1)], rows: [MIXED_ROW] });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(
    r.stdout,
    '# machine grants: none possible — all 1 candidates refused (trust: 1) — trust: producer:capture|low mixed (follow-up rate 33.4% > 30%)\n',
  );
});

test('eligible: a clean class prints the JSON the live line renders from', () => {
  const r = runFence(extractFence(), { specified: [SPECIFIED(2)], rows: [CLEAN_ROW] });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout), { eligible: 1, refusedTotal: 0, refused: {}, excludedOrigin: 0 });
});

test('mixed funnel: one eligible and one refused keeps the live-line JSON, not the all-refused line', () => {
  const second = { number: 3, labels: ['by:code-health', 'ready', 'risk:low', 'size:low'], body: 'Surface: backend' };
  const humanFiled = { number: 4, labels: ['ready', 'risk:low', 'size:low'], body: 'Surface: backend' };
  const r = runFence(extractFence(), { specified: [SPECIFIED(1), second, humanFiled], rows: [CLEAN_ROW] });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout), { eligible: 1, refusedTotal: 1, refused: { trust: 1 }, excludedOrigin: 1 });
});

test('refused buckets print in descending count order, ties by key', () => {
  const needsDefinition = (number) => ({ ...SPECIFIED(number), labels: [...SPECIFIED(number).labels, 'needs:definition'] });
  const noCell = { number: 9, labels: ['by:code-health', 'ready', 'risk:low', 'size:low'], body: 'Surface: backend' };
  const specified = [noCell, SPECIFIED(2), needsDefinition(5), needsDefinition(6), needsDefinition(7)];
  const r = runFence(extractFence(), { specified, rows: [CLEAN_ROW] });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(
    r.stdout,
    '{"eligible":1,"refusedTotal":4,"refused":{"needs-definition":3,"trust":1},"excludedOrigin":0}\n',
  );
});

test('go-red: a fence that never asks for the all-refused line cannot print it', () => {
  const fence = extractFence();
  const mutated = fence.replace(/allRefusedOutlookLine/g, 'noSuchExport');
  assert.notStrictEqual(mutated, fence, 'mutation matched nothing — the fence no longer calls allRefusedOutlookLine');
  const r = runFence(mutated, { specified: [SPECIFIED(1)], rows: [MIXED_ROW] });
  assert.notStrictEqual(r.status, 0, 'a fence calling a missing export must fail, not print the line');
});

test('go-red: a fence that skips the null check never prints the live-line JSON when eligible', () => {
  const fence = extractFence();
  const mutated = fence.replace(/if \(line\)/, 'if (true)');
  assert.notStrictEqual(mutated, fence, 'mutation matched nothing — the fence no longer branches on the line');
  const r = runFence(mutated, { specified: [SPECIFIED(2)], rows: [CLEAN_ROW] });
  assert.doesNotMatch(r.stdout, /"eligible"/, 'the JSON arm must be reached only through the null check');
});
