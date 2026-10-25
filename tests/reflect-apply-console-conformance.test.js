// tests/reflect-apply-console-conformance.test.js — #4168: the single-spec console prose routes a
// reflect observation/convention row (`staged/reflect-{n}.md`, classified into Skill updates by
// plugin/bin/lib/console/resolve.js) through `bin/reflect-apply.js`
// (review-console-section-addition's sites 6, 7, 8 and 9 for a prefix moving into an existing section).
//
// Reading the live prose is the declared carve-out (skill-prose-conformance-tests, [IL-80]): these
// files restate the CLI's contract, so updating them IS the response to a change there. New prose
// has no pre-change bytes, so each fact's go-red control strips only that fact from the live text in
// memory and expects the same predicate to return exactly [fact].
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.resolve(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, 'plugin', 'skills', 'wrap-up', ...p));

const CONSOLE = read('review-console.md');
const APPENDIX = read('review-console-appendix.md');
const TEMPLATE = read('console-template.md');
const INTERACTIVE = read('review-console-interactive.md');

// --- region extraction (each asserts both anchors, so a missing one throws rather than widening) ---

// "On approval" step 2: the `2. ` line under `## On approval (option 1)`, up to the `3. ` line.
function step2Line(text) {
  const head = text.indexOf('## On approval (option 1)');
  assert.notEqual(head, -1, 'missing "## On approval (option 1)"');
  const start = text.indexOf('\n2. ', head);
  assert.notEqual(start, -1, 'missing step 2 under "On approval"');
  const end = text.indexOf('\n3. ', start);
  assert.notEqual(end, -1, 'missing step 3 after step 2');
  return text.slice(start + 1, end);
}

// The appendix's `approve` bullet: from "- `approve`" to the next top-level bullet.
function approveBullet(text) {
  const start = text.indexOf('- `approve`');
  assert.notEqual(start, -1, 'missing the `approve` bullet in the Resolution-to-step mapping');
  const end = text.indexOf('\n- `', start + 1);
  assert.notEqual(end, -1, 'missing the bullet after `approve`');
  return text.slice(start, end);
}

// console-template.md's `#### Skill updates` section, to the next `#### ` heading.
function skillUpdatesSection(text) {
  const start = text.indexOf('#### Skill updates');
  assert.notEqual(start, -1, 'missing "#### Skill updates"');
  const end = text.indexOf('\n#### ', start + 1);
  assert.notEqual(end, -1, 'missing the heading after "#### Skill updates"');
  return text.slice(start, end);
}

// review-console-interactive.md's lines (one list bullet each) that name a reflect row.
function reflectRowLines(text) {
  return text.split('\n').filter((l) => /staged\/reflect-\{n\}\.md/.test(l));
}

// --- facts: one named, non-global pattern per claim --------------------------------------------

const STEP2_FACTS = {
  'reflect-apply CLI call': /"\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/reflect-apply\.js" --run "\{item-run-dir\}"/,
  'row prefix routed': /`staged\/reflect-\{n\}\.md` row/,
  'emit transport': /--transport emit --out-dir/,
  'only for Override rows': /--only '\{name\},…'/,
  'logFailures run first': /run each `logFailures` entry's `line` first/,
  'edit then applied edited': /`edit` — make the edit now[^;]*then `--item '\{name\}' --applied edited`/,
  'record then applied filed': /`record` — file the emitted proposal[^;]*then `--item '\{name\}' --applied filed --ref \{n\}`/,
  'digest then applied digested': /`digest` — append its `line`[^;]*`_shared\/materiality-floor\.md`[^;]*then `--item '\{name\}' --applied digested --ref/,
  'failed logs one SKIP': /A `failed` entry logs one Degrade-trace `SKIP`/,
  'Override skip declines': /Override's `skip \{#\}` on such a row runs `--item '\{name\}' --decline '/,
};
const APPROVE_FACTS = {
  'reflect row runs at step 2 clause': /`staged\/reflect-\{n\}\.md` runs at step 2's reflect clause \(`bin\/reflect-apply\.js`\)/,
  'not the Skills curation patch path': /not the Skills curation patch path/,
};
const TEMPLATE_FACTS = {
  'reflect rows named': /`staged\/reflect-\{n\}\.md`/,
  'not engine findings': /not an engine finding/,
  'four-column table': /`\| # \| Target \| Change \| Disposition \|`/,
  'disposition cell': /`staged \(staged\/reflect-\{n\}\.md\)`/,
};
const INTERACTIVE_FACTS = {
  'joins the global sequence': /Reflect rows[^:]*join the global sequence:/,
  'takes the next global number': /takes the next global `#N`/,
  'skip records a decline': /`skip \{#\}`[^.]*records a decline/,
};

// The facts whose pattern no longer matches `text`.
const missingFacts = (text, facts) => Object.keys(facts).filter((k) => !facts[k].test(text));

// Strip every match of one fact from `text` (a global copy of the pattern) — the go-red doctoring.
function without(text, re) {
  const doctored = text.replace(new RegExp(re.source, `${re.flags}g`), '');
  assert.notEqual(doctored, text, `pattern ${re} matched nothing to strip`);
  return doctored;
}

function assertEachFactGoesRed(region, facts) {
  assert.deepEqual(missingFacts(region, facts), [], 'a fact is missing from the live region');
  for (const [name, re] of Object.entries(facts)) {
    assert.deepEqual(missingFacts(without(region, re), facts), [name], `stripping "${name}" must report exactly that fact`);
  }
}

// --- the pins ------------------------------------------------------------------------------------

test('review-console.md step 2 carries bin/reflect-apply.js, --applied and --decline', () => {
  const line = step2Line(CONSOLE);
  assert.ok(line.includes('bin/reflect-apply.js'), 'step 2 must name bin/reflect-apply.js');
  assert.ok(line.includes('--applied'), 'step 2 must name --applied');
  assert.ok(line.includes('--decline'), 'step 2 must name --decline');
});

test('review-console.md step 2: every fact of the reflect clause is stated, and each can go red', () => {
  assertEachFactGoesRed(step2Line(CONSOLE), STEP2_FACTS);
});

test('review-console.md: the "On approval" steps are not renumbered (7, 10, 12, 13 are cited by number)', () => {
  const head = CONSOLE.indexOf('## On approval (option 1)');
  const body = CONSOLE.slice(head);
  const numbers = [...body.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepEqual(numbers.slice(0, 14), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.match(body, /\n7\. `Q#` queue writes/);
  assert.match(body, /\n10\. \*\*Reflection insights \(#2547\)\.\*\*/);
  assert.match(body, /\n12\. Commit with a wrap-up message/);
  assert.match(body, /\n13\. \*\*Branch finish/);
});

test('review-console-appendix.md: the approve bullet routes a staged/reflect- row to step 2', () => {
  const bullet = approveBullet(APPENDIX);
  assert.ok(bullet.includes('staged/reflect-'), 'the approve bullet must name staged/reflect-');
  assert.ok(/step 2/.test(bullet.replace('step 2 (Skill updates)', '')), 'the reflect sentence must cite step 2 on its own');
  assertEachFactGoesRed(bullet, APPROVE_FACTS);
});

test('console-template.md: the Skill updates section renders the staged/reflect- rows', () => {
  const section = skillUpdatesSection(TEMPLATE);
  assert.ok(section.includes('staged/reflect-'), 'the Skill updates section must name staged/reflect-');
  assertEachFactGoesRed(section, TEMPLATE_FACTS);
});

test('review-console-interactive.md: a reflect row joins the global sequence and Override skip records a decline', () => {
  const lines = reflectRowLines(INTERACTIVE);
  assert.equal(lines.length, 1, 'exactly one line names the reflect row');
  assert.ok(/decline/.test(lines[0]), 'the reflect line must name a decline');
  assertEachFactGoesRed(lines[0], INTERACTIVE_FACTS);
});

test('go-red control: review-console.md step 2 without bin/reflect-apply.js fails the predicate', () => {
  const doctored = CONSOLE.split('bin/reflect-apply.js').join('');
  assert.notEqual(doctored, CONSOLE, 'the live console never named bin/reflect-apply.js');
  assert.ok(!step2Line(doctored).includes('bin/reflect-apply.js'));
  assert.ok(step2Line(CONSOLE).includes('bin/reflect-apply.js'));
});

// --- Task 7: the PR-rendered console and the execution step (site 9a and the apply list) -------------

const readAt = (...p) => readText(path.join(ROOT, 'plugin', 'skills', ...p));
const EXECUTION = readAt('wrap-up', 'execution-and-verification.md');
const CONSOLE_ON_PR = readAt('_shared', 'console-on-pr.md');
const CONSOLE_EXECUTION = readAt('_shared', 'console-execution.md');

// execution-and-verification.md's `- **Skill updates**` bullet: one line.
function skillUpdatesBullet(text) {
  const start = text.indexOf('- **Skill updates**');
  assert.notEqual(start, -1, 'missing the "- **Skill updates**" bullet');
  const end = text.indexOf('\n', start);
  assert.notEqual(end, -1, 'missing the newline after the Skill updates bullet');
  return text.slice(start, end);
}

// A `## ` section of `text`, to the next `## ` heading (both anchors asserted).
function h2Section(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing "${heading}"`);
  const end = text.indexOf('\n## ', start + 1);
  assert.notEqual(end, -1, `missing the heading after "${heading}"`);
  return text.slice(start, end);
}

const EXECUTION_FACTS = {
  'reflect row named': /`staged\/reflect-\{n\}\.md` row/,
  'applied by step 2 reflect clause': /`review-console\.md` step 2's reflect clause/,
  'not as a patch': /not as a patch/,
};
const ON_PR_FACTS = {
  'reflect row is a staged row': /reflect Skill-updates row is a `staged` row/,
  'global sequence': /its `#` from the global sequence/,
};
const ROUTING_FACTS = {
  'unticked reflect row declines': /unticked `staged\/reflect-\{n\}\.md` Skill-updates row declines through/,
  'reflect-apply decline call': /`bin\/reflect-apply\.js --run \{item-run-dir\} --item '\{name\}' --decline 'declined, no reason given'`/,
  'decline recorded not only logged': /the decline is recorded, not only logged/,
};

test('execution-and-verification.md: the Skill updates bullet names staged/reflect- and step 2\'s reflect clause', () => {
  const bullet = skillUpdatesBullet(EXECUTION);
  assert.ok(bullet.includes('staged/reflect-'), 'the Skill updates bullet must name staged/reflect-');
  assertEachFactGoesRed(bullet, EXECUTION_FACTS);
});

test('console-on-pr.md: the Item ID scheme names a reflect Skill-updates row as a staged row', () => {
  const section = h2Section(CONSOLE_ON_PR, '## Item ID scheme');
  assert.ok(/reflect/.test(section), 'the Item ID scheme section must name reflect');
  assertEachFactGoesRed(section, ON_PR_FACTS);
});

test('console-execution.md: an unticked reflect row declines through reflect-apply.js --decline', () => {
  assert.ok(CONSOLE_EXECUTION.includes('reflect-apply.js'), 'console-execution.md must name reflect-apply.js');
  assert.ok(CONSOLE_EXECUTION.includes('--decline'), 'console-execution.md must name --decline');
  assertEachFactGoesRed(h2Section(CONSOLE_EXECUTION, '## Execution routing'), ROUTING_FACTS);
});
