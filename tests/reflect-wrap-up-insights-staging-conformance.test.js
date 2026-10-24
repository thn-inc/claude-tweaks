'use strict';
// tests/reflect-wrap-up-insights-staging-conformance.test.js — pins #2547: a
// standalone wrap-up run under `--source wrap-up` no longer calls two
// AskUserQuestion stops that decide the same thing (reflect's own Step 3
// routing question, then the Review Console's terminal approval). Reflect
// stages its Reflection Insights table instead of asking under that signal;
// the console's own "On approval" step applies the staged rows. The
// standalone / `--source review` path is unaffected — it keeps asking.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const FULL_MODE = read('plugin', 'skills', 'reflect', 'full-mode.md');
const CONSOLE = read('plugin', 'skills', 'wrap-up', 'review-console.md');
const CONSOLE_INTERACTIVE = read('plugin', 'skills', 'wrap-up', 'review-console-interactive.md');
const CONSOLE_TEMPLATE = read('plugin', 'skills', 'wrap-up', 'console-template.md');
const { SECTIONS } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'resolve.js'));

function section(text, heading, nextPrefix) {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `missing section: ${heading}`);
  const next = text.indexOf(nextPrefix, start + heading.length);
  return next === -1 ? text.slice(start) : text.slice(start, next);
}

test('full-mode.md: the --source wrap-up branch skips AskUserQuestion and stages the table instead', () => {
  assert.match(
    FULL_MODE,
    /Under `--source wrap-up` \(#2547\) — stage instead of asking/,
  );
  assert.match(
    FULL_MODE,
    /skip the `AskUserQuestion` call below entirely/,
  );
  assert.match(
    FULL_MODE,
    /write the composed table.*to `\{run-dir\}\/staged\/wrap-up-reflect-insights\.md`/s,
  );
});

test('full-mode.md: the --source wrap-up branch does not apply any outcome itself — Implement now, Defer/Capture, and Don\'t capture are all left unapplied', () => {
  const branch = section(FULL_MODE, 'Under `--source wrap-up` (#2547)', '\n\nOtherwise');
  assert.match(branch, /Do not apply any "Implement now" insight/);
  assert.match(branch, /do\s+not file any Defer\/Capture record/);
  assert.match(branch, /do not record a Don't-capture decline yet/);
});

test('full-mode.md: the --source wrap-up branch leaves D4/D5 gated exclusively by the console\'s own M#/U# rows', () => {
  const branch = section(FULL_MODE, 'Under `--source wrap-up` (#2547)', '\n\nOtherwise');
  assert.match(branch, /listed in the staged file for\s+visibility only/);
  assert.match(branch, /`review-console-interactive\.md`'s "a different table's approval never satisfies this\s+gate" rule/);
});

test('full-mode.md: the standalone / --source review path is explicitly unaffected and still asks', () => {
  assert.match(
    FULL_MODE,
    /Otherwise — standalone, or `--source review` — immediately below the table, call\s*\n`AskUserQuestion` with:/,
  );
});

test('full-mode.md: the --source review signal is explicitly excluded from the staging branch', () => {
  const branch = section(FULL_MODE, 'Under `--source wrap-up` (#2547)', '\n\nOtherwise');
  assert.match(branch, /this branch is `--source wrap-up` only, never `--source review`/);
});

test('review-console.md: "On approval" has a Reflection insights step that applies the staged file\'s rows', () => {
  assert.match(CONSOLE, /\*\*Reflection insights \(#2547\)\.\*\* When `staged\/wrap-up-reflect-insights\.md` exists/);
  assert.match(CONSOLE, /Approve all applies each insight's own recommended destination exactly as reflect's own "Apply all" would have/);
});

test('review-console.md: the Reflection insights step keeps D4/Memory and D5/Upstream gated exclusively by the console\'s own M#/U# rows', () => {
  const step = section(CONSOLE, '**Reflection insights (#2547).**', '\n11.');
  assert.match(step, /D4 \(Memory\) and D5 \(Upstream\) rows in this table are informational only/);
  assert.match(step, /approving this step never writes a memory file or files upstream feedback on its own/);
});

test('review-console.md: the "On approval" numbered procedure stays sequential 1-13 with no duplicate numbers', () => {
  const onApproval = section(CONSOLE, '## On approval (option 1)', '\nFor "On override"');
  const numbers = [...onApproval.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepEqual(numbers, Array.from({ length: numbers.length }, (_, i) => i + 1));
});

test('review-console.md: the Reflection insights step runs refused-proposals.md\'s Defer-reason check before a Defer/Capture record (#3926)', () => {
  const step = section(CONSOLE, '**Reflection insights (#2547).**', '\n11.');
  assert.match(step, /"Defer"\/"Capture" runs `refused-proposals\.md`'s check/);
});

test('console-template.md renders a #### heading for every section console-resolve.js names, Reflection insights after Upstream feedback (#3926)', () => {
  for (const name of Object.values(SECTIONS)) {
    assert.ok(CONSOLE_TEMPLATE.includes(`\n#### ${name} (`), `console-template.md has no "#### ${name}" heading`);
  }
  assert.ok(
    CONSOLE_TEMPLATE.indexOf(`\n#### ${SECTIONS.INSIGHTS} (`) > CONSOLE_TEMPLATE.indexOf(`\n#### ${SECTIONS.UPSTREAM} (`),
    'Reflection insights follows Upstream feedback, the SECTIONS order',
  );
});

test('review-console-interactive.md: the Numbering rules give Reflection insights its own R# sequence (#3926)', () => {
  const rules = section(CONSOLE_INTERACTIVE, '## Numbering rules', '\n## ');
  assert.match(rules, /\*\*Reflection insights\*\* \(`R1`, `R2`, …/);
});

test('review-console-interactive.md: the never-satisfies-this-gate rule still names the Reflection Insights batch explicitly', () => {
  assert.match(
    CONSOLE_INTERACTIVE,
    /not the Reflection Insights batch, not the Skill Updates batch, not any other/,
  );
});

// --- multi-spec console (#4063): review-console-section-addition site 10 --------------
// The multi-spec console carries its own Reflection insights heading, both section lists,
// and R# handling. Each helper is the single assertion its live test and go-red control call.

const MULTISPEC_TEMPLATE = read('plugin', 'skills', 'flow', 'multispec-console-template.md');
const MULTISPEC_CONSOLE = read('plugin', 'skills', 'flow', 'multispec-review-console.md');
const INSIGHTS_HEAD = `\n#### ${SECTIONS.INSIGHTS} (`;
const NOT_RUN_HEAD = '\n#### Not run / Failed (';
const UPSTREAM_THEN_INSIGHTS = `${SECTIONS.UPSTREAM}, ${SECTIONS.INSIGHTS}`;

function assertMultispecHeading(templateText) {
  const idx = templateText.indexOf(INSIGHTS_HEAD);
  assert.notEqual(idx, -1, `multispec-console-template.md has no "#### ${SECTIONS.INSIGHTS} (" heading`);
  assert.equal(templateText.indexOf(INSIGHTS_HEAD, idx + 1), -1, `more than one "#### ${SECTIONS.INSIGHTS} (" heading`);
  const upstream = templateText.indexOf(`\n#### ${SECTIONS.UPSTREAM} (`);
  const notRun = templateText.indexOf(NOT_RUN_HEAD);
  assert.ok(upstream !== -1 && notRun !== -1, 'the Upstream feedback or Not run / Failed heading is missing — the order check has no anchors');
  assert.ok(upstream < idx && idx < notRun, `"#### ${SECTIONS.INSIGHTS} (" is not between ${SECTIONS.UPSTREAM} and Not run / Failed`);
  assert.match(templateText.slice(idx, notRun), /\| R# \| Spec \|/, 'the multi-spec Reflection insights table has no R#/Spec columns');
}

function assertMultispecOrder(consoleText) {
  const count = consoleText.split(UPSTREAM_THEN_INSIGHTS).length - 1;
  assert.equal(count, 2, `multispec-review-console.md carries "${UPSTREAM_THEN_INSIGHTS}" ${count} times, expected 2 (the step-2 read list and the Canonical render order)`);
}

function assertMultispecRHandling(consoleText) {
  const rules = section(consoleText, '## Numbering rules', '\n## ');
  assert.match(rules, /\*\*Reflection insights\*\* use a separate `R`-prefixed sequence/, 'the multi-spec Numbering rules give Reflection insights no R# sequence');
  assert.match(consoleText, /^4\.5\. For `R#` reflection insights: .*`wrap-up\/review-console\.md` "On approval" step 10/m, 'multi-spec On approval has no R# step citing review-console.md step 10');
}

function doctor(text, from, to) {
  const out = text.replace(from, to);
  assert.notEqual(out, text, `control did not change the text: ${from}`);
  return out;
}

test('multispec-console-template.md renders a #### Reflection insights heading after Upstream feedback, with R# rows (#4063)', () => {
  assertMultispecHeading(MULTISPEC_TEMPLATE);
});

test('control: deleting the multi-spec Reflection insights heading fails assertMultispecHeading', () => {
  const mutated = doctor(MULTISPEC_TEMPLATE, INSIGHTS_HEAD, '\n#### Something else (');
  assert.throws(() => assertMultispecHeading(mutated), { message: /has no "#### Reflection insights \(" heading/ });
});

test('control: moving the heading below Not run / Failed fails assertMultispecHeading (order message)', () => {
  const start = MULTISPEC_TEMPLATE.indexOf(INSIGHTS_HEAD);
  const notRun = MULTISPEC_TEMPLATE.indexOf(NOT_RUN_HEAD);
  assert.ok(start !== -1 && notRun !== -1 && start < notRun);
  const block = MULTISPEC_TEMPLATE.slice(start, notRun);
  const without = MULTISPEC_TEMPLATE.slice(0, start) + MULTISPEC_TEMPLATE.slice(notRun);
  const at = without.lastIndexOf('\n```');
  const permuted = without.slice(0, at) + block + without.slice(at);
  assert.notEqual(permuted, MULTISPEC_TEMPLATE);
  assert.throws(() => assertMultispecHeading(permuted), { message: /is not between/ });
});

test('multispec-review-console.md names Reflection insights after Upstream feedback in both section enumerations (#4063)', () => {
  assertMultispecOrder(MULTISPEC_CONSOLE);
});

test('control: dropping Reflection insights from either enumeration fails assertMultispecOrder', () => {
  const once = doctor(MULTISPEC_CONSOLE, UPSTREAM_THEN_INSIGHTS, SECTIONS.UPSTREAM);
  assert.throws(() => assertMultispecOrder(once), { message: /carries .* 1 times, expected 2/ });
  const twice = doctor(once, UPSTREAM_THEN_INSIGHTS, SECTIONS.UPSTREAM);
  assert.throws(() => assertMultispecOrder(twice), { message: /carries .* 0 times, expected 2/ });
});

test('multispec-review-console.md gives Reflection insights an R# sequence and an On approval step citing review-console.md step 10 (#4063)', () => {
  assertMultispecRHandling(MULTISPEC_CONSOLE);
});

test('control: removing the R# sequence or the On approval step fails assertMultispecRHandling', () => {
  const noSeq = doctor(MULTISPEC_CONSOLE, '**Reflection insights** use a separate', '**Reflection insights** use the');
  assert.throws(() => assertMultispecRHandling(noSeq), { message: /no R# sequence/ });
  const noStep = doctor(MULTISPEC_CONSOLE, '4.5. For `R#` reflection insights:', 'For reflection insights:');
  assert.throws(() => assertMultispecRHandling(noStep), { message: /no R# step/ });
});
