// tests/pipeline-cost-report/spend.test.js
//
// #5914: tools/pipeline-cost-report/spend.js prices transcript requests (max-per-message.id usage, per-family
// price table, the Haiku long-prompt multiplier) and classifies cache writes by cause. Fixtures are JSONL
// written to a temp dir.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { PRICES, isUnderRoot, familyOf, bucketOf, priceRequest, scanTranscript, collectSpend } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'spend.js'));

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pcr-'));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));
let n = 0;
function fixture(lines) {
  const file = path.join(DIR, `t${n++}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return file;
}
const T0 = Date.parse('2026-11-19T10:00:00Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
function asst(id, model, min, usage) {
  return {
    type: 'assistant',
    timestamp: at(min),
    message: { id, model, usage: { input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage } },
  };
}
const user = (min, content = 'hi', extra = {}) => ({ type: 'user', timestamp: at(min), message: { role: 'user', content }, ...extra });
const skillCall = (id, min, skill) => ({
  type: 'assistant',
  timestamp: at(min),
  message: { id, model: 'claude-opus-4-8', content: [{ type: 'tool_use', name: 'Skill', input: { skill } }], usage: {} },
});

test('PRICES carries the dated table', () => {
  assert.strictEqual(PRICES.date, '2026-11-03');
  assert.deepStrictEqual(PRICES.families.opus, [4, 20, 0.2, 5, 8]);
  assert.deepStrictEqual(PRICES.families.haiku, [0.1, 0.5, 0.01, 0.125, 0.2]);
});

test('familyOf maps by substring and leaves the rest unpriced', () => {
  assert.strictEqual(familyOf('claude-opus-4-8'), 'opus');
  assert.strictEqual(familyOf('claude-haiku-5'), 'haiku');
  assert.strictEqual(familyOf('claude-fable-1'), 'fable');
  assert.strictEqual(familyOf('claude-sonnet-5-5'), 'sonnet');
  assert.strictEqual(familyOf('<synthetic>'), 'unpriced');
  assert.strictEqual(familyOf(undefined), 'unpriced');
});

test('AC1.1: one message.id on three lines with rising output_tokens is counted once, at the max of each field', async () => {
  const file = fixture([
    asst('m1', 'claude-opus-4-8', 0, { output_tokens: 5, cache_read_input_tokens: 1000 }),
    asst('m1', 'claude-opus-4-8', 0, { output_tokens: 40 }),
    asst('m1', 'claude-opus-4-8', 0, { output_tokens: 900 }),
  ]);
  const { requests } = await scanTranscript(file);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].output, 900);
  assert.strictEqual(requests[0].cacheRead, 1000);
});

test('AC2.1: a 120,000-token Haiku prompt is priced at five times the per-token rate of an 80,000-token one', () => {
  const mk = (input) => priceRequest({ model: 'claude-haiku-5', input, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
  const big = mk(120000);
  const small = mk(80000);
  assert.ok(Math.abs((big.usd / 120000) / (small.usd / 80000) - 5) < 1e-9);
  assert.strictEqual(big.prompt, 120000);
});

test('the Haiku multiplier applies at a prompt strictly over 100,000 and to every column', () => {
  const at100k = priceRequest({ model: 'claude-haiku-5', input: 100000, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
  assert.ok(Math.abs(at100k.usd - 0.01) < 1e-12);
  const over = priceRequest({ model: 'claude-haiku-5', input: 0, output: 1e6, cacheRead: 0, cacheWrite5m: 100001, cacheWrite1h: 0 });
  assert.ok(Math.abs(over.usd - (0.5 * 5 + (100001 * 0.125 * 5) / 1e6)) < 1e-9);
  assert.ok(Math.abs(over.cacheWriteUsd - (100001 * 0.125 * 5) / 1e6) < 1e-12);
  const opus = priceRequest({ model: 'claude-opus-4-8', input: 200000, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
  assert.ok(Math.abs(opus.usd - 0.8) < 1e-9);
});

test('a cache read is priced at the family read rate and counts toward the prompt size', () => {
  const opus = priceRequest({ model: 'claude-opus-4-8', input: 0, output: 0, cacheRead: 1000000, cacheWrite5m: 0, cacheWrite1h: 0 });
  assert.ok(Math.abs(opus.usd - 0.2) < 1e-9);
  assert.strictEqual(opus.prompt, 1000000);
  assert.strictEqual(opus.cacheWriteUsd, 0);
  // 100,001 cache-read tokens alone push a Haiku prompt over the long-prompt threshold: every column takes the multiplier
  const haiku = priceRequest({ model: 'claude-haiku-5', input: 0, output: 0, cacheRead: 100001, cacheWrite5m: 0, cacheWrite1h: 0 });
  assert.strictEqual(haiku.prompt, 100001);
  assert.ok(Math.abs(haiku.usd - (100001 * 0.01 * 5) / 1e6) < 1e-12);
  assert.strictEqual(bucketOf(priceRequest({ model: 'claude-opus-4-8', input: 0, output: 0, cacheRead: 60000, cacheWrite5m: 0, cacheWrite1h: 0 }).prompt), '50-100');
});

test('AC4.1: a turn writing more than half its prompt and over 40,000 tokens to cache is a re-write; after a call on another family its cause is model switch', async () => {
  const file = fixture([
    asst('a', 'claude-opus-4-8', 0, { input_tokens: 100, cache_read_input_tokens: 5000 }),
    asst('b', 'claude-sonnet-5-5', 1, { cache_creation_input_tokens: 60000, cache_read_input_tokens: 10000 }),
  ]);
  const { requests } = await scanTranscript(file);
  assert.strictEqual(requests[0].cause, 'ordinary growth');
  assert.strictEqual(requests[1].cause, 'model switch');
});

test('the first call is session start only when it is itself a re-write', async () => {
  const file = fixture([asst('a', 'claude-opus-4-8', 0, { cache_creation_input_tokens: 50000 })]);
  assert.strictEqual((await scanTranscript(file)).requests[0].cause, 'session start');
});

test('a write at or under 40,000 tokens or half the prompt is ordinary growth', async () => {
  const file = fixture([
    asst('a', 'claude-opus-4-8', 0, { cache_creation_input_tokens: 40000 }),
    asst('b', 'claude-opus-4-8', 1, { cache_creation_input_tokens: 50000, cache_read_input_tokens: 100000 }),
  ]);
  const { requests } = await scanTranscript(file);
  assert.deepStrictEqual(requests.map((r) => r.cause), ['ordinary growth', 'ordinary growth']);
});

test('a write over 40,000 tokens but at most half its prompt is ordinary growth, whatever else would classify it', async () => {
  // 45,000 written of a 145,000-token prompt: over the token floor, under half the prompt
  const big = { cache_creation_input_tokens: 45000, cache_read_input_tokens: 100000 };
  const first = fixture([asst('a', 'claude-opus-4-8', 0, big)]);
  assert.strictEqual((await scanTranscript(first)).requests[0].cause, 'ordinary growth');
  const switched = fixture([asst('a', 'claude-opus-4-8', 0, { cache_read_input_tokens: 1000 }), asst('b', 'claude-sonnet-5-5', 1, big)]);
  assert.strictEqual((await scanTranscript(switched)).requests[1].cause, 'ordinary growth');
  const exactlyHalf = fixture([asst('a', 'claude-opus-4-8', 0, { cache_creation_input_tokens: 50000, cache_read_input_tokens: 50000 })]);
  assert.strictEqual((await scanTranscript(exactlyHalf)).requests[0].cause, 'ordinary growth');
});

test('cause precedence: compaction, then idle', async () => {
  const compacted = fixture([
    asst('a', 'claude-opus-4-8', 0, { cache_read_input_tokens: 1000 }),
    { type: 'system', subtype: 'compact_boundary', timestamp: at(1) },
    asst('b', 'claude-opus-4-8', 2, { cache_creation_input_tokens: 60000 }),
  ]);
  assert.strictEqual((await scanTranscript(compacted)).requests[1].cause, 'compaction');
  const summary = fixture([
    asst('a', 'claude-opus-4-8', 0, { cache_read_input_tokens: 1000 }),
    user(1, 'summary', { isCompactSummary: true }),
    asst('b', 'claude-opus-4-8', 2, { cache_creation_input_tokens: 60000 }),
  ]);
  assert.strictEqual((await scanTranscript(summary)).requests[1].cause, 'compaction');
  const both = fixture([
    asst('a', 'claude-opus-4-8', 0, { cache_read_input_tokens: 1000 }),
    { type: 'system', subtype: 'compact_boundary', timestamp: at(1) },
    asst('b', 'claude-opus-4-8', 120, { cache_creation_input_tokens: 60000 }),
  ]);
  assert.strictEqual((await scanTranscript(both)).requests[1].cause, 'compaction');
  const idle = fixture([
    asst('a', 'claude-opus-4-8', 0, { cache_read_input_tokens: 1000 }),
    user(60, 'back'),
    asst('b', 'claude-opus-4-8', 61, { cache_creation_input_tokens: 60000 }),
  ]);
  assert.strictEqual((await scanTranscript(idle)).requests[1].cause, 'idle');
  const quick = fixture([
    asst('a', 'claude-opus-4-8', 0, { cache_read_input_tokens: 1000 }),
    asst('b', 'claude-opus-4-8', 59, { cache_creation_input_tokens: 60000 }),
  ]);
  assert.strictEqual((await scanTranscript(quick)).requests[1].cause, 'ordinary growth');
});

test('a compaction marker applies to the next call only', async () => {
  const file = fixture([
    asst('a', 'claude-opus-4-8', 0, { cache_read_input_tokens: 1000 }),
    { type: 'system', subtype: 'compact_boundary', timestamp: at(1) },
    asst('b', 'claude-opus-4-8', 2, { cache_read_input_tokens: 1000 }),
    asst('c', 'claude-opus-4-8', 3, { cache_creation_input_tokens: 60000 }),
  ]);
  assert.strictEqual((await scanTranscript(file)).requests[2].cause, 'ordinary growth');
});

test('a <synthetic> line is counted but is not the previous model call: the gap runs from the last real call', async () => {
  const file = fixture([
    asst('a', 'claude-opus-4-8', 0, { cache_read_input_tokens: 1000 }),
    asst('s', '<synthetic>', 70, {}),
    asst('b', 'claude-opus-4-8', 71, { cache_creation_input_tokens: 60000 }),
  ]);
  const { requests } = await scanTranscript(file);
  assert.strictEqual(requests.length, 3);
  assert.strictEqual(requests[1].family, 'unpriced');
  assert.strictEqual(requests[2].cause, 'idle');
});

test('a <synthetic> line neither switches the family nor uses up a pending compaction marker', async () => {
  const file = fixture([
    asst('a', 'claude-opus-4-8', 0, { cache_read_input_tokens: 1000 }),
    { type: 'system', subtype: 'compact_boundary', timestamp: at(1) },
    asst('s', '<synthetic>', 2, {}),
    asst('b', 'claude-opus-4-8', 3, { cache_creation_input_tokens: 60000 }),
  ]);
  assert.strictEqual((await scanTranscript(file)).requests[2].cause, 'compaction');
});

test('a leading <synthetic> line does not hide session start on the first real call', async () => {
  const file = fixture([
    asst('s', '<synthetic>', 0, {}),
    asst('a', 'claude-opus-4-8', 1, { cache_creation_input_tokens: 60000 }),
  ]);
  const { requests } = await scanTranscript(file);
  assert.deepStrictEqual(requests.map((r) => r.cause), ['ordinary growth', 'session start']);
});

test('model switch outranks compaction', async () => {
  const file = fixture([
    asst('a', 'claude-opus-4-8', 0, { cache_read_input_tokens: 1000 }),
    { type: 'system', subtype: 'compact_boundary', timestamp: at(1) },
    asst('b', 'claude-sonnet-5-5', 2, { cache_creation_input_tokens: 60000 }),
  ]);
  assert.strictEqual((await scanTranscript(file)).requests[1].cause, 'model switch');
});

test('split pricing: 1-hour writes take the 1-hour column', async () => {
  const file = fixture([
    asst('a', 'claude-opus-4-8', 0, { cache_creation_input_tokens: 1000000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000000 } }),
    asst('b', 'claude-opus-4-8', 1, { cache_creation_input_tokens: 1000000 }),
  ]);
  const { requests } = await scanTranscript(file);
  assert.ok(Math.abs(requests[0].cacheWriteUsd - 8) < 1e-9);
  assert.strictEqual(requests[0].cacheWrite1h, 1000000);
  assert.strictEqual(requests[0].cacheWrite5m, 0);
  assert.ok(Math.abs(requests[1].cacheWriteUsd - 5) < 1e-9, 'a line with no split prices all of it at the 5-minute rate');
  assert.strictEqual(requests[1].cacheWrite5m, 1000000);
});

test('unpriced: a model id with no known family is counted and priced at zero', async () => {
  const file = fixture([asst('a', '<synthetic>', 0, { input_tokens: 500, output_tokens: 20 })]);
  const { requests } = await scanTranscript(file);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].family, 'unpriced');
  assert.strictEqual(requests[0].usd, 0);
  assert.strictEqual(requests[0].cacheWriteUsd, 0);
  assert.strictEqual(requests[0].input, 500);
});

test('cwd comes from the first line that carries one', async () => {
  const file = fixture([
    { type: 'last-prompt' },
    { type: 'custom-title' },
    user(0, 'x', { cwd: '/w/claude-tweaks' }),
    user(1, 'y', { cwd: '/w/other' }),
  ]);
  assert.strictEqual((await scanTranscript(file)).cwd, '/w/claude-tweaks');
  assert.strictEqual((await scanTranscript(fixture([{ type: 'last-prompt' }]))).cwd, null);
});

test('bucketOf boundaries', () => {
  assert.strictEqual(bucketOf(49999), '<50');
  assert.strictEqual(bucketOf(50000), '50-100');
  assert.strictEqual(bucketOf(99999), '50-100');
  assert.strictEqual(bucketOf(100000), '100-150');
  assert.strictEqual(bucketOf(500000), '500-700');
  assert.strictEqual(bucketOf(699999), '500-700');
  assert.strictEqual(bucketOf(700000), '>700');
});

test('firstSkill reads a typed command or a Skill call, whichever comes first', async () => {
  const typed = fixture([
    skillCall('z', 0, 'superpowers:brainstorming'),
    user(1, '<command-message>x</command-message>\n<command-name>/claude-tweaks:dispatch</command-name>'),
    skillCall('y', 2, 'claude-tweaks:flow'),
  ]);
  assert.strictEqual((await scanTranscript(typed)).firstSkill, 'dispatch');
  const call = fixture([
    skillCall('z', 0, 'claude-tweaks:flow'),
    user(1, [{ type: 'text', text: '<command-name>/claude-tweaks:dispatch</command-name>' }]),
  ]);
  assert.strictEqual((await scanTranscript(call)).firstSkill, 'flow');
  const none = fixture([skillCall('z', 0, 'superpowers:brainstorming')]);
  assert.strictEqual((await scanTranscript(none)).firstSkill, null);
});

test('malformed lines are skipped', async () => {
  const file = fixture(['{not json', asst('a', 'claude-opus-4-8', 0, { input_tokens: 7 })]);
  assert.strictEqual((await scanTranscript(file)).requests[0].input, 7);
});

test('a transcript with no line that parses as JSON is corrupt: scanTranscript rejects and collectSpend counts it unreadable once', async () => {
  const garbage = fixture(['{not json', 'also not json', '']);
  await assert.rejects(() => scanTranscript(garbage), /parses as JSON/);
  const root = path.join(DIR, `garbage-root${n++}`);
  fs.mkdirSync(path.join(root, 'slug-a'), { recursive: true });
  fs.writeFileSync(path.join(root, 'slug-a', 'bad.jsonl'), '{not json\nnope\n');
  fs.writeFileSync(path.join(root, 'slug-a', 'cut.jsonl'), JSON.stringify(asst('a', 'claude-opus-4-8', 0, { input_tokens: 500000, output_tokens: 0 })) + '\n{"type":"assis');
  fs.writeFileSync(path.join(root, 'slug-a', 'empty.jsonl'), '');
  const r = await collectSpend({ roots: [root], since: new Date('2026-11-08T00:00:00Z'), until: new Date('2026-11-19T00:00:00Z'), match: null });
  assert.strictEqual(r.unreadable, 1);
  near(r.total, 2);
});

// --- collectSpend ---

let rootN = 0;
function newRoot() {
  const root = path.join(DIR, `root${rootN++}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}
function put(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}
const typed = (min, skill) => user(min, [{ type: 'text', text: `<command-name>/claude-tweaks:${skill}</command-name>` }]);
const WINDOW = { since: new Date('2026-11-08T00:00:00Z'), until: new Date('2026-11-19T00:00:00Z'), match: null };
// one Opus call: 1,000,000 uncached input tokens = $4
const opusCall = (id, min, input = 1000000) => asst(id, 'claude-opus-4-8', min, { input_tokens: input, output_tokens: 0 });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

test('AC3.1: a session whose first claude-tweaks skill is dispatch is reported under dispatch', async () => {
  const root = newRoot();
  put(path.join(root, 'slug-a', 's1.jsonl'), [typed(0, 'dispatch'), opusCall('a', 1), skillCall('b', 2, 'claude-tweaks:flow')]);
  const r = await collectSpend({ roots: [root], ...WINDOW });
  assert.ok(r.bySessionType.dispatch > 0);
  assert.strictEqual(r.bySessionType.flow, undefined);
  assert.strictEqual(r.sessions, 1);
  assert.strictEqual(r.unreadable, 0);
});

test('AC3.2: a session that invoked no claude-tweaks skill is reported under no skill invoked', async () => {
  const root = newRoot();
  put(path.join(root, 'slug-a', 's1.jsonl'), [user(0), opusCall('a', 1)]);
  const r = await collectSpend({ roots: [root], ...WINDOW });
  near(r.bySessionType['no skill invoked'], 4);
  near(r.total, 4);
  near(r.byModel.opus, 4);
  near(r.byAgent.main, 4);
  assert.strictEqual(r.byAgent.subagent, 0);
  assert.strictEqual(r.byBucket['>700'].requests, 1);
});

test("AC3.3: subagent spend is attributed to its parent session's type", async () => {
  const root = newRoot();
  put(path.join(root, 'slug-a', 's1.jsonl'), [typed(0, 'flow'), opusCall('a', 1)]);
  put(path.join(root, 'slug-a', 's1', 'subagents', 'agent-x.jsonl'), [opusCall('b', 2, 500000)]);
  const r = await collectSpend({ roots: [root], ...WINDOW });
  near(r.bySessionType.flow, 6);
  near(r.byAgent.subagent, 2);
  near(r.byAgent.main, 4);
  assert.strictEqual(r.sessions, 1);
});

test('AC3.3: a subagent whose parent transcript is missing is reported under unattributed', async () => {
  const root = newRoot();
  put(path.join(root, 'slug-a', 's1', 'subagents', 'agent-x.jsonl'), [opusCall('b', 2, 500000)]);
  const r = await collectSpend({ roots: [root], ...WINDOW });
  near(r.bySessionType.unattributed, 2);
  assert.strictEqual(r.sessions, 0);
});

test('AC3.3: a Workflow-tool agent under subagents/workflows/{id}/ is a subagent of its session', async () => {
  const root = newRoot();
  put(path.join(root, 'slug-a', 's1.jsonl'), [typed(0, 'review')]);
  put(path.join(root, 'slug-a', 's1', 'subagents', 'workflows', 'wf_1', 'agent-x.jsonl'), [opusCall('b', 2, 500000)]);
  put(path.join(root, 'slug-a', 's1', 'tool-results', 'agent-y.jsonl'), [opusCall('c', 2)]);
  const r = await collectSpend({ roots: [root], ...WINDOW });
  near(r.bySessionType.review, 2);
  near(r.byAgent.subagent, 2);
  near(r.total, 2);
});

test('AC8.1: a transcript that disappears during the scan is counted unreadable and the scan continues', async () => {
  const root = newRoot();
  const gone = put(path.join(root, 'slug-a', 'gone.jsonl'), [opusCall('a', 1)]);
  put(path.join(root, 'slug-a', 'kept.jsonl'), [opusCall('b', 1, 500000)]);
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  const failStat = {
    ...fs,
    statSync: (f, ...rest) => {
      if (f === gone) throw enoent();
      return fs.statSync(f, ...rest);
    },
  };
  const r = await collectSpend({ roots: [root], ...WINDOW }, { fsImpl: failStat });
  assert.strictEqual(r.unreadable, 1);
  near(r.total, 2);
  const failRead = {
    ...fs,
    createReadStream: (f, ...rest) => {
      if (f === gone) throw enoent();
      return fs.createReadStream(f, ...rest);
    },
  };
  const r2 = await collectSpend({ roots: [root], ...WINDOW }, { fsImpl: failRead });
  assert.strictEqual(r2.unreadable, 1);
  near(r2.total, 2);
});

test('window: a message outside --since/--until is not counted, by its own timestamp', async () => {
  const root = newRoot();
  const m = (id, iso) => ({ ...opusCall(id, 0, 500000), timestamp: iso });
  put(path.join(root, 'slug-a', 's1.jsonl'), [
    m('a', '2026-11-07T23:59:59Z'),
    m('b', '2026-11-08T00:00:00Z'),
    m('c', '2026-11-19T23:59:59Z'),
    m('d', '2026-11-20T00:00:00Z'),
  ]);
  const r = await collectSpend({ roots: [root], ...WINDOW });
  near(r.total, 4); // b and c count; a and d do not
});

test('a file last modified before --since is skipped', async () => {
  const root = newRoot();
  const f = put(path.join(root, 'slug-a', 's1.jsonl'), [opusCall('a', 0)]);
  const old = new Date('2026-10-01T00:00:00Z');
  fs.utimesSync(f, old, old);
  const r = await collectSpend({ roots: [root], ...WINDOW });
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.sessions, 0);
});

test('match keeps only transcripts whose cwd contains the substring', async () => {
  const root = newRoot();
  put(path.join(root, 'slug-a', 's1.jsonl'), [{ ...user(0), cwd: '/work/claude-tweaks' }, opusCall('a', 1, 500000)]);
  put(path.join(root, 'slug-b', 's2.jsonl'), [{ ...user(0), cwd: '/work/other' }, opusCall('b', 1, 500000)]);
  put(path.join(root, 'claude-tweaks-slug', 's3.jsonl'), [user(0), opusCall('c', 1, 500000)]);
  const r = await collectSpend({ roots: [root], ...WINDOW, match: 'claude-tweaks' });
  near(r.total, 4);
  assert.strictEqual(r.sessions, 2);
});

test('a session-start write is tallied under its cause and unpriced models are counted apart from spend', async () => {
  const root = newRoot();
  put(path.join(root, 'slug-a', 's1.jsonl'), [
    asst('a', 'claude-opus-4-8', 0, { cache_creation_input_tokens: 100000 }),
    asst('u', 'mystery-model', 1, { input_tokens: 300, output_tokens: 7 }),
    asst('s', '<synthetic>', 2, {}),
  ]);
  const r = await collectSpend({ roots: [root], ...WINDOW });
  assert.strictEqual(r.cacheWrites['session start'].requests, 1);
  near(r.cacheWrites['session start'].usd, 0.5);
  assert.deepStrictEqual(r.unpriced, { requests: 1, tokens: 307 });
});

test('cacheWrites tallies every cache write by cause, so its dollars sum to all cache-write dollars in the window', async () => {
  const root = newRoot();
  const file = put(path.join(root, 'slug-a', 's1.jsonl'), [
    asst('a', 'claude-opus-4-8', 0, { input_tokens: 95000, cache_creation_input_tokens: 5000 }),
    asst('b', 'claude-sonnet-5-5', 1, { cache_read_input_tokens: 10000, cache_creation_input_tokens: 60000 }),
  ]);
  const { requests } = await scanTranscript(file);
  const r = await collectSpend({ roots: [root], ...WINDOW });
  near(r.cacheWrites['ordinary growth'].usd, requests[0].cacheWriteUsd);
  assert.ok(r.cacheWrites['ordinary growth'].usd > 0);
  assert.strictEqual(r.cacheWrites['ordinary growth'].requests, 1);
  assert.strictEqual(r.cacheWrites['ordinary growth'].tokens, 5000);
  near(r.cacheWrites['model switch'].usd, requests[1].cacheWriteUsd);
  assert.strictEqual(r.cacheWrites['model switch'].requests, 1);
  const sum = Object.values(r.cacheWrites).reduce((s, e) => s + e.usd, 0);
  near(sum, requests[0].cacheWriteUsd + requests[1].cacheWriteUsd);
});

test('a session dir without subagents/ and a slug-level dir that is not a session are not unreadable', async () => {
  const root = newRoot();
  put(path.join(root, 'slug-a', 's1.jsonl'), [opusCall('a', 1)]);
  put(path.join(root, 'slug-a', 's1', 'tool-results', 'out.json'), []);
  fs.mkdirSync(path.join(root, 'slug-a', 'memory'), { recursive: true });
  const r = await collectSpend({ roots: [root], ...WINDOW });
  assert.strictEqual(r.unreadable, 0);
  near(r.total, 4);
});

test('a parent transcript that fails to scan is counted unreadable once, even when its mtime is outside the window', async () => {
  const root = newRoot();
  const parent = put(path.join(root, 'slug-a', 's1.jsonl'), [typed(0, 'flow'), opusCall('a', 1)]);
  const old = new Date('2026-10-01T00:00:00Z');
  fs.utimesSync(parent, old, old);
  put(path.join(root, 'slug-a', 's1', 'subagents', 'agent-x.jsonl'), [opusCall('b', 2, 500000)]);
  put(path.join(root, 'slug-a', 's1', 'subagents', 'agent-y.jsonl'), [opusCall('c', 3, 500000)]);
  const failRead = {
    ...fs,
    createReadStream: (f, ...rest) => {
      if (f === parent) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      return fs.createReadStream(f, ...rest);
    },
  };
  const r = await collectSpend({ roots: [root], ...WINDOW }, { fsImpl: failRead });
  assert.strictEqual(r.unreadable, 1);
  near(r.bySessionType.unattributed, 4);
});

test('sessions counts a main transcript only when one of its requests is in the window', async () => {
  const root = newRoot();
  const m = (id, iso) => ({ ...opusCall(id, 0, 500000), timestamp: iso });
  put(path.join(root, 'slug-a', 'in.jsonl'), [m('a', '2026-11-10T00:00:00Z')]);
  put(path.join(root, 'slug-a', 'out.jsonl'), [m('b', '2026-11-01T00:00:00Z')]);
  const r = await collectSpend({ roots: [root], ...WINDOW });
  assert.strictEqual(r.sessions, 1);
});

const errno = (code) => Object.assign(new Error(code), { code });

test('a readdir failure on a slug dir is counted unreadable', async () => {
  const root = newRoot();
  put(path.join(root, 'slug-a', 's1.jsonl'), [opusCall('a', 1)]);
  put(path.join(root, 'slug-b', 's2.jsonl'), [opusCall('b', 1, 500000)]);
  const slugA = path.join(root, 'slug-a');
  const failList = {
    ...fs,
    readdirSync: (d, ...rest) => {
      if (d === slugA) throw errno('EACCES');
      return fs.readdirSync(d, ...rest);
    },
  };
  const r = await collectSpend({ roots: [root], ...WINDOW }, { fsImpl: failList });
  assert.strictEqual(r.unreadable, 1);
  near(r.total, 2);
});

test('only ENOENT on subagents/ means no subagents: any other readdir error is counted unreadable', async () => {
  const root = newRoot();
  put(path.join(root, 'slug-a', 's1.jsonl'), [typed(0, 'flow'), opusCall('a', 1)]);
  put(path.join(root, 'slug-a', 's1', 'subagents', 'agent-x.jsonl'), [opusCall('b', 2, 500000)]);
  const subDir = path.join(root, 'slug-a', 's1', 'subagents');
  const failList = {
    ...fs,
    readdirSync: (d, ...rest) => {
      if (d === subDir) throw errno('EACCES');
      return fs.readdirSync(d, ...rest);
    },
  };
  const r = await collectSpend({ roots: [root], ...WINDOW }, { fsImpl: failList });
  assert.strictEqual(r.unreadable, 1);
  near(r.total, 4);
});

test('a parent whose stat and read both fail is counted unreadable once, and its subagent is unattributed', async () => {
  const root = newRoot();
  const parent = put(path.join(root, 'slug-a', 's1.jsonl'), [typed(0, 'flow'), opusCall('a', 1)]);
  put(path.join(root, 'slug-a', 's1', 'subagents', 'agent-x.jsonl'), [opusCall('b', 2, 500000)]);
  const failBoth = {
    ...fs,
    statSync: (f, ...rest) => {
      if (f === parent) throw errno('ENOENT');
      return fs.statSync(f, ...rest);
    },
    createReadStream: (f, ...rest) => {
      if (f === parent) throw errno('ENOENT');
      return fs.createReadStream(f, ...rest);
    },
  };
  const r = await collectSpend({ roots: [root], ...WINDOW }, { fsImpl: failBoth });
  assert.strictEqual(r.unreadable, 1);
  near(r.bySessionType.unattributed, 2);
});

test('byBucket lists its buckets smallest prompt first, not in the order they were first seen', async () => {
  const root = newRoot();
  put(path.join(root, 'slug-a', 's1.jsonl'), [opusCall('a', 1, 600000), opusCall('b', 2, 10000), opusCall('c', 3, 120000)]);
  const r = await collectSpend({ roots: [root], ...WINDOW });
  assert.deepStrictEqual(Object.keys(r.byBucket), ['<50', '100-150', '500-700']);
});

test('a session whose subagent files are all outside the window never has its parent transcript opened', async () => {
  const root = newRoot();
  const old = new Date('2026-10-01T00:00:00Z');
  const parent = put(path.join(root, 'slug-a', 's1.jsonl'), [typed(0, 'flow'), opusCall('a', 1)]);
  const sub = put(path.join(root, 'slug-a', 's1', 'subagents', 'agent-x.jsonl'), [opusCall('b', 2)]);
  fs.utimesSync(parent, old, old);
  fs.utimesSync(sub, old, old);
  const opened = [];
  const spy = { ...fs, createReadStream: (f, ...rest) => { opened.push(f); return fs.createReadStream(f, ...rest); } };
  const r = await collectSpend({ roots: [root], ...WINDOW }, { fsImpl: spy });
  assert.deepStrictEqual(opened, []);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.unreadable, 0);
});

test('isUnderRoot matches a native Windows cwd against git\'s forward-slash root (path.win32), and keeps sibling prefixes out', () => {
  const root = 'C:/Users/u/repo';
  assert.ok(isUnderRoot('C:\\Users\\u\\repo', root, path.win32));
  assert.ok(isUnderRoot('C:\\Users\\u\\repo\\.claude\\worktrees\\w1', root, path.win32));
  assert.ok(!isUnderRoot('C:\\Users\\u\\repo-marketplace', root, path.win32));
  assert.ok(!isUnderRoot('D:\\Users\\u\\repo', root, path.win32));
  assert.ok(!isUnderRoot(null, root, path.win32));
  assert.ok(isUnderRoot('/a/b/wt', '/a/b', path.posix));
  assert.ok(!isUnderRoot('/a/b-x', '/a/b', path.posix));
});

test('a non-ENOENT error on subagents/workflows is counted unreadable', async () => {
  const root = newRoot();
  put(path.join(root, 'slug-a', 's1.jsonl'), [typed(0, 'flow'), opusCall('a', 1)]);
  put(path.join(root, 'slug-a', 's1', 'subagents', 'workflows', 'w1', 'agent-x.jsonl'), [opusCall('b', 2, 500000)]);
  const wfDir = path.join(root, 'slug-a', 's1', 'subagents', 'workflows');
  const failList = {
    ...fs,
    readdirSync: (d, ...rest) => {
      if (d === wfDir) throw errno('EACCES');
      return fs.readdirSync(d, ...rest);
    },
  };
  const r = await collectSpend({ roots: [root], ...WINDOW }, { fsImpl: failList });
  assert.strictEqual(r.unreadable, 1);
});

test('a pluginRoot without transcript.js fails collectSpend loudly instead of counting every transcript unreadable', async () => {
  const root = newRoot();
  put(path.join(root, 'slug-a', 's1.jsonl'), [typed(0, 'flow'), opusCall('a', 1)]);
  const emptyPlugin = fs.mkdtempSync(path.join(DIR, 'plugin-'));
  await assert.rejects(() => collectSpend({ roots: [root], ...WINDOW }, { pluginRoot: emptyPlugin }), /transcript\.js/);
});

test('a transcript.js under pluginRoot that does not export mergeUsage fails collectSpend with the loader error, not MODULE_NOT_FOUND', async () => {
  const root = newRoot();
  put(path.join(root, 'slug-a', 's1.jsonl'), [typed(0, 'flow'), opusCall('a', 1)]);
  const badPlugin = fs.mkdtempSync(path.join(DIR, 'plugin-'));
  const dir = path.join(badPlugin, 'bin', 'lib', 'timing');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'transcript.js'), 'module.exports = {};');
  await assert.rejects(() => collectSpend({ roots: [root], ...WINDOW }, { pluginRoot: badPlugin }), /does not export mergeUsage/);
});

test('scanTranscript: a Bash drive.js --check call is route evidence; prose and other tools are not', async () => {
  const bash = (command) => ({ type: 'assistant', timestamp: '2026-11-19T09:00:00Z', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
  assert.strictEqual((await scanTranscript(fixture([bash('node "/p/bin/drive.js" --check 5270')]))).reachedRoute, true);
  assert.strictEqual((await scanTranscript(fixture([bash('node "/p/bin/log-decision.js" --run "/r" --status SKIP --step "Driver route (skipped)" --text x')]))).reachedRoute, true);
  assert.strictEqual((await scanTranscript(fixture([bash('node "/p/bin/log-decision.js" --run "/r" --status AUTO --step "Step 2.8" --text x')]))).reachedRoute, false);
  assert.strictEqual((await scanTranscript(fixture([bash('node "/p/bin/drive.js" #5270')]))).reachedRoute, false);
  assert.strictEqual((await scanTranscript(fixture([{ type: 'user', message: { content: 'run `drive.js --check #5270` first' } }]))).reachedRoute, false);
  assert.strictEqual((await scanTranscript(fixture([{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/x/drive.js --check' } }] } }]))).reachedRoute, false);
  assert.strictEqual((await scanTranscript(fixture([{ type: 'user', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node "/p/bin/drive.js" --check 5270' } }] } }]))).reachedRoute, false);
});

test('scanTranscript: pluginVersion is the first claude-tweaks v{X.Y.Z} @ match in the raw text, else null', async () => {
  const hook = (v) => ({ type: 'attachment', attachment: { content: `rules...\n\nclaude-tweaks v${v} @ /cache/claude-tweaks/${v}` } });
  assert.strictEqual((await scanTranscript(fixture([hook('6.175.0'), hook('6.170.0')]))).pluginVersion, '6.175.0');
  assert.strictEqual((await scanTranscript(fixture([{ type: 'user', message: { content: 'claude-tweaks v{X.Y.Z} @' } }]))).pluginVersion, null);
});

test('scanTranscript: firstTs is the first line carrying a timestamp', async () => {
  assert.strictEqual((await scanTranscript(fixture([{ type: 'last-prompt' }, { type: 'user', timestamp: '2026-11-15T23:06:00Z', message: { content: 'x' } }, { type: 'user', timestamp: '2026-11-16T00:00:00Z', message: { content: 'y' } }]))).firstTs, '2026-11-15T23:06:00Z');
  assert.strictEqual((await scanTranscript(fixture([{ type: 'last-prompt' }]))).firstTs, null);
});
