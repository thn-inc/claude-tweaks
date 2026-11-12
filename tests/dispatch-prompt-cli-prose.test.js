'use strict';

// Conformance pins for the dispatch-prompt CLI wiring (#4589): SKILL.md Step 5 renders each Task
// prompt with bin/dispatch-prompt.js instead of filling task-prompt.md by hand; task-prompt.md,
// continuation-call.md, two-call-gate.md and resume.md name the CLI; express-prompt.md stays
// hand-substituted.
//
// Waived AC1.2: express-lane prompt out of scope by Decision 2 (#4735).
//
// Reads the live prose: these files are the declared contract, so updating them together with this
// suite is the intended response to a change (skill-prose-conformance-tests). Every presence claim
// has a go-red control (the matching text removed or swapped, the assertion must throw); the ban
// regex is proved against frozen pre-change excerpts beside the live files.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const DISPATCH_DIR = path.join(ROOT, 'plugin/skills/dispatch');
const read = (name) => readText(path.join(DISPATCH_DIR, name));
const SKILL = read('SKILL.md');
const TASK_PROMPT = read('task-prompt.md');
const GATE = read('two-call-gate.md');
const RESUME = read('resume.md');
const CONT = read('continuation-call.md');
const EXPRESS = read('express-prompt.md');

function region(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  assert.notStrictEqual(s, -1, `marker not found: ${startMarker}`);
  const e = text.indexOf(endMarker, s + startMarker.length);
  assert.notStrictEqual(e, -1, `end marker not found: ${endMarker}`);
  return text.slice(s, e);
}

const step5 = region(SKILL, '### Step 5:', '\n### Step 6');

function assertIncludesAll(text, needles, label) {
  for (const n of needles) assert.ok(text.includes(n), `${label}: missing ${JSON.stringify(n)}`);
}

function assertStep5(text) {
  assertIncludesAll(text, [
    'bin/dispatch-prompt.js" --call first|second --run "{minted-run-dir}" --issues',
    // Two code spans on purpose: context-cost.js reads a one-span `compose-context.js --phase` as a call site with no phase value.
    '`compose-context.js` `--phase` line before each render',
    'the `--headless` decision',
    'the #3212 model log after the first call',
    '`cat` each envelope `chunks` file with one plain command',
    'joined by one newline',
    'profile.model',
    'never paraphrase, summarize or fill it by hand',
    'resend it unchanged, once',
  ], 'SKILL.md Step 5');
  assert.ok(
    TASK_PROMPT.includes('**Before running `dispatch-prompt.js` for a call, compose that call\'s phase**'),
    'task-prompt.md compose paragraph trigger missing',
  );
}

test('AC1.1: Step 5 renders each Task prompt with dispatch-prompt.js and forbids hand substitution', () => {
  assertStep5(step5);
});

test('AC1.1 go-red: Step 5 without the CLI name fails the assertion', () => {
  assert.throws(() => assertStep5(step5.split('dispatch-prompt.js').join('x.js')));
});

test('AC2.1: a non-zero exit or a second deny blocks the group through the terminal path', () => {
  const sec2 = region(GATE, '## 2.', '## 5.');
  assertIncludesAll(sec2, [
    '`dispatch-prompt.js` exits non-zero',
    'one unchanged resend',
    'never dispatched',
    'REFUSED',
    'section 5',
    'section 6',
  ], 'two-call-gate.md section 2');
  assert.ok(step5.includes('`two-call-gate.md`\'s terminal path'), 'Step 5 must cite the terminal path');
  assert.ok(!GATE.slice(GATE.indexOf('## 5.')).startsWith(sec2), 'control: region excludes section 5');
});

// The hand-substitution fallback ban, with frozen pre-change controls the regex must match.
const BAN = /copy (that call's|each) fenced block by hand|fill(ed)? (it|the template) by hand instead|Copy each fenced block below exactly|inline each call's content verbatim/i;
const FROZEN_BANNED = [
  'on a non-zero exit, copy that call\'s fenced block by hand per task-prompt.md instead',
  'Copy each fenced block below exactly, substituting `{issue list}`, `{minted-run-dir}`',
  'read it and inline each call\'s content verbatim into its own `Task()` tool call',
];

test('AC2.1: no hand-substitution fallback survives', () => {
  for (const frozen of FROZEN_BANNED) {
    assert.match(frozen, BAN, `ban regex must match the frozen pre-change text: ${frozen}`);
  }
  const files = { 'SKILL.md': SKILL, 'task-prompt.md': TASK_PROMPT, 'two-call-gate.md': GATE, 'resume.md': RESUME, 'continuation-call.md': CONT };
  for (const [name, text] of Object.entries(files)) {
    assert.doesNotMatch(text, BAN, `${name} still carries a hand-substitution instruction`);
    assert.match(`${text}\n${FROZEN_BANNED[0]}`, BAN, `${name}: control — appending a banned sentence must trip the ban`);
  }
});

test('task-prompt.md names the CLI as the renderer of its fenced blocks', () => {
  const opening = TASK_PROMPT.slice(0, TASK_PROMPT.indexOf('\n## '));
  assertIncludesAll(opening, ['dispatch-prompt.js', 'only template source'], 'task-prompt.md opening');
  const paras = TASK_PROMPT.split('\n\n');
  const headless = paras.find((p) => p.startsWith('**Before substituting this template**'));
  assert.ok(headless, 'headless paragraph missing');
  assert.ok(headless.includes('--headless'), 'headless paragraph must name --headless');
  const resume = paras.find((p) => p.startsWith('**Resume (#4588).**'));
  assert.ok(resume, 'resume paragraph missing');
  assert.ok(resume.includes('--resume-verdict'), 'resume paragraph must name --resume-verdict');
  assert.throws(() => assertIncludesAll(opening.split('only template source').join('x'), ['only template source'], 'control'));
});

test('continuation-call.md renders the continuation with --next-steps', () => {
  assertIncludesAll(CONT, [
    'dispatch-prompt.js',
    '--next-steps "{NEXT_STEPS}"',
    '`--resume-verdict` and `--selected-at`, unchanged',
  ], 'continuation-call.md');
  const item2 = region(GATE, '2. **Continue.**', '\n3.');
  assert.ok(item2.includes('dispatch-prompt.js --next-steps'), 'two-call-gate.md section 8 item 2 must name the CLI');
});

test('resume.md Step 7 renders the first call with --resume-verdict', () => {
  const step7 = region(RESUME, '**Step 7 — Dispatch the two calls.**', '\n\n');
  assertIncludesAll(step7, ['dispatch-prompt.js --resume-verdict', '--selected-at unknown'], 'resume.md Step 7');
  assert.ok(!step7.includes('substitute `{resume-context}`'), 'Step 7 must not tell the session to substitute by hand');
});

test('express-prompt.md says its placeholders stay hand-substituted', () => {
  const line3 = EXPRESS.split('\n').find((l) => l.startsWith('Referenced by'));
  assert.ok(line3, 'express-prompt.md line 3 missing');
  assertIncludesAll(line3, ['substituted by hand', '#4735'], 'express-prompt.md line 3');
});

test('the CLI file named in prose exists', () => {
  assert.ok(fs.statSync(path.join(ROOT, 'plugin/bin/dispatch-prompt.js')).isFile());
});
