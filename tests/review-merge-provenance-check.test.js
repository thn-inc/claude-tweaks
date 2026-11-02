'use strict';
// #4639 — /claude-tweaks:review's Merge-Provenance Check dropped shipping work from a
// `base:{ref}` release-gate review: its own-work rule (`git log --first-parent --no-merges`)
// treated every PR that shipped through a `--no-ff` merge on the integration line as
// "arrived via merge", so the PR's files fell out of review scope.
//
// Reading live prose is the carve-out here (skill-prose-conformance-tests, [IL-80]): the two
// bash fences in plugin/skills/review/merge-provenance-check.md ARE the shipped procedure.
// The fixtures below extract those fences from the doc and run the extracted lines through
// bash and zsh over real git topologies, so the doc is the only source of the executed text
// and the rule cannot drift from what the test proves. The `firstParentDropped` controls in
// fixtures A, D and E freeze the pre-change rule as a characterization of the defect.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readText } = require('./helpers/read-skill');
const { gitRepo, fixtureGit, FIXTURE_TIMEOUT_MS } = require('./helpers/git-fixtures');

const ROOT = path.join(__dirname, '..');
const CHECK_PATH = path.join(ROOT, 'plugin', 'skills', 'review', 'merge-provenance-check.md');
const STEPS_PATH = path.join(ROOT, 'plugin', 'skills', 'review', 'code-mode-steps.md');
const CHECK = readText(CHECK_PATH);
const STEPS = readText(STEPS_PATH);

// --- extraction ------------------------------------------------------------------------

function fences(text) {
  const bodies = [...text.matchAll(/```bash\r?\n([\s\S]*?)```/g)]
    .map((m) => m[1].split(/\r?\n/).filter((l) => l.trim() !== ''));
  assert.equal(bodies.length, 2, 'extraction pattern is out of sync');
  assert.equal(bodies[0].length, 2, 'extraction pattern is out of sync: fence 1 line count');
  assert.equal(bodies[1].length, 2, 'extraction pattern is out of sync: fence 2 line count');
  return bodies;
}

function run(shell, dir, line) {
  const args = shell === 'zsh' ? ['-f', '-c', line] : ['--noprofile', '--norc', '-c', line];
  const r = spawnSync(shell, args, { cwd: dir, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS });
  return { status: r.status, stdout: r.stdout };
}

const HAS_ZSH = spawnSync('zsh', ['-f', '-c', 'exit 0']).status === 0;

function fill(line, vars) {
  let out = line;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

const files = (stdout) => [...new Set(stdout.split('\n').map((l) => l.trim()).filter(Boolean))].sort();

// Runs the live fences' lines against a fixture repo and applies the doc's exclusion rule.
function excludedBy(shell, dir, base, branch, { tipExit = true } = {}) {
  const [fence1, fence2] = fences(CHECK);
  const vars = { base, branch, 'integration-branch': 'main' };
  const forkRun = run(shell, dir, fill(fence1[0], vars)); // exits non-zero when there is no fork point
  const fork = forkRun.stdout.trim();
  if (fork === '') return { full: [], excluded: [] };
  const tipRun = run(shell, dir, fill(fence1[1], vars));
  assert.equal(tipRun.status, 0, 'fence 1 line 2 (tip) must exit 0');
  const tip = tipRun.stdout.trim();
  const withFork = { ...vars, fork, tip };
  const branchRun = run(shell, dir, fill(fence2[0], withFork));
  assert.equal(branchRun.status, 0, 'fence 2 line 1 (branch-side) must exit 0');
  const fullRun = run(shell, dir, fill(fence2[1], withFork));
  assert.equal(fullRun.status, 0, 'fence 2 line 2 (full diff) must exit 0');
  const branchSide = files(branchRun.stdout);
  const full = files(fullRun.stdout);
  if (tipExit && fork === tip) return { full, excluded: [] };
  return { full, excluded: full.filter((f) => !branchSide.includes(f)) };
}

// The frozen pre-change rule (the two commands the doc carried before #4639).
const OLD_OWN_WORK = 'git log --first-parent --no-merges {base}..{branch} --name-only --pretty=format:';
const OLD_FULL_DIFF = 'git diff {base}...{branch} --name-only';

function firstParentDropped(dir, base, branch) {
  const vars = { base, branch };
  const own = files(run('bash', dir, fill(OLD_OWN_WORK, vars)).stdout);
  const full = files(run('bash', dir, fill(OLD_FULL_DIFF, vars)).stdout);
  return full.filter((f) => !own.includes(f));
}

// --- fixtures --------------------------------------------------------------------------

const DIRS = [];
test.after(() => {
  for (const d of DIRS) fs.rmSync(d, { recursive: true, force: true });
});

function fixture() {
  const dir = gitRepo({ branch: 'main' });
  DIRS.push(dir);
  const g = (...args) => fixtureGit(['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('config', 'user.name', 'Fixture');
  g('config', 'user.email', 'fixture@example.test');
  const commitFile = (name, content = name) => {
    fs.writeFileSync(path.join(dir, name), content);
    g('add', name);
    g('commit', '-q', '-m', name);
  };
  const origin = () => g('update-ref', 'refs/remotes/origin/main', 'main');
  return { dir, g, commitFile, origin };
}

async function forShells(t, body) {
  await t.test('bash', () => body('bash'));
  await t.test('zsh', { skip: HAS_ZSH ? false : 'zsh not on PATH' }, () => body('zsh'));
}

// --- prose pins ------------------------------------------------------------------------

const flatten = (s) => s.replace(/\s+/g, ' ');

function assertProse(stepsText, checkText) {
  const start = stepsText.indexOf('### Merge-Provenance Check');
  const end = stepsText.indexOf('### Cherry-Pick Provenance Check');
  assert.notEqual(start, -1, 'steps anchor: ### Merge-Provenance Check');
  assert.notEqual(end, -1, 'steps anchor: ### Cherry-Pick Provenance Check');
  assert.ok(end > start, 'steps anchors out of order');
  const slice = stepsText.slice(start, end);
  assert.match(slice, /\*\*A `base:\{ref\}` scope\*\*[^\n]*count it as no merge commits detected/, 'steps gate: no-merges ruling');
  assert.match(slice, /\*\*A `base:\{ref\}` scope\*\*[^\n]*Every path in the diff stays in scope/, 'steps gate: every path stays');
  const flat = flatten(checkText);
  assert.match(flat, /A `base:\{ref\}` scope never reads this file/, 'check file: base scope exit');
  assert.match(flat, /\*\*Excluded files\*\* are those in the full diff and absent from the branch-side list/, 'check file: exclusion rule');
  assert.match(flat, /When `\{fork\}` equals `\{tip\}`[^.]*nothing is excluded/, 'check file: fork-is-tip exit');
  assert.match(flat, /When `git merge-base` prints nothing[^.]*nothing is excluded/, 'check file: no-fork exit');
  assert.match(flat, /arrived via merge from \{integration-branch\}, not this branch's own work/, 'check file: report wording');
}

test('AC1.1: the prose states the gate, the rule and both exits', () => {
  assertProse(STEPS, CHECK);
  const flat = flatten(CHECK);
  assert.ok(!flat.includes('--first-parent'));
  assert.ok(!flat.includes('arrived via merge from {base}'));
});

test('AC1.1: a clause removed from the prose goes red with its own message', () => {
  const cases = [
    { target: 'steps', from: 'count it as no merge commits detected', to: 'count it as something else', message: /steps gate: no-merges ruling/ },
    { target: 'steps', from: 'Every path in the diff stays in scope', to: 'Some paths drop out of scope', message: /steps gate: every path stays/ },
    { target: 'check', from: 'A `base:{ref}` scope never reads this file', to: 'A `base:{ref}` scope may read this file', message: /check file: base scope exit/ },
    { target: 'check', from: 'and absent from the branch-side list', to: 'and nothing more', message: /check file: exclusion rule/ },
    { target: 'check', from: 'this branch has no side of its own, so nothing is excluded', to: 'this branch has no side of its own, so exclusion proceeds', message: /check file: fork-is-tip exit/ },
    { target: 'check', from: 'there is no fork point, nothing is excluded, and the raw', to: 'there is no fork point, exclusion proceeds, and the raw', message: /check file: no-fork exit/ },
    { target: 'check', from: "arrived via merge from {integration-branch}, not this branch's own work", to: "arrived via merge from {base}, not this branch's own work", message: /check file: report wording/ },
  ];
  for (const c of cases) {
    const original = c.target === 'steps' ? STEPS : flatten(CHECK);
    const mutated = original.replace(c.from, c.to);
    assert.notEqual(mutated, original, `mutation did not apply: ${c.from}`);
    const args = c.target === 'steps' ? [mutated, CHECK] : [STEPS, mutated];
    assert.throws(() => assertProse(...args), { message: c.message });
  }
});

// --- behavior over real git topologies -------------------------------------------------

test('AC1.1: fixture A, a base:{ref} range, keeps every path', async (t) => {
  const { dir, g, commitFile, origin } = fixture();
  g('tag', 'v1');
  g('checkout', '-q', '-b', 'pr');
  commitFile('pr-file');
  g('checkout', '-q', 'main');
  g('merge', '-q', '--no-ff', 'pr', '-m', 'merge pr');
  commitFile('squash-file');
  origin();
  assert.deepEqual(firstParentDropped(dir, 'v1', 'origin/main'), ['pr-file']); // the defect, frozen
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, 'v1', 'origin/main'),
      { full: ['pr-file', 'squash-file'], excluded: [] });
    // the same rule with no tip exit would exclude all of it: the exit is load-bearing
    assert.deepEqual(excludedBy(shell, dir, 'v1', 'origin/main', { tipExit: false }).excluded,
      ['pr-file', 'squash-file']);
  });
});

test('AC1.1: fixture G, HEAD~N on the integration branch, excludes nothing', async (t) => {
  const { dir, g, commitFile, origin } = fixture();
  commitFile('older');
  g('checkout', '-q', '-b', 'pr');
  commitFile('pr-file');
  g('checkout', '-q', 'main');
  g('merge', '-q', '--no-ff', 'pr', '-m', 'merge pr');
  commitFile('newer');
  origin();
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, 'HEAD~2', 'main'), { full: ['newer', 'pr-file'], excluded: [] });
  });
});

test('AC1.1: fixture B, fixed-base catch-up, excludes only what arrived from the integration line', async (t) => {
  const { dir, g, commitFile, origin } = fixture();
  const start = g('rev-parse', 'HEAD').trim();
  g('checkout', '-q', '-b', 'feat');
  commitFile('feat-file');
  commitFile('shared', 'feat');
  g('checkout', '-q', 'main');
  commitFile('main-file');
  commitFile('shared', 'main');
  origin();
  g('checkout', '-q', 'feat');
  try {
    g('merge', 'origin/main', '--no-edit');
    assert.fail('expected a merge conflict on shared');
  } catch (err) {
    if (err.name === 'AssertionError') throw err;
    assert.equal(err.status, 1, 'git merge exits 1 on the expected conflict');
  }
  fs.writeFileSync(path.join(dir, 'shared'), 'resolved');
  g('add', 'shared');
  g('commit', '-q', '-m', 'resolve shared');
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, start, 'feat'),
      { full: ['feat-file', 'main-file', 'shared'], excluded: ['main-file'] });
  });
});

test('AC1.1: fixture C, fresh base, excludes nothing', async (t) => {
  const { dir, g, commitFile, origin } = fixture();
  g('checkout', '-q', '-b', 'feat');
  commitFile('feat-file');
  g('checkout', '-q', 'main');
  commitFile('main-file');
  origin();
  g('checkout', '-q', 'feat');
  g('merge', '-q', 'origin/main', '--no-edit');
  g('checkout', '-q', 'main');
  commitFile('main-later');
  origin();
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, 'origin/main', 'feat'), { full: ['feat-file'], excluded: [] });
  });
});

test('AC1.1: fixture D, another unlanded branch merged in, stays in scope', async (t) => {
  const { dir, g, commitFile, origin } = fixture();
  origin();
  g('checkout', '-q', '-b', 'other');
  commitFile('other-file');
  g('checkout', '-q', 'main');
  g('checkout', '-q', '-b', 'feat');
  commitFile('feat-file');
  g('merge', '-q', '--no-ff', 'other', '-m', 'merge other');
  assert.deepEqual(firstParentDropped(dir, 'origin/main', 'feat'), ['other-file']); // the defect, frozen
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, 'origin/main', 'feat'),
      { full: ['feat-file', 'other-file'], excluded: [] });
  });
});

test('AC1.1: fixture E, a merge commit own edits, stays in scope', async (t) => {
  const { dir, g, commitFile, origin } = fixture();
  const start = g('rev-parse', 'HEAD').trim();
  g('checkout', '-q', '-b', 'feat');
  commitFile('feat-file');
  g('checkout', '-q', 'main');
  commitFile('main-file');
  commitFile('main-kept');
  origin();
  g('checkout', '-q', 'feat');
  g('merge', '-q', '--no-commit', '--no-ff', 'origin/main');
  fs.writeFileSync(path.join(dir, 'evil-file'), 'evil');
  g('add', 'evil-file');
  fs.writeFileSync(path.join(dir, 'main-file'), 'rewritten in the merge');
  g('add', 'main-file');
  g('commit', '-q', '-m', 'merge with own edits');
  assert.deepEqual(firstParentDropped(dir, start, 'feat'), ['evil-file', 'main-file', 'main-kept']); // frozen
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, start, 'feat'),
      { full: ['evil-file', 'feat-file', 'main-file', 'main-kept'], excluded: ['main-kept'] });
  });
});

test('AC1.1: fixture F, no common ancestor, excludes nothing', async (t) => {
  const { dir, g, commitFile, origin } = fixture();
  origin();
  g('checkout', '-q', '--orphan', 'lone');
  commitFile('lone-file');
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, 'origin/main', 'lone').excluded, []);
  });
});
