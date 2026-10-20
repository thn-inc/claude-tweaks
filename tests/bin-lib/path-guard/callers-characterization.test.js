'use strict';

// Characterization tests for the three readers routed through path-guard
// (#3417). The migrations change no behavior except one named difference
// (installed-plugins.js, below), so every #3417 test here passes against the
// pre-migration code AND the migrated code; the one intended difference is
// the only #3417 test that is red before migration. The `isPolicyFile (#3495)`
// tests are the exception: they pin the case-canonical behavior #3495 added.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { locateTranscripts, readDispatches } = require('../../../plugin/bin/lib/timing/transcript');

// The developer's own CLAUDE_CONFIG_DIR would redirect every homeDir-only
// lookup below away from its fixture (#3458) — same posture as cli.test.js's
// fixtureHomeEnv.
delete process.env.CLAUDE_CONFIG_DIR;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-callers-'));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const fresh = () => {
  const d = path.join(scratch, `t${n += 1}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// ---- transcript.js ----------------------------------------------------------

test('transcript: locateTranscripts resolves with the JS realpathSync, never .native', () => {
  const home = fresh();
  const slugDir = path.join(home, '.claude', 'projects', '-x');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 's1.jsonl'), '{}\n');
  const realpathSync = (p) => fs.realpathSync(p);
  realpathSync.native = () => { throw new Error('native realpath must not be used here'); };
  const out = locateTranscripts({ cwd: '/x', sessionId: 's1', homeDir: home, fsImpl: { ...fs, realpathSync } });
  assert.equal(out.length, 1);
  assert.equal(out[0].path, fs.realpathSync(path.join(slugDir, 's1.jsonl')));
});

test('transcript: locateTranscripts returns [] when the projects root cannot be resolved', () => {
  assert.deepEqual(locateTranscripts({ cwd: '/x', sessionId: 's1', homeDir: fresh() }), []);
});

test('transcript: locateTranscripts skips dangling and looping symlink leaves, and a directory named like a transcript', () => {
  const home = fresh();
  const slugDir = path.join(home, '.claude', 'projects', '-x');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'real.jsonl'), '{}\n');
  fs.symlinkSync(path.join(slugDir, 'nowhere'), path.join(slugDir, 'dangling.jsonl'));
  fs.symlinkSync(path.join(slugDir, 'loop-b.jsonl'), path.join(slugDir, 'loop-a.jsonl'));
  fs.symlinkSync(path.join(slugDir, 'loop-a.jsonl'), path.join(slugDir, 'loop-b.jsonl'));
  fs.mkdirSync(path.join(slugDir, 'dir.jsonl'));
  const out = locateTranscripts({ cwd: '/x', homeDir: home });
  assert.deepEqual(out.map((r) => path.basename(r.path)), ['real.jsonl']);
});

test('transcript: locateTranscripts refuses a symlink leaf that resolves outside the projects root', () => {
  const home = fresh();
  const slugDir = path.join(home, '.claude', 'projects', '-x');
  fs.mkdirSync(slugDir, { recursive: true });
  const outside = path.join(fresh(), 'secret.jsonl');
  fs.writeFileSync(outside, '{}\n');
  fs.symlinkSync(outside, path.join(slugDir, 'leak.jsonl'));
  assert.deepEqual(locateTranscripts({ cwd: '/x', sessionId: 'leak', homeDir: home }), []);
});

test('transcript: readDispatches falls through to readdir when the subagents dir lstat fails with a non-ENOENT code', async () => {
  const dir = fresh();
  fs.writeFileSync(path.join(dir, 'agent-a1.meta.json'), JSON.stringify({ description: 'Implement Task 1' }));
  const fsImpl = { ...fs, lstatSync: (p, ...a) => { if (p === dir) throw Object.assign(new Error('io'), { code: 'EIO' }); return fs.lstatSync(p, ...a); } };
  const r = await readDispatches(dir, { fsImpl });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].agentId, 'a1');
  assert.equal(r.items[0].description, 'Implement Task 1');
});

test('transcript: readDispatches names an entry that vanishes between readdir and lstat with its ENOENT code', async () => {
  const dir = fresh();
  fs.writeFileSync(path.join(dir, 'agent-v1.meta.json'), JSON.stringify({ description: 'Implement Task 2' }));
  fs.writeFileSync(path.join(dir, 'agent-v1.jsonl'), '{}\n');
  const fsImpl = { ...fs, lstatSync: (p, ...a) => { if (p.endsWith('agent-v1.jsonl')) throw Object.assign(new Error('gone'), { code: 'ENOENT' }); return fs.lstatSync(p, ...a); } };
  const r = await readDispatches(dir, { fsImpl });
  assert.equal(r.items[0].notFound, 'transcript not readable (ENOENT)');
  assert.equal(r.items[0].description, 'Implement Task 2');
});

test('transcript: readDispatches names an entry whose lstat fails with EACCES by that code (unreadable is not missing)', async () => {
  const dir = fresh();
  fs.writeFileSync(path.join(dir, 'agent-u1.meta.json'), JSON.stringify({ description: 'Implement Task 3' }));
  fs.writeFileSync(path.join(dir, 'agent-u1.jsonl'), '{}\n');
  const fsImpl = { ...fs, lstatSync: (p, ...a) => { if (p.endsWith('agent-u1.jsonl')) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return fs.lstatSync(p, ...a); } };
  const r = await readDispatches(dir, { fsImpl });
  assert.equal(r.items[0].notFound, 'transcript not readable (EACCES)');
  assert.equal(r.items[0].description, 'Implement Task 3');
});

test('transcript: readDispatches reads a directory-typed agent entry as before (not skipped; the read itself reports EISDIR)', async () => {
  const dir = fresh();
  fs.mkdirSync(path.join(dir, 'agent-d1.jsonl'));
  const r = await readDispatches(dir);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].notFound, 'meta not found; transcript not readable (EISDIR)');
});

// ---- pre-tool-use.js: realTarget(), observed through isPolicyFile -----------
// realTarget is private; isPolicyFile(repoRoot, target) is `realTarget(target)
// === parent-resolved canonical policy path`, so each leaf state shows up as a
// true/false verdict.

const { isPolicyFile, POLICY_FILE } = require('../../../plugin/bin/lib/hooks/pre-tool-use');

function policyRepo() {
  const root = fresh();
  const policy = path.join(root, POLICY_FILE);
  fs.mkdirSync(path.dirname(policy), { recursive: true });
  return { root, policy };
}

test('realTarget: an existing policy file and a symlink alias to it both match', () => {
  const { root, policy } = policyRepo();
  fs.writeFileSync(policy, 'x: 1\n');
  const alias = path.join(root, 'alias.yml');
  fs.symlinkSync(policy, alias);
  assert.equal(isPolicyFile(root, policy), true);
  assert.equal(isPolicyFile(root, alias), true);
});

test('realTarget: a not-yet-existing leaf takes the parent-only fallback and matches', () => {
  const { root, policy } = policyRepo();
  assert.equal(isPolicyFile(root, policy), true);
});

test('realTarget: a missing parent directory is unprovable', () => {
  const root = fresh();
  assert.equal(isPolicyFile(root, path.join(root, POLICY_FILE)), false);
});

test('realTarget: a dangling symlink at the policy path never takes the parent-only fallback', () => {
  const { root, policy } = policyRepo();
  fs.symlinkSync(path.join(root, 'nowhere.yml'), policy);
  assert.equal(isPolicyFile(root, policy), false);
});

test('realTarget: a symlink swapped in for policy.yml resolves elsewhere and does not match', () => {
  const { root, policy } = policyRepo();
  const elsewhere = path.join(root, 'elsewhere.yml');
  fs.writeFileSync(elsewhere, 'x: 1\n');
  fs.symlinkSync(elsewhere, policy);
  assert.equal(isPolicyFile(root, policy), false);
});

test('realTarget: empty, non-string and relative targets are unprovable', () => {
  const { root } = policyRepo();
  assert.equal(isPolicyFile(root, ''), false);
  assert.equal(isPolicyFile(root, null), false);
  assert.equal(isPolicyFile(root, POLICY_FILE), false);
});

test('realTarget: a leaf whose realpath AND lstat fail with a non-ENOENT code takes the parent-only fallback', () => {
  const { root, policy } = policyRepo();
  fs.writeFileSync(policy, 'x: 1\n');
  const denied = () => Object.assign(new Error('EACCES'), { code: 'EACCES' });
  const realpathSync = (p, ...a) => fs.realpathSync(p, ...a);
  realpathSync.native = (p, ...a) => { if (p === policy) throw denied(); return fs.realpathSync.native(p, ...a); };
  const lstatSync = (p, ...a) => { if (p === policy) throw denied(); return fs.lstatSync(p, ...a); };
  assert.equal(isPolicyFile(root, policy, { fsImpl: { ...fs, realpathSync, lstatSync } }), true);
});

test('realTarget: a leaf that lstat reports as present but whose realpath fails with a non-ENOENT code takes the parent-only fallback', () => {
  const { root, policy } = policyRepo();
  fs.writeFileSync(policy, 'x: 1\n');
  const realpathSync = (p, ...a) => fs.realpathSync(p, ...a);
  realpathSync.native = (p, ...a) => { if (p === policy) throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); return fs.realpathSync.native(p, ...a); };
  assert.equal(isPolicyFile(root, policy, { fsImpl: { ...fs, realpathSync } }), true);
});

test('realTarget: routes through the injected fs\'s .native realpath, never its JS form', () => {
  const { root, policy } = policyRepo();
  fs.writeFileSync(policy, 'x: 1\n');
  // A symlink alias, so a JS-form call that throws could not be masked by the
  // parent-only fallback that a plain missing leaf would take.
  const alias = path.join(root, 'alias.yml');
  fs.symlinkSync(policy, alias);
  const patched = () => { throw new Error('JS realpath must not be used here'); };
  patched.native = fs.realpathSync.native;
  assert.equal(isPolicyFile(root, alias, { fsImpl: { ...fs, realpathSync: patched } }), true);
});

const { caseInsensitiveFs } = require('../../helpers/case-insensitive-fs');

// The fake is keyed on POSIX-literal paths, but isPolicyFile runs path.resolve /
// path.join, which prefix a drive letter and use backslashes on win32 — so the
// lookups would miss there (tests/helpers/case-insensitive-fs.js is posix-only).
const POSIX_ONLY = process.platform === 'win32' && 'posix-only case-insensitive fake: path.resolve/join rewrite its literal paths on win32';

const CI_DIRS = {
  '/Vol': { type: 'directory' },
  '/Vol/Repo': { type: 'directory' },
  '/Vol/Repo/.claude-tweaks': { type: 'directory' },
};

test('isPolicyFile (#3495): a mis-cased target to an existing policy.yml matches on a case-insensitive volume', { skip: POSIX_ONLY }, () => {
  const fsImpl = caseInsensitiveFs({ ...CI_DIRS, '/Vol/Repo/.claude-tweaks/policy.yml': { type: 'file' } });
  assert.equal(isPolicyFile('/Vol/Repo', '/vol/repo/.CLAUDE-TWEAKS/Policy.yml', { fsImpl }), true);
});

test('isPolicyFile (#3495): a mis-cased repoRoot still matches the correctly-cased target', { skip: POSIX_ONLY }, () => {
  const fsImpl = caseInsensitiveFs({ ...CI_DIRS, '/Vol/Repo/.claude-tweaks/policy.yml': { type: 'file' } });
  assert.equal(isPolicyFile('/vol/REPO', '/Vol/Repo/.claude-tweaks/policy.yml', { fsImpl }), true);
});

test('isPolicyFile (#3495): a symlink swapped in for policy.yml is still denied through a mis-cased target', { skip: POSIX_ONLY }, () => {
  const fsImpl = caseInsensitiveFs({
    ...CI_DIRS,
    '/Vol/Repo/.claude-tweaks/policy.yml': { type: 'symlink', target: '/Vol/Elsewhere/evil.yml' },
    '/Vol/Elsewhere': { type: 'directory' },
    '/Vol/Elsewhere/evil.yml': { type: 'file' },
  });
  assert.equal(isPolicyFile('/Vol/Repo', '/vol/repo/.CLAUDE-TWEAKS/POLICY.yml', { fsImpl }), false);
});

test('isPolicyFile (#3495): a policy file stored as Policy.yml on disk matches both the literal and a mis-cased spelling', { skip: POSIX_ONLY }, () => {
  const fsImpl = caseInsensitiveFs({ ...CI_DIRS, '/Vol/Repo/.claude-tweaks/Policy.yml': { type: 'file' } });
  assert.equal(isPolicyFile('/Vol/Repo', '/Vol/Repo/.claude-tweaks/policy.yml', { fsImpl }), true);
  assert.equal(isPolicyFile('/Vol/Repo', '/vol/repo/.claude-tweaks/POLICY.YML', { fsImpl }), true);
});

// ---- installed-plugins.js ---------------------------------------------------

const { selectEntry, safeRealpath, canonicalGitRoot } = require('../../../plugin/bin/lib/installed-plugins');

const ident = (p) => p;
const entryAt = (projectPath, tag) => ({ scope: 'project', projectPath, tag });

test('installed-plugins: safeRealpath returns the input when the injected realpath throws', () => {
  const boom = () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); };
  assert.equal(safeRealpath('/stale/project', { realpath: boom }), '/stale/project');
  assert.equal(safeRealpath('/a/b', { realpath: () => '/real/b' }), '/real/b');
});

test('installed-plugins: safeRealpath returns the input unchanged when deps has no realpath function', () => {
  assert.equal(safeRealpath('/some/path', {}), '/some/path');
  assert.equal(safeRealpath('/some/path', undefined), '/some/path');
});

test('installed-plugins: a stale projectPath whose realpath fails still compares lexically', () => {
  const boom = () => { throw new Error('gone'); };
  const e = entryAt('/stale', 'stale');
  assert.equal(selectEntry([e], '/stale', { realpath: boom }), e);
  assert.equal(selectEntry([e], '/other', { realpath: boom }), null);
});

test('installed-plugins: without deps.readFile only exact paths match, in file order', () => {
  const outer = entryAt('/work', 'outer');
  const inner = entryAt('/work/app', 'inner');
  const deps = { realpath: ident };
  assert.equal(selectEntry([outer, inner], '/work/app', deps), inner);
  assert.equal(selectEntry([outer], '/work/app', deps), null, 'an ancestor projectPath no longer applies');
  assert.equal(canonicalGitRoot('/work', deps), null, 'no readFile -> no git root');
});
