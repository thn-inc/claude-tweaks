'use strict';
// plugin/bin/lib/run-manifest/cost.js — a run's list-price cost, by model (#6009). Pure: reads no file
// (canonicalRealpath resolves paths only) and spawns nothing.
//
// One token source per lane, chosen by `manifest.lane`:
// - session lanes: per-request transcript rows (readUsage-shaped), each priced with priceRequest, plus
//   the headless lens workers' whole-session `tokens` as aggregates, priced with priceAggregate;
// - the driver lane: the `usage` object on each driver-events.jsonl step line, a whole-session total
//   priced with priceAggregate and keyed by the model the launch resolved (the alias as launched).
// costUsd is null (never 0) when no source was read, and is rounded once, to cents, after summing.

const path = require('path');
const { canonicalRealpath } = require('../path-guard');
const { mergeUsage } = require('../timing/transcript');
const { PRICES, familyOf, priceRequest, priceAggregate } = require('../pricing/prices');

const TOKEN_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const realOf = (p, cwd) => { const abs = path.resolve(cwd, p); return canonicalRealpath(abs) ?? abs; };

// readUsage row -> the shape the pricers and tokensByModel take.
function mapRow(r) {
  return { model: r.model, input: r.inputTokens, output: r.outputTokens, cacheRead: r.cacheRead, cacheWrite5m: r.cacheWrite5m, cacheWrite1h: r.cacheWrite1h };
}

// UsageMax (mergeUsage's) -> the pricers' shape, under `model`.
function fromUsageMax(model, u) {
  return { model, input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite5m: u.cacheWrite5m, cacheWrite1h: u.cacheWrite1h };
}

const isZero = (u) => TOKEN_FIELDS.every((f) => !(Number(u[f]) > 0));

// deriveTiming's costRows -> { rows, aggregates, sourcesRead, sourcesUnread }. A transcript-backed
// item's rows join only when its transcript is not already one of the run's transcripts (by real path;
// relative paths resolve against costRows.cwd, as deriveTiming's reads did, else the process cwd).
function costRowsFrom(costRows) {
  const out = { rows: [], aggregates: [], sourcesRead: 0, sourcesUnread: 0 };
  if (!isObject(costRows)) return out;
  const transcripts = Array.isArray(costRows.transcripts) ? costRows.transcripts : [];
  const items = Array.isArray(costRows.items) ? costRows.items : [];
  const cwd = typeof costRows.cwd === 'string' ? costRows.cwd : process.cwd();
  if (Array.isArray(costRows.rows)) out.rows = costRows.rows.slice();
  const seen = new Set();
  for (const t of transcripts) {
    if (!isObject(t)) continue;
    if (typeof t.path === 'string') seen.add(realOf(t.path, cwd));
    if (t.rows > 0 || t.note === undefined || t.note === null) out.sourcesRead += 1;
    else if (typeof t.note === 'string' && t.note.startsWith('transcript not found')) out.sourcesUnread += 1;
  }
  for (const item of items) {
    if (!isObject(item)) continue;
    if (item.kind === 'worker') {
      const model = item.transcriptModel ?? item.metaModel;
      if (isObject(item.tokens) && typeof model === 'string' && model !== '') {
        const tk = item.tokens;
        out.aggregates.push({ model, input: Number(tk.input) || 0, output: Number(tk.output) || 0, cacheRead: Number(tk.cacheRead) || 0, cacheWrite5m: Number(tk.cacheCreate) || 0, cacheWrite1h: 0 });
        out.sourcesRead += 1;
      } else {
        out.sourcesUnread += 1;
      }
      continue;
    }
    if (typeof item.notFound === 'string' && item.notFound.includes('transcript not readable')) out.sourcesUnread += 1;
    if (!Array.isArray(item.usageRows) || typeof item.transcriptPath !== 'string') continue;
    const real = realOf(item.transcriptPath, cwd);
    if (seen.has(real)) continue;
    seen.add(real);
    out.rows = out.rows.concat(item.usageRows);
    out.sourcesRead += 1;
  }
  return out;
}

// Driver-lane step lines -> { aggregates, read, unread }. A line is a source when it has an own `usage`
// key or names a model: a `usage` object is read; a model with no usable `usage` (a launch that returned
// none, or threw after its model resolved) is unread; `usage: null` with no model (a review that never
// launched) is no source.
function driverSources(events) {
  const out = { aggregates: [], read: 0, unread: 0 };
  for (const line of Array.isArray(events) ? events : []) {
    if (!isObject(line)) continue;
    const hasUsage = Object.prototype.hasOwnProperty.call(line, 'usage');
    const model = typeof line.model === 'string' && line.model !== '' ? line.model : null;
    if (!hasUsage && model === null) continue;
    if (isObject(line.usage)) {
      out.aggregates.push(fromUsageMax(model ?? 'unknown', mergeUsage(null, line.usage)));
      out.read += 1;
    } else if (model !== null || line.usage !== null) {
      out.unread += 1;
    }
  }
  return out;
}

function timePair(closedAt, runStartAt) {
  const closedMs = typeof closedAt === 'string' ? Date.parse(closedAt) : NaN;
  const startMs = typeof runStartAt === 'string' ? Date.parse(runStartAt) : NaN;
  const closed = Number.isFinite(closedMs) ? closedAt : null;
  const elapsed = closedMs - startMs;
  const minutes = Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed / 6000) / 10 : null;
  return { minutes, closedAt: closed };
}

// { rows, aggregates, sourcesRead, sourcesUnread, events, manifest, closedAt, runStartAt }
//   -> { tokensByModel, costUsd, priceDate, unpricedModels, costPartial, minutes, closedAt }
function deriveRunCost({ rows, aggregates, sourcesRead, sourcesUnread, events, manifest, closedAt, runStartAt } = {}) {
  const time = timePair(closedAt, runStartAt);
  let requests = [];
  let wholes = [];
  let read;
  let unread;
  if (isObject(manifest) && manifest.lane === 'driver') {
    const driver = driverSources(events);
    wholes = driver.aggregates;
    read = driver.read;
    unread = driver.unread;
  } else {
    // Dedupe runs before the zero skip, so a zeroed row still claims its id: readUsage puts an id's merged
    // usage on its first row, and when the run-window clip removed that row the request is outside the run.
    const ids = new Set();
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!isObject(r)) continue;
      if (typeof r.messageId === 'string') {
        if (ids.has(r.messageId)) continue;
        ids.add(r.messageId);
      }
      requests.push(mapRow(r));
    }
    wholes = (Array.isArray(aggregates) ? aggregates : []).filter(isObject);
    read = Number(sourcesRead) || 0;
    unread = Number(sourcesUnread) || 0;
  }
  if (read === 0) {
    return { tokensByModel: null, costUsd: null, priceDate: null, unpricedModels: null, costPartial: null, ...time };
  }
  requests = requests.filter((u) => !isZero(u));
  wholes = wholes.filter((u) => !isZero(u));
  const tokensByModel = {};
  let usd = 0;
  const add = (u, pricer) => {
    const key = u.model ?? 'unknown';
    const n = { model: key };
    for (const f of TOKEN_FIELDS) n[f] = Number(u[f]) || 0;
    const sum = tokensByModel[key] || (tokensByModel[key] = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
    for (const f of TOKEN_FIELDS) sum[f] += n[f];
    usd += pricer(n).usd;
  };
  for (const u of requests) add(u, priceRequest);
  for (const u of wholes) add(u, priceAggregate);
  return {
    tokensByModel,
    costUsd: Math.round(usd * 100) / 100,
    priceDate: PRICES.date,
    unpricedModels: Object.keys(tokensByModel).filter((k) => familyOf(k) === 'unpriced').sort(),
    costPartial: unread > 0,
    ...time,
  };
}

module.exports = { deriveRunCost, costRowsFrom };
