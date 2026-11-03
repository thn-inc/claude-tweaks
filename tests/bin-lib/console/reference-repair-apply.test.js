'use strict';
// #4636: what the resolver checked is what lands. Real git throughout: the composition recipe
// (wrap-up/reference-sweep.md Step 4), `git apply --check` / `git apply` from the staged diff, and
// the three proved bypasses plus a traditional patch, each shown to change a test file under git
// apply before the parser is asked about it. The prose half pins the Phase 4 bullet and every
// console path that reaches it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const { stagedDiffPaths, referenceRepairFloorReason, REFERENCE_REPAIR_REASONS } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'reference-repair'));
const { gitEnv } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'staged-patch', 'stack-check'));
const { readText } = require('../../helpers/read-skill');

const EXECUTION = readText(path.join(ROOT, 'plugin', 'skills', 'wrap-up', 'execution-and-verification.md'));
const MULTISPEC = readText(path.join(ROOT, 'plugin', 'skills', 'flow', 'multispec-review-console.md'));
const INTERACTIVE = readText(path.join(ROOT, 'plugin', 'skills', 'wrap-up', 'review-console-interactive.md'));

const sh = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv(), windowsHide: true, timeout: 30000 });
const git = (repo, ...args) => {
  const r = sh(repo, args);
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const tmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

function repoWith(rel, text) {
  const repo = tmp('ref-repair-apply-');
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@example.invalid');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'config', 'core.autocrlf', 'false');
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'init');
  return repo;
}

// reference-sweep.md Step 4's recipe: a fresh directory outside the repo, `a/{rel}` copied from the
// repo, `b/{rel}` a mode-preserving copy of it with the repaired text written in, then
// `git diff --no-index` from there. Exit 1 (the files differ) is the success.
function compose(repo, rel, next) {
  const dir = tmp('ref-repair-compose-');
  const source = path.join(repo, rel);
  const mode = fs.statSync(source).mode & 0o777;
  for (const side of ['a', 'b']) {
    const copy = path.join(dir, side, rel);
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(source, copy);
    fs.chmodSync(copy, mode);
  }
  fs.writeFileSync(path.join(dir, 'b', rel), next);
  const r = sh(dir, ['diff', '--no-index', '--no-color', '--no-ext-diff', '--no-prefix', '--', `a/${rel}`, `b/${rel}`]);
  assert.strictEqual(r.status, 1, r.stderr);
  return r.stdout;
}

const apply = (repo, ...args) => sh(repo, ['-C', repo, 'apply', ...args]).status;

function stagedFile(text) {
  const file = path.join(tmp('ref-repair-staged-'), 'wrap-up-reference-1.md');
  fs.writeFileSync(file, text);
  return file;
}

test('#4636: the composition recipe names the real path and leaves the repo untouched', () => {
  for (const rel of ['docs/a.md', 'docs/sub dir/my guide.md']) {
    const repo = repoWith(rel, 'one\nold\nthree\n');
    const diff = compose(repo, rel, 'one\nnew\nthree\n');
    assert.deepStrictEqual(stagedDiffPaths(`Hold: no\n\n${diff}`), [rel]);
    assert.strictEqual(git(repo, 'status', '--porcelain'), '');
  }
});

test('#4636: what the resolver checked is what git apply lands', () => {
  const rel = 'docs/a.md';
  const repo = repoWith(rel, 'one\nold\nthree\n');
  const staged = stagedFile(`Hold: no\nTarget: ${rel}\n\n${compose(repo, rel, 'one\nnew\nthree\n')}`);
  assert.strictEqual(apply(repo, '--check', staged), 0);
  assert.strictEqual(apply(repo, staged), 0);
  assert.strictEqual(fs.readFileSync(path.join(repo, rel), 'utf8'), 'one\nnew\nthree\n');
  assert.deepStrictEqual(git(repo, 'status', '--porcelain').trimEnd().split('\n'), [` M ${rel}`]);
});

test('#4636: a diff that no longer applies is refused and changes nothing', () => {
  const rel = 'docs/a.md';
  const repo = repoWith(rel, 'one\nold\nthree\n');
  const staged = stagedFile(`Hold: no\n\n${compose(repo, rel, 'one\nnew\nthree\n')}`);
  fs.writeFileSync(path.join(repo, rel), 'one\nmoved on\nthree\n');
  assert.notStrictEqual(apply(repo, '--check', staged), 0);
  assert.strictEqual(fs.readFileSync(path.join(repo, rel), 'utf8'), 'one\nmoved on\nthree\n');
});

test('#4636: each proved bypass really changes the test file under git apply, and the parser refuses it', () => {
  const hunk = '@@ -1,3 +1,3 @@\n one\n-old\n+new\n three\n';
  const patches = {
    '---/+++ naming the test file': `diff --git a/docs/a.md b/docs/a.md\n--- a/tests/x.test.js\n+++ b/tests/x.test.js\n${hunk}`,
    'second section with no diff --git line': `diff --git a/docs/a.md b/docs/a.md\n--- a/docs/a.md\n+++ b/docs/a.md\n${hunk}--- a/tests/x.test.js\n+++ b/tests/x.test.js\n${hunk}`,
    'rename from the test file': 'diff --git a/docs/a.md b/docs/a.md\nsimilarity index 100%\nrename from tests/x.test.js\nrename to docs/b.md\n',
    'traditional patch before any section': `--- a/tests/x.test.js\n+++ b/tests/x.test.js\n${hunk}`,
  };
  for (const [label, body] of Object.entries(patches)) {
    const repo = repoWith('docs/a.md', 'one\nold\nthree\n');
    fs.mkdirSync(path.join(repo, 'tests'));
    fs.writeFileSync(path.join(repo, 'tests/x.test.js'), 'one\nold\nthree\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'test file');
    const staged = stagedFile(`Hold: no\n\n${body}`);
    assert.strictEqual(apply(repo, staged), 0, label);
    assert.ok(git(repo, 'status', '--porcelain').includes('tests/x.test.js'), `${label}: git apply touched the test file`);
    assert.strictEqual(stagedDiffPaths(fs.readFileSync(staged, 'utf8')), null, label);
  }
});

test('#4636: the recipe composes under the parser for a clean file, and a test file is held', () => {
  const clean = repoWith('docs/a.md', 'one\nold\nthree\n');
  const cleanText = `Hold: no\nTarget: docs/a.md\n\n${compose(clean, 'docs/a.md', 'one\nnew\nthree\n')}`;
  assert.strictEqual(referenceRepairFloorReason(cleanText, []), null);
  const held = repoWith('tests/a.test.js', 'one\nold\nthree\n');
  const heldText = `Hold: no\nTarget: tests/a.test.js\n\n${compose(held, 'tests/a.test.js', 'one\nnew\nthree\n')}`;
  assert.strictEqual(referenceRepairFloorReason(heldText, []), REFERENCE_REPAIR_REASONS.HELD);
});

test('#4636: the Reference repairs bullet applies from the staged diff and routes a stale one to pending', () => {
  const bullet = EXECUTION.split('\n').find((l) => l.startsWith('- **Reference repairs**'));
  assert.ok(bullet);
  assert.ok(bullet.includes('apply --check'), 'checks first');
  assert.ok(bullet.includes('--set-item'), 'names the rewrite');
  assert.ok(bullet.includes('--resolution pending'), 'names the target');
  assert.ok(bullet.includes(REFERENCE_REPAIR_REASONS.STALE), 'names the reason');
  assert.ok(bullet.includes('git -C'), 'runs from the worktree root');
  assert.ok(bullet.includes('git -C "{worktree root}" apply --check "{staged path}"') && bullet.includes('git -C "{worktree root}" apply "{staged path}"'), 'both the check and the apply run in the -C form');
  assert.ok(bullet.includes('{item-run-dir}'), 'names the row\'s own directory');
  assert.ok(!bullet.includes('$PIPELINE_RUN_DIR'), 'not the per-spec variable');
  assert.ok(bullet.includes('--check-repair'), 're-runs the floor on a human-named target');
  assert.ok(bullet.includes('Apply anyway') && bullet.includes('AskUserQuestion'), 'a floor hit on a human-named target is shown and the human may confirm it');
  assert.ok(!/PENDING/.test(bullet), 'the open question is answered, not left pending');
  assert.ok(bullet.includes('auto-resolve'), 're-runs the floor on an auto-resolved row before apply');
  assert.ok(bullet.includes('--check-repair "{staged path}" --full'), 're-runs the whole hold rule, not the floor alone, on an auto-resolved row');
  assert.ok(bullet.includes('any other exit'), 'an exit other than 0 and 5 applies nothing');
  assert.ok(/exit 3/.test(bullet) && /exit 5/.test(bullet), 'routes both refusals');
});

const between = (text, start, end) => { const i = text.indexOf(start); assert.ok(i >= 0, start); const j = text.indexOf(end, i + start.length); return text.slice(i, j < 0 ? undefined : j); };

test('#4636: every console path reaches the one Phase 4 bullet', () => {
  const approval = between(MULTISPEC, '## On approval', '## On override');
  const stepOne = approval.split('\n').find((l) => l.startsWith('1. '));
  assert.ok(stepOne.includes('wrap-up-reference-'), 'multi-spec step 1 does not apply a reference repair');
  const stepSix = approval.split('\n').find((l) => l.startsWith('6. '));
  assert.ok(stepSix.includes('Reference repairs') && stepSix.includes('execution-and-verification.md'), 'multi-spec step 6 cites the bullet');
  const multiOverride = between(MULTISPEC, '## On override', '\n3. ');
  assert.ok(multiOverride.includes('Reference repairs'), 'multi-spec override routes the row');
  const interactiveOverride = between(INTERACTIVE, '## On override', '\n3. ');
  assert.ok(interactiveOverride.includes('Reference repairs') && interactiveOverride.includes('execution-and-verification.md'), 'single-spec override routes the row');
});

test('#4636: a no-diff repair names its target at the console stop, and modify is refused', () => {
  const para = INTERACTIVE.split('\n').find((l) => l.startsWith('**Reference repairs rows'));
  assert.ok(para);
  assert.ok(para.includes('target {#}'), 'the Override verb');
  assert.ok(para.includes('modify {#}'), 'refuses modify');
  const drills = INTERACTIVE.split('\n').find((l) => l.startsWith('- **The "drills individually" class**'));
  assert.ok(drills.includes('Reference repairs'), 'the row kind joins the class');
  assert.ok(/no-diff/.test(drills));
});
