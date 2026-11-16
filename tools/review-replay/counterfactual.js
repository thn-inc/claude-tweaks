'use strict';
// tools/review-replay/counterfactual.js — had each lens run one reviewer instead of a pair, how many of the findings the
// review went on to confirm would still have been raised? Reads each archived lens agent's own findings table from its
// transcript. A transcript whose final reply holds no table is unreadable, never an empty table.

const path = require('path');
const { readRun, selectRuns } = require('./archive.js');

const SPLIT = /\r?\n/;
const SEVERITIES = /^(critical|high|medium|low|info)$/;
const TRANSCRIPT_FILE = /^agent-(.+)\.jsonl$/;
const NEAR_LINES = 5;

// The rows of a `| sev | path:line | text |` table; null when the text holds neither a row nor "No findings".
function parseFindingsTable(text) {
  const rows = [];
  for (const line of String(text).split(SPLIT)) {
    const c = line.split('|').map((s) => s.trim());
    if (c.length < 5) continue;
    const sev = c[1].toLowerCase().replace(/[*`]/g, '');
    if (!SEVERITIES.test(sev)) continue;
    const m = c[2].replace(/[`*]/g, '').match(/^(.+?):(\d+)/);
    if (!m) continue;
    rows.push({ sev, path: m[1].trim(), line: Number(m[2]), text: c[3] });
  }
  if (rows.length > 0) return rows;
  return /No findings/i.test(String(text)) ? [] : null;
}

// Every agent-{id}.jsonl under `dir`, recursively: id -> file.
function indexTranscripts(dir, fs) {
  const index = new Map();
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else {
        const m = TRANSCRIPT_FILE.exec(e.name);
        if (m) index.set(m[1], path.join(d, e.name));
      }
    }
  };
  walk(dir);
  return index;
}

// The text of the last assistant message that has any; null when the transcript cannot be read or has none.
function lastAssistantText(file, fs) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let last = null;
  for (const line of raw.split(SPLIT)) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || e.type !== 'assistant' || !e.message) continue;
    const content = e.message.content;
    if (typeof content === 'string') {
      last = content;
      continue;
    }
    if (!Array.isArray(content)) continue;
    const texts = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
    if (texts.length > 0) last = texts.join('\n');
  }
  return last;
}

const near = (row, p, l) => row.path === p && Math.abs(row.line - l) <= NEAR_LINES;
const share = (a, b) => (b === 0 ? null : a / b);

// One reviewer's rows by lens and side for a run; a side with no transcript or no table is `rows: null`.
function lensPairs(r, index, fs) {
  const by = new Map();
  for (const a of r.lensAgents) {
    if (!a.side) continue;
    const file = a.agentId ? index.get(a.agentId) : undefined;
    const text = file ? lastAssistantText(file, fs) : null;
    const pair = by.get(a.lens) || {};
    pair[a.side] = { rows: text === null ? null : parseFindingsTable(text) };
    by.set(a.lens, pair);
  }
  return [...by.entries()].filter(([, pair]) => pair.A && pair.B);
}

function counterfactual(opts, deps) {
  const { dirs, missing } = selectRuns(opts.runs, opts.select, deps.fs);
  if (missing.length > 0) {
    deps.err(`review-replay.js: no such run under ${opts.runs}: ${missing.join(', ')}`);
    return 2;
  }
  const index = indexTranscripts(opts.transcripts, deps.fs);
  const t = { runs: 0, pairs: 0, transcripts: 0, unreadable: 0, confirmed: 0, located: 0, byA: 0, byB: 0, byBoth: 0, refuted: 0, refA: 0, refB: 0 };
  for (const dir of dirs) {
    const r = readRun(dir, deps);
    if (r.excluded) continue;
    const pairs = lensPairs(r, index, deps.fs);
    if (pairs.length === 0) continue;
    t.runs += 1;
    const confirmed = [...r.pairConfirmed, ...r.verdicts.filter((v) => v.verdict === 'confirmed')];
    const refuted = r.verdicts.filter((v) => v.verdict === 'refuted');
    for (const [lens, pair] of pairs) {
      t.pairs += 1;
      t.transcripts += 2;
      const readable = pair.A.rows !== null && pair.B.rows !== null;
      t.unreadable += (pair.A.rows === null ? 1 : 0) + (pair.B.rows === null ? 1 : 0);
      if (!readable) continue;
      for (const c of confirmed.filter((x) => x.lens === lens)) {
        const a = pair.A.rows.some((x) => near(x, c.path, c.line));
        const b = pair.B.rows.some((x) => near(x, c.path, c.line));
        t.confirmed += 1;
        if (a || b) t.located += 1;
        if (a) t.byA += 1;
        if (b) t.byB += 1;
        if (a && b) t.byBoth += 1;
      }
      for (const c of refuted.filter((x) => x.lens === lens)) {
        t.refuted += 1;
        if (pair.A.rows.some((x) => near(x, c.path, c.line))) t.refA += 1;
        if (pair.B.rows.some((x) => near(x, c.path, c.line))) t.refB += 1;
      }
    }
  }
  deps.log(JSON.stringify({
    runs: t.runs,
    lensPairs: t.pairs,
    transcripts: { total: t.transcripts, unreadable: t.unreadable, unreadableShare: share(t.unreadable, t.transcripts) },
    confirmed: { total: t.confirmed, located: t.located, byA: t.byA, byB: t.byB, byBoth: t.byBoth, singleReviewerShare: share((t.byA + t.byB) / 2, t.located) },
    refuted: { total: t.refuted, byA: t.refA, byB: t.refB },
  }, null, 2));
  return 0;
}

module.exports = { counterfactual, parseFindingsTable };
