// tests/foreground-execution-instruction.test.js — pins #1965: three dispatched Task calls this
// firing (1442 build, 1442 review, 1821 build) ended their turn narrating "Waiting for the
// background test run / fix-round / simplify subagent" with no status line. A Task agent that
// yields expecting a completion notification is never re-woken inside the Task — the dispatching
// session had to detect the missing status line and resume each one via SendMessage manually.
// Neither dispatch/task-prompt.md's two fenced Task-prompt templates nor build/dispatch.md's
// implementer/reviewer instruction paragraph said anything about foreground execution, so a
// dispatched agent (or the SDD implementer/reviewer sub-dispatches it composes) had no textual
// reason not to background a long-running command and wait on it. This suite pins the
// foreground-execution instruction in all three locations, and proves the check can actually go
// red (parse-signal-discipline).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', 'plugin');
const TASK_PROMPT = path.join(PLUGIN, 'skills', 'dispatch', 'task-prompt.md');
const BUILD_DISPATCH = path.join(PLUGIN, 'skills', 'build', 'dispatch.md');

// The load-bearing facts a reader (human or dispatched agent) must come away with — the exact
// failure mode #1965 documents. Each `\s+` absorbs the templates' hard line wrapping; the
// this/the alternation covers the direct address in task-prompt.md's templates versus
// build/dispatch.md's instruction about the dispatches SDD composes.
const REQUIRED = [
  [/never with\s+`run_in_background`/i, 'never background a long-running command'],
  [/never end\s+(?:this|the) turn waiting on a background/i, "never end the turn waiting on a background run or a child agent's notification"],
];

function fencedBlocks(text) {
  const blocks = [];
  const lines = text.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('```')) continue;
    if (start === -1) { start = i + 1; } else { blocks.push(lines.slice(start, i).join('\n')); start = -1; }
  }
  assert.equal(start, -1, 'unbalanced ``` fences — the last fenced block is unclosed');
  return blocks;
}

test('task-prompt.md: both fenced Task-prompt templates carry the foreground-execution instruction', () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  const blocks = fencedBlocks(text);
  assert.equal(blocks.length, 2, `expected exactly two fenced Task-prompt blocks, found ${blocks.length}`);

  const [firstCall, secondCall] = blocks;
  for (const [label, block] of [['first call (build,test)', firstCall], ['second call (review,polish,wrap-up)', secondCall]]) {
    for (const [pattern, fact] of REQUIRED) {
      assert.match(block, pattern, `${label} template must instruct the dispatched agent to ${fact} (#1965)`);
    }
  }
});

test('build/dispatch.md: the SDD invocation instruction directs implementer and reviewer dispatches to run in the foreground', () => {
  const text = fs.readFileSync(BUILD_DISPATCH, 'utf8');
  for (const [pattern, fact] of REQUIRED) {
    assert.match(text, pattern, `build/dispatch.md must instruct SDD's per-task implementer/reviewer dispatches to ${fact} (#1965)`);
  }
  assert.match(
    text,
    /implementer dispatch and every reviewer dispatch/i,
    'build/dispatch.md must scope the foreground instruction to every per-task implementer AND reviewer dispatch — the grandchildren that actually launched the background runs in #1965',
  );
});

test('the foreground-instruction predicate can actually go red (discrimination proof)', () => {
  const paragraphs = fs.readFileSync(TASK_PROMPT, 'utf8').split(/\r?\n\r?\n/);
  const kept = paragraphs.filter((p) => !p.startsWith('Foreground execution (required):'));
  assert.equal(
    paragraphs.length - kept.length,
    2,
    'expected to doctor out exactly the two foreground-execution paragraphs — anchor text not found',
  );

  const blocks = fencedBlocks(kept.join('\n\n'));
  assert.equal(blocks.length, 2);
  for (const block of blocks) {
    for (const [pattern] of REQUIRED) {
      assert.doesNotMatch(block, pattern, 'doctored block unexpectedly still matches — test cannot discriminate');
    }
  }
});
