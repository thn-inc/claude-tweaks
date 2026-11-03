'use strict';
// tests/build-verify-after-doc-steps.test.js — pins #3060: build's journeys (Common Step 6) and
// docs sync (Common Step 6.5) must run before final verification (Common Step 5), so the verified
// tree includes them. Common Steps are executed in file order, so the headings' order is the
// execution order.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const BUILD_SKILL = readText(path.join(ROOT, 'plugin', 'skills', 'build', 'SKILL.md'));
const CHECKLIST = readText(path.join(ROOT, 'plugin', 'skills', 'build', 'operational-checklist.md'));

function sectionOf(text, heading) {
  const start = text.indexOf(heading);
  assert.ok(start > -1, `heading must exist: ${heading}`);
  const next = text.indexOf('\n### ', start + heading.length);
  return text.slice(start, next === -1 ? undefined : next);
}

function section(heading) {
  return sectionOf(BUILD_SKILL, heading);
}

test('AC1.1: Common Step headings appear in execution order 4.5 < 6 < 6.5 < 5 < 5.5 < 7', () => {
  const headings = [
    '### Common Step 4.5',
    '### Common Step 6:',
    '### Common Step 6.5:',
    '### Common Step 5:',
    '### Common Step 5.5:',
    '### Common Step 7:',
  ];
  const indices = headings.map((h) => BUILD_SKILL.indexOf(h));
  indices.forEach((idx, i) => assert.ok(idx > -1, `heading must exist: ${headings[i]}`));
  for (let i = 1; i < indices.length; i++) {
    assert.ok(indices[i] > indices[i - 1], `${headings[i]} must come after ${headings[i - 1]}`);
  }
});

test('AC1.2: Common Step 6 section does not contain "After verification passes"', () => {
  assert.ok(!section('### Common Step 6:').includes('After verification passes'));
});

test('AC1.3: Common Step 5 section names Common Steps 6 and 6.5', () => {
  assert.match(section('### Common Step 5:'), /Common Steps 6 and 6\.5/);
});

function assertCategoryABeforeVerify(text) {
  const step5 = sectionOf(text, '### Common Step 5:');
  assert.match(step5, /\*\*Operational fixes first \(#3489\)\.\*\*/);
  assert.match(step5, /`operational-checklist\.md`'s Category A triggers \(schema\/migration files, a changed shared-constant value, new env access, a changed `package\.json` `exports`\), read that file's Category A section in this skill's directory, then apply that file's Category A fixes and commit them with `Category A` in the subject, so the verified tree includes them/);
  assert.match(step5, /re-check those triggers against any fix commit below before re-running verification/);
  assert.match(step5, /A Category A action that fails or cannot complete .* is not `fixed`: resolve it like any failure in this step, or leave it `open` for Common Step 5\.5's ledger row/);
  // the fix runs before the verification run: the paragraph follows the verification sentence and says so
  assert.match(step5, /Before that run, when the build's diff matches/);
  const verifyAt = step5.indexOf('run the shared verification procedure');
  const categoryAAt = step5.indexOf('**Operational fixes first (#3489).**');
  assert.notStrictEqual(verifyAt, -1, 'Common Step 5 must keep the verification sentence marker');
  assert.notStrictEqual(categoryAAt, -1, 'Common Step 5 must keep the Category A paragraph marker');
  assert.ok(
    verifyAt < categoryAAt,
    'the Category A paragraph must follow the verification sentence its "Before that run" points back to',
  );
  assert.match(step5, /Category B tasks and every ledger row stay in Common Step 5\.5/);
  assert.doesNotMatch(step5, /\*\*On skip\*\*/);
  const step55 = sectionOf(text, '### Common Step 5.5:');
  assert.match(step55, /Category A fixes already landed in Common Step 5, before its verification run/);
  assert.match(step55, /a `fixed` row per Category A fix/);
  // a shared-constant or exports-only Category A fix must still reach Step 5.5's ledger row
  assert.match(step55, /schema\/env\/IaC\/CI\/platform-config files, or Common Step 5 applied a Category A fix \(a `Category A` commit in `git log` since build start\), read/);
  assert.doesNotMatch(step55, /Operational fixes first/);
  assert.doesNotMatch(step55, /\bapply\b[^.\n]*Category A/, 'Step 5.5 must not apply Category A fixes after verification');
}

test('#3489 AC1.1: Common Step 5 applies Category A operational fixes before its verification; Step 5.5 does not', () => {
  assertCategoryABeforeVerify(BUILD_SKILL);
});

// `message` is the failing assertion's own message (the first line of a `match` failure names the
// pattern), so a doctoring cannot go red on an earlier, unrelated assertion and leave the one it
// targets vacuous.
function assertDoctoredGoesRed(doctored, doctoringDescription, message) {
  assert.notEqual(doctored, BUILD_SKILL, `doctoring must actually ${doctoringDescription}`);
  assert.throws(() => assertCategoryABeforeVerify(doctored), { name: 'AssertionError', message });
}

test('#3489 AC1.1 go-red: the assertion fails when the Step 5 paragraph is removed', () => {
  const doctored = BUILD_SKILL.replace(/\*\*Operational fixes first \(#3489\)\.\*\*[^\n]*\n\n/, '');
  assertDoctoredGoesRed(doctored, 'remove the paragraph', /^The input did not match the regular expression [^\n]*Operational fixes first/);
});

test('#3489 AC1.1 go-red: the assertion fails when the widened Step 5.5 entry clause is reverted', () => {
  const doctored = BUILD_SKILL.replace(', or Common Step 5 applied a Category A fix', '');
  assertDoctoredGoesRed(doctored, 'remove the widened clause', /^The input did not match the regular expression [^\n]*applied a Category A fix/);
});

test('#3489 AC1.1 go-red: the assertion fails when the Step 5 paragraph says the fix runs after verification', () => {
  const doctored = BUILD_SKILL.replace('Before that run, when the build', 'After that run, when the build');
  assertDoctoredGoesRed(doctored, 'change the timing word', /^The input did not match the regular expression [^\n]*Before that run/);
});

test('#3489 AC1.1 go-red: the assertion fails when the Step 5 paragraph is spliced above the verification sentence', () => {
  const paragraph = BUILD_SKILL.match(/\*\*Operational fixes first \(#3489\)\.\*\*[^\n]*\n\n/)[0];
  const doctored = BUILD_SKILL.replace(paragraph, '').replace('After Common Steps 6 and 6.5, so the verified tree', `${paragraph}After Common Steps 6 and 6.5, so the verified tree`);
  assertDoctoredGoesRed(doctored, 'splice the paragraph above the verification sentence', /^the Category A paragraph must follow the verification sentence/);
});

test('#3489 AC1.1 go-red: the assertion fails when Step 5.5 regains an instruction to apply Category A fixes', () => {
  const doctored = BUILD_SKILL.replace('After verification passes, check for operational tasks', 'After verification passes, apply Category A fixes and check for operational tasks');
  assertDoctoredGoesRed(doctored, 'add the instruction', /^Step 5\.5 must not apply Category A fixes after verification/);
});

test('#3489 AC1.1: operational-checklist.md applies Category A in Step 5 and writes its ledger rows in Step 5.5', () => {
  assert.ok(CHECKLIST.includes('## Category A'), 'heading must exist: ## Category A');
  assert.ok(CHECKLIST.includes('## Category B'), 'heading must exist: ## Category B');
  const catA = CHECKLIST.split('## Category A')[1].split('## Category B')[0];
  const catARows = catA.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Check |') && !l.startsWith('|---'));
  assert.equal(
    catARows.length,
    4,
    'Category A table row count changed: update the inline trigger list in SKILL.md\'s Common Step 5 "Operational fixes first" paragraph to match, then update this count',
  );
  for (const name of ['Schema changes', 'Shared constant value changed', 'New environment variables', 'New package exports']) {
    assert.ok(
      catARows.some((l) => l.startsWith(`| ${name} |`)),
      `Category A check "${name}" missing or renamed: update the inline trigger list in SKILL.md's Common Step 5 "Operational fixes first" paragraph to match, then update this name list`,
    );
  }
  assert.match(catA, /Common Step 5 applies them before its verification run/);
  assert.match(catA, /Common Step 5\.5 appends each Category A finding to the open items ledger/);
  assert.match(catA, /`open` for a schema change with no documented push command/);
});
