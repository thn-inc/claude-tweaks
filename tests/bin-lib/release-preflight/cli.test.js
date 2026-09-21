'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'release-preflight.js');
const { run, parseArgs } = require(CLI);

// `gh` has to be genuinely unfindable for the real-binary test below, and a
// PATH assembled from git's and node's own directories does not achieve that:
// on Homebrew macOS `git` and `gh` share /opt/homebrew/bin, so gh was found
// and spawned for real (F1). One empty scratch directory holding symlinks to
// the real git and the running node, used as the WHOLE PATH, is what makes
// git and node resolve while gh stays ENOENT.
function ghAbsentBinDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-preflight-bin-'));
  fs.symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), path.join(dir, 'git'));
  fs.symlinkSync(process.execPath, path.join(dir, 'node'));
  return dir;
}
const BIN_DIR = ghAbsentBinDir();

function mainCheckoutWithRun() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-preflight-cli-')));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 't'); git('commit', '-q', '--allow-empty', '-m', 'init'); git('branch', '-M', 'main');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'integration-model: local-merge\n');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-09-12T000000-record-2255');
  fs.mkdirSync(runDir, { recursive: true });
  return { root, runDir };
}

const packDeps = { execFileAsync: async () => { const e = new Error('spawn gh ENOENT'); e.code = 'ENOENT'; throw e; } };

function baseDeps(fx, env = {}) {
  let out = ''; let err = '';
  return { d: { cwd: () => fx.root, mainRoot: fx.root, env, stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, packDeps }, out: () => out, err: () => err };
}

test('parseArgs: --run/--json/--only, unknown flags and unknown probes are usage errors', () => {
  assert.deepStrictEqual(parseArgs(['--run', '/r', '--only', 'engine,lastTag']), { run: '/r', json: null, only: ['engine', 'lastTag'] });
  assert.throws(() => parseArgs(['--bogus']), /unknown flag/);
  assert.throws(() => parseArgs(['--only', 'nope']), /unknown probe: nope/);
  assert.throws(() => parseArgs(['--run']), /requires a value/);
  // An empty list asks for nothing — never silently "everything".
  assert.throws(() => parseArgs(['--only', ',']), /names no probes/);
});

test('AC 4a: --run anchored under the main checkout → exit 0, release-preflight.json written there with every field, printed to stdout', async () => {
  const fx = mainCheckoutWithRun();
  const { d, out } = baseDeps(fx);
  assert.strictEqual(await run(['--run', fx.runDir], d), 0);
  const file = JSON.parse(fs.readFileSync(path.join(fx.runDir, 'release-preflight.json'), 'utf8'));
  for (const k of ['engine', 'lastTag', 'unreleased', 'proposedVersion', 'releasePr', 'ciTip', 'openReleasePrConflict', 'hook']) assert.ok(k in file, k);
  assert.strictEqual(file.engine.value, 'local-merge');
  assert.strictEqual(file.releasePr.value, 'none');
  assert.strictEqual(JSON.parse(out()).engine.value, 'local-merge');
});

test('AC 4b: PIPELINE_RUN_DIR in the environment is the run dir when --run is absent', async () => {
  const fx = mainCheckoutWithRun();
  const { d } = baseDeps(fx, { PIPELINE_RUN_DIR: fx.runDir });
  assert.strictEqual(await run([], d), 0);
  assert.ok(fs.existsSync(path.join(fx.runDir, 'release-preflight.json')));
});

test('AC 4c: no run dir at all → a fresh scratch dir under the temp dir, its path on stderr', async () => {
  const fx = mainCheckoutWithRun();
  const { d, err } = baseDeps(fx);
  assert.strictEqual(await run([], d), 0);
  const m = /release-preflight\.json written to (\S+)/.exec(err());
  assert.ok(m, err());
  assert.ok(m[1].startsWith(fs.realpathSync(os.tmpdir())) || m[1].startsWith(os.tmpdir()), m[1]);
  assert.ok(fs.existsSync(m[1]));
});

test('exit 3: --run not anchored under the main checkout, or a cwd outside any git checkout', async () => {
  const fx = mainCheckoutWithRun();
  const { d, err } = baseDeps(fx);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'release-preflight-outside-'));
  assert.strictEqual(await run(['--run', outside], d), 3);
  assert.match(err(), /refused/);
  const nogit = fs.mkdtempSync(path.join(os.tmpdir(), 'release-preflight-nogit-'));
  const { d: d2, err: err2 } = baseDeps({ root: nogit });
  d2.mainRoot = undefined;
  assert.strictEqual(await run([], d2), 3);
  assert.match(err2(), /not inside a git checkout/);
});

test('exit 2: usage errors print USAGE and write nothing', async () => {
  const fx = mainCheckoutWithRun();
  const { d, err } = baseDeps(fx);
  assert.strictEqual(await run(['--only', 'nope'], d), 2);
  assert.match(err(), /usage:/);
  assert.strictEqual(await run(['--only', ','], d), 2);
  assert.match(err(), /names no probes/);
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'release-preflight.json')));
});

test('--only writes a partial pack; --json redirects it (parent must resolve under the main checkout)', async () => {
  const fx = mainCheckoutWithRun();
  const { d } = baseDeps(fx);
  const target = path.join(fx.runDir, 'sub', 'pack.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  assert.strictEqual(await run(['--run', fx.runDir, '--only', 'engine', '--json', target], d), 0);
  const file = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.deepStrictEqual(Object.keys(file).filter((k) => ['engine', 'lastTag'].includes(k)), ['engine']);
});

test('the real binary: exit 0 on the fixture with no origin — ciTip and releasePr are data, not exit codes (AC 3)', () => {
  const fx = mainCheckoutWithRun();
  fs.writeFileSync(path.join(fx.root, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  // BIN_DIR is the whole PATH: git and node resolve through their symlinks
  // there, `gh` does not exist at all (ENOENT), so the GitHub-backed fields
  // degrade for the reason this test claims they do.
  const out = execFileSync('node', [CLI, '--run', fx.runDir], { cwd: fx.root, encoding: 'utf8', env: { ...process.env, PATH: BIN_DIR } });
  const pack = JSON.parse(out);
  assert.strictEqual(pack.ciTip.ok, false);
  assert.strictEqual(pack.releasePr.ok, false);
  assert.strictEqual(pack.engine.ok, true);
});
