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
// directory named {sessionId}/ holds subagent transcripts and is not read
// here. If the pinned test ever goes red, Claude Code changed the scheme —
// re-derive the rule from a fresh observation, do not loosen the test.
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
      const row = { ts: entry.timestamp, role: msg.role, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreate: 0, toolRoundTrip: false, procedureBytes: 0 };
      if (msg.role === 'assistant') {
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

module.exports = { TRANSCRIPT_SLUG_RULE, slugForCwd, locateTranscripts, readUsage, isProcedurePath };
