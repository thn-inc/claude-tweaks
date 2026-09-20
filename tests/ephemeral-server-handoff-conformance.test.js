'use strict';
// #1937 — dispatch two-call hand-off: an ephemeral worktree dev server started in the first
// Task call does not survive into the second. This suite pins the prose additions this record
// makes outside dev-url-detection.md itself: dispatch/task-prompt.md's two fenced templates
// (detach-and-keep in the first call, liveness-recheck-and-restart in the second) and
// wrap-up/cleanup-procedures-execution.md Section D's process-group-kill and
// already-stopped-is-not-an-error clauses.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', 'plugin');
const TASK_PROMPT = path.join(PLUGIN, 'skills', 'dispatch', 'task-prompt.md');
const CLEANUP_EXEC = path.join(PLUGIN, 'skills', 'wrap-up', 'cleanup-procedures-execution.md');

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

test('task-prompt.md still carries exactly two fenced Task-prompt templates (this record adds prose only, no new fences)', () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  const blocks = fencedBlocks(text);
  assert.equal(blocks.length, 2, `expected exactly two fenced Task-prompt blocks, found ${blocks.length}`);
});

test("first call's template detaches the ephemeral server and forbids deleting ephemeral-server.txt at call end", () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  const [firstCall] = fencedBlocks(text);
  assert.match(firstCall, /start it detached/);
  assert.match(firstCall, /setsid/);
  assert.match(firstCall, /Never delete `ephemeral-server\.txt`/);
  assert.match(firstCall, /the record belongs to the run, not to this call/);
  assert.doesNotMatch(firstCall, /_shared\//, 'must not cite a raw _shared/ path (tests/dispatch-prompt-bundle-citations.test.js)');
});

test("second call's template re-checks liveness before the first browser step and before trace stop, and restarts on a dead pid with the documented log line", () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  const [, secondCall] = fencedBlocks(text);
  assert.match(secondCall, /before\s+the first browser-driving step, and again before any `trace stop`/);
  assert.match(secondCall, /verify the recorded pid\s+answers on the recorded port/);
  assert.match(secondCall, /On a dead pid, start a fresh server/);
  assert.match(secondCall, /ephemeral server restarted:\s+recorded pid \{old\} dead, new pid \{new\} on port\s*\{port\}/);
  const livenessIdx = secondCall.indexOf('Ephemeral dev server liveness');
  const livenessParagraphEnd = secondCall.indexOf('\n\n', livenessIdx);
  const livenessParagraph = secondCall.slice(livenessIdx, livenessParagraphEnd === -1 ? undefined : livenessParagraphEnd);
  assert.doesNotMatch(livenessParagraph, /_shared\//, 'the liveness paragraph must not cite a raw _shared/ path (tests/dispatch-prompt-bundle-citations.test.js)');
});

test('Section D kills the process group when detached:yes and never when detached:no', () => {
  const text = fs.readFileSync(CLEANUP_EXEC, 'utf8');
  const idx = text.indexOf('## D. Ephemeral dev server');
  const endIdx = text.indexOf('## E. Issue claim release');
  assert.ok(idx !== -1 && endIdx !== -1 && idx < endIdx);
  const body = text.slice(idx, endIdx);
  assert.match(body, /detached:yes.*also kill the process group/s);
  assert.match(body, /kill -- -\{pid\}/);
  assert.match(body, /never do this when the field reads `detached:no`/);
});

test('Section D logs an already-gone pid as "already stopped", never as an error', () => {
  const text = fs.readFileSync(CLEANUP_EXEC, 'utf8');
  const idx = text.indexOf('## D. Ephemeral dev server');
  const endIdx = text.indexOf('## E. Issue claim release');
  const body = text.slice(idx, endIdx);
  assert.match(body, /already-gone pid is not an error/);
  assert.match(body, /already stopped: pid \{pid\}/);
  assert.match(body, /never surface this as a cleanup failure/);
});

test('the ephemeral-server-handoff predicates can actually go red (discrimination proof)', () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  const paragraphs = text.split(/\r?\n\r?\n/);
  const kept = paragraphs.filter((p) => !p.startsWith('Ephemeral dev server'));
  assert.equal(
    paragraphs.length - kept.length,
    2,
    'expected to doctor out exactly the two ephemeral-dev-server paragraphs — anchor text not found',
  );
  const blocks = fencedBlocks(kept.join('\n\n'));
  assert.equal(blocks.length, 2);
  assert.doesNotMatch(blocks[0], /start it detached/);
  assert.doesNotMatch(blocks[1], /verify the recorded pid\s+answers on the recorded port/);
});
