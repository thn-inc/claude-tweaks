'use strict';
// tools/pipeline-cost-report/spend.js — prices the model requests in a Claude Code transcript (#5914).
//
// scanTranscript streams a transcript's raw JSONL lines and returns one Request per message.id, in transcript
// order. Per message.id it keeps the maximum of input_tokens, output_tokens, cache_read_input_tokens and
// cache_creation_input_tokens across the lines that repeat the id (the usage grows while a response streams, so
// neither the first line nor a per-line sum is right) — the same rule as plugin/bin/lib/timing/transcript.js's
// readUsage. It does not call readUsage because readUsage drops what this report needs: the 5-minute / 1-hour
// cache-write split (usage.cache_creation), the compaction marker, and message.id itself. The split is read from
// the line holding the largest cache write; a line without one prices all of the write at the 5-minute rate.
//
// Each Request also carries `cause`, why a cache re-write (write > 40,000 tokens and > half the prompt) happened,
// first match wins: session start, model switch, compaction, idle (>= 1 hour since the previous model call),
// else ordinary growth. A request that is not a re-write is ordinary growth. The previous call is tracked
// across the whole file, so calls before any reporting window still count.
//
// Prices are dollars per million tokens, dated PRICES.date. An unrecognised model id is `unpriced`: counted
// and returned with zero cost, never priced.

const fs = require('fs');
const readline = require('readline');

// [input, output, cache read, 5-minute cache write, 1-hour cache write]
const PRICES = {
  date: '2026-11-03',
  families: {
    fable: [8, 40, 0.2, 10, 16],
    opus: [4, 20, 0.2, 5, 8],
    sonnet: [2, 10, 0.1, 2.5, 4],
    haiku: [0.1, 0.5, 0.01, 0.125, 0.2],
  },
};

// Claude Code writes `<synthetic>` assistant lines (zero usage) for API errors such as usage_limit_reached. They are
// kept in `requests` (counted, unpriced) but are not model calls: they never serve as the previous call for the
// family or idle-gap check and never use up a pending compaction marker. Any other unpriced id is a real call of an
// unknown family and stays in the chain.
const SYNTHETIC_MODEL = '<synthetic>';
const HAIKU_LONG_PROMPT = 100000;
const HAIKU_LONG_MULTIPLIER = 5;
const REWRITE_MIN_TOKENS = 40000;
const IDLE_MS = 60 * 60 * 1000;
const BUCKET_EDGES = [50000, 100000, 150000, 200000, 300000, 400000, 500000, 700000];
const BUCKET_NAMES = ['<50', '50-100', '100-150', '150-200', '200-300', '300-400', '400-500', '500-700', '>700'];

function familyOf(modelId) {
  const id = typeof modelId === 'string' ? modelId : '';
  for (const family of Object.keys(PRICES.families)) if (id.includes(family)) return family;
  return 'unpriced';
}

function bucketOf(promptTokens) {
  const i = BUCKET_EDGES.findIndex((edge) => promptTokens < edge);
  return BUCKET_NAMES[i === -1 ? BUCKET_NAMES.length - 1 : i];
}

// u: { model, input, output, cacheRead, cacheWrite5m, cacheWrite1h } -> { usd, cacheWriteUsd, prompt, family }
function priceRequest(u) {
  const family = familyOf(u.model);
  const prompt = u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
  if (family === 'unpriced') return { usd: 0, cacheWriteUsd: 0, prompt, family };
  const [pIn, pOut, pRead, pW5, pW1] = PRICES.families[family];
  const k = family === 'haiku' && prompt > HAIKU_LONG_PROMPT ? HAIKU_LONG_MULTIPLIER : 1;
  const cacheWriteUsd = ((u.cacheWrite5m * pW5 + u.cacheWrite1h * pW1) * k) / 1e6;
  const usd = ((u.input * pIn + u.output * pOut + u.cacheRead * pRead) * k) / 1e6 + cacheWriteUsd;
  return { usd, cacheWriteUsd, prompt, family };
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('\n');
}

const COMMAND_RE = /<command-name>\s*\/?claude-tweaks:([^<\s]+?)\s*<\/command-name>/;
const SKILL_RE = /^claude-tweaks:(.+)$/;

function skillOfLine(line) {
  const message = line.message;
  if (!message) return null;
  if (line.type === 'user') {
    const m = COMMAND_RE.exec(textOf(message.content));
    return m ? m[1] : null;
  }
  if (line.type === 'assistant' && Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block && block.type === 'tool_use' && block.name === 'Skill' && block.input && typeof block.input.skill === 'string') {
        const m = SKILL_RE.exec(block.input.skill);
        if (m) return m[1];
      }
    }
  }
  return null;
}

function isCompactionMarker(line) {
  return (line.type === 'system' && line.subtype === 'compact_boundary') || line.isCompactSummary === true;
}

async function scanTranscript(file, { fsImpl = fs } = {}) {
  const out = { cwd: null, firstSkill: null, requests: [] };
  const byId = new Map();
  let compactionPending = false;
  const rl = readline.createInterface({ input: fsImpl.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const raw of rl) {
    if (!raw) continue;
    let line;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!line || typeof line !== 'object') continue;
    if (out.cwd === null && typeof line.cwd === 'string' && line.cwd) out.cwd = line.cwd;
    if (out.firstSkill === null) out.firstSkill = skillOfLine(line);
    if (isCompactionMarker(line)) compactionPending = true;
    const message = line.message;
    if (line.type !== 'assistant' || !message || typeof message.id !== 'string' || !message.usage) continue;
    const usage = message.usage;
    let r = byId.get(message.id);
    if (!r) {
      const synthetic = message.model === SYNTHETIC_MODEL;
      r = { id: message.id, ts: line.timestamp || null, model: message.model || '', synthetic, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, afterCompaction: compactionPending && !synthetic };
      if (!synthetic) compactionPending = false;
      byId.set(message.id, r);
      out.requests.push(r);
    }
    r.input = Math.max(r.input, num(usage.input_tokens));
    r.output = Math.max(r.output, num(usage.output_tokens));
    r.cacheRead = Math.max(r.cacheRead, num(usage.cache_read_input_tokens));
    const write = num(usage.cache_creation_input_tokens);
    if (write > r.cacheWrite) {
      r.cacheWrite = write;
      r.cacheWrite1h = Math.min(write, num(usage.cache_creation && usage.cache_creation.ephemeral_1h_input_tokens));
    }
    if (!r.model && message.model) r.model = message.model;
  }

  let prev = null;
  out.requests = out.requests.map((r) => {
    const cacheWrite5m = r.cacheWrite - r.cacheWrite1h;
    const priced = priceRequest({ model: r.model, input: r.input, output: r.output, cacheRead: r.cacheRead, cacheWrite5m, cacheWrite1h: r.cacheWrite1h });
    const rewrite = r.cacheWrite > REWRITE_MIN_TOKENS && r.cacheWrite > priced.prompt / 2;
    let cause = 'ordinary growth';
    if (rewrite) {
      const gap = prev && r.ts && prev.ts ? Date.parse(r.ts) - Date.parse(prev.ts) : NaN;
      if (!prev) cause = 'session start';
      else if (prev.family !== priced.family) cause = 'model switch';
      else if (r.afterCompaction) cause = 'compaction';
      else if (gap >= IDLE_MS) cause = 'idle';
    }
    if (!r.synthetic) prev = { family: priced.family, ts: r.ts };
    return {
      id: r.id,
      ts: r.ts,
      model: r.model,
      family: priced.family,
      input: r.input,
      output: r.output,
      cacheRead: r.cacheRead,
      cacheWrite: r.cacheWrite,
      cacheWrite5m,
      cacheWrite1h: r.cacheWrite1h,
      prompt: priced.prompt,
      usd: priced.usd,
      cacheWriteUsd: priced.cacheWriteUsd,
      cause,
    };
  });
  return out;
}

module.exports = { PRICES, familyOf, bucketOf, priceRequest, scanTranscript };
