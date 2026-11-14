// tests/resolve-policy-entry.test.js
// plugin/bin/resolve-policy.js splits into a core (`resolvePolicy`, returns an object), a printing
// `run(argv, deps)` and exported `realDeps`, behind a `require.main` guard (#5374). The five
// "script entry" tests pin what the CLI prints as a script and pass before and after the split; the
// rest prove the in-process path reaches git, gh, the home directory and the working directory only
// through `deps`.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');
const { runCli, runCliSync, spawnCli } = require('./helpers/run-cli');
const { STUB_SKIP } = require('./helpers/path-stub');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'resolve-policy.js');
const USAGE = 'resolve-policy: usage: resolve-policy.js [--values | --all] [--mcp-reachable] [--run <dir>] <key> [<key>…]\n';
const GH_ORIGIN = 'https://github.com/o/r.git';
const GHE_ORIGIN = 'https://ghe.example.test/o/r.git';
const GHE_HOST = 'ghe.example.test';

const ENV = { ...process.env };
delete ENV.GH_HOST;
delete ENV.GH_REPO;

const scratch = [];
after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});
function tmp(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `rp-entry-${prefix}-`)));
  scratch.push(d);
  return d;
}

// A fixture git call that ignores any repo-locating variable the test process inherited.
function git(cwd, args) {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[k];
  return execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

function repo(policy) {
  const dir = tmp('repo');
  git(dir, ['init', '-q', '-b', 'main']);
  if (policy !== undefined) {
    fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), policy);
  }
  return dir;
}

function initCommitted(prefix) {
  const dir = tmp(prefix);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

// Repo A has no remote; repo B has origin and a recorded origin/HEAD. `GIT_DIR=<B>/.git` in a child
// whose cwd is A reads B's remote and refs while `--show-toplevel` still prints A.
function forgePair({ origin }) {
  const a = initCommitted('a');
  const b = initCommitted('b');
  git(b, ['remote', 'add', 'origin', origin]);
  git(b, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(b, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  return { a, b, gitDir: path.join(b, '.git') };
}

// A `gh` script in its own directory, for an injected-only PATH.
function ghStubDir(body) {
  const dir = tmp('gh-stub');
  const file = path.join(dir, 'gh');
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755); // root-safe: exec-bit stub, not a denial simulation
  return dir;
}

// ---- script entry: what the CLI prints as a script, before and after the split ----

test('AC5.1 script entry: --values autonomy', () => {
  const cwd = repo('autonomy: trusted\n');
  assert.deepStrictEqual(spawnCli(CLI, ['--values', 'autonomy'], { cwd, env: ENV }), { code: 0, stdout: 'trusted\n', stderr: '' });
});

test('AC5.1 script entry: --all', () => {
  const cwd = repo();
  const res = spawnCli(CLI, ['--all'], { cwd, env: ENV });
  assert.equal(res.code, 0);
  assert.equal(res.stderr, '');
  assert.equal(res.stdout.split('\n').filter(Boolean).length, 1);
  const parsed = JSON.parse(res.stdout);
  assert.deepStrictEqual(Object.keys(parsed), POLICY_KEYS.map((r) => r.key));
  assert.deepStrictEqual(
    Object.keys(parsed.autonomy).sort(),
    ['category', 'default', 'source', 'summary', 'tier', 'type', 'value'],
  );
});

test('AC5.1 script entry: an invalid value in policy.yml', () => {
  const cwd = repo('autonomy: bogus\n');
  assert.deepStrictEqual(spawnCli(CLI, ['--values', 'autonomy'], { cwd, env: ENV }), {
    code: 0,
    stdout: 'supervised\n',
    stderr: 'resolve-policy: warning: autonomy has invalid value "bogus" — using default "supervised"\n',
  });
});

test('AC5.1 script entry: --run with a path that does not exist', () => {
  const cwd = repo();
  const missing = path.join(fs.realpathSync(os.tmpdir()), 'ct-no-such-run-dir');
  assert.deepStrictEqual(spawnCli(CLI, ['--run', missing, 'autonomy'], { cwd, env: ENV }), {
    code: 1,
    stdout: '',
    stderr: `resolve-policy: --run dir does not exist or is not a directory: ${missing}\n`,
  });
});

test('AC5.1 script entry: no arguments', () => {
  const cwd = repo();
  assert.deepStrictEqual(spawnCli(CLI, [], { cwd, env: ENV }), { code: 1, stdout: '', stderr: USAGE });
});

// ---- in-process: the helpers agree with a real process ----

test('AC4.1: runCliSync and spawnCli agree for --values autonomy and for no arguments', async () => {
  const cwd = repo('autonomy: trusted\n');
  for (const args of [['--values', 'autonomy'], []]) {
    const spawned = spawnCli(CLI, args, { cwd, env: ENV });
    assert.deepStrictEqual(await runCli(CLI, args, { cwd, env: ENV }), spawned);
    assert.deepStrictEqual(runCliSync(CLI, args, { cwd, env: ENV }), spawned);
  }
});

test('AC5.2: runCliSync and spawnCli agree for --all, an invalid value and a missing --run path', () => {
  const missing = path.join(fs.realpathSync(os.tmpdir()), 'ct-no-such-run-dir');
  const cases = [
    { cwd: repo(), args: ['--all'] },
    { cwd: repo('autonomy: bogus\n'), args: ['--values', 'autonomy'] },
    { cwd: repo(), args: ['--run', missing, 'autonomy'] },
  ];
  for (const { cwd, args } of cases) {
    assert.deepStrictEqual(runCliSync(CLI, args, { cwd, env: ENV }), spawnCli(CLI, args, { cwd, env: ENV }), args.join(' '));
  }
});

test('AC6.1: requiring the CLI prints nothing and leaves process.exitCode undefined', () => {
  const res = spawnSync(
    process.execPath,
    ['-e', 'const m = require(process.argv[1]); process.stdout.write(JSON.stringify({ exitCodeUnset: process.exitCode === undefined, keys: Object.keys(m).sort() }))', CLI],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
  assert.equal(res.stdout, '{"exitCodeUnset":true,"keys":["EXIT_INVOCATION","EXIT_OK","callerDeps","realDeps","resolvePolicy","run","scalarValue","warningLines"]}');
});

test('AC7.1: the core returns the entries run prints, and writes nothing to stdout', () => {
  const cwd = repo('autonomy: trusted\n');
  const { resolvePolicy, realDeps } = require(CLI);
  const deps = { cwd: () => cwd, env: ENV, git: realDeps.git, readFile: realDeps.readFile };
  const original = process.stdout.write;
  let writes = 0;
  let out;
  process.stdout.write = function counted() { writes += 1; return true; };
  try {
    out = resolvePolicy({ keys: ['autonomy', 'auto-mode'] }, deps);
  } finally {
    process.stdout.write = original;
  }
  assert.equal(writes, 0);
  assert.equal(out.code, 0);
  assert.deepStrictEqual(out.result, JSON.parse(runCliSync(CLI, ['autonomy', 'auto-mode'], { cwd, env: ENV }).stdout));
});

test('AC7.2: the core refuses a worktree-local runDir with run\'s message and reads no config.yml', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const wtRun = path.join(wt, '.claude-tweaks', 'pipelines', 'r');
  fs.mkdirSync(wtRun, { recursive: true });
  fs.writeFileSync(path.join(wtRun, 'config.yml'), 'autonomy: unattended\n');
  const { resolvePolicy, realDeps } = require(CLI);
  const seen = [];
  const deps = {
    cwd: () => wt,
    env: ENV,
    git: realDeps.git,
    readFile: (p) => { seen.push(p); return realDeps.readFile(p); },
  };
  const out = resolvePolicy({ keys: ['autonomy'], runDir: wtRun }, deps);
  assert.equal(out.code, 1);
  assert.equal(typeof out.message, 'string');
  assert.match(out.message, /resolves outside the main checkout/);
  assert.deepStrictEqual(seen.filter((p) => p.endsWith('config.yml')), []);
  assert.deepStrictEqual(
    runCliSync(CLI, ['--run', wtRun, 'autonomy'], { cwd: wt, env: ENV }),
    { code: 1, stdout: '', stderr: `resolve-policy: ${out.message}\n` },
  );
});

test('AC3.1: an in-process integration-model call runs a gh stub that is only on the injected PATH', { skip: STUB_SKIP }, () => {
  const { a, gitDir } = forgePair({ origin: GH_ORIGIN });
  const marker = path.join(tmp('marker'), 'ran');
  const stubDir = ghStubDir(`echo ran > "${marker}"`);
  const env = { ...ENV, GIT_DIR: gitDir, PATH: stubDir + path.delimiter + process.env.PATH };
  assert.deepStrictEqual(
    runCliSync(CLI, ['--values', 'integration-model'], { cwd: a, env, fresh: true }),
    { code: 0, stdout: 'pr-first\n', stderr: '' },
  );
  assert.equal(fs.existsSync(marker), true);
});

test('Review Focus 3: a relative --run value resolves against the injected cwd', () => {
  const cwd = repo();
  const runDir = path.join(cwd, '.claude-tweaks', 'pipelines', 'r');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'integration-model: local-merge\n');
  assert.deepStrictEqual(
    runCliSync(CLI, ['--values', '--run', path.join('.claude-tweaks', 'pipelines', 'r'), 'integration-model'], { cwd, env: ENV }),
    { code: 0, stdout: 'local-merge\n', stderr: '' },
  );
});

test('Review Focus 3: a cwd outside any git repository reads that directory\'s policy.yml', (t) => {
  const dir = tmp('norepo');
  if (spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { windowsHide: true }).status === 0) {
    t.skip('the temp directory is inside a git repository');
    return;
  }
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  // The value must differ from the policy.yml at process.cwd(), or reading the wrong one goes unseen.
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'autonomy: trusted\n');
  const args = ['--values', 'autonomy'];
  assert.notStrictEqual(
    runCliSync(CLI, args, { cwd: process.cwd(), env: ENV }).stdout,
    'trusted\n',
    'the autonomy value at process.cwd() equals the fixture\'s: pick another fixture value',
  );
  const res = runCliSync(CLI, args, { cwd: dir, env: ENV });
  assert.equal(res.stdout, 'trusted\n');
  assert.deepStrictEqual(res, spawnCli(CLI, args, { cwd: dir, env: ENV }));
});

test('the repo-root lookup runs git with the injected env', () => {
  const a = repo();
  const b = repo('autonomy: unattended\n');
  const env = { ...ENV, GIT_DIR: path.join(b, '.git'), GIT_WORK_TREE: b };
  assert.deepStrictEqual(
    runCliSync(CLI, ['--values', 'autonomy'], { cwd: a, env }),
    { code: 0, stdout: 'unattended\n', stderr: '' },
  );
});

test('two fixture repos back to back in one process each get their own answer', { skip: STUB_SKIP }, () => {
  const one = repo('autonomy: trusted\n');
  git(one, ['remote', 'add', 'origin', GH_ORIGIN]);
  const two = repo('autonomy: unattended\n');
  const stubDir = ghStubDir('exit 0');
  const env = { ...ENV, PATH: stubDir + path.delimiter + process.env.PATH };
  const args = ['--values', 'autonomy', 'integration-model'];
  assert.equal(runCliSync(CLI, args, { cwd: one, env }).stdout, 'trusted\npr-first\n');
  assert.equal(runCliSync(CLI, args, { cwd: two, env }).stdout, 'unattended\nlocal-merge\n');
  assert.equal(runCliSync(CLI, args, { cwd: one, env }).stdout, 'trusted\npr-first\n');
});

test('a GitHub Enterprise origin reads hosts.yml under the injected HOME, in-process', { skip: STUB_SKIP }, () => {
  const { a, gitDir } = forgePair({ origin: GHE_ORIGIN });
  const marker = path.join(tmp('marker'), 'host');
  const stubDir = ghStubDir(`printf '%s' "$GH_HOST" > "${marker}"`);
  const home = tmp('home');
  fs.mkdirSync(path.join(home, '.config', 'gh'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'gh', 'hosts.yml'), `${GHE_HOST}:\n`);
  const env = { ...ENV, GIT_DIR: gitDir, PATH: stubDir + path.delimiter + process.env.PATH, HOME: home, USERPROFILE: home };
  delete env.GH_CONFIG_DIR;
  delete env.XDG_CONFIG_HOME;
  const res = runCliSync(CLI, ['--values', 'integration-model'], { cwd: a, env, fresh: true });
  assert.equal(res.code, 0);
  assert.equal(res.stdout, 'pr-first\n');
  assert.match(res.stderr, /gh calls get GH_HOST=ghe\.example\.test/);
  assert.equal(fs.readFileSync(marker, 'utf8').trim(), GHE_HOST);
});

// A pinned integration-model skips the forge probe, so the merge-verification default-branch lookup
// is the first gh call and prints the GitHub Enterprise note itself.
test('a pinned integration-model with a GitHub Enterprise origin: the merge-verification note goes to deps.stderr, in-process', { skip: STUB_SKIP }, () => {
  const { a, gitDir } = forgePair({ origin: GHE_ORIGIN });
  fs.mkdirSync(path.join(a, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(a, '.github', 'workflows', 'ci.yml'), 'on:\n  pull_request:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n');
  fs.mkdirSync(path.join(a, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(a, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  const stubDir = ghStubDir('echo main');
  const home = tmp('home');
  fs.mkdirSync(path.join(home, '.config', 'gh'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'gh', 'hosts.yml'), `${GHE_HOST}:\n`);
  const env = { ...ENV, GIT_DIR: gitDir, PATH: stubDir + path.delimiter + process.env.PATH, HOME: home, USERPROFILE: home };
  delete env.GH_CONFIG_DIR;
  delete env.XDG_CONFIG_HOME;
  const args = ['--values', 'merge-verification'];
  const res = runCliSync(CLI, args, { cwd: a, env, fresh: true });
  assert.deepStrictEqual(res, spawnCli(CLI, args, { cwd: a, env }));
  assert.equal(res.code, 0);
  assert.equal(res.stdout, 'merge-when-green\n');
  assert.match(res.stderr, /gh calls get GH_HOST=ghe\.example\.test/);
});

// ---- in-process caller surface (#5384) ----

const { scalarValue, warningLines, callerDeps, resolvePolicy, EXIT_OK, EXIT_INVOCATION } = require(CLI);

test('scalarValue: the --values rule', () => {
  assert.equal(scalarValue(undefined), '');
  assert.equal(scalarValue({ error: 'unknown-key' }), '');
  assert.equal(scalarValue({ value: null }), '');
  assert.equal(scalarValue({ value: 3 }), '3');
  assert.equal(scalarValue({ value: 'pr-first' }), 'pr-first');
});

test('warningLines equals what run prints on stderr, in --values and JSON mode', () => {
  const cwd = repo('autonomy: bogus\n');
  for (const [argv, values] of [[['--values', 'autonomy'], true], [['autonomy'], false]]) {
    const out = { keys: ['autonomy'], ...resolvePolicy({ keys: ['autonomy'] }, callerDeps({ cwd, env: ENV })) };
    const expected = warningLines(out, { values }).join('');
    const { stderr } = runCliSync(CLI, argv, { cwd, env: ENV });
    assert.equal(stderr, expected);
    if (values) assert.match(stderr, /resolve-policy: warning: autonomy has invalid value "bogus"/);
    else assert.equal(stderr, '');
  }
});

test('callerDeps: the core resolves the given cwd, not the process cwd (AC7)', () => {
  const fixture = repo('autonomy: trusted\n');
  const here = path.join(__dirname, '..');
  const fromFixture = resolvePolicy({ keys: ['autonomy'] }, callerDeps({ cwd: fixture, env: ENV })).result.autonomy.value;
  const fromRepo = resolvePolicy({ keys: ['autonomy'] }, callerDeps({ cwd: here, env: ENV })).result.autonomy.value;
  assert.equal(fromFixture, 'trusted');
  assert.notEqual(fromRepo, fromFixture, 'this repo resolves autonomy to the fixture value: pick another fixture value');
});

test('callerDeps: a git that never exits is killed at gitTimeoutMs and the root falls back to cwd', { skip: STUB_SKIP, timeout: 10000 }, () => {
  const fixture = repo('autonomy: trusted\n');
  const stubDir = tmp('git-stub');
  const stub = path.join(stubDir, 'git');
  // /bin/sleep is absolute: the injected PATH holds only the stub, so a bare sleep would exit 127 at once.
  fs.writeFileSync(stub, '#!/bin/sh\nexec /bin/sleep 30\n');
  fs.chmodSync(stub, 0o755); // root-safe: exec-bit stub, not a denial simulation
  const started = Date.now();
  const out = resolvePolicy({ keys: ['autonomy'] }, callerDeps({ cwd: fixture, env: { PATH: stubDir }, gitTimeoutMs: 300 }));
  assert.ok(Date.now() - started < 5000);
  assert.equal(out.code, EXIT_OK);
  assert.equal(out.result.autonomy.value, 'trusted');
});

test('EXIT_INVOCATION is what a refused --run returns', () => {
  const fixture = repo();
  const out = resolvePolicy({ keys: ['autonomy'], runDir: '/no/such/dir' }, callerDeps({ cwd: fixture, env: ENV }));
  assert.equal(out.code, EXIT_INVOCATION);
  assert.equal(EXIT_INVOCATION, 1);
  assert.equal(EXIT_OK, 0);
});
