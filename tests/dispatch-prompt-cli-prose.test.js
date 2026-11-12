'use strict';

// Conformance pins for the dispatch-prompt CLI wiring (#4589): SKILL.md Step 5 renders each Task
// prompt with bin/dispatch-prompt.js instead of filling task-prompt.md by hand; task-prompt.md,
// continuation-call.md, two-call-gate.md and resume.md name the CLI; express-prompt.md stays
// hand-substituted; a first call that never dispatched skips its claim release (#4589).
//
// Waived AC1.2: express-lane prompt out of scope by Decision 2 (#4735).
//
// Reads the live prose: these files are the declared contract, so updating them together with this
// suite is the intended response to a change (skill-prose-conformance-tests). Go-red controls:
// the Step 5 assertions, the section 2 mapping and the new skip phrase each have a control that
// must throw (a removed or swapped copy); the hand-substitution ban and resume.md's negative check
// are proved against frozen pre-change excerpts copied from commit f3f076dc0. The ban has two
// forward-looking alternatives (`copy ... fenced block by hand`, `fill ... by hand instead`) that
// match nothing in f3f076dc0, so their controls are synthetic and labelled as such; and the ban's
// copies in two-call-gate.md, resume.md and continuation-call.md have no pre-change text to freeze
// (those files never carried a banned phrase) — they are covered by the shared regex only.

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
const SECTION_E = readText(path.join(ROOT, 'plugin/skills/wrap-up/cleanup-procedures-execution.md'));
const FLAGS = readText(path.join(ROOT, 'plugin/skills/wrap-up/flags.md'));

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

// Section 2's mapping phrase: which terminal section a call that never dispatched takes.
const MAPPING = 'a first call or its continuation goes to section 5, a second call or its continuation to section 6';
function assertSection2(sec2) {
  assertIncludesAll(sec2, [
    '`dispatch-prompt.js` exits non-zero',
    'one unchanged resend',
    'never dispatched',
    'REFUSED',
    MAPPING,
  ], 'two-call-gate.md section 2');
}

test('AC2.1: a non-zero exit or a second deny blocks the group through the terminal path', () => {
  const sec2 = region(GATE, '## 2.', '## 5.');
  assertSection2(sec2);
  assert.ok(step5.includes('`two-call-gate.md`\'s terminal path'), 'Step 5 must cite the terminal path');
});

test('AC2.1 go-red: a swapped section mapping, or a missing paragraph, fails the section 2 assertion', () => {
  const sec2 = region(GATE, '## 2.', '## 5.');
  const swapped = sec2.replace(MAPPING, 'a first call or its continuation goes to section 6, a second call or its continuation to section 5');
  assert.notStrictEqual(swapped, sec2, 'the swap control must change the text');
  assert.throws(() => assertSection2(swapped), /missing/);
  // The pre-change section 2 (f3f076dc0) had no such paragraph: its first paragraph alone.
  const frozen = 'Dispatch the second call only if the first call\'s status line was `DONE` or `DONE_WITH_CONCERNS` **and** its `OUTCOME` was `build-test-ok`.';
  assert.throws(() => assertSection2(frozen), /missing/);
});

// The hand-substitution fallback ban. FROZEN_* are verbatim excerpts of commit f3f076dc0.
const BAN = /copy (that call's|each) fenced block by hand|fill(ed)? (it|the template) by hand instead|Copy each fenced block below exactly|inline each call's content verbatim/i;
const FROZEN_SKILL = 'read it and inline each call\'s content verbatim into its own `Task()` tool call';
const FROZEN_TASK_PROMPT = 'Copy each fenced block below exactly, substituting `{issue list}`, `{minted-run-dir}`, `{plugin-root}`, `{context-pack}`, etc. as SKILL.md\'s Step 5 directs.';
// Synthetic (no such text exists in f3f076dc0): the two forward-looking alternatives.
const SYNTHETIC_FALLBACKS = [
  'on a non-zero exit, copy that call\'s fenced block by hand per task-prompt.md instead',
  'fill the template by hand instead',
];

test('AC2.1: no hand-substitution fallback survives (ban + positive twin, proved per copy)', () => {
  // Ban controls: the regex matches each real pre-change copy, so it can go red on the live copy.
  assert.match(FROZEN_SKILL, BAN);
  assert.match(FROZEN_TASK_PROMPT, BAN);
  for (const s of SYNTHETIC_FALLBACKS) assert.match(s, BAN, `synthetic control: ${s}`);
  // The live copies: SKILL.md and task-prompt.md carried the banned wording at f3f076dc0 and no longer do.
  assert.ok(SKILL.length > 0 && !BAN.test(SKILL), 'SKILL.md still carries a hand-substitution instruction');
  assert.ok(!BAN.test(TASK_PROMPT), 'task-prompt.md still carries a hand-substitution instruction');
  // Never carried a banned phrase at f3f076dc0; covered by the shared regex only.
  for (const [name, text] of Object.entries({ 'two-call-gate.md': GATE, 'resume.md': RESUME, 'continuation-call.md': CONT })) {
    assert.ok(!BAN.test(text), `${name} carries a hand-substitution instruction`);
  }
  // Positive twin per copy: the CLI is what each file names instead.
  assert.ok(SKILL.includes('dispatch-prompt.js'), 'SKILL.md positive twin');
  assert.ok(TASK_PROMPT.includes('`bin/dispatch-prompt.js` renders each call\'s prompt'), 'task-prompt.md positive twin');
  assert.ok(RESUME.includes('dispatch-prompt.js --resume-verdict'), 'resume.md positive twin');
  assert.ok(CONT.includes('dispatch-prompt.js'), 'continuation-call.md positive twin');
  assert.ok(GATE.includes('`dispatch-prompt.js` exits non-zero'), 'two-call-gate.md positive twin');
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
  assert.throws(() => assertIncludesAll(headless.split('--headless').join('x'), ['--headless'], 'control'));
  assert.throws(() => assertIncludesAll(resume.split('--resume-verdict').join('x'), ['--resume-verdict'], 'control'));
});

test('continuation-call.md renders the continuation with --next-steps', () => {
  const NEEDLES = ['dispatch-prompt.js', '--next-steps "{NEXT_STEPS}"', '`--resume-verdict` and `--selected-at`, unchanged'];
  assertIncludesAll(CONT, NEEDLES, 'continuation-call.md');
  assert.throws(() => assertIncludesAll(CONT.split('--next-steps "{NEXT_STEPS}"').join('x'), NEEDLES, 'control'));
  const item2 = region(GATE, '2. **Continue.**', '\n3.');
  assert.ok(item2.includes('dispatch-prompt.js --next-steps'), 'two-call-gate.md section 8 item 2 must name the CLI');
  assert.ok(!item2.split('dispatch-prompt.js --next-steps').join('x').includes('dispatch-prompt.js --next-steps'), 'control');
});

// resume.md Step 7, verbatim from f3f076dc0 (the hand-substitution wording this task retires).
const FROZEN_RESUME_STEP7 = 'On the first call only, add `RESUME_PR="{prUrl}" ` immediately before `/claude-tweaks:flow` and substitute `{resume-context}` from the CLI\'s `context`; never add `DISPATCH_HEADLESS=1 `';
function assertResumeStep7(step7) {
  assertIncludesAll(step7, ['dispatch-prompt.js --resume-verdict', '--selected-at unknown', 'session-tmp-resolve.js'], 'resume.md Step 7');
  assert.ok(!step7.includes('substitute `{resume-context}`'), 'Step 7 must not tell the session to substitute by hand');
}

test('resume.md Step 7 renders the first call with --resume-verdict', () => {
  const step7 = region(RESUME, '**Step 7 — Dispatch the two calls.**', '\n\n');
  assertResumeStep7(step7);
  // Go-red: the frozen pre-change sentence, put in place of the live one, fails both ways.
  assert.throws(() => assertResumeStep7(`**Step 7 — Dispatch the two calls.** ${FROZEN_RESUME_STEP7}`), /missing|substitute/);
});

test('express-prompt.md says its placeholders stay hand-substituted', () => {
  const line3 = EXPRESS.split('\n').find((l) => l.startsWith('Referenced by'));
  assert.ok(line3, 'express-prompt.md line 3 missing');
  assertIncludesAll(line3, ['substituted by hand', '#4735'], 'express-prompt.md line 3');
  assert.throws(() => assertIncludesAll(line3.split('substituted by hand').join('x'), ['substituted by hand'], 'control'));
});

// A first call that never dispatched ran no /flow Step 2.8, so its teardown must not release a claim.
const SKIP = 'prompt-not-dispatched: skip the claim release';
test('a first call that never dispatched skips the claim release (#4589)', () => {
  const sec2 = region(GATE, '## 2.', '## 5.');
  assert.ok(sec2.includes(`\`(${SKIP})\``), 'section 2 must name the parenthetical');
  assert.ok(sec2.includes('not its continuation, which holds a claim'), 'section 2 must exclude a continuation');
  const sec5 = region(GATE, '## 5.', '## 6.');
  const para = sec5.split('\n').find((l) => l.trim().startsWith('**Prompt not dispatched (#4589).**'));
  assert.ok(para, 'section 5 paragraph missing');
  assertIncludesAll(para, [`\`(${SKIP})\``, 'not its continuation, not a second call', 'Section E skips its release'], 'section 5 paragraph');
  assert.ok(!region(GATE, '## 6.', '## 7.').includes(SKIP), 'a second call (section 6) must not append it');
  assert.ok(SECTION_E.includes(`**Skip it too when the invocation names \`${SKIP}\` (#4589)**`), 'Section E clause missing');
  assert.ok(FLAGS.includes(`\`(${SKIP})\` (#4589)`), 'flags.md must declare the phrase');
  // Go-red: the pre-change text (f3f076dc0) carried none of these; removing the phrase fails each place.
  for (const text of [GATE, SECTION_E, FLAGS]) {
    assert.notStrictEqual(text.split(SKIP).join(''), text, 'control must change the text');
  }
});

test('the CLI file named in prose exists', () => {
  assert.ok(fs.statSync(path.join(ROOT, 'plugin/bin/dispatch-prompt.js')).isFile());
});
