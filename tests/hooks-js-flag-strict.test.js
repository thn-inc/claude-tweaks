// tests/hooks-js-flag-strict.test.js
//
// #4777: every hooks.js verb refuses an undeclared `--*` flag with its own
// usage line, before its handler runs. KNOWN_FLAGS covers the whole VERBS
// table, and a verb missing its entry fails closed (refuses every flag).
// Each verb's positive control runs without the typo and asserts the state
// effect that run actually produces, so a "nothing changed" assertion on the
// refused call can fail.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { KNOWN_FLAGS, USAGE, VALUE_FLAGS, VERBS } = require('../plugin/bin/hooks.js');
const { readText } = require('./helpers/read-skill');
const { fixtureGit } = require('./helpers/git-fixtures');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');
const STATUS = path.join('.claude-tweaks', 'reconcile-background-status.json');

function git(args, cwd) {
  return fixtureGit(args, { cwd, encoding: 'utf8' });
}

// Every temp dir a fixture creates (repos, bare origins, linked-worktree
// parents), removed once this file's tests are done.
const tmpDirs = [];
function tracked(dir) {
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// #1130: never let an omitted cwd fall through to the spawned subprocess's
// own process.cwd() — that is the test runner's real working directory.
const HOOK_SANDBOX = tracked(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-flag-sandbox-')));

// A reconcile pass under pr-first (forced by policy.yml in reconcileFixture)
// fails its GitHub-health preflight at once against localhost, so it runs
// only its git-only checks and never reaches a real GitHub repo through gh.
const OFFLINE_GH = { GH_HOST: 'localhost', GH_TOKEN: 'x', GH_REPO: '' };

function runHook(args, { cwd = HOOK_SANDBOX, env = {} } = {}) {
  try {
    // PIPELINE_RUN_DIR: '' neutralizes any ambient run-dir env var (#1130).
    const stdout = execFileSync('node', [HOOKS, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', ...OFFLINE_GH, ...env } });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '' };
  }
}

function runDirFixture(status) {
  const root = tracked(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-flag-'))));
  git(['init', '-q', '--initial-branch=main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);

  const runId = '2026-08-14T120000-spec-999';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status }));

  return { root, runDir, runId };
}

// The runDirFixture('clean') shape plus a bare origin one commit ahead of
// local main. policy.yml pins pr-first, so a reconcile pass gets past the
// local-merge early return and writes its cache stamp; the ahead origin gives
// the mirror check a fast-forward to make, so HEAD is an observable effect too.
function reconcileFixture() {
  const fixture = runDirFixture('clean');
  const { root } = fixture;
  const sib = tracked(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-flag-origin-'))));
  const origin = path.join(sib, 'origin.git');
  const other = path.join(sib, 'other');
  git(['init', '-q', '--bare', '--initial-branch=main', origin], sib);
  git(['remote', 'add', 'origin', origin], root);
  git(['push', '-q', 'origin', 'main'], root);
  git(['remote', 'set-head', 'origin', 'main'], root);
  git(['clone', '-q', origin, other], sib);
  git(['config', 'user.email', 'test@example.com'], other);
  git(['config', 'user.name', 'Test'], other);
  fs.writeFileSync(path.join(other, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], other);
  git(['commit', '-q', '-m', 'ahead'], other);
  git(['push', '-q', 'origin', 'main'], other);
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  fs.appendFileSync(path.join(root, '.git', 'info', 'exclude'), '.claude-tweaks/\n');
  return fixture;
}

// A repo with one empty commit and no run dirs.
function freshRepo() {
  const root = tracked(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-flag-fresh-'))));
  git(['init', '-q', '--initial-branch=main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  git(['commit', '-q', '--allow-empty', '-m', 'seed'], root);
  return root;
}

// A linked worktree of `root`, outside the main checkout.
function linkedWorktree(root) {
  const parent = tracked(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-flag-wt-')));
  const wt = path.join(parent, 'wt');
  git(['worktree', 'add', '-q', wt, '-b', `wt-${path.basename(parent)}`], root);
  return fs.realpathSync(wt);
}

function assertNoRunDirMinted(root) {
  const pipelines = path.join(root, '.claude-tweaks', 'pipelines');
  assert.ok(!fs.existsSync(pipelines) || fs.readdirSync(pipelines).length === 0, 'no run dir was minted');
}

test('#4777 AC3.1: KNOWN_FLAGS declares every VERBS verb, and nothing else', () => {
  assert.deepStrictEqual(Object.keys(KNOWN_FLAGS).sort(), Object.keys(VERBS).sort());
  assert.ok(readText(HOOKS).includes('\n  reconcile: ['));
});

test('#4777: every flag a usage line names is declared, and VALUE_FLAGS matches the usage lines', () => {
  let valueFlagCount = 0;
  for (const [verb, usage] of Object.entries(USAGE)) {
    for (const [, flag, value] of usage.matchAll(/(--[a-z][a-z-]*)(\s+<[^>]+>)?/g)) {
      assert.ok(KNOWN_FLAGS[verb].includes(flag), `${verb}: usage names ${flag} but KNOWN_FLAGS does not declare it`);
      const mismatch = value ? 'takes a value but is not' : 'is boolean but is';
      assert.equal(VALUE_FLAGS.has(flag), Boolean(value), `${verb}: ${flag} ${mismatch} in VALUE_FLAGS`);
      if (value) valueFlagCount += 1;
    }
  }
  for (const flag of VALUE_FLAGS) {
    assert.ok(Object.values(KNOWN_FLAGS).some((flags) => flags.includes(flag)), `VALUE_FLAGS member ${flag} is declared by no verb`);
  }
  assert.ok(valueFlagCount > 0, 'the usage lines were parsed');
});

test('#4777: every VERBS verb refuses an undeclared flag with its usage line', () => {
  for (const verb of Object.keys(VERBS)) {
    const result = runHook([verb, '--definitely-not-a-flag']);
    assert.equal(result.code, 0, verb);
    assert.equal(result.stdout, `claude-tweaks: usage: ${USAGE[verb]}\n`, verb);
  }
});

test('#4777 AC1.1 AC1.2: reconcile --dryrun prints the reconcile usage line and runs no check', () => {
  const { root } = reconcileFixture();
  const head = git(['rev-parse', 'HEAD'], root);
  const usage = 'claude-tweaks: usage: reconcile [--dry-run] [--json] [--mcp-reachable] [--checks <c1,c2,...>]\n';
  for (const args of [['reconcile', '--dryrun'], ['reconcile', '--json', '--dryrun']]) {
    const result = runHook(args, { cwd: root });
    assert.equal(result.code, 0, args.join(' '));
    assert.equal(result.stdout, usage, args.join(' '));
    assert.ok(!fs.existsSync(path.join(root, '.claude-tweaks', 'reconcile-cache.json')), 'the reconcile pass never ran');
    assert.equal(git(['rev-parse', 'HEAD'], root), head, 'HEAD is unchanged');
  }
  // Declared-flag control: the same verb with its real flags does not print the usage line.
  // This goes red when reconcile's KNOWN_FLAGS entry is removed, since the fail-closed guard then refuses every flag.
  const declared = runHook(['reconcile', '--dry-run', '--json'], { cwd: root });
  assert.doesNotMatch(declared.stdout, /claude-tweaks: usage:/);
});

test('#4777: reconcile --json with no typo runs for real (positive control for the reconcile tests)', () => {
  const { root } = reconcileFixture();
  const head = git(['rev-parse', 'HEAD'], root);
  const result = runHook(['reconcile', '--json'], { cwd: root });
  assert.equal(result.code, 0);
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'reconcile-cache.json')), 'a real pass stamps reconcile-cache.json');
  assert.notEqual(git(['rev-parse', 'HEAD'], root), head, 'the mirror check fast-forwards local main to the ahead origin');
});

test('#4777: declared value flags consume their value token', () => {
  const { root } = reconcileFixture();
  for (const args of [
    ['reconcile', '--dry-run', '--checks', 'mirror'],
    ['reconcile', '--dry-run', '--checks', ''],
  ]) {
    const result = runHook(args, { cwd: root });
    assert.doesNotMatch(result.stdout, /claude-tweaks: usage:/, args.join(' '));
  }
});

test('#4777: a value flag followed by a flag is refused as a missing value', () => {
  const { root } = reconcileFixture();
  for (const args of [
    ['reconcile', '--dry-run', '--checks', '--json'],
    ['reconcile', '--dry-run', '--checks', '--bogus'],
  ]) {
    const result = runHook(args, { cwd: root });
    assert.equal(result.stdout, `claude-tweaks: usage: ${USAGE.reconcile}\n`, args.join(' '));
  }
  const fresh = freshRepo();
  for (const args of [
    ['resolve-run-dir', '--spec-slug', '--bogus', '--create'],
    ['resolve-run-dir', '--spec-slug', '--create'],
  ]) {
    const result = runHook(args, { cwd: fresh });
    assert.equal(result.stdout, `claude-tweaks: usage: ${USAGE['resolve-run-dir']}\n`, args.join(' '));
    assertNoRunDirMinted(fresh);
  }
});

test('#4777: a flagless verb still runs bare', () => {
  const { root } = reconcileFixture();
  const head = git(['rev-parse', 'HEAD'], root);
  const result = runHook(['reconcile-summary'], { cwd: root });
  assert.equal(result.code, 0);
  assert.ok(result.stdout.startsWith('reconcile:'), result.stdout);
  // Positive control for reconcile-summary's refusal test: a bare run fast-forwards local main.
  assert.notEqual(git(['rev-parse', 'HEAD'], root), head, 'the bare run fast-forwarded local main');
});

test('#4777: reconcile-background and reconcile-summary refuse an undeclared flag and change nothing', () => {
  const { root } = reconcileFixture();
  const head = git(['rev-parse', 'HEAD'], root);
  for (const verb of ['reconcile-background', 'reconcile-summary']) {
    const result = runHook([verb, '--bogus'], { cwd: root });
    assert.equal(result.code, 0, verb);
    assert.equal(result.stdout, `claude-tweaks: usage: ${USAGE[verb]}\n`, verb);
    assert.ok(!fs.existsSync(path.join(root, STATUS)), `${verb} wrote no background status`);
    assert.equal(git(['rev-parse', 'HEAD'], root), head, `${verb} left HEAD where it was`);
  }
});

test('#4777: reconcile-background with no typo writes its status file (positive control)', () => {
  const { root } = reconcileFixture();
  const result = runHook(['reconcile-background'], { cwd: root });
  assert.equal(result.stdout, 'claude-tweaks: reconcile-background complete\n');
  assert.ok(fs.existsSync(path.join(root, STATUS)), 'a real background pass writes its status file');
});

test('#4777: adopt-run-dir refuses an undeclared flag before adopting', () => {
  const { root, runDir, runId } = runDirFixture('clean');
  const wt = linkedWorktree(root);
  const copy = path.join(wt, '.claude-tweaks', 'pipelines', runId);
  for (const args of [
    ['adopt-run-dir', '--run', runDir, '--worktree', wt, '--bogus'],
    ['adopt-run-dir', '--bogus', '--run', runDir, '--worktree', wt],
  ]) {
    const result = runHook(args, { cwd: root });
    assert.equal(result.code, 0, args.join(' '));
    assert.equal(result.stdout, `claude-tweaks: usage: ${USAGE['adopt-run-dir']}\n`, args.join(' '));
    assert.ok(!fs.existsSync(copy), 'nothing was adopted into the worktree');
  }
  // Positive control: the same arguments without the typo adopt the run's decisions.md.
  const adopted = runHook(['adopt-run-dir', '--run', runDir, '--worktree', wt], { cwd: root });
  assert.equal(adopted.stdout, 'copied: decisions.md\n');
  assert.ok(fs.existsSync(path.join(copy, 'decisions.md')));
});

// Shared by the two sweep-shadow tests: a main run dir that already holds
// staged/ (sweep-shadow needs it to relocate into), and one shadow proposal
// under the linked worktree's copy of the run dir.
function sweepFixture() {
  const { root, runDir, runId } = runDirFixture('clean');
  fs.mkdirSync(path.join(runDir, 'staged'));
  const wt = linkedWorktree(root);
  const shadow = path.join(wt, '.claude-tweaks', 'pipelines', runId, 'staged', 'proposal.md');
  fs.mkdirSync(path.dirname(shadow), { recursive: true });
  fs.writeFileSync(shadow, 'proposal\n');
  return { root, runDir, wt, shadow };
}

test('#4777: sweep-shadow refuses an undeclared flag before sweeping', () => {
  const { root, runDir, wt, shadow } = sweepFixture();
  for (const args of [
    ['sweep-shadow', '--run', runDir, '--worktree', wt, '--bogus'],
    ['sweep-shadow', '--bogus', '--run', runDir, '--worktree', wt],
  ]) {
    const result = runHook(args, { cwd: root });
    assert.equal(result.code, 0, args.join(' '));
    assert.equal(result.stdout, `claude-tweaks: usage: ${USAGE['sweep-shadow']}\n`, args.join(' '));
    assert.ok(fs.existsSync(shadow), 'the shadow file is not swept');
  }
});

test('#4777: sweep-shadow with no typo sweeps the shadow file (positive control)', () => {
  const { root, runDir, wt, shadow } = sweepFixture();
  const result = runHook(['sweep-shadow', '--run', runDir, '--worktree', wt], { cwd: root });
  assert.equal(result.stdout, 'relocated: proposal.md\n');
  assert.ok(!fs.existsSync(shadow), 'the shadow file is moved out of the worktree');
  assert.ok(fs.existsSync(path.join(runDir, 'staged', 'proposal.md')), 'the proposal lands in the main run dir');
});

test('#4777: resolve-run-dir --create refuses an undeclared flag and mints nothing', () => {
  const root = freshRepo();
  for (const args of [
    ['resolve-run-dir', '--spec-slug', 'x', '--create', '--bogus'],
    ['resolve-run-dir', '--bogus', '--spec-slug', 'x', '--create'],
  ]) {
    const result = runHook(args, { cwd: root });
    assert.equal(result.code, 0, args.join(' '));
    assert.equal(result.stdout, `claude-tweaks: usage: ${USAGE['resolve-run-dir']}\n`, args.join(' '));
    assertNoRunDirMinted(root);
  }
});

test('#4777: resolve-run-dir --create with no typo mints a run dir (positive control)', () => {
  const root = freshRepo();
  const result = runHook(['resolve-run-dir', '--spec-slug', 'x', '--create'], { cwd: root });
  assert.equal(result.code, 0);
  const minted = fs.realpathSync(result.stdout.trim());
  assert.ok(minted.startsWith(path.join(root, '.claude-tweaks', 'pipelines') + path.sep), `minted run dir is under pipelines: ${minted}`);
  assert.ok(fs.statSync(minted).isDirectory(), 'a real --create run mints the run dir');
});

test('#4777: --help or -h in a value position still prints usage and runs nothing', () => {
  const root = freshRepo();
  for (const help of ['--help', '-h']) {
    const mint = runHook(['resolve-run-dir', '--spec-slug', help, '--create'], { cwd: root });
    assert.equal(mint.code, 0, help);
    assert.equal(mint.stdout, `claude-tweaks: usage: ${USAGE['resolve-run-dir']}\n`, help);
    assertNoRunDirMinted(root);
  }
  const sibling = runHook(['check-sibling-sessions', '--record', '--help'], { cwd: root });
  assert.equal(sibling.code, 0);
  assert.equal(sibling.stdout, `claude-tweaks: usage: ${USAGE['check-sibling-sessions']}\n`);
});

test('#4777: check-sibling-sessions --record <id> does not print the usage line (declared-flag control)', () => {
  // Goes red when --record is removed from the verb's KNOWN_FLAGS entry.
  const result = runHook(['check-sibling-sessions', '--record', 'x'], { cwd: freshRepo() });
  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /claude-tweaks: usage:/);
});

test('#4777: hooks.js comments no longer describe a lenient verb set', () => {
  const src = readText(HOOKS);
  assert.doesNotMatch(src, /Every other resolveRunArg caller/);
  assert.doesNotMatch(src, /Every other VERBS-table verb keeps the\s+\/\/ narrower HELP_FLAGS-only guard/);
  assert.doesNotMatch(src, /HELP_FLAGS/);
});

test('#4777: the registration skill states default-strict membership', () => {
  const skill = readText(path.join(__dirname, '..', '.claude', 'skills', 'hooks-js-verb-registration', 'SKILL.md'));
  assert.doesNotMatch(skill, /Only for a flag-strict verb/);
  assert.doesNotMatch(skill, /The lenient mutating verbs still in `VERBS`/);
  assert.doesNotMatch(skill, /not flag-strict/);
  const row2 = skill.split('\n').find((line) => line.startsWith('| 2 |'));
  assert.ok(row2, 'registration row 2 is present');
  assert.match(row2, /every `VERBS` verb/i);
});
