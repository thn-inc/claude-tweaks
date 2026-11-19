// tests/pipeline-cost-report/spend.test.js
//
// #5914: tools/pipeline-cost-report/spend.js prices transcript requests (max-per-message.id usage, per-family
// price table, the Haiku long-prompt multiplier) and classifies cache re-writes by cause. Fixtures are JSONL
// written to a temp dir.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { PRICES, familyOf, bucketOf, priceRequest, scanTranscript } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'spend.js'));

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
