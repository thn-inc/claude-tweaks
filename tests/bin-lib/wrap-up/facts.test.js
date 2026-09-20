// tests/bin-lib/wrap-up/facts.test.js — exercises gatherFacts against a real
// temp git repo (not a stubbed runner) because the facts it reads — renames,
// deletes, a CLAUDE.md section diff — are exactly the shapes git's own diff
// machinery can produce but a hand-written stub would have to fake correctly
// on the test author's word alone.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { gatherFacts } = require('../../../plugin/bin/lib/wrap-up/facts');

let repoDir;
let baseSha;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

before(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapup-facts-'));
  git(['init', '-q'], repoDir);
  git(['config', 'user.email', 'test@example.com'], repoDir);
  git(['config', 'user.name', 'Test'], repoDir);

  fs.writeFileSync(
    path.join(repoDir, 'CLAUDE.md'),
    [
      '# Test project',
      '',
      '## Commands',
      '',
      'npm run oldcmd',
      'npm test',
      '',
      '## Other',
      '',
      'irrelevant',
      '',
    ].join('\n'),
  );
  fs.mkdirSync(path.join(repoDir, 'docs', 'journeys'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'journeys', 'j1.md'), '# Journey 1\n');
  fs.mkdirSync(path.join(repoDir, 'docs', 'journeys', 'checkout'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'journeys', 'checkout', 'happy-path.md'), '# Nested journey\n');
  fs.writeFileSync(path.join(repoDir, 'docs', 'journeys', 'checkout', 'notes.txt'), 'not markdown\n');
  fs.mkdirSync(path.join(repoDir, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, '.claude', 'skills', 's1.md'), '# Skill 1\n');
  fs.writeFileSync(path.join(repoDir, 'docs', 'guide.md'), '# Guide\n');

  git(['add', '.'], repoDir);
  git(['commit', '-q', '-m', 'base'], repoDir);
  baseSha = git(['rev-parse', 'HEAD'], repoDir);

  git(['mv', 'docs/guide.md', 'docs/guide2.md'], repoDir);
  fs.writeFileSync(
    path.join(repoDir, 'CLAUDE.md'),
    [
      '# Test project',
      '',
      '## Commands',
      '',
      'npm test',
      '',
      '## Other',
      '',
      'irrelevant',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(repoDir, 'src-a.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(repoDir, 'src-b.js'), 'module.exports = 2;\n');
  git(['add', '.'], repoDir);
  git(['commit', '-q', '-m', 'second'], repoDir);
});

after(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

test('gatherFacts reads diff-derived facts from a real repo', () => {
  const f = gatherFacts({ cwd: repoDir, base: baseSha });
  assert.strictEqual(f.isRepo, true);
  assert.strictEqual(f.skillsLibraryExists, true);
  assert.strictEqual(f.docsTreeNonEmpty, true);
  assert.strictEqual(f.journeysExist, true);
  assert.strictEqual(f.multiFileDiff, true); // 2+ files changed
  assert.strictEqual(f.renamedOrDeleted, true); // the rename
  assert.ok(f.renamedDeleted.some((r) => r.oldPath === 'docs/guide.md'));
  assert.strictEqual(f.claudeMdCommandRenamed, true); // removed command line
});

test('gatherFacts degrades outside a repo', () => {
  const f = gatherFacts({ cwd: os.tmpdir(), base: 'HEAD' });
  assert.strictEqual(f.isRepo, false);
  assert.deepStrictEqual(f.changedFiles, []);
});

test('gatherFacts renamedDeleted records rename shape with old and new paths', () => {
  const f = gatherFacts({ cwd: repoDir, base: baseSha });
  const rename = f.renamedDeleted.find((r) => r.oldPath === 'docs/guide.md');
  assert.strictEqual(rename.status, 'R');
  assert.strictEqual(rename.newPath, 'docs/guide2.md');
});

test('gatherFacts journeyFiles lists the journey markdown files', () => {
  const f = gatherFacts({ cwd: repoDir, base: baseSha });
  assert.ok(f.journeyFiles.some((p) => p.endsWith('j1.md')));
});

test('gatherFacts journeyFiles recurses into subdirectories', () => {
  const f = gatherFacts({ cwd: repoDir, base: baseSha });
  assert.ok(f.journeyFiles.includes('docs/journeys/checkout/happy-path.md'));
});

test('gatherFacts journeyFiles excludes non-markdown files in subdirectories', () => {
  const f = gatherFacts({ cwd: repoDir, base: baseSha });
  assert.ok(!f.journeyFiles.some((p) => p.endsWith('notes.txt')));
});

test('gatherFacts headingRenamed is false when no modified md file changed a heading', () => {
  const f = gatherFacts({ cwd: repoDir, base: baseSha });
  // CLAUDE.md was modified (a Commands line went) and docs/guide.md was
  // renamed — neither touches a heading line.
  assert.strictEqual(f.headingRenamed, false);
});

test('gatherFacts headingRenamed separates a modified heading from a deleted file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapup-facts-heading-'));
  try {
    git(['init', '-q'], dir);
    git(['config', 'user.email', 'test@example.com'], dir);
    git(['config', 'user.name', 'Test'], dir);
    fs.writeFileSync(path.join(dir, 'a.md'), '# Alpha\n\nbody\n');
    fs.writeFileSync(path.join(dir, 'b.md'), '## Beta\n\nbody\n');
    git(['add', '.'], dir);
    git(['commit', '-q', '-m', 'base'], dir);
    const sha = git(['rev-parse', 'HEAD'], dir);

    // Deleting b.md removes its `## Beta` line from the diff, but the file is
    // D, not M — a deletion is already `renamedOrDeleted`'s job and must not
    // masquerade as a renamed heading.
    fs.rmSync(path.join(dir, 'b.md'));
    fs.writeFileSync(path.join(dir, 'a.md'), '# Alpha\n\nbody edited\n');
    git(['add', '-A'], dir);
    git(['commit', '-q', '-m', 'delete b, edit a body'], dir);
    assert.strictEqual(gatherFacts({ cwd: dir, base: sha }).headingRenamed, false);

    // Now rename a heading inside the surviving, modified file.
    fs.writeFileSync(path.join(dir, 'a.md'), '# Alpha renamed\n\nbody edited\n');
    git(['add', '-A'], dir);
    git(['commit', '-q', '-m', 'rename a heading'], dir);
    assert.strictEqual(gatherFacts({ cwd: dir, base: sha }).headingRenamed, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gatherFacts headingRenamed degrades to false outside a repo', () => {
  assert.strictEqual(gatherFacts({ cwd: os.tmpdir(), base: 'HEAD' }).headingRenamed, false);
});

test('gatherFacts claudeMdCommandRenamed is false when CLAUDE.md is absent at base', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapup-facts-nobase-'));
  try {
    git(['init', '-q'], dir);
    git(['config', 'user.email', 'test@example.com'], dir);
    git(['config', 'user.name', 'Test'], dir);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    git(['add', '.'], dir);
    git(['commit', '-q', '-m', 'no claude md'], dir);
    const sha = git(['rev-parse', 'HEAD'], dir);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
    git(['add', '.'], dir);
    git(['commit', '-q', '-m', 'second'], dir);
    const f = gatherFacts({ cwd: dir, base: sha });
    assert.strictEqual(f.claudeMdCommandRenamed, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gatherFacts claudeMdOverBudget is true when CLAUDE.md exceeds the always-loaded budget', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapup-facts-budget-'));
  try {
    git(['init', '-q'], dir);
    git(['config', 'user.email', 'test@example.com'], dir);
    git(['config', 'user.name', 'Test'], dir);
    // Default always-loaded-budget is 150 lines (bin/lib/policy-schema.js) —
    // no .claude-tweaks/policy.yml in this temp dir, so the schema default applies.
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `${'line\n'.repeat(151)}`);
    git(['add', '.'], dir);
    git(['commit', '-q', '-m', 'over budget'], dir);
    const sha = git(['rev-parse', 'HEAD'], dir);
    const f = gatherFacts({ cwd: dir, base: sha });
    assert.strictEqual(f.claudeMdOverBudget, true);
    // #1829: claudeMdBudgetTargets is the measured sibling fact — same
    // pass, same target list, never just the boolean.
    const claudeMdTarget = f.claudeMdBudgetTargets.find((t) => t.path.endsWith('CLAUDE.md'));
    assert.ok(claudeMdTarget, 'CLAUDE.md is listed in claudeMdBudgetTargets');
    assert.strictEqual(claudeMdTarget.lines, 151);
    assert.strictEqual(claudeMdTarget.budget, 150);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gatherFacts claudeMdOverBudget honors a policy.yml budget — proves the resolver round-trip, not the catch-all default', () => {
  // resolveBudgets() falls back to the schema defaults (30/150) on ANY
  // resolver failure — the same values an unconfigured repo resolves to — so
  // the default-boundary tests above cannot tell a working key name from a
  // typo'd one that silently fails over. A configured budget far below the
  // default can: 6 lines is under 150 but over 5.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapup-facts-budget-policy-'));
  try {
    git(['init', '-q'], dir);
    git(['config', 'user.email', 'test@example.com'], dir);
    git(['config', 'user.name', 'Test'], dir);
    fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'harness-health-always-loaded-budget: 5\n');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'line\n'.repeat(6));
    git(['add', '.'], dir);
    git(['commit', '-q', '-m', 'over a configured budget'], dir);
    const sha = git(['rev-parse', 'HEAD'], dir);
    const f = gatherFacts({ cwd: dir, base: sha });
    assert.strictEqual(f.claudeMdOverBudget, true, 'a 6-line CLAUDE.md is over a configured 5-line budget only if the renamed key actually resolved');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gatherFacts claudeMdOverBudget is false when CLAUDE.md is within budget and no rules exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapup-facts-budget-ok-'));
  try {
    git(['init', '-q'], dir);
    git(['config', 'user.email', 'test@example.com'], dir);
    git(['config', 'user.name', 'Test'], dir);
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'short\n');
    git(['add', '.'], dir);
    git(['commit', '-q', '-m', 'in budget'], dir);
    const sha = git(['rev-parse', 'HEAD'], dir);
    const f = gatherFacts({ cwd: dir, base: sha });
    assert.strictEqual(f.claudeMdOverBudget, false);
    const claudeMdTarget = f.claudeMdBudgetTargets.find((t) => t.path.endsWith('CLAUDE.md'));
    assert.ok(claudeMdTarget);
    assert.strictEqual(claudeMdTarget.lines, 1);
    assert.strictEqual(claudeMdTarget.budget, 150);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gatherFacts claudeMdOverBudget is true when a scoped rule exceeds the scoped-rule budget', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapup-facts-budget-rule-'));
  try {
    git(['init', '-q'], dir);
    git(['config', 'user.email', 'test@example.com'], dir);
    git(['config', 'user.name', 'Test'], dir);
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'short\n');
    fs.mkdirSync(path.join(dir, '.claude', 'rules'), { recursive: true });
    // Default scoped-rule-budget is 30 lines. A `paths:` key makes this a
    // scoped rule, not an always-loaded one.
    const ruleBody = ['---', 'paths:', '  - src/**', '---', ...Array(31).fill('line')].join('\n');
    fs.writeFileSync(path.join(dir, '.claude', 'rules', 'scoped.md'), `${ruleBody}\n`);
    git(['add', '.'], dir);
    git(['commit', '-q', '-m', 'scoped rule over budget'], dir);
    const sha = git(['rev-parse', 'HEAD'], dir);
    const f = gatherFacts({ cwd: dir, base: sha });
    assert.strictEqual(f.claudeMdOverBudget, true);
    const ruleTarget = f.claudeMdBudgetTargets.find((t) => t.path.endsWith('scoped.md'));
    assert.ok(ruleTarget, 'the scoped rule is listed in claudeMdBudgetTargets');
    assert.strictEqual(ruleTarget.budget, 30, 'a paths:-scoped rule is measured against the scoped-rule budget, not the always-loaded one');
    assert.ok(ruleTarget.lines > ruleTarget.budget);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
