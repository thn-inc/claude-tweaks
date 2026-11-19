'use strict';
// tools/pipeline-cost-report/guards.js — the quality-guard readers of the cost report (#5916).
//
// selectColumns drops runs that are not pipeline runs (a name with a `spec-`/`record-` segment, or a top-level
// timing.json with a name not ending `-standalone`), then cuts the last `n` eligible runs dated before the split
// and the first `n` dated on or after it, each in ascending name order. readTiming reads a run's top-level
// timing.json: null when absent, a throw when present but unparseable or without a `dispatches.items` array.
// readReport finds a subagent's transcript at {root}/{any slug}/{session}/subagents/agent-{id}.jsonl and returns
// its final report: the last assistant text block, or a later SubagentHandback message. parseReviewCounts counts
// the top-level items under Critical/Important/Minor headings; null when none of the three headings is present.
// collectWholeBranch is guard 1: the share of whole-branch reviews that found a Critical or Important issue.
// Reports that cannot be found or parsed are counted `unparsed` and left out of the share. Read-only.

const fs = require('fs');
const path = require('path');

const PIPELINE_NAME_RE = /(^|-)(spec|record)-/;
const SEVERITY_RE = /^#{1,6}\s+(Critical|Important|Minor)\b/i;
const HEADING_RE = /^#{1,6}\s/;
const ITEM_RE = /^(\d+[.)]|[-*+])\s+(.*)$/;

function hasTiming(run, fsImpl) {
  try {
    fsImpl.statSync(path.join(run.dir, 'timing.json'));
    return true;
  } catch {
    return false;
  }
}

function eligible(run, fsImpl) {
  if (PIPELINE_NAME_RE.test(run.name)) return true;
  return !run.name.endsWith('-standalone') && hasTiming(run, fsImpl);
}

// { before: Run[], after: Run[] } — ineligible runs are in neither column.
function selectColumns(runs, { split, n, fsImpl = fs } = {}) {
  const sorted = runs.filter((r) => eligible(r, fsImpl)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const before = sorted.filter((r) => r.date < split);
  const after = sorted.filter((r) => r.date >= split);
  return { before: n > 0 ? before.slice(-n) : [], after: after.slice(0, Math.max(n, 0)) };
}

// { critical, important, minor } or null when the text has none of the three headings.
function parseReviewCounts(text) {
  const counts = { critical: 0, important: 0, minor: 0 };
  let seen = false;
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const sev = SEVERITY_RE.exec(line);
    if (sev) {
      seen = true;
      current = sev[1].toLowerCase();
      continue;
    }
    if (HEADING_RE.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    const item = ITEM_RE.exec(line);
    if (!item) continue;
    const bare = item[2].replace(/[*`]/g, '').replace(/\.+\s*$/, '').trim();
    if (/^(none|n\/a)$/i.test(bare)) continue;
    counts[current] += 1;
  }
  return seen ? counts : null;
}

// { items, sessions } | null (absent). Throws when the file exists but is not a usable timing.json.
function readTiming(runDir, fsImpl = fs) {
  let raw;
  try {
    raw = fsImpl.readFileSync(path.join(runDir, 'timing.json'), 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
  const data = JSON.parse(raw);
  const items = data && data.dispatches && data.dispatches.items;
  if (!Array.isArray(items)) throw new Error('timing.json has no dispatches.items array');
  const transcripts = Array.isArray(data.transcripts) ? data.transcripts : [];
  const sessions = [];
  for (const t of transcripts) {
    if (!t || typeof t.path !== 'string') continue;
    const base = t.path.split(/[\\/]/).pop().replace(/\.jsonl$/, '');
    if (base) sessions.push(base);
  }
  return { items, sessions };
}

function lastReport(raw) {
  let last = null;
  for (const line of raw.split('\n')) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const content = obj && obj.type === 'assistant' && obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block) continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text) last = block.text;
      else if (block.type === 'tool_use' && block.name === 'SubagentHandback' && block.input && typeof block.input.message === 'string') last = block.input.message;
    }
  }
  return last;
}

// The report of the first transcript file found for this agent; null when no file or no report in it.
function readReport({ roots, sessions, agentId }, fsImpl = fs) {
  for (const root of roots || []) {
    let slugs;
    try {
      slugs = fsImpl.readdirSync(root);
    } catch {
      continue;
    }
    for (const slug of slugs) {
      for (const session of sessions || []) {
        const file = path.join(root, slug, session, 'subagents', `agent-${agentId}.jsonl`);
        let raw;
        try {
          raw = fsImpl.readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        return lastReport(raw);
      }
    }
  }
  return null;
}

const isWholeBranch = (d) => d && (d.role === 'whole-branch review' || (d.role === 'unlabelled' && /^final review\b/i.test(String(d.description || ''))));

function collectWholeBranch(runs, { roots, fsImpl = fs } = {}) {
  let n = 0;
  let unparsed = 0;
  let withIssue = 0;
  let critical = 0;
  let important = 0;
  for (const run of runs) {
    let timing;
    try {
      timing = readTiming(run.dir, fsImpl);
    } catch {
      unparsed += 1;
      continue;
    }
    if (!timing) continue;
    for (const d of timing.items) {
      if (!isWholeBranch(d)) continue;
      const text = readReport({ roots, sessions: timing.sessions, agentId: d.agentId }, fsImpl);
      const counts = text == null ? null : parseReviewCounts(text);
      if (!counts) {
        unparsed += 1;
        continue;
      }
      n += 1;
      critical += counts.critical;
      important += counts.important;
      if (counts.critical + counts.important > 0) withIssue += 1;
    }
  }
  return {
    share: n ? withIssue / n : null,
    meanCritical: n ? critical / n : null,
    meanImportant: n ? important / n : null,
    n,
    unparsed,
  };
}

module.exports = { selectColumns, parseReviewCounts, readTiming, readReport, collectWholeBranch };
