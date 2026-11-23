'use strict';
// tools/pipeline-cost-report/guards.js — the quality-guard readers of the cost report (#5916).
//
// selectColumns first resolves each top-level run that holds no timing.json to its archive/{name} copy when that has
// one (archiving leaves a stub with only work/ at the top level; the run's dir and members then come from the copy),
// drops runs that are not pipeline runs (a name with a `spec-`/`record-` segment, or a timing.json and a name not
// ending `-standalone`), then cuts the last `n` eligible runs dated before the split and the first `n` dated on or
// after it, each in ascending name order. readTiming reads a run's timing.json: null when absent, a throw when
// present but unparseable or without a `dispatches.items` array.
// readReport finds a subagent's transcript at {root}/{any slug}/{session}/subagents/agent-{id}.jsonl and returns
// its final report: the last assistant text block, or a later SubagentHandback message. parseReviewCounts counts
// the top-level items under Critical/Important/Minor headings; null when none of the three headings is present.
// collectWholeBranch is guard 1: the share of whole-branch reviews that found a Critical or Important issue.
// Reports that cannot be found or parsed are counted `unparsed` and left out of the share. collectFirstPass is guard 2
// (tasks that needed no re-review); collectPostMergeBugs is guard 3 (bug records filed within 14 days of a merge that
// changed a file the bug names under Key Files). Read-only.

const fs = require('fs');
const path = require('path');
const { findSection } = require('../../plugin/bin/lib/markdown-blocks.js');
const { isAgentTranscriptPath } = require('../../plugin/bin/lib/timing/transcript');

const PIPELINE_NAME_RE = /(^|-)(spec|record)-/;
const SEVERITY_RE = /^#{1,6}\s+(Critical|Important|Minor)\b/i;
const HEADING_RE = /^#{1,6}\s/;
const MEMBER_RE = /^spec-(\d+)$/;
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

// The spec-{N} member directories of a run directory; empty when it cannot be read.
function membersOf(dir, fsImpl) {
  const members = [];
  try {
    for (const e of fsImpl.readdirSync(dir, { withFileTypes: true })) {
      const m = MEMBER_RE.exec(e.name);
      if (m && e.isDirectory()) members.push({ id: Number(m[1]), dir: path.join(dir, e.name) });
    }
  } catch {
    // An unreadable directory has no members.
  }
  return members;
}

// A top-level run with no timing.json of its own, read from archive/{name} when that holds one.
function resolveRun(run, fsImpl) {
  if (run.archived || hasTiming(run, fsImpl)) return run;
  const dir = path.join(path.dirname(run.dir), 'archive', run.name);
  if (!hasTiming({ dir }, fsImpl)) return run;
  return { ...run, dir, members: membersOf(dir, fsImpl) };
}

function compareByName(a, b) {
  if (a.name < b.name) return -1;
  return a.name > b.name ? 1 : 0;
}

// { before: Run[], after: Run[] } — ineligible runs are in neither column.
function selectColumns(runs, { split, n, fsImpl = fs } = {}) {
  const sorted = runs.map((r) => resolveRun(r, fsImpl)).filter((r) => eligible(r, fsImpl)).sort(compareByName);
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
    const parts = t.path.split(/[\\/]/);
    // A Task-call agent file is {sessionId}/subagents/agent-{id}.jsonl: its session is the parent of its `subagents/` directory.
    const isAgent = isAgentTranscriptPath(t.path);
    const base = isAgent ? parts[parts.length - 3] : parts[parts.length - 1].replace(/\.jsonl$/, '');
    if (base && !sessions.includes(base)) sessions.push(base);
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

// A `whole-branch review` dispatch always counts. An unlabelled one counts when its description starts `final review`
// or names `whole-branch`, unless it names a `fix wave` (the implementers that fix the review's findings).
const isWholeBranch = (d) => {
  if (!d) return false;
  if (d.role === 'whole-branch review') return true;
  if (d.role !== 'unlabelled') return false;
  const text = String(d.description || '');
  return (/^final review\b/i.test(text) || /whole-branch/i.test(text)) && !/fix wave/i.test(text);
};

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

const TASK_ROLES = new Set(['implementer', 'task review', 're-review']);
const TASK_NUM_RE = /\bTask\s+(\d+)\b/i;
const RECORD_RE = /#(\d+)/;
const FIX_WAVE_RE = /fix wave/i;

// Guard 2: the share of tasks whose group holds no re-review. A task is keyed by run, parent agent, record and task
// number; a dispatch naming no task is `unparsed`, except a fix-wave one (the final review's fixes), which is dropped.
// A dispatch naming no record joins the record that every record-naming implementer of its task number (same parent)
// names; with none, or two different ones, it stays record-less. Groups that cannot be told apart or lack an
// implementer are counted `unparsed`, not tasks. A task's tier is that of its earliest implementer.
function collectFirstPass(runs, { fsImpl = fs } = {}) {
  let unparsed = 0;
  let passed = 0;
  let n = 0;
  const tiers = {};
  for (const run of runs) {
    let timing;
    try {
      timing = readTiming(run.dir, fsImpl);
    } catch {
      unparsed += 1;
      continue;
    }
    if (!timing) continue;
    const parsed = [];
    for (const d of timing.items) {
      if (!d || !TASK_ROLES.has(d.role)) continue;
      const description = String(d.description || '');
      const num = TASK_NUM_RE.exec(description);
      if (!num) {
        if (!FIX_WAVE_RE.test(description)) unparsed += 1;
        continue;
      }
      const rec = RECORD_RE.exec(description);
      parsed.push({ d, description, parent: d.parentAgentId || '', task: num[1], record: rec ? rec[1] : '' });
    }
    const lent = new Map();
    for (const p of parsed) {
      if (p.d.role !== 'implementer' || !p.record) continue;
      const k = `${p.parent}\0${p.task}`;
      if (!lent.has(k)) lent.set(k, new Set());
      lent.get(k).add(p.record);
    }
    for (const p of parsed) {
      const set = p.record ? null : lent.get(`${p.parent}\0${p.task}`);
      if (set && set.size === 1) p.record = [...set][0];
    }
    const groups = new Map();
    for (const p of parsed) {
      const k = `${p.parent}\0${p.record}\0${p.task}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    const multi = Array.isArray(run.members) && run.members.length > 1;
    for (const group of groups.values()) {
      const impls = group.filter((p) => p.d.role === 'implementer');
      if (!impls.length) {
        unparsed += 1;
        continue;
      }
      if (multi && !group[0].record && new Set(impls.map((p) => p.description)).size >= 2) {
        unparsed += 1;
        continue;
      }
      const ts = (p) => (p.d.startTs ? String(p.d.startTs) : null);
      let first = impls[0];
      for (const p of impls.slice(1)) {
        const a = ts(p);
        const b = ts(first);
        if (a !== null && (b === null || a < b)) first = p;
      }
      const tier = first.d.tier || 'unknown';
      const ok = !group.some((p) => p.d.role === 're-review');
      n += 1;
      if (ok) passed += 1;
      if (!tiers[tier]) tiers[tier] = { passed: 0, n: 0 };
      tiers[tier].n += 1;
      if (ok) tiers[tier].passed += 1;
    }
  }
  const byTier = {};
  for (const [tier, t] of Object.entries(tiers)) byTier[tier] = { share: t.passed / t.n, n: t.n };
  return { share: n ? passed / n : null, byTier, n, unparsed };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BUG_WINDOW_DAYS = 14;

// The paths under a record body's `### Key Files` section; null when the body has no such section.
function keyFilesOf(body) {
  const section = findSection(String(body || ''), 'Key Files');
  if (section === null) return null;
  const files = [];
  for (const line of section.split('\n')) {
    const item = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (!item) continue;
    const file = item[1].split(' \u2014 ')[0].replace(/`/g, '').trim().replace(/:\d+(-\d+)?$/, '');
    if (file) files.push(file);
  }
  return files;
}

const dayPlus = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// Guard 3: bug records created after, and within 14 days of, a merged PR in the column whose changed files share a path
// with the bug's Key Files. A bug is counted once however many PRs it matches; a bug with no Key Files section is
// `unparsed`. `repo` is an owner/name string; a gh throw propagates.
function collectPostMergeBugs(column, { repo, gh }) {
  if (!column.length) return { count: 0, perPr: null, mergedPrs: 0, unparsed: 0 };
  const from = column[0].date;
  const to = column[column.length - 1].date;
  const json = (args) => JSON.parse(String(gh(args)));
  const prs = json(['pr', 'list', '--repo', repo, '--state', 'merged', '--search', `merged:${from}..${to}`, '--limit', '1000', '--json', 'number,mergedAt,changedFiles']);
  const merged = prs.map((pr) => {
    const view = json(['pr', 'view', String(pr.number), '--repo', repo, '--json', 'files']);
    let paths = (view.files || []).map((f) => f.path);
    // `gh pr view --json files` stops at 100 files; a larger PR's full list comes from the paginated REST read.
    if (Number.isInteger(pr.changedFiles) && paths.length < pr.changedFiles) {
      paths = String(gh(['api', '--paginate', `repos/${repo}/pulls/${pr.number}/files`, '--jq', '.[].filename'])).split('\n').filter(Boolean);
    }
    return { at: Date.parse(pr.mergedAt), files: new Set(paths) };
  });
  const bugs = json(['issue', 'list', '--repo', repo, '--state', 'all', '--label', 'type:bug', '--search', `created:${from}..${dayPlus(to, BUG_WINDOW_DAYS)}`, '--limit', '1000', '--json', 'number,createdAt,body']);
  let count = 0;
  let unparsed = 0;
  for (const bug of bugs) {
    const keys = keyFilesOf(bug.body);
    if (!keys) {
      unparsed += 1;
      continue;
    }
    const created = Date.parse(bug.createdAt);
    const hit = merged.some((m) => m.at < created && created <= m.at + BUG_WINDOW_DAYS * DAY_MS && keys.some((k) => m.files.has(k)));
    if (hit) count += 1;
  }
  return { count, perPr: merged.length ? count / merged.length : null, mergedPrs: merged.length, unparsed };
}

const firstLine = (e) => String((e && e.message) || e).split('\n')[0];

// The guards section: the before and after columns of `selectColumns`, each read by the three guards. `repo` is a
// function returning a promise of owner/name, awaited per column inside guard 3's own error handling and only for a
// column with runs, so a failing repository lookup or `gh` read becomes that column's `postMergeBugs: { error }` and
// never blanks guards 1 and 2.
async function collectGuards({ runs, split, n, roots, repo }, { fsImpl = fs, gh } = {}) {
  const columns = selectColumns(runs, { split, n, fsImpl });
  const read = async (column) => {
    let postMergeBugs;
    try {
      postMergeBugs = collectPostMergeBugs(column, { repo: column.length ? await repo() : null, gh });
    } catch (e) {
      postMergeBugs = { error: firstLine(e) };
    }
    return {
      runCount: column.length,
      noTiming: column.filter((r) => !hasTiming(r, fsImpl)).length,
      from: column.length ? column[0].date : null,
      to: column.length ? column[column.length - 1].date : null,
      wholeBranch: collectWholeBranch(column, { roots, fsImpl }),
      firstPass: collectFirstPass(column, { fsImpl }),
      postMergeBugs,
    };
  };
  return { split, runs: n, before: await read(columns.before), after: await read(columns.after) };
}

module.exports = { selectColumns, resolveRun, membersOf, isWholeBranch, SEVERITY_RE, HEADING_RE, ITEM_RE, parseReviewCounts, readTiming, readReport, collectWholeBranch, collectFirstPass, keyFilesOf, collectPostMergeBugs, collectGuards };
