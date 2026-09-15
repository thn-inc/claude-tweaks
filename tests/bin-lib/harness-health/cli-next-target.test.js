const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { seedDurableState } = require('../health-core/seed-durable-state');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'harness-health.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-health-nt-')); }
function runNextTarget(args, root) {
  const raw = execFileSync('node', [CLI, 'next-target', '--root', root, ...args], { encoding: 'utf8' });
  return JSON.parse(raw);
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
  const raw = execFileSync('node', [CLI, 'next-target', '--root', root, '--budget', '2'], { encoding: 'utf8' });
  const result = JSON.parse(raw);
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
  assert.throws(
    () => execFileSync('node', [CLI, 'next-target', '--root', root, '--kind', 'memory'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    (err) => {
      assert.strictEqual(err.status, 2);
      assert.match(err.stderr.toString(), /--memory-dir/);
      return true;
    },
  );
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
// readDurableState's call count from outside the process boundary (the CLI
// spawns via execFileSync, so there is no in-process mock seam). Returns the
// path to a log file that accumulates one line per invocation of the shim.
function makeGitSpy() {
  const spyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-health-nt-gitspy-'));
  const logFile = path.join(spyDir, 'git-calls.log');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(
    path.join(spyDir, 'git'),
    `#!/bin/sh\necho "$@" >> "${logFile}"\nexec "${realGit}" "$@"\n`,
  );
  fs.chmodSync(path.join(spyDir, 'git'), 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  return logFile;
}

test('next-target (default no --target path) fetches durable state exactly once, not twice', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  seedDurableCursors(root, {});
  const logFile = makeGitSpy();
  execFileSync('node', [CLI, 'next-target', '--root', root], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${path.dirname(logFile)}:${process.env.PATH}` },
  });
  const log = fs.readFileSync(logFile, 'utf8');
  const fetchCalls = log.split('\n').filter((line) => /(^|\s)fetch(\s|$)/.test(line)).length;
  assert.strictEqual(
    fetchCalls,
    1,
    'cmdNextTarget must call readDurableState exactly once per invocation (a second call would double the git fetch/show round-trips)',
  );
});

test('next-target --kind memory fetches durable state exactly once, not twice', () => {
  const root = tmp();
  const memoryDir = tmp();
  fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '- [Only entry](only-entry.md) — hook\n');
  seedDurableCursors(root, {});
  const logFile = makeGitSpy();
  execFileSync('node', [CLI, 'next-target', '--root', root, '--kind', 'memory', '--memory-dir', memoryDir], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${path.dirname(logFile)}:${process.env.PATH}` },
  });
  const log = fs.readFileSync(logFile, 'utf8');
  const fetchCalls = log.split('\n').filter((line) => /(^|\s)fetch(\s|$)/.test(line)).length;
  assert.strictEqual(
    fetchCalls,
    1,
    'the --kind memory path must also call readDurableState exactly once per invocation',
  );
});
