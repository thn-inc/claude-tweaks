'use strict';
// tests/bin-lib/accept/reentry.test.js — bin/lib/accept/reentry.js (#4615) against real git: a
// bare origin, a clone with the PR branch pushed, and a fake gh answering `pr view`. Git runs
// hermetic (no system or global config, pinned author, pinned cwd) so a host's config cannot
// change an answer.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { reenter, reenterCheck, reenterRemove, sameCommit } = require('../../../plugin/bin/lib/accept/reentry');

const BRANCH = 'feat/accept-me';
const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function hermeticEnv(home) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  return {
    ...env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'xdg'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull,
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com',
    GIT_AUTHOR_DATE: '2026-11-16T10:00:00Z', GIT_COMMITTER_DATE: '2026-11-16T10:00:00Z',
  };
}

// The calls the module made, in order, beside a real runner.
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'accept-reentry-')));
  tempDirs.push(base);
  const env = hermeticEnv(base);
  const origin = path.join(base, 'origin.git');
  const clone = path.join(base, 'clone');
  const calls = [];
  const git = (args, cwd = clone) => {
    calls.push(args);
    return execFileSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  };
  const setup = (args, cwd = base) => execFileSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  setup(['init', '-q', '--bare', '-b', 'main', origin]);
  setup(['clone', '-q', '--end-of-options', origin, clone]);
  setup(['checkout', '-q', '-b', BRANCH], clone);
  fs.writeFileSync(path.join(clone, '.gitignore'), 'build/\n');
  fs.writeFileSync(path.join(clone, 'a.txt'), 'one\n');
  setup(['add', '--', '.gitignore', 'a.txt'], clone);
  setup(['commit', '-q', '-m', 'feature'], clone);
  setup(['push', '-q', 'origin', BRANCH], clone);
  const tip = setup(['rev-parse', 'HEAD'], clone).trim();
  setup(['checkout', '-q', '--detach'], clone);
  const ghCalls = [];
  const gh = (args) => {
    ghCalls.push(args);
    assert.deepEqual(args.slice(0, 2), ['pr', 'view']);
    return JSON.stringify({ headRefName: BRANCH, headRefOid: tip });
  };
  return { base, clone, tip, git, gh, calls, ghCalls, list: () => setup(['worktree', 'list', '--porcelain'], clone) };
}

const enter = (f, extra = {}) => reenter({ record: 42, pr: 7, repoRoot: f.clone, parkHead: f.tip, git: f.git, gh: f.gh, ...extra });

test('AC4.1: reenter fetches and adds the worktree from the PR branch', () => {
  const f = fixture();
  const res = enter(f);
  const expected = path.join(f.clone, '.claude', 'worktrees', 'accept-42');
  assert.equal(res.worktree, expected);
  assert.equal(res.headRefName, BRANCH);
  assert.equal(res.prHead, f.tip);
  assert.equal(res.head, f.tip);
  assert.equal(fs.readFileSync(path.join(expected, 'a.txt'), 'utf8'), 'one\n');
  assert.deepEqual(f.ghCalls, [['pr', 'view', '7', '--json', 'headRefName,headRefOid']]);
  assert.ok(f.list().includes(`worktree ${expected}`));
  // The ref and path operands are fenced from option parsing.
  assert.ok(f.calls.filter((a) => a.includes('fetch') || a.includes('worktree')).every((a) => a.includes('--end-of-options')));
});

test('AC4.2: before the verdict HEAD is unchanged and no tracked file changed', () => {
  const f = fixture();
  const { worktree, head } = enter(f);
  assert.deepEqual(reenterCheck({ worktree, expectHead: head, git: f.git }), { ok: true, head: f.tip, dirty: [] });

  fs.mkdirSync(path.join(worktree, 'build'));
  fs.writeFileSync(path.join(worktree, 'build', 'out.js'), 'artifact\n');
  fs.writeFileSync(path.join(worktree, 'untracked.txt'), 'x\n');
  assert.equal(reenterCheck({ worktree, expectHead: head, git: f.git }).ok, true, 'ignored and untracked files do not count');

  fs.writeFileSync(path.join(worktree, 'a.txt'), 'edited\n');
  const dirty = reenterCheck({ worktree, expectHead: head, git: f.git });
  assert.equal(dirty.ok, false);
  assert.deepEqual(dirty.dirty, ['a.txt']);
});

test('AC4.2: a HEAD that is not the expected commit is not ok even with a clean tree', () => {
  const f = fixture();
  const { worktree } = enter(f);
  const res = reenterCheck({ worktree, expectHead: 'deadbee', git: f.git });
  assert.equal(res.ok, false);
  assert.deepEqual(res.dirty, []);
  assert.equal(res.head, f.tip);
});

test('AC4.3: the worktree is removed after the verdict', () => {
  const f = fixture();
  const { worktree } = enter(f);
  fs.mkdirSync(path.join(worktree, 'build'));
  fs.writeFileSync(path.join(worktree, 'build', 'out.js'), 'artifact\n');
  assert.deepEqual(reenterRemove({ worktree, repoRoot: f.clone, git: f.git }), { removed: true });
  assert.ok(!f.list().includes('accept-42'));
  assert.equal(fs.existsSync(worktree), false);
  assert.deepEqual(reenterRemove({ worktree, repoRoot: f.clone, git: f.git }), { removed: false }, 'a second removal finds nothing');
});

test('AC4.4: a moved PR head withholds Accept and merge', () => {
  const f = fixture();
  assert.equal(enter(f, { parkHead: 'aaaaaaa' }).moved, true);
  const g = fixture();
  assert.equal(enter(g, { parkHead: g.tip }).moved, false);
  const h = fixture();
  assert.equal(enter(h, { parkHead: h.tip.slice(0, 7) }).moved, false, 'an abbreviated park head naming the same commit is not moved');
  const i = fixture();
  assert.equal(enter(i, { parkHead: null }).moved, true, 'a missing park head counts as moved');
});

test('a stale accept directory is refused, never reused', () => {
  const f = fixture();
  const stale = path.join(f.clone, '.claude', 'worktrees', 'accept-42');
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, 'keep.txt'), 'mine\n');
  assert.throws(() => enter(f), (err) => err.code === 'stale-dir' && /stale accept directory/.test(err.message));
  assert.equal(f.calls.length, 0, 'no git call ran');
  assert.equal(f.ghCalls.length, 0, 'no gh call ran');
  assert.equal(fs.readFileSync(path.join(stale, 'keep.txt'), 'utf8'), 'mine\n');
});

test('reenter refuses malformed input before any call', () => {
  const f = fixture();
  assert.throws(() => enter(f, { record: '4x' }), TypeError);
  assert.throws(() => enter(f, { pr: 0 }), TypeError);
  assert.throws(() => enter(f, { repoRoot: 'relative' }), TypeError);
  assert.equal(f.calls.length + f.ghCalls.length, 0);
});

test('reenter refuses a PR view with no usable branch or head', () => {
  const f = fixture();
  assert.throws(() => enter(f, { gh: () => JSON.stringify({ headRefName: '', headRefOid: f.tip }) }), /headRefName/);
  assert.throws(() => enter(f, { gh: () => JSON.stringify({ headRefName: BRANCH, headRefOid: 'nope' }) }), /headRefOid/);
  assert.equal(f.calls.length, 0);
});

test('sameCommit: equal, prefix of 7 or more, never a mismatch or a non-hex value', () => {
  assert.equal(sameCommit('abc1234', 'abc1234def'), true);
  assert.equal(sameCommit('abc1234def', 'abc1234'), true);
  assert.equal(sameCommit('abc1234', 'abc1235def'), false);
  assert.equal(sameCommit('abc123', 'abc1234def'), false, 'under 7 is not a head');
  assert.equal(sameCommit(null, 'abc1234'), false);
});
