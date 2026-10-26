'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { slugForCwd, locateTranscripts, readUsage, isProcedurePath, subagentsDirFor, readDispatches, TRANSCRIPT_SLUG_RULE } = require('../../../plugin/bin/lib/timing/transcript');
const { aggregateDispatches } = require('../../../plugin/bin/lib/timing/derive');

// The developer's own CLAUDE_CONFIG_DIR would redirect every homeDir-only
// lookup below away from its fixture (#3458) — same posture as cli.test.js's
// fixtureHomeEnv.
delete process.env.CLAUDE_CONFIG_DIR;

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

// ---- #3458: the projects root resolves from CLAUDE_CONFIG_DIR -------------

const CWD = '/Users/x/Code/repo/.claude/worktrees/wt';

// Sets (or, for undefined, deletes) CLAUDE_CONFIG_DIR for one call, then restores it.
function withEnv(value, fn) {
  const prior = process.env.CLAUDE_CONFIG_DIR;
  if (value === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = value;
  try { return fn(); } finally {
    if (prior === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prior;
  }
}

function fakeConfigDir() {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-transcript-cfg-'));
  const slugDir = path.join(cfg, 'projects', slugForCwd(CWD));
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'sess-c.jsonl'), '{}\n');
  return cfg;
}

test('AC1.1: with CLAUDE_CONFIG_DIR set, locateTranscripts returns the file under $CLAUDE_CONFIG_DIR/projects', () => {
  const cfg = fakeConfigDir();
  const out = withEnv(cfg, () => locateTranscripts({ cwd: CWD, sessionId: 'sess-c' }));
  assert.deepEqual(out.map((c) => c.path), [fs.realpathSync(path.join(cfg, 'projects', slugForCwd(CWD), 'sess-c.jsonl'))]);
});

test('AC1.1 (symlinked root): a $CLAUDE_CONFIG_DIR/projects that is a symlink still yields its transcripts', () => {
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-transcript-real-'));
  fs.mkdirSync(path.join(real, slugForCwd(CWD)), { recursive: true });
  fs.writeFileSync(path.join(real, slugForCwd(CWD), 'sess-s.jsonl'), '{}\n');
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-transcript-cfg-'));
  fs.symlinkSync(real, path.join(cfg, 'projects'));
  const out = withEnv(cfg, () => locateTranscripts({ cwd: CWD, sessionId: 'sess-s' }));
  assert.deepEqual(out.map((c) => c.path), [fs.realpathSync(path.join(real, slugForCwd(CWD), 'sess-s.jsonl'))]);
});

test('AC1.1: CLAUDE_CONFIG_DIR wins over homeDir when both are given', () => {
  const { home } = fakeHome();
  const cfg = fakeConfigDir();
  withEnv(cfg, () => {
    assert.deepEqual(locateTranscripts({ cwd: CWD, sessionId: 'sess-1', homeDir: home }), []);
    const c = locateTranscripts({ cwd: CWD, sessionId: 'sess-c', homeDir: home });
    assert.equal(c.length, 1);
    assert.equal(path.basename(c[0].path), 'sess-c.jsonl');
  });
});

test('explicit configDir wins over CLAUDE_CONFIG_DIR', () => {
  const cfg = fakeConfigDir();
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-transcript-empty-'));
  const out = withEnv(empty, () => locateTranscripts({ cwd: CWD, sessionId: 'sess-c', configDir: cfg }));
  assert.equal(out.length, 1);
  assert.equal(path.basename(out[0].path), 'sess-c.jsonl');
});

test('empty CLAUDE_CONFIG_DIR falls back to homeDir/.claude', () => {
  const { home, slugDir } = fakeHome();
  const out = withEnv('', () => locateTranscripts({ cwd: CWD, sessionId: 'sess-1', homeDir: home }));
  assert.deepEqual(out.map((c) => c.path), [fs.realpathSync(path.join(slugDir, 'sess-1.jsonl'))]);
});

test('AC2.1: with CLAUDE_CONFIG_DIR unset, lookup is unchanged (homeDir/.claude/projects)', () => {
  const { home, slugDir } = fakeHome();
  const out = withEnv(undefined, () => locateTranscripts({ cwd: CWD, sessionId: 'sess-2', homeDir: home }));
  assert.deepEqual(out.map((c) => c.path), [fs.realpathSync(path.join(slugDir, 'sess-2.jsonl'))]);
});

test('#1929: isProcedurePath matches repo skills, installed-plugin skills, and nothing else', () => {
  assert.equal(isProcedurePath('/repo/plugin/skills/review/SKILL.md', '/repo'), true);
  assert.equal(isProcedurePath('plugin/skills/_shared/x.md', '/repo'), true);
  assert.equal(isProcedurePath('/Users/x/.claude/plugins/cache/m/claude-tweaks/6.0.0/skills/flow/multi-spec.md', '/repo'), true);
  assert.equal(isProcedurePath('/repo/docs/hooks.md', '/repo'), false);
  assert.equal(isProcedurePath('/repo/plugin/bin/hooks.js', '/repo'), false);
  assert.equal(isProcedurePath('/elsewhere/skills/notes.txt', '/repo'), false);
});

test('#3315: isProcedurePath POSIX edge cases stay as they were (non-string, empty, no worktree, trailing-slash worktree)', () => {
  assert.equal(isProcedurePath(undefined, '/repo'), false);
  assert.equal(isProcedurePath(null, '/repo'), false);
  assert.equal(isProcedurePath(42, '/repo'), false);
  assert.equal(isProcedurePath('', '/repo'), false);
  assert.equal(isProcedurePath('/repo/plugin/skills/review/SKILL.md', null), true);
  assert.equal(isProcedurePath('/repo/plugin/skills/review/SKILL.md', undefined), true);
  assert.equal(isProcedurePath('/repo/plugin/skills/review/SKILL.md', '/repo/'), true);
  assert.equal(isProcedurePath('/repo/docs/notes.md', '/repo/'), false);
  assert.equal(isProcedurePath('/repo/plugin/skills/review/notes.txt', '/repo'), false);
});

test('AC1.1: isProcedurePath matches win32 skill paths and nothing else (#3315)', () => {
  const W = path.win32;
  assert.equal(isProcedurePath('C:\\repo\\plugin\\skills\\review\\SKILL.md', 'C:\\repo', W), true);
  assert.equal(isProcedurePath('plugin\\skills\\_shared\\x.md', 'C:\\repo', W), true);
  assert.equal(isProcedurePath('C:\\Users\\x\\.claude\\plugins\\cache\\m\\claude-tweaks\\6.0.0\\skills\\flow\\multi-spec.md', 'C:\\repo', W), true);
  assert.equal(isProcedurePath('C:\\repo\\docs\\notes.md', 'C:\\repo', W), false);
});

test('#3315: isProcedurePath strips a win32 worktree prefix, so a worktree path that itself contains skills/ is not a false positive', () => {
  const W = path.win32;
  assert.equal(isProcedurePath('C:\\work\\skills\\repo\\docs\\notes.md', 'C:\\work\\skills\\repo', W), false);
  assert.equal(isProcedurePath('C:\\work\\skills\\repo\\plugin\\skills\\review\\SKILL.md', 'C:\\work\\skills\\repo', W), true);
  // POSIX twin: the same shape, native path.
  assert.equal(isProcedurePath('/work/skills/repo/docs/notes.md', '/work/skills/repo'), false);
});

test('#3315: isProcedurePath strips the worktree prefix only at a segment boundary, case-insensitively on win32', () => {
  const W = path.win32;
  // A lower-case drive letter is still inside the worktree, so the skills/ in the worktree path is stripped.
  assert.equal(isProcedurePath('C:\\work\\skills\\repo\\docs\\notes.md', 'c:\\work\\skills\\repo', W), false);
  // A trailing separator on the worktree changes nothing.
  assert.equal(isProcedurePath('C:\\repo\\plugin\\skills\\review\\SKILL.md', 'C:\\repo\\', W), true);
  // `/x/skill` is a prefix of `/x/skills/…` but not its ancestor: no strip, so skills/ still matches.
  assert.equal(isProcedurePath('/x/skills/a.md', '/x/skill'), true);
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
  assert.deepEqual(assistants[0], { ts: '2026-09-05T13:50:00.000Z', role: 'assistant', inputTokens: 10, outputTokens: 20, cacheRead: 300, cacheCreate: 40, toolRoundTrip: false, procedureBytes: 0, model: null, turnClasses: {}, turnStart: true, contextTokens: 350 });
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

const TURN_CLASSES_FIX = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'turn-classes', 'session.jsonl');

test('#4029 AC1.1: readUsage tags each tool_result with its turn class and marks turn starts', async () => {
  const rows = await readUsage(TURN_CLASSES_FIX, { worktree: '/repo' });
  const summed = {};
  for (const r of rows) for (const [c, n] of Object.entries(r.turnClasses)) summed[c] = (summed[c] || 0) + n;
  assert.deepEqual(summed, { edit: 1, read: 1, explore: 1, procedure: 1, bookkeeping: 1, orientation: 2, verify: 1, 'guard-refusal': 1, dispatch: 1, other: 1 });
  const starts = rows.filter((r) => r.turnStart);
  assert.equal(starts.length, 10);
  assert.ok(starts.every((r) => r.role === 'assistant'));
  assert.deepEqual(starts.map((r) => r.contextTokens), [1010, 2020, 3030, 4040, 5050, 6060, 7070, 8080, 9090, 10100]);
  // every non-start row carries the fields too: false / 0 (the duplicate m1 line and all user rows)
  for (const r of rows.filter((x) => !x.turnStart)) assert.equal(r.contextTokens, 0);
  assert.ok(rows.every((r) => typeof r.turnStart === 'boolean' && typeof r.contextTokens === 'number' && r.turnClasses && typeof r.turnClasses === 'object'));
  assert.deepEqual(rows.filter((r) => r.role === 'assistant').map((r) => r.turnClasses).filter((c) => Object.keys(c).length), []);
  // the m2 user row batches two orientation results; the m5 refusal is decided by its result text, not the tool
  const users = rows.filter((r) => r.role === 'user');
  assert.deepEqual(users[1].turnClasses, { orientation: 2 });
  assert.deepEqual(users[4].turnClasses, { 'guard-refusal': 1 });
  assert.equal(rows.reduce((s, r) => s + r.procedureBytes, 0), 100);
});

test('#4029: an orphan tool_result counts as other', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-orphan-')), 's.jsonl');
  fs.writeFileSync(f, JSON.stringify({ type: 'user', timestamp: '2026-10-24T10:00:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'never-seen', content: 'x' }] } }) + '\n');
  const rows = await readUsage(f);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].turnClasses, { other: 1 });
  assert.equal(rows[0].turnStart, false);
  assert.equal(rows[0].contextTokens, 0);
});

test('#4029: contextTokens is the per-id max sum (streaming snapshot then final), on the first row only; id-less assistant rows each start a turn', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ctx-'));
  const f = path.join(dir, 's.jsonl');
  const noId = JSON.stringify({ type: 'assistant', timestamp: '2026-10-24T10:02:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 4, cache_creation_input_tokens: 5 } } });
  fs.writeFileSync(f, [
    snapLine('2026-10-24T10:00:00.000Z', 'mx', null, [1, 8, 100, 5], 'thinking'),
    snapLine('2026-10-24T10:00:09.000Z', 'mx', 'tool_use', [7, 407, 100, 5], 'tool_use'),
    noId,
    noId,
  ].join('\n') + '\n');
  const rows = await readUsage(f);
  assert.deepEqual(rows.map((r) => r.turnStart), [true, false, true, true]);
  assert.deepEqual(rows.map((r) => r.contextTokens), [112, 0, 12, 12]);
});

test('#4029: tool_result text parts are joined for the guard-refusal check, and a plain error stays a tool-classed call', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-')), 's.jsonl');
  const use = (id, command) => JSON.stringify({ type: 'assistant', timestamp: '2026-10-24T10:00:00.000Z', message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }], usage: {} } });
  const res = (id, content, isError) => JSON.stringify({ type: 'user', timestamp: '2026-10-24T10:00:05.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
  fs.writeFileSync(f, [
    use('a', 'git -C /repo commit -m x'),
    res('a', [{ type: 'text', text: 'This session is isolated' }, { type: 'text', text: ' in the worktree /repo' }], true),
    use('b', 'git -C /repo commit -m x'),
    res('b', 'Exit code 1', true),
  ].join('\n') + '\n');
  const rows = await readUsage(f);
  const users = rows.filter((r) => r.role === 'user');
  assert.deepEqual(users[0].turnClasses, { 'guard-refusal': 1 });
  assert.deepEqual(users[1].turnClasses, { bookkeeping: 1 });
});

test('#1929: readUsage on a missing file rejects with a code the CLI can name', async () => {
  await assert.rejects(readUsage(path.join(os.tmpdir(), 'ct-no-such-transcript.jsonl'), {}), (err) => err.code === 'ENOENT');
});

test('#1929: readUsage on a directory path rejects with EISDIR', async () => {
  await assert.rejects(readUsage(__dirname, {}), (err) => err.code === 'EISDIR');
});

// ---- #3375: per-subagent-dispatch enumeration --------------------------

// sess-1.jsonl (the main transcript) is not read in this file — cli.test.js passes it as --transcript; here it anchors the {sessionId}/ sibling path layout that subagentsDirFor derives.
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

test('#3375 M4: a subagent transcript passed as --transcript (/dispatch) maps to the session subagents/ dir it sits in', () => {
  assert.equal(subagentsDirFor('/h/p/sess-1/subagents/agent-a7.jsonl'), '/h/p/sess-1/subagents');
  // a main transcript that merely lives under a dir named subagents is not an agent transcript
  assert.equal(subagentsDirFor('/h/subagents/sess-1.jsonl'), path.join('/h/subagents/sess-1', 'subagents'));
});

test('#3375: a subagents/ directory with no agent-* files is notFound, not an empty table', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  const r = await readDispatches(dir);
  assert.equal(r.notFound, `no agent-* transcripts in ${dir}`);
  assert.deepEqual(r.items, []);
});

test('#3375 [IL-150]: a symlinked subagents/ directory is never followed', async () => {
  const real = tmpSubagents();
  fs.writeFileSync(path.join(real, 'agent-s1.jsonl'), aLine('assistant', '2026-10-17T10:00:00.000Z', 'ms1', 'claude-opus-5-5', [9, 9, 9, 9]) + '\n');
  const link = path.join(tmpSubagents(), 'subagents');
  fs.symlinkSync(real, link);
  const r = await readDispatches(link);
  assert.equal(r.notFound, `subagents/ directory is a symlink (not followed) at ${link}`);
  assert.deepEqual(r.items, []);
});

test('#3375: an orphan transcript that is also unusable keeps "meta not found" ahead of the transcript reason', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-z1.jsonl'), '');
  const r = await readDispatches(dir);
  assert.equal(r.items[0].notFound, 'meta not found; transcript has no usage rows');
  assert.equal(r.items[0].tokens, null);
});

test('#3375: a usage row with an invalid timestamp still counts toward a dispatch with timed rows', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-t1.meta.json'), JSON.stringify({ description: 'Implement Task 1', model: 'sonnet' }));
  fs.writeFileSync(path.join(dir, 'agent-t1.jsonl'), [
    aLine('assistant', '2026-10-17T10:00:00.000Z', 'mt1', 'claude-sonnet-5', [1, 2, 3, 4]),
    aLine('assistant', 'not-a-time', 'mt2', 'claude-sonnet-5', [10, 20, 30, 40]),
  ].join('\n') + '\n');
  const r = await readDispatches(dir, { window: { start: Date.parse('2026-10-17T09:00:00.000Z'), end: Date.parse('2026-10-17T11:00:00.000Z') } });
  assert.deepEqual(r.items[0].tokens, { input: 11, output: 22, cacheRead: 33, cacheCreate: 44 });
  assert.equal(r.items[0].wallClockMs, 0);
});

test('AC4.1: a meta file whose transcript is unreadable yields notFound and null numbers', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-x.meta.json'), JSON.stringify({ description: 'ghost', model: 'haiku', spawnDepth: 2, parentAgentId: 'p1' }));
  const r = await readDispatches(dir);
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.equal(it.notFound, 'transcript not readable (ENOENT)');
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
  assert.equal(it.wallClockMs, 10000);
  assert.deepEqual(it.tokens, { input: 1, output: 2, cacheRead: 3, cacheCreate: 4 });
});

test('#3375 review focus 2: malformed meta JSON degrades to an orphan named "meta not readable (malformed)", never throws', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-m1.meta.json'), '{not json');
  fs.writeFileSync(path.join(dir, 'agent-m1.jsonl'), aLine('assistant', '2026-10-17T10:00:00.000Z', 'mm', 'claude-opus-5-5', [1, 1, 1, 1]) + '\n');
  const r = await readDispatches(dir);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].notFound, 'meta not readable (malformed)');
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

// ---- #3375 final review M2: symlinks inside subagents/ are not followed (IL-150) ----

test('#3375 M2 [IL-150]: readDispatches skips symlinked agent transcripts and meta files', async () => {
  const dir = tmpSubagents();
  const outside = tmpSubagents();
  fs.writeFileSync(path.join(outside, 'secret.jsonl'), aLine('assistant', '2026-10-17T10:00:00.000Z', 'ms', 'claude-opus-5-5', [9, 9, 9, 9]) + '\n');
  fs.writeFileSync(path.join(outside, 'secret.meta.json'), JSON.stringify({ description: 'Implement leaked', model: 'opus' }));
  // fully symlinked agent: neither file may be followed, but the dispatch is still named
  fs.symlinkSync(path.join(outside, 'secret.jsonl'), path.join(dir, 'agent-l1.jsonl'));
  fs.symlinkSync(path.join(outside, 'secret.meta.json'), path.join(dir, 'agent-l1.meta.json'));
  // regular meta + symlinked transcript: listed, but the transcript is not read
  fs.writeFileSync(path.join(dir, 'agent-l2.meta.json'), JSON.stringify({ description: 'Implement Task 2', model: 'sonnet' }));
  fs.symlinkSync(path.join(outside, 'secret.jsonl'), path.join(dir, 'agent-l2.jsonl'));
  // regular transcript + symlinked meta: the meta is not read (orphan)
  fs.writeFileSync(path.join(dir, 'agent-l3.jsonl'), aLine('assistant', '2026-10-17T10:00:00.000Z', 'ml', 'claude-haiku-5', [1, 1, 1, 1]) + '\n');
  fs.symlinkSync(path.join(outside, 'secret.meta.json'), path.join(dir, 'agent-l3.meta.json'));
  const r = await readDispatches(dir);
  const by = Object.fromEntries(r.items.map((i) => [i.agentId, i]));
  assert.equal(by.l1.notFound, 'meta not readable (symlink); transcript not readable (symlink)');
  assert.equal(by.l1.tokens, null);
  assert.equal(by.l1.description, null);
  assert.equal(by.l2.tokens, null);
  assert.equal(by.l2.notFound, 'transcript not readable (symlink)');
  assert.equal(by.l2.description, 'Implement Task 2');
  assert.equal(by.l3.description, null);
  assert.equal(by.l3.notFound, 'meta not readable (symlink)');
  assert.deepEqual(by.l3.tokens, { input: 1, output: 1, cacheRead: 1, cacheCreate: 1 });
});

test('#3375 [IL-150]: an entry lstat cannot prove regular is never read (fail closed) and is named with the lstat code', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-e1.meta.json'), JSON.stringify({ description: 'Implement Task 1', model: 'sonnet' }));
  fs.writeFileSync(path.join(dir, 'agent-e1.jsonl'), aLine('assistant', '2026-10-17T10:00:00.000Z', 'me', 'claude-sonnet-5', [1, 1, 1, 1]) + '\n');
  const fsImpl = { ...fs, lstatSync: (p, ...a) => { if (p.endsWith('agent-e1.jsonl')) throw Object.assign(new Error('io'), { code: 'EIO' }); return fs.lstatSync(p, ...a); } };
  const r = await readDispatches(dir, { fsImpl });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].notFound, 'transcript not readable (EIO)');
  assert.equal(r.items[0].tokens, null);
  assert.equal(r.items[0].description, 'Implement Task 1');
});

test('#3375: a subagents/ directory that exists but cannot be listed names the error code, not "no subagents/ directory"', async () => {
  const fsImpl = { ...fs, readdirSync: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } };
  const r = await readDispatches('/x/sess/subagents', { fsImpl });
  assert.equal(r.notFound, 'subagents/ directory not readable (EACCES) at /x/sess/subagents');
  assert.deepEqual(r.items, []);
});

test('#3375: a meta file that exists but cannot be read names the error code, not "meta not found"', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-p1.meta.json'), '{}');
  fs.writeFileSync(path.join(dir, 'agent-p1.jsonl'), aLine('assistant', '2026-10-17T10:00:00.000Z', 'mp', 'claude-haiku-5', [1, 1, 1, 1]) + '\n');
  const fsImpl = { ...fs, readFileSync: (p, ...a) => { if (String(p).endsWith('.meta.json')) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return fs.readFileSync(p, ...a); } };
  const r = await readDispatches(dir, { fsImpl });
  assert.equal(r.items[0].notFound, 'meta not readable (EACCES)');
  assert.deepEqual(r.items[0].tokens, { input: 1, output: 1, cacheRead: 1, cacheCreate: 1 });
});

test('AC2.2: fixture metas with model "inherit" and with no model key resolve through the transcript model to capable', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-i1.meta.json'), JSON.stringify({ agentType: 'fork', description: 'Implement Task 3', model: 'inherit' }));
  fs.writeFileSync(path.join(dir, 'agent-i1.jsonl'), aLine('assistant', '2026-10-17T10:00:00.000Z', 'mi1', 'claude-opus-5-5', [1, 1, 1, 1]) + '\n');
  fs.writeFileSync(path.join(dir, 'agent-i2.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Review Task 3 (spec + quality)' }));
  fs.writeFileSync(path.join(dir, 'agent-i2.jsonl'), aLine('assistant', '2026-10-17T10:01:00.000Z', 'mi2', 'claude-opus-5-5', [1, 1, 1, 1]) + '\n');
  const agg = aggregateDispatches((await readDispatches(dir)).items);
  assert.deepEqual(agg.items.map((i) => [i.agentId, i.metaModel, i.tier]), [['i1', 'inherit', 'capable'], ['i2', null, 'capable']]);
  assert.equal(agg.byTier.capable.dispatches, 2);
  assert.equal(agg.byTier.unmapped, undefined);
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
