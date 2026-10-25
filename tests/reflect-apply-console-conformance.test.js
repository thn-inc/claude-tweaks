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
const fs = require('node:fs');
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
  'failed is not residue': /; `console\.json` already records the row `approve`, so it is not residue and nothing else surfaces it:/,
  'failed carries a needs-human line': /carry a needs-human-action line naming `\{item-run-dir\}`, the failed items, and the paste-ready re-run `node /,
  'failed line rides the Needs a human block': /wherever the CLI's `Needs a human` block is carried — the `PushNotification` and the run's final human-facing stop\./,
  'Override skip declines': /Override's `skip \{#\}` on such a row runs `--item '\{name\}' --decline '/,
  'Override declines run before the --only apply': /, and runs before the apply; under Override the apply always carries `--only`, never a plain batch run\./,
};
const APPROVE_FACTS = {
  'reflect row runs at step 2 clause': /`staged\/reflect-\{n\}\.md` runs at step 2's reflect clause \(`bin\/reflect-apply\.js`\)/,
  'not the Skills curation patch path': /not the Skills curation patch path/,
};
const TEMPLATE_FACTS = {
  'reflect rows named': /`staged\/reflect-\{n\}\.md`/,
  'not engine findings': /not an engine finding/,
  'target is the edit path or the staged file': /Target is the `edit` path for an edit destination, else the staged file/,
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

// The re-run is the one command a human can paste, so its exact shape is pinned apart from the fact list
// (its `reflect-apply.js --run` and `--only` bytes overlap two facts, which would break their go-red controls).
const FAILED_RERUN = 'the paste-ready re-run `node "${CLAUDE_PLUGIN_ROOT}/bin/reflect-apply.js" --run "{item-run-dir}" --only \'{name},…\'`';
test('review-console.md step 2: a failed reflect apply carries the paste-ready --only re-run, and the pin goes red without it', () => {
  assert.ok(step2Line(CONSOLE).includes(FAILED_RERUN), 'step 2 must carry the paste-ready re-run');
  assert.ok(!step2Line(CONSOLE.split(FAILED_RERUN).join('')).includes(FAILED_RERUN));
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
  'unticked reflect row declines first': /unticked `staged\/reflect-\{n\}\.md` Skill-updates row declines first, through/,
  'reflect-apply decline call': /`bin\/reflect-apply\.js --run \{item-run-dir\} --item '\{name\}' --decline 'declined at Review Console, no reason given'`/,
  'decline recorded not only logged': /the decline is recorded, not only logged/,
  'ticked rows apply via step 2 with --only': /the ticked ones then apply through "On approval" step 2's reflect clause with `--only '\{name\},…'` naming exactly the ticked rows/,
  'never a plain run': /never a plain run, which would apply the unticked ones too/,
  'skipped when no reflect row is ticked': /and skipped when no reflect row is ticked \(`--only` naming no item exits 2\)\./,
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
  const routing = h2Section(CONSOLE_EXECUTION, '## Execution routing');
  assertEachFactGoesRed(routing, ROUTING_FACTS);
  // The order is the contract: the decline lands before the ticked rows' apply, which never runs plain.
  assert.ok(routing.includes('--only'), 'the reflect clause must name --only');
  assert.ok(routing.indexOf('--decline') < routing.indexOf('--only \'{name},…\''), 'the decline must be ordered before the --only apply');
});

// --- Task 8: the multi-spec console (site 10) --------------------------------------------------------

const MULTI_CONSOLE_PATH = path.join(ROOT, 'plugin', 'skills', 'flow', 'multispec-review-console.md');
const MULTI_CONSOLE = readAt('flow', 'multispec-review-console.md');
const MULTI_TEMPLATE = readAt('flow', 'multispec-console-template.md');
const { RAIL_BYTES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'skill-audit', 'budgets'));

// The list line that starts with `prefix` (e.g. "2. For each `spec-{N}/`"), within the section that
// starts at `head` — one line, both anchors asserted.
function listLineIn(text, head, prefix) {
  const h = text.indexOf(head);
  assert.notEqual(h, -1, `missing "${head}"`);
  const start = text.indexOf(`\n${prefix}`, h);
  assert.notEqual(start, -1, `missing the line starting "${prefix}" under "${head}"`);
  const end = text.indexOf('\n', start + 1);
  assert.notEqual(end, -1, `missing the newline after the "${prefix}" line`);
  return text.slice(start + 1, end);
}

// multispec-console-template.md's `#### Skill updates` section, to the next `#### ` heading.
function multiSkillUpdatesSection(text) {
  const start = text.indexOf('#### Skill updates');
  assert.notEqual(start, -1, 'missing "#### Skill updates"');
  const end = text.indexOf('\n#### ', start + 1);
  assert.notEqual(end, -1, 'missing the heading after "#### Skill updates"');
  return text.slice(start, end);
}

const MULTI_READ_FACTS = {
  'Skill updates read, reflect rows named': /Skill updates \(each spec's `staged\/reflect-\{n\}\.md` observation\/convention rows\)/,
};
const MULTI_APPROVAL_FACTS = {
  'reflect row per step 2 clause': /each spec's `staged\/reflect-\{n\}\.md` row per `wrap-up\/review-console\.md` step 2's reflect clause/,
  'item-run-dir is the spec dir': /`\{item-run-dir\}` its `spec-\{N\}` dir/,
};
const MULTI_OVERRIDE_FACTS = {
  'reflect skip declines per clause': /a reflect row's `skip \{#\}` declines per that clause/,
};
const MULTI_TEMPLATE_FACTS = {
  'reflect rows named': /`staged\/reflect-\{n\}\.md`/,
  'after the engine output': /after the engine output/,
  'contributing spec in Spec column': /contributing spec in the Spec column/,
  'same rule as the single-spec template': /same rule as `wrap-up\/console-template\.md`/,
};

test('multispec-review-console.md: step 2 reads each spec\'s staged/reflect- rows', () => {
  const line = listLineIn(MULTI_CONSOLE, '## When to run the consolidated console', '2. For each `spec-{N}/`');
  assert.ok(line.includes('staged/reflect-'), 'step 2 must name staged/reflect-');
  assertEachFactGoesRed(line, MULTI_READ_FACTS);
});

test('multispec-review-console.md: On approval step 5 applies reflect rows per review-console.md step 2\'s clause', () => {
  const line = listLineIn(MULTI_CONSOLE, '## On approval (option 1)', '5. Apply skill updates and create new skills');
  assert.ok(line.includes('review-console.md` step 2'), 'step 5 must cite review-console.md step 2');
  assert.ok(line.includes('reflect'), 'step 5 must name reflect');
  assertEachFactGoesRed(line, MULTI_APPROVAL_FACTS);
});

test('multispec-review-console.md: On override step 2 declines a reflect row\'s skip per the same clause', () => {
  const line = listLineIn(MULTI_CONSOLE, '## On override (option 2)', '2. ');
  assertEachFactGoesRed(line, MULTI_OVERRIDE_FACTS);
});

test('multispec-console-template.md: the Skill updates section renders the staged/reflect- rows', () => {
  const section = multiSkillUpdatesSection(MULTI_TEMPLATE);
  assert.ok(section.includes('staged/reflect-'), 'the Skill updates section must name staged/reflect-');
  assertEachFactGoesRed(section, MULTI_TEMPLATE_FACTS);
});

test('multispec-review-console.md stays under the Read-limit rail (budgets.js RAIL_BYTES)', () => {
  const size = fs.statSync(MULTI_CONSOLE_PATH).size;
  assert.ok(size < RAIL_BYTES, `multispec-review-console.md is ${size} B, rail ${RAIL_BYTES} B`);
});
