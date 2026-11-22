const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const { sweepCli } = require('../../helpers/health-sweep-cli');
const { cleanGitEnv } = require('../../helpers/git-fixtures');
const { seedDurableState } = require('../health-core/seed-durable-state');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'docs-health.js');

// In-process (#5381), with the file-protocol-only git guard and a throwaway real cwd — see tests/helpers/health-sweep-cli.js.
function cli(argv, opts) {
  return sweepCli(CLI, argv, opts);
}

function tmp() { return scratchDir('docs-health-nt-'); }
function runNextTarget(args, root) {
  const res = cli(['next-target', '--root', root, ...args]);
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('next-target returns { target: null } for a project with no docs yet', () => {
  const root = tmp();
  const result = runNextTarget([], root);
  assert.strictEqual(result.target, null);
});

test('next-target picks a never-audited doc as stale', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'readme.md'), '# readme');
  const result = runNextTarget([], root);
  assert.ok(result.target !== null);
  assert.strictEqual(result.target.id, 'readme');
  assert.strictEqual(result.target.why, 'stale');
});

test('next-target --target <id> bypasses selection and returns why: "manual"', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'a.md'), '# a');
  fs.writeFileSync(path.join(root, 'docs', 'b.md'), '# b');
  const result = runNextTarget(['--target', 'b'], root);
  assert.strictEqual(result.target.id, 'b');
  assert.strictEqual(result.target.why, 'manual');
});

test('next-target --budget 2 returns an array of up to 2 unique targets', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'a.md'), '# a');
  fs.writeFileSync(path.join(root, 'docs', 'b.md'), '# b');
  const result = runNextTarget(['--budget', '2'], root);
  assert.ok(Array.isArray(result.targets));
  assert.ok(result.targets.length >= 1 && result.targets.length <= 2);
  const ids = result.targets.map((t) => t.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'budget results must have unique ids');
});

test('next-target without --budget still returns a single target object (default budget=1, no shape regression)', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'a.md'), '# a');
  const result = runNextTarget([], root);
  assert.ok(!Array.isArray(result.target));
  assert.strictEqual(result.target.id, 'a');
});

test('next-target --dir <path> restricts selection to docs under that subdirectory', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs', 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'guides'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'decisions', '0007-foo.md'), '# foo');
  fs.writeFileSync(path.join(root, 'docs', 'guides', 'setup.md'), '# setup');

  const result = runNextTarget(['--dir', 'guides'], root);
  assert.ok(result.target !== null);
  assert.strictEqual(result.target.id, 'guides/setup');
});

test('next-target --dir <path> with no matching docs returns { target: null }', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'decisions', '0007-foo.md'), '# foo');

  const result = runNextTarget(['--dir', 'guides'], root);
  assert.strictEqual(result.target, null);
});

// ── in-process entry (#5381) ────────────────────────────────────────────────

// No --root at all: the root is the injected cwd, the same outcome as the --root twin above.
test('AC8.1: next-target without --root selects from docs/ under the injected cwd', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'readme.md'), '# readme');
  const res = cli(['next-target'], { cwd: root });
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const result = JSON.parse(res.stdout);
  assert.strictEqual(result.target.id, 'readme');
  assert.strictEqual(result.target.why, 'stale');
});

// Accepted output difference (plan review): a relative --root is normalized against the injected cwd,
// so the printed target paths are absolute, for a single target and for --budget alike.
test('next-target --root <relative dir> prints target paths resolved against the injected cwd', () => {
  const parent = tmp();
  fs.mkdirSync(path.join(parent, 'proj', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(parent, 'proj', 'docs', 'readme.md'), '# readme');
  const expected = path.resolve(parent, 'proj', 'docs', 'readme.md');

  const single = cli(['next-target', '--root', 'proj'], { cwd: parent });
  assert.strictEqual(single.status, 0, `stderr: ${single.stderr}`);
  assert.strictEqual(JSON.parse(single.stdout).target.path, expected);

  const budget = cli(['next-target', '--root', 'proj', '--budget', '2'], { cwd: parent });
  assert.strictEqual(budget.status, 0, `stderr: ${budget.stderr}`);
  assert.deepStrictEqual(JSON.parse(budget.stdout).targets.map((t) => t.path), [expected]);
});

// env-only fixtures: readDurableState's `git fetch origin health-state` and the churn `git log` both
// run under the injected env, so a GIT_DIR that only the injected env carries points them at repo B
// although --root itself is not a repo. Every variant uses a fresh root: churnCache is not keyed on env.
function seedRepoB(cursors, { commitDoc } = {}) {
  const repo = tmp();
  const setup = { env: cleanGitEnv(process.env) };
  if (commitDoc) {
    execFileSync('git', ['init', '-q'], { cwd: repo, ...setup });
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs', 'a.md'), '# a changed in B');
    execFileSync('git', ['add', 'docs/a.md'], { cwd: repo, ...setup });
    // Committed an hour ago: later than the 2-hour-old cursor below, earlier than any in-memory
    // post-audit cursor --budget simulates, so the churn counts do not depend on this test's clock second.
    const when = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'doc'], {
      cwd: repo, env: { ...setup.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
    });
  }
  seedDurableState(repo, 'docs-health', 'cursors.json', cursors, 'docs-health-nt-env');
  return repo;
}

function rootWithDocA() {
  const root = tmp(); // not a git repo
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'a.md'), '# a');
  return root;
}

test('next-target reads the durable cursors through the injected env: GIT_DIR names the repo, root is not one', () => {
  const repo = seedRepoB({ 'doc:a': { lastAuditedMs: Date.now() } });

  // The control: no injected GIT_DIR, so no cursor is read and the doc is never-audited, hence stale.
  const control = cli(['next-target', '--root', rootWithDocA()]);
  assert.strictEqual(control.status, 0, `stderr: ${control.stderr}`);
  assert.strictEqual(JSON.parse(control.stdout).target.why, 'stale');

  // With it, the doc was audited just now and nothing changed since: nothing is due.
  const res = cli(['next-target', '--root', rootWithDocA()], { env: { GIT_DIR: path.join(repo, '.git') } });
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  assert.strictEqual(JSON.parse(res.stdout).target, null);
});

test('next-target scores churn through the injected env: GIT_DIR names the repo whose history touches the doc', () => {
  const repo = seedRepoB({ 'doc:a': { lastAuditedMs: Date.now() - 2 * 60 * 60 * 1000 } }, { commitDoc: true });

  const single = cli(['next-target', '--root', rootWithDocA()], { env: { GIT_DIR: path.join(repo, '.git') } });
  assert.strictEqual(single.status, 0, `stderr: ${single.stderr}`);
  const target = JSON.parse(single.stdout).target;
  assert.ok(target, `expected a hotspot target, got: ${single.stdout}`);
  assert.strictEqual(target.why, 'hotspot');
  assert.strictEqual(target.churnCount, 1);

  const budget = cli(['next-target', '--root', rootWithDocA(), '--budget', '2'], { env: { GIT_DIR: path.join(repo, '.git') } });
  assert.strictEqual(budget.status, 0, `stderr: ${budget.stderr}`);
  const { targets } = JSON.parse(budget.stdout);
  assert.deepStrictEqual(targets.map((t) => t.why), ['hotspot']);
});
