// tests/hooks-spec-status.test.js — the `node bin/hooks.js spec-status` CLI
// wrapper (#690): couples a multi-spec manifest.yml status transition to the
// `## Flow: Running ...` progress banner so a phase transition can't happen
// through this command without also producing the banner.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { readManifest } = require('../plugin/bin/lib/flow/manifest');
const { runCli, spawnCli } = require('./helpers/run-cli');
const { hookEnv } = require('./helpers/git-fixtures');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

// #1130: never let an omitted cwd fall through to the spawned subprocess's
// own process.cwd() — that is the test runner's real working directory, and
// when npm test runs from a real checkout, hooks that walk
// .claude-tweaks/pipelines/ from there write fixture events into REAL run
// dirs (the #657 pollution incident). Calls that don't care about cwd get an
// isolated, non-git sandbox instead.
const HOOK_SANDBOX = scratchDir('ct-specstatus-sandbox-');

// Runs the verb in-process (#5376); the script entry has its own smoke test below.
async function runHook(args, { input = '', cwd = HOOK_SANDBOX, env = {} } = {}) {
  const r = await runCli(HOOKS, args, { cwd, env: hookEnv(env), stdin: input });
  return { code: r.code, stdout: r.stdout };
}

function runDirWithManifest(specs) {
  const project = scratchDir('ct-specstatus-');
  // #790: --run must resolve under a real git checkout (see bin/hooks.js's
  // resolveRunArg anchoring check) — every runHook() call below passes
  // { cwd: run } so the in-process call's injected cwd resolves this same checkout.
  execFileSync('git', ['-C', project, 'init', '-q']);
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-08-16T210742-spec-1-2');
  fs.mkdirSync(run, { recursive: true });
  // #1566: resolveRunArg now requires an initialized run dir (a real
  // multi-spec parent already carries this from the Manifesto, before
  // manifest.yml itself is ever written) — spec-status has no first-write
  // exception of its own, so this fixture needs a marker too.
  fs.writeFileSync(path.join(run, 'decisions.md'), '');
  const lines = ['multispec:', '  parent: x/', '  specs:'];
  for (const s of specs) {
    lines.push(`    - id: ${s.id}`, `      status: ${s.status}`, `      subdir: spec-${s.id}/`);
  }
  fs.writeFileSync(path.join(run, 'manifest.yml'), lines.join('\n') + '\n');
  return run;
}

test('spec-status running: prints exactly the banner and writes status=running to manifest.yml, in one call', async () => {
  const run = runDirWithManifest([{ id: 157, status: 'pending' }, { id: 159, status: 'pending' }]);
  const r = await runHook(['spec-status', '--run', run, '--spec', '159', '--status', 'running', '--phase', 'build'], { cwd: run });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '## Flow: Running build (2/2) — spec #159\n');
  const manifest = readManifest(run);
  assert.equal(manifest.multispec.specs[1].status, 'running');
  assert.ok(manifest.multispec.specs[1].startedAt, 'a running transition must record startedAt');
});

test('spec-status complete: prints the banner AND the wrap-up-exit summary line, and writes status=complete', async () => {
  const run = runDirWithManifest([{ id: 159, status: 'pending' }]);
  await runHook(['spec-status', '--run', run, '--spec', '159', '--status', 'running', '--phase', 'build', '--now', '2026-05-16T14:00:00.000Z'], { cwd: run });
  const r = await runHook(['spec-status', '--run', run, '--spec', '159', '--status', 'complete', '--phase', 'wrap-up', '--now', '2026-05-16T14:12:34.000Z'], { cwd: run });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '## Flow: Running wrap-up (1/1) — spec #159\nspec #159: complete — deferred (12m34s)\n');
  assert.equal(readManifest(run).multispec.specs[0].status, 'complete');
});

test('spec-status failed: also prints the summary line', async () => {
  const run = runDirWithManifest([{ id: 42, status: 'pending' }]);
  await runHook(['spec-status', '--run', run, '--spec', '42', '--status', 'running', '--phase', 'test', '--now', '2026-01-01T00:00:00.000Z'], { cwd: run });
  const r = await runHook(['spec-status', '--run', run, '--spec', '42', '--status', 'failed', '--phase', 'test', '--now', '2026-01-01T00:03:00.000Z'], { cwd: run });
  assert.match(r.stdout, /^## Flow: Running test \(1\/1\) — spec #42\n/);
  assert.match(r.stdout, /spec #42: failed — deferred \(3m00s\)\n$/);
});

test('a phase transition without the banner is not reachable through spec-status: every failure path prints no banner and writes nothing', async () => {
  // Missing manifest entirely — but otherwise an initialized run dir (#1566:
  // resolveRunArg now requires an initialized target for spec-status, so
  // this needs a marker file to isolate "no manifest.yml" from "uninitialized
  // --run", which is a separate rejection covered in hooks-dispatcher.test.js).
  const bareDir = scratchDir('ct-specstatus-bare-');
  execFileSync('git', ['-C', bareDir, 'init', '-q']); // #790: --run must resolve under a real git checkout
  fs.writeFileSync(path.join(bareDir, 'decisions.md'), '');
  const rMissing = await runHook(['spec-status', '--run', bareDir, '--spec', '1', '--status', 'running', '--phase', 'build'], { cwd: bareDir });
  assert.equal(rMissing.code, 0);
  assert.doesNotMatch(rMissing.stdout, /Flow: Running/);

  // Unknown spec id.
  const run = runDirWithManifest([{ id: 42, status: 'pending' }]);
  const rUnknown = await runHook(['spec-status', '--run', run, '--spec', '999', '--status', 'running', '--phase', 'build'], { cwd: run });
  assert.doesNotMatch(rUnknown.stdout, /Flow: Running/);
  assert.equal(readManifest(run).multispec.specs[0].status, 'pending', 'no write on an unknown spec id');

  // Invalid status value.
  const rBadStatus = await runHook(['spec-status', '--run', run, '--spec', '42', '--status', 'bogus', '--phase', 'build'], { cwd: run });
  assert.doesNotMatch(rBadStatus.stdout, /Flow: Running/);
  assert.equal(readManifest(run).multispec.specs[0].status, 'pending', 'no write on an invalid status');

  // Missing required flags.
  const rNoFlags = await runHook(['spec-status', '--run', run], { cwd: run });
  assert.match(rNoFlags.stdout, /usage: spec-status/);
  assert.doesNotMatch(rNoFlags.stdout, /Flow: Running/);
});

test('spec-status with a non-existent --run path fails loudly instead of falling back or claiming success', async () => {
  const run = runDirWithManifest([{ id: 1, status: 'pending' }]);
  const bogus = path.join(path.dirname(run), 'does-not-exist');
  const result = await runHook(['spec-status', '--run', bogus, '--spec', '1', '--status', 'running', '--phase', 'build']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /--run path rejected/);
});

// #3035: manifest-init creates the file spec-status only updates.
function runDirNoManifest() {
  const run = runDirWithManifest([{ id: 1, status: 'pending' }]);
  fs.rmSync(path.join(run, 'manifest.yml'));
  return run;
}

test('#3035: spec-status with no manifest names the manifest-init command; manifest-init then makes the first spec-status succeed', async () => {
  const run = runDirNoManifest();
  const refused = await runHook(['spec-status', '--run', run, '--spec', '2', '--status', 'running', '--phase', 'build'], { cwd: run });
  assert.match(refused.stdout, /\(no-manifest\)/);
  assert.match(refused.stdout, /manifest-init --run ".*" --specs <n1,n2,\.\.\.>/);

  const init = await runHook(['manifest-init', '--run', run, '--specs', '1,2'], { cwd: run });
  assert.equal(init.code, 0);
  assert.match(init.stdout, /manifest\.yml ready .* 2 specs \(2 added, 0 already present\)/);
  assert.deepEqual(readManifest(run).multispec.specs.map((s) => [s.id, s.status, s.subdir]), [[1, 'pending', 'spec-1/'], [2, 'pending', 'spec-2/']]);

  const first = await runHook(['spec-status', '--run', run, '--spec', '2', '--status', 'running', '--phase', 'build'], { cwd: run });
  assert.equal(first.stdout, '## Flow: Running build (2/2) — spec #2\n');
});

test('#3035: manifest-init is idempotent on resume — a running spec keeps its status and phases[]', async () => {
  const run = runDirNoManifest();
  await runHook(['manifest-init', '--run', run, '--specs', '1,2'], { cwd: run });
  await runHook(['spec-status', '--run', run, '--spec', '1', '--status', 'running', '--phase', 'build'], { cwd: run });
  const r = await runHook(['manifest-init', '--run', run, '--specs', '1,2'], { cwd: run });
  assert.match(r.stdout, /2 specs \(0 added, 2 already present\)/);
  const spec1 = readManifest(run).multispec.specs[0];
  assert.equal(spec1.status, 'running');
  assert.equal(spec1.phases.length, 1);
});

test('#3035: manifest-init refuses without --specs or with a bad id, writing nothing', async () => {
  const run = runDirNoManifest();
  assert.match((await runHook(['manifest-init', '--run', run], { cwd: run })).stdout, /usage: manifest-init/);
  assert.match((await runHook(['manifest-init', '--run', run, '--specs', '1,a b'], { cwd: run })).stdout, /\(invalid-spec-id\)/);
  assert.equal(fs.existsSync(path.join(run, 'manifest.yml')), false);
});

test('spec-status without a resolvable run dir exits 0 and prints a not-recorded notice', async () => {
  const bare = scratchDir('ct-specstatus-norun-');
  const result = await runHook(['spec-status', '--spec', '1', '--status', 'running', '--phase', 'build'], { cwd: bare });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /no pipeline run dir found — spec status not recorded/);
});

// #5376: the injected cwd is the only thing that can resolve a relative --run, so a verb that
// read process.cwd() instead would reject the path (the runner's cwd is not this fixture).
test('AC6.1: spec-status resolves a relative --run against the injected cwd', async () => {
  const run = runDirWithManifest([{ id: 7, status: 'pending' }]);
  const project = path.resolve(run, '..', '..', '..');
  assert.notEqual(fs.realpathSync(process.cwd()), fs.realpathSync(project), 'the injected cwd must differ from the runner\'s');
  const rel = path.relative(project, run);
  const r = await runHook(['spec-status', '--run', rel, '--spec', '7', '--status', 'running', '--phase', 'build'], { cwd: project });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '## Flow: Running build (1/1) — spec #7\n');
  assert.equal(readManifest(run).multispec.specs[0].status, 'running');
});

// real process: the script entry (shebang, process.argv, the exit code) of spec-status (AC5.1) — the same
// transition on two identical fixtures, once in-process and once through a spawned `node hooks.js`, with
// the identical explicit env, must print the same banner and exit 0.
test('AC5.1: spec-status running through runCli and spawnCli prints the same banner, exit 0', async () => {
  const argsFor = (run) => ['spec-status', '--run', run, '--spec', '159', '--status', 'running', '--phase', 'build'];
  const runA = runDirWithManifest([{ id: 157, status: 'pending' }, { id: 159, status: 'pending' }]);
  const runB = runDirWithManifest([{ id: 157, status: 'pending' }, { id: 159, status: 'pending' }]);
  const inProcess = await runHook(argsFor(runA), { cwd: runA });
  const spawned = spawnCli(HOOKS, argsFor(runB), { cwd: runB, env: hookEnv() });
  assert.deepEqual({ code: spawned.code, stdout: spawned.stdout }, inProcess);
  assert.equal(inProcess.code, 0);
  assert.equal(inProcess.stdout, '## Flow: Running build (2/2) — spec #159\n');
});
