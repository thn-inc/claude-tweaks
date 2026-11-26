'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { TURN_CLASSES, CEREMONY_CLASSES, classifyToolCall, classifyBash, isProcedurePath, procedureFileKey, contextBundleKey, readFileKey, bashProcedureFiles } = require('../../../plugin/bin/lib/timing/turn-class');
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
  ['agent isolation refusal', bash('git -C /r commit', { isError: true, resultText: 'This agent is isolated in the worktree /r, but …' }), 'guard-refusal'],
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

test('turn-class: procedureFileKey folds repo, worktree and cache paths to one skills/ key', () => {
  const key = 'skills/review/code-mode-steps.md';
  assert.equal(procedureFileKey('plugin/skills/review/code-mode-steps.md', null), key);
  assert.equal(procedureFileKey('/w/plugin/skills/review/code-mode-steps.md', '/w'), key);
  assert.equal(procedureFileKey('/Users/u/.claude/plugins/cache/m/claude-tweaks/6.170.0/skills/review/code-mode-steps.md', null), key);
});

test('turn-class: procedureFileKey returns null for a non-procedure path', () => {
  assert.equal(procedureFileKey('/r/.claude-tweaks/pipelines/x/context/review-code-mode.md', '/r'), null);
  assert.equal(procedureFileKey('src/a.js', null), null);
  assert.equal(procedureFileKey('', null), null);
});

test('turn-class: procedureFileKey folds a win32 worktree path under path.win32', () => {
  assert.equal(procedureFileKey('C:\\w\\plugin\\skills\\review\\x.md', 'C:\\w', path.win32), 'skills/review/x.md');
});

test('turn-class: bashProcedureFiles counts each skill path a read command names', () => {
  assert.deepEqual(bashProcedureFiles(`sed -n '1,40p' "/U/Code Workspaces/r/plugin/skills/review/code-mode-steps.md"`, null), ['skills/review/code-mode-steps.md']);
  assert.deepEqual(
    bashProcedureFiles('grep -n "Step 3" plugin/skills/review/step3-lens-dispatch.md plugin/skills/review/code-mode-steps.md', null),
    ['skills/review/step3-lens-dispatch.md', 'skills/review/code-mode-steps.md'],
  );
  assert.deepEqual(bashProcedureFiles('cat a.txt && head -5 plugin/skills/_shared/x.md', null), ['skills/_shared/x.md']);
  assert.deepEqual(bashProcedureFiles('git show HEAD:plugin/skills/review/code-mode-steps.md', null), []);
  assert.deepEqual(bashProcedureFiles('node plugin/bin/x.js plugin/skills/a.md', null), []);
});

test('turn-class: bashProcedureFiles skips output-redirect targets and counts input redirects', () => {
  assert.deepEqual(bashProcedureFiles('cat > plugin/skills/a/new.md <<EOF', null), []);
  assert.deepEqual(bashProcedureFiles('cat plugin/skills/a/x.md >> plugin/skills/a/y.md', null), ['skills/a/x.md']);
  assert.deepEqual(bashProcedureFiles('grep -n x plugin/skills/a/x.md 2> plugin/skills/a/err.md', null), ['skills/a/x.md']);
  assert.deepEqual(bashProcedureFiles('cat plugin/skills/a/x.md &> plugin/skills/a/y.md', null), ['skills/a/x.md']);
  assert.deepEqual(bashProcedureFiles('cat a.txt >plugin/skills/x.md 2>&1', null), []);
  assert.deepEqual(bashProcedureFiles('cat < plugin/skills/a/x.md', null), ['skills/a/x.md']);
  assert.deepEqual(bashProcedureFiles('wc -l <plugin/skills/a/x.md', null), ['skills/a/x.md']);
  assert.deepEqual(bashProcedureFiles('wc -l <skills/a/x.md', null), ['skills/a/x.md']);
});

test('turn-class: bashProcedureFiles skips glob tokens', () => {
  assert.deepEqual(bashProcedureFiles('cat plugin/skills/review/*.md', null), []);
  assert.deepEqual(bashProcedureFiles('cat plugin/skills/review/step?.md plugin/skills/[ab]/x.md plugin/skills/a/x.md', null), ['skills/a/x.md']);
});

test('turn-class: bashProcedureFiles never counts a grep/rg/ugrep pattern as a path', () => {
  assert.deepEqual(bashProcedureFiles('grep -n "Step 3" plugin/skills/review/x.md', null), ['skills/review/x.md']);
  assert.deepEqual(bashProcedureFiles('grep "skills/x.md" file.txt', null), []);
  assert.deepEqual(bashProcedureFiles('rg plugin/skills/x.md plugin/skills/y.md', null), ['skills/y.md']);
  assert.deepEqual(bashProcedureFiles('grep -e plugin/skills/x.md foo.txt', null), []);
  assert.deepEqual(bashProcedureFiles('grep -e x plugin/skills/a/x.md', null), ['skills/a/x.md']);
  assert.deepEqual(bashProcedureFiles('ugrep --regexp skills/p.md plugin/skills/a/x.md', null), ['skills/a/x.md']);
  assert.deepEqual(bashProcedureFiles('grep -f plugin/skills/pats.md plugin/skills/a/x.md', null), ['skills/a/x.md']);
  assert.deepEqual(bashProcedureFiles('grep --file=plugin/skills/pats.md plugin/skills/a/x.md', null), ['skills/a/x.md']);
  assert.deepEqual(bashProcedureFiles('grep -ne x plugin/skills/a/x.md', null), ['skills/a/x.md']);
  // every -e value is a pattern, and a pattern flag anywhere (grep permutes) leaves no positional pattern
  assert.deepEqual(bashProcedureFiles('grep -e x -e plugin/skills/p.md plugin/skills/a/x.md', null), ['skills/a/x.md']);
  assert.deepEqual(bashProcedureFiles('grep plugin/skills/a/x.md -e x', null), ['skills/a/x.md']);
  assert.deepEqual(bashProcedureFiles('grep plugin/skills/a/x.md -ne x', null), ['skills/a/x.md']);
  assert.deepEqual(bashProcedureFiles('grep plugin/skills/a/x.md --regexp=x', null), ['skills/a/x.md']);
  // a non-grep head has no pattern slot: cat's first operand is a path
  assert.deepEqual(bashProcedureFiles('cat plugin/skills/a/x.md', null), ['skills/a/x.md']);
});

test('turn-class: bashProcedureFiles sees through timeout and xargs wrappers', () => {
  assert.deepEqual(bashProcedureFiles('timeout 5 cat plugin/skills/x.md', null), ['skills/x.md']);
  assert.deepEqual(bashProcedureFiles('timeout -s KILL --preserve-status 5s cat plugin/skills/x.md', null), ['skills/x.md']);
  assert.deepEqual(bashProcedureFiles('xargs cat plugin/skills/x.md', null), ['skills/x.md']);
  assert.deepEqual(bashProcedureFiles('ls | xargs -n 1 -0 grep -l x plugin/skills/x.md', null), ['skills/x.md']);
  assert.deepEqual(bashProcedureFiles('timeout 5 xargs cat plugin/skills/x.md', null), ['skills/x.md']);
  assert.deepEqual(bashProcedureFiles('timeout 5 node plugin/skills/x.md', null), []);
});

// #4359 I1: a composed bundle read counts under context/<name>.md, never under skills/.
test('turn-class: contextBundleKey keys a run context bundle, absolute or repo-relative', () => {
  assert.equal(contextBundleKey('/r/.claude-tweaks/pipelines/2026-11-16T000452-record-1/context/review-code-mode.md', '/r/.claude/worktrees/wt'), 'context/review-code-mode.md');
  assert.equal(contextBundleKey('.claude-tweaks/pipelines/run-a/context/lens-child.md', null), 'context/lens-child.md');
  assert.equal(contextBundleKey('/r/.claude-tweaks/pipelines/run-a/spec-2/context/merge.md', null), 'context/merge.md');
  assert.equal(contextBundleKey('C:\\r\\.claude-tweaks\\pipelines\\run-a\\context\\x.md', null, path.win32), 'context/x.md');
});

test('turn-class: contextBundleKey is null off a run context dir, and a bundle is never a skill-file read', () => {
  assert.equal(contextBundleKey('/r/.claude-tweaks/pipelines/run-a/work/4359-spec.md', null), null);
  assert.equal(contextBundleKey('/r/.claude-tweaks/pipelines/run-a/decisions.md', null), null);
  assert.equal(contextBundleKey('/r/.claude-tweaks/pipelines/context/x.md', null), null, 'no run-id segment');
  assert.equal(contextBundleKey('/r/other/run-a/context/x.md', null), null);
  assert.equal(contextBundleKey('/r/.claude-tweaks/pipelines/run-a/context/x.json', null), null);
  assert.equal(contextBundleKey('', null), null);
  const bundle = '/r/.claude-tweaks/pipelines/run-a/context/review-code-mode.md';
  assert.equal(isProcedurePath(bundle, null), false);
  assert.equal(procedureFileKey(bundle, null), null);
  assert.equal(readFileKey(bundle, null), 'context/review-code-mode.md');
  assert.equal(readFileKey('plugin/skills/review/x.md', null), 'skills/review/x.md');
  assert.equal(readFileKey('src/a.js', null), null);
});

test('turn-class: bashProcedureFiles counts a sed or cat of a context bundle under its context/ key', () => {
  assert.deepEqual(bashProcedureFiles('sed -n "1,80p" "/U/Code Workspaces/r/.claude-tweaks/pipelines/run-a/context/review-code-mode.md"', null), ['context/review-code-mode.md']);
  assert.deepEqual(bashProcedureFiles('cat .claude-tweaks/pipelines/run-a/context/lens-child.md plugin/skills/review/x.md', null), ['context/lens-child.md', 'skills/review/x.md']);
  assert.deepEqual(bashProcedureFiles('cat .claude-tweaks/pipelines/run-a/events.jsonl', null), []);
});

test('turn-class: a bundle under a main checkout inside a skills/ directory still keys under context/', () => {
  const bundle = '/home/u/skills/repo/.claude-tweaks/pipelines/run-a/context/lens-child.md';
  assert.equal(isProcedurePath(bundle, null), true, 'setup: the path also looks like a procedure path');
  assert.equal(readFileKey(bundle, null), 'context/lens-child.md');
  assert.deepEqual(bashProcedureFiles(`sed -n "1,80p" ${bundle}`, null), ['context/lens-child.md']);
});

// #4359 T1-1: a grep-family flag that takes a value never lets the value take the pattern slot.
test('turn-class: bashProcedureFiles skips the value of -A/-B/-C/-m and their long forms', () => {
  for (const flag of ['-A 3', '-B 3', '-C 3', '-m 1', '-nC 2', '--max-count 1', '--context 2', '--after-context 2', '--before-context 2']) {
    assert.deepEqual(bashProcedureFiles(`grep ${flag} plugin/skills/p.md plugin/skills/a/x.md`, null), ['skills/a/x.md'], flag);
  }
  // attached values consume nothing more
  for (const flag of ['-A3', '--context=2', '--max-count=1']) {
    assert.deepEqual(bashProcedureFiles(`rg ${flag} plugin/skills/p.md plugin/skills/a/x.md`, null), ['skills/a/x.md'], flag);
  }
});

// #4359 T1-2: a quoted operator character is literal text.
test('turn-class: bashProcedureFiles reads a quoted >, >>, < or glob character as a literal', () => {
  assert.deepEqual(bashProcedureFiles('grep -n ">" plugin/skills/a.md plugin/skills/b.md', null), ['skills/a.md', 'skills/b.md']);
  assert.deepEqual(bashProcedureFiles("grep '>>' plugin/skills/a.md", null), ['skills/a.md']);
  assert.deepEqual(bashProcedureFiles('grep "<" plugin/skills/a.md', null), ['skills/a.md']);
  assert.deepEqual(bashProcedureFiles('cat "plugin/skills/[x].md"', null), ['skills/[x].md']);
  // the unquoted forms stay operators
  assert.deepEqual(bashProcedureFiles('grep -n x plugin/skills/a.md > plugin/skills/b.md', null), ['skills/a.md']);
  assert.deepEqual(classifyBash('grep -n ">" a b'), 'explore');
});

// #4359 T1-4: a heredoc body is data, never a command.
test('turn-class: bashProcedureFiles counts no read named inside a heredoc body', () => {
  assert.deepEqual(bashProcedureFiles('cat <<EOF > /tmp/x\nsed -n 1p plugin/skills/review/SKILL.md\nEOF', null), []);
  assert.deepEqual(bashProcedureFiles("cat <<'EOF' > /tmp/x\ncat plugin/skills/review/SKILL.md\nEOF\ncat plugin/skills/a.md", null), ['skills/a.md']);
});

test('AC4 (unit): a Workflow tool call is classed dispatch', () => {
  assert.equal(classifyToolCall({ name: 'Workflow', input: { script: 'x' } }), 'dispatch');
});
