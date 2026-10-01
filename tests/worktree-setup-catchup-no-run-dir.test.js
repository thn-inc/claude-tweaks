'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #2704: _shared/worktree-setup.md's Post-creation catch-up told the caller to log a
// branch-advancing merge to "the run's decisions.md" — but interactive worktree-always
// sessions, /specify, /init's scratch worktree, and /routine create-and-update all run
// the catch-up before any pipeline run directory exists, so the advance was silently
// unlogged. These tests pin the no-run-dir branch and its two citations.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const SETUP = read('plugin', 'skills', '_shared', 'worktree-setup.md');
const NO_RUN_DIR = read('plugin', 'skills', '_shared', 'worktree-catchup-no-run-dir.md');
const SPECIFY = read('plugin', 'skills', 'specify', 'SKILL.md');

test('worktree-setup.md: the catch-up log sentence points at the no-run-dir branch', () => {
  const start = SETUP.indexOf('**Log the correction when it changes anything.**');
  assert.notStrictEqual(start, -1, '"Log the correction" paragraph missing — this test has lost its anchor');
  const end = SETUP.indexOf('## Pre-flight divergence check', start);
  assert.notStrictEqual(end, -1, '## Pre-flight divergence check heading missing');
  assert.match(SETUP.slice(start, end), /worktree-catchup-no-run-dir\.md/, 'the log obligation must point at its no-run-dir branch');
});

test('worktree-catchup-no-run-dir.md: routes the advance line to the caller\'s own output', () => {
  assert.match(NO_RUN_DIR, /user-facing output/i, 'must name the caller\'s user-facing output as the home');
  assert.match(NO_RUN_DIR, /later in the same session/i, 'must cover a run dir that resolves later in the same session');
  assert.match(NO_RUN_DIR, /decisions\.md/, 'must still route to decisions.md once a run dir exists');
  assert.match(NO_RUN_DIR, /no-op/i, 'the no-op rule (unchanged tip writes nothing) must still apply');
  assert.match(NO_RUN_DIR, /No-run-dir carrier/, 'must cite auto-decision-log.md\'s existing No-run-dir carrier convention');
});

test('worktree-catchup-no-run-dir.md: names its callers and why no standalone log', () => {
  assert.match(NO_RUN_DIR, /SessionStart/, 'must name worktree-always sessions entered via the SessionStart instruction');
  assert.match(NO_RUN_DIR, /\/claude-tweaks:specify/, 'must name /claude-tweaks:specify');
  assert.match(NO_RUN_DIR, /\/claude-tweaks:build/, 'must name standalone /claude-tweaks:build');
  assert.match(NO_RUN_DIR, /\/claude-tweaks:init/, 'must name /claude-tweaks:init');
  assert.match(NO_RUN_DIR, /\/claude-tweaks:routine/, 'must name /claude-tweaks:routine');
  assert.match(NO_RUN_DIR, /scratch-worktree\.md/, 'must name _shared/scratch-worktree.md callers');
  assert.match(NO_RUN_DIR, /policy-schema-coverage\.md/, 'must cite policy-schema-coverage.md for what the gate exempts, not restate the list');
});

test('specify/SKILL.md: Next Actions carries a catch-up advance per the no-run-dir branch', () => {
  const m = /^## Next Actions$/m.exec(SPECIFY); assert.ok(m, '## Next Actions heading missing'); const start = m.index;
  const end = SPECIFY.indexOf('\n## ', start + 1);
  const region = SPECIFY.slice(start, end === -1 ? undefined : end);
  assert.match(region, /_shared\/worktree-catchup-no-run-dir\.md/, 'must cite the no-run-dir branch file');
  assert.match(region, /advanced/i, 'must say the advance line is reported');
});
