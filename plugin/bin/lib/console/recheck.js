// bin/lib/console/recheck.js
// Pure: the wrap-up follow-up re-check's candidate selection and item parsing (#6284). Open
// follow-up records whose `### Key Files` intersect the run's changed paths are judged by an
// agent; this module decides which records are judged and what items the judge reads.
//   parseJudgedItems   record body -> the `## Deliverables` items, else the Acceptance Criteria texts
//   parseChangedPaths  `git diff --name-status -M` output -> changed paths (both sides of a rename)
//   selectCandidates   open records + changed paths -> { candidates, overCap, excluded }
// No fs, no process: the CLI owns reading records and running git.
'use strict';

const crypto = require('crypto');
const { findSection } = require('../markdown-blocks');
const { extractKeyFiles } = require('../issues/grouping');
const { normalizeLabelNames } = require('../issues/record');
const { parseAcceptanceCriteria } = require('../wrap-up/packet-gather');

const RECHECK_CAP = 5;
const HUNK_BYTE_CAP = 24000;
const EXCLUDED_LABELS = ['parent-issue', 'bot:in-progress', 'digest'];

const ITEM_RE = /^[-*][ \t]+(?:\[[ xX]\][ \t]+)?(.*\S.*)$/;

function parseJudgedItems(body) {
  if (typeof body !== 'string' || body === '') return [];
  const text = body.replace(/\r\n/g, '\n');
  const section = findSection(text, 'Deliverables');
  if (section !== null) {
    const items = [];
    let open = false;
    for (const line of section.split('\n')) {
      const m = ITEM_RE.exec(line);
      if (m) {
        items.push(m[1].trim());
        open = true;
      } else if (open && /^[ \t]+\S/.test(line)) {
        items[items.length - 1] += ` ${line.trim()}`;
      } else {
        open = false;
      }
    }
    if (items.length > 0) return items;
  }
  return parseAcceptanceCriteria(text).map((c) => c.text);
}

function parseChangedPaths(nameStatus) {
  const seen = new Set();
  for (const line of String(nameStatus || '').split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const [, ...paths] = line.split('\t');
    for (const p of paths) if (p !== '') seen.add(p);
  }
  return [...seen];
}

function selectCandidates({ openRecords, changedPaths, hubPaths, ownRecords, cap = RECHECK_CAP }) {
  const changed = new Set(changedPaths);
  const own = new Set(ownRecords);
  const qualifying = [];
  const excluded = [];
  const sorted = [...openRecords].sort((a, b) => a.number - b.number);
  for (const record of sorted) {
    const intersecting = [...new Set(extractKeyFiles(record))].filter((f) => changed.has(f));
    if (intersecting.length === 0) continue;
    const names = normalizeLabelNames(record.labels);
    const label = EXCLUDED_LABELS.find((l) => names.includes(l));
    if (label) {
      excluded.push({ number: record.number, reason: `label:${label}` });
      continue;
    }
    if (own.has(record.number)) {
      excluded.push({ number: record.number, reason: 'own' });
      continue;
    }
    const nonHub = intersecting.filter((f) => !hubPaths.has(f));
    if (nonHub.length === 0) {
      excluded.push({ number: record.number, reason: 'hub-only' });
      continue;
    }
    const items = parseJudgedItems(record.body);
    if (items.length === 0) {
      excluded.push({ number: record.number, reason: 'no-items' });
      continue;
    }
    qualifying.push({
      number: record.number,
      title: record.title,
      intersecting: nonHub,
      items,
      bodyHash: crypto.createHash('sha256').update(record.body || '').digest('hex'),
      updatedAt: record.updatedAt,
    });
  }
  return {
    candidates: qualifying.slice(0, cap),
    overCap: qualifying.slice(cap).map((c) => c.number),
    excluded,
  };
}

function diffPath(line, prefix) {
  const rest = line.slice(4).split('\t')[0].trim();
  if (rest === '/dev/null') return null;
  return rest.startsWith(prefix) ? rest.slice(prefix.length) : rest;
}

// A unified diff -> Map<path, hunk text[]>: the `+++ b/` path, the `--- a/` path for a deletion.
function splitHunks(unifiedDiff) {
  const out = new Map();
  let from = null;
  let target = null;
  let current = null;
  for (const line of String(unifiedDiff || '').split(/\r?\n/)) {
    if (current === null && line.startsWith('--- ')) {
      from = diffPath(line, 'a/');
    } else if (current === null && line.startsWith('+++ ')) {
      target = diffPath(line, 'b/') || from;
    } else if (line.startsWith('diff --git ')) {
      current = null;
      from = null;
      target = null;
    } else if (line.startsWith('@@')) {
      if (target === null) continue;
      if (!out.has(target)) out.set(target, []);
      current = [line];
      out.get(target).push(current);
    } else if (current !== null) {
      current.push(line);
    }
  }
  for (const [p, hunks] of out) out.set(p, hunks.map((lines) => lines.join('\n').replace(/\n+$/, '')));
  return out;
}

const stripMarker = (line) => (/^[-+ ]/.test(line) ? line.slice(1) : line);
const squash = (lines) => lines.map(stripMarker).join(' ').replace(/\s+/g, ' ').trim();

// The judge's quote is a citation: it must appear, normalized, inside ONE hunk (never spanning two).
function quoteFound(quote, hunks) {
  const q = squash(String(quote || '').split(/\r?\n/));
  if (q === '') return false;
  return (hunks || []).some((hunk) =>
    squash(hunk.split(/\r?\n/).filter((l) => !l.startsWith('@@') && !l.startsWith('\\'))).includes(q));
}

const VERDICTS = new Set(['satisfied', 'not-satisfied', 'cant-tell']);

function checkVerdicts({ items, verdicts, hunks }) {
  const list = Array.isArray(verdicts) ? verdicts : [];
  return items.map((item, i) => {
    const v = list.find((x) => x && x.deliverable === item) || list.find((x) => x && String(x.deliverable) === String(i + 1));
    const none = { item, verdict: 'cant-tell', quote: null };
    if (!v || !hunks || hunks.length === 0 || !VERDICTS.has(v.verdict)) return none;
    if (v.verdict === 'satisfied') {
      return typeof v.quote === 'string' && quoteFound(v.quote, hunks)
        ? { item, verdict: 'satisfied', quote: v.quote }
        : none;
    }
    return { item, verdict: v.verdict, quote: null };
  });
}

function outcomeFor(checked) {
  const satisfied = checked.filter((c) => c.verdict === 'satisfied').length;
  if (satisfied === 0) return null;
  return satisfied === checked.length ? 'close' : 'narrow';
}

function composeProposal({ number, title, outcome, checked, bodyHash, updatedAt, runId }) {
  const label = outcome === 'close' ? 'Close' : 'Narrow';
  const lines = [
    `Title: ${label} #${number}: ${title}`,
    `Target: #${number}`,
    `Action: ${outcome}`,
    `Body-hash: ${bodyHash}`,
    `Updated-at: ${updatedAt}`,
    `Run: ${runId}`,
    '',
    '## Comment',
    '',
    outcome === 'close'
      ? "This run's changes appear to satisfy every deliverable:"
      : "This run's changes appear to satisfy these deliverables (the rest remain open):",
    '',
  ];
  for (const c of checked) {
    lines.push(`- ${c.item} — ${c.verdict}`);
    if (c.verdict === 'satisfied' && c.quote) {
      const longest = Math.max(0, ...(c.quote.match(/`+/g) || []).map((r) => r.length));
      const fence = '`'.repeat(Math.max(3, longest + 1));
      lines.push('', fence, c.quote, fence, '');
    }
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function parseProposal(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const head = {};
  let i = 0;
  for (; i < lines.length && lines[i] !== ''; i++) {
    const m = /^([A-Za-z-]+):[ \t]*(.*)$/.exec(lines[i]);
    if (m) head[m[1]] = m[2].trim();
  }
  const target = /^#(\d+)$/.exec(head.Target || '');
  if (!target) return null;
  if (head.Action !== 'close' && head.Action !== 'narrow') return null;
  if (!/^[0-9a-f]{64}$/.test(head['Body-hash'] || '')) return null;
  if (!head['Updated-at']) return null;
  const at = lines.findIndex((l, idx) => idx >= i && l.trim() === '## Comment');
  if (at === -1) return null;
  return {
    number: Number(target[1]),
    action: head.Action,
    bodyHash: head['Body-hash'],
    updatedAt: head['Updated-at'],
    comment: lines.slice(at + 1).join('\n').trim(),
  };
}

function judgeHunks(hunksByPath, intersecting, cap = HUNK_BYTE_CAP) {
  const hunks = [];
  let bytes = 0;
  for (const p of intersecting) {
    for (const h of hunksByPath.get(p) || []) {
      bytes += Buffer.byteLength(h);
      hunks.push(h);
    }
  }
  return bytes > cap ? { hunks: [], overCap: true } : { hunks, overCap: false };
}

module.exports = {
  RECHECK_CAP, HUNK_BYTE_CAP, EXCLUDED_LABELS, parseJudgedItems, parseChangedPaths, selectCandidates,
  splitHunks, quoteFound, checkVerdicts, outcomeFor, composeProposal, parseProposal, judgeHunks,
};
