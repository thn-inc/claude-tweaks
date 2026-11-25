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

module.exports = { RECHECK_CAP, HUNK_BYTE_CAP, EXCLUDED_LABELS, parseJudgedItems, parseChangedPaths, selectCandidates };
