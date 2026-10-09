// tests/hooks-bash-prefilter.test.js
//
// #3074: hooks.json registers ONE unconditional Bash handler per event; this
// prefilter is what keeps an uninteresting Bash call from paying the full
// handler. It must be a SUPERSET of the old per-pattern `if` predicates —
// a false "skip" silently drops enforcement, a false "run" costs one module load.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  PRE_TOOL_USE_WORDS, POST_TOOL_USE_WORDS, commandWords, shouldRunFull, earlyGate,
} = require('../plugin/bin/lib/hooks/bash-prefilter');
const { WRITE_SHAPES } = require('../plugin/bin/lib/hooks/git-command');

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

test('pre-tool-use words are git, env, mkdir plus every WRITE_SHAPES entry', () => {
  assert.deepStrictEqual([...PRE_TOOL_USE_WORDS].sort(), ['env', 'git', 'mkdir', ...WRITE_SHAPES].sort());
  assert.deepStrictEqual([...POST_TOOL_USE_WORDS].sort(), ['env', 'git']);
});

test('commandWords splits on whitespace and shell operators, strips quotes, takes basenames', () => {
  const w = commandWords('cd x && FOO=1 /usr/bin/git commit -m "y" | tee "out.txt"; echo $(git rev-parse HEAD)');
  for (const expected of ['cd', 'git', 'commit', 'tee', 'echo', 'rev-parse']) assert.ok(w.has(expected), expected);
  assert.ok(commandWords('"C:\\Program Files\\Git\\bin\\git.exe" status').has('git'));
});

for (const command of [
  'git commit -m x', 'cd x && git commit -m y', 'FOO=1 git push', 'timeout 5 git push',
  'env git commit -m x', 'env -i git commit -m x', 'env -C /x git commit -m y', 'env -u FOO git push',
  'git -c user.name=x commit -m y', 'git --exec-path=/x commit -m y', 'git --namespace=n push',
  'git -C . status', 'git worktree add ../w', 'git worktree remove ../w', '/usr/bin/git commit -m x',
  'for f in a b; do sed -i s/x/y/ "$f"; done', 'P=/tmp; cp a "$P/b"', 'mkdir -p "$TEMP/d"',
  'echo "$(git rev-parse HEAD)"', 'xargs git add < files.txt', 'git stash', 'git stash pop',
  ...WRITE_SHAPES.map((s) => `${s} a b`),
]) {
  test(`pre-tool-use runs the full handler for: ${command}`, () => {
    assert.strictEqual(shouldRunFull('pre-tool-use', bash(command)), true);
  });
}

for (const command of [
  'git commit -m x', 'cd x && git commit -m y', 'FOO=1 git push', 'env -C /x git commit -m y',
  'git -c user.name=x commit -m y', 'git worktree remove ../w', 'for n in 1 2; do git push; done',
]) {
  test(`post-tool-use runs the full handler for: ${command}`, () => {
    assert.strictEqual(shouldRunFull('post-tool-use', bash(command)), true);
  });
}

for (const command of ['echo hi', 'ls -la', 'node script.js', 'for i in 1; do echo probe-loop-$i; done',
  'echo digit gitk sedate envoy', 'gh issue view 3074', '']) {
  test(`pre-tool-use skips: ${JSON.stringify(command)}`, () => {
    assert.strictEqual(shouldRunFull('pre-tool-use', bash(command)), false);
  });
}

test('post-tool-use skips write shapes it never handled (cp/mkdir/sed)', () => {
  for (const command of ['cp a b', 'mkdir -p d', 'sed -i s/a/b/ f']) {
    assert.strictEqual(shouldRunFull('post-tool-use', bash(command)), false, command);
  }
});

test('fails open to "run" on anything it cannot read', () => {
  for (const event of ['pre-tool-use', 'post-tool-use']) {
    assert.strictEqual(shouldRunFull(event, null), true);
    assert.strictEqual(shouldRunFull(event, []), true);
    assert.strictEqual(shouldRunFull(event, { tool_name: 'Bash' }), true);
    assert.strictEqual(shouldRunFull(event, { tool_name: 'Bash', tool_input: { command: 42 } }), true);
  }
});

test('never skips a non-Bash tool', () => {
  for (const tool of ['Edit', 'Write', 'NotebookEdit', 'ExitWorktree', 'EnterWorktree', 'Skill', 'AskUserQuestion']) {
    for (const event of ['pre-tool-use', 'post-tool-use']) {
      assert.strictEqual(shouldRunFull(event, { tool_name: tool, tool_input: {} }), true, `${event} ${tool}`);
    }
  }
});

test('earlyGate reads stdin only for the two tool-use events', () => {
  let reads = 0;
  const reader = (raw) => () => { reads += 1; return raw; };
  assert.strictEqual(earlyGate('session-start', reader('{}')), null);
  assert.strictEqual(earlyGate('record-worktree', reader('{}')), null);
  assert.strictEqual(reads, 0);
  const raw = JSON.stringify(bash('echo hi'));
  assert.deepStrictEqual(earlyGate('pre-tool-use', reader(raw)), { raw, skip: true });
  assert.deepStrictEqual(earlyGate('pre-tool-use', reader('not json')), { raw: 'not json', skip: false });
  assert.deepStrictEqual(earlyGate('post-tool-use', () => { throw new Error('EAGAIN'); }), { raw: '', skip: false });
});
