const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('node:os');
const path = require('node:path');

const { runCliSync, spawnCli } = require('../../helpers/run-cli');
const { STUB_SKIP } = require('../../helpers/path-stub');
const { CLI } = require('./cli-helpers');
const { writeIdentity } = require('../../helpers/git-fixtures');

// The complete environment the CLI sees: its git and npm children need PATH, and HOME keeps a global
// git config reachable. SystemRoot and USERPROFILE are what a Windows child needs to start.
const CLI_ENV = { PATH: process.env.PATH, HOME: os.homedir() };
for (const key of ['SystemRoot', 'USERPROFILE']) if (process.env[key] !== undefined) CLI_ENV[key] = process.env[key];

// The env a spawnCli smoke gets: CLI_ENV, plus the variables tools/count-node-procs.js counts through.
const SMOKE_ENV = { ...CLI_ENV };
for (const key of ['NODE_OPTIONS', 'CT_COUNT_NODE_LOG']) if (process.env[key] !== undefined) SMOKE_ENV[key] = process.env[key];

// The CLI's own runner, which these tests drive for `git`; a `gh` argv is answered from `gh` instead
// (a string is the stdout, null is "gh unavailable"), so no test reaches the network or the user's gh login.
// Being a wrapper, it is not the real `runner` value the helper's fail-closed rule replaces.
const { realDeps } = require(CLI);
function gitRunner({ gh = null } = {}) {
  return (argv, opts) => (argv[0] === 'gh' ? gh : realDeps.runner(argv, opts));
}

// In-process call (#5385); maps the helper's `code` onto the `status` field the assertions use.
function run(args, opts = {}) {
  const { code, stdout, stderr } = runCliSync(CLI, args, { env: CLI_ENV, deps: { runner: gitRunner() }, ...opts });
  return { status: code, stdout, stderr };
}

// A fixture git call that ignores any repo-locating variable the test process inherited.
function git(cwd, ...args) {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepo(prefix, branch = 'main') {
  const root = scratchDir(prefix);
  git(root, 'init', '-q', '-b', branch);
  writeIdentity(root, { name: 'Test', email: 'test@example.com' });
  git(root, 'commit', '--allow-empty', '-q', '-m', 'init');
  return root;
}

test('omitting --base exits 2 with the usage message on stderr', () => {
  const r = run([]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: residue\.js --base <commit-ish>/);
});

// Real process: proves the script entry (the require.main guard), exit 0 and the JSON on stdout.
test('a real run with --base HEAD --no-suite --json exits 0 and prints the scope and results as JSON', () => {
  const root = initRepo('residue-cli-smoke-');
  const res = spawnCli(CLI, ['--base', 'HEAD', '--no-suite', '--json'], { cwd: root, env: SMOKE_ENV });
  assert.strictEqual(res.code, 0, res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.strictEqual(parsed.scope.base, 'HEAD');
  assert.ok(Array.isArray(parsed.results));
});

// Real process: proves the script entry turns run's usage refusal into the exit code (AC6.1); the baseline
// for a no-argument call is exit 2, empty stdout and the usage line on stderr.
test('AC6.1: no arguments is a usage refusal — exit 2, empty stdout, the usage line', () => {
  const root = initRepo('residue-cli-noarg-');
  const res = spawnCli(CLI, [], { cwd: root, env: SMOKE_ENV });
  assert.strictEqual(res.code, 2);
  assert.strictEqual(res.stdout, '');
  assert.strictEqual(res.stderr, 'usage: residue.js --base <commit-ish> [--scope repo|blast-radius] [--integration-branch <ref>] [--own-pr <n>] [--no-suite] [--json]\n');
});

// #1781: --own-pr parses as an integer and threads through to the forge
// probe's `ownPr` result field.
test('#1781: --own-pr 42 parses and is not itself an open PR here, so ownPr is null', () => {
  const root = initRepo('residue-cli-ownpr-');
  // The fake gh answers an open-PR list that does not contain #42, so the forge probe's PR loop runs and finds no own PR.
  const gh = JSON.stringify([{ number: 7, title: 'other', headRefName: 'other-lane' }]);
  const r = run(['--base', 'HEAD', '--no-suite', '--json', '--own-pr', '42'], { cwd: root, deps: { runner: gitRunner({ gh }) } });
  assert.strictEqual(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  // results[2] is the forge probe (worktrees, branches, forge, suite, release, pipeline-runs, artifacts).
  assert.ok(Object.prototype.hasOwnProperty.call(parsed.results[2], 'ownPr'), 'forge result carries an ownPr field');
  // ran: true and PR #7 among the findings: the PR loop ran, so the null is not an early bail-out.
  assert.strictEqual(parsed.results[2].ran, true, parsed.results[2].reason);
  assert.ok(parsed.results[2].findings.some((f) => f.subject === 'PR #7'), JSON.stringify(parsed.results[2].findings));
  assert.strictEqual(parsed.results[2].ownPr, null);
});

test('#1781: --own-pr 7 names an open PR here, so ownPr is that PR and it is not a finding', () => {
  const root = initRepo('residue-cli-ownpr-match-');
  const gh = JSON.stringify([{ number: 7, title: 'other', headRefName: 'other-lane' }]);
  const r = run(['--base', 'HEAD', '--no-suite', '--json', '--own-pr', '7'], { cwd: root, deps: { runner: gitRunner({ gh }) } });
  assert.strictEqual(r.status, 0, r.stderr);
  const forge = JSON.parse(r.stdout).results[2];
  assert.strictEqual(forge.ran, true, forge.reason);
  assert.deepStrictEqual(forge.ownPr, { number: 7, headRefName: 'other-lane' });
  assert.ok(!forge.findings.some((f) => f.subject === 'PR #7'), 'the own PR is reported on ownPr, not as residue');
});

test('#1781: a non-integer --own-pr value is rejected with the usage error', () => {
  const r = run(['--base', 'HEAD', '--own-pr', 'not-a-number']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /--own-pr must be an integer/);
});

// The fixture of #1118's test: two clean run dirs under one repo, one of them the invoking run's.
function pipelineRunsFixture() {
  const root = initRepo('residue-cli-pipeline-runs-');
  const pipelinesDir = path.join(root, '.claude-tweaks', 'pipelines');
  const ownRunDir = path.join(pipelinesDir, '2026-01-01T000000-record-1118');
  const siblingRunDir = path.join(pipelinesDir, '2026-01-01T000000-record-999');
  fs.mkdirSync(ownRunDir, { recursive: true });
  fs.mkdirSync(siblingRunDir, { recursive: true });
  fs.writeFileSync(path.join(ownRunDir, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  fs.writeFileSync(path.join(siblingRunDir, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  return { root, ownRunDir, siblingRunDir };
}

function pipelineRunFindings(stdout) {
  return JSON.parse(stdout).results.flatMap((r) => r.findings).filter((f) => f.kind === 'pipeline-run');
}

// End-to-end through the CLI's own env-var wiring (bin/residue.js's
// PIPELINE_RUN_DIR -> runId basename), not just the probe function directly
// (tests/bin-lib/residue/probes-pipeline-runs.test.js already covers that) —
// #1118.
test('PIPELINE_RUN_DIR env attributes only that run dir under --scope blast-radius (#1118)', () => {
  const { root, ownRunDir } = pipelineRunsFixture();
  const r = run(['--base', 'HEAD', '--scope', 'blast-radius', '--json', '--no-suite'], {
    cwd: root, env: { ...CLI_ENV, PIPELINE_RUN_DIR: ownRunDir },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const findings = pipelineRunFindings(r.stdout);
  assert.strictEqual(findings.length, 1, `expected exactly one attributable pipeline-run finding, got ${JSON.stringify(findings)}`);
  // The length check above already excludes the sibling dir: it can only be
  // the one finding or an extra one, and this pins which of the two it is.
  assert.match(findings[0].subject, /record-1118/, 'the sibling run dir must not be attributed to this run');
});

test('AC9.1: PIPELINE_RUN_DIR is read from the injected env, not the process env', () => {
  const { root, ownRunDir, siblingRunDir } = pipelineRunsFixture();
  // The process env names the sibling run: a CLI that reads it attributes the wrong run dir.
  const before = process.env.PIPELINE_RUN_DIR;
  process.env.PIPELINE_RUN_DIR = siblingRunDir;
  let r;
  try {
    r = run(['--base', 'HEAD', '--scope', 'blast-radius', '--json', '--no-suite'], {
      cwd: root, env: { ...CLI_ENV, PIPELINE_RUN_DIR: ownRunDir },
    });
  } finally {
    if (before === undefined) delete process.env.PIPELINE_RUN_DIR; else process.env.PIPELINE_RUN_DIR = before;
  }
  assert.strictEqual(r.status, 0, r.stderr);
  const findings = pipelineRunFindings(r.stdout);
  assert.strictEqual(findings.length, 1, `expected exactly one attributable pipeline-run finding, got ${JSON.stringify(findings)}`);
  assert.match(findings[0].subject, /record-1118/, 'the injected env names the run, not the process env');
});

// Env-only fixture (model: forgePair in tests/forge-probe-env.test.js): repo A, on `main`, is the CLI's
// cwd; repo B, on `branch-b`, is named only through GIT_DIR in the injected env. A git child that gets the
// env reads B's HEAD, so the scope's headBranch is B's; one that inherits the process env reads A's.
// B also holds a second commit and the run is given its sha as --base: only B has it, so `scope.ran: true`
// means the rev-parse child read B. `scope.base` is just the argv echo (scope.js sets it even for an unresolved base).
test('AC9.1: the runner git children get the injected env', () => {
  const a = initRepo('residue-cli-env-a-', 'main');
  const b = initRepo('residue-cli-env-b-', 'branch-b');
  git(b, 'commit', '--allow-empty', '-q', '-m', 'only in b');
  const shaB = git(b, 'rev-parse', 'HEAD').trim();
  const r = run(['--base', shaB, '--no-suite', '--json'], {
    cwd: a, env: { ...CLI_ENV, GIT_DIR: path.join(b, '.git') },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const { scope } = JSON.parse(r.stdout);
  assert.strictEqual(scope.ran, true);
  assert.strictEqual(scope.headBranch, 'branch-b');
  assert.strictEqual(scope.base, shaB);
});

// The gh branch of the runner: ghOptions reads the origin through its git child and gh's config dir from the
// env and home it is given. Repo A (the cwd) has no origin; repo B has a GitHub Enterprise one and is named only
// through GIT_DIR in the injected env. A gh stub first on the injected PATH records the GH_HOST it was started
// with: the host is set only if ghOptions got what it needs. `configEnv(dir)` places hosts.yml's lookup.
// The runner is a pass-through to the CLI's real one except for `git ls-remote`, so the release probe never
// contacts the made-up host.
function ghHostRun(configEnv) {
  const a = initRepo('residue-cli-gh-a-');
  const b = initRepo('residue-cli-gh-b-');
  git(b, 'remote', 'add', 'origin', 'https://ghe.example.test/o/r.git');
  const stubDir = scratchDir('residue-cli-gh-stub-');
  const marker = path.join(stubDir, 'host.txt');
  fs.writeFileSync(path.join(stubDir, 'gh'), `#!/bin/sh\nprintf '%s' "$GH_HOST" > "${marker}"\necho '[]'\n`);
  fs.chmodSync(path.join(stubDir, 'gh'), 0o755); // root-safe: exec-bit stub, not a denial simulation
  const cfg = scratchDir('residue-cli-gh-cfg-');
  const runner = (argv, opts) => (argv[1] === 'ls-remote' ? null : realDeps.runner(argv, opts));
  const env = { ...CLI_ENV, PATH: stubDir + path.delimiter + CLI_ENV.PATH, GIT_DIR: path.join(b, '.git'), ...configEnv(cfg) };
  const r = run(['--base', 'HEAD', '--no-suite', '--json'], { cwd: a, env, deps: { runner } });
  assert.strictEqual(r.status, 0, r.stderr);
  return { r, host: fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : null };
}

test('AC9.1: the gh child gets GH_HOST from an origin read through the injected env', { skip: STUB_SKIP }, () => {
  const { r, host } = ghHostRun((cfg) => {
    fs.writeFileSync(path.join(cfg, 'hosts.yml'), 'ghe.example.test:\n');
    return { GH_CONFIG_DIR: cfg };
  });
  assert.strictEqual(host, 'ghe.example.test');
  assert.match(r.stderr, /gh calls get GH_HOST=ghe\.example\.test/, 'the note goes to the injected stderr');
});

// Neither GH_CONFIG_DIR nor XDG_CONFIG_HOME is set, so hosts.yml is looked up under the injected home
// (<home>/.config/gh/hosts.yml) through deps.homeDir; a lookup through os.homedir() would miss it.
test('AC9.1: the gh config dir falls back to the injected home', { skip: STUB_SKIP }, () => {
  const { host } = ghHostRun((home) => {
    fs.mkdirSync(path.join(home, '.config', 'gh'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'gh', 'hosts.yml'), 'ghe.example.test:\n');
    return { HOME: home, USERPROFILE: home };
  });
  assert.strictEqual(host, 'ghe.example.test');
});

// probeWorktrees' dirty check is its own git child (defaultIsDirty). Git config injected through the
// env makes an untracked-only worktree read clean: `dirty: false` only if that child got the env.
test('AC9.1: the worktree dirty check gets the injected env', () => {
  const root = initRepo('residue-cli-dirty-');
  const wt = path.join(scratchDir('residue-cli-dirty-wt-'), 'side');
  git(root, 'worktree', 'add', '-q', '-b', 'side', wt);
  fs.writeFileSync(path.join(wt, 'untracked.txt'), 'x');
  const env = {
    ...CLI_ENV, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'status.showUntrackedFiles', GIT_CONFIG_VALUE_0: 'no',
  };
  const r = run(['--base', 'HEAD', '--no-suite', '--json'], { cwd: root, env });
  assert.strictEqual(r.status, 0, r.stderr);
  const findings = JSON.parse(r.stdout).results.flatMap((x) => x.findings).filter((f) => f.kind === 'worktree');
  assert.strictEqual(findings.length, 1, JSON.stringify(findings));
  assert.match(findings[0].evidence, /dirty: false,/);
});

function suiteRepo(declaration) {
  const root = initRepo('residue-cli-suite-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "require(\'fs\').writeFileSync(\'suite-ran\', process.env.RESIDUE_PROBE || \'x\')"' } }));
  if (declaration) {
    fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(declaration));
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'suite');
  return root;
}

const DECL = { checks: { tests: 'npm test' }, rules: [{ match: '**', suites: '*', static: false }], ci: { tests: { workflow: 'test.yml', job: 'test' } } };
const suiteResult = (out) => JSON.parse(out).results[3]; // worktrees, branches, forge, suite, …

// runSuite is left as the CLI's real one: the helper's fail-closed rule throws if the probe reaches it.
test('AC7.1, AC7.3: with localRuns the probe never starts npm test and names the CI job (#5370)', () => {
  const root = suiteRepo({ ...DECL, localRuns: 'on-request' });
  const r = run(['--base', 'HEAD', '--json'], { cwd: root });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(suiteResult(r.stdout).ran, false);
  assert.match(suiteResult(r.stdout).reason, /^not run on this machine — .*takes tests \(test\.yml \/ test\) from the PR's CI job/);
  assert.ok(!fs.existsSync(path.join(root, 'suite-ran')), 'npm test must not start');
});

// allowRealRunner: the subject is that the real `npm test` child starts, in the injected cwd with the injected env.
test('AC7.2, AC7.3: without the key the probe runs npm test as before (#5370)',
  { skip: process.platform === 'win32' && 'win32: residue.js spawns npm without a shell, and npm is npm.cmd there' }, () => {
    const root = suiteRepo(DECL);
    const r = run(['--base', 'HEAD', '--json'], { cwd: root, env: { ...CLI_ENV, RESIDUE_PROBE: 'injected' }, allowRealRunner: true });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(suiteResult(r.stdout).ran, true);
    assert.ok(fs.existsSync(path.join(root, 'suite-ran')), 'npm test must run');
    assert.strictEqual(fs.readFileSync(path.join(root, 'suite-ran'), 'utf8'), 'injected', 'the npm child got the injected env');
  });

test('AC9.1: the suite run gets the injected cwd and env', () => {
  const root = suiteRepo(DECL);
  const seen = [];
  const runSuite = (o) => { seen.push(o); return { code: 0, stdout: '' }; };
  const env = { ...CLI_ENV, RESIDUE_PROBE: 'injected' };
  const r = run(['--base', 'HEAD', '--json'], { cwd: root, env, deps: { runner: gitRunner(), runSuite } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].cwd, root);
  assert.strictEqual(seen[0].env.RESIDUE_PROBE, 'injected');
  assert.strictEqual(suiteResult(r.stdout).ran, true);
});

// #1281: runner()'s execFileSync call set no `maxBuffer`, so it silently
// inherited Node's 1 MiB default; probeRelease's `git show HEAD:CHANGELOG.md`
// is the one call through that seam that reads a file this repo's own
// CHANGELOG.md (~268KB and growing) could plausibly outgrow. A >1 MiB
// CHANGELOG.md used to overflow the default buffer, get swallowed by
// runner()'s bare `catch { return null; }`, and read as an ordinary
// `reason: 'could not read CHANGELOG.md or docs/shipped-versions.tsv at
// HEAD'` degraded probe rather than a distinguishable failure. Confirmed red
// against the pre-fix runner(): this exact fixture reproduced that reason.
test('probeRelease reads a >1 MiB CHANGELOG.md at HEAD without silently overflowing the default maxBuffer (#1281)', () => {
  const root = initRepo('residue-cli-maxbuffer-');

  // #2257: probeRelease no longer reads a plugin manifest at all — it needs
  // a .release-please-manifest.json BOOTSTRAP commit (its own `git log
  // --diff-filter=A` anchor) as a separate, earlier commit from the
  // CHANGELOG/tag one below, so the probe's own bootstrap-commit lookup has
  // something real to find.
  fs.writeFileSync(path.join(root, '.release-please-manifest.json'), JSON.stringify({ '.': '9.9.0' }));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'bootstrap release-please');

  // '# padding\n' is 10 bytes; 150,000 repeats is ~1.43 MiB, comfortably past
  // execFileSync's 1 MiB default so a real overflow (not a near-miss) is
  // what this fixture exercises.
  const changelog = '# padding\n'.repeat(150000) + '## v9.9.9 — test release\n';
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), changelog);
  assert.ok(Buffer.byteLength(changelog) > 1024 * 1024, 'fixture CHANGELOG.md must actually exceed the 1 MiB default');

  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'release v9.9.9');
  git(root, 'tag', 'v9.9.9');

  const r = run(['--base', 'HEAD', '--no-suite', '--json'], { cwd: root });
  assert.strictEqual(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  const overflowReason = /could not read CHANGELOG\.md or the v\* tag list at HEAD/;
  assert.ok(
    !parsed.results.some((x) => typeof x.reason === 'string' && overflowReason.test(x.reason)),
    `probeRelease must not silently fail to read a >1 MiB CHANGELOG.md, got results: ${JSON.stringify(parsed.results)}`,
  );
  assert.ok(
    !parsed.results.flatMap((x) => x.findings).some((f) => f.kind === 'release'),
    'the v9.9.9 tag and its CHANGELOG heading are both present, so a successful read reports zero release findings',
  );
});
