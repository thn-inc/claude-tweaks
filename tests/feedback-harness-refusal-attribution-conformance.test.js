'use strict';
// tests/feedback-harness-refusal-attribution-conformance.test.js — pins that
// skills/feedback/SKILL.md's Step 1 (#3338) checks a quoted Bash refusal against
// the plugin's own bin/ before naming a plugin hook as the affected component,
// attributing an unmatched refusal to the Claude Code harness worktree guard
// (a documentation finding, routed to _shared/scratch-worktree.md §7), and that
// bare-invocation.md's batch derivation points at that same check.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const MD_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'feedback', 'SKILL.md');
const md = readText(MD_PATH);
const step1 = md.slice(md.indexOf('### Step 1: Gather'), md.indexOf('### Step 2'));

const BARE_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'feedback', 'bare-invocation.md');
const bare = readText(BARE_PATH);

test('Step 1 greps the quoted refusal under the plugin\'s bin/ before naming a plugin hook', () => {
  assert.ok(/Bash-refusal attribution/.test(step1), 'Step 1 must carry the Bash-refusal attribution paragraph');
  assert.ok(step1.includes('${CLAUDE_PLUGIN_ROOT}/bin/'), 'must grep under the plugin root bin/');
  assert.ok(/plugin\/bin\//.test(step1), 'must name this repo\'s plugin/bin/ path');
  assert.ok(/pre-tool-use\.js/.test(step1), 'must name the pre-tool-use.js hook as the attribution candidate');
});

test('No match attributes to the harness guard and routes to scratch-worktree §7, never a hook defect', () => {
  assert.ok(step1.includes('Claude Code harness worktree guard'), 'must attribute an unmatched refusal to the Claude Code harness worktree guard');
  assert.ok(step1.includes('_shared/scratch-worktree.md'), 'must route to _shared/scratch-worktree.md');
  assert.ok(/§7|## 7\. Shell constraint/.test(step1), 'must cite §7 (Shell constraint)');
  assert.ok(/never[^.]*hook defect/i.test(step1), 'must state the harness finding is never a hook defect');
});

test('The plugin\'s claude-tweaks-prefixed deny is the positive signal, citing skill-authoring rather than restating', () => {
  assert.ok(step1.includes('claude-tweaks: this project requires an isolated worktree'),
    'must name the claude-tweaks-prefixed isolated-worktree deny');
  assert.ok(step1.includes('claude-tweaks working-directory discipline'),
    'must name the claude-tweaks working-directory-discipline deny');
  assert.ok(step1.includes('docs/skill-authoring.md'), 'must cite docs/skill-authoring.md');
  assert.ok(step1.includes('Harness-level worktree Bash guard vs. the plugin'),
    'must cite the skill-authoring section by its heading');
});

test('Greps the reason clause, not the frame the plugin\'s own hooks recognize', () => {
  assert.ok(step1.includes('Refusing to run it'), 'must name the refusal frame it must not grep');
  assert.ok(/reason clause/i.test(step1), 'must instruct grepping the reason clause');
  assert.ok(/post-tool-use-failure/.test(step1), 'must name the post-tool-use-failure hook that quotes the frame');
});

test('A match on a non-prefixed string is read, and a line that only quotes the refusal counts as no match', () => {
  assert.ok(step1.includes('A match on any other string: read the hit'), 'must instruct reading a non-prefixed hit');
  assert.ok(/only quotes or recognizes the refusal/.test(step1), 'must treat a quoting/recognizing line as no match');
});

test('Warns that a fragment containing git trips the guard itself', () => {
  assert.ok(/substring `git`|containing `git`/i.test(step1), 'must warn against a grep fragment containing git');
});

test('Permission-rule denials are not defaulted to the harness', () => {
  assert.ok(step1.includes('Permission to use Bash'), 'must name the permission-rule denial exception');
});

test('bare-invocation\'s batch component derivation applies Step 1\'s check', () => {
  assert.ok(/Step 1's Bash-refusal attribution check/.test(bare),
    'bare-invocation.md must point at Step 1\'s Bash-refusal attribution check');
});
