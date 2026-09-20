'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { slugForCwd, locateTranscripts, readUsage, isProcedurePath, TRANSCRIPT_SLUG_RULE } = require('../../../plugin/bin/lib/timing/transcript');

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
  assert.deepEqual(assistants[0], { ts: '2026-09-05T13:50:00.000Z', role: 'assistant', inputTokens: 10, outputTokens: 20, cacheRead: 300, cacheCreate: 40, toolRoundTrip: false, procedureBytes: 0 });
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
