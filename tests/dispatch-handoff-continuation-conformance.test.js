'use strict';
// tests/dispatch-handoff-continuation-conformance.test.js — #4027 Task 9: a dispatched
// /flow call that crossed the context cap reports `OUTCOME: handoff` + `NEXT_STEPS:`
// (flow/context-handoff.md's Dispatched call). The dispatcher continues it in a fresh
// Task call built from the same template with the step list replaced by NEXT_STEPS,
// at most three handoffs per run, then gates on the last continuation's report. Pins
// both templates' OUTPUT FORMAT, the substitution (a first-call `test` continuation
// keeps "Stop after the test gate"), two-call-gate.md section 8, and every dispatch
// file whose OUTCOME handling a handoff would otherwise fall through as a failure.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const gate = require('../plugin/bin/lib/dispatch/first-call-artifact-check');

const DIR = path.join(__dirname, '..', 'plugin', 'skills', 'dispatch');
const read = (name) => readText(path.join(DIR, name));

function region(text, start, end, label) {
  const s = text.indexOf(start);
  assert.notEqual(s, -1, `${label}: start anchor ${JSON.stringify(start)} not found`);
  const e = end === null ? text.length : text.indexOf(end, s + start.length);
  assert.notEqual(e, -1, `${label}: end anchor ${JSON.stringify(end)} not found`);
  return text.slice(s, e);
}

function fencedBlocks(text) {
  const blocks = [];
  const re = /^```[^\n]*\n([\s\S]*?)^```$/gm;
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();
const STOP_SENTENCE = 'Stop after the test gate -- do not proceed to review, polish, or wrap-up;';

test('task-prompt.md: both templates name handoff in their OUTCOME line, with a NEXT_STEPS line right after it', () => {
  const blocks = fencedBlocks(read('task-prompt.md'));
  assert.equal(blocks.length, 2, `expected exactly two fenced templates, found ${blocks.length}`);
  const [first, second] = blocks;
  assert.match(first, /^OUTCOME: \{build-test-ok \| build-test-failed \| build-test-blocked \| already-shipped \| handoff\}\nNEXT_STEPS: \{[^}\n]*OUTCOME: handoff[^}\n]*\}$/m);
  assert.match(second, /^OUTCOME: \{merged \| armed \| pending-review \| ready-to-merge \| failed \| blocked \| handoff\}\nNEXT_STEPS: \{[^}\n]*OUTCOME: handoff[^}\n]*\}$/m);
});

test('task-prompt.md: a continuation is the same template with its step list replaced by NEXT_STEPS, same run dir and model profile', () => {
  const t = read('task-prompt.md');
  const c = squash(region(t, '## Continuation call', null, 'continuation section'));
  assert.match(c, /`OUTCOME: handoff`/);
  assert.match(c, /same template|that call's own template/i);
  assert.match(c, /step list[^.]*replaced by[^.]*`NEXT_STEPS`/);
  assert.match(c, /same `\{minted-run-dir\}`/);
  assert.match(c, /model profile/);
  assert.match(c, /`capable`[^.]*first call[^.]*`standard`[^.]*second/);
  assert.ok(c.includes(`"${STOP_SENTENCE.split(' --')[0]}"`), 'the section must quote the "Stop after the test gate" sentence it keeps');
  assert.match(c, /resumes? (?:from that step )?onward/);
  assert.match(c, /`two-call-gate\.md` section 8/);
});

test('the first-call continuation substitution: NEXT_STEPS replaces both invocation step lists and the stop sentence survives verbatim', () => {
  const [first, second] = fencedBlocks(read('task-prompt.md'));
  assert.equal(first.split('build,test auto').length - 1, 2, 'the first template must carry its step list on exactly its two invocation lines');
  assert.equal(second.split('review,polish,wrap-up auto').length - 1, 2, 'the second template must carry its step list on exactly its two invocation lines');
  const continuation = first.split('build,test auto').join('test auto');
  assert.ok(!continuation.includes('build,test'), 'no build,test step list may survive the substitution');
  assert.match(continuation, /\/claude-tweaks:flow #\{issue\} test auto`/);
  assert.match(continuation, /\/claude-tweaks:flow "#\{n1\},#\{n2\},\.\.\." test auto`/);
  assert.ok(squash(continuation).includes(STOP_SENTENCE), 'the continuation must keep "Stop after the test gate" verbatim -- it holds a single-step `test` resume to test');
});

test('two-call-gate.md section 2 routes a handoff to section 8, and section 8 states the continuation rule', () => {
  const t = read('two-call-gate.md');
  const g = region(t, '## 2. The gate', '## 5.', 'gate section');
  assert.match(g, /An `OUTCOME` of `handoff` \(#4027\)[^.]*section 8/);
  const s = squash(region(t, '## 8. Continuing a handed-off call', null, 'section 8'));
  assert.match(s, /not a failure/);
  assert.match(s, /no Settle, no `cleanup-only` teardown, no claim release/);
  assert.match(s, /`parseNextSteps\(reply, FIRST_CALL_STEPS\)`/);
  assert.match(s, /`parseNextSteps\(reply, SECOND_CALL_STEPS\)`/);
  assert.match(s, /same `\{minted-run-dir\}`/);
  assert.match(s, /same model profile/);
  assert.match(s, /at most three handoffs per run/i);
  assert.doesNotMatch(s, /continuations per call/i);
  assert.match(s, /\(\{n\} of 3 this run\)/);
  assert.match(s, /fourth handoff in the run[^.]*`build-test-blocked`[^.]*first call[^.]*`blocked`[^.]*second call/);
  assert.match(s, /last continuation's report/);
  assert.match(s, /neither the artifact check nor the stamp read/);
  // code twin: the names the prose cites are the module's exports, and the second call's
  // list the prose spells out is SECOND_CALL_STEPS itself
  assert.equal(typeof gate.parseNextSteps, 'function');
  assert.ok(Array.isArray(gate.FIRST_CALL_STEPS));
  assert.ok(Array.isArray(gate.SECOND_CALL_STEPS));
  assert.ok(s.includes(`\`parseNextSteps(reply, SECOND_CALL_STEPS)\`, the steps a second call can still run (${gate.SECOND_CALL_STEPS.map((x) => `\`${x}\``).join(', ')})`));
});

test('the real bound is the gauge\'s per-run HANDOFF_BOUND: section 8 cites it, context-handoff.md says continue in place at it', () => {
  const { HANDOFF_BOUND } = require('../plugin/bin/lib/timing/context-gauge');
  assert.equal(HANDOFF_BOUND, 3);
  const s = squash(region(read('two-call-gate.md'), '## 8. Continuing a handed-off call', null, 'section 8'));
  assert.match(s, /`HANDOFF_BOUND` \(3, `plugin\/bin\/lib\/timing\/context-gauge\.js`\)/);
  assert.match(s, /`handoffCount`/);
  assert.match(s, /per run, not per call/);
  assert.match(s, /backstop for a misbehaving agent/);
  // the closing Settle-gap note covers only the malformed NEXT_STEPS refusal now
  const note = s.slice(s.indexOf('A handoff refused for a malformed `NEXT_STEPS`'));
  assert.notEqual(note.length, s.length, 'closing note anchor not found');
  assert.match(note, /section 5 item 1's report that cannot be parsed/);
  assert.doesNotMatch(note, /item 1 or 3|bound/);
  const h = squash(readText(path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'context-handoff.md')));
  assert.match(h, /`HANDOFF_BOUND` \(3\) handoffs per run, counted in handoff\.json's `handoffCount`/);
  assert.match(h, /per run, not per call/);
  assert.match(h, /`handoff bound reached \(3 handoffs this run\): continue in place`\. Continue in this agent and never stop/);
});

test('dispatch/SKILL.md: neither the Step 5 gate summary nor the Step 6 catch-all swallows a handoff', () => {
  const t = read('SKILL.md');
  const step5 = squash(region(t, '**The gate between calls', '\n\n', 'Step 5 gate summary'));
  assert.match(step5, /`OUTCOME: handoff`[^.]*`two-call-gate\.md` section 8/);
  const catchAll = squash(region(t, 'On any other `OUTCOME`', '\n', 'Step 6 catch-all'));
  assert.match(catchAll, /A `handoff` is not one of these: continue the call per `two-call-gate\.md` section 8 first/);
});

test('firing-exclusion.md, reporting.md, sequential-execution.md treat a handoff as a continuation, never a failure', () => {
  const fx = squash(read('firing-exclusion.md'));
  assert.match(fx, /`handoff`[^.]*never appended/);
  const rp = squash(read('reporting.md'));
  assert.match(rp, /handed-off call[^.]*continuation[^.]*never a failure/i);
  assert.match(rp, /\(\{n\} of 3 this run\)/);
  const loop = squash(region(read('sequential-execution.md'), '## The loop', '## No per-group timeout', 'loop section'));
  assert.match(loop, /`OUTCOME: handoff` passes this check/);
  assert.match(loop, /last continuation's report/);
});
