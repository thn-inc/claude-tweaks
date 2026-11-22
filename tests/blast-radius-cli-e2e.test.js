'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runCliSync, spawnCli } = require('./helpers/run-cli');
const { writeIdentity } = require('./helpers/git-fixtures');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'blast-radius.js');

// The fixture's own git calls must not read a repo named by an inherited GIT_* variable.
function cleanEnv() {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
  return env;
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// The complete environment the CLI sees: git needs PATH, and HOME keeps a global git config reachable.
// SystemRoot and USERPROFILE are what a Windows git child needs to start; absent elsewhere.
const CLI_ENV = { PATH: process.env.PATH, HOME: os.homedir() };
for (const key of ['SystemRoot', 'USERPROFILE']) if (process.env[key] !== undefined) CLI_ENV[key] = process.env[key];

// In-process call; maps the helper's `code` onto the `status` field the assertions use.
function cli(args, opts = {}) {
  const { code, stdout, stderr } = runCliSync(CLI, args, { env: CLI_ENV, ...opts });
  return { status: code, stdout, stderr };
}

// Fixture: a repo with a main branch, a feature branch one behavior commit
// (plugin file) and one test commit ahead, plus a policy.yml naming a
// sensitive path.
function makeFixtureRepo() {
  const dir = scratchDir('blast-radius-');
  git(dir, 'init', '-b', 'main');
  writeIdentity(dir, { name: 'Test', email: 'test@example.invalid' });
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'merge-sensitive-paths: secrets/*\n');
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'base');
  git(dir, 'checkout', '-b', 'feature');
  fs.writeFileSync(path.join(dir, 'impl.js'), 'x\ny\nz\n');
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'impl.test.js'), 'a\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'feature work');
  return dir;
}

// Real process: proves the script entry (require.main guard, argv slice, process.exitCode wiring).
test('e2e: success prints one JSON object with mergeBase, config, summary', () => {
  const dir = makeFixtureRepo();
  const res = spawnCli(CLI, ['--integration-branch', 'main'], { cwd: dir });
  assert.strictEqual(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.match(out.mergeBase, /^[0-9a-f]{40}$/);
  assert.strictEqual(out.summary.implFiles, 1);
  assert.strictEqual(out.summary.implLines, 3);
  assert.strictEqual(out.summary.testFiles, 1);
  assert.deepStrictEqual(out.config.mergeSensitivePaths, ['secrets/*']);
  assert.strictEqual(out.config.autoMergeMaxLines, 40);
});

test('e2e: unresolvable integration branch exits 1 with stderr and NO stdout', () => {
  const dir = makeFixtureRepo();
  const res = cli(['--integration-branch', 'no-such-branch'], { cwd: dir });
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /blast-radius: could not resolve merge base/);
  assert.strictEqual(res.stdout, '', 'a resolution failure must never print a summary');
});

// Real process: proves the no-argument refusal through the script entry (exit 1, nothing on stdout).
test('e2e: missing both base flags exits 1 with usage on stderr', () => {
  const dir = makeFixtureRepo();
  const res = spawnCli(CLI, [], { cwd: dir });
  assert.strictEqual(res.code, 1);
  assert.strictEqual(res.stderr, 'blast-radius: usage: blast-radius.js (--base <ref> | --integration-branch <branch>) [--run <dir>]\n');
  assert.strictEqual(res.stdout, '');
});

test('e2e: --base pass-through uses the given commit', () => {
  const dir = makeFixtureRepo();
  const baseSha = git(dir, 'rev-parse', 'main').trim();
  const res = cli(['--base', baseSha], { cwd: dir });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(JSON.parse(res.stdout).mergeBase, baseSha);
});

// I-2 (#888 follow-up): a nonexistent --run dir must fail loud, not silently
// degrade to "no run-config overlay" — matching resolve-policy.js's convention.
test('e2e: nonexistent --run dir exits 1 with the bad-path message and NO stdout', () => {
  const dir = makeFixtureRepo();
  const badRunDir = path.join(dir, 'no-such-run-dir');
  const res = cli(['--integration-branch', 'main', '--run', badRunDir], { cwd: dir });
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /blast-radius: --run dir does not exist or is not a directory: /);
  assert.strictEqual(res.stdout, '', 'a bad --run path must never print a summary');
});

// #1592: a repo with a stale local `main` (behind a same-named origin/main
// remote-tracking ref) — reproducing the shared-checkout hazard observed live
// during a merge-check for record #897, where a stale local main pulled
// unrelated already-landed commits into the blast radius. `unrelated.txt`
// lands on main AFTER the point `feature` actually branches from (origin/main's
// true position); local `main` is then force-set back to the pre-unrelated-work
// commit, exactly like a shared checkout whose local ref never got fetched.
function makeStaleLocalMainFixture() {
  const dir = scratchDir('blast-radius-stale-');
  git(dir, 'init', '-b', 'main');
  writeIdentity(dir, { name: 'Test', email: 'test@example.invalid' });
  fs.writeFileSync(path.join(dir, 'root.txt'), 'root\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'root');
  const rootSha = git(dir, 'rev-parse', 'HEAD').trim();

  fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'unrelated\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'unrelated main work');
  const advancedSha = git(dir, 'rev-parse', 'HEAD').trim();

  git(dir, 'checkout', '-b', 'feature');
  fs.writeFileSync(path.join(dir, 'impl.js'), 'x\ny\nz\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'feature work');

  // origin/main correctly tracks the advanced commit...
  git(dir, 'update-ref', 'refs/remotes/origin/main', advancedSha);
  // ...but local main is stale, still pointing at the root commit.
  git(dir, 'branch', '-f', 'main', rootSha);

  return dir;
}

test('e2e #1592: a stale local main resolves against origin/main, excluding unrelated already-landed commits (AC2)', () => {
  const dir = makeStaleLocalMainFixture();
  const res = cli(['--integration-branch', 'main'], { cwd: dir });
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  const originMainSha = git(dir, 'rev-parse', 'refs/remotes/origin/main').trim();
  assert.strictEqual(out.mergeBase, originMainSha, 'merge base must match origin/main, not the stale local main');
  assert.strictEqual(out.summary.implFiles, 1, 'unrelated.txt from the stale gap must not be counted');
  assert.strictEqual(out.summary.implLines, 3);
});

test('e2e #1592: --integration-branch main and --integration-branch origin/main agree on a stale local main (AC1)', () => {
  const dir = makeStaleLocalMainFixture();
  const viaBare = cli(['--integration-branch', 'main'], { cwd: dir });
  const viaQualified = cli(['--integration-branch', 'origin/main'], { cwd: dir });
  assert.strictEqual(viaBare.status, 0, viaBare.stderr);
  assert.strictEqual(viaQualified.status, 0, viaQualified.stderr);
  assert.deepStrictEqual(JSON.parse(viaBare.stdout), JSON.parse(viaQualified.stdout));
});

test('AC5.1: require() of blast-radius.js prints nothing and leaves process.exitCode undefined', () => {
  const dir = makeFixtureRepo();
  // fresh: true re-requires the CLI inside the helper's snapshot, so a require-time
  // stdout/stderr write or process.exitCode change fails this call.
  const res = cli(['--integration-branch', 'main'], { cwd: dir, fresh: true });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(process.exitCode, undefined);
});

// AC9.1 env-only fixture (model: forgePair in forge-probe-env.test.js): repo A is the
// CLI's cwd and has no main branch; repo B has main and a feature commit. B is named only
// through GIT_DIR in the injected env, so the git child reads B only if it gets that env.
test('AC9.1: the git child reads the repo named by the injected env, not the inherited one', () => {
  const a = scratchDir('blast-radius-a-');
  git(a, 'init', '-b', 'trunk');
  writeIdentity(a, { name: 'Test', email: 'test@example.invalid' });
  fs.writeFileSync(path.join(a, 'a.txt'), 'a\n');
  git(a, 'add', '.');
  git(a, 'commit', '-m', 'a');
  const b = makeFixtureRepo();
  const baseSha = git(b, 'rev-parse', 'main').trim();
  const res = cli(['--integration-branch', 'main'], {
    cwd: a,
    env: { ...CLI_ENV, GIT_DIR: path.join(b, '.git') },
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(JSON.parse(res.stdout).mergeBase, baseSha);
});

// #6006: the policy read takes the factory layer from the injected env. HOME is an empty scratch dir, so
// the variable is the only factory source; the fixture's policy.yml leaves auto-merge-max-lines unset.
test('the policy read resolves a factory value from the injected env (#6006)', () => {
  const dir = makeFixtureRepo();
  const res = cli(['--integration-branch', 'main'], {
    cwd: dir,
    env: { ...CLI_ENV, HOME: scratchDir('blast-radius-home-'), CLAUDE_TWEAKS_FACTORY_POLICY: 'auto-merge-max-lines: 7\n' },
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(JSON.parse(res.stdout).config.autoMergeMaxLines, 7);
});

test('AC9.1: a relative --run that does not exist prints the argument as given', () => {
  const dir = makeFixtureRepo();
  const res = cli(['--integration-branch', 'main', '--run', 'nope'], { cwd: dir });
  assert.strictEqual(res.status, 1);
  assert.strictEqual(res.stdout, '');
  assert.strictEqual(res.stderr, 'blast-radius: --run dir does not exist or is not a directory: nope\n');
});

test('--run "" exits 1 with the not-a-directory message, as before', () => {
  const dir = makeFixtureRepo();
  const res = cli(['--integration-branch', 'main', '--run', ''], { cwd: dir });
  assert.strictEqual(res.status, 1);
  assert.strictEqual(res.stdout, '');
  assert.strictEqual(res.stderr, 'blast-radius: --run dir does not exist or is not a directory: \n');
});

test('AC9.1: a relative --run that exists resolves against the injected cwd', () => {
  const dir = makeFixtureRepo();
  fs.mkdirSync(path.join(dir, 'run'));
  fs.writeFileSync(path.join(dir, 'run', 'config.yml'), 'auto-merge-max-lines: 7\n');
  const res = cli(['--integration-branch', 'main', '--run', 'run'], { cwd: dir });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(JSON.parse(res.stdout).config.autoMergeMaxLines, 7);
});

// A deleted working directory makes the real cwd() throw. Before the entry contract git then
// failed in it and blast-radius printed git's one-line failure; with cwd() unreadable, git starts
// in the inherited directory, which GIT_DIR (injected) points away from any repository, so git's
// own failure is what reaches stderr. A relative --run is not a directory, as fs.statSync gave.
test('an unreadable cwd gives the same one-line failure and exit 1, never a stack trace', () => {
  const noRepo = path.join(scratchDir('blast-radius-nocwd-'), 'none.git');
  const opts = {
    env: { ...CLI_ENV, GIT_DIR: noRepo },
    deps: { cwd: () => { throw Object.assign(new Error('ENOENT: process.cwd failed'), { code: 'ENOENT' }); } },
  };
  const base = cli(['--base', 'HEAD'], opts);
  assert.strictEqual(base.status, 1);
  assert.strictEqual(base.stdout, '');
  assert.strictEqual(
    base.stderr,
    'blast-radius: --base "HEAD" does not resolve to a commit: Command failed: git rev-parse --verify --end-of-options HEAD^{commit}\n',
  );
  const rel = cli(['--base', 'HEAD', '--run', 'rel'], opts);
  assert.strictEqual(rel.status, 1);
  assert.strictEqual(rel.stdout, '');
  assert.strictEqual(rel.stderr, 'blast-radius: --run dir does not exist or is not a directory: rel\n');
});

// Repo B is bare (GIT_DIR only, injected): `git rev-parse --show-toplevel` fails there while
// merge-base still resolves, so the policy root must fall back to the injected cwd D, a non-repo
// directory that is not the process's cwd.
test('AC9.1: the policy root falls back to the injected cwd when show-toplevel fails', () => {
  const bare = path.join(scratchDir('blast-radius-bare-'), 'b.git');
  git(os.tmpdir(), 'clone', '--bare', makeFixtureRepo(), bare);
  const d = scratchDir('blast-radius-d-');
  fs.mkdirSync(path.join(d, '.claude-tweaks'));
  fs.writeFileSync(path.join(d, '.claude-tweaks', 'policy.yml'), 'auto-merge-max-lines: 7\n');
  assert.notStrictEqual(fs.realpathSync(d), fs.realpathSync(process.cwd()));
  const env = { ...CLI_ENV, GIT_DIR: bare };
  assert.throws(
    () => execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: d, env, stdio: 'ignore' }),
    'the fixture must make show-toplevel fail',
  );
  const res = cli(['--integration-branch', 'main'], { cwd: d, env });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(JSON.parse(res.stdout).config.autoMergeMaxLines, 7);
});
