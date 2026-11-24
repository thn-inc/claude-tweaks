'use strict';
// tests/resolve-ledger-verb.test.js — #3897: `bin/hooks.js resolve-ledger`, the
// read-only twin of delete-ledger. Prints which ledger belongs to this run
// (found/none/ambiguous/unattributable) so a skill never resolves one by
// listing docs/plans itself.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');

const { hookEnv, writeIdentity } = require('./helpers/git-fixtures');
const { runCli, spawnCli } = require('./helpers/run-cli');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function runHook(args, { cwd } = {}) {
  return runInProcess(args, { cwd });
}

// The temp dir's parent name contains a space, as a real checkout path can.
function gitRoot() {
  const root = fs.realpathSync(scratchDir('ct resolve ledger '));
  git(['init', '-q', '--initial-branch=main'], root);
  writeIdentity(root, { name: 'Test', email: 'test@example.com' });
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);
  return root;
}

function runDirFixture(root) {
  const runId = '2026-08-14T120000-spec-999';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  return runDir;
}

function commitInheritedLedger(root) {
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  const inherited = path.join(root, 'docs', 'plans', '2026-08-14-old-ledger.md');
  fs.writeFileSync(inherited, '# Open Items\n');
  git(['add', 'docs/plans/2026-08-14-old-ledger.md'], root);
  git(['commit', '-q', '-m', 'inherited ledger'], root);
  git(['checkout', '-q', '-b', 'feature'], root);
  return inherited;
}

test('AC1.1: resolve-ledger returns {run-dir}/ledger.md even with no materialized header (records unresolved)', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.writeFileSync(path.join(runDir, 'ledger.md'), '');
  const result = await runHook(['resolve-ledger', '--run', runDir], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.ok(result.stdout.startsWith('claude-tweaks: resolve-ledger: found\n'), result.stdout);
  assert.ok(result.stdout.includes(`this-run: ${path.join(runDir, 'ledger.md')}\n`), result.stdout);
});

test('AC2.1: an inherited ledger committed on main is reported as other-run, never this-run', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  const inherited = commitInheritedLedger(root);
  const result = await runHook(['resolve-ledger', '--run', runDir], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.ok(result.stdout.startsWith('claude-tweaks: resolve-ledger: none\n'), result.stdout);
  assert.ok(result.stdout.includes(`other-run: ${inherited}\n`), result.stdout);
  assert.doesNotMatch(result.stdout, /this-run:/);
});

test('AC2.1: an untracked owned ledger beside an inherited one: found + other-run', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  const inherited = commitInheritedLedger(root);
  const owned = path.join(root, 'docs', 'plans', '2026-08-15-new-ledger.md');
  fs.writeFileSync(owned, '# Open Items\n');
  const result = await runHook(['resolve-ledger', '--run', runDir], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.ok(result.stdout.startsWith('claude-tweaks: resolve-ledger: found\n'), result.stdout);
  assert.ok(result.stdout.includes(`this-run: ${owned}\n`), result.stdout);
  assert.ok(result.stdout.includes(`other-run: ${inherited}\n`), result.stdout);
});

test('two owned ledgers report ambiguous, naming both as this-run', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  const a = path.join(root, 'docs', 'plans', 'a-ledger.md');
  const b = path.join(root, 'docs', 'plans', 'b-ledger.md');
  fs.writeFileSync(a, '# A\n');
  fs.writeFileSync(b, '# B\n');
  const result = await runHook(['resolve-ledger', '--run', runDir], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.ok(result.stdout.startsWith('claude-tweaks: resolve-ledger: ambiguous\n'), result.stdout);
  assert.ok(result.stdout.includes(`this-run: ${a}\n`), result.stdout);
  assert.ok(result.stdout.includes(`this-run: ${b}\n`), result.stdout);
});

test('no --run exits 0 with "no pipeline run dir found — ledger not resolved"', async () => {
  const root = gitRoot();
  const result = await runHook(['resolve-ledger'], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.match(result.stderr, /no pipeline run dir found — ledger not resolved/);
  assert.strictEqual(result.stdout, '');
});

test('resolve-ledger leaves every ledger on disk', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.writeFileSync(path.join(runDir, 'ledger.md'), '# Open Items\n');
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  const planLedger = path.join(root, 'docs', 'plans', '2026-08-15-sample-ledger.md');
  fs.writeFileSync(planLedger, '# Open Items\n');
  const result = await runHook(['resolve-ledger', '--run', runDir], { cwd: root });
  assert.ok(result.stdout.startsWith('claude-tweaks: resolve-ledger: found\n'), result.stdout);
  assert.ok(fs.existsSync(path.join(runDir, 'ledger.md')));
  assert.ok(fs.existsSync(planLedger));
});

const REPORT_LINE_RE = /resolve-ledger: (found|none|ambiguous|unattributable)/;

test('resolve-ledger: --run "" refuses with "ledger not resolved" and no report line', async () => {
  const root = gitRoot();
  const result = await runHook(['resolve-ledger', '--run', ''], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.match(result.stderr, /ledger not resolved/);
  assert.doesNotMatch(result.stdout, REPORT_LINE_RE);
  assert.doesNotMatch(result.stdout, /claude-tweaks: --run|not resolved/);
});

test('resolve-ledger: no --run with two live candidate runs refuses, listing candidates, no report line', async () => {
  const root = gitRoot();
  for (const runId of ['2026-08-14T120000-spec-998', '2026-08-14T120100-spec-999']) {
    const dir = path.join(root, '.claude-tweaks', 'pipelines', runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  }
  const result = await runHook(['resolve-ledger'], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.match(result.stderr, /multiple candidate runs/);
  assert.match(result.stderr, /Ledger not resolved\./);
  assert.doesNotMatch(result.stdout, REPORT_LINE_RE);
  assert.doesNotMatch(result.stdout, /multiple candidate runs|not resolved/i);
});

// In-process (#5375): these call hooks.js's run(argv, deps) through runCli. The env is the complete
// environment the verb sees: the ambient one minus the four repo-pointing git variables, with any
// ambient run dir neutralized (#1130), and gh pointed at an unreachable host.
function inProcessEnv(env = {}) {
  return hookEnv({ GH_HOST: 'localhost', GH_TOKEN: 'x', ...env });
}

function runInProcess(args, { cwd, env } = {}) {
  return runCli(HOOKS, args, { cwd, env: inProcessEnv(env) });
}

// The env-only A/B fixture (cli-wrapper-contract.md): the run's recorded worktree is not a git checkout, and repo B
// (reachable only through GIT_DIR in the injected env, with a recorded origin/HEAD) has the ledger committed, so
// describeRunLedgers can tell it is another run's only when its ownership git children read that env.
test('AC10.1: resolve-ledger reports an inherited ledger as other-run only when describeRunLedgers reads the injected env', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  const worktree = fs.realpathSync(scratchDir('ct-resolve-ledger-nongit-'));
  const rel = 'docs/plans/2026-08-14-old-ledger.md';
  const ledger = path.join(worktree, ...rel.split('/'));
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.writeFileSync(ledger, '# Open Items\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree }));
  const b = gitRoot();
  fs.mkdirSync(path.join(b, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(b, ...rel.split('/')), '# Open Items\n');
  git(['add', rel], b);
  git(['commit', '-q', '-m', 'inherited ledger'], b);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], b);
  git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], b);
  const args = ['resolve-ledger', '--run', runDir];

  const ambient = await runInProcess(args, { cwd: root });
  assert.ok(ambient.stdout.startsWith('claude-tweaks: resolve-ledger: unattributable ('), ambient.stdout);
  const r = await runInProcess(args, { cwd: root, env: { GIT_DIR: path.join(b, '.git') } });
  assert.deepStrictEqual(r, { code: 0, stdout: `claude-tweaks: resolve-ledger: none\nother-run: ${ledger}\n`, stderr: '' });
});

// R8 (#5375): an implicit resolution reads PIPELINE_RUN_DIR as written, and every later fs call resolves a relative
// value against the process's real working directory. The guard therefore takes the value only when it names the
// same directory against the injected cwd and against the real one. These run with the real cwd moved to a fixture
// dir (restored after), never the test runner's checkout, and with two live runs, so a fall-through to the run scan
// refuses as ambiguous instead of guessing.
function twoRunRoot() {
  const root = gitRoot();
  const runs = ['2026-08-14T120000-spec-998', '2026-08-14T120100-spec-999'].map((runId) => {
    const dir = path.join(root, '.claude-tweaks', 'pipelines', runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ status: 'active' }));
    fs.writeFileSync(path.join(dir, 'ledger.md'), '# Open Items\n');
    return dir;
  });
  return { root, runs };
}

async function withRealCwd(dir, body) {
  const before = process.cwd();
  process.chdir(dir);
  try {
    return await body();
  } finally {
    process.chdir(before);
  }
}

function assertFellThrough(r) {
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '', 'no report: the PIPELINE_RUN_DIR value was not taken');
  assert.match(r.stderr, /multiple candidate runs/);
  assert.match(r.stderr, /Ledger not resolved\.\n$/);
}

test('R8: a relative PIPELINE_RUN_DIR naming a different directory against the real cwd falls through to the run scan', async () => {
  const { root } = twoRunRoot();
  const elsewhere = fs.realpathSync(scratchDir('ct-resolve-ledger-real-cwd-'));
  const r = await withRealCwd(elsewhere, () => runInProcess(['resolve-ledger'], { cwd: root, env: { PIPELINE_RUN_DIR: '.' } }));
  assertFellThrough(r);
});

test('R8: a relative PIPELINE_RUN_DIR naming the same directory against both cwds is taken as written', async () => {
  const { root, runs } = twoRunRoot();
  const rel = path.relative(root, runs[0]);
  const r = await withRealCwd(root, () => runInProcess(['resolve-ledger'], { cwd: root, env: { PIPELINE_RUN_DIR: rel } }));
  assert.deepStrictEqual(r, { code: 0, stdout: `claude-tweaks: resolve-ledger: found\nthis-run: ${path.join(rel, 'ledger.md')}\n`, stderr: '' });
});

test('R8: a relative PIPELINE_RUN_DIR naming a file falls through to the run scan', async () => {
  const { root } = twoRunRoot();
  fs.writeFileSync(path.join(root, 'not-a-run.txt'), 'x\n');
  const r = await withRealCwd(root, () => runInProcess(['resolve-ledger'], { cwd: root, env: { PIPELINE_RUN_DIR: 'not-a-run.txt' } }));
  assertFellThrough(r);
});

// real process: the script entry (shebang, process.argv, the exit code) of the resolve-ledger success path (AC5.1),
// twinned with the same resolution in-process.
test('AC5.1: resolve-ledger on a run-dir ledger through runCli and spawnCli returns the same code and stdout', async () => {
  const inProcess = gitRoot();
  const spawned = gitRoot();
  const runA = runDirFixture(inProcess);
  const runB = runDirFixture(spawned);
  fs.writeFileSync(path.join(runA, 'ledger.md'), '# Open Items\n');
  fs.writeFileSync(path.join(runB, 'ledger.md'), '# Open Items\n');
  const a = await runInProcess(['resolve-ledger', '--run', runA], { cwd: inProcess });
  const b = spawnCli(HOOKS, ['resolve-ledger', '--run', runB], { cwd: spawned, env: inProcessEnv() });
  const shape = (r, run) => ({ code: r.code, stdout: r.stdout.split(path.join(run, 'ledger.md')).join('<ledger>'), stderr: r.stderr });
  assert.deepStrictEqual(shape(a, runA), shape(b, runB));
  assert.deepStrictEqual(shape(a, runA), { code: 0, stdout: 'claude-tweaks: resolve-ledger: found\nthis-run: <ledger>\n', stderr: '' });
});
