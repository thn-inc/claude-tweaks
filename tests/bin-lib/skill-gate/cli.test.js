// tests/bin-lib/skill-gate/cli.test.js — pins plugin/bin/skill-gate.js (record
// #5605): the printed verdict per invocation, the fail-open cases (AC6), the
// decisions.md skip line and its anchoring (AC7), and the usage exits (AC12).
// Real git fixtures, in-process through runCliSync; one spawn smoke test.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const { runCliSync, spawnCli } = require('../../helpers/run-cli');
const { gitRepo, linkedWorktreeOf, fixtureGit, FIXTURE_TIMEOUT_MS } = require('../../helpers/git-fixtures');
const { chmodDenialSkip } = require('../../helpers/root');
const { gate: libGate } = require('../../../plugin/bin/lib/skill-gate');
const { canonicalRealpath } = require('../../../plugin/bin/lib/path-guard');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'skill-gate.js');

const ENV = {
  PATH: process.env.PATH,
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.test',
};

function cli(argv, { cwd, deps } = {}) {
  const r = runCliSync(CLI, argv, { env: ENV, cwd, deps });
  let json = null;
  if (r.stdout.startsWith('{')) json = JSON.parse(r.stdout);
  return { ...r, json };
}

function git(dir, args) {
  return fixtureGit(['-C', dir, ...args], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: FIXTURE_TIMEOUT_MS });
}

function write(dir, rel, text) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
}

function repo() {
  return gitRepo({ branch: 'main' });
}

function runDirIn(main, name = 'run-1') {
  const dir = path.join(main, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function assertCannotTell(r) {
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, 'proceed');
  assert.ok(r.json.reason.startsWith('cannot tell: '), r.json.reason);
  assert.equal(r.stderr.split('\n').filter((l) => l !== '').length, 1, r.stderr);
  assert.equal(r.stderr, `skill-gate: ${r.json.reason}\n`);
  assert.equal(r.json.logged, undefined);
}

// Runs the CLI with the --run/--section/--step triple on an anchored run dir,
// and asserts a cannot-tell result left decisions.md absent (nothing logged).
function cliLogged(main, argv, opts = {}) {
  const runDir = runDirIn(main);
  const r = cli([...argv, '--run', runDir, '--section', '/build', '--step', 'Common Step 6'], { cwd: main, ...opts });
  assertCannotTell(r);
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false);
  return r;
}

const SKIP_FILES = 'tests/a.test.js,.claude-tweaks/pipelines/r/work/1-spec.md';

test('AC1.1-AC1.7: test-only diff skips journeys, visual-review and every wrapper mode', () => {
  const main = repo();
  const base = ['--files', SKIP_FILES, '--surface', 'backend'];
  const journeys = cli(['--skill', 'journeys', ...base], { cwd: main });
  assert.match(journeys.stdout, /"decision":"skip"/);
  const visual = cli(['--skill', 'visual-review', ...base], { cwd: main });
  assert.match(visual.stdout, /"decision":"skip"/);
  assert.deepEqual(visual.json.journeys, []);
  for (const mode of ['pre-build', 'test', 'review', 'polish', 'survey']) {
    const r = cli(['--skill', 'design-wrapper', '--mode', mode, ...base], { cwd: main });
    assert.match(r.stdout, /"decision":"skip"/, `${mode}: ${r.stdout}`);
    assert.equal(r.code, 0);
  }
});

test('journeys: a source file proceeds with a rule reason, no stderr (AC6.7)', () => {
  const main = repo();
  const r = cli(['--skill', 'journeys', '--files', 'plugin/bin/x.js'], { cwd: main });
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, 'proceed');
  assert.ok(!r.json.reason.startsWith('cannot tell: '), r.json.reason);
  assert.equal(r.stderr, '');
});

test('AC6.1: an unresolvable base proceeds with cannot tell and logs nothing', { timeout: FIXTURE_TIMEOUT_MS * 2 }, () => {
  const main = repo();
  const runDir = runDirIn(main);
  const r = cli(['--skill', 'journeys', '--integration-branch', 'no-such-branch', '--run', runDir, '--section', '/build', '--step', 'Common Step 6'], { cwd: main });
  assertCannotTell(r);
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false);
});

test('Review Focus 4: a branch equal to HEAD gives an empty list, which is cannot tell', () => {
  const main = repo();
  const r = cli(['--skill', 'journeys', '--integration-branch', 'main'], { cwd: main });
  assertCannotTell(r);
  assert.match(r.json.reason, /empty/);
});

test('--integration-branch resolves the branch diff: a committed source file proceeds, test-only skips', () => {
  const main = repo();
  git(main, ['checkout', '-q', '-b', 'feature']);
  write(main, 'tests/a.test.js', 'x\n');
  git(main, ['add', 'tests/a.test.js']);
  git(main, ['commit', '-q', '-m', 'tests']);
  const onlyTests = cli(['--skill', 'journeys', '--integration-branch', 'main'], { cwd: main });
  assert.equal(onlyTests.json.decision, 'skip', onlyTests.stdout);
  write(main, 'plugin/bin/x.js', 'y\n');
  git(main, ['add', 'plugin/bin/x.js']);
  git(main, ['commit', '-q', '-m', 'src']);
  const withSource = cli(['--skill', 'journeys', '--integration-branch', 'main'], { cwd: main });
  assert.equal(withSource.json.decision, 'proceed', withSource.stdout);
  assert.match(withSource.json.reason, /plugin\/bin\/x\.js/);
});

test('AC6.2: an unreadable docs/journeys/ is cannot tell', chmodDenialSkip('root ignores mode bits'), () => {
  const main = repo();
  const dir = path.join(main, 'docs', 'journeys');
  write(main, 'docs/journeys/x.md', '# x\n');
  fs.chmodSync(dir, 0o000);
  try {
    cliLogged(main, ['--skill', 'journeys', '--files', 'tests/a.test.js']);
  } finally {
    fs.chmodSync(dir, 0o755);
  }
});

test('AC6.3: a journey whose frontmatter never closes is cannot tell', () => {
  const main = repo();
  write(main, 'docs/journeys/x.md', '---\nfiles:\n');
  cliLogged(main, ['--skill', 'journeys', '--files', 'tests/a.test.js']);
});

function symlinkOrSkip(t, target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    fs.symlinkSync(target, linkPath);
  } catch (e) {
    if (e.code === 'EPERM' && process.platform === 'win32') { t.skip('symlink creation needs privilege'); return false; }
    throw e;
  }
  return true;
}

test('AC6.4: a journey symlink resolving outside the checkout is never read, cannot tell', (t) => {
  const main = repo();
  const outside = scratchDir('ct-skill-gate-out-');
  const target = write(outside, 'secret.md', '---\nfiles:\n  - plugin/bin/x.js\n---\n');
  if (!symlinkOrSkip(t, target, path.join(main, 'docs', 'journeys', 'x.md'))) return;
  const r = cliLogged(main, ['--skill', 'journeys', '--files', 'tests/a.test.js']);
  assert.match(r.json.reason, /outside/);
});

test('a docs/journeys directory symlinked outside the checkout is never read, cannot tell', (t) => {
  const main = repo();
  const outside = scratchDir('ct-skill-gate-outdir-');
  write(outside, 'x.md', '---\nfiles:\n  - plugin/bin/x.js\n---\n');
  fs.mkdirSync(path.join(main, 'docs'), { recursive: true });
  if (!symlinkOrSkip(t, outside, path.join(main, 'docs', 'journeys'))) return;
  const r = cliLogged(main, ['--skill', 'journeys', '--files', 'tests/a.test.js']);
  assert.match(r.json.reason, /docs\/journeys is a symlink that resolves outside the checkout/);
});

test('a dangling docs/journeys symlink is cannot tell, not "no journeys"', (t) => {
  const main = repo();
  const gone = path.join(scratchDir('ct-skill-gate-gone-'), 'missing');
  fs.mkdirSync(path.join(main, 'docs'), { recursive: true });
  if (!symlinkOrSkip(t, gone, path.join(main, 'docs', 'journeys'))) return;
  const r = cliLogged(main, ['--skill', 'journeys', '--files', 'tests/a.test.js']);
  assert.match(r.json.reason, /docs\/journeys is a dangling symlink/);
});

test('a regular file named docs means no journeys: the journeys rule still decides', () => {
  const main = repo();
  write(main, 'docs', 'not a directory\n');
  const r = cli(['--skill', 'journeys', '--files', 'tests/a.test.js'], { cwd: main });
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, 'skip', r.stdout);
  assert.equal(r.stderr, '');
});

test('a regular file named docs/journeys is cannot tell', () => {
  const main = repo();
  write(main, 'docs/journeys', 'not a directory\n');
  cliLogged(main, ['--skill', 'journeys', '--files', 'tests/a.test.js']);
});

test('a dangling docs symlink is cannot tell, not "no journeys"', (t) => {
  const main = repo();
  const gone = path.join(scratchDir('ct-skill-gate-gone-'), 'missing');
  if (!symlinkOrSkip(t, gone, path.join(main, 'docs'))) return;
  const r = cliLogged(main, ['--skill', 'journeys', '--files', 'tests/a.test.js']);
  assert.match(r.json.reason, /docs is a dangling symlink/);
});

test('a docs symlink to an outside directory without journeys is cannot tell', (t) => {
  const main = repo();
  const outside = scratchDir('ct-skill-gate-outnoj-');
  if (!symlinkOrSkip(t, outside, path.join(main, 'docs'))) return;
  const r = cliLogged(main, ['--skill', 'journeys', '--files', 'tests/a.test.js']);
  assert.match(r.json.reason, /docs is a symlink that resolves outside the checkout/);
});

test('a docs directory symlinked outside the checkout is never read, cannot tell', (t) => {
  const main = repo();
  const outside = scratchDir('ct-skill-gate-outdocs-');
  write(outside, 'journeys/x.md', '---\nfiles:\n  - plugin/bin/x.js\n---\n');
  if (!symlinkOrSkip(t, outside, path.join(main, 'docs'))) return;
  const r = cliLogged(main, ['--skill', 'journeys', '--files', 'tests/a.test.js']);
  assert.match(r.json.reason, /docs is a symlink that resolves outside the checkout/);
});

test('AC6.5: a dangling journey symlink is cannot tell', (t) => {
  const main = repo();
  if (!symlinkOrSkip(t, path.join(main, 'nowhere.md'), path.join(main, 'docs', 'journeys', 'x.md'))) return;
  const r = cliLogged(main, ['--skill', 'journeys', '--files', 'tests/a.test.js']);
  assert.match(r.json.reason, /dangling symlink/);
});

test('AC6.6: a rule that throws is cannot tell', () => {
  const main = repo();
  const boom = (a) => libGate({ ...a, decideImpl: () => { throw new Error('boom'); } });
  const r = cliLogged(main, ['--skill', 'journeys', '--files', 'tests/a.test.js'], { deps: { gate: boom } });
  assert.match(r.json.reason, /boom/);
});

test('a multi-line throw message still gives exactly one stderr line', () => {
  const main = repo();
  const boom = (a) => libGate({ ...a, decideImpl: () => { throw new Error('line one\nline two'); } });
  cliLogged(main, ['--skill', 'journeys', '--files', 'tests/a.test.js'], { deps: { gate: boom } });
});

test('the unresolvable-base reason names the cause once', () => {
  const main = repo();
  const r = cliLogged(main, ['--skill', 'journeys', '--integration-branch', 'no-such-branch']);
  assert.equal(r.json.reason.split('could not be resolved').length, 2, r.json.reason);
  assert.ok(!r.json.reason.includes('cannot resolve the changed files'), r.json.reason);
});

test('Review Focus 5: surrounding whitespace and empty entries in --files are trimmed away', () => {
  const main = repo();
  const plain = cli(['--skill', 'journeys', '--files', 'tests/a.test.js'], { cwd: main });
  const spaced = cli(['--skill', 'journeys', '--files', ' tests/a.test.js , '], { cwd: main });
  assert.deepEqual(spaced.json, plain.json);
  assert.equal(spaced.json.decision, 'skip');
  const empty = cli(['--skill', 'journeys', '--files', ''], { cwd: main });
  assertCannotTell(empty);
});

test('visual-review skip names the overlapping journeys', () => {
  const main = repo();
  write(main, 'docs/journeys/checkout.md', '---\nfiles:\n  - plugin/bin/x.js\n---\n# Checkout\n');
  const r = cli(['--skill', 'visual-review', '--surface', 'infra', '--files', 'plugin/bin/x.js'], { cwd: main });
  assert.equal(r.json.decision, 'skip');
  assert.deepEqual(r.json.journeys, ['checkout']);
});

test('design-wrapper reads the design-integration flag from CLAUDE.md at the repo root', () => {
  const main = repo();
  write(main, 'CLAUDE.md', '# P\n\n## Design integration\n\ndesign-integration: disabled\n');
  const r = cli(['--skill', 'design-wrapper', '--mode', 'pre-build', '--surface', 'web'], { cwd: main });
  assert.equal(r.json.decision, 'skip');
});

const SKIP_LINE = /^- SKIP \d{2}:\d{2}:\d{2} — Common Step 6 \(skipped\): condition: .+ → fallback: journeys not loaded\. Reversibility: n\/a\.$/m;

test('AC7.1: a skip with --run appends exactly one Degrade-trace line under the section', () => {
  const main = repo();
  const runDir = runDirIn(main);
  const r = cli(['--skill', 'journeys', '--files', 'tests/a.test.js', '--run', runDir, '--section', '/build', '--step', 'Common Step 6'], { cwd: main });
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, 'skip');
  assert.equal(r.json.logged, true);
  const text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(text, SKIP_LINE);
  assert.equal(text.split('\n').filter((l) => l.startsWith('- SKIP')).length, 1);
  assert.ok(text.includes('## /build\n- SKIP'), text);
  assert.ok(text.includes(`condition: ${r.json.reason} →`), text);
});

test('AC7.1: the wrapper skip label carries the mode', () => {
  const main = repo();
  const runDir = runDirIn(main);
  cli(['--skill', 'design-wrapper', '--mode', 'polish', '--files', 'tests/a.test.js', '--surface', 'backend', '--run', runDir, '--section', '/flow', '--step', 'polish'], { cwd: main });
  const text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(text, /fallback: design-wrapper polish not loaded\. Reversibility: n\/a\.$/m);
});

test('AC7.2: a proceed with --run appends nothing and carries no logged key', () => {
  const main = repo();
  const runDir = runDirIn(main);
  const decisions = path.join(runDir, 'decisions.md');
  fs.writeFileSync(decisions, '## /build\n- AUTO 01:02:03 — earlier: x. Reversibility: high.\n');
  const before = fs.readFileSync(decisions);
  const r = cli(['--skill', 'journeys', '--files', 'plugin/bin/x.js', '--run', runDir, '--section', '/build', '--step', 'Common Step 6'], { cwd: main });
  assert.equal(r.json.decision, 'proceed');
  assert.equal('logged' in r.json, false);
  assert.ok(fs.readFileSync(decisions).equals(before));
});

test('AC7.3: a skip without --run prints logged false', () => {
  const main = repo();
  const r = cli(['--skill', 'journeys', '--files', 'tests/a.test.js'], { cwd: main });
  assert.equal(r.json.decision, 'skip');
  assert.equal(r.json.logged, false);
  assert.equal(r.stderr, '', 'a skip with no --run is not a failed write');
});

test('a failed decisions.md append gives logged false and one stderr line', () => {
  const main = repo();
  const runDir = runDirIn(main);
  const r = cli(['--skill', 'journeys', '--files', 'tests/a.test.js', '--run', runDir, '--section', '/build', '--step', 'S'], {
    cwd: main,
    deps: { appendDecision: () => { throw new Error('disk full'); } },
  });
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, 'skip');
  assert.equal(r.json.logged, false);
  assert.equal(r.stderr.split('\n').filter((l) => l !== '').length, 1);
  assert.match(r.stderr, /disk full/);
});

test('AC7.4: --run without --section or --step exits 2', () => {
  const main = repo();
  const runDir = runDirIn(main);
  for (const extra of [
    ['--run', runDir],
    ['--run', runDir, '--section', '/build'],
    ['--section', '/build', '--step', 'S'],
    ['--step', 'S'],
  ]) {
    const r = cli(['--skill', 'journeys', '--files', 'tests/a.test.js', ...extra], { cwd: main });
    assert.equal(r.code, 2, extra.join(' '));
    assert.match(r.stderr, /usage:/);
    assert.equal(r.stdout, '');
  }
});

test('AC7.5: a worktree-local shadow run dir exits 3 and writes nothing', () => {
  const main = repo();
  const wt = linkedWorktreeOf(main);
  const shadow = runDirIn(wt);
  const shadowFile = path.join(shadow, 'decisions.md');
  fs.writeFileSync(shadowFile, '## /build\n');
  const before = fs.readFileSync(shadowFile);
  const r = cli(['--skill', 'journeys', '--files', 'tests/a.test.js', '--run', shadow, '--section', '/build', '--step', 'S'], { cwd: wt });
  assert.equal(r.code, 3);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /not anchored/);
  assert.ok(fs.readFileSync(shadowFile).equals(before));
});

test('AC7.5: a run dir in another checkout than the main one exits 3 and writes nothing', () => {
  const main = repo();
  const other = repo();
  const foreign = runDirIn(other);
  const r = cli(['--skill', 'journeys', '--files', 'tests/a.test.js', '--run', foreign, '--section', '/build', '--step', 'S'], { cwd: main });
  assert.equal(r.code, 3);
  assert.equal(r.stdout, '');
  assert.equal(fs.existsSync(path.join(foreign, 'decisions.md')), false);
});

test('AC7.5: a missing run dir exits 3', () => {
  const main = repo();
  const r = cli(['--skill', 'journeys', '--files', 'tests/a.test.js', '--run', path.join(main, 'nope'), '--section', '/build', '--step', 'S'], { cwd: main });
  assert.equal(r.code, 3);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /does not exist/);
});

test('AC12.1/AC12.2: malformed invocations exit 2 with usage', () => {
  const main = repo();
  const bad = [
    ['--skill', 'nope', '--files', 'a'],
    ['--skill', 'design-wrapper', '--files', 'a'],
    ['--skill', 'design-wrapper', '--mode', 'live', '--files', 'a'],
    ['--skill', 'journeys', '--mode', 'test', '--files', 'a'],
    ['--bogus'],
    ['--skill'],
    ['--skill', '--files', 'a'],
    ['--skill', 'journeys', '--files'],
    ['--skill', 'journeys'],
    ['--skill', 'visual-review', '--mode'],
    ['--skill', 'journeys', '--files', 'a', '--surface', '--section'],
    ['--skill', 'journeys', '--files', 'a', '--integration-branch', 'main'],
    ['--files', 'a'],
  ];
  for (const argv of bad) {
    const r = cli(argv, { cwd: main });
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.stderr, /usage:/, argv.join(' '));
    assert.equal(r.stdout, '', argv.join(' '));
  }
});

test('-h and --help as a flag value are values, not help; a repeated flag exits 2', () => {
  const main = repo();
  const runDir = runDirIn(main);
  const asValue = cli(['--skill', 'journeys', '--files', 'tests/a.test.js', '--run', runDir, '--section', '/build', '--step', '-h'], { cwd: main });
  assert.equal(asValue.code, 0);
  assert.equal(asValue.json.logged, true);
  assert.match(fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'), /— -h \(skipped\):/);
  const asSurface = cli(['--skill', 'journeys', '--files', 'tests/a.test.js', '--surface', '-h'], { cwd: main });
  assert.equal(asSurface.code, 0);
  assert.equal(asSurface.json.decision, 'skip');
  for (const argv of [
    ['--skill', 'journeys', '--skill', 'visual-review', '--files', 'a'],
    ['--skill', 'journeys', '--files', 'a', '--files', 'b'],
  ]) {
    const r = cli(argv, { cwd: main });
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.stderr, /given more than once/);
    assert.match(r.stderr, /usage:/);
  }
});

test('--help in a value flag\'s value position is that flag\'s missing value (exit 2), not help', () => {
  const r = cli(['--skill', 'journeys', '--files', '--help'], { cwd: repo() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--files needs a value/);
});

test('the real repoRoot default resolves the checkout top level', () => {
  const real = require(CLI);
  assert.equal(typeof real.realDeps.repoRoot, 'function');
  const main = repo();
  const sub = path.join(main, 'sub', 'dir');
  fs.mkdirSync(sub, { recursive: true });
  const top = real.realDeps.repoRoot(sub, ENV);
  assert.equal(typeof top, 'string');
  assert.notEqual(top, '');
  assert.equal(top.endsWith('\n'), false);
  const got = canonicalRealpath(top);
  const want = canonicalRealpath(main);
  assert.notEqual(got, null);
  assert.notEqual(want, null);
  assert.equal(got, want);
});

test('AC12: --help exits 0 with the usage on stdout, before anything else', () => {
  const main = repo();
  for (const argv of [['--help'], ['-h'], ['--bogus', '--help']]) {
    const r = cli(argv, { cwd: main });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /usage:/);
    assert.equal(r.stderr, '');
  }
});

test('design-wrapper pre-build needs neither --files nor --integration-branch', () => {
  const main = repo();
  const r = cli(['--skill', 'design-wrapper', '--mode', 'pre-build'], { cwd: main });
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, 'skip');
});

test('a cwd outside any git repo falls back to the cwd and still decides', () => {
  const bare = scratchDir('ct-skill-gate-norepo-');
  const r = cli(['--skill', 'journeys', '--files', 'plugin/bin/x.js'], { cwd: bare });
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, 'proceed');
});

test('script entry smoke: --help exits 0', () => {
  const r = spawnCli(CLI, ['--help'], { env: ENV });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /usage:/);
});
