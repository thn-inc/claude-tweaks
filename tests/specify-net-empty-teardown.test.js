'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #613: /specify's decomposition Step 9 detects when its own design-doc
// deletion (Step 7) leaves the branch net-empty vs. its own fork point, and
// emits a paste-ready teardown line in the run's summary — the other half of
// #613's fix, pairing with tidy's net-empty worktree/branch scan so a run
// that never reaches /tidy still surfaces a copy-pasteable cleanup command.
// Prose-as-implementation: conformance grep over the literal skill text.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const CLOSEOUT = read('plugin', 'skills', 'specify', 'decomposition-mode-closeout.md');

test('Step 9 template carries an optional Teardown section, rendered only on the net-empty finding', () => {
  const tpl = CLOSEOUT.slice(CLOSEOUT.indexOf('```markdown'), CLOSEOUT.indexOf('### Diagram suggestions'));
  assert.match(tpl, /### Teardown \(optional — render only when the check below finds the branch net-empty\)/);
  assert.match(tpl, /one paste-ready line, see below/);
});

test('Step 9 prose specifies the net-empty check command against the branch\'s own fork point, not {base}\'s current tip', () => {
  assert.match(CLOSEOUT, /\*\*Net-empty teardown line \(#613\)\.\*\*/);
  assert.match(CLOSEOUT, /git diff --quiet "\$\(git merge-base \{base\} HEAD\)" HEAD/);
  assert.match(CLOSEOUT, /_shared\/integration-branch\.md/);
});

test('Step 9 prose names both paste-ready teardown variants and never auto-runs either', () => {
  assert.match(CLOSEOUT, /`git branch -D \{branch\}` when this run ran directly on the checkout/);
  assert.match(CLOSEOUT, /`git worktree remove \{worktree-path\} && git branch -D \{branch\}` when it ran inside a linked worktree/);
  assert.match(CLOSEOUT, /Never run this line — Step 9 only prints it/);
});

test('Step 9 prose cross-references the paired tidy scan so the two halves of #613 stay linked', () => {
  assert.match(CLOSEOUT, /tidy\/scan-procedures\.md.{0,40}net-empty override/);
  assert.match(CLOSEOUT, /tidy\/step-6-auto\.md.{0,40}Delete row/);
});

test('a non-zero (real content) diff omits the Teardown section entirely — never a false positive', () => {
  assert.match(CLOSEOUT, /Non-zero \(real content\) → omit the Teardown section entirely/);
});
