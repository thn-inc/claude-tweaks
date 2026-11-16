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
  const t = read('continuation-call.md');
  const c = squash(region(t, '# Dispatch Step 5 — Continuation call', null, 'continuation section'));
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

test('#4548: task-prompt.md\'s Continuation call heading points at continuation-call.md', () => {
  assert.match(read('task-prompt.md'), /## Continuation call — after `OUTCOME: handoff` \(#4027\)\n\nRead `continuation-call\.md` in this skill's directory\./);
  // The body moved out: a copy left behind in task-prompt.md would be a second, drifting statement of it.
  assert.doesNotMatch(read('task-prompt.md'), /Every other sentence stays verbatim/);
  assert.match(read('continuation-call.md'), /Every other sentence stays verbatim/);
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

// ---- #4358: a handed-off bundle continues per record ----

const RECORD_TOKEN = 'record-steps=#12:none;#34:test';
const BUNDLE_LINE = '/claude-tweaks:flow "#{n1},#{n2},..."';
const section8 = (t) => squash(region(t, '## 8. Continuing a handed-off call', null, 'section 8'));

const SECOND_RECORD_TOKEN = 'record-steps=#12:none;#34:review,polish,wrap-up';

// Every way a bundle's continuation could lose a record's own step. The controls below hand it
// live text with one piece removed, so a gap this cannot see fails there rather than passing here.
function bundleContinuationGaps({ firstTemplate, secondTemplate, continuationDoc, gateDoc }) {
  const gaps = [];
  const continuedSecond = secondTemplate.split('review,polish,wrap-up auto').join(`${SECOND_RECORD_TOKEN} auto`);
  if (continuedSecond.split(`${SECOND_RECORD_TOKEN} auto`).length - 1 !== 2) gaps.push('second template: the token does not land on both invocation lines');
  if (continuedSecond.replaceAll(SECOND_RECORD_TOKEN, '').includes('review,polish,wrap-up')) gaps.push('second template: a review,polish,wrap-up step list survives the substitution');
  if (!continuedSecond.split('\n').some((l) => l.includes(BUNDLE_LINE) && l.includes(`${SECOND_RECORD_TOKEN} auto`))) {
    gaps.push('second template: the bundle invocation line does not hold the token');
  }
  const continued = firstTemplate.split('build,test auto').join(`${RECORD_TOKEN} auto`);
  if (continued.includes('build,test')) gaps.push('template: a build,test step list survives the substitution');
  if (!squash(continued).includes(STOP_SENTENCE)) gaps.push('template: the stop sentence is gone');
  if (!continued.split('\n').some((l) => l.includes(BUNDLE_LINE) && l.includes(`${RECORD_TOKEN} auto`))) {
    gaps.push('template: the bundle invocation line does not hold the token');
  }
  const c = squash(continuationDoc);
  if (c.includes('record-steps={NEXT_STEPS}')) gaps.push('continuation: substitutes the raw record-steps={NEXT_STEPS}, not the canonical stepArg');
  if (!/take the parse's `stepArg`/.test(c)) gaps.push('continuation: no stepArg');
  if (!/targets unchanged/.test(c)) gaps.push('continuation: targets not held unchanged');
  const s = section8(gateDoc);
  const item1 = s.slice(s.indexOf('1. **Read `NEXT_STEPS`.**'), s.indexOf('2. **Continue.**'));
  const item2 = s.slice(s.indexOf('2. **Continue.**'), s.indexOf('3. **Bound'));
  if (!/`\{ targets \}`/.test(item1)) gaps.push('section 8 item 1: no { targets }');
  if (!/`#N` strings \(`\['#12','#34'\]`\), never bare numbers/.test(item1)) gaps.push('section 8 item 1: targets not spelled as #N strings');
  if (!/flat `NEXT_STEPS` from a bundle fails closed/.test(item1)) gaps.push('section 8 item 1: a flat NEXT_STEPS does not fail closed');
  if (!/`stepArg` is the replacement/.test(item2)) gaps.push('section 8 item 2: stepArg is not the replacement');
  return gaps;
}

const bundleInputs = () => ({
  firstTemplate: fencedBlocks(read('task-prompt.md'))[0],
  secondTemplate: fencedBlocks(read('task-prompt.md'))[1],
  continuationDoc: read('continuation-call.md'),
  gateDoc: read('two-call-gate.md'),
});

test('AC1.4: a bundle\'s continuation takes record-steps= in the step list\'s place, and section 8 fails a flat list closed', () => {
  assert.deepEqual(bundleContinuationGaps(bundleInputs()), []);
});

test('bundleContinuationGaps goes red on each piece a bundle continuation depends on', () => {
  const live = bundleInputs();
  const cases = [
    ['firstTemplate', (t) => `${t}\nfallback step list: build,test\n`, /a build,test step list survives/],
    ['firstTemplate', (t) => t.split('Stop after the test gate').join('Carry on after the test gate'), /stop sentence is gone/],
    ['firstTemplate', (t) => t.split(BUNDLE_LINE).join('/claude-tweaks:flow #{issue}'), /bundle invocation line/],
    ['secondTemplate', (t) => `${t}\nfallback step list: review,polish,wrap-up\n`, /review,polish,wrap-up step list survives/],
    ['secondTemplate', (t) => t.replace('review,polish,wrap-up auto', 'review,polish,wrap-up  auto'), /both invocation lines/],
    ['secondTemplate', (t) => t.split(BUNDLE_LINE).join('/claude-tweaks:flow #{issue}'), /second template: the bundle invocation line/],
    ['continuationDoc', (t) => t.split('the parse\'s `stepArg`').join('`record-steps={NEXT_STEPS}`'), /raw record-steps=/],
    ['continuationDoc', (t) => t.split('`stepArg`').join('value'), /continuation: no stepArg/],
    ['continuationDoc', (t) => t.split('targets unchanged').join('targets recomputed'), /targets not held/],
    ['gateDoc', (t) => t.split('`{ targets }`').join('the records'), /no \{ targets \}/],
    ['gateDoc', (t) => t.split('never bare numbers').join('as numbers'), /#N strings/],
    ['gateDoc', (t) => t.replace(/from a\s+bundle fails closed/, 'from a bundle continues'), /flat NEXT_STEPS/],
    ['gateDoc', (t) => t.split('`stepArg` is the replacement').join('`steps` is the replacement'), /stepArg is not the replacement/],
  ];
  for (const [key, mutate, expected] of cases) {
    const mutated = mutate(live[key]);
    assert.notEqual(mutated, live[key], `control did not change ${key}: ${expected}`);
    const gaps = bundleContinuationGaps({ ...live, [key]: mutated });
    assert.ok(gaps.some((g) => expected.test(g)), `expected ${expected}, got ${JSON.stringify(gaps)}`);
  }
});

test('section 8\'s prose cites what parseNextSteps does: stepArg for a per-record reply, a flat list and bare numbers refused', () => {
  const reply = (v) => `OUTCOME: handoff\nNEXT_STEPS: ${v}\nSTATUS: DONE\n`;
  const targets = ['#12', '#34'];
  const perRecord = gate.parseNextSteps(reply('#12:none;#34:test'), gate.FIRST_CALL_STEPS, { targets });
  assert.equal(perRecord.ok, true);
  assert.match(perRecord.stepArg, /^record-steps=/);
  assert.equal(perRecord.stepArg, RECORD_TOKEN);
  const flat = gate.parseNextSteps(reply('test'), gate.FIRST_CALL_STEPS, { targets });
  assert.equal(flat.ok, false);
  assert.equal(flat.reason, 'next-steps-flat-multi-record');
  assert.equal(gate.parseNextSteps(reply('#12:none;#34:test'), gate.FIRST_CALL_STEPS, { targets: [12, 34] }).ok, false);
  // Why the prose must say to pass them: with no targets a bundle's flat list would be accepted.
  assert.equal(gate.parseNextSteps(reply('test'), gate.FIRST_CALL_STEPS).ok, true);
});

test('task-prompt.md: NEXT_STEPS no longer promises a comma-joined list, since a bundle\'s value is per-record', () => {
  assert.doesNotMatch(read('task-prompt.md'), /comma-joined steps still to run/);
  assert.equal(read('task-prompt.md').split('NEXT_STEPS: {only with OUTCOME: handoff -- the steps still to run; omit otherwise}').length - 1, 2);
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
