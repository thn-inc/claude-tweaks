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

const { reenter, reenterCheck, reenterRemove } = require('../../../plugin/bin/lib/accept/reentry');

const BRANCH = 'feat/accept-me';
const BASE = 'b'.repeat(40);
const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function hermeticEnv(home) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  return {
    ...env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'xdg'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
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
    return JSON.stringify({ headRefName: BRANCH, headRefOid: tip, baseRefOid: BASE });
  };
  // A commit on a side branch of the clone, never pushed: a second real oid to compare against.
  const other = () => {
    setup(['checkout', '-q', '-b', 'side'], clone);
    fs.writeFileSync(path.join(clone, 'b.txt'), 'two\n');
    setup(['add', '--', 'b.txt'], clone);
    setup(['commit', '-q', '-m', 'side'], clone);
    const oid = setup(['rev-parse', 'HEAD'], clone).trim();
    setup(['checkout', '-q', '--detach', tip], clone);
    return oid;
  };
  const list = () => setup(['worktree', 'list', '--porcelain'], clone);
  // Git for Windows lists a worktree with forward slashes where path.join builds backslashes, so
  // a native path is matched against the listing on git's spelling.
  const slashed = (p) => p.replace(/\\/g, '/');
  const listed = (wt) => list().split(/\r?\n/).some((line) => line.startsWith('worktree ') && slashed(line.slice('worktree '.length)) === slashed(wt));
  return { base, clone, tip, git, gh, calls, ghCalls, setup, other, list, listed };
}

const enter = (f, extra = {}) => reenter({ record: 42, pr: 7, repoRoot: f.clone, parkHead: f.tip, parkBase: BASE, git: f.git, gh: f.gh, ...extra });

test('AC4.1: reenter fetches and adds the worktree from the PR branch', () => {
  const f = fixture();
  const res = enter(f);
  const expected = path.join(f.clone, '.claude', 'worktrees', 'accept-42');
  assert.equal(res.worktree, expected);
  assert.equal(res.headRefName, BRANCH);
  assert.equal(res.prHead, f.tip);
  assert.equal(res.head, f.tip);
  assert.equal(fs.readFileSync(path.join(expected, 'a.txt'), 'utf8'), 'one\n');
  assert.deepEqual(f.ghCalls, [['pr', 'view', '7', '--json', 'headRefName,headRefOid,baseRefOid']]);
  assert.equal(res.prBase, BASE);
  assert.equal(res.parkBase, BASE);
  assert.ok(f.listed(expected));
  // The ref and path operands are fenced from option parsing.
  assert.ok(f.calls.filter((a) => a.includes('fetch') || a.includes('add') || a.includes('remove')).every((a) => a.includes('--end-of-options')));
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

test('AC4.2: reenterCheck reads the NUL-delimited status: spaces, newlines and a rename origin', () => {
  const head = 'a'.repeat(40);
  let statusArgs;
  const git = (args) => {
    if (args.includes('rev-parse')) return `${head}\n`;
    statusArgs = args;
    return ' M my file.txt\0A  line\nbreak.txt\0R  new name.txt\0old name.txt\0M  after.txt\0';
  };
  const res = reenterCheck({ worktree: '/wt', expectHead: head, git });
  assert.ok(statusArgs.includes('-z'));
  assert.deepEqual(res.dirty, ['my file.txt', 'line\nbreak.txt', 'new name.txt', 'after.txt']);
});

test('AC4.2: reenterCheck matches the full oid only, not a prefix', () => {
  const f = fixture();
  const { worktree, head } = enter(f);
  assert.equal(reenterCheck({ worktree, expectHead: f.tip.slice(0, 7), git: f.git }).ok, false);
  assert.equal(reenterCheck({ worktree, expectHead: head.toUpperCase(), git: f.git }).ok, true, 'case is not a difference');
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
  assert.equal(enter(f, { parkHead: 'aaaaaaa' }).moved, true, 'an unresolvable park head is moved');
  const g = fixture();
  assert.equal(enter(g, { parkHead: g.tip }).moved, false);
  const h = fixture();
  assert.equal(enter(h, { parkHead: h.tip.slice(0, 7) }).moved, false, 'an abbreviated park head resolving to the PR head is not moved');
  const i = fixture();
  assert.equal(enter(i, { parkHead: null }).moved, true, 'a missing park head counts as moved');
  const j = fixture();
  const other = j.other();
  const full = enter(j, { parkHead: other });
  assert.equal(full.moved, true, 'a different full oid is moved');
  const k = fixture();
  const short = k.other().slice(0, 7);
  assert.equal(enter(k, { parkHead: short }).moved, true, 'a short park head resolving to another commit is moved');
});

test('I3: a moved or missing park base is moved; an unmoved base and head is not', () => {
  const f = fixture();
  const same = enter(f);
  assert.equal(same.moved, false, 'base same and head same: not moved');
  const g = fixture();
  assert.equal(enter(g, { parkBase: 'c'.repeat(40) }).moved, true, 'base moved since the park');
  const h = fixture();
  assert.equal(enter(h, { parkBase: null }).moved, true, 'a missing park-base fails closed');
  const i = fixture();
  assert.equal(enter(i, { parkBase: 'not-hex' }).moved, true, 'an unreadable park-base fails closed');
});

test('M2: a push between the PR view and the fetch is moved', () => {
  const f = fixture();
  const stale = f.other();
  // The view answers an older head (the park head), the branch tip fetched is newer.
  const gh = (args) => JSON.stringify({ headRefName: BRANCH, headRefOid: stale, baseRefOid: BASE });
  const res = enter(f, { gh, parkHead: stale });
  assert.equal(res.prHead, stale);
  assert.equal(res.head, f.tip);
  assert.equal(res.moved, true, 'the fetched head is not the head the view saw');
});

test('reenter refuses a PR view with no usable base', () => {
  const f = fixture();
  assert.throws(() => enter(f, { gh: () => JSON.stringify({ headRefName: BRANCH, headRefOid: f.tip }) }), /baseRefOid/);
  assert.equal(f.calls.filter((a) => a.includes('fetch') || a.includes('add')).length, 0);
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
  assert.equal(f.calls.filter((a) => a.includes('fetch') || a.includes('add')).length, 0);
});

test('a registered but deleted accept directory is stale: no add attempted, reenter-remove clears it', () => {
  const f = fixture();
  const { worktree } = enter(f);
  fs.rmSync(worktree, { recursive: true, force: true });
  assert.ok(f.listed(worktree), 'git still lists the deleted directory');
  const before = f.calls.length;
  assert.throws(() => enter(f), (err) => err.code === 'stale-dir' && /reenter-remove/.test(err.message));
  assert.equal(f.calls.slice(before).some((a) => a.includes('add') || a.includes('fetch')), false, 'no worktree add or fetch ran');
  assert.equal(f.ghCalls.length, 1, 'no gh call after the refusal');
  assert.deepEqual(reenterRemove({ worktree, repoRoot: f.clone, git: f.git }), { removed: true });
  assert.ok(!f.listed(worktree), 'the registration is gone');
  assert.equal(enter(f).head, f.tip, 're-entry works again');
});

test('reenter-remove refuses a listed worktree that is not accept-<n> under .claude/worktrees', () => {
  const f = fixture();
  const elsewhere = path.join(f.base, 'accept-5');
  const named = path.join(f.clone, '.claude', 'worktrees', 'feat');
  const nested = path.join(f.clone, '.claude', 'worktrees', 'deep', 'accept-6');
  for (const wt of [elsewhere, named, nested]) f.setup(['worktree', 'add', '--detach', '--end-of-options', wt, f.tip], f.clone);
  for (const wt of [elsewhere, named, nested]) {
    assert.throws(() => reenterRemove({ worktree: wt, repoRoot: f.clone, git: f.git }), (err) => err.code === 'not-accept-worktree', wt);
    assert.ok(f.listed(wt), `${wt} survives`);
  }
});

test('a failed rev-parse after the worktree add removes the worktree it made and rethrows', () => {
  const f = fixture();
  const boom = new Error('fatal: rev-parse exploded');
  const git = (args) => {
    if (args.includes('rev-parse') && args.includes('HEAD') && args[1].includes('accept-42')) throw boom;
    return f.git(args);
  };
  assert.throws(() => enter(f, { git }), (err) => err === boom);
  assert.ok(!f.list().includes('accept-42'), 'no worktree left behind');
  assert.equal(fs.existsSync(path.join(f.clone, '.claude', 'worktrees', 'accept-42')), false);
});

test('reenter-remove given a symlink alias passes git the canonical path it validated', (t) => {
  const f = fixture();
  const { worktree } = enter(f);
  const alias = path.join(f.base, 'alias-accept-42');
  try {
    fs.symlinkSync(worktree, alias, 'dir');
  } catch (err) {
    t.skip(`symlinks unavailable: ${err.code}`);
    return;
  }
  const canonical = fs.realpathSync(worktree);
  const before = f.calls.length;
  assert.deepEqual(reenterRemove({ worktree: alias, repoRoot: f.clone, git: f.git }), { removed: true });
  const removal = f.calls.slice(before).find((a) => a.includes('remove'));
  assert.equal(removal.at(-1), canonical, 'the canonical path, not the alias');
  assert.ok(!f.list().includes('accept-42'), 'the worktree is gone');
});
