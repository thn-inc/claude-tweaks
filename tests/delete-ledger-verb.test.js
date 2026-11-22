'use strict';
// tests/delete-ledger-verb.test.js — #2546: `bin/hooks.js delete-ledger`,
// giving wrap-up cleanup item 2 (ledger deletion) a sanctioned verb instead
// of a hand-run `rm`/Bash call.
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

async function runHook(args, { cwd } = {}) {
  const r = await runInProcess(args, { cwd });
  return { code: r.code, stdout: r.stdout };
}

function gitRoot() {
  const root = fs.realpathSync(scratchDir('ct-delledger-'));
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

test('delete-ledger: deletes {run-dir}/ledger.md when present and exits cleanly', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.writeFileSync(path.join(runDir, 'ledger.md'), '# Open Items\n');
  const result = await runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /deleted ledger/);
  assert.ok(!fs.existsSync(path.join(runDir, 'ledger.md')));
});

test('delete-ledger: falls back to the single docs/plans/*-ledger.md candidate when no run-dir ledger.md exists', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  const ledgerPath = path.join(root, 'docs', 'plans', '2026-08-14-sample-ledger.md');
  fs.writeFileSync(ledgerPath, '# Open Items\n');
  const result = await runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /deleted ledger/);
  assert.ok(!fs.existsSync(ledgerPath));
});

test('delete-ledger: an inherited docs/plans ledger committed on main is not deleted, and the not-found report names it (#3686)', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  const inherited = path.join(root, 'docs', 'plans', '2026-08-14-old-ledger.md');
  fs.writeFileSync(inherited, '# Open Items\n');
  git(['add', 'docs/plans/2026-08-14-old-ledger.md'], root);
  git(['commit', '-q', '-m', 'inherited ledger'], root);
  git(['checkout', '-q', '-b', 'feature'], root);
  const result = await runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /only inherited ledgers found: .*2026-08-14-old-ledger\.md/);
  assert.match(result.stdout, /not found/);
  assert.ok(fs.existsSync(inherited));
});

test('delete-ledger: an explicit --ledger naming a missing file keeps the plain not-found line (no inherited diagnostic)', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  const inherited = path.join(root, 'docs', 'plans', '2026-08-14-old-ledger.md');
  fs.writeFileSync(inherited, '# Open Items\n');
  git(['add', 'docs/plans/2026-08-14-old-ledger.md'], root);
  git(['commit', '-q', '-m', 'inherited ledger'], root);
  git(['checkout', '-q', '-b', 'feature'], root);
  const missing = path.join(root, 'docs', 'plans', 'missing-ledger.md');
  const result = await runHook(['delete-ledger', '--run', runDir, '--ledger', missing], { cwd: root });
  assert.match(result.stdout, /not found/);
  assert.doesNotMatch(result.stdout, /inherited/);
  assert.ok(fs.existsSync(inherited));
});

test('delete-ledger: unattributable arm — a non-git run-state worktree prints "cannot attribute" and keeps the ledger', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  const nonGit = fs.realpathSync(scratchDir('ct-delledger-nongit-'));
  fs.mkdirSync(path.join(nonGit, 'docs', 'plans'), { recursive: true });
  const ledger = path.join(nonGit, 'docs', 'plans', '2026-08-14-x-ledger.md');
  fs.writeFileSync(ledger, '# Open Items\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: nonGit }));
  const result = await runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /cannot attribute docs\/plans ledgers to 2026-08-14T120000-spec-999/);
  assert.match(result.stdout, /ledger not deleted/);
  assert.ok(fs.existsSync(ledger));
});

test('delete-ledger: running it again on an already-deleted ledger reports not-found, not a crash', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.writeFileSync(path.join(runDir, 'ledger.md'), '# Open Items\n');
  await runHook(['delete-ledger', '--run', runDir], { cwd: root });
  const second = await runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.strictEqual(second.code, 0);
  assert.match(second.stdout, /no ledger found for 2026-08-14T120000-spec-999 — not found\n$/);
  assert.doesNotMatch(second.stdout, /inherited/);
});

test('delete-ledger: 2+ docs/plans/*-ledger.md candidates refuses to guess, naming all candidates', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'a-ledger.md'), '# A\n');
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'b-ledger.md'), '# B\n');
  const result = await runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /candidate ledgers found/);
  assert.match(result.stdout, /a-ledger\.md/);
  assert.match(result.stdout, /b-ledger\.md/);
  assert.ok(fs.existsSync(path.join(root, 'docs', 'plans', 'a-ledger.md')));
  assert.ok(fs.existsSync(path.join(root, 'docs', 'plans', 'b-ledger.md')));
});

test('delete-ledger: --ledger explicitly overrides resolution, deleting the named file', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'a-ledger.md'), '# A\n');
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'b-ledger.md'), '# B\n');
  const result = await runHook(['delete-ledger', '--run', runDir, '--ledger', path.join(root, 'docs', 'plans', 'a-ledger.md')], { cwd: root });
  assert.match(result.stdout, /deleted ledger/);
  assert.ok(!fs.existsSync(path.join(root, 'docs', 'plans', 'a-ledger.md')));
  assert.ok(fs.existsSync(path.join(root, 'docs', 'plans', 'b-ledger.md')));
});

test('delete-ledger: --ledger naming a file outside the run dir and worktree is refused, nothing deleted', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  const outside = fs.realpathSync(scratchDir('ct-delledger-outside-'));
  const victim = path.join(outside, 'victim-ledger.md');
  fs.writeFileSync(victim, '# keep me\n');
  const result = await runHook(['delete-ledger', '--run', runDir, '--ledger', victim], { cwd: root });
  assert.match(result.stdout, /rejected \(outside the run directory and worktree\)/);
  assert.ok(fs.existsSync(victim));
});

test('delete-ledger: no --run exits cleanly with a clear message, nothing deleted', async () => {
  const root = gitRoot();
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'a-ledger.md'), '# A\n');
  const result = await runHook(['delete-ledger'], { cwd: root });
  assert.match(result.stdout, /no pipeline run dir found/);
  assert.ok(fs.existsSync(path.join(root, 'docs', 'plans', 'a-ledger.md')));
});

test('delete-ledger --help prints usage and does nothing', async () => {
  const root = gitRoot();
  const result = await runHook(['delete-ledger', '--help'], { cwd: root });
  assert.match(result.stdout, /usage: delete-ledger/);
});

// Characterization (#4026 Task 8, written before the verb logged anything):
// every report's exact stdout, exit code and empty stderr — the self-logging
// change must leave all three untouched.
function runHookFull(args, { cwd, env = {} } = {}) {
  return runInProcess(args, { cwd, env });
}

function decisionsText(runDir) {
  try { return fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch { return null; }
}

// The four reports that leave the ledger on disk with a resolved run dir.
const LEFT_ON_DISK = {
  'failed to delete': (root, runDir) => {
    fs.mkdirSync(path.join(runDir, 'ledger.md'));
    return { args: ['delete-ledger', '--run', runDir], stdout: new RegExp(`^claude-tweaks: delete-ledger: failed to delete ${path.join(runDir, 'ledger.md').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(.+\\)\\n$`) };
  },
  rejected: (root, runDir) => {
    const outside = fs.realpathSync(scratchDir('ct-delledger-outside-'));
    const victim = path.join(outside, 'victim-ledger.md');
    fs.writeFileSync(victim, '# keep me\n');
    return { args: ['delete-ledger', '--run', runDir, '--ledger', victim], stdout: `claude-tweaks: delete-ledger: --ledger ${victim} rejected (outside the run directory and worktree) — ledger not deleted\n` };
  },
  ambiguous: (root, runDir) => {
    fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'plans', 'a-ledger.md'), '# A\n');
    fs.writeFileSync(path.join(root, 'docs', 'plans', 'b-ledger.md'), '# B\n');
    const plans = path.join(root, 'docs', 'plans');
    return { args: ['delete-ledger', '--run', runDir], stdout: `claude-tweaks: delete-ledger: 2 candidate ledgers found, cannot pick one — pass --ledger <path> explicitly:\n  ${path.join(plans, 'a-ledger.md')}\n  ${path.join(plans, 'b-ledger.md')}\nLedger not deleted.\n` };
  },
  unattributable: (root, runDir) => {
    const nonGit = fs.realpathSync(scratchDir('ct-delledger-nongit-'));
    fs.mkdirSync(path.join(nonGit, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(nonGit, 'docs', 'plans', '2026-08-14-x-ledger.md'), '# Open Items\n');
    fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: nonGit }));
    return { args: ['delete-ledger', '--run', runDir], stdout: /^claude-tweaks: delete-ledger: cannot attribute docs\/plans ledgers to 2026-08-14T120000-spec-999 \(.+\) — pass --ledger <path> explicitly; ledger not deleted\n$/ };
  },
};

for (const [report, setup] of Object.entries(LEFT_ON_DISK)) {
  test(`characterization: the ${report} report keeps its stdout, exit 0 and an empty stderr`, async () => {
    const root = gitRoot();
    const runDir = runDirFixture(root);
    const { args, stdout } = setup(root, runDir);
    const result = await runHookFull(args, { cwd: root });
    assert.strictEqual(result.code, 0);
    if (typeof stdout === 'string') assert.strictEqual(result.stdout, stdout);
    else assert.match(result.stdout, stdout);
    assert.strictEqual(result.stderr, '');
  });
}

test('characterization: deleted and not found keep their stdout and exit 0, and write no decisions.md', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  const ledger = path.join(runDir, 'ledger.md');
  fs.writeFileSync(ledger, '# Open Items\n');
  const first = await runHookFull(['delete-ledger', '--run', runDir], { cwd: root });
  assert.deepStrictEqual(first, { code: 0, stdout: `claude-tweaks: deleted ledger ${ledger}\n`, stderr: '' });
  const second = await runHookFull(['delete-ledger', '--run', runDir], { cwd: root });
  assert.deepStrictEqual(second, { code: 0, stdout: 'claude-tweaks: delete-ledger: no ledger found for 2026-08-14T120000-spec-999 — not found\n', stderr: '' });
  assert.strictEqual(decisionsText(runDir), null);
});

test('characterization: no run dir found prints its refusal, exits 0 and writes no decisions.md', async () => {
  const root = gitRoot();
  const result = await runHookFull(['delete-ledger'], { cwd: root });
  assert.deepStrictEqual(result, { code: 0, stdout: 'claude-tweaks: no pipeline run dir found — ledger not deleted\n', stderr: '' });
  assert.ok(!fs.existsSync(path.join(root, '.claude-tweaks')));
});

// AC3.1 (#4026 Task 8): with an anchored run dir, a report that leaves the
// ledger on disk appends its own SKIP line under `## /wrap-up` — the line
// cleanup-procedures.md Item 2 told the agent to hand-log.
function skipLine(report) {
  return new RegExp(`^## /wrap-up\\n- SKIP \\d{2}:\\d{2}:\\d{2} — Cleanup item 2 delete-ledger \\(skipped\\): condition: delete-ledger reported ${report} → fallback: ledger left on disk, nothing committed for item 2\\. Reversibility: n/a\\.\\n$`);
}

test('AC3.1: a failed delete logs the SKIP line; deleted and not found log nothing', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(runDir, 'ledger.md'));
  const failed = await runHookFull(['delete-ledger', '--run', runDir], { cwd: root });
  assert.strictEqual(failed.code, 0);
  assert.match(failed.stdout, /failed to delete/);
  assert.strictEqual(failed.stderr, '');
  assert.match(decisionsText(runDir), skipLine('failed to delete'));

  const cleanRoot = gitRoot();
  const clean = runDirFixture(cleanRoot);
  fs.writeFileSync(path.join(clean, 'ledger.md'), '# Open Items\n');
  const deleted = await runHookFull(['delete-ledger', '--run', clean], { cwd: cleanRoot });
  assert.match(deleted.stdout, /deleted ledger/);
  assert.strictEqual(decisionsText(clean), null, 'deleted logs nothing');
  const again = await runHookFull(['delete-ledger', '--run', clean], { cwd: cleanRoot });
  assert.match(again.stdout, /— not found\n$/);
  assert.strictEqual(decisionsText(clean), null, 'not found logs nothing');
});

for (const report of ['rejected', 'ambiguous', 'unattributable']) {
  test(`AC3.1: the ${report} report logs the SKIP line with stdout and exit code unchanged`, async () => {
    const root = gitRoot();
    const runDir = runDirFixture(root);
    const { args } = LEFT_ON_DISK[report](root, runDir);
    const result = await runHookFull(args, { cwd: root });
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stderr, '');
    assert.match(decisionsText(runDir), skipLine(report));
  });
}

test('AC3.1: a run dir that is not anchored under a checkout logs nothing', async () => {
  const root = gitRoot();
  const loose = fs.realpathSync(scratchDir('ct-delledger-loose-'));
  fs.mkdirSync(path.join(loose, 'ledger.md'));
  const result = await runHookFull(['delete-ledger'], { cwd: root, env: { PIPELINE_RUN_DIR: loose } });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /failed to delete/);
  assert.strictEqual(result.stderr, '');
  assert.strictEqual(decisionsText(loose), null);
});

test('AC3.1: a candidate refusal logs nothing in any candidate run dir', async () => {
  const root = gitRoot();
  const a = runDirFixture(root);
  const b = path.join(path.dirname(a), '2026-08-14T130000-spec-998');
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(b, 'run-state.json'), JSON.stringify({ status: 'active' }));
  fs.mkdirSync(path.join(a, 'ledger.md'));
  fs.mkdirSync(path.join(b, 'ledger.md'));
  const result = await runHookFull(['delete-ledger'], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /pass --run explicitly/);
  assert.strictEqual(decisionsText(a), null);
  assert.strictEqual(decisionsText(b), null);
});

test('AC3.1: a failed append keeps stdout and exit 0 and adds one stderr line', async () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(runDir, 'ledger.md'));
  fs.mkdirSync(path.join(runDir, 'decisions.md'));
  const result = await runHookFull(['delete-ledger', '--run', runDir], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /^claude-tweaks: delete-ledger: failed to delete .+\n$/);
  assert.match(result.stderr, /^claude-tweaks: delete-ledger: decisions\.md append failed \(.+\) — hand-log the Item 2 SKIP line\n$/);
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

// What this platform's fs makes of `<dir>/<name>/` on a file, through the calls delete-ledger makes on an explicit
// --ledger (existsSync, realpathSync, unlinkSync), probed on a sacrificial copy: POSIX refuses the trailing slash,
// so the verb reports not-found; a platform that tolerates it goes on to the realpath and the unlink.
function slashOutcome(dir) {
  const probe = `${dir}${path.sep}probe-ledger.md/`;
  fs.writeFileSync(path.join(dir, 'probe-ledger.md'), '# probe\n');
  try {
    if (!fs.existsSync(probe)) return { kind: 'not-found' };
    try { fs.realpathSync(probe); } catch { return { kind: 'rejected' }; }
    try { fs.unlinkSync(probe); return { kind: 'deleted' }; } catch (err) { return { kind: 'failed', message: err.message }; }
  } finally {
    fs.rmSync(path.join(dir, 'probe-ledger.md'), { force: true });
  }
}

test('#5375: delete-ledger --ledger <relative> deletes against the injected cwd and prints the typed path', async () => {
  const root = gitRoot();
  const run = runDirFixture(root);
  const ledger = path.join(run, 'x-ledger.md');
  fs.writeFileSync(ledger, '# ledger\n');
  // A trailing slash is joined onto the cwd unnormalized, so the kernel sees it as a bare read did at base.
  const outcome = slashOutcome(run);
  const slash = await runInProcess(['delete-ledger', '--run', run, '--ledger', 'x-ledger.md/'], { cwd: run });
  const expected = {
    'not-found': `claude-tweaks: delete-ledger: no ledger found for ${path.basename(run)} — not found\n`,
    rejected: 'claude-tweaks: delete-ledger: --ledger x-ledger.md/ rejected (outside the run directory and worktree) — ledger not deleted\n',
    deleted: 'claude-tweaks: deleted ledger x-ledger.md/\n',
    failed: `claude-tweaks: delete-ledger: failed to delete x-ledger.md/ (${String(outcome.message).split('probe-ledger.md').join('x-ledger.md')})\n`,
  }[outcome.kind];
  assert.deepStrictEqual(slash, { code: 0, stdout: expected, stderr: '' });
  assert.strictEqual(fs.existsSync(ledger), outcome.kind !== 'deleted', 'only a tolerated trailing slash deletes the file');
  if (outcome.kind === 'deleted') fs.writeFileSync(ledger, '# ledger\n');
  const r = await runInProcess(['delete-ledger', '--run', run, '--ledger', 'x-ledger.md'], { cwd: run });
  assert.deepStrictEqual(r, { code: 0, stdout: 'claude-tweaks: deleted ledger x-ledger.md\n', stderr: '' });
  assert.ok(!fs.existsSync(ledger));
});

// The env-only A/B fixture (cli-wrapper-contract.md) on the docs/plans ownership path: the run's recorded worktree
// is not a git checkout, so ownership is computable only when the git children read the injected GIT_DIR (repo B,
// with a recorded origin/HEAD so the integration branch resolves without gh). `inherited` commits the ledger to B,
// so it reads as another run's; otherwise it is untracked there, so it is this run's.
function ownershipFixture({ inherited }) {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  const worktree = fs.realpathSync(scratchDir('ct-delledger-nongit-'));
  const rel = 'docs/plans/2026-08-14-x-ledger.md';
  const ledger = path.join(worktree, ...rel.split('/'));
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.writeFileSync(ledger, '# Open Items\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree }));
  const b = gitRoot();
  if (inherited) {
    fs.mkdirSync(path.join(b, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(b, ...rel.split('/')), '# Open Items\n');
    git(['add', rel], b);
    git(['commit', '-q', '-m', 'inherited ledger'], b);
  }
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], b);
  git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], b);
  return { root, runDir, ledger, gitDir: path.join(b, '.git') };
}

test('AC10.1: delete-ledger deletes an owned docs/plans ledger only when the ownership git children read the injected env', async () => {
  const f = ownershipFixture({ inherited: false });
  const args = ['delete-ledger', '--run', f.runDir];
  const unowned = await runInProcess(args, { cwd: f.root });
  assert.equal(unowned.code, 0);
  assert.match(unowned.stdout, /cannot attribute docs\/plans ledgers/);
  assert.ok(fs.existsSync(f.ledger));
  const ok = await runInProcess(args, { cwd: f.root, env: { GIT_DIR: f.gitDir } });
  assert.deepStrictEqual(ok, { code: 0, stdout: `claude-tweaks: deleted ledger ${f.ledger}\n`, stderr: '' });
  assert.ok(!fs.existsSync(f.ledger));
});

test('AC10.1: delete-ledger names an inherited docs/plans ledger only when describeRunLedgers reads the injected env', async () => {
  const f = ownershipFixture({ inherited: true });
  const r = await runInProcess(['delete-ledger', '--run', f.runDir], { cwd: f.root, env: { GIT_DIR: f.gitDir } });
  assert.deepStrictEqual(r, {
    code: 0,
    stdout: `claude-tweaks: delete-ledger: no ledger found for ${path.basename(f.runDir)} — only inherited ledgers found: ${f.ledger} — not found\n`,
    stderr: '',
  });
  assert.ok(fs.existsSync(f.ledger));
});

// real process: the script entry (shebang, process.argv, the exit code) of the delete-ledger success path (AC5.1),
// twinned with the same deletion in-process.
test('AC5.1: delete-ledger deleting {run-dir}/ledger.md through runCli and spawnCli returns the same code and stdout', async () => {
  const inProcess = gitRoot();
  const spawned = gitRoot();
  const runA = runDirFixture(inProcess);
  const runB = runDirFixture(spawned);
  fs.writeFileSync(path.join(runA, 'ledger.md'), '# Open Items\n');
  fs.writeFileSync(path.join(runB, 'ledger.md'), '# Open Items\n');
  const a = await runInProcess(['delete-ledger', '--run', runA], { cwd: inProcess });
  const b = spawnCli(HOOKS, ['delete-ledger', '--run', runB], { cwd: spawned, env: inProcessEnv() });
  const shape = (r, run) => ({ code: r.code, stdout: r.stdout.split(path.join(run, 'ledger.md')).join('<ledger>'), stderr: r.stderr });
  assert.deepStrictEqual(shape(a, runA), shape(b, runB));
  assert.deepStrictEqual(shape(a, runA), { code: 0, stdout: 'claude-tweaks: deleted ledger <ledger>\n', stderr: '' });
  assert.ok(!fs.existsSync(path.join(runA, 'ledger.md')));
  assert.ok(!fs.existsSync(path.join(runB, 'ledger.md')));
});
