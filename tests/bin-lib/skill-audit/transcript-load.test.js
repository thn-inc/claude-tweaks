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
