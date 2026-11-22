'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, sectionOf } = require('./helpers/conformance-asserts');
const { CLASS_CLAUSES, classStatementSites } = require('./helpers/planning-decisions-clauses');
// #6051: plugin/skills/_shared/planning-decisions.md is the one statement of which planning
// questions are asked (classes (a), (b), (c)) and how every other one is settled, the doubt rule
// bounding class (b), the two line forms, the asking shape and the worked examples. Read live: the
// file is the declared contract build/plan-review-asked-classes.md cites by section name.

const ROOT = path.join(__dirname, '..');
const SHARED_REL = 'plugin/skills/_shared/planning-decisions.md';
const text = () => readText(path.join(ROOT, SHARED_REL));
const section = (heading) => sectionOf(text(), heading);

// A literal as a regex that tolerates a hard wrap at any space.
const lit = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));

// Fragments required in order within one paragraph: a hard wrap may fall at any space or between
// fragments, but a blank line (a paragraph boundary) never bridges two of them.
const WRAP_SPACE = '(?: |\\n(?!\\n))';
const WITHIN_PARAGRAPH = '(?:[^\\n]|\\n(?!\\n))*?';
const paragraph = (...fragments) => new RegExp(fragments
  .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, WRAP_SPACE))
  .join(WITHIN_PARAGRAPH));

function assertFacts(region, patterns, label) {
  const missing = missingFactsOf(patterns)(region);
  assert.deepEqual(missing, [], `${label}: missing ${missing.join(' | ')}`);
}

const CLASS_PATTERNS = [
  [lit('**(a) Design-level.** Settling it changes what the record or its design doc says the work is for, who it serves, its shape, or a goal, non-goal or anti-goal.'), '(a) design-level'],
  [lit('**(b) Hard to undo.** The question falls in a risk category the record keeps in `Risk-flags:`.'), '(b) hard to undo'],
  [lit('When it plainly falls in a category the record does not flag, the flag is added first through `bin/risk-flags.js add` (add, never drop), the question is asked, and the plan owes that flag\'s Check G proof.'), '(b) unflagged category: add the flag first'],
  [lit('**(c) Contradiction.** No reading keeps every Acceptance Criterion and recorded decision intact.'), '(c) contradiction'],
  [lit('A row whose readings all break an Acceptance Criterion or recorded decision is (c) whatever its topic.'), '(c) whatever its topic'],
  [lit('The classifier is the controller — the build\'s plan review, or `/claude-tweaks:specify`\'s planning step — never the reviewer.'), 'classifier is the controller'],
  [lit('Every other question is settled: among readings that keep every Acceptance Criterion and recorded decision intact, take the one closer to stated intent (the criterion-as-written reading when the row came from a criterion change).'), 'settled path'],
  [lit('When two readings keep every Acceptance Criterion and recorded decision intact and sit equally close to the stated intent (the record body and its design doc), take the one that changes fewer observable contracts.'), 'tie-break'],
  [lit('A settled question is never asked in any posture (`auto`, `confirm`, `interactive`, `hybrid`).'), 'settled: never asked in any posture'],
];

const DOUBT_PATTERNS = [
  [lit('Class (b) is bounded to the declared categories: the four built-ins (`migrations`, `auth`, `public-contract`, `irreversible-side-effect`) plus policy `risk-categories`.'), 'class (b) bounded to declared categories'],
  [lit('A question that does not plainly fall in one is settled, never asked.'), 'outside the categories: settled, never asked'],
  [lit('Policy `risk-categories` extras count as declared only when policy `control-mode` resolves `on`, the rule `bin/risk-flags.js add` reads them by; with control mode off the declared categories are the four built-ins alone.'), 'extras count only with control-mode on'],
  [lit('Plainly means the question is about the category\'s own subject: a schema or data migration, who may authenticate or what an unauthenticated caller may reach, an interface outside callers depend on, or a side effect that cannot be reversed. Touching a file that such a subject also touches is not enough.'), 'plainly means the category\'s own subject'],
];

// The paragraph pattern anchors on the paragraph's own opening words, just after the label, so
// stripping one leaves the other, and another paragraph's `public-contract` cannot satisfy it.
const BORDERLINE_PATTERNS = [
  [/\*\*Doubt example:\*\*/, 'Doubt example: label'],
  [paragraph('a question about whether a `decisions.md` line says `skipped` or `not run`', 'not plainly fall in `public-contract`, so it is settled.'), 'borderline row is settled, not public-contract'],
];

const LINE_FORM_PATTERNS = [
  [lit('`Settled at planning: {finding} — chose {reading}; not {other reading}`'), 'Settled at planning form'],
  [lit('`Decided by the user at planning: {finding} — chose {reading}; not {other reading}`'), 'Decided by the user at planning form'],
  [lit('under an additive `## Planning Decisions` section that never edits an existing criterion\'s line'), 'additive ## Planning Decisions section'],
  [lit('A row an answered round returns gets a `Decided by the user at planning:` line and is never asked again: its `{reading}` is the reading the user\'s recorded decision implies, and the line quotes that decision.'), 'answered round: Decided line, implied reading, never asked again'],
];

const ASKING_ORDER_FACT = 'asking order: recommended reading first, then the other, then the stop option';
const ASKING_PATTERNS = [
  [lit('One `AskUserQuestion` per question set, at most four questions per call: the recommended reading first, labelled `(Recommended)`, then the other reading, then `Stop the build` (build) or `Leave for later` (specify).'), ASKING_ORDER_FACT],
];

const RECOMMENDATION_PATTERNS = [
  [lit('The recommended reading is the one `## Settled path` would pick; for a class (c) row, where that rule cannot choose, it is the reviewer\'s Reading A.'), 'recommendation rule'],
];

const EXAMPLE_PATTERNS = [
  [paragraph('**Settled, #4265.**', '`error` string', 'Reading A', 'Reading B', "Neither falls in a category the record flags, and the `releaseFailed` string is read only by the plugin's own skills, so it does not plainly fall in `public-contract`.", 'Reading A is closer to stated intent'), '#4265 settled: two readings, both category checks, the chosen one'],
  [paragraph('**Settled, #4786.**', 'does not say which of them carries the one-sentence pointer', 'Reading A', 'Reading B: `plugin/skills/dispatch/task-prompt.md`', 'Neither falls in a category the record flags, and a pointer sentence is no interface an outside caller depends on, so it does not plainly fall in `public-contract`.', 'Reading A changes fewer observable contracts', 'chose docs/hooks.md; not plugin/skills/dispatch/task-prompt.md`'), '#4786 settled: two readings, both category checks, the chosen one in full'],
  [paragraph('**Asked, migration.**', 'drops the old column in this release or the next', 'class (b), `migrations`'), 'migration question asked as class (b)'],
  [paragraph('**Asked, auth.**', "unauthenticated caller may read a run's decisions", 'class (b), `auth`'), 'auth question asked as class (b)'],
];

test('the six sections Task 4 cites exist, in order', () => {
  const headings = text().split('\n').filter((l) => l.startsWith('## '));
  assert.deepEqual(headings, ['## Asked classes', '## Settled path', '## Doubt rule', '## Line forms', '## Asking', '## Worked examples']);
});

test('AC5.1: planning-decisions.md states the three asked classes and the settled path', () => {
  const region = `${section('## Asked classes')}\n${section('## Settled path')}`;
  assertFacts(region, CLASS_PATTERNS, 'asked classes');
  assertEachPatternGoesRed(region, CLASS_PATTERNS, missingFactsOf(CLASS_PATTERNS));
});

function pluginMarkdown() {
  const files = new Map();
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.md')) files.set(child, readText(path.join(ROOT, child)));
    }
  };
  walk('plugin');
  return files;
}

test('AC5.1: no other file under plugin/ states the three classes', () => {
  const files = pluginMarkdown();
  assert.ok(files.size > 100, `the walk found only ${files.size} markdown files under plugin/`);
  assert.deepEqual(classStatementSites(files), [SHARED_REL]);
});

test('control: classStatementSites flags a second file stating a class clause, wrapped or not', () => {
  // zzz-no-such-file-6051.md never exists; a real file of that name means re-pick the control.
  const stray = 'plugin/skills/build/zzz-no-such-file-6051.md';
  const files = pluginMarkdown();
  assert.ok(!files.has(stray), `${stray} exists — re-pick the control name`);
  const wrapped = CLASS_CLAUSES[0].replace(', who', ',\nwho');
  assert.notEqual(wrapped, CLASS_CLAUSES[0]);
  files.set(stray, `Settling it changes what the record ${wrapped}, or a goal.`);
  assert.deepEqual(classStatementSites(files), [SHARED_REL, stray]);
  for (const clause of CLASS_CLAUSES.slice(1)) {
    assert.deepEqual(classStatementSites(new Map([[stray, clause]])), [stray], `clause not detected: ${clause}`);
  }
  const lower = 'Plan review stops when no reading keeps every Acceptance Criterion and recorded decision intact.';
  assert.ok(!lower.includes(CLASS_CLAUSES[2]), 'the lowercase control must not hold the clause verbatim');
  assert.deepEqual(classStatementSites(new Map([[stray, lower]])), [stray], 'a lowercase restatement was not detected');
});

test('AC8.1: the doubt rule bounds class (b) to the declared categories and settles the rest', () => {
  const region = section('## Doubt rule');
  assertFacts(region, DOUBT_PATTERNS, 'doubt rule');
  assertEachPatternGoesRed(region, DOUBT_PATTERNS, missingFactsOf(DOUBT_PATTERNS));
});

test('AC8.2: one borderline row is worked as settled under the doubt rule', () => {
  const region = section('## Worked examples');
  assertFacts(region, BORDERLINE_PATTERNS, 'borderline row');
  assertEachPatternGoesRed(region, BORDERLINE_PATTERNS, missingFactsOf(BORDERLINE_PATTERNS));
});

test('line forms: Settled at planning and Decided by the user at planning under ## Planning Decisions', () => {
  const region = section('## Line forms');
  assertFacts(region, LINE_FORM_PATTERNS, 'line forms');
  assertEachPatternGoesRed(region, LINE_FORM_PATTERNS, missingFactsOf(LINE_FORM_PATTERNS));
});

test('AC3.1: asking puts the recommended reading first, then the other, then Stop the build or Leave for later', () => {
  const region = section('## Asking');
  assertFacts(region, ASKING_PATTERNS, 'asking');
  assertEachPatternGoesRed(region, ASKING_PATTERNS, missingFactsOf(ASKING_PATTERNS));
  // Ordering control: (Recommended) moved onto the second reading.
  const swapped = region.replace(
    'the recommended reading first, labelled `(Recommended)`, then the other reading,',
    'the recommended reading first, then the other reading, labelled `(Recommended)`,',
  );
  assert.notEqual(swapped, region);
  assert.throws(() => assertFacts(swapped, ASKING_PATTERNS, 'asking'), { message: new RegExp(`missing ${ASKING_ORDER_FACT}`) });
});

test('AC3.1: the recommended reading is the Settled-path pick, the reviewer\'s Reading A for a class (c) row', () => {
  const region = section('## Asking');
  assertFacts(region, RECOMMENDATION_PATTERNS, 'recommendation');
  assertEachPatternGoesRed(region, RECOMMENDATION_PATTERNS, missingFactsOf(RECOMMENDATION_PATTERNS));
});

test('worked examples: #4265 and #4786 settled, a migration and an auth question asked', () => {
  const region = section('## Worked examples');
  assertFacts(region, EXAMPLE_PATTERNS, 'worked examples');
  assertEachPatternGoesRed(region, EXAMPLE_PATTERNS, missingFactsOf(EXAMPLE_PATTERNS));
});

test('control: each settled example goes red when only its unflagged-category check is removed', () => {
  const region = section('## Worked examples');
  const checks = [
    [", and the `releaseFailed` string is read only by the plugin's own skills, so it does not plainly fall in `public-contract`", EXAMPLE_PATTERNS[0][1]],
    [', and a pointer sentence is no interface an outside caller depends on, so it does not plainly fall in `public-contract`', EXAMPLE_PATTERNS[1][1]],
  ];
  for (const [clause, fact] of checks) {
    const doctored = region.replace(clause, '');
    assert.notEqual(doctored, region, `clause not found: ${clause}`);
    assert.deepEqual(missingFactsOf(EXAMPLE_PATTERNS)(doctored), [fact]);
  }
});
