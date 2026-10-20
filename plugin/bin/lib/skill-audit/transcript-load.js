'use strict';

// Transcript-measured per-invocation skill load (#3309, parent #3305).
//
// load.js (#3307) bounds what an invocation can load from citations; this
// module measures what real sessions did load, from Claude Code's own
// session transcripts. A row is one skill invocation: the injected skill
// body plus every skill-file Read until the next invocation.
//
// OBSERVED TRANSCRIPT SHAPES (Task 0, Claude Code 2.1.302, 2026-10-17;
// excerpts redacted to structure — field names and value kinds only):
//
// (a) A model-initiated invocation is an assistant line whose content holds
//     one tool_use block. Claude Code writes one JSONL line per content
//     block, so a turn with two Skill calls is two lines sharing one
//     message.id (observed twice in 400 recent transcripts):
//       {"type":"assistant","message":{"id":"msg_…","role":"assistant",
//        "content":[{"type":"tool_use","id":"toolu_…","name":"Skill",
//                    "input":{"skill":"claude-tweaks:build","args":"…"}}]}}
//     Its tool_result is a user line whose content is the string
//     "Launching skill: {skill}" (toolUseResult {success, commandName}).
// (b) The injected body follows as a user line with isMeta:true and
//     sourceToolUseID set to the tool_use id from (a); its content is an
//     array holding one text block that begins with the literal
//     "Base directory for this skill: {absolute skill dir}".
// (c) A typed slash command leaves no tool_use. Its user line has string
//     content carrying <command-message>, <command-name>/{skill}</command-name>
//     and <command-args> tags (order varies), and the next line is the
//     same isMeta body as (b) but with no sourceToolUseID. A built-in
//     command (/clear) has the tags and no body.
// (d) Subagent transcripts live at
//       {config-dir}/projects/{slug}/{sessionId}/subagents/agent-{id}.jsonl
//     beside agent-{id}.meta.json ({agentType, …}; agentType includes
//     "fork"); {config-dir} is $CLAUDE_CONFIG_DIR, default ~/.claude. The
//     spec expected them directly in {sessionId}/ — they sit one level down.
//     A fork transcript opens with a {"type":"fork-context-ref",
//     "parentSessionId",…} line and never replays the parent's history, so
//     its Reads are its own.
// (e) A skill-file Read is an assistant tool_use {name:"Read",
//     input:{file_path}} answered by a user tool_result whose content is the
//     numbered file text as a string.
// (f) input.skill is "{plugin}:{skill}" for a plugin skill, and for a
//     project-local skill either bare ("{skill}") or, from a worktree
//     session, "{path to the skills dir's parent}:{skill}"
//     (".claude/worktrees/{name}:{skill}"). Rows from readSkillLoads still
//     keep the name as invoked; bin/skill-load-report.js folds the path
//     form into the bare name before summarizing.
//
// Real-input check (20 newest main transcripts of this repo + 510 subagent
// transcripts): 442 invocation rows = 416 unique Skill tool_use ids + 26
// typed-command bodies, matching an independent JSON count exactly.
//
// Attribution: one cursor per transcript, set by the last invocation before
// a Read in line order — a Skill tool_use (a), or a typed command's body (c).
// Two Skill calls in one turn leave the cursor on the second; that is a
// documented limitation, not an error. A skill-path Read with no preceding
// invocation, and an injected body no invocation claims, land in
// "({kind}, unattributed)", so nothing is dropped. injectedBytes counts the
// whole injected block, including its "Base directory for this skill:" line
// and any trailing ARGUMENTS: text the invocation carried — that is what the
// session paid for, but not all of it is skill prose. The cursor never
// expires: in a session editing this repo, a Read of plugin/skills/**.md
// long after an invocation is still attributed to the last-invoked skill.

const fs = require('fs');
const readline = require('readline');
const { isProcedurePath, resultBytes, statTranscriptOrThrow } = require('../timing/transcript');

const BASE_DIR_PREFIX = 'Base directory for this skill:';
const COMMAND_NAME = /<command-name>\/?([^<\s]+)<\/command-name>/;
const KINDS = new Set(['main', 'subagent']);

const unattributedSkill = (kind) => `(${kind}, unattributed)`;

function blocksOf(msg) {
  if (Array.isArray(msg.content)) return msg.content;
  if (typeof msg.content === 'string') return [{ type: 'text', text: msg.content }];
  return [];
}

// path, { fsImpl?, worktree?, kind } -> Promise<[{ skill, injectedBytes,
// readBytes, readPaths }]>, rows in invocation order (the unattributed row,
// when any, sits where its first bytes appeared). Rejects with the stat
// failure's code when the file cannot be opened, EISDIR for a directory, or
// the stream's error mid-read; malformed lines are skipped.
async function readSkillLoads(filePath, { fsImpl = fs, worktree = null, kind } = {}) {
  if (!KINDS.has(kind)) throw new Error(`readSkillLoads: kind must be "main" or "subagent", got ${JSON.stringify(kind)}`);
  statTranscriptOrThrow(fsImpl, filePath);
  const rows = [];
  const newRow = (skill) => {
    const r = { skill, injectedBytes: 0, readBytes: 0, readPaths: [] };
    rows.push(r);
    return r;
  };
  let orphan = null;
  const orphanRow = () => orphan || (orphan = newRow(unattributedSkill(kind)));
  const skillUses = new Map(); // Skill tool_use id -> its row
  const injectedFor = new Set(); // Skill tool_use ids whose body was counted
  const reads = new Map(); // Read tool_use id -> { row, path }
  const counted = new Set(); // Read tool_use ids whose result was counted
  let cursor = null;
  let pendingCommand = null;

  const onLine = (line) => {
    if (!line.trim()) return;
    let entry;
    try { entry = JSON.parse(line); } catch { return; }
    const msg = entry && entry.message;
    if (!msg || typeof msg.role !== 'string') return;
    const blocks = blocksOf(msg);
    if (msg.role === 'assistant') {
      pendingCommand = null;
      for (const b of blocks) {
        if (!b || b.type !== 'tool_use' || !b.input) continue;
        if (b.name === 'Skill' && typeof b.input.skill === 'string' && !skillUses.has(b.id)) {
          cursor = newRow(b.input.skill);
          skillUses.set(b.id, cursor);
        } else if (b.name === 'Read' && !reads.has(b.id) && isProcedurePath(b.input.file_path, worktree)) {
          reads.set(b.id, { row: cursor || orphanRow(), path: b.input.file_path });
        }
      }
      return;
    }
    if (msg.role !== 'user') return;
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === 'tool_result') {
        const r = reads.get(b.tool_use_id);
        if (!r || counted.has(b.tool_use_id) || b.is_error === true) continue;
        counted.add(b.tool_use_id);
        r.row.readBytes += resultBytes(b.content);
        if (!r.row.readPaths.includes(r.path)) r.row.readPaths.push(r.path);
      } else if (b.type === 'text' && typeof b.text === 'string') {
        if (b.text.startsWith(BASE_DIR_PREFIX)) {
          const bytes = Buffer.byteLength(b.text, 'utf8');
          const src = entry.sourceToolUseID;
          if (typeof src === 'string' && skillUses.has(src) && !injectedFor.has(src)) {
            injectedFor.add(src);
            skillUses.get(src).injectedBytes += bytes;
          } else if (!src && pendingCommand) {
            cursor = newRow(pendingCommand);
            cursor.injectedBytes += bytes;
            pendingCommand = null;
          } else {
            orphanRow().injectedBytes += bytes;
          }
        } else if (entry.isMeta !== true) {
          const m = COMMAND_NAME.exec(b.text);
          if (m) pendingCommand = m[1];
        }
      }
    }
  };

  const stream = fsImpl.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  await new Promise((resolve, reject) => {
    stream.on('error', reject);
    rl.on('error', reject);
    rl.on('line', onLine);
    rl.on('close', resolve);
  });
  return rows;
}

// rows -> [{ skill, invocations, median, max }] over injectedBytes +
// readBytes, sorted by skill ascending. An even count's median is the
// rounded mean of the two middle totals.
function summarizeLoads(rows) {
  const totals = new Map();
  for (const r of rows) {
    if (!totals.has(r.skill)) totals.set(r.skill, []);
    totals.get(r.skill).push(r.injectedBytes + r.readBytes);
  }
  return [...totals.entries()]
    .map(([skill, t]) => {
      t.sort((a, b) => a - b);
      const n = t.length;
      const mid = n >> 1;
      const median = n % 2 === 1 ? t[mid] : Math.round((t[mid - 1] + t[mid]) / 2);
      return { skill, invocations: n, median, max: t[n - 1] };
    })
    .sort((a, b) => (a.skill < b.skill ? -1 : a.skill > b.skill ? 1 : 0));
}

module.exports = { BASE_DIR_PREFIX, readSkillLoads, summarizeLoads, unattributedSkill };
