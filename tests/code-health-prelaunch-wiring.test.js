'use strict';
// #2693: focus=prelaunch must land its criterion, fragment, and both
// focus-mode.md per-vertical rows in the same change as its registry key.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FOCUS_MODE = fs.readFileSync(path.join(ROOT, 'plugin/skills/code-health/focus-mode.md'), 'utf8');
const { getCriterion } = require('../plugin/bin/lib/code-health/criteria');
const { FOCUS_GENERATORS } = require('../plugin/bin/lib/code-health/focus-generators');
const { CHECKLIST_ITEMS } = require('../plugin/bin/lib/code-health/candidates-prelaunch');

function section(md, heading, nextHeading) {
  const start = md.indexOf(`## ${heading}`);
  const end = md.indexOf(`## ${nextHeading}`, start + 1);
  assert.ok(start >= 0 && end > start, `focus-mode.md must have "## ${heading}" followed by "## ${nextHeading}"`);
  return md.slice(start, end);
}

test('the prelaunch criterion is registered with its fragment', () => {
  assert.deepStrictEqual(getCriterion('prelaunch'), {
    id: 'prelaunch',
    appliesTo: ['frontend'],
    confidenceFloor: 'medium',
    fragment: 'criteria-prelaunch.md',
  });
});

test('criteria-prelaunch.md names every checklist item id', () => {
  const fragment = fs.readFileSync(path.join(ROOT, 'plugin/skills/_shared/criteria-prelaunch.md'), 'utf8');
  for (const item of CHECKLIST_ITEMS) {
    assert.ok(fragment.includes(`\`${item.id}\``), `fragment missing checklist item \`${item.id}\``);
  }
});

test('criteria-prelaunch.md reconciles checklist rows with verdicts and names the site-level anchor', () => {
  const fragment = fs.readFileSync(path.join(ROOT, 'plugin/skills/_shared/criteria-prelaunch.md'), 'utf8');
  assert.match(fragment, /`fail` whose candidates you all rejected → `pass \(N rejected: \{reason\}\)`/);
  assert.match(fragment, /anchor such a finding as `\{file\}#\{item id\}`/);
  assert.doesNotMatch(fragment, /`pass`\/`fail`, verified/);
});

test('focus-mode.md pins prelaunch to its criterion and fragment', () => {
  const pinning = section(FOCUS_MODE, 'Criterion pinning', 'F0');
  assert.match(pinning, /^\| `prelaunch` \| `prelaunch` \| `criteria-prelaunch\.md` \|$/m);
});

test('focus-mode.md Coverage points at the prelaunch generator', () => {
  assert.match(section(FOCUS_MODE, 'Coverage', 'Criterion pinning'), /candidates-prelaunch\.js/);
});

test('focus-mode.md F1/F2 handle the checklist array and the not-applicable result', () => {
  assert.match(section(FOCUS_MODE, 'F1', 'F2'), /`checklist`/);
  const f2 = section(FOCUS_MODE, 'F2', 'F3');
  assert.match(f2, /`notApplicable: true`/);
  assert.match(f2, /focus=prelaunch: not applicable — no web pages detected/);
});

test('every registered focus has a Criterion-pinning row', () => {
  const pinning = section(FOCUS_MODE, 'Criterion pinning', 'F0');
  for (const key of Object.keys(FOCUS_GENERATORS)) {
    assert.ok(pinning.includes(`| \`${key}\` |`), `no Criterion-pinning row for focus \`${key}\``);
  }
});
