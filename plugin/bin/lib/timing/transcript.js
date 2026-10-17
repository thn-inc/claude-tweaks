// bin/lib/timing/transcript.js — locate a session's transcript and stream
// its usage rows (#1929).
//
// TRANSCRIPT_SLUG_RULE (empirical, pinned by tests/bin-lib/timing/
// transcript.test.js): Claude Code names a project's transcript directory
// by replacing every character of the cwd that is not [A-Za-z0-9-] with
// '-'. Observed pair: cwd
//   /Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/design-1904-pipeline-ceremony
// → ~/.claude/projects/
//   -Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-design-1904-pipeline-ceremony/
// (the space and the '.' both became '-', so a worktree cwd yields '--').
// The session's main transcript is {slug}/{sessionId}.jsonl; a sibling
// directory named {sessionId}/ holds subagent transcripts as
// {sessionId}/subagents/agent-{id}.jsonl + agent-{id}.meta.json, read by
// readDispatches below (#3375). That layout was OBSERVED on 2026-10-17 — it
// is not a documented contract — so a drifted layout (missing directory,
// renamed files, changed meta keys) must degrade to the not-found path, never
// throw or guess. If the pinned tests ever go red, Claude Code changed the
// scheme — re-derive the rule from a fresh observation, do not loosen the test.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { isPathContained } = require('../shared-primitives');

const TRANSCRIPT_SLUG_RULE = 'replace every character not in [A-Za-z0-9-] with "-" (observed: "/", " ", and "." all become "-")';

function slugForCwd(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9-]/g, '-');
}

function statOrNull(fsImpl, p) { try { return fsImpl.statSync(p); } catch { return null; } }

// { cwd?, sessionId?, homeDir?, fsImpl? } -> [{ path, mtimeMs }] newest first.
// Both keys absent -> []. Only the run's own keys are ever consulted.
// A sessionId that isn't a plain file-name token (e.g. carries "/" or "..")
// is a malformed request, not an absent one: it never falls back to a wider
// scan (that would silently widen a targeted lookup into a directory
// listing) — the whole call returns [] instead.
function locateTranscripts({ cwd, sessionId, homeDir = os.homedir(), fsImpl = fs } = {}) {
  const sessionIdGiven = typeof sessionId === 'string';
  const sid = sessionIdGiven && /^[A-Za-z0-9._-]+$/.test(sessionId) && !sessionId.includes('..') ? sessionId : null;
  if (sessionIdGiven && !sid) return [];
  if (!cwd && !sid) return [];
  const projects = path.join(homeDir, '.claude', 'projects');
  const projectsResolved = path.resolve(projects) + path.sep;
  let projectsRealResolved;
  try {
    projectsRealResolved = fsImpl.realpathSync(projects);
  } catch {
    return [];
  }
  const out = [];
  // Containment is decided on the REAL path (symlinks resolved at every
  // component, including the leaf) — statSync/createReadStream follow
  // symlinks, so a lexical check alone lets a symlinked {sid}.jsonl or slug
  // directory under ~/.claude/projects/ escape the sandbox (#1929 review
  // finding, [IL-150]). The lexical check stays first: it's cheap and
  // rejects a literal ".." before any filesystem call.
  const push = (p) => {
    if (!path.resolve(p).startsWith(projectsResolved)) return;
    let real;
    try {
      real = fsImpl.realpathSync(p);
    } catch {
      return; // missing file or dangling symlink — unprovable, skip (fail closed)
    }
    if (!isPathContained(real, projectsRealResolved)) return;
    const st = statOrNull(fsImpl, real);
    if (st && st.isFile()) out.push({ path: real, mtimeMs: st.mtimeMs });
  };
  if (cwd && sid) {
    push(path.join(projects, slugForCwd(cwd), `${sid}.jsonl`));
  } else if (cwd) {
    const dir = path.join(projects, slugForCwd(cwd));
    let names = [];
    try { names = fsImpl.readdirSync(dir); } catch { names = []; }
    for (const n of names) if (n.endsWith('.jsonl')) push(path.join(dir, n));
  } else {
    let dirs = [];
    try { dirs = fsImpl.readdirSync(projects); } catch { dirs = []; }
    for (const d of dirs) push(path.join(projects, d, `${sid}.jsonl`));
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// A Read counts as procedure loading when it targets a skill file — the
// repo's plugin/skills/** or the installed plugin cache's skills/ (a real
// session reads skills from ~/.claude/plugins/cache/…/skills/, so a
// repo-only rule would count zero bytes on every real run).
function isProcedurePath(filePath, worktree) {
  if (typeof filePath !== 'string' || !filePath) return false;
  let p = filePath;
  if (worktree && p.startsWith(worktree)) p = p.slice(worktree.length).replace(/^\/+/, '');
  if (/(^|\/)(plugin\/)?skills\/.+\.md$/.test(p)) return true;
  return p.includes('/.claude/plugins/') && p.includes('/skills/') && p.endsWith('.md');
}

function resultBytes(content) {
  if (typeof content === 'string') return Buffer.byteLength(content, 'utf8');
  if (Array.isArray(content)) {
    return content.reduce((s, b) => s + (b && typeof b.text === 'string' ? Buffer.byteLength(b.text, 'utf8') : 0), 0);
  }
  return 0;
}

// path, { fsImpl?, worktree? } -> Promise<rows>. Streams line by line;
// malformed lines (bad JSON, no timestamp, no message.role) are skipped.
// Rejects when the file cannot be opened, with the real stat failure's
// code (ENOENT/EACCES/...; EUNKNOWN if the error carries none), with
// EISDIR when the path resolves but names a directory, or — if `stat`
// succeeds but the subsequent read fails (e.g. a mode-000 file, or a
// mid-file I/O error) — with whatever code the stream/readline error
// carries.
async function readUsage(filePath, { fsImpl = fs, worktree = null } = {}) {
  await new Promise((resolve, reject) => {
    let st;
    try {
      st = fsImpl.statSync(filePath);
    } catch (err) {
      const code = (err && err.code) || 'EUNKNOWN';
      const e = new Error(`transcript not readable (${code}): ${filePath}`);
      e.code = code;
      reject(e);
      return;
    }
    if (!st.isFile()) {
      const e = new Error(`transcript not readable (EISDIR): ${filePath}`);
      e.code = 'EISDIR';
      reject(e);
      return;
    }
    resolve();
  });
  const rows = [];
  const procedureReads = new Set(); // tool_use ids of Reads on procedure files
  // Claude Code writes one JSONL line per content block of an assistant
  // turn, each repeating that turn's single cumulative `usage` under the
  // same message.id — summing every line would inflate tokens ~3x. Zero
  // the token fields on every line after the first seen for a given id
  // (#1929 whole-branch review fix 1).
  const seenMsgIds = new Set();
  const stream = fsImpl.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  await new Promise((resolve, reject) => {
    stream.on('error', reject);
    rl.on('error', reject);
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let entry;
      try { entry = JSON.parse(line); } catch { return; }
      const msg = entry && entry.message;
      if (!entry || typeof entry.timestamp !== 'string' || !msg || typeof msg.role !== 'string') return;
      const content = Array.isArray(msg.content) ? msg.content : [];
      const row = { ts: entry.timestamp, role: msg.role, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreate: 0, toolRoundTrip: false, procedureBytes: 0, model: null };
      if (msg.role === 'assistant') {
        row.model = typeof msg.model === 'string' ? msg.model : null;
        const u = msg.usage || {};
        row.inputTokens = Number(u.input_tokens) || 0;
        row.outputTokens = Number(u.output_tokens) || 0;
        row.cacheRead = Number(u.cache_read_input_tokens) || 0;
        row.cacheCreate = Number(u.cache_creation_input_tokens) || 0;
        for (const b of content) {
          if (b && b.type === 'tool_use' && b.name === 'Read' && b.input && isProcedurePath(b.input.file_path, worktree)) procedureReads.add(b.id);
        }
        if (typeof msg.id === 'string') {
          if (seenMsgIds.has(msg.id)) {
            row.inputTokens = 0;
            row.outputTokens = 0;
            row.cacheRead = 0;
            row.cacheCreate = 0;
          } else {
            seenMsgIds.add(msg.id);
          }
        }
      } else {
        for (const b of content) {
          if (!b || b.type !== 'tool_result') continue;
          row.toolRoundTrip = true;
          if (procedureReads.has(b.tool_use_id)) row.procedureBytes += resultBytes(b.content);
        }
      }
      rows.push(row);
    });
    rl.on('close', resolve);
  });
  return rows;
}

// mainTranscriptPath -> the sibling {sessionId}/subagents directory.
function subagentsDirFor(mainTranscriptPath) {
  return path.join(String(mainTranscriptPath).replace(/\.jsonl$/, ''), 'subagents');
}

function readMeta(fsImpl, file) {
  try {
    const m = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
    return m && typeof m === 'object' && !Array.isArray(m) ? m : null;
  } catch { return null; }
}

const strOrNull = (v) => (typeof v === 'string' ? v : null);
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// First assistant row whose model matches /^claude-/, else the first non-null
// model, else null — a "<synthetic>" row can precede the real model id.
function transcriptModelOf(rows) {
  const models = rows.map((r) => r.model).filter((m) => m !== null);
  return models.find((m) => /^claude-/.test(m)) || models[0] || null;
}

// subagentsDir, { fsImpl?, window? } -> Promise<{ items, notFound, excludedOutsideWindow }>.
// One Dispatch per agent-{id}; meta and transcript are paired by id. Token
// totals come from readUsage, so its message.id dedupe is the one in force.
// window = { start, end } (epoch ms, inclusive): rows outside it are dropped
// before span/tokens are taken, and a dispatch with no row inside it is
// counted in excludedOutsideWindow rather than listed. Never throws.
async function readDispatches(subagentsDir, { fsImpl = fs, window = null } = {}) {
  let names;
  try {
    names = fsImpl.readdirSync(subagentsDir);
  } catch {
    return { items: [], notFound: `no subagents/ directory at ${subagentsDir}`, excludedOutsideWindow: 0 };
  }
  const ids = new Set();
  for (const n of names) {
    const m = /^agent-(.+?)(\.meta\.json|\.jsonl)$/.exec(n);
    if (m) ids.add(m[1]);
  }
  const built = [];
  let excludedOutsideWindow = 0;
  for (const agentId of ids) {
    const meta = readMeta(fsImpl, path.join(subagentsDir, `agent-${agentId}.meta.json`));
    const d = {
      agentId,
      description: meta ? strOrNull(meta.description) : null,
      agentType: meta ? strOrNull(meta.agentType) : null,
      metaModel: meta ? strOrNull(meta.model) : null,
      transcriptModel: null,
      parentAgentId: meta ? strOrNull(meta.parentAgentId) : null,
      spawnDepth: meta ? numOrNull(meta.spawnDepth) : null,
      startTs: null, endTs: null, wallClockMs: null, tokens: null,
      notFound: meta ? null : 'meta not found',
    };
    let startMs = null;
    let rows = null;
    try {
      rows = await readUsage(path.join(subagentsDir, `agent-${agentId}.jsonl`), { fsImpl });
    } catch (err) {
      d.notFound = `transcript not readable (${(err && err.code) || 'EUNKNOWN'})`;
    }
    if (rows) {
      const stamped = rows.map((r) => ({ r, ms: Date.parse(r.ts) })).filter((x) => Number.isFinite(x.ms));
      const kept = window ? stamped.filter((x) => x.ms >= window.start && x.ms <= window.end) : stamped;
      if (window && stamped.length > 0 && kept.length === 0) {
        excludedOutsideWindow += 1;
        continue;
      }
      if (kept.length > 0) {
        const first = kept.reduce((a, b) => (b.ms < a.ms ? b : a));
        const last = kept.reduce((a, b) => (b.ms > a.ms ? b : a));
        startMs = first.ms;
        d.startTs = first.r.ts;
        d.endTs = last.r.ts;
        d.wallClockMs = last.ms - first.ms;
      }
      const keptRows = kept.map((x) => x.r);
      d.tokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
      for (const r of keptRows) {
        d.tokens.input += r.inputTokens;
        d.tokens.output += r.outputTokens;
        d.tokens.cacheRead += r.cacheRead;
        d.tokens.cacheCreate += r.cacheCreate;
      }
      d.transcriptModel = transcriptModelOf(keptRows);
    }
    built.push({ d, startMs });
  }
  built.sort((a, b) => {
    if (a.startMs === null && b.startMs !== null) return 1;
    if (b.startMs === null && a.startMs !== null) return -1;
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return a.d.agentId < b.d.agentId ? -1 : a.d.agentId > b.d.agentId ? 1 : 0;
  });
  return { items: built.map((x) => x.d), notFound: null, excludedOutsideWindow };
}

module.exports = { TRANSCRIPT_SLUG_RULE, slugForCwd, locateTranscripts, readUsage, isProcedurePath, subagentsDirFor, readDispatches };
