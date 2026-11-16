// tests/dispatch-worktree-recovery-prose.test.js
//
// Pins record #4960's prose: dispatch/sequential-execution.md carries the
// recovery sequence for a session whose worktree disappears anyway (exit,
// then enter, never a plain cd), and dispatch/SKILL.md Step 5's reap
// statement names the session hold.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

const SEQUENTIAL = read('plugin/skills/dispatch/sequential-execution.md');
const DISPATCH_SKILL = read('plugin/skills/dispatch/SKILL.md');

// The `## ` section whose heading matches `headingRe`, up to the next `## `.
function section(text, headingRe) {
  const parts = text.split(/^(?=## )/m);
  return parts.find((p) => p.startsWith('## ') && headingRe.test(p.split('\n')[0])) || '';
}

test('AC4.1: sequential-execution.md states the recovery sequence', () => {
  const s = section(SEQUENTIAL, /worktree disappears/i);
  assert.notEqual(s, '', 'a section whose heading matches /worktree disappears/i exists');
  const exit = s.indexOf('ExitWorktree(action: "keep")');
  const enter = s.indexOf('EnterWorktree(path');
  assert.ok(exit >= 0, 'names ExitWorktree(action: "keep")');
  assert.ok(enter >= 0, 'names EnterWorktree(path');
  assert.ok(exit < enter, 'ExitWorktree precedes EnterWorktree');
});

test('AC4.1: sequential-execution.md warns against a plain cd', () => {
  const s = section(SEQUENTIAL, /worktree disappears/i);
  assert.match(s, /Never a plain `cd`/);
  assert.match(s, /refus/);
});

test('AC4.1: the recovery creates the next group\'s worktree before entering it, and names the no-group-left case', () => {
  const s = section(SEQUENTIAL, /worktree disappears/i);
  assert.match(s, /create the next group's worktree per "Creating\s+the group's worktree"/);
  assert.match(s, /stay in the original checkout after `ExitWorktree\(action: "keep"\)`/);
  assert.ok(s.indexOf('create the next group') < s.indexOf('EnterWorktree(path'), 'create precedes enter');
});

test('SKILL.md Step 5\'s reap statement names the session hold', () => {
  assert.ok(DISPATCH_SKILL.includes('own-cwd, locked and session-held worktrees'));
  assert.ok(!DISPATCH_SKILL.includes('skips own-cwd and locked worktrees)'));
});
