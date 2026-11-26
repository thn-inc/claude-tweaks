'use strict';
// #6009: the run's list-price cost — per-request rows on session lanes, step usage on the driver lane.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../../helpers/tmp-dir');
const { readUsage } = require('../../../plugin/bin/lib/timing/transcript');
const { PRICES, priceRequest, priceAggregate } = require('../../../plugin/bin/lib/pricing/prices');
const { deriveRunCost, costRowsFrom } = require('../../../plugin/bin/lib/run-manifest/cost');

const DRIVER = { lane: 'driver' };
const SESSION = { lane: 'session' };

// The same mapping deriveRunCost applies to a readUsage row.
const mapped = (r) => ({ model: r.model, input: r.inputTokens, output: r.outputTokens, cacheRead: r.cacheRead, cacheWrite5m: r.cacheWrite5m, cacheWrite1h: r.cacheWrite1h });
const cents = (usd) => Math.round(usd * 100) / 100;

function line({ ts, id, model, usage, role = 'assistant' }) {
  return JSON.stringify({ timestamp: ts, message: { role, id, model, usage, content: [] } });
}
function usage(input, output, cacheRead, cacheCreate, split) {
  const u = { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreate };
  if (split) u.cache_creation = { ephemeral_5m_input_tokens: split[0], ephemeral_1h_input_tokens: split[1] };
  return u;
}
function transcript(dir, name, lines) {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}
// A session-lane input with every transcript read.
function sessionInput(rows, extra = {}) {
  return { rows, aggregates: [], sourcesRead: 1, sourcesUnread: 0, events: [], manifest: SESSION, closedAt: null, runStartAt: null, ...extra };
}

test('AC2.1: two transcripts on opus-5-5 and sonnet-5-5 sum per model and price per request', async () => {
  const dir = scratchDir('run-cost-');
  const main = transcript(dir, 'main.jsonl', [
    line({ ts: '2026-11-26T10:00:00Z', id: 'm1', model: 'claude-opus-5-5', usage: usage(10, 200, 5000, 3000, [1000, 2000]) }),
    line({ ts: '2026-11-26T10:01:00Z', id: 'm2', model: 'claude-opus-5-5', usage: usage(4, 90, 8000, 0) }),
  ]);
  const sub = transcript(dir, 'main/subagents/agent-a.jsonl', [
    line({ ts: '2026-11-26T10:02:00Z', id: 's1', model: 'claude-sonnet-5-5', usage: usage(7, 300, 1200, 600) }),
  ]);
  const rows = (await readUsage(main)).concat(await readUsage(sub));
  const out = deriveRunCost(sessionInput(rows, { sourcesRead: 2 }));
  assert.deepEqual(Object.keys(out.tokensByModel).sort(), ['claude-opus-5-5', 'claude-sonnet-5-5']);
  assert.deepEqual(out.tokensByModel['claude-opus-5-5'], { input: 14, output: 290, cacheRead: 13000, cacheWrite5m: 1000, cacheWrite1h: 2000 });
  assert.deepEqual(out.tokensByModel['claude-sonnet-5-5'], { input: 7, output: 300, cacheRead: 1200, cacheWrite5m: 600, cacheWrite1h: 0 });
  assert.equal(out.costUsd, cents(rows.reduce((s, r) => s + priceRequest(mapped(r)).usd, 0)));
  assert.ok(out.costUsd > 0);
  assert.equal(out.priceDate, PRICES.date);
  assert.equal(out.costPartial, false);
  assert.deepEqual(out.unpricedModels, []);
});

test('AC3.1: an unknown model id is listed and adds nothing', () => {
  const priced = { model: 'claude-opus-5-5', messageId: 'a', inputTokens: 100, outputTokens: 2000, cacheRead: 0, cacheCreate: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
  const unknown = { model: 'mystery-model-1', messageId: 'b', inputTokens: 900000, outputTokens: 900000, cacheRead: 0, cacheCreate: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
  const out = deriveRunCost(sessionInput([priced, unknown]));
  assert.deepEqual(out.unpricedModels, ['mystery-model-1']);
  assert.deepEqual(out.tokensByModel['mystery-model-1'], { input: 900000, output: 900000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
  assert.equal(out.costUsd, cents(priceRequest(mapped(priced)).usd));
});

test('AC4.1: no transcript resolved gives costUsd null', () => {
  const cost = costRowsFrom({ rows: [], transcripts: [{ path: '/nowhere/a.jsonl', rows: 0, note: 'transcript not found (ENOENT: /nowhere/a.jsonl)' }], items: [] });
  assert.equal(cost.sourcesRead, 0);
  const out = deriveRunCost({ ...cost, events: [], manifest: SESSION, closedAt: null, runStartAt: null });
  assert.deepEqual(
    { tokensByModel: out.tokensByModel, costUsd: out.costUsd, priceDate: out.priceDate, unpricedModels: out.unpricedModels, costPartial: out.costPartial },
    { tokensByModel: null, costUsd: null, priceDate: null, unpricedModels: null, costPartial: null },
  );
  assert.deepEqual(costRowsFrom(null), { rows: [], aggregates: [], sourcesRead: 0, sourcesUnread: 0 });
});

test('AC4.2: one readable and one unreadable gives a number and costPartial true', async () => {
  const dir = scratchDir('run-cost-');
  const p = transcript(dir, 'main.jsonl', [line({ ts: '2026-11-26T10:00:00Z', id: 'm1', model: 'claude-opus-5-5', usage: usage(10, 200, 0, 0) })]);
  const rows = await readUsage(p);
  const cost = costRowsFrom({ rows, transcripts: [{ path: p, rows: rows.length }, { path: path.join(dir, 'gone.jsonl'), rows: 0, note: 'transcript not found (ENOENT: gone)' }], items: [] });
  assert.deepEqual([cost.sourcesRead, cost.sourcesUnread], [1, 1]);
  const out = deriveRunCost({ ...cost, events: [], manifest: SESSION, closedAt: null, runStartAt: null });
  assert.equal(typeof out.costUsd, 'number');
  assert.equal(out.costPartial, true);
});

test('AC4.3: a Haiku row over 100k prompt tokens in a subagent transcript takes the long-prompt rate, and a cache write with no split is priced at the 5-minute rate', async () => {
  const dir = scratchDir('run-cost-');
  const main = transcript(dir, 'main.jsonl', [line({ ts: '2026-11-26T10:00:00Z', id: 'm1', model: 'claude-opus-5-5', usage: usage(1, 10, 0, 40000) })]);
  const subPath = path.join(dir, 'main', 'subagents', 'agent-h.jsonl');
  transcript(dir, 'main/subagents/agent-h.jsonl', [line({ ts: '2026-11-26T10:01:00Z', id: 'h1', model: 'claude-haiku-5-5', usage: usage(150000, 400, 20000, 0) })]);
  const mainRows = await readUsage(main);
  const subRows = await readUsage(subPath);
  const cost = costRowsFrom({ rows: mainRows, transcripts: [{ path: main, rows: mainRows.length }], items: [{ transcriptPath: subPath, usageRows: subRows, notFound: null }] });
  assert.equal(cost.sourcesRead, 2);
  const out = deriveRunCost({ ...cost, events: [], manifest: SESSION, closedAt: null, runStartAt: null });
  const haiku = mapped(subRows[0]);
  assert.ok(priceRequest(haiku).usd > priceAggregate(haiku).usd, 'the long-prompt rate is above the base rate');
  assert.deepEqual(out.tokensByModel['claude-opus-5-5'], { input: 1, output: 10, cacheRead: 0, cacheWrite5m: 40000, cacheWrite1h: 0 });
  assert.equal(priceRequest(mapped(mainRows[0])).cacheWriteUsd, (40000 * PRICES.families.opus[3]) / 1e6);
  assert.equal(out.costUsd, cents(priceRequest(haiku).usd + priceRequest(mapped(mainRows[0])).usd));
});

test('AC5.1: driver lane prices worker step usage keyed by launched model', () => {
  const sonnet = usage(30, 12000, 500000, 50000, [0, 50000]);
  const opus = usage(20, 3000, 200000, 10000);
  const events = [
    { step: 'policy', status: 'ok' },
    { step: 'worker', status: 'ok', model: 'sonnet', usage: sonnet },
    { step: 'review', status: 'ok', model: 'opus', usage: opus },
  ];
  const out = deriveRunCost({ rows: [], aggregates: [], sourcesRead: 0, sourcesUnread: 0, events, manifest: DRIVER, closedAt: null, runStartAt: null });
  assert.deepEqual(Object.keys(out.tokensByModel).sort(), ['opus', 'sonnet']);
  assert.deepEqual(out.tokensByModel.sonnet, { input: 30, output: 12000, cacheRead: 500000, cacheWrite5m: 0, cacheWrite1h: 50000 });
  const expected = cents(
    priceAggregate({ model: 'sonnet', input: 30, output: 12000, cacheRead: 500000, cacheWrite5m: 0, cacheWrite1h: 50000 }).usd
    + priceAggregate({ model: 'opus', input: 20, output: 3000, cacheRead: 200000, cacheWrite5m: 10000, cacheWrite1h: 0 }).usd,
  );
  assert.equal(out.costUsd, expected);
  assert.ok(out.costUsd > 0);
  assert.deepEqual(out.unpricedModels, []);
  assert.equal(out.costPartial, false);
  const withNull = deriveRunCost({ rows: [], aggregates: [], sourcesRead: 0, sourcesUnread: 0, events: [...events, { step: 'worker', status: 'fail', model: 'sonnet', usage: null }], manifest: DRIVER, closedAt: null, runStartAt: null });
  assert.equal(withNull.costPartial, true);
  assert.equal(withNull.costUsd, expected);
});

test('AC8.9: a headless lens-worker item on claude-haiku-5-5 over 100k prompt tokens is counted and priced at the base rate', () => {
  const item = { kind: 'worker', transcriptPath: null, transcriptModel: null, metaModel: 'claude-haiku-5-5', tokens: { input: 120000, output: 800, cacheRead: 30000, cacheCreate: 5000 } };
  const cost = costRowsFrom({ rows: [], transcripts: [], items: [item] });
  assert.deepEqual(cost.aggregates, [{ model: 'claude-haiku-5-5', input: 120000, output: 800, cacheRead: 30000, cacheWrite5m: 5000, cacheWrite1h: 0 }]);
  assert.deepEqual(cost.rows, []);
  const out = deriveRunCost({ ...cost, events: [], manifest: SESSION, closedAt: null, runStartAt: null });
  assert.deepEqual(out.tokensByModel['claude-haiku-5-5'], { input: 120000, output: 800, cacheRead: 30000, cacheWrite5m: 5000, cacheWrite1h: 0 });
  assert.equal(out.costUsd, cents(priceAggregate(cost.aggregates[0]).usd));
  assert.notEqual(out.costUsd, cents(priceRequest(cost.aggregates[0]).usd));
  assert.equal(out.costPartial, false);
});

test('AC8.10: a worker item with tokens null or no model makes costPartial true', () => {
  const good = { kind: 'worker', transcriptPath: null, transcriptModel: 'claude-haiku-5-5', metaModel: null, tokens: { input: 10, output: 10, cacheRead: 0, cacheCreate: 0 } };
  for (const bad of [
    { kind: 'worker', transcriptPath: null, transcriptModel: 'claude-haiku-5-5', metaModel: null, tokens: null },
    { kind: 'worker', transcriptPath: null, transcriptModel: null, metaModel: null, tokens: { input: 10, output: 10, cacheRead: 0, cacheCreate: 0 } },
  ]) {
    const cost = costRowsFrom({ rows: [], transcripts: [], items: [good, bad] });
    assert.deepEqual([cost.sourcesRead, cost.sourcesUnread, cost.aggregates.length], [1, 1, 1]);
    const out = deriveRunCost({ ...cost, events: [], manifest: SESSION, closedAt: null, runStartAt: null });
    assert.equal(out.costPartial, true);
    assert.equal(typeof out.costUsd, 'number');
  }
});

test('AC8.11: a driver-lane haiku step over 100k prompt tokens is priced at the base rate', () => {
  const events = [{ step: 'worker', status: 'ok', model: 'haiku', usage: usage(110000, 500, 40000, 0) }];
  const out = deriveRunCost({ rows: [], aggregates: [], sourcesRead: 0, sourcesUnread: 0, events, manifest: DRIVER, closedAt: null, runStartAt: null });
  const agg = { model: 'haiku', input: 110000, output: 500, cacheRead: 40000, cacheWrite5m: 0, cacheWrite1h: 0 };
  assert.equal(out.costUsd, cents(priceAggregate(agg).usd));
  assert.notEqual(out.costUsd, cents(priceRequest(agg).usd));
});

test('driver lane: a launch line with model and no usage key makes costPartial true', () => {
  const events = [
    { step: 'worker', status: 'ok', model: 'sonnet', usage: usage(1, 1000, 0, 0) },
    { step: 'worker', status: 'fail', model: 'sonnet', effort: null, profile: null, tests: 'scoped', detail: 'launcher threw' },
  ];
  const out = deriveRunCost({ rows: [], aggregates: [], sourcesRead: 0, sourcesUnread: 0, events, manifest: DRIVER, closedAt: null, runStartAt: null });
  assert.equal(out.costPartial, true);
  assert.equal(typeof out.costUsd, 'number');
});

test('driver lane: a merge-check line with a model and no usage makes costPartial true', () => {
  const events = [
    { step: 'worker', status: 'ok', model: 'sonnet', usage: usage(1, 1000, 0, 0) },
    { step: 'merge-check', status: 'stop', verdict: 'needs-human', floor: 'none', model: 'sonnet', effort: 'medium' },
  ];
  const out = deriveRunCost({ rows: [], aggregates: [], sourcesRead: 0, sourcesUnread: 0, events, manifest: DRIVER, closedAt: null, runStartAt: null });
  assert.equal(out.costPartial, true);
});

test('driver lane: merge-check and merge-acceptance lines with usage are priced and leave costPartial false', () => {
  const check = usage(9, 210, 3000, 400);
  const accept = usage(12, 340, 5000, 800, [800, 0]);
  const events = [
    { step: 'merge-check', status: 'ok', verdict: 'auto-merge', floor: 'none', model: 'sonnet', effort: 'medium', usage: check },
    { step: 'merge-acceptance', status: 'ok', route: 'try-it-only', model: 'sonnet', effort: null, usage: accept },
  ];
  const out = deriveRunCost({ rows: [], aggregates: [], sourcesRead: 0, sourcesUnread: 0, events, manifest: DRIVER, closedAt: null, runStartAt: null });
  assert.equal(out.costPartial, false);
  assert.deepEqual(out.tokensByModel.sonnet, { input: 21, output: 550, cacheRead: 8000, cacheWrite5m: 1200, cacheWrite1h: 0 });
  assert.equal(out.costUsd, cents(
    priceAggregate({ model: 'sonnet', input: 9, output: 210, cacheRead: 3000, cacheWrite5m: 400, cacheWrite1h: 0 }).usd
    + priceAggregate({ model: 'sonnet', input: 12, output: 340, cacheRead: 5000, cacheWrite5m: 800, cacheWrite1h: 0 }).usd,
  ));
});

test('driver lane: a never-launched review line (usage null, no model) leaves costPartial false', () => {
  const events = [
    { step: 'worker', status: 'ok', model: 'sonnet', usage: usage(1, 1000, 0, 0) },
    { step: 'review', status: 'fail', returned: 0, reproduced: 0, discarded: 0, usage: null, denials: [], costUsd: null, turns: null },
  ];
  const out = deriveRunCost({ rows: [], aggregates: [], sourcesRead: 0, sourcesUnread: 0, events, manifest: DRIVER, closedAt: null, runStartAt: null });
  assert.equal(out.costPartial, false);
  assert.deepEqual(Object.keys(out.tokensByModel), ['sonnet']);
});

test('driver lane ignores worker items', () => {
  const events = [{ step: 'worker', status: 'ok', model: 'sonnet', usage: usage(1, 1000, 0, 0) }];
  const base = deriveRunCost({ rows: [], aggregates: [], sourcesRead: 0, sourcesUnread: 0, events, manifest: DRIVER, closedAt: null, runStartAt: null });
  const item = { kind: 'worker', transcriptPath: null, transcriptModel: 'claude-haiku-5-5', metaModel: null, tokens: { input: 500000, output: 500000, cacheRead: 0, cacheCreate: 0 } };
  const cost = costRowsFrom({ rows: [], transcripts: [], items: [item, { kind: 'worker', transcriptPath: null, transcriptModel: null, metaModel: null, tokens: null }] });
  const out = deriveRunCost({ ...cost, events, manifest: DRIVER, closedAt: null, runStartAt: null });
  assert.deepEqual(out, base);
});

test('driver lane with no step lines gives costUsd null', () => {
  const out = deriveRunCost({ rows: [], aggregates: [], sourcesRead: 3, sourcesUnread: 0, events: [{ step: 'policy', status: 'ok' }, { step: 'final', status: 'ok', costUsd: 0.5 }], manifest: DRIVER, closedAt: null, runStartAt: null });
  assert.deepEqual([out.tokensByModel, out.costUsd, out.priceDate, out.unpricedModels, out.costPartial], [null, null, null, null, null]);
});

test('dedupes a transcript reached twice', async () => {
  const dir = scratchDir('run-cost-');
  const a = transcript(dir, 'a.jsonl', [
    line({ ts: '2026-11-26T10:00:00Z', id: 'x1', model: 'claude-opus-5-5', usage: usage(10, 100, 0, 0) }),
    line({ ts: '2026-11-26T10:00:01Z', id: undefined, model: 'claude-opus-5-5', usage: usage(1, 1, 0, 0) }),
  ]);
  const b = transcript(dir, 'b.jsonl', [
    line({ ts: '2026-11-26T10:01:00Z', id: 'x1', model: 'claude-opus-5-5', usage: usage(10, 100, 0, 0) }),
    line({ ts: '2026-11-26T10:01:01Z', id: 'y1', model: 'claude-opus-5-5', usage: usage(5, 50, 0, 0) }),
  ]);
  const aRows = await readUsage(a);
  const bRows = await readUsage(b);
  // The same file named as a transcript and as an item (by a relative spelling) is read once.
  const cost = costRowsFrom({
    rows: aRows,
    transcripts: [{ path: a, rows: aRows.length }],
    items: [{ transcriptPath: path.relative(process.cwd(), a), usageRows: aRows, notFound: null }, { transcriptPath: b, usageRows: bRows, notFound: null }],
  });
  assert.equal(cost.rows.length, aRows.length + bRows.length);
  const out = deriveRunCost({ ...cost, events: [], manifest: SESSION, closedAt: null, runStartAt: null });
  // x1 once (first wins), the id-less row kept, y1 once.
  assert.deepEqual(out.tokensByModel['claude-opus-5-5'], { input: 16, output: 151, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
});

test('minutes is elapsed wall-clock to one decimal', () => {
  const out = deriveRunCost(sessionInput([], { runStartAt: '2026-11-26T10:00:00Z', closedAt: '2026-11-26T10:12:30Z' }));
  assert.equal(out.minutes, 12.5);
  assert.equal(out.closedAt, '2026-11-26T10:12:30Z');
  assert.equal(deriveRunCost(sessionInput([], { closedAt: '2026-11-26T10:12:30Z' })).minutes, null);
  assert.equal(deriveRunCost(sessionInput([], { runStartAt: '2026-11-26T10:20:00Z', closedAt: '2026-11-26T10:12:30Z' })).minutes, null);
  const bad = deriveRunCost(sessionInput([], { runStartAt: '2026-11-26T10:00:00Z', closedAt: 'not a time' }));
  assert.deepEqual([bad.minutes, bad.closedAt], [null, null]);
});

test('a synthetic zero-usage row adds no key', () => {
  const synthetic = { model: '<synthetic>', messageId: 'z', inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreate: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
  const userRow = { model: null, messageId: null, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreate: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
  const out = deriveRunCost(sessionInput([synthetic, userRow]));
  assert.deepEqual(out.tokensByModel, {});
  assert.deepEqual(out.unpricedModels, []);
  assert.equal(out.costUsd, 0);
});
