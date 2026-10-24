'use strict';
// tools/guard-refusals/transcripts.js — #4028: walk Claude Code's transcript store and collect the
// Bash calls the worktree-isolation guard refused.
//
// Store shape: `<projectsDir>/<slug>/<session>.jsonl` (main) and
// `<projectsDir>/<slug>/<session>/subagents/<agent>.jsonl`. A file is kept when
// `since <= mtime < until`. Every line mentioning `tool_` is parsed; the `message.content` blocks of
// any entry type (a 2.1.302 `api-request-blob` echoes the request) are inspected, and a fork's
// transcript opens with its parent's whole history, so a call is identified by its `tool_use_id`
// and counted once: the first occurrence wins.
//
// A walk over a store that keeps changing is expected to lose files: a file or directory that vanishes
// between the listing and the read (ENOENT), any other read error, and a JSON line cut off mid-write
// each increment `unreadable` and the walk continues. Only an error reading `projectsDir` itself throws,
// since a scan that silently comes back empty would certify a store it never read.

const fs = require('node:fs');
const path = require('node:path');
const { ISOLATION_CLAUSE } = require('../../plugin/bin/lib/hooks/harness-refusal');
const { classifyReason } = require('./trace');

const REFUSAL_TAIL = 'Refusing to run';
const RUN_ID = /\.claude-tweaks\/pipelines\/(\d{4}-\d{2}-\d{2}T\d{6}-[a-z0-9][a-z0-9-]*)/;
const RUN_DIR_MARK = '.claude-tweaks/pipelines/';
const COMMAND_CAP = 20000; // a stored command is cut here; shape detection reads the head of a call
const CHUNK = 1 << 20;

const TOOL_MARK = Buffer.from('tool_');

// Calls fn(lineBuffer, lineNumber) for each line of a file, reading it in chunks. The buffer is only
// valid inside the call.
function eachLine(fsImpl, file, fn) {
  const fd = fsImpl.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    let pending = [];
    let lineNo = 0;
    for (;;) {
      const n = fsImpl.readSync(fd, buf, 0, CHUNK, null);
      if (n === 0) break;
      const chunk = buf.subarray(0, n);
      let start = 0;
      for (;;) {
        const nl = chunk.indexOf(10, start);
        if (nl === -1) {
          if (start < n) pending.push(Buffer.from(chunk.subarray(start)));
          break;
        }
        const piece = chunk.subarray(start, nl);
        lineNo++;
        fn(pending.length ? Buffer.concat([...pending, piece]) : piece, lineNo);
        pending = [];
        start = nl + 1;
      }
    }
    if (pending.length) fn(Buffer.concat(pending), lineNo + 1);
  } finally {
    try { fsImpl.closeSync(fd); } catch (_) { /* closing a read-only fd */ }
  }
}

// Every candidate transcript path in a project directory; an entry that cannot be listed or stat-ed
// calls onUnreadable and is skipped.
function listCandidates(fsImpl, slugDir, onUnreadable) {
  const out = [];
  const list = (dir) => {
    try {
      return fsImpl.readdirSync(dir);
    } catch (_) {
      onUnreadable();
      return [];
    }
  };
  const isDir = (p) => {
    try {
      return fsImpl.statSync(p).isDirectory();
    } catch (_) {
      onUnreadable();
      return false;
    }
  };
  for (const name of list(slugDir)) {
    const p = path.join(slugDir, name);
    if (name.endsWith('.jsonl')) {
      out.push(p);
    } else if (isDir(p)) {
      const sub = path.join(p, 'subagents');
      let names;
      try {
        names = fsImpl.readdirSync(sub);
      } catch (err) {
        if (err.code !== 'ENOENT') onUnreadable(); // a session with no subagents has no such directory
        continue;
      }
      for (const n of names) if (n.endsWith('.jsonl')) out.push(path.join(sub, n));
    }
  }
  return out;
}

function toMs(v) {
  return v instanceof Date ? v.getTime() : Number(v);
}

function scanStore({ projectsDir, match = null, since, until, fs: fsImpl = fs }) {
  const sinceMs = toMs(since);
  const untilMs = toMs(until);
  let unreadable = 0;
  const bump = () => { unreadable++; };

  const files = [];
  for (const slug of fsImpl.readdirSync(projectsDir).sort()) { // root errors throw
    if (match && !slug.includes(match)) continue;
    const slugDir = path.join(projectsDir, slug);
    let isDir;
    try {
      isDir = fsImpl.statSync(slugDir).isDirectory();
    } catch (_) {
      bump();
      continue;
    }
    if (!isDir) continue;
    for (const p of listCandidates(fsImpl, slugDir, bump)) {
      let mtime;
      try {
        mtime = fsImpl.statSync(p).mtimeMs;
      } catch (_) {
        bump();
        continue;
      }
      if (mtime >= sinceMs && mtime < untilMs) files.push(p);
    }
  }
  files.sort();

  const calls = new Map(); // toolUseId -> { tool, command, runId } (first occurrence)
  const results = new Map(); // toolUseId -> { file, line, refusalText } (first refused result)

  for (const file of files) {
    let run = null; // the nearest preceding pipeline run id this file's tool_use inputs named
    try {
      eachLine(fsImpl, file, (lineBuf, lineNo) => {
        if (lineBuf.indexOf(TOOL_MARK) === -1) return;
        const line = lineBuf.toString('utf8');
        let entry;
        try {
          entry = JSON.parse(line);
        } catch (_) {
          unreadable++;
          return;
        }
        const content = entry && entry.message && entry.message.content;
        if (!Array.isArray(content)) return;
        const mentionsRun = line.includes(RUN_DIR_MARK);
        for (const block of content) {
          if (!block) continue;
          if (block.type === 'tool_use') {
            if (mentionsRun) {
              const m = RUN_ID.exec(JSON.stringify(block.input || {}));
              if (m) run = m[1];
            }
            if ((block.name === 'Bash' || block.name === 'Write') && !calls.has(block.id)) {
              const input = block.input || {};
              const command = block.name === 'Bash' ? input.command : input.file_path;
              calls.set(block.id, {
                tool: block.name,
                command: typeof command === 'string' ? command.slice(0, COMMAND_CAP) : '',
                runId: run,
              });
            }
          } else if (block.type === 'tool_result' && !results.has(block.tool_use_id)) {
            const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '');
            const at = text.indexOf(ISOLATION_CLAUSE);
            if (at !== -1 && text.indexOf(REFUSAL_TAIL, at + ISOLATION_CLAUSE.length) !== -1) {
              results.set(block.tool_use_id, { file, line: lineNo, refusalText: text.slice(at, at + 1500) });
            }
          }
        }
      });
    } catch (_) {
      unreadable++;
    }
  }

  const refusals = [];
  for (const [toolUseId, r] of results) {
    const call = calls.get(toolUseId);
    if (!call) continue; // a result whose call is not in the window (or is not a Bash/Write call)
    refusals.push({
      toolUseId,
      file: r.file,
      line: r.line,
      tool: call.tool,
      command: call.command,
      refusalText: r.refusalText,
      reason: classifyReason(r.refusalText),
      runId: call.runId,
    });
  }
  return { files: files.length, unreadable, calls: calls.size, refusals };
}

module.exports = { scanStore };
