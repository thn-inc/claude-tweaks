'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #1957: build-time guard warning before a build reuses another record's
// cherry-picked branch that already backs an open PR (closes #1821's
// incident class). The detection logic itself has unit coverage in
// tests/bin-lib/worktree/cherry-pick-provenance.test.js — this file pins
// the skill prose that wires it into the build pipeline and states its
// auto-mode posture, since that posture (AC4: auto mode hard-stops, never
// silenced) is a documented contract, not something the unit tests over the
// pure functions can themselves verify.
//
// Read live, not a frozen fixture: this is just-shipped prose expected to
// evolve alongside worktree-setup.md's own Step 1.5/1.6 (which it mirrors),
// not content a future migration is scheduled to delete.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const WORKTREE_SETUP = read('plugin', 'skills', 'build', 'worktree-setup.md');
const BUILD_SKILL = read('plugin', 'skills', 'build', 'SKILL.md');
const DISPATCH = read('plugin', 'skills', 'build', 'dispatch.md');

// This repo hard-wraps skill prose, so a literal space in a regex can miss a
// phrase whose word-wrap landed a newline exactly there. Collapse all
// whitespace runs to a single space before matching multi-word phrases.
const norm = (text) => text.replace(/\s+/g, ' ');

test('worktree-setup.md carries the new Cherry-pick source-branch PR check section', () => {
  assert.match(WORKTREE_SETUP, /## Cherry-pick source-branch PR check \(#1957\)/);
});

test('the new check states the -x trailer as the only trigger, and the manual-port limitation explicitly', () => {
  assert.match(WORKTREE_SETUP, /\(cherry picked from commit/);
  assert.match(
    norm(WORKTREE_SETUP),
    /manual port of code[^.]*is not caught by this check/i,
    'must state the accepted manual-port/no-`-x` limitation explicitly, not imply broader coverage',
  );
});

test('AC4: the new check is stated as NOT a silenceable auto-mode lever, and hard-stops', () => {
  const section = norm(
    WORKTREE_SETUP.slice(WORKTREE_SETUP.indexOf('## Cherry-pick source-branch PR check')),
  );
  assert.match(
    section,
    /\*\*Auto mode:\*\*[\s\S]*?not\*\* a lever `_shared\/auto-mode-contract\.md` lists as silenceable/,
    'must explicitly state this is not a silenceable auto-mode lever, mirroring Step 1.6',
  );
  assert.match(section, /stop the build/i, 'must hard-stop the build, not proceed silently');
});

test('the check mirrors Step 1.6\'s fail-open-but-distinct posture on a lookup failure', () => {
  const section = norm(
    WORKTREE_SETUP.slice(WORKTREE_SETUP.indexOf('## Cherry-pick source-branch PR check')),
  );
  assert.match(section, /fail open/i);
  assert.match(section, /degrade distinctly/i);
});

test('the check states the #1821 incident and the #1944 / review-time-check non-goals', () => {
  const section = norm(
    WORKTREE_SETUP.slice(WORKTREE_SETUP.indexOf('## Cherry-pick source-branch PR check')),
  );
  assert.match(section, /#1821/);
  assert.match(section, /#1944/);
});

test('build/SKILL.md Common Step 2 points at the new check (worktree strategy, per-commit)', () => {
  const step2 = norm(
    BUILD_SKILL.slice(
      BUILD_SKILL.indexOf('### Common Step 2: Execute the Plan'),
      BUILD_SKILL.indexOf('**subagent** (default)'),
    ),
  );
  assert.match(step2, /Cherry-pick source-branch PR check \(#1957\)/);
  assert.match(step2, /After each commit lands/i);
});

test('dispatch.md restates the cherry-pick check instruction into the SDD invocation (subagents don\'t inherit skill prose)', () => {
  const text = norm(DISPATCH);
  assert.match(text, /Cherry-pick source-branch PR check \(#1957\)/);
  assert.match(text, /cherry picked from commit \{sha\}/);
});
