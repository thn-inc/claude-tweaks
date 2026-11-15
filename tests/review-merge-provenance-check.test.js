'use strict';
// #4639 — /claude-tweaks:review's Merge-Provenance Check dropped shipping work from a
// `base:{ref}` release-gate review: its own-work rule (`git log --first-parent --no-merges`)
// treated every PR that shipped through a `--no-ff` merge on the integration line as
// "arrived via merge", so the PR's files fell out of review scope.
//
// Reading live prose is the carve-out here (skill-prose-conformance-tests, [IL-80]): the two
// bash fences in plugin/skills/review/merge-provenance-check.md ARE the shipped procedure.
// The fixtures below extract those fences from the doc and run the extracted lines through
// bash and zsh over real git topologies, so the doc is the only source of the executed commands.
// The exits and the set difference that combine their output are prose, so `excludedBy`
// restates them and `assertProse` pins their wording: a change to a rule's logic that keeps
// the pinned wording is not caught here. The `firstParentDropped` controls in
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
  assert.equal(bodies[0].length, 1, 'extraction pattern is out of sync: fence 1 line count');
  assert.equal(bodies[1].length, 3, 'extraction pattern is out of sync: fence 2 line count');
  return bodies;
}

function run(shell, dir, line) {
  const args = shell === 'zsh' ? ['-f', '-c', line] : ['--noprofile', '--norc', '-c', line];
  // LC_ALL=C keeps git's messages stable for the `fatal:` and `Not a valid object name` checks.
  const r = spawnSync(shell, args, { cwd: dir, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS, env: { ...process.env, LC_ALL: 'C' } });
  // r.error (a timeout, ENOENT or signal kill) leaves stdout and stderr null; carry it into stderr so a failure names its cause
  return { status: r.status, stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? `[spawn error: ${r.error.message}]` : '') };
}

const HAS_ZSH = spawnSync('zsh', ['-f', '-c', 'exit 0']).status === 0;

function fill(line, vars) {
  let out = line;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

const files = (stdout) => [...new Set(stdout.split('\n').map((l) => l.trim()).filter(Boolean))].sort();

// Runs the live fences' lines against a fixture repo and applies the doc's exclusion rule.
// `lineExit` and `branchExit` are ablation switches, not input variants: false disables that
// one exit of the rule, so a fixture can show the exit is what keeps a file in scope.
function excludedBy(shell, dir, base, branch, { lineExit = true, branchExit = true, integration = 'main' } = {}) {
  const [fence1, fence2] = fences(CHECK);
  const vars = { base, branch, 'integration-branch': integration };
  const checkedOut = branch === 'HEAD' ? run(shell, dir, 'git symbolic-ref --short HEAD').stdout.trim() : null;
  // detached at the integration branch's tip is the same branch for the doc's exit
  const atTip = branch === 'HEAD'
    && run(shell, dir, 'git rev-parse HEAD').stdout.trim() === run(shell, dir, `git rev-parse refs/heads/${integration}`).stdout.trim();
  const named = [integration, `refs/heads/${integration}`, `origin/${integration}`];
  if (branchExit && (named.includes(branch) || checkedOut === integration || atTip)) {
    // the doc skips the rest of the check; `full` is computed only so the caller can see what stays in scope
    const onlyFull = run(shell, dir, fill(fence2[2], { ...vars, fork: '' }));
    assert.equal(onlyFull.status, 0, 'fence 2 line 3 (full diff) must exit 0');
    return { full: files(onlyFull.stdout), excluded: [] };
  }
  const forkRun = run(shell, dir, fill(fence1[0], vars));
  const fork = forkRun.stdout.trim();
  if (fork === '') {
    // "no fork point" is merge-base exiting 1, or an unresolvable origin ref (status 128); anything else could not run
    const noFork = forkRun.status === 1
      || (forkRun.status === 128 && forkRun.stderr.includes('Not a valid object name'));
    assert.ok(noFork, `merge-base printed nothing with status ${forkRun.status}: could not run, not "no fork point"`);
    // the raw diff scope stands; a range with no merge base at all has no triple-dot diff, so `full` is empty there
    const raw = run(shell, dir, fill(fence2[2], { ...vars, fork: '' }));
    return { full: raw.status === 0 ? files(raw.stdout) : [], excluded: [] };
  }
  const withFork = { ...vars, fork };
  const lineRun = run(shell, dir, fill(fence2[0], withFork)); // grep -Fx exits 1 when the fork is off this branch's line
  assert.ok(!/fatal:/.test(lineRun.stderr), `fence 2 line 1 (first-parent guard) errored: ${lineRun.stderr}`);
  const branchRun = run(shell, dir, fill(fence2[1], withFork));
  assert.equal(branchRun.status, 0, `fence 2 line 2 (branch-side) must exit 0: ${branchRun.stderr}`);
  const fullRun = run(shell, dir, fill(fence2[2], withFork));
  assert.equal(fullRun.status, 0, `fence 2 line 3 (full diff) must exit 0: ${fullRun.stderr}`);
  const branchSide = files(branchRun.stdout);
  const full = files(fullRun.stdout);
  if (lineExit && lineRun.stdout.trim() !== '') return { full, excluded: [] };
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
  assert.match(flat, /When `\{branch\}` is that branch, `refs\/heads\/\{integration-branch\}`, `origin\/\{integration-branch\}`, or `HEAD` with that branch checked out or detached at its tip, nothing is excluded/, 'check file: branch-is-integration exit');
  assert.match(flat, /When the `git rev-list` line prints `\{fork\}`[^.]*first-parent line[^.]*nothing is excluded/, 'check file: first-parent-line exit');
  assert.match(flat, /An error on that line excludes nothing/, 'check file: guard error exit');
  assert.match(flat, /When `git merge-base` prints nothing[^.]*nothing is excluded/, 'check file: no-fork exit');
  assert.match(flat, /or `origin\/\{integration-branch\}` does not resolve/, 'check file: origin-form no-fork exit');
  assert.match(flat, /arrived via merge from \{integration-branch\}, not this branch's own work/, 'check file: report wording');
  // The retired own-work rule and its report wording stay gone (the new fence legitimately
  // uses `--first-parent` alone, so only the old pairing is banned).
  assert.doesNotMatch(flat, /--first-parent --no-merges/, 'check file: retired own-work rule is back');
  assert.doesNotMatch(flat, /arrived via merge from \{base\}/, 'check file: retired report wording is back');
}

test('AC1.1: the prose states the gate, the rule and both exits', () => {
  assertProse(STEPS, CHECK);
});

test('AC1.1: a clause removed from the prose goes red with its own message', () => {
  const cases = [
    { target: 'steps', from: 'count it as no merge commits detected', to: 'count it as something else', message: /steps gate: no-merges ruling/ },
    { target: 'steps', from: 'Every path in the diff stays in scope', to: 'Some paths drop out of scope', message: /steps gate: every path stays/ },
    { target: 'check', from: 'A `base:{ref}` scope never reads this file', to: 'A `base:{ref}` scope may read this file', message: /check file: base scope exit/ },
    { target: 'check', from: 'and absent from the branch-side list', to: 'and nothing more', message: /check file: exclusion rule/ },
    { target: 'check', from: 'rather than having merged it, so nothing is excluded', to: 'rather than having merged it, so exclusion proceeds', message: /check file: first-parent-line exit/ },
    { target: 'check', from: 'or detached at its tip, nothing is excluded', to: 'or detached at its tip, exclusion proceeds', message: /check file: branch-is-integration exit/ },
    { target: 'check', from: 'or `origin/{integration-branch}` does not resolve', to: 'or `{integration-branch}` does not resolve', message: /check file: origin-form no-fork exit/ },
    { target: 'check', from: 'An error on that line excludes nothing either.', to: 'An error on that line is ignored.', message: /check file: guard error exit/ },
    { target: 'check', from: 'there is no fork point, nothing is excluded, and the raw', to: 'there is no fork point, exclusion proceeds, and the raw', message: /check file: no-fork exit/ },
    { target: 'check', from: "arrived via merge from {integration-branch}, not this branch's own work", to: "arrived via merge from {base}, not this branch's own work", message: /check file: report wording/ },
    // the bans: append the banned text
    { target: 'check', append: ' git log --first-parent --no-merges {base}..{branch}', message: /check file: retired own-work rule is back/ },
    { target: 'check', append: ' (arrived via merge from {base}, not this branch\'s own work)', message: /check file: retired report wording is back/ },
  ];
  for (const c of cases) {
    const original = c.target === 'steps' ? STEPS : flatten(CHECK);
    const mutated = c.append ? original + c.append : original.replace(c.from, c.to);
    assert.notEqual(mutated, original, `mutation did not apply: ${c.from || c.append}`);
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
    // the same rule with no line exit would exclude all of it: the exit is load-bearing
    assert.deepEqual(excludedBy(shell, dir, 'v1', 'origin/main', { branchExit: false }).excluded, []); // line exit alone
    assert.deepEqual(excludedBy(shell, dir, 'v1', 'origin/main', { branchExit: false, lineExit: false }).excluded,
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
    assert.deepEqual(excludedBy(shell, dir, 'HEAD~2', 'main', { branchExit: false }).excluded, []); // line exit alone
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

test('AC1.1: fixture H, HEAD~N with local ahead of origin, excludes nothing', async (t) => {
  const { dir, g, commitFile, origin } = fixture();
  commitFile('older');
  g('checkout', '-q', '-b', 'pr');
  commitFile('pr-file');
  g('checkout', '-q', 'main');
  g('merge', '-q', '--no-ff', 'pr', '-m', 'merge pr');
  origin();
  commitFile('newer');
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, 'HEAD~2', 'main'), { full: ['newer', 'pr-file'], excluded: [] });
    // the same rule with no line exit drops pr-file: the review's reproduction, frozen
    assert.deepEqual(excludedBy(shell, dir, 'HEAD~2', 'main', { branchExit: false }).excluded, []); // line exit alone
    assert.deepEqual(excludedBy(shell, dir, 'HEAD~2', 'main', { branchExit: false, lineExit: false }).excluded, ['pr-file']);
  });
});

test('AC1.1: fixture I, a branch that is its own integration branch, excludes nothing', async (t) => {
  const { dir, g, commitFile } = fixture();
  const start = g('rev-parse', 'HEAD').trim();
  g('checkout', '-q', '-b', 'feat');
  commitFile('own-pushed');
  g('update-ref', 'refs/remotes/origin/feat', 'feat');
  commitFile('own-local');
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, start, 'feat', { integration: 'feat' }),
      { full: ['own-local', 'own-pushed'], excluded: [] });
  });
});

test('AC1.1: fixture J, a branch that pull-merged its own remote, excludes nothing', async (t) => {
  const { dir, g, commitFile } = fixture();
  const start = g('rev-parse', 'HEAD').trim();
  g('checkout', '-q', '-b', 'feat');
  commitFile('own-early');
  g('checkout', '-q', '-b', 'tmp');
  commitFile('own-other-machine');
  g('update-ref', 'refs/remotes/origin/feat', 'tmp');
  g('checkout', '-q', 'feat');
  commitFile('own-local');
  g('merge', '-q', 'origin/feat', '--no-edit');
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, start, 'feat', { integration: 'feat' }),
      { full: ['own-early', 'own-local', 'own-other-machine'], excluded: [] });
    // without the branch exit the fork is the merge's second parent: the review's reproduction, frozen
    assert.deepEqual(excludedBy(shell, dir, start, 'feat', { integration: 'feat', branchExit: false }).excluded,
      ['own-early', 'own-other-machine']);
  });
});

test('AC1.1: fixture K, a rename after catch-up, excludes nothing', async (t) => {
  const { dir, g, commitFile, origin } = fixture();
  const lines = (n) => Array.from({ length: 12 }, (_, i) => (i === 5 ? n : `line ${i} of the old file`)).join('\n') + '\n';
  commitFile('old', lines('original'));
  const start = g('rev-parse', 'HEAD').trim();
  g('checkout', '-q', '-b', 'feat');
  commitFile('feat-file');
  g('checkout', '-q', 'main');
  commitFile('old', lines('rewritten on main'));
  origin();
  g('checkout', '-q', 'feat');
  g('merge', '-q', 'origin/main', '--no-edit');
  g('mv', 'old', 'new');
  g('commit', '-q', '-m', 'rename old to new');
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, start, 'feat'),
      { full: ['feat-file', 'new', 'old'], excluded: [] });
  });
});

test('AC1.1: fixture L, a fast-forward onto the integration line then own work, excludes nothing', async (t) => {
  const { dir, g, commitFile, origin } = fixture();
  const start = g('rev-parse', 'HEAD').trim();
  commitFile('main-file');
  origin();
  g('checkout', '-q', '-b', 'feat');
  commitFile('feat-file');
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, start, 'feat'), { full: ['feat-file', 'main-file'], excluded: [] });
    // the line exit alone does this; with it off the fork's file is excluded
    assert.deepEqual(excludedBy(shell, dir, start, 'feat', { lineExit: false }).excluded, ['main-file']);
  });
});

test('AC1.1: fixture M, no origin ref at all, excludes nothing', async (t) => {
  const { dir, g, commitFile } = fixture();
  const start = g('rev-parse', 'HEAD').trim();
  g('checkout', '-q', '-b', 'feat');
  commitFile('feat-file');
  g('checkout', '-q', 'main');
  commitFile('main-file');
  g('checkout', '-q', 'feat');
  g('merge', '-q', 'main', '--no-edit'); // a local-ref fallback would find main here and exclude main-file
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, start, 'feat'), { full: ['feat-file', 'main-file'], excluded: [] });
  });
});

test('AC1.1: fixture N, HEAD on a pull-merged integration branch, excludes nothing', async (t) => {
  const { dir, g, commitFile } = fixture();
  const start = g('rev-parse', 'HEAD').trim();
  commitFile('teammate-base');
  g('checkout', '-q', '-b', 'tmp');
  commitFile('teammate-file');
  g('update-ref', 'refs/remotes/origin/main', 'tmp');
  g('checkout', '-q', 'main');
  commitFile('own-local');
  g('merge', '-q', 'origin/main', '--no-edit');
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, start, 'HEAD'),
      { full: ['own-local', 'teammate-base', 'teammate-file'], excluded: [] });
    // without the branch exit the fork is the merge's second parent: the review's reproduction, frozen
    assert.deepEqual(excludedBy(shell, dir, start, 'HEAD', { branchExit: false }).excluded,
      ['teammate-base', 'teammate-file']);
  });
});

// A pull-merged integration branch under the other spellings the doc's exit names.
function pullMergedMain() {
  const { dir, g, commitFile } = fixture();
  const start = g('rev-parse', 'HEAD').trim();
  commitFile('teammate-base');
  g('checkout', '-q', '-b', 'tmp');
  commitFile('teammate-file');
  g('update-ref', 'refs/remotes/origin/main', 'tmp');
  g('checkout', '-q', 'main');
  commitFile('own-local');
  g('merge', '-q', 'origin/main', '--no-edit');
  return { dir, g, start };
}

test('AC1.1: fixture O, HEAD detached at the tip of a pull-merged integration branch, excludes nothing', async (t) => {
  const { dir, g, start } = pullMergedMain();
  g('checkout', '-q', '--detach');
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, start, 'HEAD').excluded, []);
    assert.deepEqual(excludedBy(shell, dir, start, 'HEAD', { branchExit: false }).excluded,
      ['teammate-base', 'teammate-file']);
  });
});

test('AC1.1: fixture P, refs/heads/main on a pull-merged integration branch, excludes nothing', async (t) => {
  const { dir, start } = pullMergedMain();
  await forShells(t, (shell) => {
    assert.deepEqual(excludedBy(shell, dir, start, 'refs/heads/main').excluded, []);
    assert.deepEqual(excludedBy(shell, dir, start, 'refs/heads/main', { branchExit: false }).excluded,
      ['teammate-base', 'teammate-file']);
  });
});

test('AC1.1: fixture Q, HEAD on a feature branch that merged the integration line, still excludes what arrived from it', async (t) => {
  const { dir, g, commitFile, origin } = fixture();
  const start = g('rev-parse', 'HEAD').trim();
  g('checkout', '-q', '-b', 'feat');
  commitFile('feat-file');
  g('checkout', '-q', 'main');
  commitFile('main-file');
  origin();
  g('checkout', '-q', 'feat');
  g('merge', '-q', 'origin/main', '--no-edit');
  await forShells(t, (shell) => {
    // a helper that treated any checked-out HEAD as the integration branch would return [] here
    assert.deepEqual(excludedBy(shell, dir, start, 'HEAD'),
      { full: ['feat-file', 'main-file'], excluded: ['main-file'] });
  });
});
