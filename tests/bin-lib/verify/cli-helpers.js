'use strict';
// Shared fixtures for the tests/bin-lib/verify/cli*.test.js family (one verify.js CLI
// suite, split across files so CI can spread it over parallel shards).
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile, execFileSync } = require('child_process');
const { fromTemplate } = require('../../helpers/git-template');
const { scratchDir } = require('../../helpers/tmp-dir');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'verify.js');

// Every invocation runs from a fresh temp dir — never from this repo — so the
// runner's git-dir-relative defaults (#1921) can never write into the real
// checkout's .git (a stamp or count written by a test would poison the next
// real run's skip/caveat decisions).
function tmpDir() {
  // realpathSync: on macOS, os.tmpdir() is a symlink (/var -> /private/var)
  // that a spawned child's own process.cwd() reports already resolved — an
  // unresolved mkdtemp path compared against a path the CLI derives from its
  // own cwd would spuriously mismatch on this platform alone.
  return scratchDir('verify-cli-test-', { realpath: true });
}

// With no `opts.env`, the child skips the machine-wide suite slot exactly as under
// tools/run-tests.js (#5119), so a direct `node --test` of a cli*.test.js file never queues on the real lock.
function runCli(args, opts = {}) {
  const cwd = opts.cwd || tmpDir();
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], {
      maxBuffer: 10 * 1024 * 1024, cwd, env: opts.env || { ...process.env, CT_TEST_SUITE_SLOT_HELD: '1' }, ...(opts.timeout ? { timeout: opts.timeout } : {}),
    },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr, cwd }));
  });
}

// A throwaway git repo with one commit: git-dir === {repo}/.git. Copied from a
// once-per-process template (#5297); `git` is rebuilt for the copy.
const gitIn = (cwd) => (...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// init, the committer identity, one empty commit. The identity is appended to
// .git/config as text, so building a template starts no `git config` process.
function initVerifyRepo(dir) {
  gitIn(dir)('init', '-q');
  fs.appendFileSync(path.join(dir, '.git', 'config'), '[user]\n\temail = verify-test@example.invalid\n\tname = verify test\n');
  gitIn(dir)('commit', '-q', '--allow-empty', '-m', 'init');
}

// What a template's build learned that a copy cannot re-derive without a git process
// (key -> { branch, baseSha? }); written only inside the build, read on every call.
const buildMeta = new Map();

// The branch HEAD names, asked of git once inside a template build (works for any ref format).
function recordBranch(key, dir) {
  buildMeta.set(key, { ...buildMeta.get(key), branch: gitIn(dir)('symbolic-ref', '--short', 'HEAD').trim() });
}

function metaOf(label, key) {
  const meta = buildMeta.get(key);
  if (!meta) throw new Error(`${label}: the template build left no metadata under ${key}`);
  return meta;
}

// A repo copied from a template built once per process under `key`.
function templatedRepo(key, build) {
  const repo = fromTemplate(key, build, { prefix: 'verify-cli-test-', realpath: true });
  return { repo, git: gitIn(repo), gitDir: path.join(repo, '.git') };
}

function tmpGitRepo() {
  return templatedRepo('verify-cli:repo', initVerifyRepo);
}

// Builds a `node -e` fixture command that runs the same under /bin/sh and
// cmd.exe. verify.js runs every --cmd through spawn(cmd, { shell: true }), and
// cmd.exe gives ' no meaning, so a POSIX-only single-quoted -e script exits 1
// on Windows. The script reads paths and values from argv (process.argv[1],
// ...) and never has them spliced into its text, so no quoting is needed.
function nodeCmd(script, ...args) {
  const scriptBad = script.match(/["$`\\%]/);
  if (scriptBad) throw new Error(`nodeCmd: script contains ${JSON.stringify(scriptBad[0])}, which /bin/sh or cmd.exe interprets; pass the value as an argument instead`);
  for (const arg of args) {
    // A doubled backslash collapses to one inside /bin/sh double quotes but
    // stays doubled in cmd.exe's argv, so it is refused like the rest.
    const argBad = arg.match(/["$`%]|\\\\/);
    if (argBad || arg.endsWith('\\')) throw new Error(`nodeCmd: argument ${JSON.stringify(arg)} contains ${argBad ? JSON.stringify(argBad[0]) : 'a trailing backslash'}, which /bin/sh or cmd.exe interprets`);
  }
  return [`node -e "${script}"`, ...args.map((a) => `"${a}"`)].join(' ');
}

// A declaration file inside a temp repo, plus a marker-touching "unit" command
// so a test can prove a suite was or was not spawned. Two suites are declared
// so "every declared suite selected" (which collapses to mode full) is not
// trivially true whenever the one suite's rule matches.
function scopedRepo(rules, extra = {}) {
  // The arguments shape the committed declaration, so they are in the key.
  const key = `verify-cli:scoped:${JSON.stringify([rules, extra])}`;
  const r = templatedRepo(key, (dir) => {
    initVerifyRepo(dir);
    recordBranch(key, dir);
    const decl = { checks: { tests: { unit: 'placeholder', other: 'placeholder' } }, rules, ...extra };
    fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
    gitIn(dir)('add', '.claude-tweaks/verify-scope.json');
    gitIn(dir)('commit', '-q', '-m', 'declare verify scope');
  });
  // Inside .git/, not the working tree: git status --porcelain never sees it,
  // so a passing run's own "unit ran" side-effect can't make the stamp read
  // dirty:true at write time -- these tests are about scope/verifiedHead
  // semantics, not about deliberately dirtying the tree (that is its own
  // dedicated scenario elsewhere in cli.test.js, refs #1921 review fix).
  const marker = path.join(r.gitDir, 'unit-ran.marker');
  // Built with nodeCmd: the script takes the marker path from argv, never from
  // its text. verify.js runs --cmd through shell:true, and cmd.exe gives '
  // no meaning, so a path spliced into a single-quoted -e script breaks on
  // Windows, while a double-quoted one nests quotes the shell closes early.
  const unitCmd = nodeCmd("require('fs').writeFileSync(process.argv[1], 'ran')", marker);
  // The temp repo has no origin, so --integration-branch names its own local
  // branch — whatever init.defaultBranch made it (master on this machine).
  const { branch } = metaOf('scopedRepo', key);
  return { ...r, marker, unitCmd, branch, declPath: '.claude-tweaks/verify-scope.json' };
}

function stampOf(gitDir) {
  return JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify-pass.json'), 'utf8'));
}

// Every file in a git dir that shares the pass stamp's name prefix: the JSON stamp, plus
// anything that should not be there (a bare-SHA file, a stray tmp). Sorted for a stable compare.
const passStampFiles = (gitDir) => fs.readdirSync(gitDir).filter((f) => f.startsWith('claude-tweaks-verify-pass')).sort();

function commitFile(r, rel, content) {
  fs.mkdirSync(path.dirname(path.join(r.repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(r.repo, rel), content);
  r.git('add', rel);
  r.git('commit', '-q', '-m', `add ${rel}`);
}

// A repo whose string-form tests command prints a TAP failure naming
// `failingFile` and exits 1, plus a retry template whose command writes a
// marker with the retried file and exits `retryExit`. `flaky` overrides
// the declaration's flaky section (default: tests/flaky.test.js listed).
function flakyRepo({ failingFile = 'tests/flaky.test.js', retryExit = 0, flaky = { files: ['tests/flaky.test.js'] }, extraDecl = {} } = {}) {
  // Every option shapes the committed files, so all four are in the key, in a fixed order.
  const key = `verify-cli:flaky:${JSON.stringify({ failingFile, retryExit, flaky, extraDecl })}`;
  const r = templatedRepo(key, (dir) => {
    initVerifyRepo(dir);
    recordBranch(key, dir);
    const tap = ['not ok 1 - a flaky one', '  ---', '  stack: |-', `    at TestContext.<anonymous> (${failingFile}:12:5)`, '  ...', '# tests 1', '# pass 0', '# fail 1'].join('\n');
    fs.writeFileSync(path.join(dir, 'fail.js'), `process.stdout.write(${JSON.stringify(tap)} + '\\n'); process.exit(1);\n`);
    fs.writeFileSync(path.join(dir, 'retry.js'), `require('fs').writeFileSync('retry.marker', process.argv[2]); process.exit(${retryExit});\n`);
    const decl = {
      checks: { tests: 'node fail.js' },
      retry: { tests: 'node retry.js {file}' },
      rules: [{ match: 'src/**', suites: ['tests'], static: true }],
      flaky,
      ...extraDecl,
    };
    fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
    gitIn(dir)('add', '.');
    gitIn(dir)('commit', '-q', '-m', 'flaky fixture');
  });
  const { branch } = metaOf('flakyRepo', key);
  const args = ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd', 'tests=node fail.js'];
  return { ...r, branch, args, marker: path.join(r.repo, 'retry.marker'), retryLog: (i) => path.join(r.gitDir, 'claude-tweaks-verify', `tests-retry-tests+flaky.test.js-${i}.log`) };
}

// #1928 AC1: the runner is the mechanical source of the verify event.
function anchoredRunDir(repo) {
  const dir = path.join(repo, '.claude-tweaks', 'pipelines', '2026-09-06T100000-record-7');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// #3043: a repo whose base commit already carries a failing test file.
function baselineRepo() {
  const key = 'verify-cli:baseline';
  const r = templatedRepo(key, (dir) => {
    initVerifyRepo(dir);
    fs.mkdirSync(path.join(dir, 'tests'));
    fs.writeFileSync(path.join(dir, 'tests', 'env.test.js'), "require('node:test')('env', () => { throw new Error('env-specific'); });\n");
    fs.writeFileSync(path.join(dir, 'tests', 'ok.test.js'), "require('node:test')('ok', () => {});\n");
    gitIn(dir)('add', '.');
    gitIn(dir)('commit', '-q', '-m', 'base');
    buildMeta.set(key, { ...buildMeta.get(key), baseSha: gitIn(dir)('rev-parse', 'HEAD').trim() });
  });
  const { baseSha } = metaOf('baselineRepo', key);
  return { ...r, baseSha, opts: { cwd: r.repo, env: nestedRunEnv() } };
}
const SUITE = 'tests=node --test --test-reporter=tap tests/env.test.js tests/ok.test.js';
const PER_FILE = 'tests=node --test --test-reporter=tap {file}';
// A `node --test` child of this suite inherits NODE_TEST_CONTEXT, which makes a
// nested `node --test` run the file bare (no reporter output, exit 0 on a
// failing test) — the fixtures' inner runs need it stripped to be real runs.
// CT_TEST_SUITE_SLOT_HELD=1, as runCli's default env sets it (#5119): these runs never take the
// real machine-wide slot, even when a cli*.test.js file runs directly rather than under tools/run-tests.js.
function nestedRunEnv() {
  const env = { ...process.env, CT_TEST_SUITE_SLOT_HELD: '1' };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

// A commit on top of the base, so HEAD is not contained in it (I1).
function headCommit(r) {
  fs.writeFileSync(path.join(r.repo, 'README.md'), 'change\n');
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'head');
}

const RUN_TESTS = path.join(__dirname, '..', '..', '..', 'tools', 'run-tests.js');
const reportAt = (r) => JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
const withoutWait = ({ waitedMs, ...rest }) => rest;
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Resolves with `file`'s text once it matches `re`.
async function waitForText(file, re, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (re.test(text)) return text;
    if (Date.now() > deadline) throw new Error(`${file} never matched ${re}: ${JSON.stringify(text)}`);
    await pause(50);
  }
}

module.exports = {
  CLI,
  tmpDir,
  runCli,
  tmpGitRepo,
  nodeCmd,
  scopedRepo,
  stampOf,
  passStampFiles,
  commitFile,
  flakyRepo,
  anchoredRunDir,
  baselineRepo,
  SUITE,
  PER_FILE,
  nestedRunEnv,
  headCommit,
  RUN_TESTS,
  reportAt,
  withoutWait,
  pause,
  waitForText,
};
