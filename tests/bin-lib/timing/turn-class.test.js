'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TURN_CLASSES, CEREMONY_CLASSES, classifyToolCall, classifyBash, isProcedurePath } = require('../../../plugin/bin/lib/timing/turn-class');
const transcript = require('../../../plugin/bin/lib/timing/transcript');

const bash = (command, extra = {}) => ({ name: 'Bash', input: { command }, ...extra });

const ROWS = [
  // one row per rule
  ['Edit', { name: 'Edit', input: { file_path: '/r/a.js' } }, 'edit'],
  ['Write', { name: 'Write', input: { file_path: '/r/a.js' } }, 'edit'],
  ['MultiEdit', { name: 'MultiEdit', input: { file_path: '/r/a.js' } }, 'edit'],
  ['NotebookEdit', { name: 'NotebookEdit', input: {} }, 'edit'],
  ['Read of a skill file', { name: 'Read', input: { file_path: '/repo/plugin/skills/build/SKILL.md' }, worktree: '/repo' }, 'procedure'],
  ['Read of a source file', { name: 'Read', input: { file_path: '/repo/src/a.js' }, worktree: '/repo' }, 'read'],
  ['Skill', { name: 'Skill', input: { skill: 'claude-tweaks:build' } }, 'procedure'],
  ['Grep', { name: 'Grep', input: { pattern: 'x' } }, 'explore'],
  ['Glob', { name: 'Glob', input: { pattern: '**/*.js' } }, 'explore'],
  ['LS', { name: 'LS', input: { path: '/r' } }, 'explore'],
  ['Agent', { name: 'Agent', input: { prompt: 'x' } }, 'dispatch'],
  ['Task', { name: 'Task', input: { prompt: 'x' } }, 'dispatch'],
  ['SendMessage resumes, not spawns', { name: 'SendMessage', input: {} }, 'other'],
  ['ToolSearch', { name: 'ToolSearch', input: { query: 'x' } }, 'orientation'],
  ['TodoWrite', { name: 'TodoWrite', input: { todos: [] } }, 'bookkeeping'],
  ['unknown tool', { name: 'Frobnicate', input: {} }, 'other'],
  ['missing name', { input: { command: 'git commit' } }, 'other'],
  ['no arguments at all', undefined, 'other'],
  // Bash
  ['cd hop then git -C commit', bash('cd "/r w" && git -C "/r w" commit -m x'), 'bookkeeping'],
  ['cd hop before ; then git commit', bash('cd /r; git commit -m x'), 'bookkeeping'],
  ['quoted cd hop before ; then git status', bash('cd "/r w" ; git status'), 'orientation'],
  ['git -C status', bash('git -C /r status'), 'orientation'],
  ['git log', bash('git log --oneline -3'), 'explore'],
  ['env assignment then npm test', bash('FOO=1 npm test > out.txt 2>&1'), 'verify'],
  ['verify.js from the plugin cache beats bookkeeping', bash('node "/u/.claude/plugins/cache/m/claude-tweaks/6.145.0/bin/verify.js" --run x'), 'verify'],
  ['cache script is bookkeeping', bash('node "/u/.claude/plugins/cache/m/claude-tweaks/6.145.0/bin/log-decision.js" --run x'), 'bookkeeping'],
  ['CLAUDE_PLUGIN_ROOT script is bookkeeping', bash('node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run x'), 'bookkeeping'],
  ['spaced path: verify.js', bash('node "/Users/t/Code Workspaces/claude-tweaks/plugin/bin/verify.js" --run x'), 'verify'],
  ['spaced path: tools/run-tests.js', bash('node "/Users/t/Code Workspaces/ct/tools/run-tests.js"'), 'verify'],
  ['spaced path: plugin-cache log-decision.js is bookkeeping', bash('node "/Users/a b/.claude/plugins/cache/m/claude-tweaks/6.145.0/bin/log-decision.js" --run x'), 'bookkeeping'],
  ['spaced path: plugin-cache verify.js is still verify', bash('node "/Users/a b/.claude/plugins/cache/m/claude-tweaks/6.145.0/bin/verify.js" --run x'), 'verify'],
  ['a script merely named like verify is not verify', bash('node "/u/a b/not-verify.js"'), 'other'],
  ['npx tsc', bash('npx tsc --noEmit'), 'verify'],
  ['scratch node script',bash('node scratch.js'), 'other'],
  ['git branch -D', bash('git branch -D x'), 'bookkeeping'],
  ['git branch listing', bash('git branch --show-current'), 'orientation'],
  ['git worktree add', bash('git worktree add ../w -b x'), 'bookkeeping'],
  ['git worktree list', bash('git worktree list'), 'orientation'],
  ['gh head', bash('gh pr view 12'), 'bookkeeping'],
  ['pwd', bash('pwd'), 'orientation'],
  ['echo', bash('echo hi'), 'orientation'],
  ['grep head', bash('grep -rn foo plugin'), 'explore'],
  ['piped explore stays explore', bash('git ls-files | wc -l'), 'explore'],
  ['unknown git subcommand', bash('git frobnicate'), 'other'],
  ['node --test', bash('node --test tests/a.test.js'), 'verify'],
  ['tools/run-tests.js', bash('node tools/run-tests.js'), 'verify'],
  ['npx --test', bash('npx -y node@20 --test tests/a.test.js'), 'verify'],
  ['npm run test', bash('npm run test:perf'), 'verify'],
  ['verify in a later segment', bash('git add a.js && npm test'), 'verify'],
  ['verify word inside a quoted commit message is not a run', bash('git commit -m "fix && npm test"'), 'bookkeeping'],
  ['verify word as a grep pattern is not a run', bash('grep "npm test" README.md'), 'explore'],
  ['empty command', bash(''), 'other'],
  ['missing command', { name: 'Bash', input: {} }, 'other'],
  // guard refusals
  ['worktree isolation refusal', bash('git -C /r commit', { isError: true, resultText: 'This session is isolated in the worktree /r, but …' }), 'guard-refusal'],
  ['permission denied refusal', { name: 'Write', input: {}, isError: true, resultText: 'Permission to use Write has been denied because …' }, 'guard-refusal'],
  ['permission denied refusal quoting a long command', bash('node x', { isError: true, resultText: `Permission to use Bash with command node ${'a'.repeat(400)} has been denied.` }), 'guard-refusal'],
  ['PreToolUse hook refusal', bash('git push', { isError: true, resultText: 'PreToolUse:Bash hook error: claude-tweaks: …' }), 'guard-refusal'],
  ['plain exit code error classifies by tool', bash('grep x', { isError: true, resultText: 'Exit code 1' }), 'explore'],
  ['refusal text without isError is not a refusal', bash('git status', { isError: false, resultText: 'This session is isolated in the worktree /r' }), 'orientation'],
  ['refusal text without isError flag at all', bash('git status', { resultText: 'This session is isolated in the worktree /r' }), 'orientation'],
];

test('turn-class: classifyToolCall maps each tool to its class', () => {
  for (const [label, call, expected] of ROWS) {
    assert.equal(classifyToolCall(call), expected, label);
  }
});

test('turn-class [IL-162]: the refusal match reads only the first 2,048 chars, and a leading refusal still matches', () => {
  // The timing half (200k chars under 200 ms) is perf/turn-class-refusal-latency.test.js.
  // a real refusal leads its result, so a long tail after it changes nothing
  const tail = '\n' + 'y'.repeat(200000);
  assert.equal(classifyToolCall({ name: 'Write', input: {}, isError: true, resultText: 'Permission to use Write has been denied because …' + tail }), 'guard-refusal');
  assert.equal(classifyToolCall(bash('git push', { isError: true, resultText: 'PreToolUse:Bash hook error: claude-tweaks: …' + tail })), 'guard-refusal');
  // refusal text past the first 2,048 chars is not a leading refusal
  assert.equal(classifyToolCall(bash('git status', { isError: true, resultText: 'z'.repeat(2048) + 'This session is isolated in the worktree /r' })), 'orientation');
});

test('turn-class: every row lands in TURN_CLASSES and each class is exercised', () => {
  const seen = new Set(ROWS.map(([, call]) => classifyToolCall(call)));
  for (const c of seen) assert.ok(TURN_CLASSES.includes(c), c);
  assert.deepEqual([...seen].sort(), [...TURN_CLASSES].sort());
});

test('turn-class: classifyBash is directly callable', () => {
  assert.equal(classifyBash('cd /r && FOO=1 BAR="a b" git status'), 'orientation');
  assert.equal(classifyBash('git --no-optional-locks -C "/r w" log -1'), 'explore');
  assert.equal(classifyBash(undefined), 'other');
});

test('turn-class: TURN_CLASSES order and CEREMONY_CLASSES subset', () => {
  assert.deepEqual(TURN_CLASSES, ['edit', 'read', 'explore', 'procedure', 'bookkeeping', 'orientation', 'verify', 'guard-refusal', 'dispatch', 'other']);
  assert.deepEqual(CEREMONY_CLASSES, ['procedure', 'bookkeeping', 'orientation', 'guard-refusal']);
  for (const c of CEREMONY_CLASSES) assert.ok(TURN_CLASSES.includes(c), c);
  assert.ok(Object.isFrozen(TURN_CLASSES) && Object.isFrozen(CEREMONY_CLASSES));
});

test('turn-class: isProcedurePath moved here and transcript.js re-exports the same function', () => {
  assert.equal(transcript.isProcedurePath, isProcedurePath);
  assert.equal(isProcedurePath('/home/u/.claude/plugins/cache/m/p/1.0/skills/build/SKILL.md'), true);
  assert.equal(isProcedurePath('/repo/plugin/skills/build/SKILL.md', '/repo'), true);
  assert.equal(isProcedurePath('/repo/src/a.js', '/repo'), false);
  assert.equal(isProcedurePath(undefined), false);
});
