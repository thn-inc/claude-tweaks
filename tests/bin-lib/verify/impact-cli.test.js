'use strict';
// verify.js --scope with an impact declaration (#4024), end to end: a temp git
// repo, a map written into its git common dir, and verify.js spawned as a
// child. The suite's full and subset commands are tiny committed scripts that
// write a marker inside .git/ (never the working tree, so the pass stamp stays
// clean) — scripts rather than `node -e` one-liners because substituteFile
// refuses a quote-bearing template once the list path needs quoting (the
// space-in-path test below).
const { test, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile, execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'verify.js');
const { encodeImpactMap, DEFAULT_MAP_NAME } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'impact.js'));
const { substituteFile } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'file-template.js'));

const TMP_DIRS = [];
after(() => { for (const d of TMP_DIRS) fs.rmSync(d, { recursive: true, force: true }); });

function tmpDir(prefix = 'verify-impact-cli-') {
  // realpath: macOS's os.tmpdir() is a symlink the child sees resolved.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  TMP_DIRS.push(dir);
  return dir;
}

function runCli(args, cwd) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { maxBuffer: 10 * 1024 * 1024, cwd },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

// The command verify.js records for the subset run, derived from the list path
// the report names — so the expectation tracks the platform's quoting.
function expectedSubsetCommand(listPath) {
  const sub = substituteFile('node scripts/subset.js {files}', listPath, { token: '{files}' });
  assert.ok(sub.ok, `substituteFile refused the list path: ${sub.reason}`);
  return sub.command;
}

const TAP = (n) => `console.log("TAP version 13\\nok 1 - x\\n1..${n}\\n# tests ${n}\\n# pass ${n}\\n# fail 0");`;
const SCRIPTS = {
  'scripts/full.js': `require("fs").writeFileSync(".git/impact-marker", "FULL");\n${TAP(2)}\n`,
  'scripts/subset.js': `const fs = require("fs");\nfs.writeFileSync(".git/impact-marker", fs.readFileSync(process.argv[2], "utf8"));\n${TAP(1)}\n`,
  'scripts/fetch.js': 'const fs = require("fs");\nfs.appendFileSync(".git/fetch-count", "x");\n'
    + `fs.copyFileSync(".git/ready-map.json", ".git/${DEFAULT_MAP_NAME}");\n`,
  'scripts/fail-fetch.js': 'require("fs").appendFileSync(".git/fetch-count", "x");\nprocess.exit(3);\n',
};

const RULES = [
  { match: 'src/**', impact: true, static: false },
  { match: 'tests/**', impact: true, static: false },
  { match: 'scripts/**', suites: '*', static: false },
  { match: '.claude-tweaks/**', suites: '*', static: false },
];

function declOf(impact = {}, overrides = {}) {
  return {
    checks: { tests: { tests: 'node scripts/full.js' } },
    impact: { suite: 'tests', command: 'node scripts/subset.js {files}', tests: ['tests/**/*.test.js'], ...impact },
    rules: RULES,
    ...overrides,
  };
}

// The base commit on `main` carries everything; the work happens on `feature`.
function impactRepo(decl = declOf(), extraFiles = {}) {
  const repo = tmpDir();
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q');
  git('symbolic-ref', 'HEAD', 'refs/heads/main');
  git('config', 'user.email', 'verify-test@example.invalid');
  git('config', 'user.name', 'verify test');
  const files = {
    ...SCRIPTS,
    'src/x.js': 'x\n',
    'src/y.js': 'y\n',
    'tests/a.test.js': 'a\n',
    'tests/b.test.js': 'b\n',
    '.claude-tweaks/verify-scope.json': JSON.stringify(decl),
    ...extraFiles,
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), content);
  }
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  git('checkout', '-q', '-b', 'feature');
  const gitDir = path.join(repo, '.git');
  return {
    repo, git, base, gitDir,
    marker: () => fs.readFileSync(path.join(gitDir, 'impact-marker'), 'utf8'),
    report: () => JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8')),
    stamp: () => JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify-pass.json'), 'utf8')),
  };
}

function mapJson(commit, extra = {}) {
  return JSON.stringify(encodeImpactMap({
    commit, tracedAt: '2026-10-24T00:00:00Z', exitCode: 0, node: process.version,
    tests: { 'tests/a.test.js': { f: ['src/x.js'] }, 'tests/b.test.js': { f: ['src/y.js'] } },
    ...extra,
  }));
}

function writeMap(r, commit = r.base, name = DEFAULT_MAP_NAME) {
  fs.writeFileSync(path.join(r.gitDir, name), mapJson(commit));
}

function commitFile(r, rel, content) {
  fs.writeFileSync(path.join(r.repo, rel), content);
  r.git('add', rel);
  r.git('commit', '-q', '-m', `edit ${rel}`);
}

const ARGS = ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', 'main'];

test('selects the subset (AC1.1 report shape)', async () => {
  const r = impactRepo();
  writeMap(r);
  commitFile(r, 'src/x.js', 'x2\n');
  const run = await runCli(ARGS, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'tests/a.test.js\n');
  const report = r.report();
  const imp = report.scope.impact;
  assert.strictEqual(imp.selected, 1);
  assert.strictEqual(imp.fallback, null);
  assert.deepStrictEqual(imp.files, ['tests/a.test.js']);
  assert.deepStrictEqual(imp.selectedFiles, ['tests/a.test.js']);
  assert.strictEqual(imp.listPath, path.join(r.gitDir, 'claude-tweaks-verify', 'impact-files.txt'));
  assert.strictEqual(imp.mapPath, path.join(r.gitDir, DEFAULT_MAP_NAME));
  assert.strictEqual(imp.mapCommit, r.base);
  assert.strictEqual(imp.mapAgeCommits, 1);
  assert.strictEqual(imp.fetch, null);
  assert.strictEqual(typeof report.durationMs, 'number');
  assert.strictEqual(report.scope.mode, 'scoped');
  assert.strictEqual(report.checks.tests.command, expectedSubsetCommand(imp.listPath), 'the recorded command is the substituted subset command');
  assert.match(run.stdout, /^Impact: 1 of 2 test file\(s\) selected/m);
  assert.match(run.stdout, new RegExp(`^Scope: [^\\n]*\\nImpact: 1 of 2 test file\\(s\\) selected \\(map ${r.base.slice(0, 9)}, 1 commit\\(s\\) old\\)$`, 'm'), 'printed right after the Scope: line');
  const stamp = r.stamp();
  assert.strictEqual(stamp.scope, 'scoped');
  assert.strictEqual(stamp.fullSha, r.base, 'the merge-base anchors the stamp');
});

test('a subset run leaves the count stamp untouched', async () => {
  const r = impactRepo();
  writeMap(r);
  const countPath = path.join(r.gitDir, 'claude-tweaks-test-count.json');
  const before = `${JSON.stringify({ tests: 99, sha: r.base, recordedAt: '2026-10-24T00:00:00Z' })}\n`;
  fs.writeFileSync(countPath, before);
  commitFile(r, 'src/x.js', 'x2\n');
  const run = await runCli(ARGS, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'tests/a.test.js\n');
  assert.strictEqual(r.report().checks.tests.counts.tests, 1, 'the subset count parsed — the guard, not a parse miss, keeps the stamp');
  assert.strictEqual(fs.readFileSync(countPath, 'utf8'), before);
  assert.doesNotMatch(run.stdout, /CAVEAT: .*count/i);
  assert.strictEqual(r.report().testCountRegression, undefined);
});

test('missing map runs full and names it (AC5.1)', async () => {
  const r = impactRepo();
  commitFile(r, 'src/x.js', 'x2\n');
  const run = await runCli(ARGS, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'FULL');
  const imp = r.report().scope.impact;
  assert.strictEqual(imp.fallback, 'map-missing');
  assert.strictEqual(imp.files, null);
  assert.strictEqual(imp.listPath, null);
  assert.strictEqual(imp.selectedFiles, null);
  assert.strictEqual(r.report().checks.tests.command, 'node scripts/full.js');
  assert.match(run.stdout, /^Impact: full tests — map-missing$/m);
});

test('stale map (AC5.1)', async () => {
  const r = impactRepo(declOf({ maxAgeCommits: 1 }));
  writeMap(r);
  commitFile(r, 'src/y.js', 'y2\n');
  commitFile(r, 'src/x.js', 'x2\n');
  const run = await runCli(ARGS, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'FULL');
  assert.strictEqual(r.report().scope.impact.fallback, 'map-stale: 2 commits > 1');
  assert.strictEqual(r.report().scope.impact.mapAgeCommits, 2);
});

test('non-ancestor map', async () => {
  const r = impactRepo();
  const orphan = r.git('commit-tree', 'HEAD^{tree}', '-m', 'orphan').trim();
  writeMap(r, orphan);
  commitFile(r, 'src/x.js', 'x2\n');
  const run = await runCli(ARGS, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'FULL');
  assert.strictEqual(r.report().scope.impact.fallback, 'map-not-ancestor');
  assert.strictEqual(r.report().scope.impact.mapCommit, orphan);
  assert.match(run.stdout, /^Impact: full tests — map-not-ancestor$/m);
});

test('fetch runs once on a problem', async () => {
  const r = impactRepo(declOf({ fetch: 'node scripts/fetch.js' }));
  fs.writeFileSync(path.join(r.gitDir, 'ready-map.json'), mapJson(r.base));
  commitFile(r, 'src/x.js', 'x2\n');
  const run = await runCli(ARGS, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'tests/a.test.js\n');
  const imp = r.report().scope.impact;
  assert.strictEqual(imp.fetch.ran, true);
  assert.strictEqual(imp.fetch.exitCode, 0);
  assert.strictEqual(typeof imp.fetch.durationMs, 'number');
  assert.strictEqual(imp.selected, 1);
  assert.strictEqual(fs.readFileSync(path.join(r.gitDir, 'fetch-count'), 'utf8'), 'x', 'exactly one fetch');
});

test('a failed fetch keeps the original problem and reports the fetch', async () => {
  const r = impactRepo(declOf({ fetch: 'node scripts/fail-fetch.js' }));
  commitFile(r, 'src/x.js', 'x2\n');
  const run = await runCli(ARGS, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'FULL');
  const imp = r.report().scope.impact;
  assert.strictEqual(imp.fallback, 'map-missing');
  assert.strictEqual(imp.fetch.exitCode, 3);
  assert.strictEqual(imp.fetch.timedOut, false);
  assert.strictEqual(imp.fetch.signal, null);
  assert.strictEqual(fs.readFileSync(path.join(r.gitDir, 'fetch-count'), 'utf8'), 'x');
});

test('no stamp and an explicit --base (no --integration-branch) runs full: --base never anchors an impact run', async () => {
  const r = impactRepo();
  writeMap(r);
  commitFile(r, 'src/x.js', 'x2\n');
  const run = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--base', r.base], r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'FULL');
  const report = r.report();
  assert.strictEqual(report.scope.mode, 'full');
  assert.strictEqual(report.scope.impact.fallback, 'no-anchor');
  assert.strictEqual(report.scope.impact.files, null);
});

test('a fresh map never fetches', async () => {
  const r = impactRepo(declOf({ fetch: 'node scripts/fetch.js' }));
  writeMap(r);
  commitFile(r, 'src/x.js', 'x2\n');
  const run = await runCli(ARGS, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.report().scope.impact.fetch, null);
  assert.strictEqual(fs.existsSync(path.join(r.gitDir, 'fetch-count')), false);
});

test('{files} path with a space is quoted', async () => {
  const r = impactRepo();
  writeMap(r);
  commitFile(r, 'src/x.js', 'x2\n');
  const logDir = path.join(tmpDir(), 'dir with space', 'logs');
  const run = await runCli([...ARGS, '--log-dir', logDir], r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'tests/a.test.js\n');
  const report = JSON.parse(fs.readFileSync(path.join(logDir, 'report.json'), 'utf8'));
  assert.strictEqual(report.scope.impact.selected, 1);
  assert.strictEqual(report.scope.impact.listPath, path.join(logDir, 'impact-files.txt'));
  assert.strictEqual(report.checks.tests.command, expectedSubsetCommand(report.scope.impact.listPath), 'the recorded command is the substituted subset command, quoted');
});

test('an impact.command with quotes of its own cannot take a path that needs quoting: full, files-list-unquotable', async () => {
  const r = impactRepo(declOf({ command: 'node scripts/subset.js {files} --label "a b"' }));
  writeMap(r);
  commitFile(r, 'src/x.js', 'x2\n');
  const logDir = path.join(tmpDir(), 'dir with space', 'logs');
  const run = await runCli([...ARGS, '--log-dir', logDir], r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'FULL');
  const imp = JSON.parse(fs.readFileSync(path.join(logDir, 'report.json'), 'utf8')).scope.impact;
  assert.strictEqual(imp.fallback, 'files-list-unquotable: template-quotes');
  assert.strictEqual(imp.files, null);
  assert.strictEqual(fs.existsSync(path.join(logDir, 'impact-files.txt')), false, 'no list is written for a refused hand-over');
  assert.match(run.stdout, /^Impact: full tests — files-list-unquotable: template-quotes$/m);
});

test('a selected test path holding a line break cannot be listed: full, files-list-unwritable', { skip: process.platform === 'win32' }, async () => {
  const odd = 'tests/we\nird.test.js';
  const r = impactRepo(declOf(), { [odd]: 'odd\n' });
  fs.writeFileSync(path.join(r.gitDir, DEFAULT_MAP_NAME), mapJson(r.base, {
    tests: { 'tests/a.test.js': { f: ['src/y.js'] }, [odd]: { f: ['src/x.js'] } },
  }));
  commitFile(r, 'src/x.js', 'x2\n');
  const run = await runCli(ARGS, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'FULL');
  const imp = r.report().scope.impact;
  assert.strictEqual(imp.fallback, 'files-list-unwritable: line break in tests/we\\x0aird.test.js');
  assert.strictEqual(fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify', 'impact-files.txt')), false);
});

test('a single-string checks.tests needs no --cmd in subset mode, but does on fallback', async () => {
  const decl = declOf({}, { checks: { tests: 'node scripts/full.js' } });
  const r = impactRepo(decl);
  writeMap(r);
  commitFile(r, 'src/x.js', 'x2\n');
  const subset = await runCli(ARGS, r.repo);
  assert.strictEqual(subset.code, 0, subset.stderr + subset.stdout);
  assert.strictEqual(r.marker(), 'tests/a.test.js\n');
  fs.rmSync(path.join(r.gitDir, DEFAULT_MAP_NAME));
  const full = await runCli(ARGS, r.repo);
  assert.strictEqual(full.code, 2);
  assert.match(full.stderr, /requires --cmd for: tests/);
  const withCmd = await runCli([...ARGS, '--cmd', 'tests=node scripts/full.js'], r.repo);
  assert.strictEqual(withCmd.code, 0, withCmd.stderr + withCmd.stdout);
  assert.strictEqual(r.marker(), 'FULL');
});

test('a --cmd for the impact suite is the full command on fallback, and gives way to the subset', async () => {
  const r = impactRepo();
  writeMap(r);
  commitFile(r, 'src/x.js', 'x2\n');
  const args = [...ARGS, '--cmd', 'tests=node scripts/full.js --override'];
  const run = await runCli(args, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'tests/a.test.js\n');
  fs.rmSync(path.join(r.gitDir, DEFAULT_MAP_NAME));
  const fallback = await runCli(args, r.repo);
  assert.strictEqual(fallback.code, 0, fallback.stderr + fallback.stdout);
  assert.strictEqual(r.marker(), 'FULL');
  assert.strictEqual(r.report().checks.tests.command, 'node scripts/full.js --override');
});

test('a full-suite rule supersedes the subset', async () => {
  const r = impactRepo();
  writeMap(r);
  fs.writeFileSync(path.join(r.repo, 'scripts', 'extra.js'), '\n');
  r.git('add', 'scripts/extra.js');
  r.git('commit', '-q', '-m', 'extra');
  const run = await runCli(ARGS, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'FULL');
  assert.strictEqual(r.report().scope.impact.superseded, true);
  assert.match(run.stdout, /^Impact: full tests — superseded by a full-suite rule$/m);
});

test('a change no impact rule matches never reads the map or runs the declared fetch', async () => {
  const r = impactRepo(declOf({ fetch: 'node scripts/fetch.js' }));
  // No map at all: an eager load would run the fetch (and report map-missing) before the full-suite rule won.
  commitFile(r, 'scripts/extra.js', '\n');
  const run = await runCli(ARGS, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'FULL');
  const imp = r.report().scope.impact;
  assert.strictEqual(imp.superseded, true);
  assert.strictEqual(imp.mapPath, null);
  assert.strictEqual(imp.mapCommit, null);
  assert.strictEqual(imp.fetch, null);
  assert.strictEqual(fs.existsSync(path.join(r.gitDir, 'fetch-count')), false, 'the fetch never ran');
});

test('no impact block → no scope.impact key', async () => {
  const decl = {
    checks: { tests: { tests: 'node scripts/full.js' } },
    rules: [{ match: '**', suites: ['tests'], static: false }],
  };
  const r = impactRepo(decl);
  // Without an impact block the first run is full (no anchor), then scoped.
  const first = await runCli(ARGS, r.repo);
  assert.strictEqual(first.code, 0, first.stderr + first.stdout);
  commitFile(r, 'src/x.js', 'x2\n');
  const run = await runCli(ARGS, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  const report = r.report();
  assert.strictEqual(report.scope.mode, 'scoped');
  assert.strictEqual(Object.hasOwn(report.scope, 'impact'), false);
  assert.doesNotMatch(run.stdout, /^Impact:/m);
  assert.strictEqual(fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify', 'impact-files.txt')), false);
});
