'use strict';
// tools/guard-refusals/transcripts.js — #4028: walk Claude Code's transcript store and collect the
// Bash calls the worktree-isolation guard refused.
//
// Store shape: `<projectsDir>/<slug>/<session>.jsonl` (main) and
// `<projectsDir>/<slug>/<session>/subagents/<agent>.jsonl`. A file is kept when
// `since <= mtime < until`. Every line mentioning `tool_` is parsed; the `message.content` blocks of
// any entry type (a 2.1.302 `api-request-blob` echoes the request) are inspected, and a fork's
// transcript opens with its parent's whole history, so a call is identified by its `tool_use_id`
// and counted once: the first occurrence wins. A refusal is an `is_error` tool_result whose text holds
// ISOLATION_CLAUSE and then one of REFUSAL_SIGNATURES: a successful result that merely quotes the message (a
// `cat` of harness-refusal.js, a grep, a record body) is not one.
//
// Rows (#5587). Every `is_error` result whose text `classifyGuard` names a guard is a row, for any tool: the
// harness's two refusals (`harness-command`, `harness-file`) and a claude-tweaks hook denial (`plugin:<gate>`
// from the ordered GATE_FRAGMENTS table, `plugin:other` when none matches; the text must open with
// `claude-tweaks`, so a result that merely prints skill text is no row). A tool_result `content` array is read as
// its text blocks joined by a newline. A row needs its call in the scanned files: it carries the call's tool,
// command (capped at COMMAND_CAP, `truncated` says it was cut), cwd and timestamp. `refusals` stays today's
// list: the `harness-command` rows of a Bash or Write call, in the same order.
//
// Run attribution. A call's `runId` is the last pipeline run id named by the nearest preceding
// tool_use input of its own file (a run-dir path `.claude-tweaks/pipelines/<id>`; an input naming
// several ids takes the last). A subagent file that names none before the call inherits its parent
// session file's run: the run that parent had most recently named, by entry timestamp, when the
// subagent's first entry was written, else the parent's last run. `referencedRuns` lists every run id
// a Bash or Write tool_use input in the scanned files names, for a per-pipeline denominator.
//
// A walk over a store that keeps changing is expected to lose files: a file or directory that vanishes
// between the listing and the read (ENOENT), any other read error, and a JSON line cut off mid-write
// each increment `unreadable` and the walk continues. Only an error reading `projectsDir` itself throws,
// since a scan that silently comes back empty would certify a store it never read.

const fs = require('node:fs');
const path = require('node:path');
const { ISOLATION_CLAUSE, REFUSAL_SIGNATURES } = require('../../plugin/bin/lib/hooks/harness-refusal');
const { classifyReason } = require('./trace');

const RUN_ID = /\.claude-tweaks\/pipelines\/(\d{4}-\d{2}-\d{2}T\d{6}-[a-z0-9][a-z0-9-]*)/g;
const FIRST_TS = /"timestamp":"(\d{4}-\d{2}-\d{2}T[\d:.]+Z)"/;
const FIRST_TS_LINES = 20;
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

// Every run id a tool_use input names, in order.
function runIdsIn(input) {
  const ids = [];
  const text = JSON.stringify(input || {});
  RUN_ID.lastIndex = 0;
  for (let m = RUN_ID.exec(text); m; m = RUN_ID.exec(text)) ids.push(m[1]);
  return ids;
}

// The plugin gates' deny texts, ordered: the first gate with a fragment in a denial names it. Every
// fragment is a substring of a message `plugin/bin/lib/hooks/pre-tool-use.js` or `dispatch-prompt-gate.js`
// emits (tests/guard-refusals/gate-fragments.test.js pins that). `a materialize commit already landed in`
// is `checkBookkeepingStampsGate`'s other two deny texts, which carry no `integration-model: pr-first and`.
const GATE_FRAGMENTS = [
  ['teardown', ['teardown gate', 'is assigned to run']],
  ['worktree-always', ['this project requires an isolated worktree for']],
  ['lost-cwd', ['this command changes directory more ways than']],
  ['powershell-opaque', ['hands this guard literal (or base64) script text']],
  ['pipeline-shadow', ['a NEW pipeline run directory inside a', 'the command has changed directory more ways than']],
  ['bookkeeping-stamps', ['resolves integration-model: pr-first and', 'a materialize commit already landed in']],
  ['dispatch-config', ['has not written config.yml']],
  ['wd-enforcement', ['is active in worktree']],
  ['review-console-ask', ['which grants consoleAutoResolve']],
  ['dispatch-prompt', ['this Agent prompt names run']],
];
const FILE_REFUSAL_TAIL = 'Edit the worktree copy of this file';
const PLUGIN_DENIAL = /^(?:PreToolUse:[\w-]+ hook error: )?claude-tweaks[: ]/;

// Which guard a result text came from: `harness-command` (the harness's `Refusing to run` refusal),
// `harness-file` (its `Edit the worktree copy` refusal), `plugin:<gate>` or `plugin:other` (a claude-tweaks
// hook denial, which opens the text), else null. A Bash result opening `Exit code N` is never a plugin denial.
function classifyGuard(text) {
  const at = text.indexOf(ISOLATION_CLAUSE);
  if (at !== -1) {
    const after = at + ISOLATION_CLAUSE.length;
    if (REFUSAL_SIGNATURES.some((s) => text.indexOf(s, after) !== -1)) return 'harness-command';
    if (text.indexOf(FILE_REFUSAL_TAIL, after) !== -1) return 'harness-file';
  }
  if (!PLUGIN_DENIAL.test(text)) return null;
  for (const [gate, fragments] of GATE_FRAGMENTS) {
    if (fragments.some((f) => text.includes(f))) return `plugin:${gate}`;
  }
  return 'plugin:other';
}

// The text of a tool_result `content`: a string as is, an array the `text` of its text blocks joined by a
// newline (a plugin hook denial arrives so), anything else its JSON form.
function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
    if (texts.length) return texts.join('\n');
  }
  return JSON.stringify(content || '');
}

// The string a call is recorded by: the command of a Bash or Monitor call, the path of a file-writing one.
function commandOf(tool, input) {
  let v = '';
  if (tool === 'Bash' || tool === 'Monitor') v = input.command;
  else if (tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') v = input.file_path ?? input.notebook_path;
  return typeof v === 'string' ? v : '';
}

function toMs(v) {
  return v instanceof Date ? v.getTime() : Number(v);
}

// A subagent file's run, taken from its parent session file (see the header); null for any other file
// or when the parent was not scanned or named no run.
function inheritedRun(file, infos) {
  const dir = path.dirname(file);
  if (path.basename(dir) !== 'subagents') return null;
  const session = path.dirname(dir);
  const parent = infos.get(`${session}.jsonl`);
  const own = infos.get(file);
  if (!parent || !own) return null;
  if (own.firstTs) {
    const before = parent.timeline.filter((t) => t.ts && t.ts <= own.firstTs);
    if (before.length) return before[before.length - 1].run;
  }
  return parent.lastRun;
}

function scanStore({ projectsDir, match = null, since, until, fs: fsImpl = fs }) {
  const sinceMs = toMs(since);
  const untilMs = toMs(until);
  let unreadable = 0;
  const countUnreadable = () => { unreadable++; };

  const files = [];
  for (const slug of fsImpl.readdirSync(projectsDir).sort()) { // root errors throw
    if (match && !slug.includes(match)) continue;
    const slugDir = path.join(projectsDir, slug);
    let isDir;
    try {
      isDir = fsImpl.statSync(slugDir).isDirectory();
    } catch (_) {
      countUnreadable();
      continue;
    }
    if (!isDir) continue;
    for (const p of listCandidates(fsImpl, slugDir, countUnreadable)) {
      let mtime;
      try {
        mtime = fsImpl.statSync(p).mtimeMs;
      } catch (_) {
        countUnreadable();
        continue;
      }
      if (mtime >= sinceMs && mtime < untilMs) files.push(p);
    }
  }
  files.sort();

  const allCalls = new Map(); // toolUseId -> { tool, command, truncated, cwd, ts, runId, file } for any tool (first occurrence)
  const calls = new Map(); // the Bash and Write subset of allCalls
  const referenced = new Set();
  const infos = new Map(); // file path -> { timeline: [{ ts, run }], lastRun, firstTs }
  const results = new Map(); // toolUseId -> { file, line, guard, refusalText } (first guarded result)

  for (const file of files) {
    let run = null; // the nearest preceding pipeline run id this file's tool_use inputs named
    const info = { timeline: [], lastRun: null, firstTs: null };
    infos.set(file, info);
    try {
      eachLine(fsImpl, file, (lineBuf, lineNo) => {
        if (info.firstTs === null && lineNo <= FIRST_TS_LINES) {
          const ts = FIRST_TS.exec(lineBuf.toString('utf8'));
          if (ts) info.firstTs = ts[1];
        }
        if (lineBuf.indexOf(TOOL_MARK) === -1) return;
        const line = lineBuf.toString('utf8');
        let entry;
        try {
          entry = JSON.parse(line);
        } catch (_) {
          countUnreadable();
          return;
        }
        const content = entry && entry.message && entry.message.content;
        if (!Array.isArray(content)) return;
        const mentionsRun = line.includes(RUN_DIR_MARK);
        for (const block of content) {
          if (!block) continue;
          if (block.type === 'tool_use') {
            const isCall = block.name === 'Bash' || block.name === 'Write';
            if (mentionsRun) {
              const ids = runIdsIn(block.input);
              if (ids.length) {
                run = ids[ids.length - 1];
                info.lastRun = run;
                info.timeline.push({ ts: typeof entry.timestamp === 'string' ? entry.timestamp : null, run });
              }
              if (isCall) for (const id of ids) referenced.add(id);
            }
            if (!allCalls.has(block.id)) {
              const input = block.input || {};
              const raw = commandOf(block.name, input);
              const entryCall = {
                tool: block.name,
                command: raw.slice(0, COMMAND_CAP),
                truncated: raw.length > COMMAND_CAP,
                cwd: typeof entry.cwd === 'string' ? entry.cwd : null,
                ts: typeof entry.timestamp === 'string' ? entry.timestamp : null,
                runId: run,
                file,
              };
              allCalls.set(block.id, entryCall);
              if (isCall) calls.set(block.id, entryCall);
            }
          } else if (block.type === 'tool_result' && block.is_error === true && !results.has(block.tool_use_id)) {
            const text = resultText(block.content);
            const guard = classifyGuard(text);
            if (guard) {
              const at = text.indexOf(ISOLATION_CLAUSE);
              results.set(block.tool_use_id, {
                file,
                line: lineNo,
                guard,
                refusalText: guard === 'harness-command' ? text.slice(at, at + 1500) : null,
              });
            }
          }
        }
      });
    } catch (_) {
      countUnreadable();
    }
  }

  const rows = [];
  const refusals = [];
  for (const [toolUseId, r] of results) {
    const call = allCalls.get(toolUseId);
    if (!call) continue; // a result whose call is not in the window
    const runId = call.runId || inheritedRun(call.file, infos);
    const reason = r.guard === 'harness-command' ? classifyReason(r.refusalText) : null;
    rows.push({
      toolUseId,
      file: r.file,
      line: r.line,
      tool: call.tool,
      guard: r.guard,
      command: call.command,
      truncated: call.truncated,
      cwd: call.cwd,
      ts: call.ts,
      runId,
      reason,
    });
    if (r.guard === 'harness-command' && calls.has(toolUseId)) {
      refusals.push({
        toolUseId,
        file: r.file,
        line: r.line,
        tool: call.tool,
        guard: r.guard,
        command: call.command,
        cwd: call.cwd,
        ts: call.ts,
        refusalText: r.refusalText,
        reason,
        runId,
      });
    }
  }
  return { files: files.length, unreadable, calls: calls.size, refusals, rows, referencedRuns: [...referenced].sort() };
}

module.exports = { scanStore, eachLine, listCandidates, classifyGuard, GATE_FRAGMENTS };
