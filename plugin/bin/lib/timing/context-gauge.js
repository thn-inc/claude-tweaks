// bin/lib/timing/context-gauge.js — measure the running agent's own context
// from its transcript, and name the records a handoff resumes (#4027
// Deliverable 3). bin/context-gauge.js is the CLI; /flow calls it at a phase
// boundary, and past the cap the next phase starts in a fresh agent from
// {run}/handoff.json instead of growing this one's context.
//
// Transcript layout (observed on Claude Code 2.1.302, 2026-10-25 — not a
// documented contract, see transcript.js's header): a dispatched Task agent's
// transcript is {configDir}/projects/{slug}/{sessionId}/subagents/agent-{id}.jsonl,
// beside the session's main {sessionId}.jsonl, where {slug} follows the
// dispatcher's cwd at dispatch time. Inside the agent's Bash,
// CLAUDE_CODE_SESSION_ID is the PARENT session's id, and nothing names the
// agent's own id or transcript path.
//
// So the caller is identified by its in-flight call: a transcript's tool_use
// line is on disk before the tool runs. That was observed on 2026-10-25 for a
// subagent transcript (#4027 review, live) and for two main transcripts
// (isSidechain false, an unanswered Bash tool_use the last line or followed by
// one non-result line while the command ran). The caller's transcript is the
// one whose tail holds an unanswered Bash tool_use running context-gauge for
// this run. Only when no transcript has one does identification fall back to
// the first user message naming the run id (a dispatch prompt names its run
// dir), and then to the main transcript. That fallback can pick a child: 509
// lens, judge and reviewer transcripts were found naming their run id in
// their first message.
//
// Non-message lines (attachment, api-request-shape, api-request, and
// api-request-blob, which carries a message.role but no timestamp) are
// skipped by the same filter readUsage applies.
'use strict';
const fs = require('fs');
const path = require('path');
const { lstatType } = require('../path-guard');
const { isPathContained } = require('../shared-primitives');
const { readManifest } = require('../flow/manifest');
const { locateTranscripts, subagentsDirFor, readUsage } = require('./transcript');

// #4027's measured latency curve: 5.0 s per turn under 100k context and
// 12.1 s per turn above 300k, so 200k — the midpoint — is the cap.
const CONTEXT_CAP_TOKENS = 200000;

// The first user message is the transcript's first line in every observed
// subagent transcript; the cap bounds the read when it is not.
const FIRST_USER_SCAN_BYTES = 4 * 1024 * 1024;
const SCAN_CHUNK_BYTES = 64 * 1024;
// The in-flight call is the transcript's last tool_use line, followed at most
// by a few hook attachments, so a bounded tail always holds it.
const CALLER_TAIL_BYTES = 128 * 1024;
// The context size is the last turn's usage, so gauge() reads this much of the
// transcript's tail first instead of streaming a file that is largest exactly
// when the gauge matters (a 200k+ token context). A turn is a few lines; the
// window only has to hold the last one.
const GAUGE_TAIL_BYTES = 4 * 1024 * 1024;

// JSONL line -> the parsed entry when it is a timestamped message line (the
// readUsage filter), else null.
function messageEntry(line) {
  let entry;
  try { entry = JSON.parse(line); } catch { return null; }
  const msg = entry && entry.message;
  if (!entry || typeof entry.timestamp !== 'string' || !msg || typeof msg.role !== 'string') return null;
  return entry;
}

// JSONL line -> the user message's text, or undefined when the line is not a
// timestamped user message. A string content is the text; an array content
// contributes its text blocks.
function userTextOf(line) {
  const entry = messageEntry(line);
  const msg = entry && entry.message;
  if (!msg || msg.role !== 'user') return undefined;
  if (typeof msg.content === 'string') return msg.content;
  if (!Array.isArray(msg.content)) return '';
  return msg.content.map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('\n');
}

// path -> the text of the transcript's first user message, or null (no user
// message within FIRST_USER_SCAN_BYTES, or unreadable). Reads only as far as
// that message, since a session's subagents/ can hold many large transcripts.
function firstUserText(filePath, { fsImpl = fs, maxBytes = FIRST_USER_SCAN_BYTES } = {}) {
  let fd;
  try { fd = fsImpl.openSync(filePath, 'r'); } catch { return null; }
  try {
    const chunk = Buffer.alloc(SCAN_CHUNK_BYTES);
    let pending = Buffer.alloc(0);
    let total = 0;
    for (;;) {
      const want = Math.min(SCAN_CHUNK_BYTES, maxBytes - total);
      const n = want > 0 ? fsImpl.readSync(fd, chunk, 0, want, null) : 0;
      total += n;
      if (n > 0) pending = Buffer.concat([pending, chunk.subarray(0, n)]);
      let nl;
      while ((nl = pending.indexOf(10)) !== -1) {
        const text = userTextOf(pending.subarray(0, nl).toString('utf8'));
        if (text !== undefined) return text;
        pending = pending.subarray(nl + 1);
      }
      if (n === 0) {
        // EOF: an unterminated last line still counts; at the cap it is cut.
        if (want > 0 && pending.length) {
          const text = userTextOf(pending.toString('utf8'));
          if (text !== undefined) return text;
        }
        return null;
      }
    }
  } catch {
    return null;
  } finally {
    try { fsImpl.closeSync(fd); } catch { /* best-effort */ }
  }
}

// path -> the complete lines of the file's last `tailBytes` bytes (a line cut
// at the tail's start is dropped), or null when unreadable.
function tailLines(filePath, { fsImpl = fs, tailBytes = CALLER_TAIL_BYTES } = {}) {
  let fd;
  try {
    fd = fsImpl.openSync(filePath, 'r');
    const size = fsImpl.fstatSync(fd).size;
    const start = Math.max(0, size - tailBytes);
    const buf = Buffer.alloc(size - start);
    let got = 0;
    while (got < buf.length) {
      const n = fsImpl.readSync(fd, buf, got, buf.length - got, start + got);
      if (n === 0) break;
      got += n;
    }
    const lines = buf.subarray(0, got).toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines.filter((l) => l.trim() !== '');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fsImpl.closeSync(fd); } catch { /* best-effort */ } }
  }
}

// path, runId -> true when the transcript's tail holds an unanswered Bash
// tool_use whose command runs context-gauge for runId: no tool_result for its
// id follows it, and no later assistant turn (another message.id) does. A
// sibling tool_use of the same turn, or its result, may follow — parallel
// calls of one turn are written before any of them completes.
function hasInFlightGaugeCall(filePath, runId, { fsImpl = fs, tailBytes = CALLER_TAIL_BYTES } = {}) {
  if (typeof runId !== 'string' || !runId) return false;
  const lines = tailLines(filePath, { fsImpl, tailBytes });
  if (!lines) return false;
  const entries = lines.map(messageEntry).filter(Boolean);
  let call = null; // { id, msgId, at }
  entries.forEach((e, at) => {
    if (e.message.role !== 'assistant' || !Array.isArray(e.message.content)) return;
    for (const b of e.message.content) {
      const cmd = b && b.type === 'tool_use' && b.name === 'Bash' && b.input ? b.input.command : null;
      if (typeof cmd === 'string' && cmd.includes('context-gauge') && cmd.includes(runId)) {
        call = { id: b.id, msgId: e.message.id, at };
      }
    }
  });
  if (!call) return false;
  for (const e of entries.slice(call.at + 1)) {
    const content = Array.isArray(e.message.content) ? e.message.content : [];
    if (e.message.role === 'assistant' && e.message.id !== call.msgId) return false;
    if (content.some((b) => b && b.type === 'tool_result' && b.tool_use_id === call.id)) return false;
  }
  return true;
}

// subagents dir -> [{ path, mtimeMs }] of its regular agent-*.jsonl files. A
// symlinked session dir, subagents/ dir or agent file is never followed (the
// lstat twin of locateTranscripts' realpath containment, IL-150).
function agentTranscripts(dir, fsImpl) {
  if (lstatType(path.dirname(dir), { fsImpl }).type !== 'directory') return [];
  if (lstatType(dir, { fsImpl }).type !== 'directory') return [];
  let names;
  try { names = fsImpl.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!/^agent-.+\.jsonl$/.test(n)) continue;
    const p = path.join(dir, n);
    if (lstatType(p, { fsImpl }).type !== 'file') continue;
    try { out.push({ path: p, mtimeMs: fsImpl.statSync(p).mtimeMs }); } catch { /* vanished: skip */ }
  }
  return out;
}

// { runId, sessionId, cwd?, configDir?, fsImpl? }
//   -> { path, kind: 'subagent' | 'main', identified: 'in-flight' | 'first-message' | 'main' } | null.
// 1. in-flight: among the session's main transcript(s) and every
//    agent-*.jsonl in its subagents/, the newest-mtime one whose tail holds an
//    unanswered context-gauge call for runId (hasInFlightGaugeCall) — the caller.
// 2. first-message (fallback): the newest agent-*.jsonl whose first user
//    message contains runId.
// 3. main (fallback): the session's main transcript.
// null when the session has no main transcript. The main transcript is found
// by file name across every project slug (locateTranscripts with the session
// id alone), so a cwd that no longer matches the slug still finds it; the
// cwd's own slug is preferred for step 3 when a session id appears under
// several. configDir undefined means locateTranscripts' default
// ($CLAUDE_CONFIG_DIR, else ~/.claude).
function findAgentTranscript({ runId, sessionId, cwd, configDir, fsImpl = fs } = {}) {
  if (typeof sessionId !== 'string' || !sessionId) return null;
  const mains = locateTranscripts({ sessionId, configDir, fsImpl });
  if (mains.length === 0) return null;
  const dirs = [...new Set(mains.map((m) => subagentsDirFor(m.path)))];
  const agents = dirs.flatMap((d) => agentTranscripts(d, fsImpl)).sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (typeof runId === 'string' && runId) {
    // Newest first, so the first qualifier is the newest-mtime one; usually
    // the caller is the file written last and only one tail is read.
    const all = [...mains.map((m) => ({ ...m, kind: 'main' })), ...agents.map((a) => ({ ...a, kind: 'subagent' }))]
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const c of all) {
      if (hasInFlightGaugeCall(c.path, runId, { fsImpl })) return { path: c.path, kind: c.kind, identified: 'in-flight' };
    }
    for (const a of agents) {
      const text = firstUserText(a.path, { fsImpl });
      if (typeof text === 'string' && text.includes(runId)) return { path: a.path, kind: 'subagent', identified: 'first-message' };
    }
  }
  const here = cwd ? locateTranscripts({ cwd, sessionId, configDir, fsImpl }) : [];
  return { path: (here[0] || mains[0]).path, kind: 'main', identified: 'main' };
}

// path -> the last assistant turn's input + cache_read + cache_creation, read
// from the file's last `tailBytes` bytes, or null when that window holds no
// assistant message (a last turn larger than the window, a transcript with no
// turn, an unreadable file) — the caller then falls back to readUsage. A turn's
// lines share a message.id and readUsage keeps the per-field max across them,
// so this does too; the last turn is the id whose first line comes last.
function tailContextTokens(filePath, { fsImpl = fs, tailBytes = GAUGE_TAIL_BYTES } = {}) {
  const lines = tailLines(filePath, { fsImpl, tailBytes });
  if (!lines) return null;
  const turns = []; // [{ id, input, cacheRead, cacheCreate }] in first-line order
  const byId = new Map();
  for (const line of lines) {
    const entry = messageEntry(line);
    if (!entry || entry.message.role !== 'assistant') continue;
    const u = entry.message.usage || {};
    const usage = {
      input: Number(u.input_tokens) || 0,
      cacheRead: Number(u.cache_read_input_tokens) || 0,
      cacheCreate: Number(u.cache_creation_input_tokens) || 0,
    };
    const id = typeof entry.message.id === 'string' ? entry.message.id : null;
    const turn = id !== null ? byId.get(id) : undefined;
    if (!turn) {
      const fresh = { ...usage };
      turns.push(fresh);
      if (id !== null) byId.set(id, fresh);
      continue;
    }
    for (const field of Object.keys(usage)) turn[field] = Math.max(turn[field], usage[field]);
  }
  if (turns.length === 0) return null;
  const last = turns[turns.length - 1];
  return last.input + last.cacheRead + last.cacheCreate;
}

// { transcript, fsImpl?, tailBytes? } -> Promise<{ contextTokens }>: the
// contextTokens of the last turnStart row (input + cache_read + cache_creation,
// per-message.id max — readUsage's), or null when the transcript has no
// assistant turn. The tail window answers when it holds an assistant message;
// otherwise the whole file is streamed. Rejects as readUsage does when the file
// cannot be read.
async function gauge({ transcript, fsImpl = fs, tailBytes = GAUGE_TAIL_BYTES } = {}) {
  const tail = tailContextTokens(transcript, { fsImpl, tailBytes });
  if (tail !== null) return { contextTokens: tail };
  const rows = await readUsage(transcript, { fsImpl });
  let last = null;
  for (const r of rows) if (r.turnStart) last = r;
  return { contextTokens: last ? last.contextTokens : null };
}

function numberedEntries(dir, re, wantType, fsImpl) {
  let names;
  try { names = fsImpl.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    const m = re.exec(n);
    if (m && lstatType(path.join(dir, n), { fsImpl }).type === wantType) out.push(Number(m[1]));
  }
  return out;
}

// { runDir, worktree?, gitRoot?, fsImpl?, manifest? } -> ['#N', ...] | null.
// A multi-spec run's records are its spec-{N}/ subdirectories, in the order
// of manifest.yml's specs list (lib/flow/manifest.js) when the run has one —
// a spec dir the manifest does not list goes after, ascending — else
// ascending. A single-record run's are its work/{n}-spec.md names, and that
// spec is committed inside the worktree at the run dir's path relative to the
// main checkout — so the worktree copy (run-state.json's `worktree`) is read
// first, the run dir's own work/ second. `manifest` is the parsed manifest
// (readManifest's shape); undefined reads {runDir}/manifest.yml.
function resolveTargetRecords({ runDir, worktree = null, gitRoot = null, fsImpl = fs, manifest } = {}) {
  const roots = [];
  if (typeof worktree === 'string' && worktree && gitRoot && isPathContained(runDir, gitRoot)) {
    roots.push(path.join(worktree, path.relative(gitRoot, runDir)));
  }
  roots.push(runDir);
  const format = (nums) => [...new Set(nums)].sort((a, b) => a - b).map((n) => `#${n}`);
  const specDirs = roots.flatMap((r) => numberedEntries(r, /^spec-([1-9]\d*)$/, 'directory', fsImpl));
  if (specDirs.length) {
    const m = manifest === undefined ? readManifest(runDir) : manifest;
    const listed = m && m.multispec && Array.isArray(m.multispec.specs) ? m.multispec.specs.map((s) => Number(s.id)) : [];
    const present = new Set(specDirs);
    const ordered = [...new Set(listed.filter((n) => present.has(n)))];
    const rest = format(specDirs.filter((n) => !ordered.includes(n)));
    return [...ordered.map((n) => `#${n}`), ...rest];
  }
  for (const r of roots) {
    const specs = numberedEntries(path.join(r, 'work'), /^([1-9]\d*)-spec\.md$/, 'file', fsImpl);
    if (specs.length) return format(specs);
  }
  return null;
}

// The resume line's mode token: auto, confirm and hybrid all run as auto once
// the Manifesto is past, so they resume as auto; interactive, an unknown
// value, or no recorded mode resumes with no token, so an interactive run
// keeps its stops.
const RESUME_AS_AUTO = new Set(['auto', 'confirm', 'hybrid']);

// The most handoffs one run may make. The count is per run, not per call: one
// minted run dir spans both of a dispatch group's Task calls, so they share
// it. At the bound the gauge writes no handoff, and the caller continues in
// place (`handoff: null`), so a well-behaved agent never reports a fourth
// handoff — its call completes, or HARD-GATEs and settles itself.
//
// Why 3: a backstop, not a measured limit. Each hop finishes at least one of
// the pipeline's five steps and a fresh agent starts far under the cap, so a
// chain ends on its own; the bound only stops a mis-measuring gauge (a wrong
// caller, a transcript that keeps growing between hops) from handing off
// forever. The #4027 build chose 3 without data that separates it from 2 or 5 —
// raise or lower it with a measured run in hand, in this constant and in the
// "three" that flow/context-handoff.md and dispatch/two-call-gate.md restate.
const HANDOFF_BOUND = 3;

// runDir -> the run's earlier handoffs: {run}/handoff.json's `handoffCount`.
// A missing or unparseable file, or a count that is not a non-negative
// integer, counts as 0.
function readHandoffCount(runDir, { fsImpl = fs } = {}) {
  let parsed;
  try { parsed = JSON.parse(fsImpl.readFileSync(path.join(runDir, 'handoff.json'), 'utf8')); } catch { return 0; }
  const n = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.handoffCount : undefined;
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

// -> the handoff.json object a fresh agent resumes from. `mode` is the run's
// recorded mode (null when none); `handoffCount` counts this handoff too.
function buildHandoff({ runDir, nextSteps, contextTokens, cap, targets, mode = null, handoffCount = 1, now }) {
  const modeToken = RESUME_AS_AUTO.has(mode) ? ' auto' : '';
  return {
    nextSteps: [...nextSteps],
    contextTokens,
    cap,
    mode,
    handoffCount,
    writtenAt: new Date(now).toISOString(),
    resume: `PIPELINE_RUN_DIR="${runDir}" /claude-tweaks:flow "${targets.join(',')}" ${nextSteps.join(',')}${modeToken}`,
  };
}

module.exports = {
  CONTEXT_CAP_TOKENS, FIRST_USER_SCAN_BYTES, CALLER_TAIL_BYTES, GAUGE_TAIL_BYTES, firstUserText, hasInFlightGaugeCall, findAgentTranscript, gauge,
  resolveTargetRecords, buildHandoff, HANDOFF_BOUND, readHandoffCount,
};
