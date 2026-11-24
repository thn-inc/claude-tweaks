'use strict';
// #5294: repoInfo's cross-process store (plugin/bin/lib/hooks/repo-info-cache.js).
// Each case runs repoInfo in a fresh child process whose rev-parse spawns are
// counted, against its own store file. The child env is built explicitly, with
// the five git discovery variables removed, so a case means the same thing
// under bare `node --test` and under tools/run-tests.js.
const { test, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MODULE = path.resolve(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'worktree-detect.js');
const {
  rememberRepoInfo, lookupRepoInfo, repoSignature, resetMemo, envFingerprint, MAX_STORE_ENTRIES,
} = require('../plugin/bin/lib/hooks/repo-info-cache');
const { gitRepo, linkedWorktreeOf, fixtureGit } = require('./helpers/git-fixtures');

const DISCOVERY = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM'];

const CHILD = `
const cp = require('child_process');
const real = cp.execFileSync;
let spawns = 0;
cp.execFileSync = function (file, args) {
  if (Array.isArray(args) && args.includes('rev-parse')) spawns++;
  return real.apply(this, arguments);
};
const { repoInfo } = require(process.argv[1]);
const info = repoInfo(process.argv[2]);
process.stdout.write(JSON.stringify({ info, spawns }));
`;

// The same child, but every git spawn dies of SIGKILL (status null), as the OOM killer would.
const KILLED_CHILD = `
const cp = require('child_process');
cp.execFileSync = function () {
  throw Object.assign(new Error('Command failed: git'), { status: null, signal: 'SIGKILL', stderr: '' });
};
const { repoInfo } = require(process.argv[1]);
process.stdout.write(JSON.stringify({ info: repoInfo(process.argv[2]) }));
`;

const UID = typeof process.getuid === 'function' ? process.getuid() : null;
const keyOf = (dir, env) => crypto.createHash('sha1').update(`${UID}\0${dir}\0${envFingerprint(env)}`).digest('hex');

const scratch = [];
after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});
function scratchDir(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  scratch.push(d);
  return d;
}

function childEnv(storeFile, extra = {}) {
  const env = { ...process.env, CT_HOOKS_REPO_INFO_STORE: storeFile };
  for (const k of Object.keys(env)) if (DISCOVERY.includes(k.toUpperCase())) delete env[k];
  return { ...env, ...extra };
}

// A fresh child process: -> { info, spawns }. Throws on a non-zero exit.
function runChild(dir, env, source = CHILD) {
  const out = execFileSync(process.execPath, ['-e', source, MODULE, dir], { env, encoding: 'utf8' });
  return JSON.parse(out);
}

const storeIn = (d) => path.join(d, 'store.json');

test('AC2.1: a warm store answers repoInfo in a fresh process with zero git spawns', () => {
  const wt = linkedWorktreeOf(gitRepo());
  const env = childEnv(storeIn(scratchDir('ct-ris-')));
  const first = runChild(wt, env);
  assert.strictEqual(first.spawns, 1);
  assert.strictEqual(first.info.isLinkedWorktree, true);
  const second = runChild(wt, env);
  assert.strictEqual(second.spawns, 0);
  assert.deepStrictEqual(second.info, first.info);
});

test('#5294: the store re-asks git when the signature no longer matches', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const env = childEnv(storeIn(scratchDir('ct-ris-')));
  assert.strictEqual(runChild(wt, env).spawns, 1);
  fixtureGit(['-C', main, 'worktree', 'remove', '--force', wt]);
  fs.mkdirSync(wt);
  const after = runChild(wt, env);
  assert.strictEqual(after.spawns, 1);
  assert.strictEqual(after.info.isLinkedWorktree, false);
});

test('AC5.1: a corrupt store leaves repoInfo\'s answer unchanged', () => {
  const wt = linkedWorktreeOf(gitRepo());
  const cold = runChild(wt, childEnv(storeIn(scratchDir('ct-ris-')))).info;

  // (a) not JSON at all.
  const fileA = storeIn(scratchDir('ct-ris-'));
  fs.writeFileSync(fileA, '{not json');
  const a = runChild(wt, childEnv(fileA));
  assert.deepStrictEqual(a.info, cold);
  assert.strictEqual(a.spawns, 1);

  // (b) valid JSON whose entry for the key has the wrong shape but a valid signature.
  const fileB = storeIn(scratchDir('ct-ris-'));
  const envB = childEnv(fileB);
  runChild(wt, envB);
  const store = JSON.parse(fs.readFileSync(fileB, 'utf8'));
  for (const k of Object.keys(store.entries)) {
    store.entries[k] = { answer: { repoRoot: 42, isLinkedWorktree: 'yes' }, signature: store.entries[k].signature, at: 0 };
  }
  fs.writeFileSync(fileB, JSON.stringify(store));
  const b = runChild(wt, envB);
  assert.deepStrictEqual(b.info, cold);
  assert.strictEqual(b.spawns, 1);
});

test('AC5.1: an unreadable store leaves repoInfo\'s answer unchanged', () => {
  const wt = linkedWorktreeOf(gitRepo());
  const cold = runChild(wt, childEnv(storeIn(scratchDir('ct-ris-')))).info;
  const asDir = scratchDir('ct-ris-dirstore-'); // the store path names a directory: EISDIR
  const got = runChild(wt, childEnv(asDir));
  assert.deepStrictEqual(got.info, cold);
  assert.strictEqual(got.spawns, 1);
  assert.strictEqual(runChild(wt, childEnv(asDir)).spawns, 1, 'nothing was stored');
});

test('#5294: a git killed by a signal is not carried to a fresh process', () => {
  const main = gitRepo();
  const env = childEnv(storeIn(scratchDir('ct-ris-')));
  const killed = runChild(main, env, KILLED_CHILD);
  assert.deepStrictEqual(killed.info, { repoRoot: null, isLinkedWorktree: false, indeterminate: false });
  const next = runChild(main, env);
  assert.strictEqual(next.spawns, 1);
  assert.deepStrictEqual(next.info, { repoRoot: main, isLinkedWorktree: false, indeterminate: false });
});

// git-template.js holds the block; git-fixtures.js and pre-tool-use.js reach it by requiring it
// (tests/hooks-session-start.test.js loads git-template.js directly).
test('#5294: the git test helpers point a bare run at a temp store, and keep one already set', () => {
  const probe = `
const os = require('os');
require(process.argv[1]);
process.stdout.write(JSON.stringify({ store: process.env.CT_HOOKS_REPO_INFO_STORE, tmp: os.tmpdir() }));
`;
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'CT_HOOKS_REPO_INFO_STORE') delete env[k];
  for (const name of ['git-template.js', 'git-fixtures.js', 'pre-tool-use.js']) {
    const helper = path.resolve(__dirname, 'helpers', name);
    const bare = JSON.parse(execFileSync(process.execPath, ['-e', probe, helper], { env, encoding: 'utf8' }));
    assert.strictEqual(typeof bare.store, 'string', `${name} sets the store`);
    assert.ok(bare.store.startsWith(bare.tmp + path.sep), `${name}: ${bare.store} is under ${bare.tmp}`);
    assert.notStrictEqual(bare.store, path.join(os.homedir(), '.claude-tweaks', 'repo-info-cache.json'));
    const pinned = path.join(scratchDir('ct-ris-'), 'pinned.json');
    const kept = JSON.parse(execFileSync(process.execPath, ['-e', probe, helper], {
      env: { ...env, CT_HOOKS_REPO_INFO_STORE: pinned }, encoding: 'utf8',
    }));
    assert.strictEqual(kept.store, pinned, `${name} keeps a store already set`);
  }
});

test('AC5.1: an unwritable store leaves repoInfo\'s answer unchanged', () => {
  const wt = linkedWorktreeOf(gitRepo());
  const cold = runChild(wt, childEnv(storeIn(scratchDir('ct-ris-')))).info;
  const blocker = path.join(scratchDir('ct-ris-'), 'a-file');
  fs.writeFileSync(blocker, 'x'); // a regular file as the store's parent: ENOTDIR on write
  const env = childEnv(path.join(blocker, 'store.json'));
  const first = runChild(wt, env);
  assert.deepStrictEqual(first.info, cold);
  assert.strictEqual(runChild(wt, env).spawns, 1, 'nothing was stored');
});

test('#5294: a git discovery variable bypasses the store', () => {
  const main = gitRepo();
  const unrelated = scratchDir('ct-ris-ceiling-');
  const values = {
    GIT_DIR: path.join(main, '.git'),
    GIT_WORK_TREE: main,
    GIT_COMMON_DIR: path.join(main, '.git'),
    GIT_CEILING_DIRECTORIES: unrelated,
    GIT_DISCOVERY_ACROSS_FILESYSTEM: '1',
  };
  // Control: without a discovery variable the same child does write the store.
  const control = storeIn(scratchDir('ct-ris-'));
  runChild(main, childEnv(control));
  assert.ok(fs.existsSync(control), 'the control run wrote the store');
  for (const name of DISCOVERY) {
    const file = storeIn(scratchDir('ct-ris-'));
    runChild(main, childEnv(file, { [name]: values[name] }));
    assert.strictEqual(fs.existsSync(file), false, `${name} bypasses the store`);
  }
});

test('#5294: a different PATH does not reuse another git\'s answer', () => {
  const wt = linkedWorktreeOf(gitRepo());
  const file = storeIn(scratchDir('ct-ris-'));
  assert.strictEqual(runChild(wt, childEnv(file)).spawns, 1);
  const extra = scratchDir('ct-ris-path-');
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const env = childEnv(file, { [pathKey]: `${extra}${path.delimiter}${process.env[pathKey]}` });
  assert.strictEqual(runChild(wt, env).spawns, 1);
});

// #5294 review: a named pipe where the cache reads a file would block a read
// for ever, so these cases run the child under a timeout and assert it exits.
function canMkfifo() {
  if (process.platform === 'win32') return false;
  try {
    const probe = path.join(scratchDir('ct-ris-fifo-probe-'), 'p');
    execFileSync('mkfifo', [probe], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}
const NO_FIFO = !canMkfifo();

function runChildBounded(dir, env) {
  try {
    const out = execFileSync(process.execPath, ['-e', CHILD, MODULE, dir], { env, encoding: 'utf8', timeout: 5000 });
    return JSON.parse(out);
  } catch (e) {
    assert.fail(`the child did not exit by itself (${e.code || e.signal || e.message})`);
  }
}

test('#5294 review: a named pipe at a worktree\'s commondir does not hang the lookup', { skip: NO_FIFO }, () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const raw = fs.readFileSync(path.join(wt, '.git'), 'utf8');
  const admin = path.resolve(wt, /^gitdir:\s*(.+?)\s*$/m.exec(raw)[1]);
  fs.rmSync(path.join(admin, 'commondir'));
  execFileSync('mkfifo', [path.join(admin, 'commondir')]);
  // git itself blocks reading the pipe until runGit's own timeout kills it, so
  // that budget is cut to fit the bound. The unfixed cache blocked before the
  // spawn, where no timeout applies.
  const got = runChildBounded(wt, childEnv(storeIn(scratchDir('ct-ris-')), { CT_HOOKS_GIT_TIMEOUT_MS: '1500' }));
  assert.strictEqual(got.info.repoRoot, null, `git's answer: ${JSON.stringify(got.info)}`);
  // A pipe is "cannot tell", never an empty commondir: no signature, nothing
  // cached. Asked in-process only after the bounded child proved it cannot block.
  assert.strictEqual(repoSignature(wt), null);
});

test('#5294 review: a named pipe at the store path does not hang the lookup', { skip: NO_FIFO }, () => {
  const wt = linkedWorktreeOf(gitRepo());
  const cold = runChild(wt, childEnv(storeIn(scratchDir('ct-ris-')))).info;
  const fifo = path.join(scratchDir('ct-ris-'), 'store.json');
  execFileSync('mkfifo', [fifo]);
  const got = runChildBounded(wt, childEnv(fifo));
  assert.deepStrictEqual(got.info, cold);
});

test('#5294: the store keeps at most MAX_STORE_ENTRIES entries, evicting the oldest', () => {
  const file = storeIn(scratchDir('ct-ris-'));
  const env = childEnv(file);
  const answer = { repoRoot: null, isLinkedWorktree: false, indeterminate: false };
  const dirs = [];
  for (let i = 0; i <= MAX_STORE_ENTRIES; i++) {
    const dir = path.join(os.tmpdir(), `ct-ris-evict-${process.pid}-${i}`);
    dirs.push(dir);
    rememberRepoInfo(dir, env, { n: i }, answer);
  }
  const { entries } = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(Object.keys(entries).length, MAX_STORE_ENTRIES);
  assert.ok(!(keyOf(dirs[0], env) in entries), 'the first entry was evicted');
  assert.ok(keyOf(dirs[MAX_STORE_ENTRIES], env) in entries, 'the newest entry is present');
});

test('#5294: a store hit refreshes its entry, so eviction drops the least recently used', () => {
  const file = storeIn(scratchDir('ct-ris-'));
  const env = childEnv(file);
  const answer = { repoRoot: null, isLinkedWorktree: false, indeterminate: false };
  const hit = scratchDir('ct-ris-lru-'); // a real directory, so its signature can match
  rememberRepoInfo(hit, env, repoSignature(hit, env), answer);
  const dirs = [hit];
  for (let i = 1; i < MAX_STORE_ENTRIES; i++) {
    const dir = path.join(os.tmpdir(), `ct-ris-lru-${process.pid}-${i}`);
    dirs.push(dir);
    rememberRepoInfo(dir, env, { n: i }, answer);
  }
  // Age every entry well past the refresh interval, `hit` the oldest of all.
  const store = JSON.parse(fs.readFileSync(file, 'utf8'));
  dirs.forEach((d, i) => { store.entries[keyOf(d, env)].at = 1 + i; });
  fs.writeFileSync(file, JSON.stringify(store));
  resetMemo(); // answer from the store, not this process's memo
  assert.deepStrictEqual(lookupRepoInfo(hit, env).answer, answer);
  rememberRepoInfo(path.join(os.tmpdir(), `ct-ris-lru-${process.pid}-new`), env, { n: 'new' }, answer);
  const { entries } = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(Object.keys(entries).length, MAX_STORE_ENTRIES);
  assert.ok(keyOf(hit, env) in entries, 'the entry hit after aging survived');
  assert.ok(!(keyOf(dirs[1], env) in entries), 'the least recently used entry was evicted');
});
