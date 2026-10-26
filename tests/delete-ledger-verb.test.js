'use strict';
// tests/delete-ledger-verb.test.js — #2546: `bin/hooks.js delete-ledger`,
// giving wrap-up cleanup item 2 (ledger deletion) a sanctioned verb instead
// of a hand-run `rm`/Bash call.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function runHook(args, { cwd } = {}) {
  try {
    const stdout = execFileSync('node', [HOOKS, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '' } });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '' };
  }
}

function gitRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-delledger-')));
  git(['init', '-q', '--initial-branch=main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
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

test('delete-ledger: deletes {run-dir}/ledger.md when present and exits cleanly', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.writeFileSync(path.join(runDir, 'ledger.md'), '# Open Items\n');
  const result = runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /deleted ledger/);
  assert.ok(!fs.existsSync(path.join(runDir, 'ledger.md')));
});

test('delete-ledger: falls back to the single docs/plans/*-ledger.md candidate when no run-dir ledger.md exists', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  const ledgerPath = path.join(root, 'docs', 'plans', '2026-08-14-sample-ledger.md');
  fs.writeFileSync(ledgerPath, '# Open Items\n');
  const result = runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /deleted ledger/);
  assert.ok(!fs.existsSync(ledgerPath));
});

test('delete-ledger: an inherited docs/plans ledger committed on main is not deleted, and the not-found report names it (#3686)', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  const inherited = path.join(root, 'docs', 'plans', '2026-08-14-old-ledger.md');
  fs.writeFileSync(inherited, '# Open Items\n');
  git(['add', 'docs/plans/2026-08-14-old-ledger.md'], root);
  git(['commit', '-q', '-m', 'inherited ledger'], root);
  git(['checkout', '-q', '-b', 'feature'], root);
  const result = runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /only inherited ledgers found: .*2026-08-14-old-ledger\.md/);
  assert.match(result.stdout, /not found/);
  assert.ok(fs.existsSync(inherited));
});

test('delete-ledger: an explicit --ledger naming a missing file keeps the plain not-found line (no inherited diagnostic)', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  const inherited = path.join(root, 'docs', 'plans', '2026-08-14-old-ledger.md');
  fs.writeFileSync(inherited, '# Open Items\n');
  git(['add', 'docs/plans/2026-08-14-old-ledger.md'], root);
  git(['commit', '-q', '-m', 'inherited ledger'], root);
  git(['checkout', '-q', '-b', 'feature'], root);
  const missing = path.join(root, 'docs', 'plans', 'missing-ledger.md');
  const result = runHook(['delete-ledger', '--run', runDir, '--ledger', missing], { cwd: root });
  assert.match(result.stdout, /not found/);
  assert.doesNotMatch(result.stdout, /inherited/);
  assert.ok(fs.existsSync(inherited));
});

test('delete-ledger: unattributable arm — a non-git run-state worktree prints "cannot attribute" and keeps the ledger', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  const nonGit = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-delledger-nongit-')));
  fs.mkdirSync(path.join(nonGit, 'docs', 'plans'), { recursive: true });
  const ledger = path.join(nonGit, 'docs', 'plans', '2026-08-14-x-ledger.md');
  fs.writeFileSync(ledger, '# Open Items\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: nonGit }));
  const result = runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /cannot attribute docs\/plans ledgers to 2026-08-14T120000-spec-999/);
  assert.match(result.stdout, /ledger not deleted/);
  assert.ok(fs.existsSync(ledger));
});

test('delete-ledger: running it again on an already-deleted ledger reports not-found, not a crash', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.writeFileSync(path.join(runDir, 'ledger.md'), '# Open Items\n');
  runHook(['delete-ledger', '--run', runDir], { cwd: root });
  const second = runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.strictEqual(second.code, 0);
  assert.match(second.stdout, /no ledger found for 2026-08-14T120000-spec-999 — not found\n$/);
  assert.doesNotMatch(second.stdout, /inherited/);
});

test('delete-ledger: 2+ docs/plans/*-ledger.md candidates refuses to guess, naming all candidates', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'a-ledger.md'), '# A\n');
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'b-ledger.md'), '# B\n');
  const result = runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /candidate ledgers found/);
  assert.match(result.stdout, /a-ledger\.md/);
  assert.match(result.stdout, /b-ledger\.md/);
  assert.ok(fs.existsSync(path.join(root, 'docs', 'plans', 'a-ledger.md')));
  assert.ok(fs.existsSync(path.join(root, 'docs', 'plans', 'b-ledger.md')));
});

test('delete-ledger: --ledger explicitly overrides resolution, deleting the named file', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'a-ledger.md'), '# A\n');
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'b-ledger.md'), '# B\n');
  const result = runHook(['delete-ledger', '--run', runDir, '--ledger', path.join(root, 'docs', 'plans', 'a-ledger.md')], { cwd: root });
  assert.match(result.stdout, /deleted ledger/);
  assert.ok(!fs.existsSync(path.join(root, 'docs', 'plans', 'a-ledger.md')));
  assert.ok(fs.existsSync(path.join(root, 'docs', 'plans', 'b-ledger.md')));
});

test('delete-ledger: --ledger naming a file outside the run dir and worktree is refused, nothing deleted', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-delledger-outside-')));
  const victim = path.join(outside, 'victim-ledger.md');
  fs.writeFileSync(victim, '# keep me\n');
  const result = runHook(['delete-ledger', '--run', runDir, '--ledger', victim], { cwd: root });
  assert.match(result.stdout, /rejected \(outside the run directory and worktree\)/);
  assert.ok(fs.existsSync(victim));
});

test('delete-ledger: no --run exits cleanly with a clear message, nothing deleted', () => {
  const root = gitRoot();
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'a-ledger.md'), '# A\n');
  const result = runHook(['delete-ledger'], { cwd: root });
  assert.match(result.stdout, /no pipeline run dir found/);
  assert.ok(fs.existsSync(path.join(root, 'docs', 'plans', 'a-ledger.md')));
});

test('delete-ledger --help prints usage and does nothing', () => {
  const root = gitRoot();
  const result = runHook(['delete-ledger', '--help'], { cwd: root });
  assert.match(result.stdout, /usage: delete-ledger/);
});

// Characterization (#4026 Task 8, written before the verb logged anything):
// every report's exact stdout, exit code and empty stderr — the self-logging
// change must leave all three untouched.
function runHookFull(args, { cwd, env = {} } = {}) {
  const r = spawnSync('node', [HOOKS, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', ...env } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
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
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-delledger-outside-')));
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
    const nonGit = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-delledger-nongit-')));
    fs.mkdirSync(path.join(nonGit, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(nonGit, 'docs', 'plans', '2026-08-14-x-ledger.md'), '# Open Items\n');
    fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: nonGit }));
    return { args: ['delete-ledger', '--run', runDir], stdout: /^claude-tweaks: delete-ledger: cannot attribute docs\/plans ledgers to 2026-08-14T120000-spec-999 \(.+\) — pass --ledger <path> explicitly; ledger not deleted\n$/ };
  },
};

for (const [report, setup] of Object.entries(LEFT_ON_DISK)) {
  test(`characterization: the ${report} report keeps its stdout, exit 0 and an empty stderr`, () => {
    const root = gitRoot();
    const runDir = runDirFixture(root);
    const { args, stdout } = setup(root, runDir);
    const result = runHookFull(args, { cwd: root });
    assert.strictEqual(result.code, 0);
    if (typeof stdout === 'string') assert.strictEqual(result.stdout, stdout);
    else assert.match(result.stdout, stdout);
    assert.strictEqual(result.stderr, '');
  });
}

test('characterization: deleted and not found keep their stdout and exit 0, and write no decisions.md', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  const ledger = path.join(runDir, 'ledger.md');
  fs.writeFileSync(ledger, '# Open Items\n');
  const first = runHookFull(['delete-ledger', '--run', runDir], { cwd: root });
  assert.deepStrictEqual(first, { code: 0, stdout: `claude-tweaks: deleted ledger ${ledger}\n`, stderr: '' });
  const second = runHookFull(['delete-ledger', '--run', runDir], { cwd: root });
  assert.deepStrictEqual(second, { code: 0, stdout: 'claude-tweaks: delete-ledger: no ledger found for 2026-08-14T120000-spec-999 — not found\n', stderr: '' });
  assert.strictEqual(decisionsText(runDir), null);
});

test('characterization: no run dir found prints its refusal, exits 0 and writes no decisions.md', () => {
  const root = gitRoot();
  const result = runHookFull(['delete-ledger'], { cwd: root });
  assert.deepStrictEqual(result, { code: 0, stdout: 'claude-tweaks: no pipeline run dir found — ledger not deleted\n', stderr: '' });
  assert.ok(!fs.existsSync(path.join(root, '.claude-tweaks')));
});

// AC3.1 (#4026 Task 8): with an anchored run dir, a report that leaves the
// ledger on disk appends its own SKIP line under `## /wrap-up` — the line
// cleanup-procedures.md Item 2 told the agent to hand-log.
function skipLine(report) {
  return new RegExp(`^## /wrap-up\\n- SKIP \\d{2}:\\d{2}:\\d{2} — Cleanup item 2 delete-ledger \\(skipped\\): condition: delete-ledger reported ${report} → fallback: ledger left on disk, nothing committed for item 2\\. Reversibility: n/a\\.\\n$`);
}

test('AC3.1: a failed delete logs the SKIP line; deleted and not found log nothing', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(runDir, 'ledger.md'));
  const failed = runHookFull(['delete-ledger', '--run', runDir], { cwd: root });
  assert.strictEqual(failed.code, 0);
  assert.match(failed.stdout, /failed to delete/);
  assert.strictEqual(failed.stderr, '');
  assert.match(decisionsText(runDir), skipLine('failed to delete'));

  const cleanRoot = gitRoot();
  const clean = runDirFixture(cleanRoot);
  fs.writeFileSync(path.join(clean, 'ledger.md'), '# Open Items\n');
  assert.match(runHookFull(['delete-ledger', '--run', clean], { cwd: cleanRoot }).stdout, /deleted ledger/);
  assert.strictEqual(decisionsText(clean), null, 'deleted logs nothing');
  assert.match(runHookFull(['delete-ledger', '--run', clean], { cwd: cleanRoot }).stdout, /— not found\n$/);
  assert.strictEqual(decisionsText(clean), null, 'not found logs nothing');
});

for (const report of ['rejected', 'ambiguous', 'unattributable']) {
  test(`AC3.1: the ${report} report logs the SKIP line with stdout and exit code unchanged`, () => {
    const root = gitRoot();
    const runDir = runDirFixture(root);
    const { args } = LEFT_ON_DISK[report](root, runDir);
    const result = runHookFull(args, { cwd: root });
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stderr, '');
    assert.match(decisionsText(runDir), skipLine(report));
  });
}

test('AC3.1: a run dir that is not anchored under a checkout logs nothing', () => {
  const root = gitRoot();
  const loose = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-delledger-loose-')));
  fs.mkdirSync(path.join(loose, 'ledger.md'));
  const result = runHookFull(['delete-ledger'], { cwd: root, env: { PIPELINE_RUN_DIR: loose } });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /failed to delete/);
  assert.strictEqual(result.stderr, '');
  assert.strictEqual(decisionsText(loose), null);
});

test('AC3.1: a candidate refusal logs nothing in any candidate run dir', () => {
  const root = gitRoot();
  const a = runDirFixture(root);
  const b = path.join(path.dirname(a), '2026-08-14T130000-spec-998');
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(b, 'run-state.json'), JSON.stringify({ status: 'active' }));
  fs.mkdirSync(path.join(a, 'ledger.md'));
  fs.mkdirSync(path.join(b, 'ledger.md'));
  const result = runHookFull(['delete-ledger'], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /pass --run explicitly/);
  assert.strictEqual(decisionsText(a), null);
  assert.strictEqual(decisionsText(b), null);
});

test('AC3.1: a failed append keeps stdout and exit 0 and adds one stderr line', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(runDir, 'ledger.md'));
  fs.mkdirSync(path.join(runDir, 'decisions.md'));
  const result = runHookFull(['delete-ledger', '--run', runDir], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /^claude-tweaks: delete-ledger: failed to delete .+\n$/);
  assert.match(result.stderr, /^claude-tweaks: delete-ledger: decisions\.md append failed \(.+\) — hand-log the Item 2 SKIP line\n$/);
});
