# Report transcript-measured skill load in /harness-health (#3309) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure what real Claude Code sessions load per skill invocation, from this machine's transcripts (main sessions and subagents). `/claude-tweaks:harness-health` reports it every firing and files a record for any skill whose measured load exceeds its static closure.

**Architecture:** `plugin/bin/lib/skill-audit/transcript-load.js` streams one transcript and returns one row per invocation: injected body bytes plus skill-file Read bytes, attributed by a single cursor. `plugin/bin/skill-load-report.js` enumerates the newest main transcripts for a cwd plus each one's subagents, summarizes per skill, joins each skill to `load.js`'s closure, and prints one JSON line. A "Skill-load check" paragraph in `harness-health/SKILL.md` runs the CLI, reports, files, and auto-closes.

**Tech Stack:** Node 18+, `node:test`, `node:assert`. No dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T062549-spec-3307-3308-3306-3309-3310-3311/spec-3309/work/3309-spec.md` (materialized from GitHub issue #3309) _(Spec file deleted at the series close-out in PR #3433; the GitHub record, with its As-built notes, is the durable spec.)_

## Build-time rulings that supersede the spec text

Task 0 (the spec's blocking transcript-format check) ran in the build session, before this plan was written, over this machine's real transcripts (Claude Code 2.1.302). Its recorded shapes are the header of `transcript-load.js` in Task 1. Reversed premises are logged in the spec's run-dir `decisions.md`:

1. **Subagent location (premise reversed).** Subagent transcripts are at `{projects}/{slug}/{sessionId}/subagents/agent-{id}.jsonl` (beside `agent-{id}.meta.json`), one level below where the spec expected them. `{projects}` is `$CLAUDE_CONFIG_DIR/projects`, default `~/.claude/projects`, following `dream-scan.js`'s precedent. On this machine `~/.claude/projects` holds none of this repo's sessions. `timing/transcript.js`'s `locateTranscripts` ignores `CLAUDE_CONFIG_DIR`. That is a pre-existing `phase-timing.js` defect, out of scope here (non-goal: don't modify `transcript.js`) and routed to the ledger. The CLI resolves the config dir itself.
2. **Fork subagents** open with a `{"type":"fork-context-ref",…}` line and never replay the parent's history. A fork transcript is read like any subagent transcript (98 fork files probed; every Skill call in them is the fork's own).
3. **Typed slash command** = a user line with string content carrying `<command-name>/{skill}</command-name>`, followed by the isMeta `Base directory for this skill:` body with **no** `sourceToolUseID`. A built-in command has the tag and no body, so it is not an invocation.
4. **Closure join is namespace-aware.** The spec says to match "on the skill name part of `entry`". Matching on the name part alone would join another plugin's same-named skill to ours and break AC7. So a skill `{ns}:{name}` joins only a root whose `.claude-plugin/plugin.json` `name` is `{ns}`. A bare name, or a path-namespaced one (`.claude/worktrees/x:{name}`, which is how a worktree session invokes a project-local skill, observed), joins a root with no plugin.json.
5. **Output adds `unreadable`**, the count of transcript files that could not be read. A run where no main transcript could be read is `no-data`, never zero load (AC6's spirit).
6. **Error Read results** (`is_error: true`) contribute 0 bytes: no file content was loaded.

Real-input check, already run on the scratch build of this exact code against the 20 newest main transcripts of the main checkout's slug plus their 510 subagent transcripts:
- 442 invocation rows = 416 unique Skill tool_use ids + 26 typed-command bodies, matching an independent JSON count over the same 530 files exactly.
- Wall time 2.5 s.
- No skill is over its closure. Closures run 1.2–1.9 MB because the static closure is transitive; the measured max is 236,519 B, for `claude-tweaks:flow`.

## Global Constraints

- `plugin/bin/lib/timing/transcript.js` is not modified. `isProcedurePath` and `slugForCwd` are imported, not copied.
- `plugin/bin/lib/skill-audit/load.js` is not modified. `entryPointLoads` and `discoverPluginRoots` are imported.
- `tests/bin-lib/timing/transcript.test.js` passes unchanged (AC9).
- The CLI's `require.main` guard assigns `process.exitCode` and never calls `process.exit(` (`tests/bin-lib/exit-code-conformance.test.js`).
- Reports and filed records carry skill names, byte counts and `sessions` only, never transcript text: transcript contents are untrusted.
- Commit style is `{Verb} {what} — {detail} (refs #3309)`, and the message ends with the line `Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717`. Never write "closes" or "fixes #".

## Review Focus

1. **An unreadable transcript must never read as zero load.** It is counted in `unreadable`, and with no main transcript read the status is `no-data`. Pinned in Task 2's chmod-000 test.
2. **A fork transcript's non-message first line must not break parsing.** Pinned in Task 1's `fork-context-ref` fixture.
3. **Another plugin's same-named skill must not borrow our closure.** Pinned in Task 2's `other:alpha` test.
4. **`max === closure` is not over the closure.** Pinned in Task 2's equality test.
5. **A built-in typed command (`/clear`) is not an invocation.** Pinned in Task 1.

## Plan-authoring checks applied

- **Inline self-consistency:** every inlined test was run against the inlined implementation in a scratch mirror of this worktree's `plugin/bin`. The result was 25/25 pass: 12 in `transcript-load.test.js`, 13 in `skill-load-report-cli.test.js` including Task 3's prose pin, run against the mirror `SKILL.md` with Task 3's paragraph inserted.
- **Real-input probe + independent count:** see the rulings above (442 = 442). Task 2 Step 5 re-runs the probe on the built CLI.
- **Byte-pin:** `harness-health/SKILL.md` goes from 45,999 to 47,804 B. The binding limits are `CEILING_BYTES` 51,200 (3,396 B headroom left) and the #3306 rail at 52,500 B / 2,000 lines. `git grep -n "harness-health/SKILL.md" -- tests` shows no file-specific byte pin.
- **Verbatim command run-once:** the paragraph's CLI command was run in the scratch build. It ran with `--plugin-root plugin` from this worktree, because `${CLAUDE_PLUGIN_ROOT}` resolves to the installed 6.140.0 cache, which lacks the new bin until release. Output: `status ok`, 2 sessions, 0 unreadable. The paragraph dictates no verbatim `gh` command. Filing and dedup reuse the Policy schema check's documented fetch.
- **Sole-site:** the CLI is the only caller of `readSkillLoads`. Proof: `git grep -n "readSkillLoads"` after Task 2 lists only `transcript-load.js`, its test, and `skill-load-report.js`.
- **Return-shape widening / moved prose / mirror surfaces:** none. These are new modules, nothing moves, and no skill flag is added.

---

### Task 1: transcript-load.js — per-invocation rows from one transcript

**Files:**
- Create: `plugin/bin/lib/skill-audit/transcript-load.js`
- Test: `tests/bin-lib/skill-audit/transcript-load.test.js`

**Interfaces:**
- Consumes: `isProcedurePath(filePath, worktree)` from `plugin/bin/lib/timing/transcript.js`.
- Produces:
  - `readSkillLoads(filePath, { fsImpl?, worktree?, kind: 'main' | 'subagent' }) -> Promise<Array<{ skill: string, injectedBytes: number, readBytes: number, readPaths: string[] }>>`, which rejects with `err.code` (ENOENT / EISDIR / EACCES…) when the file cannot be read.
  - `summarizeLoads(rows) -> Array<{ skill, invocations, median, max }>`, sorted by skill ascending.
  - `unattributedSkill(kind) -> '(main, unattributed)' | '(subagent, unattributed)'`.
  - `BASE_DIR_PREFIX`.

- [ ] **Step 1: Write the failing test.** Create `tests/bin-lib/skill-audit/transcript-load.test.js` with exactly:

```js
// tests/bin-lib/skill-audit/transcript-load.test.js — readSkillLoads /
// summarizeLoads (#3309). Every fixture line is built by a helper named for
// the observed transcript shape it mirrors — (a)-(e) in transcript-load.js's
// header — never an invented shape.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readSkillLoads, summarizeLoads, unattributedSkill } = require('../../../plugin/bin/lib/skill-audit/transcript-load');

const TS = '2026-10-17T12:00:00.000Z';
const SKILL_A = '/home/u/.claude/plugins/cache/m/claude-tweaks/6.0.0/skills/build/plan-audit.md';
const SKILL_B = '/home/u/.claude/plugins/cache/m/claude-tweaks/6.0.0/skills/build/worktree-setup.md';
let seq = 0;
const nextId = (p) => `${p}_${++seq}`;

// Shape (a): one assistant line per tool_use block; Skill input {skill}.
function skillUse(skill, toolId, msgId = nextId('msg')) {
  return { type: 'assistant', timestamp: TS, message: { id: msgId, role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'Skill', input: { skill } }] } };
}
// Shape (a): the Skill tool_result — a "Launching skill:" string.
function skillLaunched(toolId, skill) {
  return { type: 'user', timestamp: TS, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: `Launching skill: ${skill}` }] }, toolUseResult: { success: true, commandName: skill } };
}
// Shape (b)/(c): the isMeta injected body, exactly `bytes` UTF-8 bytes;
// sourceToolUseID only on the Skill-tool path (b).
function injectedBody(bytes, sourceToolUseID) {
  const head = 'Base directory for this skill: /home/u/.claude/plugins/cache/m/claude-tweaks/6.0.0/skills/build\n\n';
  const line = { type: 'user', isMeta: true, timestamp: TS, message: { role: 'user', content: [{ type: 'text', text: head + 'x'.repeat(bytes - head.length) }] } };
  if (sourceToolUseID) line.sourceToolUseID = sourceToolUseID;
  return line;
}
// Shape (c): a typed slash command's tag line (string content).
function typedCommand(skill) {
  return { type: 'user', timestamp: TS, message: { role: 'user', content: `<command-message>${skill}</command-message>\n<command-name>/${skill}</command-name>\n<command-args></command-args>` } };
}
// Shape (e): a Read tool_use and its string tool_result of `bytes` bytes.
function readUse(filePath, toolId, msgId = nextId('msg')) {
  return { type: 'assistant', timestamp: TS, message: { id: msgId, role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'Read', input: { file_path: filePath } }] } };
}
function readResult(toolId, bytes, extra = {}) {
  return { type: 'user', timestamp: TS, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: 'y'.repeat(bytes), ...extra }] } };
}

function writeTranscript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-load-'));
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return file;
}

test('one Skill invocation (a)+(b) then two skill-path Reads (e) is one row with both paths', async () => {
  const file = writeTranscript([
    skillUse('claude-tweaks:build', 'toolu_s1'),
    skillLaunched('toolu_s1', 'claude-tweaks:build'),
    injectedBody(10000, 'toolu_s1'),
    readUse(SKILL_A, 'toolu_r1'),
    readResult('toolu_r1', 3000),
    readUse(SKILL_B, 'toolu_r2'),
    readResult('toolu_r2', 2000),
  ]);
  const rows = await readSkillLoads(file, { kind: 'main' });
  assert.deepStrictEqual(rows, [{ skill: 'claude-tweaks:build', injectedBytes: 10000, readBytes: 5000, readPaths: [SKILL_A, SKILL_B] }]);
});

test('two sequential invocations (a) attribute each Read to the invocation before it', async () => {
  const file = writeTranscript([
    skillUse('claude-tweaks:build', 'toolu_s1'),
    injectedBody(1000, 'toolu_s1'),
    readUse(SKILL_A, 'toolu_r1'),
    readResult('toolu_r1', 300),
    skillUse('claude-tweaks:test', 'toolu_s2'),
    injectedBody(2000, 'toolu_s2'),
    readUse(SKILL_B, 'toolu_r2'),
    readResult('toolu_r2', 400),
  ]);
  const rows = await readSkillLoads(file, { kind: 'main' });
  assert.deepStrictEqual(rows.map((r) => [r.skill, r.injectedBytes, r.readBytes]), [
    ['claude-tweaks:build', 1000, 300],
    ['claude-tweaks:test', 2000, 400],
  ]);
});

test('two Skill tool_use lines (a) under one message.id: a following Read goes to the second', async () => {
  const file = writeTranscript([
    skillUse('claude-tweaks:build', 'toolu_s1', 'msg_same'),
    skillUse('claude-tweaks:test', 'toolu_s2', 'msg_same'),
    injectedBody(1000, 'toolu_s1'),
    injectedBody(2000, 'toolu_s2'),
    readUse(SKILL_A, 'toolu_r1'),
    readResult('toolu_r1', 500),
  ]);
  const rows = await readSkillLoads(file, { kind: 'main' });
  assert.deepStrictEqual(rows.map((r) => [r.skill, r.injectedBytes, r.readBytes]), [
    ['claude-tweaks:build', 1000, 0],
    ['claude-tweaks:test', 2000, 500],
  ]);
});

test('a Read of a non-skill path (e) contributes 0 bytes', async () => {
  const file = writeTranscript([
    skillUse('claude-tweaks:build', 'toolu_s1'),
    injectedBody(1000, 'toolu_s1'),
    readUse('/repo/src/index.js', 'toolu_r1'),
    readResult('toolu_r1', 9999),
  ]);
  const rows = await readSkillLoads(file, { kind: 'main' });
  assert.deepStrictEqual(rows, [{ skill: 'claude-tweaks:build', injectedBytes: 1000, readBytes: 0, readPaths: [] }]);
});

test('a skill-path Read (e) before any invocation lands in (main, unattributed)', async () => {
  const file = writeTranscript([
    readUse(SKILL_A, 'toolu_r1'),
    readResult('toolu_r1', 700),
    skillUse('claude-tweaks:build', 'toolu_s1'),
    injectedBody(1000, 'toolu_s1'),
  ]);
  const rows = await readSkillLoads(file, { kind: 'main' });
  assert.strictEqual(unattributedSkill('main'), '(main, unattributed)');
  assert.deepStrictEqual(rows.map((r) => [r.skill, r.injectedBytes, r.readBytes]), [
    ['(main, unattributed)', 0, 700],
    ['claude-tweaks:build', 1000, 0],
  ]);
});

test('a subagent transcript (d) with no invocation puts its Read bytes in (subagent, unattributed), past a fork-context-ref first line', async () => {
  const file = writeTranscript([
    { type: 'fork-context-ref', agentId: 'a1', parentSessionId: 'p1', parentLastUuid: 'u1', contextLength: 10 },
    readUse(SKILL_A, 'toolu_r1'),
    readResult('toolu_r1', 800),
  ]);
  const rows = await readSkillLoads(file, { kind: 'subagent' });
  assert.deepStrictEqual(rows, [{ skill: '(subagent, unattributed)', injectedBytes: 0, readBytes: 800, readPaths: [SKILL_A] }]);
});

test('a typed slash command (c) is an invocation: its body sets the row and the cursor', async () => {
  const file = writeTranscript([
    typedCommand('claude-tweaks:flow'),
    injectedBody(4000),
    readUse(SKILL_A, 'toolu_r1'),
    readResult('toolu_r1', 600),
  ]);
  const rows = await readSkillLoads(file, { kind: 'main' });
  assert.deepStrictEqual(rows, [{ skill: 'claude-tweaks:flow', injectedBytes: 4000, readBytes: 600, readPaths: [SKILL_A] }]);
});

test('a built-in typed command (c) with no body is not an invocation', async () => {
  const file = writeTranscript([
    typedCommand('clear'),
    readUse(SKILL_A, 'toolu_r1'),
    readResult('toolu_r1', 600),
  ]);
  const rows = await readSkillLoads(file, { kind: 'main' });
  assert.deepStrictEqual(rows.map((r) => r.skill), ['(main, unattributed)']);
});

test('an injected body (b) no invocation claims lands in the unattributed row, never dropped', async () => {
  const file = writeTranscript([injectedBody(1500, 'toolu_unknown')]);
  const rows = await readSkillLoads(file, { kind: 'main' });
  assert.deepStrictEqual(rows, [{ skill: '(main, unattributed)', injectedBytes: 1500, readBytes: 0, readPaths: [] }]);
});

test('an error Read result counts 0, a repeated tool_result counts once, malformed lines are skipped', async () => {
  const file = writeTranscript([
    skillUse('claude-tweaks:build', 'toolu_s1'),
    'not json',
    '{"message":null}',
    readUse(SKILL_A, 'toolu_r1'),
    readResult('toolu_r1', 900, { is_error: true }),
    readUse(SKILL_B, 'toolu_r2'),
    readResult('toolu_r2', 100),
    readResult('toolu_r2', 100),
  ]);
  const rows = await readSkillLoads(file, { kind: 'main' });
  assert.deepStrictEqual(rows, [{ skill: 'claude-tweaks:build', injectedBytes: 0, readBytes: 100, readPaths: [SKILL_B] }]);
});

test('an unopenable path rejects with its code; a bad kind throws', async () => {
  await assert.rejects(readSkillLoads(path.join(os.tmpdir(), 'no-such-transcript-3309.jsonl'), { kind: 'main' }), { code: 'ENOENT' });
  await assert.rejects(readSkillLoads(os.tmpdir(), { kind: 'main' }), { code: 'EISDIR' });
  await assert.rejects(readSkillLoads(writeTranscript([]), { kind: 'fork' }), /kind must be "main" or "subagent"/);
});

test('summarizeLoads: invocations, median (odd and even counts), max; sorted by skill', () => {
  const row = (skill, injectedBytes, readBytes) => ({ skill, injectedBytes, readBytes, readPaths: [] });
  const out = summarizeLoads([
    row('b', 100, 0), row('b', 200, 100), row('b', 50, 0),
    row('a', 10, 0), row('a', 20, 1),
  ]);
  assert.deepStrictEqual(out, [
    { skill: 'a', invocations: 2, median: 16, max: 21 },
    { skill: 'b', invocations: 3, median: 100, max: 300 },
  ]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/skill-audit/transcript-load.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/skill-audit/transcript-load'`

- [ ] **Step 3: Write the implementation.** Create `plugin/bin/lib/skill-audit/transcript-load.js` with exactly the content below. The header is Task 0's recorded shapes (AC1); keep it verbatim.

```js
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
//     (".claude/worktrees/{name}:{skill}"). Rows keep the name as invoked;
//     bin/skill-load-report.js normalizes it for the closure join.
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
// "({kind}, unattributed)", so nothing is dropped.

const fs = require('fs');
const readline = require('readline');
const { isProcedurePath } = require('../timing/transcript');

const BASE_DIR_PREFIX = 'Base directory for this skill:';
const COMMAND_NAME = /<command-name>\/?([^<\s]+)<\/command-name>/;
const KINDS = new Set(['main', 'subagent']);

const unattributedSkill = (kind) => `(${kind}, unattributed)`;

// Same rule as timing/transcript.js's resultBytes, which that module does
// not export (and this unit does not modify): a string result, or the text
// blocks of an array result.
function resultBytes(content) {
  if (typeof content === 'string') return Buffer.byteLength(content, 'utf8');
  if (Array.isArray(content)) {
    return content.reduce((s, b) => s + (b && typeof b.text === 'string' ? Buffer.byteLength(b.text, 'utf8') : 0), 0);
  }
  return 0;
}

function blocksOf(msg) {
  if (Array.isArray(msg.content)) return msg.content;
  if (typeof msg.content === 'string') return [{ type: 'text', text: msg.content }];
  return [];
}

function statOrReject(fsImpl, filePath) {
  let st;
  try {
    st = fsImpl.statSync(filePath);
  } catch (err) {
    const code = (err && err.code) || 'EUNKNOWN';
    const e = new Error(`transcript not readable (${code}): ${filePath}`);
    e.code = code;
    throw e;
  }
  if (!st.isFile()) {
    const e = new Error(`transcript not readable (EISDIR): ${filePath}`);
    e.code = 'EISDIR';
    throw e;
  }
}

// path, { fsImpl?, worktree?, kind } -> Promise<[{ skill, injectedBytes,
// readBytes, readPaths }]>, rows in invocation order (the unattributed row,
// when any, sits where its first bytes appeared). Rejects with the stat
// failure's code when the file cannot be opened, EISDIR for a directory, or
// the stream's error mid-read; malformed lines are skipped.
async function readSkillLoads(filePath, { fsImpl = fs, worktree = null, kind } = {}) {
  if (!KINDS.has(kind)) throw new Error(`readSkillLoads: kind must be "main" or "subagent", got ${JSON.stringify(kind)}`);
  statOrReject(fsImpl, filePath);
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
```

- [ ] **Step 4: Run the tests to verify they pass, and that the timing suite is untouched**

Run: `node --test tests/bin-lib/skill-audit/transcript-load.test.js tests/bin-lib/timing/transcript.test.js`
Expected: PASS, 0 failures, 12 of them from `transcript-load.test.js`. Run `git diff --stat -- plugin/bin/lib/timing/`: expected output is empty.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/skill-audit/transcript-load.js tests/bin-lib/skill-audit/transcript-load.test.js
git commit -m "$(cat <<'EOF'
Add transcript-load.js — per-invocation skill load read from session transcripts (refs #3309)

One row per invocation (Skill tool_use or typed slash command): injected body bytes plus skill-file Read bytes, attributed by a single cursor; unattributed bytes land in a (kind, unattributed) row. Header records the observed transcript shapes (Task 0).

Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717
EOF
)"
```

---

### Task 2: skill-load-report.js CLI and its docs row

**Files:**
- Create: `plugin/bin/skill-load-report.js`
- Test: `tests/skill-load-report-cli.test.js`
- Modify: `docs/plugin-structure.md` (one new line, directly after the `harness-cost-report.js` line)

**Interfaces:**
- Consumes:
  - `readSkillLoads`, `summarizeLoads` (Task 1)
  - `slugForCwd` (`plugin/bin/lib/timing/transcript.js`)
  - `discoverPluginRoots(listFiles)`, `entryPointLoads(pluginRoot, { readFile, listSkillMds })` (`plugin/bin/lib/skill-audit/load.js`); `entry` is `'{rootName}:{skill}'`
  - `isPathContained` (`plugin/bin/lib/shared-primitives.js`)
- Produces:
  - `run(argv, deps) -> Promise<number>` with `deps = { stdout, stderr, cwd, configDir: () => string, listFiles: (cwd) => string[] }`
  - `parseArgs(argv)`
  - stdout is one JSON line `{ status, transcriptDir, sessions, unreadable, rows: [{ skill, invocations, median, max, closure, overClosure }] }`, which Task 3's paragraph reads

- [ ] **Step 1: Write the failing test.** Create `tests/skill-load-report-cli.test.js` with exactly:

```js
// tests/skill-load-report-cli.test.js — bin/skill-load-report.js (#3309),
// the CLI harness-health's Skill-load check shells out to. Exercised via the
// injectable run(argv, deps) seam (harness-cost-report-cli.test.js's shape):
// a temp config dir stands in for $CLAUDE_CONFIG_DIR and a temp plugin root
// for the load model. Transcript lines mirror the observed shapes (a)-(e) in
// plugin/bin/lib/skill-audit/transcript-load.js's header; the subagent
// layout is shape (d).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { run } = require('../plugin/bin/skill-load-report');
const { slugForCwd } = require('../plugin/bin/lib/timing/transcript');
const { measuredTextBytes } = require('../plugin/bin/lib/skill-audit/context-cost');

const TS = '2026-10-17T12:00:00.000Z';

// Shape (a).
const skillUse = (skill, id) => ({ type: 'assistant', timestamp: TS, message: { id: `msg_${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Skill', input: { skill } }] } });
// Shape (b): exactly `bytes` UTF-8 bytes.
function injectedBody(bytes, sourceToolUseID) {
  const head = 'Base directory for this skill: /p/skills/x\n\n';
  return { type: 'user', isMeta: true, sourceToolUseID, timestamp: TS, message: { role: 'user', content: [{ type: 'text', text: head + 'x'.repeat(bytes - head.length) }] } };
}
// Shape (e).
const readUse = (file, id) => ({ type: 'assistant', timestamp: TS, message: { id: `msg_${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: file } }] } });
const readResult = (id, bytes) => ({ type: 'user', timestamp: TS, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'y'.repeat(bytes) }] } });
const invocation = (skill, id, bytes) => [skillUse(skill, id), injectedBody(bytes, id)];

const SKILL_PATH = '/home/u/.claude/plugins/cache/m/demo/1.0.0/skills/alpha/more.md';

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

function writeJsonl(file, lines, mtimeSec) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  if (mtimeSec) fs.utimesSync(file, mtimeSec, mtimeSec);
}

// A plugin root named `demo` with one skill, alpha, citing nothing.
function pluginRoot() {
  const root = tmp('slr-plugin-');
  fs.mkdirSync(path.join(root, '.claude-plugin'));
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'demo' }));
  fs.mkdirSync(path.join(root, 'skills', 'alpha'), { recursive: true });
  const body = `# Alpha\n\n${'a'.repeat(1000)}\n`;
  fs.writeFileSync(path.join(root, 'skills', 'alpha', 'SKILL.md'), body);
  return { root, closure: measuredTextBytes(body, 'skills/alpha/SKILL.md').bytes };
}

function setup() {
  const configDir = tmp('slr-config-');
  const cwd = tmp('slr-cwd-');
  const transcriptDir = path.join(configDir, 'projects', slugForCwd(cwd));
  const out = { stdout: '', stderr: '' };
  const deps = {
    stdout: (s) => { out.stdout += s; },
    stderr: (s) => { out.stderr += s; },
    cwd,
    configDir: () => configDir,
    listFiles: () => [],
  };
  const json = () => JSON.parse(out.stdout);
  return { configDir, cwd, transcriptDir, out, deps, json };
}

test('--help prints usage and exits 0', async () => {
  const { out, deps } = setup();
  assert.strictEqual(await run(['--help'], deps), 0);
  assert.match(out.stdout, /^usage: skill-load-report\.js/);
});

test('malformed invocations exit 2 with no stdout', async () => {
  for (const argv of [['--bogus'], ['--sessions', '0'], ['--sessions', 'abc'], ['--cwd'], ['--plugin-root', '--cwd']]) {
    const { out, deps } = setup();
    assert.strictEqual(await run(argv, deps), 2, argv.join(' '));
    assert.strictEqual(out.stdout, '');
  }
});

test('a --plugin-root with no skills/ exits 2', async () => {
  const { out, deps } = setup();
  assert.strictEqual(await run(['--plugin-root', tmp('slr-empty-')], deps), 2);
  assert.match(out.stderr, /has no skills\/ directory/);
});

test('no transcript directory for the cwd: no-data naming the directory looked in, exit 0', async () => {
  const { transcriptDir, deps, json } = setup();
  assert.strictEqual(await run([], deps), 0);
  assert.deepStrictEqual(json(), { status: 'no-data', transcriptDir, sessions: 0, unreadable: 0, rows: [] });
});

test('a transcript directory holding no main transcript is no-data too', async () => {
  const { transcriptDir, deps, json } = setup();
  fs.mkdirSync(path.join(transcriptDir, 'some-session', 'subagents'), { recursive: true });
  assert.strictEqual(await run([], deps), 0);
  assert.strictEqual(json().status, 'no-data');
});

test('an unreadable main transcript is counted, and with none read the result is no-data', { skip: process.getuid && process.getuid() === 0 }, async () => {
  const { transcriptDir, deps, json } = setup();
  const file = path.join(transcriptDir, 's1.jsonl');
  writeJsonl(file, invocation('demo:alpha', 't1', 500));
  fs.chmodSync(file, 0o000);
  try {
    assert.strictEqual(await run([], deps), 0);
    assert.deepStrictEqual(json(), { status: 'no-data', transcriptDir, sessions: 0, unreadable: 1, rows: [] });
  } finally {
    fs.chmodSync(file, 0o600);
  }
});

test('closure joins on namespace + skill: over its closure is flagged, another plugin\'s same-named skill gets closure null', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root, closure } = pluginRoot();
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('demo:alpha', 't1', closure + 500),
    ...invocation('other:alpha', 't2', 300),
  ]);
  assert.strictEqual(await run(['--plugin-root', root], deps), 0);
  const r = json();
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.sessions, 1);
  assert.deepStrictEqual(r.rows, [
    { skill: 'demo:alpha', invocations: 1, median: closure + 500, max: closure + 500, closure, overClosure: true },
    { skill: 'other:alpha', invocations: 1, median: 300, max: 300, closure: null, overClosure: false },
  ]);
});

test('a project-local root (no plugin.json) joins bare and path-namespaced skill names', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root, closure } = pluginRoot();
  fs.rmSync(path.join(root, '.claude-plugin'), { recursive: true });
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('alpha', 't1', 200),
    ...invocation('.claude/worktrees/wt:alpha', 't2', 100),
    ...invocation('demo:alpha', 't3', 50),
  ]);
  await run(['--plugin-root', root], deps);
  assert.deepStrictEqual(json().rows.map((r) => [r.skill, r.closure]), [
    ['alpha', closure],
    ['.claude/worktrees/wt:alpha', closure],
    ['demo:alpha', null],
  ]);
});

test('overClosure is false when max equals the closure exactly', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root, closure } = pluginRoot();
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), invocation('demo:alpha', 't1', closure));
  await run(['--plugin-root', root], deps);
  assert.deepStrictEqual(json().rows.map((r) => [r.max, r.closure, r.overClosure]), [[closure, closure, false]]);
});

test('rows that tie on max sort by skill ascending', async () => {
  const { transcriptDir, deps, json } = setup();
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('z:last', 't1', 400),
    ...invocation('a:first', 't2', 400),
    ...invocation('m:big', 't3', 900),
  ]);
  await run([], deps);
  assert.deepStrictEqual(json().rows.map((r) => r.skill), ['m:big', 'a:first', 'z:last']);
});

test('--sessions keeps the newest main transcripts by mtime, and each one\'s subagents/*.jsonl (shape d) are read', async () => {
  const { transcriptDir, deps, json } = setup();
  writeJsonl(path.join(transcriptDir, 'old.jsonl'), invocation('demo:old', 't1', 100), 1_000_000);
  writeJsonl(path.join(transcriptDir, 'new.jsonl'), invocation('demo:new', 't2', 200), 2_000_000);
  writeJsonl(path.join(transcriptDir, 'new', 'subagents', 'agent-a1.jsonl'), [readUse(SKILL_PATH, 'r1'), readResult('r1', 50)]);
  fs.writeFileSync(path.join(transcriptDir, 'new', 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'fork' }));
  writeJsonl(path.join(transcriptDir, 'old', 'subagents', 'agent-a2.jsonl'), [readUse(SKILL_PATH, 'r2'), readResult('r2', 70)]);
  assert.strictEqual(await run(['--sessions', '1'], deps), 0);
  const r = json();
  assert.strictEqual(r.sessions, 1);
  assert.deepStrictEqual(r.rows.map((x) => [x.skill, x.max]), [['demo:new', 200], ['(subagent, unattributed)', 50]]);
});

test('default plugin roots come from discoverPluginRoots over the cwd\'s tracked files', async () => {
  const { cwd, transcriptDir, deps, json } = setup();
  const { root, closure } = pluginRoot();
  fs.cpSync(root, path.join(cwd, 'plugin'), { recursive: true });
  deps.listFiles = () => ['plugin/skills/alpha/SKILL.md', 'README.md'];
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), invocation('demo:alpha', 't1', 100));
  await run([], deps);
  assert.deepStrictEqual(json().rows.map((r) => [r.skill, r.closure]), [['demo:alpha', closure]]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/skill-load-report-cli.test.js`
Expected: FAIL with `Cannot find module '../plugin/bin/skill-load-report'`

- [ ] **Step 3: Write the implementation.** Create `plugin/bin/skill-load-report.js` with exactly:

```js
#!/usr/bin/env node
// bin/skill-load-report.js — transcript-measured per-invocation skill load
// (#3309). Thin CLI over bin/lib/skill-audit/transcript-load.js: reads this
// machine's Claude Code transcripts for one working directory (the newest
// --sessions main transcripts plus every subagent transcript under each),
// summarizes load per skill, and joins each skill to its static closure from
// bin/lib/skill-audit/load.js (#3307). harness-health's Skill-load check
// runs it every firing; it never gates.
//
// Usage: skill-load-report.js [--cwd <dir>] [--sessions <n>]
//                             [--plugin-root <dir>]... [--help]
//   --cwd          the directory whose transcripts are read (default: the
//                  process cwd). Transcripts live under
//                  {config-dir}/projects/{slug}/ — {config-dir} is
//                  $CLAUDE_CONFIG_DIR or ~/.claude, {slug} the cwd with every
//                  character outside [A-Za-z0-9-] replaced by "-"
//                  (timing/transcript.js's slugForCwd). A worktree session's
//                  transcripts sit under the worktree's slug, not the main
//                  checkout's.
//   --sessions     how many of the newest main transcripts to read (default 20)
//   --plugin-root  repeatable; a directory holding skills/ (default: every
//                  tracked skills/*/SKILL.md root at the cwd or one directory
//                  down — load.js's discoverPluginRoots)
//
// Output: one JSON line — { status: "ok" | "no-data", transcriptDir,
// sessions, unreadable, rows: [{ skill, invocations, median, max, closure,
// overClosure }] }, rows sorted by max descending, then skill ascending.
// `closure` is the static closure of the same skill under a root whose
// .claude-plugin/plugin.json `name` equals the invoked skill's namespace (a
// bare or path-namespaced skill name matches a root with no plugin.json —
// the project-local .claude/skills form); any other skill gets
// closure null and overClosure false. "no-data" means no main transcript was
// read — never zero load reported as measured.
// Exit: 0 success (including no-data); 2 malformed invocation or a
// --plugin-root with no skills/; 1 an unexpected error.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { slugForCwd } = require('./lib/timing/transcript');
const { readSkillLoads, summarizeLoads } = require('./lib/skill-audit/transcript-load');
const { discoverPluginRoots, entryPointLoads } = require('./lib/skill-audit/load');
const { isPathContained } = require('./lib/shared-primitives');

const USAGE = 'usage: skill-load-report.js [--cwd <dir>] [--sessions <n>] [--plugin-root <dir>]... [--help]\n';
const DEFAULT_SESSIONS = 20;

function parseArgs(argv) {
  const o = { cwd: null, sessions: DEFAULT_SESSIONS, pluginRoots: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--cwd' || a === '--sessions' || a === '--plugin-root') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      if (a === '--cwd') o.cwd = v;
      else if (a === '--plugin-root') o.pluginRoots.push(v);
      else {
        if (!/^[1-9]\d*$/.test(v)) return { error: `--sessions must be a positive integer, got: ${v}` };
        o.sessions = Number(v);
      }
    } else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
  configDir: () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  listFiles: (cwd) => {
    try {
      return execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
        .split('\0').filter(Boolean);
    } catch {
      return [];
    }
  },
};

// Regular .jsonl files directly in `dir`, newest first; null when `dir` is
// absent. Dirent.isFile() is false for a symlink, so none is followed.
function jsonlFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (['ENOENT', 'ENOTDIR'].includes(err.code)) return null;
    throw err;
  }
  return entries
    .filter((d) => d.isFile() && d.name.endsWith('.jsonl'))
    .map((d) => {
      const p = path.join(dir, d.name);
      return { path: p, sessionId: d.name.slice(0, -'.jsonl'.length), mtimeMs: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? -1 : 1));
}

function pluginName(rootAbs) {
  try {
    const { name } = JSON.parse(fs.readFileSync(path.join(rootAbs, '.claude-plugin', 'plugin.json'), 'utf8'));
    return typeof name === 'string' && name ? name : '';
  } catch {
    return '';
  }
}

// Map `${namespace}\0${skill}` -> closure bytes for every entry point under
// every root. A citation is read only when it resolves (symlinks included)
// to a regular file inside its root — load-delta.js's headSide rule.
function closureIndex(rootsAbs) {
  const index = new Map();
  for (const rootAbs of rootsAbs) {
    const realRoot = fs.realpathSync(rootAbs);
    const readFile = (p) => {
      try {
        const real = fs.realpathSync(path.join(rootAbs, p));
        if (!isPathContained(real, realRoot) || !fs.statSync(real).isFile()) return null;
        return fs.readFileSync(real, 'utf8');
      } catch (err) {
        if (['ENOENT', 'EISDIR', 'ENOTDIR', 'ELOOP'].includes(err.code)) return null;
        throw err;
      }
    };
    const listSkillMds = () => fs.readdirSync(path.join(rootAbs, 'skills'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `skills/${d.name}/SKILL.md`)
      .filter((p) => readFile(p) !== null);
    const ns = pluginName(rootAbs);
    for (const e of entryPointLoads('.', { readFile, listSkillMds })) {
      index.set(`${ns}\0${e.entry.slice(e.entry.lastIndexOf(':') + 1)}`, e.closure);
    }
  }
  return index;
}

// A project-local skill is invoked bare ("gh-api-module-pattern") or, from
// a worktree session, under its skills directory's path
// (".claude/worktrees/x:gh-api-module-pattern" — observed on 2.1.302); a
// namespace carrying "/" is that path form, so it joins like a bare name.
function closureOf(index, skill) {
  const i = skill.indexOf(':');
  const ns = i < 0 || skill.slice(0, i).includes('/') ? '' : skill.slice(0, i);
  const key = `${ns}\0${skill.slice(i + 1)}`;
  return index.has(key) ? index.get(key) : null;
}

async function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`skill-load-report.js: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  const cwd = path.resolve(deps.cwd, o.cwd || '.');
  const rootsAbs = (o.pluginRoots.length ? o.pluginRoots : discoverPluginRoots(() => deps.listFiles(cwd)))
    .map((r) => path.resolve(cwd, r));
  for (const r of rootsAbs) {
    let isDir = false;
    try { isDir = fs.statSync(path.join(r, 'skills')).isDirectory(); } catch { isDir = false; }
    if (!isDir) { deps.stderr(`skill-load-report.js: --plugin-root has no skills/ directory: ${r}\n`); return 2; }
  }
  const transcriptDir = path.join(deps.configDir(), 'projects', slugForCwd(cwd));
  const mains = (jsonlFiles(transcriptDir) || []).slice(0, o.sessions);
  const rows = [];
  let sessions = 0;
  let unreadable = 0;
  const read = async (file, kind) => {
    try {
      rows.push(...await readSkillLoads(file, { worktree: cwd, kind }));
      return true;
    } catch {
      unreadable++;
      return false;
    }
  };
  for (const m of mains) {
    if (await read(m.path, 'main')) sessions++;
    for (const s of jsonlFiles(path.join(transcriptDir, m.sessionId, 'subagents')) || []) await read(s.path, 'subagent');
  }
  if (sessions === 0) {
    deps.stdout(`${JSON.stringify({ status: 'no-data', transcriptDir, sessions: 0, unreadable, rows: [] })}\n`);
    return 0;
  }
  const index = closureIndex(rootsAbs);
  const out = summarizeLoads(rows)
    .map((r) => {
      const closure = closureOf(index, r.skill);
      return { ...r, closure, overClosure: closure !== null && r.max > closure };
    })
    .sort((a, b) => b.max - a.max || (a.skill < b.skill ? -1 : a.skill > b.skill ? 1 : 0));
  deps.stdout(`${JSON.stringify({ status: 'ok', transcriptDir, sessions, unreadable, rows: out })}\n`);
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((err) => {
    process.stderr.write(`skill-load-report.js: ${err && err.message}\n`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run the tests and the bin conformance suites**

Run: `node --test tests/skill-load-report-cli.test.js tests/bin-lib/exit-code-conformance.test.js tests/payload-boundary.test.js`
Expected: PASS, 0 failures, 12 of them from `skill-load-report-cli.test.js`.

- [ ] **Step 5: Real-input probe of the built CLI.** Run it from this worktree against the main checkout's transcripts. Paste the first output line into the task report.

Run: `node plugin/bin/skill-load-report.js --cwd "/Users/thomasholknielsen/Code Workspaces/claude-tweaks" --plugin-root plugin | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.status,r.sessions,r.unreadable,r.rows.length,r.rows.filter(x=>!x.skill.startsWith("(")).reduce((a,x)=>a+x.invocations,0))})'`
Expected: `ok 20 0 <rows> <invocations>`. When written, the plan recorded `ok 20 0 33 442`. The numbers move as sibling sessions write new transcripts. `status ok` with `sessions 20` is the pass condition.

- [ ] **Step 6: Add the docs row.** In `docs/plugin-structure.md`, insert this line immediately after the line beginning `node plugin/bin/harness-cost-report.js --plugin-root <dir> [--ratio-threshold <n>] [--help]`:

```text
node plugin/bin/skill-load-report.js [--cwd <dir>] [--sessions <n>] [--plugin-root <dir>]... [--help]   # Skill-load-report CLI (#3309) — reads this machine's Claude Code transcripts for one directory (`{config-dir}/projects/{slug}/`, config-dir `$CLAUDE_CONFIG_DIR` or `~/.claude`): the newest `--sessions` (default 20) main transcripts plus each one's `{sessionId}/subagents/*.jsonl`; sums per-invocation skill load (injected body + skill-file Reads, `skill-audit/transcript-load.js`), summarizes it per skill, and joins each skill to its static closure from `skill-audit/load.js`; prints one JSON line `{status: ok|no-data, transcriptDir, sessions, unreadable, rows}`; never a gate — invoked directly by harness-health/SKILL.md's Skill-load check, which files and auto-closes from it; exit 0 success (including `no-data`), 2 malformed invocation or a `--plugin-root` with no `skills/`, 1 unexpected error (tests in `tests/skill-load-report-cli.test.js` and `tests/bin-lib/skill-audit/transcript-load.test.js`)
```

Verify: `grep -c "skill-load-report.js" docs/plugin-structure.md` prints `1`.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/skill-load-report.js tests/skill-load-report-cli.test.js docs/plugin-structure.md
git commit -m "$(cat <<'EOF'
Add skill-load-report.js — transcript-measured skill load joined to the static closure (refs #3309)

Reads the newest --sessions main transcripts for a cwd ($CLAUDE_CONFIG_DIR/projects/{slug}) plus each one's subagents/*.jsonl, summarizes per skill, and joins each to load.js's closure on namespace + skill name. no-data when no transcript was read, never zero load.

Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717
EOF
)"
```

---

### Task 3: harness-health Skill-load check paragraph

**Files:**
- Modify: `plugin/skills/harness-health/SKILL.md` (insert one paragraph after the Harness cost-efficiency check's closing paragraph, the one ending `` a human or `/review` decides whether a specific flagged skill's roster is deliberate or worth narrowing. ``)
- Test: `tests/skill-load-report-cli.test.js` (created in Task 2; append one test)

**Interfaces:**
- Consumes: Task 2's CLI command and its JSON fields (`status`, `transcriptDir`, `sessions`, `rows[].{skill, invocations, median, max, closure, overClosure}`).
- Produces: the prose check harness-health executes every firing (AC10).

- [ ] **Step 1: Write the failing test.** Append this test to the end of `tests/skill-load-report-cli.test.js`, after one blank line:

```js
test('harness-health names the Skill-load check: command, top 10, filing title, dedup, auto-close, --dry-run', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', 'harness-health', 'SKILL.md'), 'utf8');
  const start = text.indexOf('**Skill-load check (#3309');
  assert.ok(start >= 0, 'harness-health/SKILL.md has no Skill-load check paragraph');
  // The paragraph is its lead-in, one ```bash block, and the text after the
  // fence up to the next blank line.
  const fenceEnd = text.indexOf('\n```\n', text.indexOf('```bash', start)) + 5;
  const para = text.slice(start, text.indexOf('\n\n', fenceEnd));
  for (const needle of [
    'node "${CLAUDE_PLUGIN_ROOT}/bin/skill-load-report.js" --plugin-root "${CLAUDE_PLUGIN_ROOT}"',
    'top 10',
    '"Skill load exceeds its static closure: {skill}"',
    'open `by:harness-health` issue already carries that exact title',
    '`status: "ok"`',
    '`max ≤ closure`',
    'Back within its static closure: max {max} B ≤ closure {closure} B over {sessions} sessions',
    'never closes anything',
    '`--dry-run`',
  ]) assert.ok(para.includes(needle), `Skill-load check paragraph is missing: ${needle}`);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/skill-load-report-cli.test.js`
Expected: FAIL, 1 failure: `harness-health/SKILL.md has no Skill-load check paragraph`.

- [ ] **Step 3: Insert the paragraph.** In `plugin/skills/harness-health/SKILL.md`, find the paragraph that ends `` a human or `/review` decides whether a specific flagged skill's roster is deliberate or worth narrowing. ``. After it and its following blank line, insert exactly the block below, followed by one blank line. The next existing paragraph (`` Read the `why` field on whichever target(s) came back: ``) must stay separated from it by one blank line.

```markdown
**Skill-load check (#3309, runs every firing).** `load-delta.js`'s closure (#3307) is a static bound read off citations; this check measures what this machine's real sessions loaded per skill invocation — the injected skill body plus every skill-file Read until the next invocation, main sessions and their subagents — so a skill whose sessions read prose its citations never reach shows up as over its closure. Call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/skill-load-report.js" --plugin-root "${CLAUDE_PLUGIN_ROOT}"
```

It reads the 20 newest main transcripts for the current directory (`--sessions <n>` overrides). Include `transcriptDir` and the top 10 `rows` (skill, invocations, median, max, closure) in Step 8's SUMMARIZE report; a `status: "no-data"` result (no transcripts here — a cloud sandbox, a fresh clone) is reported as no data, never as zero load. For each row with `overClosure: true`, file one work-record issue (origin `by:harness-health`, `risk:low` + `size:low`) titled `"Skill load exceeds its static closure: {skill}"`, its body carrying the row's skill name and byte counts plus `sessions` — never transcript text, which is untrusted input. Skip filing when an open `by:harness-health` issue already carries that exact title (reuse Step 5's fetch when reached this firing; the Policy schema check's standalone fetch otherwise). On a `status: "ok"` firing, each open `by:harness-health` issue with that title whose `{skill}` is in `rows` with `max ≤ closure` gets the comment `Back within its static closure: max {max} B ≤ closure {closure} B over {sessions} sessions` and is closed; a `no-data` firing, a skill absent from `rows`, or a `null` closure never closes anything. Skip filing and closing under `--dry-run`, printing what would be filed or closed instead.
```

- [ ] **Step 4: Run the tests and the size gates**

Run: `node --test tests/skill-load-report-cli.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, 0 failures, 13 of them from `skill-load-report-cli.test.js`. Run `wc -c plugin/skills/harness-health/SKILL.md`: expected `47804`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/harness-health/SKILL.md tests/skill-load-report-cli.test.js
git commit -m "$(cat <<'EOF'
Add harness-health Skill-load check — report, file, and auto-close on transcript-measured load (refs #3309)

Runs skill-load-report.js every firing: top-10 report, one by:harness-health record per skill over its static closure (deduped on title), auto-close when an observed skill is back within it; no-data never closes; --dry-run skips both.

Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717
EOF
)"
```

---

## Self-review

- **Spec coverage:**
  - Task 0 → the rulings above and Task 1's header.
  - `transcript-load.js` and its attribution rules → Task 1.
  - Session enumeration → Task 2 (`--sessions` test).
  - CLI → Task 2.
  - harness-health paragraph → Task 3.
  - Both test files → Tasks 1–2.
  - `docs/plugin-structure.md` row → Task 2.
  - AC1–AC5 → Task 1 tests.
  - AC6–AC8 → Task 2 tests.
  - AC9 → Task 1 Step 4.
  - AC10 → Task 3.
  - AC11 → the build's `npm test` verification.
- **Placeholder scan:** no TBD, TODO, "similar to", or undefined names. Every code step carries its full code.
- **Type consistency:**
  - The row shape `{ skill, injectedBytes, readBytes, readPaths }` is the same in Tasks 1 and 2.
  - The summary row `{ skill, invocations, median, max }` is joined to `{ closure, overClosure }` in Task 2 and read by name in Task 3.
