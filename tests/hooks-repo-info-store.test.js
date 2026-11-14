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
const { rememberRepoInfo, envFingerprint, MAX_STORE_ENTRIES } = require('../plugin/bin/lib/hooks/repo-info-cache');
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
function runChild(dir, env) {
  const out = execFileSync(process.execPath, ['-e', CHILD, MODULE, dir], { env, encoding: 'utf8' });
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
  const keyOf = (dir) => crypto.createHash('sha1').update(`${dir}\0${envFingerprint(env)}`).digest('hex');
  const { entries } = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(Object.keys(entries).length, MAX_STORE_ENTRIES);
  assert.ok(!(keyOf(dirs[0]) in entries), 'the first entry was evicted');
  assert.ok(keyOf(dirs[MAX_STORE_ENTRIES]) in entries, 'the newest entry is present');
});
