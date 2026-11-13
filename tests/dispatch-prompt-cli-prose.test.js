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
  assert.ok(TASK_PROMPT.includes('\n## Context pack (#1542 — resolved once by `dispatch-prompt.js` for both calls)\n'),
    'the Context pack heading must name the CLI, not a hand substitution');
  const paras = TASK_PROMPT.split('\n\n');
  const headless = paras.find((p) => p.startsWith('**Before rendering this template**'));
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
  const assertItem2 = (text) => assertIncludesAll(text, ['dispatch-prompt.js --next-steps'], 'two-call-gate.md section 8 item 2');
  assertItem2(item2);
  // Go-red: the pre-change item 2 (f3f076dc0) named no CLI; a copy with the CLI call removed fails.
  assert.throws(() => assertItem2(item2.split('dispatch-prompt.js --next-steps').join('the template with')), /missing/);
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
const SECTION_E_CLAUSE = `**Skip it too when the invocation names \`${SKIP}\` (#4589)**`;
// The exclusion both sections state: a continuation, and an escalated express run's first call
// (_shared/express-lane.md's Escalation keeps the express claim), already hold a claim.
const SEC2_EXCLUSION = 'not its continuation, and not an escalated express run\'s first call, both of which hold a claim';
const SEC5_EXCLUSION = 'not its continuation, not an escalated express run\'s first call, whose claim the express lane took, not a second call';

function assertSkipPhrase(gate, sectionE, flags) {
  const sec2 = region(gate, '## 2.', '## 5.');
  assert.ok(sec2.includes(`\`(${SKIP})\``), 'section 2 must name the parenthetical');
  assert.ok(sec2.includes(SEC2_EXCLUSION), 'section 2 must exclude a continuation and an escalated express first call');
  const sec5 = region(gate, '## 5.', '## 6.');
  const para = sec5.split('\n').find((l) => l.trim().startsWith('**Prompt not dispatched (#4589).**'));
  assert.ok(para, 'section 5 paragraph missing');
  assertIncludesAll(para, [`\`(${SKIP})\``, SEC5_EXCLUSION, 'Section E skips its release'], 'section 5 paragraph');
  assert.ok(!region(gate, '## 6.', '## 7.').includes(SKIP), 'a second call (section 6) must not append it');
  assert.ok(sectionE.includes(SECTION_E_CLAUSE), 'Section E clause missing');
  assert.ok(flags.includes(`\`(${SKIP})\` (#4589)`), 'flags.md must declare the phrase');
}

test('a first call that never dispatched skips the claim release (#4589)', () => {
  assertSkipPhrase(GATE, SECTION_E, FLAGS);
  // Go-red: the pre-change text (f3f076dc0) carried none of these; removing the phrase from any one
  // file fails the assertion.
  const drop = (text) => {
    const out = text.split(SKIP).join('');
    assert.notStrictEqual(out, text, 'control must change the text');
    return out;
  };
  assert.throws(() => assertSkipPhrase(drop(GATE), SECTION_E, FLAGS), /parenthetical|section 5/);
  assert.throws(() => assertSkipPhrase(GATE, drop(SECTION_E), FLAGS), /Section E clause missing/);
  assert.throws(() => assertSkipPhrase(GATE, SECTION_E, drop(FLAGS)), /flags\.md must declare/);
  // Go-red: the pre-B1 exclusion (a continuation only) fails both sections.
  const narrowed2 = GATE.split(SEC2_EXCLUSION).join('not its continuation, which holds a claim');
  assert.notStrictEqual(narrowed2, GATE);
  assert.throws(() => assertSkipPhrase(narrowed2, SECTION_E, FLAGS), /escalated express/);
  const narrowed5 = GATE.split(SEC5_EXCLUSION).join('not its continuation, not a second call');
  assert.notStrictEqual(narrowed5, GATE);
  assert.throws(() => assertSkipPhrase(narrowed5, SECTION_E, FLAGS), /section 5 paragraph/);
});

function requireOrder(text, markers) {
  let last = -1;
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    assert.notStrictEqual(idx, -1, `marker missing: ${marker}`);
    assert.ok(idx > last, `${marker} must come after the previous marker`);
    last = idx;
  }
}

test('the Section E skip clause sits inside Section E, before the record is identified (#4589)', () => {
  const MARKERS = [
    '## E. Issue claim release',
    'Skip this whole section when the invocation names `claim-permission-denied',
    SECTION_E_CLAUSE,
    'This spec\'s record is identified whenever this section runs',
  ];
  requireOrder(SECTION_E, MARKERS);
  // Go-red: the clause moved after Section E's record-identification paragraph fails the order.
  const lines = SECTION_E.split('\n');
  const at = lines.findIndex((l) => l.startsWith(SECTION_E_CLAUSE));
  assert.notStrictEqual(at, -1);
  const [clause] = lines.splice(at, 1);
  const moved = `${lines.join('\n')}\n${clause}\n`;
  assert.throws(() => requireOrder(moved, MARKERS), /must come after/);
});

test('the CLI file named in prose exists', () => {
  assert.ok(fs.statSync(path.join(ROOT, 'plugin/bin/dispatch-prompt.js')).isFile());
});

// #5255: a dispatch-prompt.js non-zero exit ends the firing, for any call; a denied-twice call does
// not. All of this prose is new in the same change, so each control mutates the live text in
// memory and matches the throw to its own assertion's message (skill-prose-conformance-tests).
const RENDER_PARA = '**A prompt that does not render, or is denied twice (#4589).**';
const SEC2_STOP_LEAD = '**A render failure ends the firing (#5255).**';
const SEC2_ANY_CALL = 'for any call (a first call, a second call, or a continuation of either)';
const SEC2_STOP = 'ends the firing once that group\'s section 5 or section 6 cleanup call returns';
const SEC2_DENIED = 'A denied-twice call does not end the firing: the fault is in that one call, so the firing goes on to the next group.';
const SEC5_STOP = 'On a render failure the firing then ends (section 2\'s render-failure stop)';
const SEC5_DENIED = 'on a denied-twice call it goes on to the next group.';
const SEC6_LEAD = '**Render-failure stop (#5255).**';
const SEC6_STOP = 'the firing ends once it returns (`SKILL.md`\'s Render-failure stop)';
const NONE_AFTER = 'none after a Claim permission stop';
const NONE_AFTER_BOTH = 'none after a Claim permission stop or a render-failure stop';

// Replace `needle` inside the one paragraph starting with `lead`, so a phrase another paragraph
// shares (the Claim permission stop's own wording) cannot satisfy the control.
function mutateInParagraph(text, lead, needle, replacement) {
  const paras = text.split('\n\n');
  const i = paras.findIndex((p) => p.startsWith(lead));
  assert.notStrictEqual(i, -1, `paragraph not found: ${lead}`);
  paras[i] = paras[i].replace(needle, replacement);
  const out = paras.join('\n\n');
  assert.notStrictEqual(out, text, `control must change the text: ${needle}`);
  return out;
}

function section2Para(gate) {
  const para = region(gate, '## 2.', '## 5.').split('\n\n').find((p) => p.startsWith(RENDER_PARA));
  assert.ok(para, 'section 2: render-failure paragraph missing');
  return para;
}
function section5Para(gate) {
  const para = region(gate, '## 5.', '## 6.').split('\n').find((l) => l.trim().startsWith('**Prompt not dispatched (#4589).**'));
  assert.ok(para, 'section 5: Prompt not dispatched paragraph missing');
  return para;
}

function assertRenderFailureStop(gate) {
  const para = section2Para(gate);
  assert.ok(para.includes(SEC2_STOP_LEAD), 'section 2: render-failure stop sentence missing');
  assert.ok(para.includes(SEC2_ANY_CALL), 'section 2: any-call scope missing');
  assert.ok(para.includes(SEC2_STOP), 'section 2: ends-the-firing clause missing');
  assert.ok(section5Para(gate).includes(SEC5_STOP), 'section 5: render-failure stop clause missing');
  const sec6 = region(gate, '## 6.', '## 7.').split('\n\n').find((p) => p.startsWith(SEC6_LEAD));
  assert.ok(sec6 && sec6.includes(SEC6_STOP), 'section 6: render-failure stop paragraph missing');
  // Every "none after a Claim permission stop" clause names the render-failure stop too.
  const clauses = gate.split(NONE_AFTER).length - 1;
  assert.ok(clauses >= 2, 'expected at least two none-after clauses');
  assert.strictEqual(gate.split(NONE_AFTER_BOTH).length - 1, clauses, 'a none-after clause does not name the render-failure stop');
}

// Clause sweep: no clause naming a denied-twice call says the firing ends (unless it negates that),
// and no `(none after ...)` parenthetical names one. Matches denied-twice / denied twice only, never
// bare "denied", so `claim-permission-denied` cannot trip it. Splits on . ; : followed by whitespace
// (so `two-call-gate.md` stays whole) and on paragraph breaks.
const SWEEP_GATE_MESSAGE = 'two-call-gate.md: a denied-twice clause says the firing ends';
const SWEEP_SKILL_MESSAGE = 'SKILL.md Render-failure stop: a denied-twice clause says the firing ends';
// Both word orders and both verbs: "ends/stops the firing" and "the firing (then) ends/stops".
const FIRING_ENDS = /\b((end|ends|ended|stop|stops|stopped) the firing|the firing (then )?(ends|ended|stops|stopped))\b/i;
const FIRING_ENDS_NEGATED = /does not end the firing|is not this stop/i;
function assertNoDeniedTwiceEnd(text, message) {
  for (const clause of text.split(/[.;:](?=\s|$)|\n\s*\n/)) {
    if (/denied[- ]twice/i.test(clause) && FIRING_ENDS.test(clause) && !FIRING_ENDS_NEGATED.test(clause)) assert.fail(message);
  }
  for (const m of text.matchAll(/\(none after [^)]*\)/g)) {
    if (/denied/i.test(m[0])) assert.fail(message);
  }
}

function assertDeniedTwiceContinues(gate) {
  const para = section2Para(gate);
  assert.ok(para.includes(SEC2_DENIED), 'section 2: denied-twice continuation missing');
  const start = para.indexOf(SEC2_STOP_LEAD);
  const end = para.indexOf(SEC2_DENIED);
  assert.ok(start !== -1 && end > start, 'section 2: the stop sentence must precede the denied-twice sentence');
  assert.ok(!/denied/i.test(para.slice(start, end)), 'section 2: the render-failure stop sentence must not cover a denied-twice call');
  assert.ok(section5Para(gate).includes(SEC5_DENIED), 'section 5: denied-twice continuation missing');
  assertNoDeniedTwiceEnd(gate, SWEEP_GATE_MESSAGE);
}

test('AC1.1, AC5.1: a render failure for any call ends the firing after its section 5 or 6 cleanup (#5255)', () => {
  assertRenderFailureStop(GATE);
});

test('AC5.1 go-red: removing the ends-the-firing sentence, or any one clause, fails its own assertion (#5255)', () => {
  const para = section2Para(GATE);
  const start = para.indexOf(SEC2_STOP_LEAD);
  const end = para.indexOf(SEC2_DENIED);
  assert.ok(start !== -1 && end > start, 'the stop sentence must precede the denied-twice sentence');
  const reverted = GATE.replace(para.slice(start, end), '');
  assert.notStrictEqual(reverted, GATE);
  assert.throws(() => assertRenderFailureStop(reverted), { message: 'section 2: render-failure stop sentence missing' });
  for (const [needle, message] of [
    [SEC2_ANY_CALL, 'section 2: any-call scope missing'],
    [SEC2_STOP, 'section 2: ends-the-firing clause missing'],
    [SEC5_STOP, 'section 5: render-failure stop clause missing'],
    [SEC6_STOP, 'section 6: render-failure stop paragraph missing'],
  ]) {
    const mutated = GATE.replace(needle, 'x');
    assert.notStrictEqual(mutated, GATE);
    assert.throws(() => assertRenderFailureStop(mutated), { message });
  }
  const narrowed = GATE.replace(NONE_AFTER_BOTH, NONE_AFTER);
  assert.notStrictEqual(narrowed, GATE);
  assert.throws(() => assertRenderFailureStop(narrowed), { message: /a none-after clause does not name the render-failure stop/ });
});

test('AC1.1, AC6.1: a denied-twice call still ends only its own group (#5255)', () => {
  assertDeniedTwiceContinues(GATE);
});

test('AC6.1 go-red: making the denied-twice path end the firing fails the assertion (#5255)', () => {
  const sec2 = GATE.replace(SEC2_DENIED, 'A denied-twice call ends the firing too.');
  assert.notStrictEqual(sec2, GATE);
  assert.throws(() => assertDeniedTwiceContinues(sec2), { message: 'section 2: denied-twice continuation missing' });
  const sec5 = GATE.replace(SEC5_DENIED, 'on a denied-twice call it ends the firing too.');
  assert.notStrictEqual(sec5, GATE);
  assert.throws(() => assertDeniedTwiceContinues(sec5), { message: 'section 5: denied-twice continuation missing' });
  // Widening the stop sentence to cover a denied-twice call, with both continuation sentences left in place.
  const widened = GATE.replace('A `dispatch-prompt.js` non-zero exit, for any call', 'A `dispatch-prompt.js` non-zero exit or a denied-twice call, for any call');
  assert.notStrictEqual(widened, GATE);
  assert.throws(() => assertDeniedTwiceContinues(widened), { message: 'section 2: the render-failure stop sentence must not cover a denied-twice call' });
  // The whole-file clause sweep: a denied-twice call made to end the firing anywhere in the file, with
  // both continuation sentences left intact, fails the sweep's own message.
  const SWEEP = { message: SWEEP_GATE_MESSAGE };
  for (const [name, mutated] of [
    ['M2: a sentence after the section 2 continuation', GATE.replace(SEC2_DENIED, `${SEC2_DENIED} A denied-twice call then ends the firing too.`)],
    ['M3: a sentence after the section 5 continuation', GATE.replace(SEC5_DENIED, `${SEC5_DENIED} After a denied-twice call the firing ends.`)],
    ['M4: a new section 6 paragraph', GATE.replace(`${SEC6_LEAD} When this path`, `**Denied-twice stop.** When the second call was denied twice, the firing ends once item 1's call returns.\n\n${SEC6_LEAD} When this path`)],
    ['M5: a none-after clause widened', GATE.split(NONE_AFTER_BOTH).join(`${NONE_AFTER_BOTH} or a denied-twice call`)],
    ['M6: "the firing stops" wording after the section 2 continuation', GATE.replace(SEC2_DENIED, `${SEC2_DENIED} After a denied-twice call the firing stops.`)],
  ]) {
    assert.notStrictEqual(mutated, GATE, `control must change the text: ${name}`);
    assert.throws(() => assertDeniedTwiceContinues(mutated), SWEEP, name);
  }
});

test('task-prompt.md says a render failure ends the firing (#5255)', () => {
  const NEEDLE = 'a render failure blocks the group and ends the firing (`two-call-gate.md` §2)';
  const check = (text) => assert.ok(text.includes(NEEDLE), 'task-prompt.md: render failure must end the firing');
  check(TASK_PROMPT);
  assert.throws(() => check(TASK_PROMPT.replace(' and ends the firing', '')), { message: 'task-prompt.md: render failure must end the firing' });
});

// SKILL.md: the stop's own paragraph, and every other line naming the Claim permission stop
// (each is a list of firing-ending exits) names the render-failure stop too.
const SKILL_STOP_LEAD = '**Render-failure stop (#5255).**';
const SKILL_STOP_FACTS = [
  'stops the firing in every selection form once that group\'s cleanup call returns',
  'attempt no further group',
  'any named records after it as not attempted',
  'A headless firing (one that passes `--headless`, `task-prompt.md`) also sends one `PushNotification` naming the record and the stderr line.',
  'A denied-twice call is not this stop.',
  // The trigger. It overlaps the first fact, so a dropped fact reports the first missing one.
  'A `dispatch-prompt.js` non-zero exit for any call (`two-call-gate.md` §2) stops the firing',
];
function assertSkillStop(skill) {
  const para = skill.split('\n\n').find((p) => p.startsWith(SKILL_STOP_LEAD));
  assert.ok(para, 'SKILL.md: Render-failure stop paragraph missing');
  for (const f of SKILL_STOP_FACTS) assert.ok(para.includes(f), `SKILL.md Render-failure stop: missing ${JSON.stringify(f)}`);
  assertNoDeniedTwiceEnd(para, SWEEP_SKILL_MESSAGE);
  const lists = skill.split('\n').filter((l) => l.includes('Claim permission stop') && !l.startsWith('**Claim permission stop (#4899).**'));
  assert.ok(lists.length >= 4, `expected at least four firing-ending exit lists, found ${lists.length}`);
  for (const l of lists) {
    assert.ok(/render-failure stop/i.test(l), `SKILL.md exit list does not name the render-failure stop: ${l.slice(0, 80)}`);
    assert.ok(!/\bnot (a |the )?render-failure stop/i.test(l), `SKILL.md exit list negates the render-failure stop: ${l.slice(0, 80)}`);
  }
}

test('AC2.1: SKILL.md carries the Render-failure stop paragraph and every exit list names it (#5255)', () => {
  assertSkillStop(SKILL);
});

test('AC2.1 go-red: a dropped fact or an exit list without the stop fails its own assertion (#5255)', () => {
  for (const f of SKILL_STOP_FACTS) {
    const mutated = mutateInParagraph(SKILL, SKILL_STOP_LEAD, f, 'x');
    const para = mutated.split('\n\n').find((p) => p.startsWith(SKILL_STOP_LEAD));
    const firstMissing = SKILL_STOP_FACTS.find((g) => !para.includes(g));
    assert.ok(firstMissing, 'the mutation must drop at least one fact');
    assert.throws(() => assertSkillStop(mutated), { message: `SKILL.md Render-failure stop: missing ${JSON.stringify(firstMissing)}` });
  }
  const unlisted = SKILL.replace('or a Claim permission stop or Render-failure stop ends the firing', 'or a Claim permission stop ends the firing');
  assert.notStrictEqual(unlisted, SKILL);
  assert.throws(() => assertSkillStop(unlisted), { message: /SKILL\.md exit list does not name the render-failure stop/ });
  // M6: the stop's trigger widened to a denied-twice call, with every pinned fact left in place.
  const TRIGGER = SKILL_STOP_FACTS[SKILL_STOP_FACTS.length - 1];
  const widened = mutateInParagraph(SKILL, SKILL_STOP_LEAD, TRIGGER, `A denied-twice call, like ${TRIGGER}`);
  assert.throws(() => assertSkillStop(widened), { message: SWEEP_SKILL_MESSAGE });
  // F7: an exit list that names the stop only to negate it.
  const negated = SKILL.split('\n').find((l) => l.includes('the Claim permission stop, a queue-pull'));
  assert.ok(negated && /render-failure stop/i.test(negated), 'the control line must already name the render-failure stop');
  const negatedSkill = SKILL.replace(negated, `${negated}, but not a render-failure stop`);
  assert.notStrictEqual(negatedSkill, SKILL);
  assert.throws(() => assertSkillStop(negatedSkill), { message: /SKILL\.md exit list negates the render-failure stop/ });
});

// firing-exclusion.md, sequential-execution.md, next-ranking.md: each names the stop where it
// names the Claim permission stop as ending the firing.
const FIRING_EXCLUSION_STOP = 'A render-failure stop ends the firing too (`SKILL.md`\'s Render-failure stop, #5255), so no next iteration runs after it either.';
const SEQUENTIAL_STOP = '(none after a Claim permission stop or a render-failure stop: the firing ends, `SKILL.md`)';
const NEXT_RANKING_STOP = 'or a render-failure stop never reaches this filter: each ends the firing';
function assertSiblingStops(files) {
  assert.ok(files.exclusion.includes(FIRING_EXCLUSION_STOP), 'firing-exclusion.md: render-failure stop missing');
  assert.ok(files.sequential.includes(SEQUENTIAL_STOP), 'sequential-execution.md: render-failure stop missing');
  assert.ok(files.ranking.includes(NEXT_RANKING_STOP), 'next-ranking.md: render-failure stop missing');
}
const SIBLINGS = { exclusion: read('firing-exclusion.md'), sequential: read('sequential-execution.md'), ranking: read('next-ranking.md') };

test('AC3.1: firing-exclusion.md, sequential-execution.md and next-ranking.md name the render-failure stop (#5255)', () => {
  assertSiblingStops(SIBLINGS);
});

test('AC3.1 go-red: each file without its sentence fails its own assertion (#5255)', () => {
  for (const [key, needle, message] of [
    ['exclusion', FIRING_EXCLUSION_STOP, 'firing-exclusion.md: render-failure stop missing'],
    ['sequential', SEQUENTIAL_STOP, 'sequential-execution.md: render-failure stop missing'],
    ['ranking', NEXT_RANKING_STOP, 'next-ranking.md: render-failure stop missing'],
  ]) {
    const mutated = { ...SIBLINGS, [key]: SIBLINGS[key].replace(needle, 'x') };
    assert.notStrictEqual(mutated[key], SIBLINGS[key]);
    assert.throws(() => assertSiblingStops(mutated), { message });
  }
});

// reporting.md: the relay paragraph, and the PushNotification sentence's headless case.
const RELAY_LEAD = '**Render-failure stops are relayed (#5255).**';
const RELAY_FACTS = [
  'names the record and the call (first, second, or a continuation)',
  'quotes the exit code and the first stderr line from that call\'s `Prompt render failed:` `REFUSED` line',
  'says the firing stopped',
  'lists any named records after it as not attempted',
  'It closes with the remedy on its own line: fix the named cause (the template, a policy value or the environment), then re-run `/claude-tweaks:dispatch #{n}` (when #{n} still has an open draft PR, that command\'s open-PR line names the next step).',
];
const PUSH_CASE = 'for a headless render-failure stop (a firing that passes `--headless`, `task-prompt.md`; one notification naming the record and the stderr line';
function assertRelay(reporting) {
  const paras = reporting.split('\n\n');
  const para = paras.find((p) => p.startsWith(RELAY_LEAD));
  assert.ok(para, 'reporting.md: relay paragraph missing');
  for (const f of RELAY_FACTS) assert.ok(para.includes(f), `reporting.md relay: missing ${JSON.stringify(f)}`);
  const push = paras.find((p) => p.startsWith('`PushNotification` fires only'));
  assert.ok(push && push.includes(PUSH_CASE), 'reporting.md: PushNotification sentence must name a headless render-failure stop');
}
const REPORTING = read('reporting.md');

test('AC4.1: reporting.md relays the render-failure stop and notifies when headless (#5255)', () => {
  assertRelay(REPORTING);
});

test('AC4.1 go-red: a dropped relay fact or the missing headless case fails its own assertion (#5255)', () => {
  for (const f of RELAY_FACTS) {
    const mutated = mutateInParagraph(REPORTING, RELAY_LEAD, f, 'x');
    assert.throws(() => assertRelay(mutated), { message: `reporting.md relay: missing ${JSON.stringify(f)}` });
  }
  const noPush = REPORTING.replace(PUSH_CASE, 'x');
  assert.notStrictEqual(noPush, REPORTING);
  assert.throws(() => assertRelay(noPush), { message: 'reporting.md: PushNotification sentence must name a headless render-failure stop' });
});
