// bin/lib/timing/transcript.js — locate a session's transcript and stream
// its usage rows (#1929).
//
// TRANSCRIPT_SLUG_RULE (empirical, pinned by tests/bin-lib/timing/
// transcript.test.js): Claude Code names a project's transcript directory
// by replacing every character of the cwd that is not [A-Za-z0-9-] with
// '-'. Observed pair: cwd
//   /Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/design-1904-pipeline-ceremony
// → {config-dir}/projects/
//   -Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-design-1904-pipeline-ceremony/
// (the space and the '.' both became '-', so a worktree cwd yields '--').
// {config-dir} is $CLAUDE_CONFIG_DIR when set (Claude Code writes transcripts
// there), else ~/.claude — the resolution dream-scan.js and
// skill-load-report.js use (#3458).
// The session's main transcript is {slug}/{sessionId}.jsonl; a sibling
// directory named {sessionId}/ holds subagent transcripts as
// {sessionId}/subagents/agent-{id}.jsonl + agent-{id}.meta.json, read by
// readDispatches below (#3375). That layout was OBSERVED on 2026-10-17 — it
// is not a documented contract — so a drifted layout (missing directory,
// renamed files, changed meta keys) must degrade to the not-found path, never
// throw or guess. If the pinned tests ever go red, Claude Code changed the
// scheme — re-derive the rule from a fresh observation, do not loosen the test.
// Agents a workflow script starts sit one layout over (#5597):
// {sessionId}/subagents/workflows/{runId}/agent-{id}.jsonl + agent-{id}.meta.json
// (meta adds workflowPhase), with a run file at {sessionId}/workflows/{runId}.json
// whose agentCount readDispatches cross-checks. That layout was OBSERVED on
// Claude Code CLI 2.1.325 and is not documented either. Agents a workflow
// agent starts itself (spawnDepth > 1) are read only when their files sit in
// the same run directory.
// Task-call attribution (#5647): a dispatched run's orchestration happens in
// the dispatching session's Task calls, so locateTaskTranscripts attributes a
// session's depth-1 agent files (agent-{id}.meta.json spawnDepth === 1 exactly)
// to a run when the file's first line (the dispatch prompt, at most
// FIRST_ENTRY_CAP bytes) is a type "user" entry naming exactly one pipeline run
// id, equal to the requested one. It is decided per file, never per row;
// nested (depth >= 2) agents, subagents/workflows/ and any symlinked directory
// or file are not candidates.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { StringDecoder } = require('string_decoder');
const { lstatType, resolveLeaf, canonicalRealpath, isAncestorOrSelf } = require('../path-guard');
const { isPathContained } = require('../shared-primitives');
const { isProcedurePath, classifyToolCall, readFileKey, bashProcedureFiles } = require('./turn-class');

const TRANSCRIPT_SLUG_RULE = 'replace every character not in [A-Za-z0-9-] with "-" (observed: "/", " ", and "." all become "-")';

function slugForCwd(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9-]/g, '-');
}

function statOrNull(fsImpl, p) { try { return fsImpl.statSync(p); } catch { return null; } }

// value -> the session id when it is a plain file-name token (no "/" and no
// ".."), else null. Shared by locateTranscripts and locateTaskTranscripts.
function sessionIdToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]+$/.test(value) && !value.includes('..') ? value : null;
}

// { cwd?, sessionId?, homeDir?, configDir?, fsImpl? } -> [{ path, mtimeMs }] newest first.
// The projects root is {configDir}/projects; configDir defaults to
// $CLAUDE_CONFIG_DIR (an empty value counts as unset), else {homeDir}/.claude (#3458).
// Both keys absent -> []. Only the run's own keys are ever consulted.
// A sessionId that isn't a plain file-name token (e.g. carries "/" or "..")
// is a malformed request, not an absent one: it never falls back to a wider
// scan (that would silently widen a targeted lookup into a directory
// listing) — the whole call returns [] instead.
function locateTranscripts({ cwd, sessionId, homeDir = os.homedir(), configDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude'), fsImpl = fs } = {}) {
  const sessionIdGiven = typeof sessionId === 'string';
  const sid = sessionIdToken(sessionId);
  if (sessionIdGiven && !sid) return [];
  if (!cwd && !sid) return [];
  const projects = path.join(configDir, 'projects');
  const projectsResolved = path.resolve(projects);
  // realpath: fsImpl.realpathSync pins the JS form this reader has always used
  // (path-guard defaults to .native, which would change Windows short-name
  // expansion), so routing through path-guard (#3417) changes no behavior.
  const projectsRealResolved = canonicalRealpath(projects, { fsImpl, realpath: fsImpl.realpathSync });
  if (projectsRealResolved === null) return [];
  const out = [];
  // Containment is decided on the REAL path (symlinks resolved at every
  // component, including the leaf) — statSync/createReadStream follow
  // symlinks, so a lexical check alone lets a symlinked {sid}.jsonl or slug
  // directory under the projects root escape the sandbox (#1929 review
  // finding, [IL-150]). The lexical check stays first: it's cheap and
  // rejects a literal ".." before any filesystem call.
  const push = (p) => {
    if (!isPathContained(path.resolve(p), projectsResolved)) return;
    const leaf = resolveLeaf(p, { fsImpl, realpath: fsImpl.realpathSync });
    if (leaf.state !== 'resolved') return; // missing, dangling or unreadable — unprovable, skip (fail closed)
    // Admits the root itself, which the isFile check below still rejects.
    if (!isAncestorOrSelf(projectsRealResolved, leaf.path)) return;
    const st = statOrNull(fsImpl, leaf.path);
    if (st && st.isFile()) out.push({ path: leaf.path, mtimeMs: st.mtimeMs });
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

// Run ids a text names as `.claude-tweaks/pipelines/{id}` (either separator; a
// Windows path inside JSON text carries `\\`) -> distinct ids, first-seen order.
// The captured id is claim-store.js's canonical RUN_ID_SHAPE without its anchors, pinned by
// transcript.test.js's "RUN_ID_NAMED_RE captures the canonical run-id shape". The maintainer-side
// tools/guard-refusals/transcripts.js keeps its own copy, since plugin/ never requires tools/.
const RUN_ID_NAMED_RE = /\.claude-tweaks[\\/]+pipelines[\\/]+(\d{4}-\d{2}-\d{2}T\d{6}-[a-z0-9][a-z0-9-]*)/g;
function runIdsNamed(text) {
  const ids = [];
  for (const m of String(text).matchAll(RUN_ID_NAMED_RE)) if (!ids.includes(m[1])) ids.push(m[1]);
  return ids;
}

const FIRST_ENTRY_CAP = 1048576; // 1 MiB: a first line longer than this is never attributed

// fsImpl, file -> the file's first line as text, or null when it is longer than
// FIRST_ENTRY_CAP bytes or cannot be read. Never throws.
function readFirstLine(fsImpl, file) {
  let fd;
  try {
    fd = fsImpl.openSync(file, 'r');
    const chunk = Buffer.alloc(65536);
    const parts = [];
    let total = 0;
    let pos = 0;
    for (;;) {
      const n = fsImpl.readSync(fd, chunk, 0, chunk.length, pos);
      if (n === 0) break;
      pos += n;
      const nl = chunk.subarray(0, n).indexOf(0x0a);
      const take = nl === -1 ? n : nl;
      total += take;
      if (total > FIRST_ENTRY_CAP) return null;
      parts.push(Buffer.from(chunk.subarray(0, take)));
      if (nl !== -1) break;
    }
    return Buffer.concat(parts).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fsImpl.closeSync(fd); } catch { /* nothing to release */ } }
  }
}

// { sessionIds, runId, configDir, fsImpl? } -> { paths, notes } (#5647). The
// depth-1 agent transcripts of each session whose dispatch prompt names exactly
// runId (rule in the header). Every slug holding {sid}.jsonl is scanned; paths
// are sorted and deduped; notes holds one line per session id that yielded no
// scannable subagents/ directory (invalid id, no {sid}.jsonl, no or symlinked
// subagents/). Never throws.
function locateTaskTranscripts({ sessionIds, runId, configDir, fsImpl = fs } = {}) {
  const found = new Set();
  const notes = [];
  for (const sid of new Set(Array.isArray(sessionIds) ? sessionIds : [])) {
    try {
      const problems = [];
      let scanned = false;
      const valid = sessionIdToken(sid) !== null;
      // locateTranscripts realpath-contains every hit.
      const hits = valid ? locateTranscripts({ sessionId: sid, cwd: null, homeDir: null, configDir, fsImpl }) : [];
      if (!valid) problems.push('invalid session id');
      else if (hits.length === 0) problems.push(`no ${sid}.jsonl found`);
      for (const hit of hits) {
        const dir = subagentsDirFor(hit.path);
        // The {sid}/ directory must not be a symlink either: checking subagents/
        // alone would follow it out of the projects root.
        const sessionType = lstatType(path.dirname(dir), { fsImpl }).type;
        const dirType = sessionType === 'directory' ? lstatType(dir, { fsImpl }).type : sessionType;
        if (dirType === 'symlink') { problems.push(`symlinked directory not followed for ${hit.path}`); continue; }
        if (dirType !== 'directory') { problems.push(`no subagents/ directory for ${hit.path}`); continue; }
        let names;
        try { names = fsImpl.readdirSync(dir); } catch { problems.push(`subagents/ directory not readable at ${dir}`); continue; }
        scanned = true;
        for (const n of names) {
          const m = /^agent-(.+)\.jsonl$/.exec(n);
          if (!m) continue;
          const file = path.join(dir, n);
          const metaFile = path.join(dir, `agent-${m[1]}.meta.json`);
          // Red without it: "symlinked agent file is not followed".
          if (lstatType(file, { fsImpl }).type !== 'file') continue;
          // Red without it: "symlinked meta file is not followed".
          if (lstatType(metaFile, { fsImpl }).type !== 'file') continue;
          const { meta } = readMeta(fsImpl, metaFile);
          // Red without it: "depth-2 agent ..." and "meta without spawnDepth, malformed meta, missing meta ...".
          if (!meta || meta.spawnDepth !== 1) continue;
          // Red without the null return: "first line over FIRST_ENTRY_CAP ...".
          const line = readFirstLine(fsImpl, file);
          if (line === null) continue;
          let entry;
          try { entry = JSON.parse(line); } catch { continue; }
          // Red without it: "first line not a user entry, or unparseable ...".
          if (!entry || entry.type !== 'user') continue;
          const ids = runIdsNamed(line);
          // `length !== 1` red: "prompt naming this run and another run ..."; `ids[0] !== runId` red: "prompt naming only another run ...".
          if (ids.length !== 1 || ids[0] !== runId) continue;
          // hit.path is already a real path and neither directory nor file is a
          // symlink (lstat above), so `file` is the real path the set dedupes on.
          found.add(file);
        }
      }
      if (!scanned) notes.push(`session ${sid}: ${problems.join('; ')}`);
    } catch (err) {
      notes.push(`session ${sid}: Task-call lookup failed (${(err && err.code) || 'EUNKNOWN'})`);
    }
  }
  return { paths: [...found].sort(), notes };
}

// isProcedurePath lives in turn-class.js (#4029) and is re-exported below
// under the same name; turn-class.js must never require this module.

function resultBytes(content) {
  if (typeof content === 'string') return Buffer.byteLength(content, 'utf8');
  if (Array.isArray(content)) {
    return content.reduce((s, b) => s + (b && typeof b.text === 'string' ? Buffer.byteLength(b.text, 'utf8') : 0), 0);
  }
  return 0;
}

// fsImpl, path -> undefined. Throws the transcript stat contract shared by
// readUsage and transcript-load.js: an Error whose code is the stat failure's
// code (EUNKNOWN if absent), or EISDIR when the path names anything but a regular file.
function statTranscriptOrThrow(fsImpl, filePath) {
  let st;
  let code = null;
  try {
    st = fsImpl.statSync(filePath);
  } catch (err) {
    code = (err && err.code) || 'EUNKNOWN';
  }
  if (!code && !st.isFile()) code = 'EISDIR';
  if (code) {
    const e = new Error(`transcript not readable (${code}): ${filePath}`);
    e.code = code;
    throw e;
  }
}

// A tool_result block's content as text: the string itself, or its text parts
// joined. Feeds classifyToolCall's guard-refusal check (#4029).
function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('');
  return '';
}

function abortError() {
  const e = new Error('transcript read aborted');
  e.code = 'ABORT_ERR';
  return e;
}

// The one max-per-message.id usage rule (#5967): Claude Code writes one JSONL
// line per content block of an assistant turn under the same message.id, and
// usage grows while a response streams, so neither the first line nor a
// per-line sum is right — each field keeps its max across the id's lines. The
// 1-hour cache-write split comes from the line holding the largest cache write
// (clamped to that write); the rest of the write is 5-minute. prev is null on
// an id's first line. Pure: never mutates prev or usage. Shared with
// context-gauge.js's tail read and the maintainer-side cost report and
// review replay.
// (prev: UsageMax | null, usage: object | undefined) -> UsageMax
function mergeUsage(prev, usage) {
  const u = usage || {};
  const base = prev || { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cacheWrite1h: 0, cacheWrite5m: 0 };
  const write = Number(u.cache_creation_input_tokens) || 0;
  const cacheCreate = Math.max(base.cacheCreate, write);
  let cacheWrite1h = base.cacheWrite1h;
  if (!prev || write > prev.cacheCreate) {
    cacheWrite1h = Math.min(write, Number(u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0);
  }
  return {
    input: Math.max(base.input, Number(u.input_tokens) || 0),
    output: Math.max(base.output, Number(u.output_tokens) || 0),
    cacheRead: Math.max(base.cacheRead, Number(u.cache_read_input_tokens) || 0),
    cacheCreate,
    cacheWrite1h,
    cacheWrite5m: cacheCreate - cacheWrite1h,
  };
}

// path, { fsImpl?, worktree?, signal? } -> Promise<rows>. Streams line by line;
// malformed lines (bad JSON, no timestamp, no message.role) are skipped.
// Every row also carries (#4029): turnClasses ({ [class]: count }, sparse — a
// user row counts its tool_result blocks by class, an assistant row is {}),
// turnStart (true on the first assistant row of each message.id and on any
// assistant row without a string id), and contextTokens (inputTokens +
// cacheRead + cacheCreate on turnStart rows, taken after the stream closes so
// it reflects the per-id max, which is mergeUsage's; 0 elsewhere).
// procedureFiles ({ [skills/… or context/… key]: count }, {} when none) is
// counted on the assistant row holding the tool_use: a Read adds 1 to
// readFileKey(file_path), a Bash 1 per bashProcedureFiles entry (#4359). User
// rows also carry agentCalls (#5597): the tool_result blocks classed dispatch
// whose call was Agent or Task — so a Workflow call counts in
// turnClasses.dispatch but not here.
// An assistant row holding AskUserQuestion tool_use blocks also carries asks
// ([{ id, ts, questions: string[] }]) and a user row holding a tool_result for
// such an id carries answers ([{ id, ts }]); rows with neither have no such key (#5556).
// Rejects when the file cannot be opened, with the real stat failure's
// code (ENOENT/EACCES/...; EUNKNOWN if the error carries none), with
// EISDIR when the path resolves but names a directory, or — if `stat`
// succeeds but the subsequent read fails (e.g. a mode-000 file, or a
// mid-file I/O error) — with whatever code the stream/readline error
// carries.
// `signal` (an AbortSignal, optional): when it aborts — or is already aborted —
// the readline is closed, the stream destroyed and the promise rejects with an
// Error whose code is 'ABORT_ERR' (#5555), so a deadline-bound caller never
// leaves a stream open. Without it nothing changes.
async function readUsage(filePath, { fsImpl = fs, worktree = null, signal = null } = {}) {
  if (signal && signal.aborted) throw abortError();
  statTranscriptOrThrow(fsImpl, filePath);
  const rows = [];
  const procedureReads = new Set(); // tool_use ids of Reads on procedure files
  const askIds = new Set(); // AskUserQuestion tool_use ids, to match their tool_result rows
  const toolUses = new Map(); // tool_use id -> { name, input }, to classify the matching tool_result
  // Claude Code writes one JSONL line per content block of an assistant
  // turn under the same message.id — summing every line would inflate tokens
  // ~3x. Main transcripts repeat one cumulative `usage` on each line; subagent
  // transcripts open the turn with a streaming snapshot and close it with the
  // final count. Per id, the first row carries the max of each usage field and
  // every later line is zeroed (#1929 whole-branch review fix 1; #3375 C1).
  const firstRowById = new Map();
  const usageById = new Map(); // message.id -> mergeUsage's running UsageMax
  const stream = fsImpl.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let onAbort = null;
  await new Promise((resolve, reject) => {
    stream.on('error', reject);
    rl.on('error', reject);
    if (signal) {
      // reject first: rl.close() emits 'close' synchronously, which would resolve.
      onAbort = () => { reject(abortError()); rl.close(); stream.destroy(); };
      signal.addEventListener('abort', onAbort, { once: true });
    }
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let entry;
      try { entry = JSON.parse(line); } catch { return; }
      const msg = entry && entry.message;
      if (!entry || typeof entry.timestamp !== 'string' || !msg || typeof msg.role !== 'string') return;
      const content = Array.isArray(msg.content) ? msg.content : [];
      const row = { ts: entry.timestamp, role: msg.role, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreate: 0, toolRoundTrip: false, procedureBytes: 0, model: null, turnClasses: {}, turnStart: false, contextTokens: 0, procedureFiles: {} };
      if (msg.role === 'assistant') {
        row.model = typeof msg.model === 'string' ? msg.model : null;
        const u = msg.usage || {};
        row.inputTokens = Number(u.input_tokens) || 0;
        row.outputTokens = Number(u.output_tokens) || 0;
        row.cacheRead = Number(u.cache_read_input_tokens) || 0;
        row.cacheCreate = Number(u.cache_creation_input_tokens) || 0;
        for (const b of content) {
          if (!b || b.type !== 'tool_use') continue;
          if (typeof b.id === 'string') toolUses.set(b.id, { name: b.name, input: b.input });
          if (b.name === 'AskUserQuestion' && typeof b.id === 'string') {
            askIds.add(b.id);
            const posed = b.input && Array.isArray(b.input.questions) ? b.input.questions : [];
            const questions = posed.map((q) => (q && typeof q.question === 'string' ? q.question : null)).filter((q) => q !== null);
            (row.asks || (row.asks = [])).push({ id: b.id, ts: entry.timestamp, questions });
          }
          if (b.name === 'Read' && b.input && isProcedurePath(b.input.file_path, worktree)) procedureReads.add(b.id);
          let keys = [];
          if (b.name === 'Read' && b.input) keys = [readFileKey(b.input.file_path, worktree)].filter(Boolean);
          else if (b.name === 'Bash' && b.input) keys = bashProcedureFiles(b.input.command, worktree);
          for (const k of keys) row.procedureFiles[k] = (row.procedureFiles[k] || 0) + 1;
        }
        row.turnStart = true;
        if (typeof msg.id === 'string') {
          const firstRow = firstRowById.get(msg.id);
          if (firstRow) {
            // Subagent transcripts open a turn with a streaming snapshot
            // (stop_reason null, a tiny output_tokens) and close it with the
            // settled count; keep the max per field on the first row and
            // zero this one (#3375 final review C1).
            const merged = mergeUsage(usageById.get(msg.id), u);
            usageById.set(msg.id, merged);
            firstRow.inputTokens = merged.input;
            firstRow.outputTokens = merged.output;
            firstRow.cacheRead = merged.cacheRead;
            firstRow.cacheCreate = merged.cacheCreate;
            for (const field of ['inputTokens', 'outputTokens', 'cacheRead', 'cacheCreate']) row[field] = 0;
            row.turnStart = false;
          } else {
            firstRowById.set(msg.id, row);
            usageById.set(msg.id, mergeUsage(null, u));
          }
        }
      } else {
        // User rows only: an assistant row carries no agentCalls key (#5597).
        row.agentCalls = 0;
        for (const b of content) {
          if (!b || b.type !== 'tool_result') continue;
          row.toolRoundTrip = true;
          if (typeof b.tool_use_id === 'string' && askIds.has(b.tool_use_id)) (row.answers || (row.answers = [])).push({ id: b.tool_use_id, ts: entry.timestamp });
          if (procedureReads.has(b.tool_use_id)) row.procedureBytes += resultBytes(b.content);
          const call = toolUses.get(b.tool_use_id) || {};
          const cls = classifyToolCall({ name: call.name, input: call.input, isError: b.is_error === true, resultText: resultText(b.content), worktree });
          row.turnClasses[cls] = (row.turnClasses[cls] || 0) + 1;
          if (cls === 'dispatch' && (call.name === 'Agent' || call.name === 'Task')) row.agentCalls += 1;
        }
      }
      rows.push(row);
    });
    rl.on('close', resolve);
  }).finally(() => { if (onAbort) signal.removeEventListener('abort', onAbort); });
  // After the stream closes, so a turn's first row holds the per-id max.
  for (const r of rows) if (r.turnStart) r.contextTokens = r.inputTokens + r.cacheRead + r.cacheCreate;
  return rows;
}

// path, promptId, { fsImpl?, chunkBytes?, keep? } -> rows (#5584). Synchronous:
// the parsed lines whose promptId equals promptId exactly (and, with `keep`, for
// which keep(row) is true), in file order. Reads in chunkBytes chunks, never the
// whole file at once, so a 100 MB transcript or a line holding a huge message
// costs one line of memory at most plus the rows returned: a prompt id is shared
// by every tool-result row of its turn, so a caller that wants only some rows
// passes `keep` and the rest are never retained. Only a line containing
// promptId as a substring is parsed; a line that does not parse is skipped. Stat
// failures throw as statTranscriptOrThrow does (ENOENT, EISDIR, ...); a read
// failure after the stat propagates with its own code.
function readPromptRows(filePath, promptId, { fsImpl = fs, chunkBytes = 65536, keep = () => true } = {}) {
  statTranscriptOrThrow(fsImpl, filePath);
  const rows = [];
  const take = (line) => {
    if (!line.includes(promptId)) return;
    let entry;
    try { entry = JSON.parse(line); } catch { return; }
    if (entry && entry.promptId === promptId && keep(entry)) rows.push(entry);
  };
  const fd = fsImpl.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(chunkBytes);
    const decoder = new StringDecoder('utf8'); // holds a multi-byte character split across chunks
    let carry = '';
    let pos = 0;
    for (;;) {
      const n = fsImpl.readSync(fd, buf, 0, chunkBytes, pos);
      if (n === 0) break;
      pos += n;
      const text = decoder.write(buf.subarray(0, n));
      let start = 0;
      let nl;
      while ((nl = text.indexOf('\n', start)) !== -1) {
        take(carry + text.slice(start, nl));
        carry = '';
        start = nl + 1;
      }
      carry += text.slice(start);
    }
    take(carry + decoder.end());
  } finally {
    fsImpl.closeSync(fd);
  }
  return rows;
}

// A Task-call agent transcript path: {…}/subagents/agent-{id}.jsonl, either separator (a path
// from another platform's timing.json included). A pure string test; no fs.
function isAgentTranscriptPath(p) {
  const parts = String(p).split(/[\\/]/);
  return parts.length >= 3 && parts[parts.length - 2] === 'subagents' && /^agent-.+\.jsonl$/.test(parts[parts.length - 1]);
}

// transcriptPath -> the session's {sessionId}/subagents directory: the sibling
// directory for a main transcript, or the containing directory for a
// subagent's own agent-{id}.jsonl (what /dispatch passes via --transcript),
// which already sits in it, or three levels up for a workflow agent's
// subagents/workflows/{runId}/agent-{id}.jsonl (#5597).
function subagentsDirFor(transcriptPath) {
  const p = String(transcriptPath);
  if (/^agent-.+\.jsonl$/.test(path.basename(p))
    && path.basename(path.dirname(path.dirname(p))) === 'workflows'
    && path.basename(path.dirname(path.dirname(path.dirname(p)))) === 'subagents') {
    return path.dirname(path.dirname(path.dirname(p)));
  }
  if (path.basename(path.dirname(p)) === 'subagents' && /^agent-.+\.jsonl$/.test(path.basename(p))) return path.dirname(p);
  return path.join(p.replace(/\.jsonl$/, ''), 'subagents');
}

// -> { meta, reason }: reason is null when meta parsed, else the notFound text.
// A meta that exists but cannot be used is named apart from an absent one, so
// a corrupt file never reads as an orphan transcript. (Not json-store's
// readJsonFile: its fallback discards the error this distinction needs.)
function readMeta(fsImpl, file) {
  let raw;
  try {
    raw = fsImpl.readFileSync(file, 'utf8');
  } catch (err) {
    const code = (err && err.code) || 'EUNKNOWN';
    return { meta: null, reason: code === 'ENOENT' ? 'meta not found' : `meta not readable (${code})` };
  }
  try {
    const m = JSON.parse(raw);
    if (m && typeof m === 'object' && !Array.isArray(m)) return { meta: m, reason: null };
  } catch { /* falls through to malformed */ }
  return { meta: null, reason: 'meta not readable (malformed)' };
}

const strOrNull = (v) => (typeof v === 'string' ? v : null);
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// First assistant row whose model matches /^claude-/, else the first non-null
// model, else null — a "<synthetic>" row can precede the real model id.
function transcriptModelOf(rows) {
  const models = rows.map((r) => r.model).filter((m) => m !== null);
  return models.find((m) => /^claude-/.test(m)) || models[0] || null;
}

// subagentsDir, { fsImpl?, window?, worktree? } -> Promise<{ items, notFound, excludedOutsideWindow, dirNotes }>.
// worktree is passed to readUsage, so a subagent's reads key as a main row's do.
// One Dispatch per agent-{id}; meta and transcript are paired by id. Token
// totals come from readUsage, so its message.id dedupe is the one in force.
// window = { start, end } (epoch ms, inclusive): rows outside it are dropped
// before span/tokens are taken, and a dispatch with no row inside it is
// counted in excludedOutsideWindow rather than listed. Window clipping runs
// after readUsage's message.id dedupe, so a turn whose first line falls before
// window.start loses its tokens (an edge undercount). Rows with no valid
// timestamp cannot be placed against the window; their tokens count toward a
// dispatch that has a timed row kept. A readable transcript with no timestamped
// rows is notFound 'transcript has no usage rows' (numbers null), decided
// before clipping. A symlinked subagents/ directory is never followed, and one
// with no agent-* files in it or in any workflow run directory is notFound
// rather than an empty table. Workflow run directories (subagents/workflows/
// {runId}/, see the header) are scanned only when the subagents/ listing names
// a workflows entry; their items carry workflowRunId (the run directory name)
// and workflowPhase (the meta's, when a string), direct items null for both. A
// workflow directory that is a symlink, cannot be read, or holds no agent
// files — and a run file whose agentCount disagrees with the agents found — is
// one dirNotes string (always present, [] when none). Never throws.
async function readDispatches(subagentsDir, { fsImpl = fs, window = null, worktree = null, signal = null } = {}) {
  // Absent or unreadable falls through: readdirSync below names the code.
  if (lstatType(subagentsDir, { fsImpl }).type === 'symlink') {
    return { items: [], notFound: `subagents/ directory is a symlink (not followed) at ${subagentsDir}`, excludedOutsideWindow: 0, dirNotes: [] };
  }
  let names;
  try {
    names = fsImpl.readdirSync(subagentsDir);
  } catch (err) {
    const code = (err && err.code) || 'EUNKNOWN';
    const notFound = code === 'ENOENT' || code === 'ENOTDIR'
      ? `no subagents/ directory at ${subagentsDir}`
      : `subagents/ directory not readable (${code}) at ${subagentsDir}`;
    return { items: [], notFound, excludedOutsideWindow: 0, dirNotes: [] };
  }
  const scans = [await scanAgentDir(subagentsDir, names, { fsImpl, window, worktree, signal, workflowRunId: null })];
  const dirNotes = [];
  // Decided on the listing already taken: no workflows entry, no extra fs call.
  if (names.includes('workflows')) await scanWorkflows(subagentsDir, { fsImpl, window, worktree, signal, scans, dirNotes });
  if (!scans.some((s) => s.ids > 0)) return { items: [], notFound: `no agent-* transcripts in ${subagentsDir}`, excludedOutsideWindow: 0, dirNotes };
  const built = [].concat(...scans.map((s) => s.built));
  built.sort((a, b) => {
    if (a.startMs === null && b.startMs !== null) return 1;
    if (b.startMs === null && a.startMs !== null) return -1;
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    if (a.d.agentId === b.d.agentId) return 0;
    return a.d.agentId < b.d.agentId ? -1 : 1;
  });
  const excludedOutsideWindow = scans.reduce((s, x) => s + x.excluded, 0);
  return { items: built.map((x) => x.d), notFound: null, excludedOutsideWindow, dirNotes };
}

// Scans subagents/workflows/ (the caller saw it listed): every run directory
// in it goes through scanAgentDir, pushing onto scans; every problem is a
// dirNotes string. Nothing symlinked is followed; plain files are ignored.
async function scanWorkflows(subagentsDir, { fsImpl, window, worktree, signal, scans, dirNotes }) {
  const wfDir = path.join(subagentsDir, 'workflows');
  const wt = lstatType(wfDir, { fsImpl });
  if (wt.type === 'symlink') { dirNotes.push(`workflows/ directory is a symlink (not followed) at ${wfDir}`); return; }
  if (wt.type === 'missing' || wt.type === 'unreadable') { dirNotes.push(`workflows/ directory not readable (${wt.code}) at ${wfDir}`); return; }
  if (wt.type !== 'directory') return;
  let runs;
  try {
    runs = fsImpl.readdirSync(wfDir);
  } catch (err) {
    dirNotes.push(`workflows/ directory not readable (${(err && err.code) || 'EUNKNOWN'}) at ${wfDir}`);
    return;
  }
  for (const runId of [...runs].sort()) {
    const runPath = path.join(wfDir, runId);
    const t = lstatType(runPath, { fsImpl });
    if (t.type === 'symlink') { dirNotes.push(`workflow run directory is a symlink (not followed) at ${runPath}`); continue; }
    if (t.type === 'missing' || t.type === 'unreadable') { dirNotes.push(`workflow run directory not readable (${t.code}) at ${runPath}`); continue; }
    if (t.type !== 'directory') continue;
    let runNames;
    try {
      runNames = fsImpl.readdirSync(runPath);
    } catch (err) {
      dirNotes.push(`workflow run directory not readable (${(err && err.code) || 'EUNKNOWN'}) at ${runPath}`);
      continue;
    }
    const scan = await scanAgentDir(runPath, runNames, { fsImpl, window, worktree, signal, workflowRunId: runId });
    if (scan.ids === 0) { dirNotes.push(`no agent-* transcripts in ${runPath}`); continue; }
    scans.push(scan);
    // Cross-check against the run file Claude Code writes beside the session's
    // subagents/ directory; any read or parse failure adds nothing.
    const runFile = path.join(path.dirname(subagentsDir), 'workflows', `${runId}.json`);
    if (lstatType(runFile, { fsImpl }).type !== 'file') continue;
    let run = null;
    // Silent on purpose: the run file only feeds this cross-check, and an absent or unusable one adds no note (spec).
    try { run = JSON.parse(fsImpl.readFileSync(runFile, 'utf8')); } catch { run = null; }
    const n = run && typeof run === 'object' && !Array.isArray(run) ? numOrNull(run.agentCount) : null;
    if (n !== null && n !== scan.ids) dirNotes.push(`workflow run ${runId}: run file agentCount ${n}, ${scan.ids} agent(s) found in ${runPath}`);
  }
}

// dir, names (its listing), { fsImpl, window, worktree, signal, workflowRunId } ->
// Promise<{ built: [{ d, startMs }], ids: number, excluded: number }>.
async function scanAgentDir(dir, names, { fsImpl, window, worktree, signal = null, workflowRunId }) {
  // A symlinked agent file could point outside the projects root, so it is
  // never followed (the lstat twin of locateTranscripts' realpath containment,
  // IL-150), and an entry lstat cannot prove regular is treated the same way
  // (fail closed). Skipped files are never read, but their agent id is still
  // listed, so the dispatch is named in a notFound line rather than vanishing.
  const skipped = new Map(); // file name -> reason ('symlink' or the lstat error code)
  const ids = new Set();
  for (const n of names) {
    const m = /^agent-(.+?)(\.meta\.json|\.jsonl)$/.exec(n);
    if (!m) continue;
    ids.add(m[1]);
    const t = lstatType(path.join(dir, n), { fsImpl });
    if (t.type === 'symlink') skipped.set(n, 'symlink');
    else if (t.type === 'missing' || t.type === 'unreadable') skipped.set(n, t.code);
  }
  const built = [];
  let excluded = 0;
  for (const agentId of ids) {
    const metaName = `agent-${agentId}.meta.json`;
    const jsonlName = `agent-${agentId}.jsonl`;
    const { meta, reason: metaReason } = skipped.has(metaName)
      ? { meta: null, reason: `meta not readable (${skipped.get(metaName)})` }
      : readMeta(fsImpl, path.join(dir, metaName));
    const d = {
      agentId,
      description: meta ? strOrNull(meta.description) : null,
      agentType: meta ? strOrNull(meta.agentType) : null,
      metaModel: meta ? strOrNull(meta.model) : null,
      transcriptModel: null,
      parentAgentId: meta ? strOrNull(meta.parentAgentId) : null,
      spawnDepth: meta ? numOrNull(meta.spawnDepth) : null,
      startTs: null, endTs: null, wallClockMs: null, tokens: null,
      procedureFiles: null, procedureFileRows: null,
      transcriptPath: path.join(dir, jsonlName),
      notFound: metaReason,
      workflowRunId: workflowRunId ?? null,
      workflowPhase: workflowRunId && meta && typeof meta.workflowPhase === 'string' ? meta.workflowPhase : null,
    };
    // A transcript failure keeps the meta reason ahead of it, so an orphan
    // whose transcript is also unusable still says its meta was missing.
    const fail = (reason) => { d.notFound = metaReason ? `${metaReason}; ${reason}` : reason; };
    let startMs = null;
    let rows = null;
    if (skipped.has(jsonlName)) {
      fail(`transcript not readable (${skipped.get(jsonlName)})`);
    } else {
      try {
        rows = await readUsage(d.transcriptPath, { fsImpl, worktree, signal });
      } catch (err) {
        fail(`transcript not readable (${(err && err.code) || 'EUNKNOWN'})`);
      }
    }
    if (rows) {
      const timed = rows.map((r) => ({ r, ms: Date.parse(r.ts) }));
      const stamped = timed.filter((x) => Number.isFinite(x.ms));
      if (stamped.length === 0) {
        // Readable but nothing usable (empty file, no/invalid timestamps, a
        // drifted layout): report not-found rather than zero-filled numbers.
        fail('transcript has no usage rows');
        built.push({ d, startMs });
        continue;
      }
      const kept = window ? stamped.filter((x) => x.ms >= window.start && x.ms <= window.end) : stamped;
      if (window && kept.length === 0) {
        excluded += 1;
        continue;
      }
      const first = kept.reduce((a, b) => (b.ms < a.ms ? b : a));
      const last = kept.reduce((a, b) => (b.ms > a.ms ? b : a));
      startMs = first.ms;
      d.startTs = first.r.ts;
      d.endTs = last.r.ts;
      d.wallClockMs = last.ms - first.ms;
      const keptRows = kept.map((x) => x.r).concat(timed.filter((x) => !Number.isFinite(x.ms)).map((x) => x.r));
      d.tokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
      for (const r of keptRows) {
        d.tokens.input += r.inputTokens;
        d.tokens.output += r.outputTokens;
        d.tokens.cacheRead += r.cacheRead;
        d.tokens.cacheCreate += r.cacheCreate;
      }
      // Per-file procedure reads over the same kept rows, plus one entry per
      // reading row in transcript order (keptRows puts untimed rows last, so
      // walk `timed` instead); an untimed row books to the dispatch's start.
      d.procedureFiles = {};
      d.procedureFileRows = [];
      const keptSet = new Set(keptRows);
      for (const { r, ms } of timed) {
        if (!keptSet.has(r) || Object.keys(r.procedureFiles).length === 0) continue;
        for (const [k, n] of Object.entries(r.procedureFiles)) d.procedureFiles[k] = (d.procedureFiles[k] || 0) + n;
        d.procedureFileRows.push({ ts: Number.isFinite(ms) ? r.ts : d.startTs, procedureFiles: { ...r.procedureFiles } });
      }
      d.transcriptModel = transcriptModelOf(keptRows);
    }
    built.push({ d, startMs });
  }
  return { built, ids: ids.size, excluded };
}

module.exports = { TRANSCRIPT_SLUG_RULE, slugForCwd, locateTranscripts, mergeUsage, readUsage, readPromptRows, isProcedurePath, resultBytes, statTranscriptOrThrow, subagentsDirFor, readDispatches, isAgentTranscriptPath, locateTaskTranscripts, runIdsNamed, RUN_ID_NAMED_RE, FIRST_ENTRY_CAP };
