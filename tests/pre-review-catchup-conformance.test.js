'use strict';
// tests/pre-review-catchup-conformance.test.js — #4304: pins the prose that wires
// bin/pre-review-catchup.js into /build's SDD dispatch, the _shared procedure file,
// and the registries naming the CLI. The CLI's own behavior is tests/bin-lib/worktree's.
//
// Live prose is read here legitimately: updating these sentences is the intended
// response to a change in the dispatch contract they restate (skill-prose-conformance-tests).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { OUTCOMES } = require('../plugin/bin/lib/worktree/pre-review-catchup');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

const DISPATCH = read('plugin/skills/build/dispatch.md');
// Read inside the tests that use it: a missing file then fails that test alone, not the whole suite.
const readShared = () => read('plugin/skills/_shared/pre-review-catchup.md');
const BUILD_WORKTREE_SETUP = read('plugin/skills/build/worktree-setup.md');
const PLUGIN_STRUCTURE = read('docs/plugin-structure.md');

const CLI_MARKER = 'bin/pre-review-catchup.js';
const SKIP_PATH_MARKER = 'Single-task fast-lane skip (#1926';
const REVIEW_RETURN_MARKER = 'After the final code review completes — or, on the skip path';

// Every marker must exist before positions are compared: indexOf's -1 is below every
// real position, so a reworded marker would otherwise leave the pin green.
function requireOrder(text, markers) {
  let last = -1;
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    assert.notStrictEqual(idx, -1, `marker missing: ${marker}`);
    assert.ok(idx > last, `${marker} must come after the previous marker`);
    last = idx;
  }
}

// The sentence (period-space bounded) that holds the first occurrence of `needle`.
function sentenceContaining(text, needle) {
  const at = text.indexOf(needle);
  assert.notStrictEqual(at, -1, `no sentence names ${needle}`);
  const start = text.lastIndexOf('. ', at) + 1;
  const end = text.indexOf('. ', at);
  return text.slice(start, end === -1 ? undefined : end + 1);
}

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.notStrictEqual(start, -1, `heading missing: ${heading}`);
  const next = text.indexOf('\n## ', start + heading.length);
  return next === -1 ? text.slice(start) : text.slice(start, next);
}

test('AC1.1: dispatch.md runs the catch-up before the whole-branch review', () => {
  requireOrder(DISPATCH, [SKIP_PATH_MARKER, CLI_MARKER, REVIEW_RETURN_MARKER]);
});

test('AC1.1 control: the order helper goes red when the catch-up sentence moves below the return marker', () => {
  const at = DISPATCH.indexOf(CLI_MARKER);
  assert.notStrictEqual(at, -1, 'CLI marker missing from the live text');
  const swapped = DISPATCH.replace(CLI_MARKER, 'bin/other.js') + `\n${CLI_MARKER}`;
  assert.notEqual(swapped, DISPATCH);
  assert.throws(() => requireOrder(swapped, [SKIP_PATH_MARKER, CLI_MARKER, REVIEW_RETURN_MARKER]), /must come after/);
  const absent = DISPATCH.replace(CLI_MARKER, 'bin/other.js');
  assert.notEqual(absent, DISPATCH);
  assert.throws(() => requireOrder(absent, [SKIP_PATH_MARKER, CLI_MARKER, REVIEW_RETURN_MARKER]), /marker missing/);
});

test('AC1.2: the review package base comes from reviewBase', () => {
  assert.ok(DISPATCH.includes('reviewBase'), 'dispatch.md must route the review base through the CLI JSON reviewBase');
});

test('scope: worktree only, current-branch and wave members SKIP', () => {
  assert.ok(DISPATCH.includes('current-branch strategy → fallback: no pre-review catch-up'));
  assert.ok(DISPATCH.includes('MULTISPEC_PARALLEL_WAVE=1'));
  const sentence = sentenceContaining(DISPATCH, CLI_MARKER);
  assert.ok(!sentence.includes('value Common Step 1 resolved'), 'the integration branch is resolved at the call site, not carried from Common Step 1');
  assert.ok(DISPATCH.includes('_shared/integration-branch.md'), 'dispatch.md must route {integration-branch} through the canonical ladder');
});

test('AC3.1: a conflict stops before review', () => {
  assert.ok(DISPATCH.includes('`conflict` → stop'), 'conflict outcome must stop');
  assert.ok(DISPATCH.includes('Never review the pre-merge tree'));
});

test('AC3.1: the CLI shell appends its own decisions.md line through the shared formatter', () => {
  const src = readText(path.join(ROOT, 'plugin/bin/pre-review-catchup.js'));
  assert.ok(/log-decision\/append/.test(src), 'CLI must require log-decision/append');
  assert.ok(src.includes('formatEntry('), 'CLI must call formatEntry(');
});

test('shared file and naming', () => {
  const SHARED = readShared();
  assert.ok(/^# Pre-review Catch-up$/m.test(SHARED), 'shared file title');
  assert.ok(/^## Outcomes$/m.test(SHARED), 'shared file needs an ## Outcomes heading');
  const stepFour = BUILD_WORKTREE_SETUP.split('\n').find((l) => l.startsWith('4. **Catch up with the integration branch**'));
  assert.ok(stepFour, 'build/worktree-setup.md step 4 paragraph not found');
  assert.ok(stepFour.includes('_shared/pre-review-catchup.md'), 'step 4 must name the shared file');
});

test('every outcome is documented', () => {
  assert.equal(OUTCOMES.length, 7, 'OUTCOMES roster size changed — document the new outcome and bump this literal');
  const outcomes = section(readShared(), '## Outcomes');
  const cliLine = PLUGIN_STRUCTURE.split('\n').find((l) => l.includes('pre-review-catchup.js'));
  assert.ok(cliLine, 'docs/plugin-structure.md needs a pre-review-catchup.js line');
  for (const outcome of OUTCOMES) {
    assert.ok(outcomes.includes(`\`${outcome}\``), `_shared/pre-review-catchup.md ## Outcomes must name \`${outcome}\``);
    assert.ok(cliLine.includes(outcome), `docs/plugin-structure.md CLI line must name ${outcome}`);
  }
});
