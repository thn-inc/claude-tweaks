'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { nearestExistingDir, repoInfo, findPolicyFile, safeReal, mainCheckoutRoot, checkRunDirAnchoredOrOutside, unanchoredRunDirShadowMessage } = require('../plugin/bin/lib/hooks/worktree-detect');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');
const { skipUnderRoot } = require('./helpers/root');

test('nearestExistingDir: existing directory returns itself', () => {
  const dir = gitRepo();
  assert.strictEqual(nearestExistingDir(dir), dir);
});

test('nearestExistingDir: existing file returns its parent directory', () => {
  const dir = gitRepo();
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'x');
  assert.strictEqual(nearestExistingDir(file), dir);
});

test('nearestExistingDir: not-yet-existing nested path walks up to the nearest existing ancestor', () => {
  const dir = gitRepo();
  const target = path.join(dir, 'new', 'nested', 'file.txt');
  assert.strictEqual(nearestExistingDir(target), dir);
});

test('nearestExistingDir: falls back to a filesystem root when no other ancestor exists', () => {
  const result = nearestExistingDir('/this/path/should/not/exist/anywhere/xyz');
  assert.strictEqual(result, path.parse(result).root);
});

test('repoInfo: main checkout returns its toplevel and isLinkedWorktree: false', () => {
  const dir = gitRepo();
  assert.deepStrictEqual(repoInfo(dir), { repoRoot: dir, isLinkedWorktree: false, indeterminate: false });
});

test('repoInfo: a linked worktree returns its own toplevel and isLinkedWorktree: true', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  assert.deepStrictEqual(repoInfo(wt), { repoRoot: wt, isLinkedWorktree: true, indeterminate: false });
});

test('repoInfo: non-git directory returns repoRoot: null as a DEFINITIVE negative, not indeterminate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wtd-nongit3-'));
  // git ran and answered "not a git repository". indeterminate MUST be false:
  // this is the case the worktree gate is entitled to treat as "nothing to
  // enforce", and conflating it with "git never answered" is #134.
  assert.deepStrictEqual(repoInfo(dir), { repoRoot: null, isLinkedWorktree: false, indeterminate: false });
});

test('repoInfo: a submodule is treated as not isolated', () => {
  const outer = gitRepo();
  const inner = gitRepo();
  execFileSync('git', ['-C', outer, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', inner, 'sub']);
  const subPath = path.join(outer, 'sub');
  const info = repoInfo(subPath);
  assert.strictEqual(info.isLinkedWorktree, false);
  assert.strictEqual(info.repoRoot, path.join(outer, 'sub'));
});

test('findPolicyFile: no policy file anywhere in the ancestor chain returns null', () => {
  const dir = gitRepo();
  assert.strictEqual(findPolicyFile(path.join(dir, 'a.txt')), null);
});

test('findPolicyFile: policy file present at the target\'s own directory returns that directory', () => {
  const dir = gitRepo();
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');
  assert.strictEqual(findPolicyFile(path.join(dir, 'a.txt')), dir);
});

test('safeReal: returns null (not the raw, unresolved path) when realpathSync fails — matches pre-tool-use.js\'s own identically-named helper', () => {
  // This project's fail-open invariant ("a recorded worktree whose path no
  // longer exists resolves to allow") depends on unresolvable paths being
  // falsy. Returning the raw path here instead would let repoInfo() hand
  // back a truthy-looking-but-unverified repoRoot in the race window where
  // a directory is torn down between the `git rev-parse` call and this
  // realpath call.
  assert.strictEqual(safeReal('/this/path/should/not/exist/anywhere/xyz'), null);
});

// ─── the indeterminate third state (#134) ──────────────────────────────────
//
// A null repoRoot used to mean two unrelated things. These tests pin the
// distinction, because the whole enforcement gap depended on it being invisible.

test('repoInfo: a git call that never answers is indeterminate, NOT a negative (#134)', () => {
  const dir = gitRepo();
  // A 1ms budget kills even a fast rev-parse, reproducing under load what a
  // 3000ms budget did at 83% saturation: the question goes unanswered.
  const info = repoInfo(dir, { timeoutMs: 1 });
  assert.strictEqual(info.repoRoot, null, 'no answer means no repoRoot to report');
  assert.strictEqual(info.indeterminate, true,
    'a timeout must NOT masquerade as "this is not a git repo" — that conflation is #134');
});

test('repoInfo: the same directory answers definitively when given a normal budget', () => {
  // Control for the test above: proves the timeout is what produced the
  // indeterminate verdict, not something intrinsic to the fixture. Without
  // this, the assertion above would pass against a permanently-broken repoInfo.
  const dir = gitRepo();
  const info = repoInfo(dir);
  assert.strictEqual(info.repoRoot, dir);
  assert.strictEqual(info.indeterminate, false);
});

test('findPolicyFile: policy file present several directories up returns that ancestor directory', () => {
  const dir = gitRepo();
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');
  const nested = path.join(dir, 'a', 'b', 'c');
  fs.mkdirSync(nested, { recursive: true });
  const target = path.join(nested, 'file.txt');
  assert.strictEqual(findPolicyFile(target), dir);
  assert.notStrictEqual(findPolicyFile(target), nested);
});

test('mainCheckoutRoot: from the main checkout returns its own root', () => {
  const main = gitRepo();
  assert.strictEqual(mainCheckoutRoot(main), safeReal(main));
});

test('mainCheckoutRoot: from inside a linked worktree returns the MAIN checkout, not the worktree', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  assert.strictEqual(mainCheckoutRoot(wt), safeReal(main));
  // The discriminating half: a naive implementation returns the worktree.
  assert.notStrictEqual(mainCheckoutRoot(wt), safeReal(wt));
});

test('mainCheckoutRoot: from a nested path inside a linked worktree still returns the main checkout', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const nested = path.join(wt, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  assert.strictEqual(mainCheckoutRoot(nested), safeReal(main));
});

test('mainCheckoutRoot: a .git file pointing outside .git/worktrees/ (submodule shape) returns null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sub-'));
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /somewhere/.git/modules/thing\n');
  assert.strictEqual(mainCheckoutRoot(dir), null);
});

test('mainCheckoutRoot: an unparseable .git file returns null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bad-'));
  fs.writeFileSync(path.join(dir, '.git'), 'not a gitdir line\n');
  assert.strictEqual(mainCheckoutRoot(dir), null);
});

test('mainCheckoutRoot: a path in no repository at all returns null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-norepo-'));
  assert.strictEqual(mainCheckoutRoot(dir), null);
});

test('mainCheckoutRoot: a stat failure that is NOT ENOENT returns null instead of walking up to an ancestor repo', skipUnderRoot('root bypasses mode bits'), () => {
  // ENOENT is the ordinary walk-up case ("no .git here, look higher"). Every
  // other errno means we could not LOOK, which is a different fact: continuing
  // the walk hands back an ANCESTOR repository's root, and worktree-reap.js
  // then enumerates and removes worktrees belonging to that repo.
  const repo = gitRepo();
  const blocked = path.join(repo, 'blocked');
  fs.mkdirSync(blocked);
  fs.chmodSync(blocked, 0o000); // statSync(blocked/.git) -> EACCES
  try {
    // Precondition: the walk-up WOULD find a repo one level higher, so a null
    // here can only come from the errno branch, not from "nothing to find".
    assert.strictEqual(mainCheckoutRoot(repo), safeReal(repo));
    assert.strictEqual(mainCheckoutRoot(blocked), null);
  } finally {
    fs.chmodSync(blocked, 0o755);
  }
});

test('checkRunDirAnchoredOrOutside: anchored under main checkout accepts, from main cwd and from linked-worktree cwd', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(main, '.claude-tweaks', 'pipelines', 'r1');
  assert.strictEqual(checkRunDirAnchoredOrOutside(target, main).ok, true);
  assert.strictEqual(checkRunDirAnchoredOrOutside(target, wt).ok, true, 'production shape: worktree cwd + main-anchored run dir');
});

test('checkRunDirAnchoredOrOutside: path outside any checkout accepts (existence-independent)', () => {
  const main = gitRepo();
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wtd-outside-')), 'mp-journey');
  const r = checkRunDirAnchoredOrOutside(outside, main);
  assert.strictEqual(r.ok, true);
});

test('checkRunDirAnchoredOrOutside: bare relative path from linked-worktree cwd rejects as foreign-checkout', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const r = checkRunDirAnchoredOrOutside(path.join('.claude-tweaks', 'pipelines', 'r1'), wt);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'foreign-checkout');
  assert.strictEqual(r.mainRoot, safeReal(main));
});

test('checkRunDirAnchoredOrOutside: absolute path inside a linked worktree rejects as foreign-checkout', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const r = checkRunDirAnchoredOrOutside(path.join(wt, '.claude-tweaks', 'pipelines', 'r1'), main);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'foreign-checkout');
});

test('checkRunDirAnchoredOrOutside: path inside an unrelated second repo rejects as foreign-checkout', () => {
  const main = gitRepo();
  const other = gitRepo();
  const r = checkRunDirAnchoredOrOutside(path.join(other, 'run'), main);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'foreign-checkout');
});

test('checkRunDirAnchoredOrOutside: submodule-style .git FILE ancestor counts as inside a checkout, not outside', () => {
  const main = gitRepo();
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'wtd-subm-'));
  fs.writeFileSync(path.join(fake, '.git'), 'gitdir: ../somewhere/.git/modules/x\n'); // unparseable as worktree admin — mainCheckoutRoot(fake) is null
  const r = checkRunDirAnchoredOrOutside(path.join(fake, 'run'), main);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'foreign-checkout');
});

test('checkRunDirAnchoredOrOutside: no-repo-root cwd with path inside some checkout rejects with the distinct reason', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'wtd-norepo-'));
  const repo = gitRepo();
  const r = checkRunDirAnchoredOrOutside(path.join(repo, 'run'), bare);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-repo-root');
});

test('checkRunDirAnchoredOrOutside: symlinked alias of the main checkout classifies by real location (accepts)', () => {
  const main = gitRepo();
  const aliasParent = fs.mkdtempSync(path.join(os.tmpdir(), 'wtd-alias-'));
  const alias = path.join(aliasParent, 'alias');
  fs.symlinkSync(main, alias);
  const r = checkRunDirAnchoredOrOutside(path.join(alias, '.claude-tweaks', 'pipelines', 'r1'), main);
  assert.strictEqual(r.ok, true, 'realpath normalization: alias resolves into the anchored main checkout');
});

test('checkRunDirAnchoredOrOutside: unreadable ancestor fails closed (rejects), never classifies outside', skipUnderRoot('root bypasses mode bits'), () => {
  const main = gitRepo();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wtd-eacces-'));
  const blocked = path.join(base, 'blocked');
  fs.mkdirSync(blocked);
  fs.chmodSync(blocked, 0o000);
  try {
    const r = checkRunDirAnchoredOrOutside(path.join(blocked, 'inner', 'run'), main);
    assert.strictEqual(r.ok, false);
  } finally {
    fs.chmodSync(blocked, 0o755);
  }
});

test('unanchoredRunDirShadowMessage: default flag spelling unchanged; explicit flag substitutes', () => {
  assert.match(unanchoredRunDirShadowMessage('x', '/root'), /^--run-dir x resolves outside the main checkout/);
  assert.match(unanchoredRunDirShadowMessage('x', '/root', '--run'), /^--run x resolves outside the main checkout/);
});
