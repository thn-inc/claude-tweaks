// tests/hooks-js-flag-strict.test.js
//
// #4777: every hooks.js verb refuses an undeclared `--*` flag before its
// handler runs. KNOWN_FLAGS covers the whole VERBS table, and a verb missing
// its entry fails closed (refuses every flag). #4834: a refusal is nothing on
// stdout, the offending token named on stderr, the verb's usage line on
// stderr, and exit 1.
// Each verb's positive control runs without the typo and asserts the state
// effect that run actually produces, so a "nothing changed" assertion on the
// refused call can fail. The reconcile verbs run with reconcile() stubbed
// (withReconcileStubbed below): their positive controls assert the stub got
// the parsed flags, and their refusals assert it was never called.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BACKGROUND_CHECKS, CLI_DEFERRED_CHECKS, KNOWN_FLAGS, USAGE, VALUE_FLAGS, VERBS } = require('../plugin/bin/hooks.js');
const { ALL_CHECKS } = require('../plugin/bin/lib/reconcile');
const { BACKGROUND_BUDGET_MS } = require('../plugin/bin/lib/reconcile/budget');
const { readText } = require('./helpers/read-skill');
const { hookEnv: baseHookEnv, fixtureGit, writeIdentity } = require('./helpers/git-fixtures');
const { runCli, spawnCli } = require('./helpers/run-cli');

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

// The complete env a hooks.js call sees. PIPELINE_RUN_DIR: '' neutralizes any ambient run-dir env
// var (#1130). The four repo-pointing git variables are dropped from the ambient copy, so a git
// hook's GIT_DIR cannot steer the verb's git children to another repository.
function hookEnv(env = {}) {
  return baseHookEnv({ ...OFFLINE_GH, ...env });
}

// In-process (#5375): the call goes through hooks.js's run(argv, deps). Real-process coverage is
// the three spawned #4834/AC9.1 tests near the end of this file.
function runHook(args, { cwd = HOOK_SANDBOX, env = {} } = {}) {
  return runCli(HOOKS, args, { cwd, env: hookEnv(env) });
}

// An options object without its undefined-valued keys: strict deep equality tells an absent key from an
// undefined-valued one, which is not a behavior difference here. Every defined field is still compared.
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// reconcile() takes an env for the git children at its no-repo/no-remote gate only (#5376); the
// checks past that gate still start their git and gh children on the runner's own environment,
// so a real pass in this process would reach them. The reconcile verbs therefore run with
// reconcile() and the background spawn stubbed on their module objects. hooks.js looks both
// up through the module object at call time (`reconcileLib.reconcile`,
// `require('./lib/reconcile').reconcile`, the destructure inside runReconcileBackground,
// `require('./lib/reconcile/background-spawn').spawnBackgroundIfStale`), so the stub is what it
// calls. No `fresh: true` on these calls: a reload would hand hooks.js new module objects
// without the stubs.
async function withReconcileStubbed(body, { result = () => ({ skipped: [] }), spawnResult = { spawned: true, reason: 'spawned' } } = {}) {
  const reconcileMod = require('../plugin/bin/lib/reconcile');
  const spawnMod = require('../plugin/bin/lib/reconcile/background-spawn');
  const originalReconcile = reconcileMod.reconcile;
  const originalSpawn = spawnMod.spawnBackgroundIfStale;
  const calls = [];
  const spawnCalls = [];
  reconcileMod.reconcile = async (opts) => { calls.push(opts); return result(opts); };
  spawnMod.spawnBackgroundIfStale = (args) => { spawnCalls.push(args); return spawnResult; };
  try {
    await body();
  } finally {
    reconcileMod.reconcile = originalReconcile;
    spawnMod.spawnBackgroundIfStale = originalSpawn;
  }
  return { calls, spawnCalls };
}

// The unscoped reconcile CLI's inline set: every check but the ones deferred to the background pass.
const INLINE_CHECKS = ALL_CHECKS.filter((c) => !CLI_DEFERRED_CHECKS.includes(c));

// #4834: the refusal shape — nothing on stdout, two stderr lines, exit 1.
function assertRefused(result, verb, firstLine, label) {
  assert.equal(result.code, 1, label);
  assert.equal(result.stdout, '', label);
  assert.equal(result.stderr, `${firstLine}\nclaude-tweaks: usage: ${USAGE[verb]}\n`, label);
}

function runDirFixture(status) {
  const root = tracked(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-flag-'))));
  git(['init', '-q', '--initial-branch=main'], root);
  writeIdentity(root, { name: 'Test', email: 'test@example.com' });
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

// A repo with one empty commit and no run dirs.
function freshRepo() {
  const root = tracked(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-flag-fresh-'))));
  git(['init', '-q', '--initial-branch=main'], root);
  writeIdentity(root, { name: 'Test', email: 'test@example.com' });
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

test('#4777: every VERBS verb refuses an undeclared flag on stderr with exit 1', async () => {
  const { calls, spawnCalls } = await withReconcileStubbed(async () => {
    for (const verb of Object.keys(VERBS)) {
      const result = await runHook([verb, '--definitely-not-a-flag']);
      assertRefused(result, verb, `claude-tweaks: ${verb}: unknown flag '--definitely-not-a-flag'`, verb);
    }
  });
  assert.equal(calls.length + spawnCalls.length, 0, 'no refused call reached reconcile or the background spawn');
});

test('#4777 AC1.1 AC1.2: reconcile --dryrun refuses on stderr with exit 1 and runs no check', async () => {
  const { root } = runDirFixture('clean');
  const refused = await withReconcileStubbed(async () => {
    for (const args of [['reconcile', '--dryrun'], ['reconcile', '--json', '--dryrun']]) {
      const result = await runHook(args, { cwd: root });
      assertRefused(result, 'reconcile', "claude-tweaks: reconcile: unknown flag '--dryrun'", args.join(' '));
      assert.equal(result.stderr, "claude-tweaks: reconcile: unknown flag '--dryrun'\nclaude-tweaks: usage: reconcile [--dry-run] [--json] [--mcp-reachable] [--checks <c1,c2,...>]\n", args.join(' '));
    }
  });
  assert.equal(refused.calls.length, 0, 'the refused calls never reached reconcile()');
  // Declared-flag control: the same verb with its real flags is not refused.
  // This goes red when reconcile's KNOWN_FLAGS entry is removed, since the fail-closed guard then refuses every flag.
  let declared;
  const ran = await withReconcileStubbed(async () => {
    declared = await runHook(['reconcile', '--dry-run', '--json'], { cwd: root });
  });
  assert.doesNotMatch(declared.stdout, /claude-tweaks: usage:/);
  assert.doesNotMatch(declared.stderr, /unknown flag|needs a value/);
  assert.equal(ran.calls.length, 1, 'the declared flags reached reconcile()');
  assert.equal(ran.calls[0].dryRun, true, '--dry-run was parsed');
  assert.equal(JSON.parse(declared.stdout).background.reason, 'dry-run', '--json was parsed');
});

test('#4777: reconcile --json with no typo runs for real (positive control for the reconcile tests)', async () => {
  const { root } = runDirFixture('clean');
  let result;
  const { calls, spawnCalls } = await withReconcileStubbed(async () => {
    result = await runHook(['reconcile', '--json'], { cwd: root, env: { CLAUDE_CODE_SESSION_ID: 'flag-strict-session', CT_FLAG_STRICT_INJECTED_ENV_5376: 'injected' } });
  });
  assert.equal(result.code, 0);
  // In place of the real pass's cache stamp and fast-forward: reconcile() got the parsed flags,
  // and the converged pass handed the deferred checks to the background spawn.
  assert.deepStrictEqual(calls.map(({ env, ...opts }) => defined(opts)), [{ dryRun: false, cwd: root, mcpReachable: false, checks: INLINE_CHECKS }]);
  // The injected env, not process.env, reached reconcile() (#5376). Checked by key, so a failure never
  // prints the runner's environment: the sentinel is set only in the env this call injects.
  assert.equal('CT_FLAG_STRICT_INJECTED_ENV_5376' in process.env, false, 'the sentinel is not in the runner\'s environment');
  assert.ok(calls[0].env && typeof calls[0].env === 'object', 'reconcile() was handed an env');
  assert.equal(calls[0].env.CLAUDE_CODE_SESSION_ID, 'flag-strict-session');
  assert.equal(calls[0].env.CT_FLAG_STRICT_INJECTED_ENV_5376, 'injected');
  // #5377: the verb also hands the injected spawn and env on, so the background spawn uses them.
  assert.equal(spawnCalls.length, 1);
  const { spawn, env, ...spawnArgs } = spawnCalls[0];
  assert.deepStrictEqual(spawnArgs, { root, cwd: root, sessionId: 'flag-strict-session' });
  assert.equal(typeof spawn, 'function');
  // runCli hands hooks.js a frozen copy of the env the test passed, so identity cannot hold: deep-equal
  // against the same env, proving the value was passed through and not rebuilt.
  assert.deepStrictEqual(env, hookEnv({ CLAUDE_CODE_SESSION_ID: 'flag-strict-session', CT_FLAG_STRICT_INJECTED_ENV_5376: 'injected' }));
  assert.deepStrictEqual(JSON.parse(result.stdout).background, { checks: CLI_DEFERRED_CHECKS, spawned: true, reason: 'spawned' });
});

test('#4777: declared value flags consume their value token', async () => {
  const { root } = runDirFixture('clean');
  const cases = [
    ['reconcile', '--dry-run', '--checks', 'mirror'],
    ['reconcile', '--dry-run', '--checks', ''],
  ];
  const { calls } = await withReconcileStubbed(async () => {
    for (const args of cases) {
      const result = await runHook(args, { cwd: root });
      assert.doesNotMatch(result.stdout, /claude-tweaks: usage:/, args.join(' '));
      assert.doesNotMatch(result.stderr, /unknown flag|needs a value/, args.join(' '));
    }
  });
  // Each value token was consumed as --checks' value: 'mirror' scopes the pass, '' leaves it unscoped.
  assert.deepStrictEqual(calls.map((c) => c.checks), [['mirror'], INLINE_CHECKS]);
});

test('#4777: a value flag followed by a flag is refused as a missing value', async () => {
  const { root } = runDirFixture('clean');
  const reconcileCases = [
    [['reconcile', '--dry-run', '--checks', '--json'], "claude-tweaks: reconcile: --checks needs a value, got '--json'"],
    [['reconcile', '--dry-run', '--checks', '--bogus'], "claude-tweaks: reconcile: --checks needs a value, got '--bogus'"],
  ];
  const refused = await withReconcileStubbed(async () => {
    for (const [args, firstLine] of reconcileCases) {
      const result = await runHook(args, { cwd: root });
      assertRefused(result, 'reconcile', firstLine, args.join(' '));
    }
  });
  assert.equal(refused.calls.length, 0, 'the refused calls never reached reconcile()');
  const fresh = freshRepo();
  const resolveCases = [
    [['resolve-run-dir', '--spec-slug', '--bogus', '--create'], "claude-tweaks: resolve-run-dir: --spec-slug needs a value, got '--bogus'"],
    [['resolve-run-dir', '--spec-slug', '--create'], "claude-tweaks: resolve-run-dir: --spec-slug needs a value, got '--create'"],
  ];
  for (const [args, firstLine] of resolveCases) {
    const result = await runHook(args, { cwd: fresh });
    assertRefused(result, 'resolve-run-dir', firstLine, args.join(' '));
    assertNoRunDirMinted(fresh);
  }
});

test('#4777: a flagless verb still runs bare', async () => {
  const { root } = runDirFixture('clean');
  let result;
  const { calls } = await withReconcileStubbed(async () => {
    result = await runHook(['reconcile-summary'], { cwd: root });
  }, { result: () => ({ mirror: { action: 'fast-forwarded' } }) });
  assert.equal(result.code, 0);
  assert.ok(result.stdout.startsWith('reconcile:'), result.stdout);
  // Positive control for reconcile-summary's refusal test, in place of the real fast-forward:
  // the bare run reached its mirror-only reconcile() call and printed that call's mirror result.
  assert.deepStrictEqual(calls.map(defined), [{ cwd: root, checks: ['mirror'], skipCacheStamp: true }]);
  assert.match(result.stdout, /mirror ff ok/);
});

test('#4777: reconcile-background and reconcile-summary refuse an undeclared flag and change nothing', async () => {
  const { root } = runDirFixture('clean');
  const { calls, spawnCalls } = await withReconcileStubbed(async () => {
    for (const verb of ['reconcile-background', 'reconcile-summary']) {
      const result = await runHook([verb, '--bogus'], { cwd: root });
      assertRefused(result, verb, `claude-tweaks: ${verb}: unknown flag '--bogus'`, verb);
      assert.ok(!fs.existsSync(path.join(root, STATUS)), `${verb} wrote no background status`);
    }
  });
  assert.equal(calls.length + spawnCalls.length, 0, 'neither refused verb reached reconcile()');
});

test('#4777: reconcile-background with no typo writes its status file (positive control)', async () => {
  const { root } = runDirFixture('clean');
  let result;
  const { calls } = await withReconcileStubbed(async () => {
    result = await runHook(['reconcile-background'], { cwd: root, env: { CLAUDE_TWEAKS_SESSION_ID: 'flag-strict-bg' } });
  });
  assert.equal(result.stdout, 'claude-tweaks: reconcile-background complete\n');
  assert.ok(fs.existsSync(path.join(root, STATUS)), 'a real background pass writes its status file');
  assert.deepStrictEqual(calls.map(defined), [{ cwd: root, checks: BACKGROUND_CHECKS, sessionId: 'flag-strict-bg', budgetMs: BACKGROUND_BUDGET_MS }]);
});

test('#4777: adopt-run-dir refuses an undeclared flag before adopting', async () => {
  const { root, runDir, runId } = runDirFixture('clean');
  const wt = linkedWorktree(root);
  const copy = path.join(wt, '.claude-tweaks', 'pipelines', runId);
  for (const args of [
    ['adopt-run-dir', '--run', runDir, '--worktree', wt, '--bogus'],
    ['adopt-run-dir', '--bogus', '--run', runDir, '--worktree', wt],
  ]) {
    const result = await runHook(args, { cwd: root });
    assertRefused(result, 'adopt-run-dir', "claude-tweaks: adopt-run-dir: unknown flag '--bogus'", args.join(' '));
    assert.ok(!fs.existsSync(copy), 'nothing was adopted into the worktree');
  }
  // Positive control: the same arguments without the typo adopt the run's decisions.md.
  const adopted = await runHook(['adopt-run-dir', '--run', runDir, '--worktree', wt], { cwd: root });
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

test('#4777: sweep-shadow refuses an undeclared flag before sweeping', async () => {
  const { root, runDir, wt, shadow } = sweepFixture();
  for (const args of [
    ['sweep-shadow', '--run', runDir, '--worktree', wt, '--bogus'],
    ['sweep-shadow', '--bogus', '--run', runDir, '--worktree', wt],
  ]) {
    const result = await runHook(args, { cwd: root });
    assertRefused(result, 'sweep-shadow', "claude-tweaks: sweep-shadow: unknown flag '--bogus'", args.join(' '));
    assert.ok(fs.existsSync(shadow), 'the shadow file is not swept');
  }
});

test('#4777: sweep-shadow with no typo sweeps the shadow file (positive control)', async () => {
  const { root, runDir, wt, shadow } = sweepFixture();
  const result = await runHook(['sweep-shadow', '--run', runDir, '--worktree', wt], { cwd: root });
  assert.equal(result.stdout, 'relocated: proposal.md\n');
  assert.ok(!fs.existsSync(shadow), 'the shadow file is moved out of the worktree');
  assert.ok(fs.existsSync(path.join(runDir, 'staged', 'proposal.md')), 'the proposal lands in the main run dir');
});

// AC10.1 (#5375): a relative --run and --worktree resolve against the injected cwd, not the runner's.
test('AC10.1: sweep-shadow resolves a relative --run and --worktree against the injected cwd', async () => {
  const { root, runDir, wt, shadow } = sweepFixture();
  const result = await runHook(['sweep-shadow', '--run', path.relative(root, runDir), '--worktree', path.relative(root, wt)], { cwd: root });
  assert.deepStrictEqual(result, { code: 0, stdout: 'relocated: proposal.md\n', stderr: '' });
  assert.ok(!fs.existsSync(shadow), 'the shadow file is moved out of the worktree');
  assert.ok(fs.existsSync(path.join(runDir, 'staged', 'proposal.md')), 'the proposal lands in the main run dir');
});

test('#4777: resolve-run-dir --create refuses an undeclared flag and mints nothing', async () => {
  const root = freshRepo();
  for (const args of [
    ['resolve-run-dir', '--spec-slug', 'x', '--create', '--bogus'],
    ['resolve-run-dir', '--bogus', '--spec-slug', 'x', '--create'],
  ]) {
    const result = await runHook(args, { cwd: root });
    assertRefused(result, 'resolve-run-dir', "claude-tweaks: resolve-run-dir: unknown flag '--bogus'", args.join(' '));
    assertNoRunDirMinted(root);
  }
});

test('#4777: resolve-run-dir --create with no typo mints a run dir (positive control)', async () => {
  const root = freshRepo();
  const result = await runHook(['resolve-run-dir', '--spec-slug', 'x', '--create'], { cwd: root });
  assert.equal(result.code, 0);
  const minted = fs.realpathSync(result.stdout.trim());
  assert.ok(minted.startsWith(path.join(root, '.claude-tweaks', 'pipelines') + path.sep), `minted run dir is under pipelines: ${minted}`);
  assert.ok(fs.statSync(minted).isDirectory(), 'a real --create run mints the run dir');
});

test('#4777: --help or -h in a value position still prints usage and runs nothing', async () => {
  const root = freshRepo();
  for (const help of ['--help', '-h']) {
    const mint = await runHook(['resolve-run-dir', '--spec-slug', help, '--create'], { cwd: root });
    assert.equal(mint.code, 0, help);
    assert.equal(mint.stdout, `claude-tweaks: usage: ${USAGE['resolve-run-dir']}\n`, help);
    assertNoRunDirMinted(root);
  }
  const sibling = await runHook(['check-sibling-sessions', '--record', '--help'], { cwd: root });
  assert.equal(sibling.code, 0);
  assert.equal(sibling.stdout, `claude-tweaks: usage: ${USAGE['check-sibling-sessions']}\n`);
});

test('#4777: check-sibling-sessions --record <id> does not print the usage line (declared-flag control)', async () => {
  // Goes red when --record is removed from the verb's KNOWN_FLAGS entry.
  const result = await runHook(['check-sibling-sessions', '--record', 'x'], { cwd: freshRepo() });
  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /claude-tweaks: usage:/);
  assert.doesNotMatch(result.stderr, /unknown flag|needs a value/);
});

// AC10.1 (#5375): check-sibling-sessions excludes the caller's own worktree and claim by the session id in the
// injected env, not the runner's. Both fixtures belong to OWN; the same call under another id is the control.
const OWN = 'ct-sibling-own-session';
const NOT_OWN = 'ct-sibling-other-session';

test('AC10.1: check-sibling-sessions skips a live worktree the injected session recorded', async () => {
  const root = freshRepo();
  const parent = tracked(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-flag-sib-')));
  const wt = path.join(parent, 'wt');
  git(['worktree', 'add', '-q', wt, '-b', 'ct-sib-rec5375x'], root);
  git(['worktree', 'lock', '--reason', `claude session test (pid ${process.pid})`, wt], root);
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-11-15T000000-record-5375x');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', sessionId: OWN, worktree: fs.realpathSync(wt) }));
  const args = ['check-sibling-sessions', '--record', 'rec5375x'];
  const other = await runHook(args, { cwd: root, env: { CLAUDE_CODE_SESSION_ID: NOT_OWN } });
  assert.match(other.stdout, /^claude-tweaks: sibling session may already hold record rec5375x — worktree .* is in use by a live session; verify before claiming\n$/);
  const own = await runHook(args, { cwd: root, env: { CLAUDE_CODE_SESSION_ID: OWN } });
  assert.deepStrictEqual(own, { code: 0, stdout: 'claude-tweaks: no sibling-session conflict found for record rec5375x\n', stderr: '' });
});

test('AC10.1: check-sibling-sessions skips a live claim the injected session holds', async () => {
  const root = freshRepo();
  const sib = tracked(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-flag-claims-'))));
  const origin = path.join(sib, 'origin.git');
  const registry = path.join(sib, 'registry');
  git(['init', '-q', '--bare', origin], sib);
  git(['init', '-q', '--initial-branch=claims-registry', registry], sib);
  fs.mkdirSync(path.join(registry, 'claims'));
  const claim = { runId: 'ct-run', sessionId: OWN, host: 'ct-host', claimedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(registry, 'claims', 'issue-5375.json'), JSON.stringify(claim));
  git(['add', 'claims'], registry);
  git(['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-q', '-m', 'claim'], registry);
  git(['push', '-q', origin, 'claims-registry'], registry);
  git(['remote', 'add', 'origin', origin], root);
  const args = ['check-sibling-sessions', '--record', '5375'];
  const other = await runHook(args, { cwd: root, env: { CLAUDE_CODE_SESSION_ID: NOT_OWN } });
  assert.match(other.stdout, /^claude-tweaks: sibling session may already hold record 5375 — live claim by run ct-run \(session ct-sibling-own-session, /);
  const own = await runHook(args, { cwd: root, env: { CLAUDE_CODE_SESSION_ID: OWN } });
  assert.deepStrictEqual(own, { code: 0, stdout: 'claude-tweaks: no sibling-session conflict found for record 5375\n', stderr: '' });
});

test('#4834: help wins over an unknown flag in the same call', async () => {
  const { root } = runDirFixture('clean');
  const { calls } = await withReconcileStubbed(async () => {
    for (const args of [['reconcile', '--dryrun', '--help'], ['reconcile', '-h', '--dryrun']]) {
      const result = await runHook(args, { cwd: root });
      assert.equal(result.code, 0, args.join(' '));
      assert.equal(result.stdout, `claude-tweaks: usage: ${USAGE.reconcile}\n`, args.join(' '));
    }
  });
  assert.equal(calls.length, 0, 'the help calls never reached reconcile()');
});

// closed stderr: a real fd 2 that refuses writes (AC6)
// Real process: an unguarded fd-2 write would reject into the script entry's catch and exit 0,
// which only a real process shows.
test('#4834: an unusable stderr still refuses with exit 1', () => {
  const f = path.join(tracked(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ro-'))), 'ro');
  fs.writeFileSync(f, '');
  const fd = fs.openSync(f, 'r');
  try {
    const r = spawnSync(process.execPath, [HOOKS, 'resolve-run-dir', '--bogus'], { cwd: HOOK_SANDBOX, stdio: ['ignore', 'pipe', fd], encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '' } });
    assert.ifError(r.error);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
  } finally { fs.closeSync(fd); }
});

// Real process: the dispatcher family's success smoke test (AC9.1) — exit code and stdout of the script entry.
test('AC9.1: node hooks.js resolve-run-dir --root-only prints the repo root and exits 0', () => {
  const root = freshRepo();
  const r = spawnCli(HOOKS, ['resolve-run-dir', '--root-only'], { cwd: root, env: hookEnv() });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), fs.realpathSync(root));
});

test('AC10.1: resolve-run-dir --root-only resolves the injected cwd, not the runner\'s', async () => {
  const root = freshRepo();
  const r = await runCli(HOOKS, ['resolve-run-dir', '--root-only'], { cwd: root, env: hookEnv() });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), fs.realpathSync(root));
});

// Real process: the dispatcher family's refusal smoke test (AC9.1) — what a shell capture of the script entry gets.
test('#4834: a captured resolve-run-dir --root-only with a typo yields an empty value and exit 1', () => {
  const root = freshRepo();
  const result = spawnCli(HOOKS, ['resolve-run-dir', '--root-only', '--typo'], { cwd: root, env: hookEnv() });
  assertRefused(result, 'resolve-run-dir', "claude-tweaks: resolve-run-dir: unknown flag '--typo'", 'root-only typo');
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
