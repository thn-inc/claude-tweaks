'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { slugForCwd, locateTranscripts, readUsage, mergeUsage, readPromptRows, isProcedurePath, subagentsDirFor, readDispatches, locateTaskTranscripts, runIdsNamed, RUN_ID_NAMED_RE, FIRST_ENTRY_CAP, TRANSCRIPT_SLUG_RULE } = require('../../../plugin/bin/lib/timing/transcript');
const { aggregateDispatches } = require('../../../plugin/bin/lib/timing/derive');

// The developer's own CLAUDE_CONFIG_DIR would redirect every homeDir-only
// lookup below away from its fixture (#3458) — same posture as
// tests/helpers/fixture-home.js's fixtureHomeEnv.
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
  const home = scratchDir('ct-transcript-home-');
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
  const cfg = scratchDir('ct-transcript-cfg-');
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
  const real = scratchDir('ct-transcript-real-');
  fs.mkdirSync(path.join(real, slugForCwd(CWD)), { recursive: true });
  fs.writeFileSync(path.join(real, slugForCwd(CWD), 'sess-s.jsonl'), '{}\n');
  const cfg = scratchDir('ct-transcript-cfg-');
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
  const empty = scratchDir('ct-transcript-empty-');
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
  assert.deepEqual(assistants[0], { ts: '2026-09-05T13:50:00.000Z', role: 'assistant', inputTokens: 10, outputTokens: 20, cacheRead: 300, cacheCreate: 40, cacheWrite1h: 0, cacheWrite5m: 40, messageId: null, toolRoundTrip: false, procedureBytes: 0, model: null, turnClasses: {}, turnStart: true, contextTokens: 350, procedureFiles: { 'skills/review/SKILL.md': 1 } });
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
  const f = path.join(scratchDir('tc-orphan-'), 's.jsonl');
  fs.writeFileSync(f, JSON.stringify({ type: 'user', timestamp: '2026-10-24T10:00:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'never-seen', content: 'x' }] } }) + '\n');
  const rows = await readUsage(f);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].turnClasses, { other: 1 });
  assert.equal(rows[0].turnStart, false);
  assert.equal(rows[0].contextTokens, 0);
});

test('#4029: contextTokens is the per-id max sum (streaming snapshot then final), on the first row only; id-less assistant rows each start a turn', async () => {
  const dir = scratchDir('tc-ctx-');
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
  const f = path.join(scratchDir('tc-guard-'), 's.jsonl');
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

test('readUsage counts per-file procedure reads on the tool_use row', async () => {
  const f = path.join(scratchDir('tc-pfiles-'), 's.jsonl');
  const file = 'plugin/skills/review/code-mode-steps.md';
  fs.writeFileSync(f, [
    JSON.stringify({ type: 'assistant', timestamp: '2026-11-16T10:00:00.000Z', message: { id: 'm1', role: 'assistant', content: [
      { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: file } },
      { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: `sed -n '1,9p' ${file}` } },
    ], usage: {} } }),
    JSON.stringify({ type: 'user', timestamp: '2026-11-16T10:00:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: 'x' }] } }),
    JSON.stringify({ type: 'user', timestamp: '2026-11-16T10:00:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'y' }] } }),
  ].join('\n') + '\n');
  const rows = await readUsage(f, { worktree: '/repo' });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].procedureFiles, { 'skills/review/code-mode-steps.md': 2 });
  assert.deepEqual(rows[1].procedureFiles, {});
  assert.deepEqual(rows[2].procedureFiles, {});
});

test('#4359 I1: readUsage counts a Read and a sed of a context bundle under context/, adding no procedure bytes', async () => {
  const f = path.join(scratchDir('tc-pfiles-'), 's.jsonl');
  const bundle = '/main/.claude-tweaks/pipelines/2026-11-16T000452-record-4359/context/review-code-mode.md';
  fs.writeFileSync(f, [
    JSON.stringify({ type: 'assistant', timestamp: '2026-11-16T10:00:00.000Z', message: { id: 'm1', role: 'assistant', content: [
      { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: bundle } },
      { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: `sed -n "1,80p" ${bundle}` } },
    ], usage: {} } }),
    JSON.stringify({ type: 'user', timestamp: '2026-11-16T10:00:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: 'x'.repeat(50) }] } }),
  ].join('\n') + '\n');
  const rows = await readUsage(f, { worktree: '/main/.claude/worktrees/wt' });
  assert.deepEqual(rows[0].procedureFiles, { 'context/review-code-mode.md': 2 });
  assert.equal(rows[1].procedureBytes, 0, 'a bundle Read is not a skill-file read');
  assert.deepEqual(rows[1].turnClasses, { read: 1 });
});

test('#4359: a bundle Read and sed under a main checkout inside a skills/ directory key under context/', async () => {
  const f = path.join(scratchDir('tc-pfiles-'), 's.jsonl');
  const bundle = '/home/u/skills/repo/.claude-tweaks/pipelines/run-a/context/lens-child.md';
  fs.writeFileSync(f, JSON.stringify({ type: 'assistant', timestamp: '2026-11-16T10:00:00.000Z', message: { id: 'm1', role: 'assistant', content: [
    { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: bundle } },
    { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: `sed -n "1,80p" ${bundle}` } },
  ], usage: {} } }) + '\n');
  const rows = await readUsage(f, { worktree: '/home/u/skills/repo/.claude/worktrees/wt' });
  assert.deepEqual(rows[0].procedureFiles, { 'context/lens-child.md': 2 });
});

test('#4359 T2-1: a timestamp-less api-request-blob row carrying a skill Read adds no procedure read', async () => {
  const f = path.join(scratchDir('tc-pfiles-'), 's.jsonl');
  const read = (id) => ({ type: 'tool_use', id, name: 'Read', input: { file_path: 'plugin/skills/review/code-mode-steps.md' } });
  fs.writeFileSync(f, [
    JSON.stringify({ type: 'assistant', timestamp: '2026-11-16T10:00:00.000Z', message: { id: 'm1', role: 'assistant', content: [read('r1')], usage: {} } }),
    // the replayed request blob repeats r1's tool_use id, with no timestamp
    JSON.stringify({ type: 'api-request-blob', message: { id: 'm1', role: 'assistant', content: [read('r1')], usage: {} } }),
  ].join('\n') + '\n');
  const rows = await readUsage(f, {});
  assert.equal(rows.length, 1);
  const total = {};
  for (const r of rows) for (const [k, n] of Object.entries(r.procedureFiles)) total[k] = (total[k] || 0) + n;
  assert.deepEqual(total, { 'skills/review/code-mode-steps.md': 1 });
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
  return scratchDir('ct-subagents-');
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
  assert.equal(it.procedureFiles, null);
  assert.equal(it.procedureFileRows, null);
  assert.equal(it.transcriptPath, path.join(dir, 'agent-x.jsonl'));
});

function readLine(ts, id, filePath) {
  return JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'tool_use', id: `tu-${id}`, name: 'Read', input: { file_path: filePath } }], usage: { input_tokens: 1, output_tokens: 1 } } });
}

test('readDispatches sums a subagent\'s per-file reads', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-p1.jsonl'), [
    readLine('2026-11-16T10:00:00.000Z', 'mp1', 'plugin/skills/_shared/a.md'),
    aLine('assistant', '2026-11-16T10:00:05.000Z', 'mp2', 'claude-sonnet-5', [1, 1, 0, 0]),
    readLine('2026-11-16T10:00:09.000Z', 'mp3', 'plugin/skills/_shared/a.md'),
  ].join('\n') + '\n');
  const r = await readDispatches(dir);
  const it = r.items[0];
  assert.deepEqual(it.procedureFiles, { 'skills/_shared/a.md': 2 });
  assert.deepEqual(it.procedureFileRows, [
    { ts: '2026-11-16T10:00:00.000Z', procedureFiles: { 'skills/_shared/a.md': 1 } },
    { ts: '2026-11-16T10:00:09.000Z', procedureFiles: { 'skills/_shared/a.md': 1 } },
  ]);
  assert.ok(it.transcriptPath.endsWith('agent-p1.jsonl'));
  assert.equal(it.transcriptPath, path.join(dir, 'agent-p1.jsonl'));
});

test('readDispatches: a dispatch with no procedure reads carries {} and [], an untimed kept row takes startTs, and window-dropped rows are not counted', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-q1.jsonl'), aLine('assistant', '2026-11-16T10:00:00.000Z', 'mq1', 'claude-sonnet-5', [1, 1, 0, 0]) + '\n');
  fs.writeFileSync(path.join(dir, 'agent-q2.jsonl'), [
    readLine('2026-11-16T08:00:00.000Z', 'mr0', 'plugin/skills/_shared/early.md'),
    readLine('2026-11-16T10:00:03.000Z', 'mr1', 'plugin/skills/_shared/b.md'),
    readLine('not-a-time', 'mr2', 'plugin/skills/_shared/c.md'),
    readLine('2026-11-16T10:00:07.000Z', 'mr3', 'plugin/skills/_shared/d.md'),
    readLine('2026-11-16T10:00:08.000Z', 'mr4', '/repo/src/not-a-skill.md'),
  ].join('\n') + '\n');
  const r = await readDispatches(dir, { window: { start: Date.parse('2026-11-16T09:00:00.000Z'), end: Date.parse('2026-11-16T11:00:00.000Z') } });
  const by = Object.fromEntries(r.items.map((i) => [i.agentId, i]));
  assert.deepEqual(by.q1.procedureFiles, {});
  assert.deepEqual(by.q1.procedureFileRows, []);
  assert.deepEqual(by.q2.procedureFiles, { 'skills/_shared/b.md': 1, 'skills/_shared/c.md': 1, 'skills/_shared/d.md': 1 });
  // transcript order: the untimed c row sits between b and d, booked at startTs
  assert.deepEqual(by.q2.procedureFileRows, [
    { ts: '2026-11-16T10:00:03.000Z', procedureFiles: { 'skills/_shared/b.md': 1 } },
    { ts: '2026-11-16T10:00:03.000Z', procedureFiles: { 'skills/_shared/c.md': 1 } },
    { ts: '2026-11-16T10:00:07.000Z', procedureFiles: { 'skills/_shared/d.md': 1 } },
  ]);
});

test('#4359 T2-2: readDispatches keys a subagent\'s reads against the worktree it is given', async () => {
  const dir = tmpSubagents();
  // a worktree under a skills/ directory: only the worktree-relative key is right
  const wt = '/home/u/skills/wt';
  fs.writeFileSync(path.join(dir, 'agent-w1.jsonl'), readLine('2026-11-16T10:00:00.000Z', 'mw1', `${wt}/plugin/skills/review/x.md`) + '\n');
  assert.deepEqual((await readDispatches(dir, { worktree: wt })).items[0].procedureFiles, { 'skills/review/x.md': 1 });
  assert.deepEqual((await readDispatches(dir)).items[0].procedureFiles, { 'skills/wt/plugin/skills/review/x.md': 1 });
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

// #5584 Task 1: readPromptRows. Row shape copied from work/5584-captured-rows.json
// (capture "a", the typed row), with its fixed test ids.
const TYPED_CONTENT = '<command-message>claude-tweaks:dispatch</command-message>\n<command-name>/claude-tweaks:dispatch</command-name>\n<command-args>#3</command-args>';
function promptRow(promptId, content = TYPED_CONTENT) {
  return {
    type: 'user', promptId, sessionId: 'test-session-0001', timestamp: '2026-11-16T02:09:19.668Z',
    turnOrigin: 'human', origin: { kind: 'human' }, isSidechain: false,
    message: { role: 'user', content },
  };
}
function promptTranscript(lines) {
  const f = path.join(scratchDir('ct-prompt-rows-'), 's.jsonl');
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}

test('#5584: readPromptRows returns only rows whose promptId matches', () => {
  const f = promptTranscript([
    JSON.stringify(promptRow('test-prompt-0001')),
    JSON.stringify(promptRow('test-prompt-0002')),
    JSON.stringify({ ...promptRow('test-prompt-0001'), isMeta: true, message: { role: 'user', content: [{ type: 'text', text: '(skill expansion elided)' }] } }),
  ]);
  const rows = readPromptRows(f, 'test-prompt-0001');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.promptId === 'test-prompt-0001'));
  assert.equal(rows[0].message.content, TYPED_CONTENT);
  assert.equal(rows[1].isMeta, true);
});

test('#5584 review: readPromptRows keep drops the rows it rejects before they are returned, and keeps the default of every matching row', () => {
  const toolResult = { ...promptRow('test-prompt-0001'), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(2000) }] } };
  const f = promptTranscript([JSON.stringify(promptRow('test-prompt-0001')), JSON.stringify(toolResult), JSON.stringify(promptRow('test-prompt-0002'))]);
  const asked = [];
  const kept = readPromptRows(f, 'test-prompt-0001', { keep: (r) => { asked.push(r.promptId); return typeof r.message.content === 'string'; } });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].message.content, TYPED_CONTENT);
  assert.deepEqual(asked, ['test-prompt-0001', 'test-prompt-0001'], 'keep sees only rows of the asked prompt id');
  assert.equal(readPromptRows(f, 'test-prompt-0001').length, 2);
});

test('#5584: readPromptRows skips lines that do not parse', () => {
  const whole = JSON.stringify(promptRow('test-prompt-0001'));
  const f = promptTranscript([whole.slice(0, Math.floor(whole.length / 2)), whole]);
  const rows = readPromptRows(f, 'test-prompt-0001');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], promptRow('test-prompt-0001'));
});

test('#5584: readPromptRows reads a 600 KB line', () => {
  const big = 'x'.repeat(600000);
  const f = promptTranscript([
    JSON.stringify(promptRow('test-prompt-0002')),
    JSON.stringify(promptRow('test-prompt-0001', big)),
    JSON.stringify(promptRow('test-prompt-0002')),
  ]);
  const rows = readPromptRows(f, 'test-prompt-0001', { chunkBytes: 4096 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].message.content, big);
});

test('#5584: readPromptRows returns a matching last line that has no trailing newline', () => {
  const f = promptTranscript([JSON.stringify(promptRow('test-prompt-0002'))]);
  fs.appendFileSync(f, JSON.stringify(promptRow('test-prompt-0001')));
  const rows = readPromptRows(f, 'test-prompt-0001', { chunkBytes: 64 });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], promptRow('test-prompt-0001'));
});

test('#5584: readPromptRows returns only the exact promptId, not one that merely contains it', () => {
  const f = promptTranscript([
    JSON.stringify(promptRow('test-prompt-00011')),
    JSON.stringify(promptRow('test-prompt-0001')),
  ]);
  const rows = readPromptRows(f, 'test-prompt-0001');
  assert.deepEqual(rows.map((r) => r.promptId), ['test-prompt-0001']);
});

test('#5584: readPromptRows stats before opening — a non-regular file throws EISDIR and is never opened', () => {
  let opened = 0;
  const fsImpl = {
    statSync: () => ({ isFile: () => false }),
    openSync: () => { opened += 1; throw new Error('openSync must not be called'); },
  };
  assert.throws(() => readPromptRows('/fake/s.jsonl', 'test-prompt-0001', { fsImpl }), (err) => err.code === 'EISDIR');
  assert.equal(opened, 0);
});

test('#5584: readPromptRows throws ENOENT for a missing file', () => {
  assert.throws(() => readPromptRows(path.join(os.tmpdir(), 'ct-no-such-transcript.jsonl'), 'test-prompt-0001'), (err) => err.code === 'ENOENT');
});

test('#5584: readPromptRows throws EISDIR for a directory', () => {
  assert.throws(() => readPromptRows(__dirname, 'test-prompt-0001'), (err) => err.code === 'EISDIR');
});

// ---- #5597: agents a workflow script starts live in subagents/workflows/{runId}/ ----

// {tmp}/sess-1/subagents — a real session shape, so the run file beside it
// ({tmp}/sess-1/workflows/{runId}.json) never lands in a shared tmp dir.
function tmpSessionSubagents() {
  const sub = path.join(scratchDir('ct-wf-'), 'sess-1', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  return sub;
}
function writeAgent(dir, id, ts, meta) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `agent-${id}.jsonl`), aLine('assistant', ts, `m-${id}`, 'claude-sonnet-5-5', [1, 1, 1, 1]) + '\n');
  if (meta) fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify(meta));
}
function fiveAgentSession() {
  const dir = tmpSessionSubagents();
  writeAgent(dir, 'd1', '2026-11-16T10:00:00.000Z', { description: 'Implement Task 1', model: 'sonnet' });
  writeAgent(dir, 'd2', '2026-11-16T10:01:00.000Z', { description: 'Review Task 1', model: 'opus' });
  const run = path.join(dir, 'workflows', 'wf-run-1');
  writeAgent(run, 'w1', '2026-11-16T10:02:00.000Z', { description: 'lens 3b A', model: 'haiku', workflowPhase: 'review' });
  writeAgent(run, 'w2', '2026-11-16T10:03:00.000Z', { description: 'lens 3b B', model: 'sonnet', workflowPhase: 'review' });
  writeAgent(run, 'w3', '2026-11-16T10:04:00.000Z', { description: 'lens 3b C', model: 'opus', workflowPhase: 'review' });
  return { dir, run };
}

test('AC1.1: two direct agents and one workflows/{runId}/ holding three agents give five items', async () => {
  const { dir } = fiveAgentSession();
  const r = await readDispatches(dir);
  assert.equal(r.items.length, 5);
  assert.equal(r.notFound, null);
  assert.deepEqual(r.dirNotes, []);
});

test('AC1.2: the three workflow items carry the run id and their workflowPhase; the two direct items carry null for both', async () => {
  const { dir } = fiveAgentSession();
  const r = await readDispatches(dir);
  assert.deepEqual(r.items.map((i) => [i.agentId, i.workflowRunId, i.workflowPhase]), [
    ['d1', null, null], ['d2', null, null],
    ['w1', 'wf-run-1', 'review'], ['w2', 'wf-run-1', 'review'], ['w3', 'wf-run-1', 'review'],
  ]);
  // the two keys follow notFound; the internal usageRows (stripped before timing.json) comes last
  const keys = Object.keys(r.items[0]);
  assert.deepEqual(keys.slice(keys.indexOf('notFound')), ['notFound', 'workflowRunId', 'workflowPhase', 'usageRows']);
});

test('AC2.1: workflow items take their tier from the meta model alias', async () => {
  const { dir } = fiveAgentSession();
  const agg = aggregateDispatches((await readDispatches(dir)).items);
  assert.deepEqual(agg.items.filter((i) => i.workflowRunId).map((i) => [i.agentId, i.tier]), [['w1', 'fast'], ['w2', 'standard'], ['w3', 'capable']]);
});

test('AC2.2: a workflow description "lens 3b A" yields the role lens reviewer', async () => {
  const { dir } = fiveAgentSession();
  const agg = aggregateDispatches((await readDispatches(dir)).items);
  assert.equal(agg.items.find((i) => i.agentId === 'w1').role, 'lens reviewer');
});

test('AC3.1: a symlinked workflows/ directory is not read and is named', async () => {
  const dir = tmpSessionSubagents();
  writeAgent(dir, 'd1', '2026-11-16T10:00:00.000Z', { description: 'Implement Task 1' });
  const outside = tmpSubagents();
  writeAgent(path.join(outside, 'r1'), 'x1', '2026-11-16T10:01:00.000Z', { description: 'leaked' });
  fs.symlinkSync(outside, path.join(dir, 'workflows'));
  const r = await readDispatches(dir);
  assert.deepEqual(r.dirNotes, [`workflows/ directory is a symlink (not followed) at ${path.join(dir, 'workflows')}`]);
  assert.deepEqual(r.items.map((i) => i.agentId), ['d1']);
});

test('AC3.2: a symlinked run directory is not read and is named', async () => {
  const dir = tmpSessionSubagents();
  const outside = tmpSubagents();
  writeAgent(outside, 'x1', '2026-11-16T10:01:00.000Z', { description: 'leaked' });
  fs.mkdirSync(path.join(dir, 'workflows'));
  const runPath = path.join(dir, 'workflows', 'r1');
  fs.symlinkSync(outside, runPath);
  const r = await readDispatches(dir);
  assert.deepEqual(r.dirNotes, [`workflow run directory is a symlink (not followed) at ${runPath}`]);
  assert.deepEqual(r.items, []);
});

test('AC3.3: a symlinked agent file inside a run directory is not read and is named', async () => {
  const dir = tmpSessionSubagents();
  const outside = tmpSubagents();
  fs.writeFileSync(path.join(outside, 'secret.jsonl'), aLine('assistant', '2026-11-16T10:00:00.000Z', 'ms', 'claude-opus-5-5', [9, 9, 9, 9]) + '\n');
  const run = path.join(dir, 'workflows', 'r1');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'agent-l1.meta.json'), JSON.stringify({ description: 'lens 1', workflowPhase: 'review' }));
  fs.symlinkSync(path.join(outside, 'secret.jsonl'), path.join(run, 'agent-l1.jsonl'));
  const r = await readDispatches(dir);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].notFound, 'transcript not readable (symlink)');
  assert.equal(r.items[0].tokens, null);
  assert.equal(r.items[0].workflowRunId, 'r1');
});

test('AC6.1: a run directory with no agent file gives one dirNotes string', async () => {
  const dir = tmpSessionSubagents();
  writeAgent(dir, 'd1', '2026-11-16T10:00:00.000Z', { description: 'Implement Task 1' });
  const runPath = path.join(dir, 'workflows', 'r1');
  fs.mkdirSync(runPath, { recursive: true });
  const r = await readDispatches(dir);
  assert.deepEqual(r.dirNotes, [`no agent-* transcripts in ${runPath}`]);
  assert.equal(r.items.length, 1);
  assert.equal(r.notFound, null);
});

test('AC6.2: an unreadable meta.json in a run directory gives an item with a meta not readable note', async () => {
  const dir = tmpSessionSubagents();
  const run = path.join(dir, 'workflows', 'r1');
  writeAgent(run, 'p1', '2026-11-16T10:00:00.000Z', { description: 'lens 1', workflowPhase: 'review' });
  const metaPath = path.join(run, 'agent-p1.meta.json');
  const fsImpl = { ...fs, readFileSync: (p, ...a) => { if (String(p) === metaPath) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return fs.readFileSync(p, ...a); } };
  const r = await readDispatches(dir, { fsImpl });
  assert.equal(r.items.length, 1);
  assert.match(r.items[0].notFound, /^meta not readable \(EACCES\)/);
  assert.equal(r.items[0].workflowPhase, null);
  assert.equal(r.items[0].workflowRunId, 'r1');
});

test('Deliverable 2: a workflow agent with no meta file is still an item — run id from the directory, workflowPhase null, "meta not found" note', async () => {
  const dir = tmpSessionSubagents();
  const run = path.join(dir, 'workflows', 'r1');
  writeAgent(run, 'm1', '2026-11-16T10:00:00.000Z');
  const r = await readDispatches(dir);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].workflowRunId, 'r1');
  assert.equal(r.items[0].workflowPhase, null);
  assert.equal(r.items[0].notFound, 'meta not found');
  assert.ok(r.items[0].tokens);
});

test('AC9: a workflow agent whose transcript has rows but no timestamped row is an item with its note and no start', async () => {
  const dir = tmpSessionSubagents();
  const run = path.join(dir, 'workflows', 'r1');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'agent-u1.meta.json'), JSON.stringify({ description: 'lens 1', workflowPhase: 'review' }));
  fs.writeFileSync(path.join(run, 'agent-u1.jsonl'), aLine('assistant', undefined, 'm-u1', 'claude-sonnet-5-5', [1, 1, 1, 1]) + '\n');
  const r = await readDispatches(dir);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].notFound, 'transcript has no usage rows');
  assert.equal(r.items[0].startTs, null);
  assert.equal(r.items[0].tokens, null);
});

test('AC6.3: a file in a run directory that is not an agent file gives no item and no exception', async () => {
  const dir = tmpSessionSubagents();
  const run = path.join(dir, 'workflows', 'r1');
  writeAgent(run, 'a1', '2026-11-16T10:00:00.000Z', { description: 'lens 1' });
  fs.writeFileSync(path.join(run, 'journal.jsonl'), '{}\n');
  const r = await readDispatches(dir);
  assert.deepEqual(r.items.map((i) => i.agentId), ['a1']);
  assert.deepEqual(r.dirNotes, []);
});

test('AC10.1: a subagents/ directory holding only workflows/{runId}/ with two agents returns two items and notFound null', async () => {
  const dir = tmpSessionSubagents();
  const run = path.join(dir, 'workflows', 'r1');
  writeAgent(run, 'a1', '2026-11-16T10:00:00.000Z', { description: 'lens 1' });
  writeAgent(run, 'a2', '2026-11-16T10:01:00.000Z', { description: 'lens 2' });
  const r = await readDispatches(dir);
  assert.equal(r.items.length, 2);
  assert.equal(r.notFound, null);
  assert.deepEqual(r.dirNotes, []);
});

test('AC11.1: a run file whose agentCount is 3 beside a run directory with two agents gives one dirNotes string naming 3 and 2', async () => {
  const dir = tmpSessionSubagents();
  const run = path.join(dir, 'workflows', 'r1');
  writeAgent(run, 'a1', '2026-11-16T10:00:00.000Z', { description: 'lens 1' });
  writeAgent(run, 'a2', '2026-11-16T10:01:00.000Z', { description: 'lens 2' });
  const runFileDir = path.join(path.dirname(dir), 'workflows');
  fs.mkdirSync(runFileDir, { recursive: true });
  fs.writeFileSync(path.join(runFileDir, 'r1.json'), JSON.stringify({ agentCount: 3 }));
  const r = await readDispatches(dir);
  assert.equal(r.dirNotes.length, 1);
  assert.match(r.dirNotes[0], /\b3\b/);
  assert.match(r.dirNotes[0], /\b2\b/);
  assert.equal(r.items.length, 2);
});

test('AC11.2: with no run file there is no such note', async () => {
  const dir = tmpSessionSubagents();
  const run = path.join(dir, 'workflows', 'r1');
  writeAgent(run, 'a1', '2026-11-16T10:00:00.000Z', { description: 'lens 1' });
  writeAgent(run, 'a2', '2026-11-16T10:01:00.000Z', { description: 'lens 2' });
  const r = await readDispatches(dir);
  assert.deepEqual(r.dirNotes, []);
});

test('AC12.1: subagentsDirFor maps a workflow agent transcript to the session subagents/ dir', () => {
  assert.equal(subagentsDirFor(path.join('/h', 'p', 'sess-1', 'subagents', 'workflows', 'r1', 'agent-a.jsonl')), path.join('/h', 'p', 'sess-1', 'subagents'));
});

test('AC12.2: its result for a main transcript is unchanged', () => {
  assert.equal(subagentsDirFor(path.join('/h', 'p', 'sess-1.jsonl')), path.join('/h', 'p', 'sess-1', 'subagents'));
});

test('#5597 review focus 1: workflows/ that is a plain file is ignored', async () => {
  const dir = tmpSessionSubagents();
  writeAgent(dir, 'd1', '2026-11-16T10:00:00.000Z', { description: 'Implement Task 1' });
  fs.writeFileSync(path.join(dir, 'workflows'), 'x');
  const r = await readDispatches(dir);
  assert.deepEqual(r.items.map((i) => i.agentId), ['d1']);
  assert.deepEqual(r.dirNotes, []);
});

test('#5597 review focus 2: a plain file directly inside workflows/ is ignored', async () => {
  const dir = tmpSessionSubagents();
  writeAgent(dir, 'd1', '2026-11-16T10:00:00.000Z', { description: 'Implement Task 1' });
  fs.mkdirSync(path.join(dir, 'workflows'));
  fs.writeFileSync(path.join(dir, 'workflows', 'agent-z.jsonl'), aLine('assistant', '2026-11-16T10:00:00.000Z', 'mz', 'claude-opus-5-5', [9, 9, 9, 9]) + '\n');
  const r = await readDispatches(dir);
  assert.deepEqual(r.items.map((i) => i.agentId), ['d1']);
  assert.deepEqual(r.dirNotes, []);
});

test('#5597: window clipping applies to workflow run directories', async () => {
  const { dir } = fiveAgentSession();
  const window = { start: Date.parse('2026-11-16T09:00:00.000Z'), end: Date.parse('2026-11-16T10:03:30.000Z') };
  const r = await readDispatches(dir, { window });
  assert.deepEqual(r.items.map((i) => i.agentId), ['d1', 'd2', 'w1', 'w2']);
  assert.equal(r.excludedOutsideWindow, 1);
});

function useLine(id, name) {
  return JSON.stringify({ type: 'assistant', timestamp: '2026-11-16T10:00:00.000Z', message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input: { prompt: 'x' } }], usage: {} } });
}

test('agentCalls counts Agent and Task results and not Workflow', async () => {
  const f = path.join(scratchDir('ct-agentcalls-'), 's.jsonl');
  const results = ['a', 't', 'w'].map((id) => ({ type: 'tool_result', tool_use_id: id, content: 'ok' }));
  fs.writeFileSync(f, [
    useLine('a', 'Agent'), useLine('t', 'Task'), useLine('w', 'Workflow'),
    JSON.stringify({ type: 'user', timestamp: '2026-11-16T10:00:05.000Z', message: { role: 'user', content: results } }),
  ].join('\n') + '\n');
  const rows = await readUsage(f);
  const user = rows.find((r) => r.role === 'user');
  assert.equal(user.agentCalls, 2);
  assert.equal(user.turnClasses.dispatch, 3);
  assert.ok(rows.filter((r) => r.role === 'assistant').every((r) => !('agentCalls' in r)));
});

test('#5597 review focus 5: guard-refused Agent call adds no agentCalls', async () => {
  const f = path.join(scratchDir('ct-agentcalls-'), 's.jsonl');
  fs.writeFileSync(f, [
    useLine('a', 'Agent'),
    JSON.stringify({ type: 'user', timestamp: '2026-11-16T10:00:05.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'This session is isolated in the worktree /repo', is_error: true }] } }),
  ].join('\n') + '\n');
  const rows = await readUsage(f);
  const user = rows.find((r) => r.role === 'user');
  assert.deepEqual(user.turnClasses, { 'guard-refusal': 1 });
  assert.equal(user.agentCalls, 0);
});

// A session with one direct agent and workflows/r1/ holding one agent; each
// fault test below breaks exactly one fs call on one path.
function faultSession() {
  const dir = tmpSessionSubagents();
  writeAgent(dir, 'd1', '2026-11-16T10:00:00.000Z', { description: 'Implement Task 1' });
  const runPath = path.join(dir, 'workflows', 'r1');
  writeAgent(runPath, 'w1', '2026-11-16T10:01:00.000Z', { description: 'lens 1' });
  return { dir, wfDir: path.join(dir, 'workflows'), runPath };
}
const failOn = (method, target, code) => ({ ...fs, [method]: (p, ...a) => { if (String(p) === target) throw Object.assign(new Error(code), { code }); return fs[method](p, ...a); } });

test('#5597: a workflows/ directory lstat cannot read is named and the direct items are still returned', async () => {
  const { dir, wfDir } = faultSession();
  const r = await readDispatches(dir, { fsImpl: failOn('lstatSync', wfDir, 'EIO') });
  assert.deepEqual(r.dirNotes, [`workflows/ directory not readable (EIO) at ${wfDir}`]);
  assert.deepEqual(r.items.map((i) => i.agentId), ['d1']);
});

test('#5597: a workflows/ directory that cannot be listed is named and the direct items are still returned', async () => {
  const { dir, wfDir } = faultSession();
  const r = await readDispatches(dir, { fsImpl: failOn('readdirSync', wfDir, 'EACCES') });
  assert.deepEqual(r.dirNotes, [`workflows/ directory not readable (EACCES) at ${wfDir}`]);
  assert.deepEqual(r.items.map((i) => i.agentId), ['d1']);
});

test('#5597: a run directory lstat cannot read is named and the direct items are still returned', async () => {
  const { dir, runPath } = faultSession();
  const r = await readDispatches(dir, { fsImpl: failOn('lstatSync', runPath, 'EIO') });
  assert.deepEqual(r.dirNotes, [`workflow run directory not readable (EIO) at ${runPath}`]);
  assert.deepEqual(r.items.map((i) => i.agentId), ['d1']);
});

test('#5597: a run directory that cannot be listed is named and the direct items are still returned', async () => {
  const { dir, runPath } = faultSession();
  const r = await readDispatches(dir, { fsImpl: failOn('readdirSync', runPath, 'EACCES') });
  assert.deepEqual(r.dirNotes, [`workflow run directory not readable (EACCES) at ${runPath}`]);
  assert.deepEqual(r.items.map((i) => i.agentId), ['d1']);
});

test('#5597: a workflows/ directory lstat reports missing is named with ENOENT and the direct items are still returned', async () => {
  const { dir, wfDir } = faultSession();
  const r = await readDispatches(dir, { fsImpl: failOn('lstatSync', wfDir, 'ENOENT') });
  assert.deepEqual(r.dirNotes, [`workflows/ directory not readable (ENOENT) at ${wfDir}`]);
  assert.deepEqual(r.items.map((i) => i.agentId), ['d1']);
});

test('#5597: a run directory lstat reports missing is named with ENOENT and the direct items are still returned', async () => {
  const { dir, runPath } = faultSession();
  const r = await readDispatches(dir, { fsImpl: failOn('lstatSync', runPath, 'ENOENT') });
  assert.deepEqual(r.dirNotes, [`workflow run directory not readable (ENOENT) at ${runPath}`]);
  assert.deepEqual(r.items.map((i) => i.agentId), ['d1']);
});

test('#5597: an empty run directory beside a run file with agentCount 2 gives only the empty-directory note', async () => {
  const dir = tmpSessionSubagents();
  const run = path.join(dir, 'workflows', 'r1');
  fs.mkdirSync(run, { recursive: true });
  const runFileDir = path.join(path.dirname(dir), 'workflows');
  fs.mkdirSync(runFileDir, { recursive: true });
  fs.writeFileSync(path.join(runFileDir, 'r1.json'), JSON.stringify({ agentCount: 2 }));
  const r = await readDispatches(dir);
  assert.deepEqual(r.dirNotes, [`no agent-* transcripts in ${run}`]);
});

test('#5597: a run file whose agentCount equals the agents found adds no note', async () => {
  const { dir } = faultSession();
  const runFileDir = path.join(path.dirname(dir), 'workflows');
  fs.mkdirSync(runFileDir, { recursive: true });
  fs.writeFileSync(path.join(runFileDir, 'r1.json'), JSON.stringify({ agentCount: 1 }));
  const r = await readDispatches(dir);
  assert.deepEqual(r.dirNotes, []);
  assert.equal(r.items.length, 2);
});

test('#5597: a symlinked run file is not read, so its mismatching agentCount adds no note', async () => {
  const { dir } = faultSession();
  const outside = tmpSubagents();
  fs.writeFileSync(path.join(outside, 'r1.json'), JSON.stringify({ agentCount: 3 }));
  const runFileDir = path.join(path.dirname(dir), 'workflows');
  fs.mkdirSync(runFileDir, { recursive: true });
  fs.symlinkSync(path.join(outside, 'r1.json'), path.join(runFileDir, 'r1.json'));
  const r = await readDispatches(dir);
  assert.deepEqual(r.dirNotes, []);
  assert.equal(r.items.length, 2);
});

// #5556: AskUserQuestion ask/answer times. Shape observed 2026-10-24 in a real main-session
// transcript: assistant tool_use { id, name: 'AskUserQuestion', input: { questions: [{ question, header, multiSelect, options }] } },
// answered by a later user row's tool_result { tool_use_id, content: '<string>' }.
function askTranscript(lines) {
  const dir = scratchDir('ct-ask-');
  const file = path.join(dir, 's.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { dir, file };
}
const askRow = (id, ts, questions) => ({ timestamp: ts, message: { role: 'assistant', id: 'm-' + id, content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } }], usage: {} } });
const resultRow = (id, ts) => ({ timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Your questions have been answered.' }] } });

test('#5556: readUsage carries asks on the AskUserQuestion row and answers on its tool_result row, and no key elsewhere', async () => {
  const { dir, file } = askTranscript([
    { timestamp: '2026-11-16T07:59:00.000Z', message: { role: 'assistant', id: 'm0', content: [{ type: 'text', text: 'hi' }], usage: {} } },
    askRow('toolu_q1', '2026-11-16T08:00:00.000Z', [{ question: 'Pick?', header: 'H', multiSelect: false, options: [] }]),
    resultRow('toolu_q1', '2026-11-16T08:03:30.000Z'),
    { timestamp: '2026-11-16T08:04:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_other', content: 'x' }] } },
  ]);
  try {
    const rows = await readUsage(file);
    assert.deepEqual(rows[1].asks, [{ id: 'toolu_q1', ts: '2026-11-16T08:00:00.000Z', questions: ['Pick?'] }]);
    assert.deepEqual(rows[2].answers, [{ id: 'toolu_q1', ts: '2026-11-16T08:03:30.000Z' }]);
    for (const i of [0, 3]) { assert.equal('asks' in rows[i], false); assert.equal('answers' in rows[i], false); }
    assert.equal('answers' in rows[1], false);
    assert.equal('asks' in rows[2], false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#5556: an AskUserQuestion block with no input.questions gives questions [] and never throws', async () => {
  const { dir, file } = askTranscript([
    { timestamp: '2026-11-16T08:00:00.000Z', message: { role: 'assistant', id: 'm1', content: [{ type: 'tool_use', id: 'toolu_q2', name: 'AskUserQuestion' }], usage: {} } },
  ]);
  try {
    const rows = await readUsage(file);
    assert.deepEqual(rows[0].asks, [{ id: 'toolu_q2', ts: '2026-11-16T08:00:00.000Z', questions: [] }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#5967: mergeUsage keeps the max of each field across lines of one message.id', () => {
  let m = mergeUsage(null, { input_tokens: 3, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 });
  m = mergeUsage(m, { output_tokens: 40 });
  m = mergeUsage(m, { output_tokens: 900, input_tokens: 1 });
  assert.deepEqual(m, { input: 3, output: 900, cacheRead: 1000, cacheCreate: 0, cacheWrite1h: 0, cacheWrite5m: 0 });
});
test('#5967 RF1: the largest write with no cache_creation object is all 5-minute', () => {
  assert.deepEqual(mergeUsage(null, { cache_creation_input_tokens: 500 }), { input: 0, output: 0, cacheRead: 0, cacheCreate: 500, cacheWrite1h: 0, cacheWrite5m: 500 });
});
test('#5967 RF2: the 1-hour split is read from the largest-write line only', () => {
  let m = mergeUsage(null, { cache_creation_input_tokens: 800, cache_creation: { ephemeral_1h_input_tokens: 300 } });
  m = mergeUsage(m, { cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 100 } });
  assert.equal(m.cacheWrite1h, 300);
  assert.equal(m.cacheWrite5m, 500);
});
test('#5967 RF3: a 1-hour figure above the write is clamped to the write', () => {
  const m = mergeUsage(null, { cache_creation_input_tokens: 50, cache_creation: { ephemeral_1h_input_tokens: 90 } });
  assert.equal(m.cacheWrite1h, 50);
  assert.equal(m.cacheWrite5m, 0);
});
test('#5967 RF5: absent or non-number usage is all zeros and prev is not mutated', () => {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cacheWrite1h: 0, cacheWrite5m: 0 };
  assert.deepEqual(mergeUsage(null, undefined), zero);
  assert.deepEqual(mergeUsage(null, { output_tokens: null }), zero);
  const prev = { ...zero, output: 7 };
  mergeUsage(prev, { output_tokens: 9 });
  assert.equal(prev.output, 7);
});
test('#5967: readUsage lands the max of every field on the first row of an id when later lines grow them', async () => {
  const dir = tmpSubagents();
  const f = path.join(dir, 'agent-5967.jsonl');
  fs.writeFileSync(f, [
    snapLine('2026-10-17T10:00:05.000Z', 'mg1', null, [1, 2, 3, 4], 'thinking'),
    snapLine('2026-10-17T10:00:09.000Z', 'mg1', 'end_turn', [10, 20, 30, 40], 'text'),
  ].join('\n') + '\n');
  const rows = await readUsage(f);
  assert.deepEqual(rows.map((r) => [r.inputTokens, r.outputTokens, r.cacheRead, r.cacheCreate]), [[10, 20, 30, 40], [0, 0, 0, 0]]);
});
test('#5967: mergeUsage keeps the first largest-write line\'s 1-hour split when a later write ties it', () => {
  let m = mergeUsage(null, { cache_creation_input_tokens: 800, cache_creation: { ephemeral_1h_input_tokens: 300 } });
  m = mergeUsage(m, { cache_creation_input_tokens: 800, cache_creation: { ephemeral_1h_input_tokens: 700 } });
  assert.equal(m.cacheWrite1h, 300);
  assert.equal(m.cacheWrite5m, 500);
});

// ---- #5647: locateTaskTranscripts — a session's depth-1 Task-call agents naming one run ----

const RUN = '2026-11-16T100000-record-1';
const OTHER_RUN = '2026-11-16T100000-record-2';
const named = (id) => '/m/.claude-tweaks/pipelines/' + id;

// agents: [{ id, depth, prompt, meta }]; meta null omits the file, a string writes it raw.
function taskSession(cfg, slug, sid, agents) {
  const slugDir = path.join(cfg, 'projects', slug);
  const subDir = path.join(slugDir, sid, 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, `${sid}.jsonl`), aLine('assistant', '2026-11-16T10:00:00.000Z', 'main', 'claude-opus-5-5', [1, 1, 1, 1]) + '\n');
  for (const a of agents) {
    const meta = a.meta === undefined ? { spawnDepth: a.depth, description: a.id } : a.meta;
    if (meta !== null) fs.writeFileSync(path.join(subDir, `agent-${a.id}.meta.json`), typeof meta === 'string' ? meta : JSON.stringify(meta));
    const first = a.rawFirst !== undefined ? a.rawFirst : JSON.stringify({ type: 'user', message: { role: 'user', content: a.prompt } });
    fs.writeFileSync(path.join(subDir, `agent-${a.id}.jsonl`), first + '\n' + aLine('assistant', '2026-11-16T10:00:01.000Z', `m-${a.id}`, 'claude-sonnet-5', [1, 1, 1, 1]) + '\n');
  }
  return subDir;
}
const taskCfg = () => scratchDir('ct-task-cfg-');
const tpaths = (subDir, ...ids) => ids.map((i) => fs.realpathSync(path.join(subDir, `agent-${i}.jsonl`)));
const locate = (cfg, sessionIds, runId = RUN) => locateTaskTranscripts({ sessionIds, runId, configDir: cfg });

test('locateTaskTranscripts: attributes a depth-1 agent whose prompt names exactly this run', () => {
  const cfg = taskCfg();
  const sub = taskSession(cfg, '-slug-a', 's1', [{ id: 't1', depth: 1, prompt: 'Run build in ' + named(RUN) }]);
  const r = locate(cfg, ['s1']);
  assert.deepEqual(r.paths, tpaths(sub, 't1'));
  assert.deepEqual(r.notes, []);
});

test('locateTaskTranscripts: depth-2 agent naming the run is excluded', () => {
  // spawnDepth guard: goes red on the depth-2 agent if `meta.spawnDepth !== 1` is deleted.
  const cfg = taskCfg();
  const sub = taskSession(cfg, '-slug-a', 's1', [
    { id: 't1', depth: 1, prompt: named(RUN) },
    { id: 't2', depth: 2, prompt: named(RUN) },
  ]);
  assert.deepEqual(locate(cfg, ['s1']).paths, tpaths(sub, 't1'));
});

test('locateTaskTranscripts: meta without spawnDepth, malformed meta, missing meta: each excluded', () => {
  // meta guard: goes red here if the `!meta` / spawnDepth check is deleted.
  const cfg = taskCfg();
  const sub = taskSession(cfg, '-slug-a', 's1', [
    { id: 'ok', depth: 1, prompt: named(RUN) },
    { id: 'nodepth', meta: { description: 'x' }, prompt: named(RUN) },
    { id: 'bad', meta: '{not json', prompt: named(RUN) },
    { id: 'none', meta: null, prompt: named(RUN) },
  ]);
  assert.deepEqual(locate(cfg, ['s1']).paths, tpaths(sub, 'ok'));
});

test('locateTaskTranscripts: prompt naming this run and another run is excluded', () => {
  // exactly-one guard: goes red if `ids.length !== 1` is relaxed to `includes(runId)`.
  const cfg = taskCfg();
  const sub = taskSession(cfg, '-slug-a', 's1', [
    { id: 'ok', depth: 1, prompt: named(RUN) },
    { id: 'both', depth: 1, prompt: named(RUN) + ' retry of ' + named(OTHER_RUN) },
  ]);
  assert.deepEqual(locate(cfg, ['s1']).paths, tpaths(sub, 'ok'));
});

test('locateTaskTranscripts: prompt naming only another run is excluded', () => {
  // equality guard: goes red if `ids[0] !== runId` is deleted.
  const cfg = taskCfg();
  taskSession(cfg, '-slug-a', 's1', [{ id: 'o', depth: 1, prompt: named(OTHER_RUN) }]);
  assert.deepEqual(locate(cfg, ['s1']).paths, []);
});

test('locateTaskTranscripts: first line not a user entry, or unparseable: excluded', () => {
  // type guard: goes red on `asst` if `entry.type !== 'user'` is deleted.
  const cfg = taskCfg();
  const sub = taskSession(cfg, '-slug-a', 's1', [
    { id: 'ok', depth: 1, prompt: named(RUN) },
    { id: 'asst', depth: 1, rawFirst: JSON.stringify({ type: 'assistant', message: { content: named(RUN) } }) },
    { id: 'junk', depth: 1, rawFirst: 'not json ' + named(RUN) },
  ]);
  assert.deepEqual(locate(cfg, ['s1']).paths, tpaths(sub, 'ok'));
});

test('locateTaskTranscripts: first line over FIRST_ENTRY_CAP: excluded, no throw', () => {
  // cap guard: goes red if the `total > FIRST_ENTRY_CAP` return is deleted.
  const cfg = taskCfg();
  const pad = 'x'.repeat(FIRST_ENTRY_CAP + 10);
  const sub = taskSession(cfg, '-slug-a', 's1', [
    { id: 'ok', depth: 1, prompt: named(RUN) },
    { id: 'big', depth: 1, prompt: named(RUN) + ' ' + pad },
  ]);
  assert.equal(FIRST_ENTRY_CAP, 1048576);
  assert.deepEqual(locate(cfg, ['s1']).paths, tpaths(sub, 'ok'));
});

test('locateTaskTranscripts: a first line past one 64 KiB read chunk is joined whole and attributed', () => {
  // multi-chunk guard (readFirstLine's chunk join): a join that keeps only the first chunk, or drops a chunk's tail, loses the run id.
  // `straddle` puts the run path across the 65536-byte chunk boundary; `far` puts it three chunks in.
  const cfg = taskCfg();
  const sub = taskSession(cfg, '-slug-a', 's1', [
    { id: 'straddle', depth: 1, prompt: 'x'.repeat(65536 - 80) + ' ' + named(RUN) },
    { id: 'far', depth: 1, prompt: 'y'.repeat(3 * 65536 + 100) + ' ' + named(RUN) },
  ]);
  assert.ok(fs.readFileSync(path.join(sub, 'agent-far.jsonl'), 'utf8').split('\n')[0].length < FIRST_ENTRY_CAP);
  assert.deepEqual(locate(cfg, ['s1']).paths, tpaths(sub, 'far', 'straddle'));
});

test('locateTaskTranscripts: Windows-separator run dir in the prompt is attributed', () => {
  const cfg = taskCfg();
  const sub = taskSession(cfg, '-slug-a', 's1', [{ id: 'w', depth: 1, prompt: 'C:\\r\\.claude-tweaks\\pipelines\\' + RUN }]);
  assert.match(fs.readFileSync(path.join(sub, 'agent-w.jsonl'), 'utf8').split('\n')[0], /pipelines\\\\2026/); // JSON text carries a doubled backslash
  assert.deepEqual(locate(cfg, ['s1']).paths, tpaths(sub, 'w'));
});

test('locateTaskTranscripts: symlinked agent file is not followed', { skip: process.platform === 'win32' }, () => {
  // file lstat guard: goes red if the `type !== 'file'` check on the agent file is deleted.
  const cfg = taskCfg();
  const sub = taskSession(cfg, '-slug-a', 's1', [{ id: 'ok', depth: 1, prompt: named(RUN) }, { id: 'real', depth: 1, prompt: named(RUN) }]);
  fs.rmSync(path.join(sub, 'agent-real.jsonl'));
  const outside = path.join(cfg, 'outside.jsonl');
  fs.writeFileSync(outside, JSON.stringify({ type: 'user', message: { content: named(RUN) } }) + '\n');
  fs.symlinkSync(outside, path.join(sub, 'agent-real.jsonl'));
  assert.deepEqual(locate(cfg, ['s1']).paths, tpaths(sub, 'ok'));
});

test('locateTaskTranscripts: symlinked meta file is not followed', { skip: process.platform === 'win32' }, () => {
  // meta lstat guard: goes red if the `type !== 'file'` check on the meta file is deleted.
  const cfg = taskCfg();
  const sub = taskSession(cfg, '-slug-a', 's1', [{ id: 'ok', depth: 1, prompt: named(RUN) }, { id: 'x', depth: 1, prompt: named(RUN), meta: null }]);
  const outside = path.join(cfg, 'outside.meta.json');
  fs.writeFileSync(outside, JSON.stringify({ spawnDepth: 1 }));
  fs.symlinkSync(outside, path.join(sub, 'agent-x.meta.json'));
  assert.deepEqual(locate(cfg, ['s1']).paths, tpaths(sub, 'ok'));
});

test('locateTaskTranscripts: symlinked subagents/ directory is not followed', { skip: process.platform === 'win32' }, () => {
  // dir lstat guard: goes red if the `dirType === 'symlink'` branch is deleted.
  const cfg = taskCfg();
  const sub = taskSession(cfg, '-slug-a', 's1', [{ id: 'a', depth: 1, prompt: named(RUN) }]);
  const realSub = path.join(path.dirname(sub), 'real-subagents');
  fs.renameSync(sub, realSub);
  fs.symlinkSync(realSub, sub);
  const r = locate(cfg, ['s1']);
  assert.deepEqual(r.paths, []);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /symlink/);
});

test('locateTaskTranscripts: symlinked session directory is not followed', { skip: process.platform === 'win32' }, () => {
  // session-dir lstat guard: goes red if the `{sid}/` lstat check is deleted.
  const cfg = taskCfg();
  const sub = taskSession(cfg, '-slug-a', 's1', [{ id: 'a', depth: 1, prompt: named(RUN) }]);
  const sessDir = path.dirname(sub);
  const moved = path.join(cfg, 'elsewhere');
  fs.renameSync(sessDir, moved);
  fs.symlinkSync(moved, sessDir);
  const r = locate(cfg, ['s1']);
  assert.deepEqual(r.paths, []);
  assert.equal(r.notes.length, 1);
});

test('locateTaskTranscripts: two session ids each contribute; paths sorted and deduped', () => {
  const cfg = taskCfg();
  const subB = taskSession(cfg, '-slug-a', 'sB', [{ id: 'b1', depth: 1, prompt: named(RUN) }]);
  const subA = taskSession(cfg, '-slug-a', 'sA', [{ id: 'a1', depth: 1, prompt: named(RUN) }]);
  const r = locate(cfg, ['sB', 'sA', 'sB']);
  assert.deepEqual(r.paths, [...tpaths(subA, 'a1'), ...tpaths(subB, 'b1')].sort());
  assert.equal(r.paths.length, 2);
});

test('locateTaskTranscripts: one session id under two slugs: both subagents/ dirs are scanned', () => {
  const cfg = taskCfg();
  const s1 = taskSession(cfg, '-slug-a', 's1', [{ id: 'a1', depth: 1, prompt: named(RUN) }]);
  const s2 = taskSession(cfg, '-slug-b', 's1', [{ id: 'b1', depth: 1, prompt: named(RUN) }]);
  assert.deepEqual(locate(cfg, ['s1']).paths, [...tpaths(s1, 'a1'), ...tpaths(s2, 'b1')].sort());
});

test("locateTaskTranscripts: an invalid session id ('../x') contributes nothing and no other slug is scanned", () => {
  const cfg = taskCfg();
  taskSession(cfg, '-slug-a', 'x', [{ id: 'a1', depth: 1, prompt: named(RUN) }]);
  const r = locate(cfg, ['../x']);
  assert.deepEqual(r.paths, []);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /invalid/);
});

test('locateTaskTranscripts: a session without a transcript or subagents/ directory yields one note and no throw', () => {
  const cfg = taskCfg();
  fs.mkdirSync(path.join(cfg, 'projects', '-slug-a'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'projects', '-slug-a', 'bare.jsonl'), '{}\n');
  const r = locate(cfg, ['missing', 'bare']);
  assert.deepEqual(r.paths, []);
  assert.equal(r.notes.length, 2);
  assert.deepEqual(locateTaskTranscripts({}), { paths: [], notes: [] });
});

test('locateTaskTranscripts: workflow agents under subagents/workflows/ are not candidates', () => {
  const cfg = taskCfg();
  const sub = taskSession(cfg, '-slug-a', 's1', [{ id: 'ok', depth: 1, prompt: named(RUN) }]);
  const wf = path.join(sub, 'workflows', 'wf1');
  fs.mkdirSync(wf, { recursive: true });
  fs.writeFileSync(path.join(wf, 'agent-w1.meta.json'), JSON.stringify({ spawnDepth: 1 }));
  fs.writeFileSync(path.join(wf, 'agent-w1.jsonl'), JSON.stringify({ type: 'user', message: { content: named(RUN) } }) + '\n');
  assert.deepEqual(locate(cfg, ['s1']).paths, tpaths(sub, 'ok'));
});

test('runIdsNamed returns distinct ids in order, both separators', () => {
  const text = `a /x/.claude-tweaks/pipelines/${OTHER_RUN}/ b C:\\\\r\\\\.claude-tweaks\\\\pipelines\\\\${RUN} c .claude-tweaks/pipelines/${OTHER_RUN}`;
  assert.deepEqual(runIdsNamed(text), [OTHER_RUN, RUN]);
  assert.deepEqual(runIdsNamed('no run here'), []);
});

test('RUN_ID_NAMED_RE captures the canonical run-id shape', () => {
  const { RUN_ID_SHAPE } = require('../../../plugin/bin/lib/issues/claim-store');
  const body = RUN_ID_SHAPE.source.replace(/^\^/, '').replace(/\$$/, '');
  assert.ok(RUN_ID_NAMED_RE.source.includes(`(${body})`), `RUN_ID_NAMED_RE (${RUN_ID_NAMED_RE.source}) no longer captures RUN_ID_SHAPE's body (${body})`);
});

// readWorkerDispatches (#6000 Task 4).
const { readWorkerDispatches, WORKER_DISPATCHES_FILE } = require('../../../plugin/bin/lib/timing/transcript');
const workerRec = (over = {}) => ({ kind: 'worker', launched: true, lens: '3a', side: 'A', description: 'lens 3a A', agentType: 'lens-reviewer', metaModel: 'haiku', startTs: '2026-11-23T12:10:00.000Z', endTs: '2026-11-23T12:11:00.000Z', wallClockMs: 60000, failed: false, reason: null, agentId: 's1', tokens: { input: 1, output: 2, cacheRead: 3, cacheCreate: 4 }, ...over });
function workerRunDir(lines) {
  const dir = scratchDir('ct-worker-disp-');
  if (lines !== null) fs.writeFileSync(path.join(dir, WORKER_DISPATCHES_FILE), lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return dir;
}

test('readWorkerDispatches: an absent file is no items and no note', () => {
  assert.deepEqual(readWorkerDispatches(workerRunDir(null)), { items: [], excludedOutsideWindow: 0, notes: [] });
});

test('readWorkerDispatches skips a malformed line into notes and keeps the rest', () => {
  const r = readWorkerDispatches(workerRunDir([workerRec(), '{not json', '[1]', workerRec({ side: 'B', agentId: 's2' })]));
  assert.deepEqual(r.items.map((i) => i.agentId), ['s1', 's2']);
  assert.equal(r.notes.length, 2);
  assert.match(r.notes[0], /line 2 is not a JSON object/);
  assert.match(r.notes[1], /line 3 is not a JSON object/);
});

test('readWorkerDispatches: launched: false lines are not dispatches and count nowhere', () => {
  const r = readWorkerDispatches(workerRunDir([workerRec(), { kind: 'worker', launched: false, lens: '3f', side: 'A', reason: 'excluded' }, { kind: 'worker', launched: false, lens: '3f', side: 'B', reason: 'excluded' }]), { window: { start: 0, end: Infinity } });
  assert.equal(r.items.length, 1);
  assert.equal(r.excludedOutsideWindow, 0);
  assert.deepEqual(r.notes, []);
});

test('readWorkerDispatches keeps an item only inside the window by startTs', () => {
  const dir = workerRunDir([workerRec(), workerRec({ agentId: 'early', startTs: '2026-11-23T11:00:00.000Z' }), workerRec({ agentId: 'nots', startTs: null })]);
  const window = { start: Date.parse('2026-11-23T12:00:00Z'), end: Date.parse('2026-11-23T13:00:00Z') };
  const r = readWorkerDispatches(dir, { window });
  assert.deepEqual(r.items.map((i) => i.agentId), ['s1']);
  assert.equal(r.excludedOutsideWindow, 2);
  assert.equal(readWorkerDispatches(dir).items.length, 3);
});

test('readWorkerDispatches: an item has the subagent keys it lacks defaulted, tokens null unless an object', () => {
  const [a, b] = readWorkerDispatches(workerRunDir([workerRec({ tokens: 'x' }), workerRec({ agentId: 's2' })])).items;
  assert.equal(a.tokens, null);
  assert.equal(a.transcriptPath, null);
  assert.equal(a.procedureFileRows, null);
  assert.deepEqual(b.tokens, { input: 1, output: 2, cacheRead: 3, cacheCreate: 4 });
});

test('readWorkerDispatches never throws: a directory in place of the file and a throwing fs are notes', () => {
  const dir = scratchDir('ct-worker-disp-');
  fs.mkdirSync(path.join(dir, WORKER_DISPATCHES_FILE));
  assert.match(readWorkerDispatches(dir).notes[0], /not a regular file/);
  const file = workerRunDir([workerRec()]);
  const fsImpl = { ...fs, lstatSync: fs.lstatSync, readFileSync: () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); } };
  const r = readWorkerDispatches(file, { fsImpl });
  assert.deepEqual(r.items, []);
  assert.match(r.notes[0], /not readable \(EACCES\)/);
});

test('readUsage rows carry messageId and the cache-write split', async () => {
  const dir = tmpSubagents();
  const f = path.join(dir, 'split.jsonl');
  const line = (ts, id, usage) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { ...(id ? { id } : {}), role: 'assistant', model: 'claude-sonnet-5-5', content: [], usage } });
  fs.writeFileSync(f, [
    line('2026-11-26T10:00:00.000Z', 'm1', { output_tokens: 5 }),
    line('2026-11-26T10:00:01.000Z', 'm1', { output_tokens: 9, cache_creation_input_tokens: 300, cache_creation: { ephemeral_1h_input_tokens: 100 } }),
    line('2026-11-26T10:00:02.000Z', null, { cache_creation_input_tokens: 70 }),
    JSON.stringify({ type: 'user', timestamp: '2026-11-26T10:00:03.000Z', message: { role: 'user', content: [] } }),
  ].join('\n') + '\n');
  const rows = await readUsage(f, {});
  assert.equal(rows[0].messageId, 'm1');
  assert.equal(rows[0].cacheCreate, 300);
  assert.equal(rows[0].cacheWrite1h, 100);
  assert.equal(rows[0].cacheWrite5m, 200);
  assert.equal(rows[1].messageId, 'm1');
  assert.deepEqual([rows[1].cacheCreate, rows[1].cacheWrite1h, rows[1].cacheWrite5m], [0, 0, 0]);
  assert.equal(rows[2].messageId, null);
  assert.equal(rows[2].cacheCreate, 70);
  assert.equal(rows[2].cacheWrite5m, rows[2].cacheCreate);
  assert.equal(rows[2].cacheWrite1h, 0);
  assert.equal(rows[3].messageId, null);
  assert.deepEqual([rows[3].cacheWrite1h, rows[3].cacheWrite5m], [0, 0]);
});

test('readDispatches items keep their kept rows internally', async () => {
  const dir = tmpSubagents();
  fs.writeFileSync(path.join(dir, 'agent-k1.jsonl'), [
    aLine('user', '2026-11-26T10:00:00.000Z', null, null, [0, 0, 0, 0]),
    aLine('assistant', '2026-11-26T10:00:10.000Z', 'k-1', 'claude-sonnet-5-5', [1, 2, 3, 4]),
    aLine('assistant', '2026-11-26T10:00:20.000Z', 'k-2', 'claude-sonnet-5-5', [1, 2, 3, 4]),
    aLine('assistant', '2026-11-26T11:00:00.000Z', 'k-3', 'claude-sonnet-5-5', [1, 2, 3, 4]),
  ].join('\n') + '\n');
  const all = await readDispatches(dir);
  assert.equal(all.items[0].usageRows.length, 4);
  const w = { start: Date.parse('2026-11-26T09:59:00.000Z'), end: Date.parse('2026-11-26T10:30:00.000Z') };
  const clipped = await readDispatches(dir, { window: w });
  assert.equal(clipped.items[0].usageRows.length, 3);
  assert.equal(clipped.items[0].usageRows.reduce((s, r) => s + r.inputTokens, 0), clipped.items[0].tokens.input);
});
