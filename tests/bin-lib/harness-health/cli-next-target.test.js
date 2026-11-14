const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { seedDurableState } = require('../health-core/seed-durable-state');
const { STUB_SKIP } = require('../../helpers/path-stub');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'harness-health.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-health-nt-')); }

// In-process (#5380): the CLI runs inside the test process through runCliSync; `status` mirrors
// the spawnSync field the assertions below read. `env` is the complete environment the CLI sees.
function cli(argv, opts = {}) {
  const res = runCliSync(CLI, argv, { env: { ...process.env, ...opts.env }, cwd: opts.cwd, fresh: opts.fresh });
  return { status: res.code, stdout: res.stdout, stderr: res.stderr };
}

function runNextTarget(args, root, opts = {}) {
  const res = cli(['next-target', '--root', root, ...args], opts);
  assert.strictEqual(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

// writeCursors (local-disk cursor persistence) was removed by the
// health-state migration — cursors now live on the durable health-state
// branch (bin/lib/health-core/durable-state.js), not local disk. Its read
// path (readDurableState) is pure git plumbing (fetch + show), so it CAN be
// exercised for real without gh/network via the shared
// tests/bin-lib/health-core/seed-durable-state.js helper. This same
// git-fixture-seeding sequence was previously hand-duplicated here (as
// seedDurableCursors) and in tests/bin-lib/harness-health/
// cli-validate-findings.test.js's own seedDurableRuns (still its own copy —
// out of this fix's scope); the extraction only migrates this file's copy.
function seedDurableCursors(root, cursors) {
  seedDurableState(root, 'harness-health', 'cursors.json', cursors, 'harness-health-nt');
}

test('next-target returns { target: null, gapScanDue: true } for a project with no targets yet', () => {
  const root = tmp();
  const result = runNextTarget([], root);
  assert.strictEqual(result.target, null);
  assert.strictEqual(result.gapScanDue, true, 'a never-scanned project is due for its first gap scan');
});

test('next-target picks a never-audited skill as stale', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  const result = runNextTarget([], root);
  assert.ok(result.target !== null);
  assert.strictEqual(result.target.id, 'auth');
  assert.strictEqual(result.target.why, 'stale');
});

test('next-target --target <id> bypasses selection and returns why: "manual"', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'billing.md'), '# billing');
  const result = runNextTarget(['--target', 'billing'], root);
  assert.strictEqual(result.target.id, 'billing');
  assert.strictEqual(result.target.why, 'manual');
});

test('next-target --target <id> --kind <kind> disambiguates a skill/rule id collision', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  fs.writeFileSync(path.join(root, '.claude', 'rules', 'auth.md'), '---\npaths:\n  - src/auth/**\n---\n');
  const result = runNextTarget(['--target', 'auth', '--kind', 'rule'], root);
  assert.strictEqual(result.target.kind, 'rule');
});

test('next-target --kind filters the auto-selected pool to one kind', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Project\n');
  const result = runNextTarget(['--kind', 'claude-md'], root);
  assert.strictEqual(result.target.kind, 'claude-md');
});

test('next-target gapScanDue is false right after a gap scan was recorded (durable cursor seeded directly)', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  seedDurableCursors(root, { __gapScan: { lastScannedSha: null, lastScannedMs: Date.now() } });
  const result = runNextTarget([], root);
  assert.strictEqual(result.gapScanDue, false);
});

test('next-target --force-gap-scan forces gapScanDue: true even when the cursor says it is not due', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  seedDurableCursors(root, { __gapScan: { lastScannedSha: null, lastScannedMs: Date.now() } });
  const withoutForce = runNextTarget([], root);
  assert.strictEqual(withoutForce.gapScanDue, false, 'sanity check: the seeded cursor makes it not due without the flag');
  const withForce = runNextTarget(['--force-gap-scan'], root);
  assert.strictEqual(withForce.gapScanDue, true, '--force-gap-scan must bypass the 90-day cursor');
});

test('next-target --budget 2 returns an array of up to 2 unique targets', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'billing.md'), '# billing');
  const result = runNextTarget(['--budget', '2'], root);
  assert.ok(Array.isArray(result.targets), 'must return a targets array when --budget > 1');
  assert.ok(result.targets.length >= 1 && result.targets.length <= 2);
  const ids = result.targets.map((t) => t.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'budget results must have unique ids');
});

test('next-target without --budget still returns a single target object (default budget=1, no shape regression)', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  const result = runNextTarget([], root);
  assert.ok(!Array.isArray(result.target), 'default (no --budget) must not change the existing target shape');
  assert.strictEqual(result.target.id, 'auth');
});

test('next-target --kind design-artifact surfaces a stale PRODUCT.md when design-integration is enabled', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '## Design integration\n\ndesign-integration: enabled\n');
  fs.writeFileSync(path.join(root, 'PRODUCT.md'), '# Product context');
  const result = runNextTarget(['--kind', 'design-artifact'], root);
  assert.strictEqual(result.target.kind, 'design-artifact');
  assert.strictEqual(result.target.id, 'PRODUCT');
  assert.strictEqual(result.target.why, 'stale');
});

test('next-target does not surface design artifacts when design-integration is not enabled', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '## Design integration\n\ndesign-integration: disabled\n');
  fs.writeFileSync(path.join(root, 'PRODUCT.md'), '# Product context');
  const result = runNextTarget(['--kind', 'design-artifact'], root);
  assert.strictEqual(result.target, null);
});

test('next-target --kind memory --memory-dir <dir> picks a never-audited memory entry as stale', () => {
  const root = tmp();
  const memoryDir = tmp();
  fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '- [Only entry](only-entry.md) — hook\n');
  const result = runNextTarget(['--kind', 'memory', '--memory-dir', memoryDir], root);
  assert.strictEqual(result.target.kind, 'memory');
  assert.strictEqual(result.target.id, 'only-entry');
  assert.strictEqual(result.target.why, 'stale');
});

test('next-target --kind memory --target <id> --memory-dir <dir> bypasses selection with why: manual', () => {
  const root = tmp();
  const memoryDir = tmp();
  fs.writeFileSync(
    path.join(memoryDir, 'MEMORY.md'),
    '- [First entry](first-entry.md) — hook\n- [Second entry](second-entry.md) — hook\n',
  );
  const result = runNextTarget(['--kind', 'memory', '--target', 'second-entry', '--memory-dir', memoryDir], root);
  assert.strictEqual(result.target.id, 'second-entry');
  assert.strictEqual(result.target.why, 'manual');
});

test('next-target --kind memory without --memory-dir exits 2 with a clear usage error', () => {
  const root = tmp();
  const res = cli(['next-target', '--root', root, '--kind', 'memory']);
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /--memory-dir/);
});

test('next-target (bare, no --kind) never surfaces a memory target even when MEMORY.md exists at --root', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'MEMORY.md'), '- [Only entry](only-entry.md) — hook\n');
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  const result = runNextTarget([], root);
  assert.notStrictEqual(result.target && result.target.kind, 'memory');
});

// Wraps the real `git` binary with a logging shim so a CLI-level invocation's
// actual subprocess calls can be counted — this is the only way to observe
// readDurableState's call count from outside the CLI (every git call is a
// child process). Returns the path to a log file that accumulates one line per
// invocation of the shim, and the `env` to hand the in-process call: the shim's
// dir ahead of the real PATH, in the injected env only. The test process's own
// process.env.PATH is never touched (installStub would), so a CLI that ignored
// its injected env would run the real git and log nothing — the test would fail.
function makeGitSpy() {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-health-nt-gitspy-'));
  const logFile = path.join(logDir, 'git-calls.log');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-health-nt-gitstub-'));
  const shim = path.join(stubDir, 'git');
  fs.writeFileSync(shim, `#!/bin/sh\necho "$@" >> "${logFile}"\nexec "${realGit}" "$@"\n`);
  fs.chmodSync(shim, 0o755); // root-safe: exec-bit stub, not a denial simulation
  return { logFile, env: { ...process.env, PATH: stubDir + path.delimiter + process.env.PATH } };
}

test('next-target (default no --target path) fetches durable state exactly once, not twice', { skip: STUB_SKIP }, () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  seedDurableCursors(root, {});
  const { logFile, env } = makeGitSpy();
  const res = cli(['next-target', '--root', root], { env });
  assert.strictEqual(res.status, 0, res.stderr);
  const log = fs.readFileSync(logFile, 'utf8');
  const fetchCalls = log.split('\n').filter((line) => /(^|\s)fetch(\s|$)/.test(line)).length;
  assert.strictEqual(
    fetchCalls,
    1,
    'cmdNextTarget must call readDurableState exactly once per invocation (a second call would double the git fetch/show round-trips)',
  );
});

test('next-target --kind memory fetches durable state exactly once, not twice', { skip: STUB_SKIP }, () => {
  const root = tmp();
  const memoryDir = tmp();
  fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '- [Only entry](only-entry.md) — hook\n');
  seedDurableCursors(root, {});
  const { logFile, env } = makeGitSpy();
  const res = cli(['next-target', '--root', root, '--kind', 'memory', '--memory-dir', memoryDir], { env });
  assert.strictEqual(res.status, 0, res.stderr);
  const log = fs.readFileSync(logFile, 'utf8');
  const fetchCalls = log.split('\n').filter((line) => /(^|\s)fetch(\s|$)/.test(line)).length;
  assert.strictEqual(
    fetchCalls,
    1,
    'the --kind memory path must also call readDurableState exactly once per invocation',
  );
});

// No --root: the root defaults to the cwd the call was given (the injected one, never the test process's).
test('next-target without --root selects from the injected cwd', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  const res = cli(['next-target'], { cwd: root });
  assert.strictEqual(res.status, 0, res.stderr);
  const result = JSON.parse(res.stdout);
  assert.strictEqual(result.target.id, 'auth');
  assert.strictEqual(result.target.why, 'stale');
});

// Two sequential in-process calls against two different fixture roots: nothing the first call
// left in the process (cwd, env, module state) leaks into the second one's answer.
test('two sequential in-process next-target calls on different roots each answer for their own root', () => {
  const fixture = (skill) => {
    const root = tmp();
    fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'skills', `${skill}.md`), `# ${skill}`);
    return root;
  };
  const first = runNextTarget([], fixture('alpha'));
  const second = runNextTarget([], fixture('beta'));
  assert.strictEqual(first.target.id, 'alpha');
  assert.strictEqual(second.target.id, 'beta');
});

// A root rewritten in place between two calls needs `fresh: true` on the second: domainChurn
// memoizes per (root, paths, since) for the life of the module, and a CLI process used to start
// with an empty memo every time. Both skills carry a recent cursor, so selection is by churn.
test('a root rewritten in place between two in-process next-target calls is read fresh with fresh: true', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'alpha.md'), '# alpha');
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'beta.md'), '# beta');
  const audited = Date.now() - 86400000;
  seedDurableCursors(root, { 'skill:alpha': { lastAuditedMs: audited }, 'skill:beta': { lastAuditedMs: audited } });

  const before = runNextTarget([], root);
  assert.strictEqual(before.target, null, 'no commits yet, so no churn and nothing is stale');

  fs.writeFileSync(path.join(root, '.claude', 'skills', 'alpha.md'), '# alpha, edited');
  execFileSync('git', ['-C', root, 'add', '.claude/skills/alpha.md']);
  execFileSync('git', ['-C', root, '-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'edit alpha']);

  const after = runNextTarget([], root, { fresh: true });
  assert.strictEqual(after.target.id, 'alpha');
  assert.strictEqual(after.target.why, 'hotspot');
});

// Env-only fixture: `root` is not a git repo at all and nothing in the test process's own
// environment points git anywhere — only the injected env carries GIT_DIR=<B>/.git. The churn
// lookup (`git log`, via selectTarget's env) and the durable-state reads both have to run
// under that env for beta, the only skill with a commit in B, to be picked as a hotspot.
test('next-target runs its child git under the injected env only (GIT_DIR names the repo, root is not one)', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'alpha.md'), '# alpha');
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'beta.md'), '# beta');

  const repoB = tmp();
  const audited = Date.now() - 86400000;
  seedDurableCursors(repoB, { 'skill:alpha': { lastAuditedMs: audited }, 'skill:beta': { lastAuditedMs: audited } });
  fs.mkdirSync(path.join(repoB, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(repoB, '.claude', 'skills', 'beta.md'), '# beta in B');
  execFileSync('git', ['-C', repoB, 'add', '.claude/skills/beta.md']);
  execFileSync('git', ['-C', repoB, '-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'beta']);

  const result = runNextTarget([], root, { env: { GIT_DIR: path.join(repoB, '.git') } });
  assert.strictEqual(result.target.id, 'beta');
  assert.strictEqual(result.target.why, 'hotspot');
});

// Proves the script entry's stdout, stderr and exit code are unchanged by the in-process
// entry conversion (#5380): a bare `next-target` in a non-git fixture, run as a real child,
// with the fixture's temp path (both spellings — macOS resolves /var to /private/var) replaced
// by a placeholder, and OS path separators folded to '/', on the stderr being compared. git's own
// wording is pinned in the C locale (LC_ALL/LANG), where its messages are the untranslated English
// ones, so the full text is asserted rather than only its shape.
test('next-target script entry: exit code, stdout and stderr of a bare run in a non-git fixture', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  const real = fs.realpathSync(root);
  const normalize = (text) => text.split(real).join('<ROOT>').split(root).join('<ROOT>').replace(/\\/g, '/');

  const res = spawnCli(CLI, ['next-target'], { env: { ...process.env, LC_ALL: 'C', LANG: 'C' }, cwd: root });

  assert.strictEqual(res.code, 0);
  const expectedStdout = JSON.stringify({
    target: {
      kind: 'skill',
      id: 'auth',
      path: path.join(real, '.claude', 'skills', 'auth.md'),
      why: 'stale',
      daysSinceLastAudit: null,
    },
    gapScanDue: true,
  }, null, 2) + '\n';
  assert.strictEqual(res.stdout, expectedStdout);
  const expectedStderr = [
    'fatal: not a git repository (or any of the parent directories): .git',
    'health-state: fetch failed, treating as empty state: Command failed: git -C <ROOT> fetch origin health-state',
    'fatal: not a git repository (or any of the parent directories): .git',
    '',
    '',
  ].join('\n');
  assert.strictEqual(normalize(res.stderr), expectedStderr);
});
