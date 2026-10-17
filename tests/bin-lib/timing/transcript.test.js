'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { slugForCwd, locateTranscripts, readUsage, isProcedurePath, subagentsDirFor, readDispatches, TRANSCRIPT_SLUG_RULE } = require('../../../plugin/bin/lib/timing/transcript');

const FIX = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'transcript-small.jsonl');

// #1929 AC1 — the rule is pinned against a real observed pair, not a guess:
// this session's own transcript directory for the worktree cwd below.
const REAL_CWD = '/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/design-1904-pipeline-ceremony';
const REAL_SLUG = '-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-design-1904-pipeline-ceremony';

test('#1929 AC1: slugForCwd reproduces the observed project-directory name (space and dot become hyphens too)', () => {
  assert.equal(slugForCwd(REAL_CWD), REAL_SLUG);
  assert.equal(slugForCwd('/Users/x/Code/repo/.claude/worktrees/wt'), '-Users-x-Code-repo--claude-worktrees-wt');
  assert.match(TRANSCRIPT_SLUG_RULE, /\[A-Za-z0-9-\]/);
});

function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-transcript-home-'));
  const projects = path.join(home, '.claude', 'projects');
  const slugDir = path.join(projects, slugForCwd('/Users/x/Code/repo/.claude/worktrees/wt'));
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'sess-1.jsonl'), '{}\n');
  fs.writeFileSync(path.join(slugDir, 'sess-2.jsonl'), '{}\n');
  fs.mkdirSync(path.join(slugDir, 'sess-1'), { recursive: true }); // subagent dir — never a candidate
  const other = path.join(projects, '-Users-x-elsewhere');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'sess-3.jsonl'), '{}\n');
  // planted directly under projects/, outside every slug dir — the escape target
  // a "../" sessionId would reach from inside slugDir if containment were absent.
  fs.writeFileSync(path.join(projects, 'escaped.jsonl'), '{}\n');
  return { home, slugDir, other };
}

test('#1929 AC1: locateTranscripts looks under the worktree slug and keys on the session id', () => {
  const { home, slugDir } = fakeHome();
  const both = locateTranscripts({ cwd: '/Users/x/Code/repo/.claude/worktrees/wt', sessionId: 'sess-2', homeDir: home });
  // path is the REAL path (realpathSync'd for the containment check,
  // [IL-150]) — on macOS the tmpdir itself resolves through a symlink
  // (/var -> /private/var), so compare against the realpath'd expectation.
  assert.deepEqual(both.map((c) => c.path), [fs.realpathSync(path.join(slugDir, 'sess-2.jsonl'))]);
  const cwdOnly = locateTranscripts({ cwd: '/Users/x/Code/repo/.claude/worktrees/wt', homeDir: home });
  assert.deepEqual(cwdOnly.map((c) => path.basename(c.path)).sort(), ['sess-1.jsonl', 'sess-2.jsonl']);
  const sessionOnly = locateTranscripts({ sessionId: 'sess-3', homeDir: home });
  assert.equal(sessionOnly.length, 1);
  assert.ok(sessionOnly[0].path.endsWith(path.join('-Users-x-elsewhere', 'sess-3.jsonl')));
  assert.deepEqual(locateTranscripts({ homeDir: home }), []);
  assert.deepEqual(locateTranscripts({ cwd: '/nope', sessionId: 'x', homeDir: home }), []);
});

test('#1929: locateTranscripts refuses a session id that could traverse out of ~/.claude/projects', () => {
  const { home } = fakeHome();
  assert.deepEqual(locateTranscripts({ sessionId: '../../etc/passwd', homeDir: home }), []);
  assert.deepEqual(locateTranscripts({ cwd: '/Users/x/Code/repo/.claude/worktrees/wt', sessionId: '../sess-1', homeDir: home }), []);
  // discriminating case: a real file sits at the traversed location
  // (projects/escaped.jsonl) — on the pre-fix code this sessionId would
  // resolve there and be returned; containment must still yield [].
  assert.deepEqual(locateTranscripts({ cwd: '/Users/x/Code/repo/.claude/worktrees/wt', sessionId: '../escaped', homeDir: home }), []);
});

test('#1929 [IL-150]: locateTranscripts refuses a symlinked leaf file that escapes ~/.claude/projects', () => {
  const { home, slugDir } = fakeHome();
  const outsideFile = path.join(home, 'outside.jsonl');
  fs.writeFileSync(outsideFile, '{}\n');
  fs.symlinkSync(outsideFile, path.join(slugDir, 'sess-link.jsonl'));
  assert.deepEqual(locateTranscripts({ cwd: '/Users/x/Code/repo/.claude/worktrees/wt', sessionId: 'sess-link', homeDir: home }), []);
});

test('#1929 [IL-150]: locateTranscripts refuses a symlinked slug directory that escapes ~/.claude/projects', () => {
  const { home, slugDir } = fakeHome();
  const outsideDir = path.join(home, 'outside-dir');
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, 'sess-7.jsonl'), '{}\n');
  const projects = path.dirname(slugDir);
  fs.symlinkSync(outsideDir, path.join(projects, '-Users-x-linked'));
  assert.deepEqual(locateTranscripts({ sessionId: 'sess-7', homeDir: home }), []);
});

test('#1929: isProcedurePath matches repo skills, installed-plugin skills, and nothing else', () => {
  assert.equal(isProcedurePath('/repo/plugin/skills/review/SKILL.md', '/repo'), true);
  assert.equal(isProcedurePath('plugin/skills/_shared/x.md', '/repo'), true);
  assert.equal(isProcedurePath('/Users/x/.claude/plugins/cache/m/claude-tweaks/6.0.0/skills/flow/multi-spec.md', '/repo'), true);
  assert.equal(isProcedurePath('/repo/docs/hooks.md', '/repo'), false);
  assert.equal(isProcedurePath('/repo/plugin/bin/hooks.js', '/repo'), false);
  assert.equal(isProcedurePath('/elsewhere/skills/notes.txt', '/repo'), false);
});

test('#1929 AC2: readUsage streams rows, sums procedure bytes for skills Reads only, flags tool round-trips', async () => {
  const rows = await readUsage(FIX, { worktree: '/repo' });
  assert.equal(rows.length, 8);
  const users = rows.filter((r) => r.role === 'user');
  assert.deepEqual(users.map((r) => r.toolRoundTrip), [true, true, true]);
  assert.deepEqual(users.map((r) => r.procedureBytes), [10, 8, 0]);
  assert.equal(rows.reduce((s, r) => s + r.procedureBytes, 0), 18);
  const assistants = rows.filter((r) => r.role === 'assistant');
  assert.deepEqual(assistants.map((r) => r.toolRoundTrip), [false, false, false, false, false]);
  assert.deepEqual(assistants[0], { ts: '2026-09-05T13:50:00.000Z', role: 'assistant', inputTokens: 10, outputTokens: 20, cacheRead: 300, cacheCreate: 40, toolRoundTrip: false, procedureBytes: 0, model: null });
  assert.equal(assistants[3].inputTokens, 100);
  assert.equal(users[0].inputTokens, 0);
  // #1929 whole-branch review fix 1: a duplicate message.id (same turn,
  // repeated across content-block lines) gets its token fields zeroed —
  // the last row is that duplicate, and the assistant token sums stay at
  // the pre-duplicate totals.
  assert.equal(rows[rows.length - 1].inputTokens, 0);
  assert.equal(rows[rows.length - 1].outputTokens, 0);
  assert.equal(assistants.reduce((s, r) => s + r.inputTokens, 0), 116);
  assert.equal(assistants.reduce((s, r) => s + r.outputTokens, 0), 228);
});

test('#1929: readUsage on a missing file rejects with a code the CLI can name', async () => {
  await assert.rejects(readUsage(path.join(os.tmpdir(), 'ct-no-such-transcript.jsonl'), {}), (err) => err.code === 'ENOENT');
});

test('#1929: readUsage on a directory path rejects with EISDIR', async () => {
  await assert.rejects(readUsage(__dirname, {}), (err) => err.code === 'EISDIR');
});

// ---- #3375: per-subagent-dispatch enumeration --------------------------

// sess-1.jsonl (the main transcript) is read by no test; it anchors the {sessionId}/ sibling path layout that subagentsDirFor derives.
const SESS = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'subagents-session');
const SUBDIR = subagentsDirFor(path.join(SESS, 'sess-1.jsonl'));

function tmpSubagents() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-subagents-'));
}
function aLine(role, ts, id, model, usage) {
  const message = role === 'assistant'
    ? { id, role, model, content: [], usage: { input_tokens: usage[0], output_tokens: usage[1], cache_read_input_tokens: usage[2], cache_creation_input_tokens: usage[3] } }
    : { role, content: [] };
  return JSON.stringify({ type: role, timestamp: ts, message });
}

test('AC1.1: readDispatches returns one record per agent with model, description and wall-clock span', async () => {
  const r = await readDispatches(SUBDIR);
  assert.equal(r.notFound, null);
  assert.equal(r.excludedOutsideWindow, 0);
  assert.equal(r.items.length, 3);
  const [a1, a2, a3] = r.items;
  assert.equal(a1.agentId, 'a1');
  assert.equal(a1.metaModel, 'sonnet');
  assert.equal(a1.description, 'Implement Task 1: parser');
  assert.equal(a1.agentType, 'general-purpose');
  assert.equal(a1.spawnDepth, 1);
  assert.equal(a1.parentAgentId, null);
  assert.equal(a1.wallClockMs, 65000);
  assert.equal(a1.startTs, '2026-10-17T10:00:00.000Z');
  assert.equal(a1.endTs, '2026-10-17T10:01:05.000Z');
  assert.equal(a1.transcriptModel, 'claude-sonnet-5-5');
  assert.equal(a1.notFound, null);
  assert.equal(a2.wallClockMs, 30000);
  assert.equal(a2.description, 'Review Task 1 (spec + quality)');
  assert.equal(a3.wallClockMs, 120000);
  assert.equal(a3.transcriptModel, 'claude-opus-5-5');
});

test('AC1.1: token totals count each message.id once', async () => {
  const r = await readDispatches(SUBDIR);
  assert.deepEqual(r.items[0].tokens, { input: 13, output: 24, cacheRead: 100, cacheCreate: 5 });
  assert.deepEqual(r.items[2].tokens, { input: 20, output: 30, cacheRead: 0, cacheCreate: 10 });
});

test('#3375: subagentsDirFor strips .jsonl and appends subagents/', () => {
  assert.equal(subagentsDirFor('/h/p/sess-1.jsonl'), path.join('/h/p/sess-1', 'subagents'));
});

test('AC4.1: a meta file whose transcript is unreadable yields notFound and null numbers', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-x.meta.json'), JSON.stringify({ description: 'ghost', model: 'haiku', spawnDepth: 2, parentAgentId: 'p1' }));
  const r = await readDispatches(dir);
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.match(it.notFound, /^transcript not readable \(ENOENT\)$/);
  assert.equal(it.tokens, null);
  assert.equal(it.wallClockMs, null);
  assert.equal(it.startTs, null);
  assert.equal(it.endTs, null);
  assert.equal(it.description, 'ghost');
  assert.equal(it.metaModel, 'haiku');
  assert.equal(it.parentAgentId, 'p1');
  assert.equal(it.spawnDepth, 2);
});

test('AC4.1: no subagents/ directory reports notFound, no items', async () => {
  const r = await readDispatches(path.join(os.tmpdir(), 'ct-no-such-subagents-dir'));
  assert.match(r.notFound, /^no subagents\/ directory at /);
  assert.deepEqual(r.items, []);
  assert.equal(r.excludedOutsideWindow, 0);
});

test('AC4.1: a transcript with no meta file is an orphan — description null, numbers present', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-o1.jsonl'), [
    aLine('user', '2026-10-17T10:00:00.000Z'),
    aLine('assistant', '2026-10-17T10:00:10.000Z', 'mo', 'claude-haiku-5', [1, 2, 3, 4]),
  ].join('\n') + '\n');
  const r = await readDispatches(dir);
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.equal(it.agentId, 'o1');
  assert.equal(it.description, null);
  assert.equal(it.metaModel, null);
  assert.equal(it.agentType, null);
  assert.equal(it.notFound, 'meta not found');
  assert.equal(typeof it.wallClockMs, 'number');
  assert.equal(it.wallClockMs, 10000);
  assert.deepEqual(it.tokens, { input: 1, output: 2, cacheRead: 3, cacheCreate: 4 });
});

test('#3375 review focus 2: malformed meta JSON degrades to an orphan, never throws', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-m1.meta.json'), '{not json');
  fs.writeFileSync(path.join(dir, 'agent-m1.jsonl'), aLine('assistant', '2026-10-17T10:00:00.000Z', 'mm', 'claude-opus-5-5', [1, 1, 1, 1]) + '\n');
  const r = await readDispatches(dir);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].notFound, 'meta not found');
  assert.equal(r.items[0].description, null);
  assert.equal(r.items[0].metaModel, null);
  assert.deepEqual(r.items[0].tokens, { input: 1, output: 1, cacheRead: 1, cacheCreate: 1 });
});

test('#3375 review focus 1: transcriptModel prefers the first claude- id over <synthetic>', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-s1.jsonl'), [
    aLine('assistant', '2026-10-17T10:00:00.000Z', 'ms1', '<synthetic>', [0, 0, 0, 0]),
    aLine('assistant', '2026-10-17T10:00:01.000Z', 'ms2', 'claude-sonnet-5-5', [1, 1, 0, 0]),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'agent-s2.jsonl'), aLine('assistant', '2026-10-17T10:00:00.000Z', 'ms3', '<synthetic>', [0, 0, 0, 0]) + '\n');
  fs.writeFileSync(path.join(dir, 'agent-s3.jsonl'), aLine('user', '2026-10-17T10:00:00.000Z') + '\n');
  const r = await readDispatches(dir);
  const by = Object.fromEntries(r.items.map((i) => [i.agentId, i]));
  assert.equal(by.s1.transcriptModel, 'claude-sonnet-5-5');
  assert.equal(by.s2.transcriptModel, '<synthetic>'); // no claude- id: first non-null
  assert.equal(by.s3.transcriptModel, null);
});

test('#3375 review focus 5: window drops out-of-window rows and excludes dispatches entirely outside it', async () => {
  const window = { start: Date.parse('2026-10-17T10:02:00Z'), end: Date.parse('2026-10-17T10:10:00Z') };
  const r = await readDispatches(SUBDIR, { window });
  assert.deepEqual(r.items.map((i) => i.agentId), ['a2', 'a3']);
  assert.equal(r.excludedOutsideWindow, 1);
  // a partially-overlapping dispatch is clipped: rows outside the window drop out of span and tokens.
  const clip = await readDispatches(SUBDIR, { window: { start: Date.parse('2026-10-17T10:00:30Z'), end: Date.parse('2026-10-17T10:10:00Z') } });
  const a1 = clip.items.find((i) => i.agentId === 'a1');
  assert.equal(a1.startTs, '2026-10-17T10:01:05.000Z');
  assert.equal(a1.wallClockMs, 0);
  assert.deepEqual(a1.tokens, { input: 3, output: 4, cacheRead: 0, cacheCreate: 0 });
});

test('AC4.1 [R4]: an empty transcript with a meta file is notFound "transcript has no usage rows", numbers null', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-e1.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'agent-e1.meta.json'), JSON.stringify({ description: 'empty', model: 'opus' }));
  const r = await readDispatches(dir, { window: { start: 0, end: Date.now() } });
  assert.equal(r.excludedOutsideWindow, 0);
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.equal(it.notFound, 'transcript has no usage rows');
  assert.equal(it.tokens, null);
  assert.equal(it.wallClockMs, null);
  assert.equal(it.startTs, null);
  assert.equal(it.endTs, null);
  assert.equal(it.description, 'empty');
  assert.equal(it.metaModel, 'opus');
});

test('AC4.1 [R4]: a transcript whose only lines lack a timestamp is notFound "transcript has no usage rows", numbers null', async () => {
  const dir = tmpSubagents();
  const noTs = JSON.stringify({ type: 'assistant', message: { id: 'mx', role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 9, output_tokens: 9, cache_read_input_tokens: 9, cache_creation_input_tokens: 9 } } });
  fs.writeFileSync(path.join(dir, 'agent-t1.jsonl'), noTs + '\n' + noTs + '\n');
  fs.writeFileSync(path.join(dir, 'agent-t1.meta.json'), JSON.stringify({ description: 'no ts' }));
  const r = await readDispatches(dir);
  const it = r.items[0];
  assert.equal(it.notFound, 'transcript has no usage rows');
  assert.equal(it.tokens, null);
  assert.equal(it.wallClockMs, null);
  assert.equal(it.description, 'no ts');
});

test('#3375: items sort by startTs (nulls last), then agentId', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-z.jsonl'), aLine('user', '2026-10-17T10:00:00.000Z') + '\n');
  fs.writeFileSync(path.join(dir, 'agent-b.jsonl'), aLine('user', '2026-10-17T10:00:00.000Z') + '\n');
  fs.writeFileSync(path.join(dir, 'agent-a.jsonl'), aLine('user', '2026-10-17T09:00:00.000Z') + '\n');
  fs.writeFileSync(path.join(dir, 'agent-n.meta.json'), '{}');
  const r = await readDispatches(dir);
  assert.deepEqual(r.items.map((i) => i.agentId), ['a', 'b', 'z', 'n']);
});

test('#3375: readUsage rows carry model on assistant lines and null on user lines', async () => {
  const rows = await readUsage(path.join(SUBDIR, 'agent-a1.jsonl'));
  assert.deepEqual(rows.map((r) => r.model), [null, 'claude-sonnet-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5']);
  const small = await readUsage(FIX, { worktree: '/repo' });
  assert.ok(small.every((r) => r.model === null));
});

// ---- #3375 final review C1: streaming snapshots in subagent transcripts ----

// A real subagent turn is written as a streaming snapshot (stop_reason null,
// small output_tokens) followed by the final line (the settled count) under
// the same message.id; input/cache fields are equal on every line.
function snapLine(ts, id, stopReason, usage, blockType) {
  return JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: stopReason, content: [{ type: blockType, text: 'x' }], usage: { input_tokens: usage[0], output_tokens: usage[1], cache_read_input_tokens: usage[2], cache_creation_input_tokens: usage[3] } } });
}

test('#3375 C1: readUsage takes the max usage per message.id (the final line, not the streaming snapshot) on the first row', async () => {
  const dir = tmpSubagents();
  const f = path.join(dir, 'agent-c1.jsonl');
  fs.writeFileSync(f, [
    aLine('user', '2026-10-17T10:00:00.000Z'),
    snapLine('2026-10-17T10:00:05.000Z', 'mc1', null, [7, 8, 100, 5], 'thinking'),
    snapLine('2026-10-17T10:00:09.000Z', 'mc1', 'tool_use', [7, 407, 100, 5], 'tool_use'),
    snapLine('2026-10-17T10:01:00.000Z', 'mc2', 'end_turn', [2, 50, 0, 0], 'text'),
  ].join('\n') + '\n');
  const rows = await readUsage(f);
  assert.equal(rows.length, 4);
  // the max lands on the FIRST row for the id (its timestamp drives phase attribution); later lines stay zeroed
  assert.deepEqual(rows.map((r) => r.outputTokens), [0, 407, 0, 50]);
  assert.deepEqual(rows.map((r) => r.inputTokens), [0, 7, 0, 2]);
  assert.equal(rows[1].ts, '2026-10-17T10:00:05.000Z');
  assert.equal(rows[1].cacheRead, 100);
  assert.equal(rows[2].cacheCreate, 0);
  const r = await readDispatches(dir);
  assert.deepEqual(r.items[0].tokens, { input: 9, output: 457, cacheRead: 100, cacheCreate: 5 });
});

test('#3375 C1: a lower later line never reduces the id\'s usage (max, not last)', async () => {
  const dir = tmpSubagents();
  const f = path.join(dir, 'agent-c2.jsonl');
  fs.writeFileSync(f, [
    snapLine('2026-10-17T10:00:05.000Z', 'mc1', 'end_turn', [7, 407, 100, 5], 'text'),
    snapLine('2026-10-17T10:00:09.000Z', 'mc1', 'end_turn', [7, 12, 100, 5], 'text'),
  ].join('\n') + '\n');
  const rows = await readUsage(f);
  assert.deepEqual(rows.map((r) => r.outputTokens), [407, 0]);
});
