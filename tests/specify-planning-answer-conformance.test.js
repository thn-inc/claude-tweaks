'use strict';
// #6059: pins /specify case 1's planning-hold routing (plugin/skills/specify/SKILL.md) and the
// work-record.md sentence naming the hold. Read live: these files are the declared contract.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');

const ROOT = path.join(__dirname, '..');
const skill = () => readText(path.join(ROOT, 'plugin/skills/specify/SKILL.md'));
const workRecord = () => readText(path.join(ROOT, 'plugin/skills/_shared/work-record.md'));

// A literal as a regex that tolerates a hard wrap at any space.
const lit = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));

// Every fact must be present in the region, and each must go red when stripped alone.
function pinned(region, patterns, label) {
  const missing = missingFactsOf(patterns)(region);
  assert.deepEqual(missing, [], `${label}: missing ${missing.join(' | ')}`);
  assertEachPatternGoesRed(region, patterns, missingFactsOf(patterns));
}
const f = (s, fact) => [lit(s), fact || s];

function caseOne() {
  const text = skill();
  const from = text.indexOf('1. **Work record reference**');
  const to = text.indexOf('2. **Design doc path**');
  assert.notEqual(from, -1, 'case 1 start not found');
  assert.ok(to > from, 'case 2 start not found after case 1');
  return text.slice(from, to);
}

test('D1: case 1 routes a held needs:decision record to planning-answer.md', () => {
  pinned(caseOne(), [
    f('when the fetched labels carry `needs:decision`'),
    f('planning-hold.js" --comments-file'),
    f('read `planning-answer.md` in this skill\'s directory and follow it instead of shaping mode'),
  ], 'routing');
});

test('D5: a headless invocation on a held record refuses naming the planning hold', () => {
  pinned(caseOne(), [
    f('`shaping-mode-stamping.md`\'s `### Risk flags` step 2 defines it'),
    f('`#{n} is held for planning question(s) — answer them with /claude-tweaks:specify #{n} where a human can reply`'),
  ], 'headless refusal');
});

test('AC3.1 + AC5.1 + AC5.2: a record that is not a planning hold keeps today\'s behaviour', () => {
  pinned(caseOne(), [
    f('reason `untrusted`, `unparseable` or `ambiguous`'),
    f('`#{n}\'s decision comment is not a usable planning hold ({reason}) — shaping it as before`'),
    f('Reasons `not-planning` and `no-decision-comment`: continue as today, no notice'),
    f('A failed comment fetch or a non-zero CLI exit: the same notice with reason `unreadable`, then continue as today'),
  ], 'not-held');
});

test('Review Focus 5: a batch with a held element fails whole', () => {
  pinned(caseOne(), [
    f('`\'{element}\' is held for planning question(s) — run /claude-tweaks:specify #{element} on its own to answer them, then re-run the batch without it`'),
    f('the planning-hold routing, and the `needs:definition` check above, per element'),
  ], 'batch');
});

test('case 5 applies the routing by reference', () => {
  const text = skill();
  const from = text.indexOf('5. **Backlog reference**');
  assert.notEqual(from, -1, 'case 5 start not found');
  pinned(text.slice(from), [
    f('also apply case 1\'s **planning-hold routing** by reference'),
  ], 'case 5');
});

test('the routing paragraph sits after the digest-container guard and before the needs:definition redirect', () => {
  const region = caseOne();
  const digest = region.indexOf('**Digest-container guard');
  const hold = region.indexOf('planning-hold.js');
  const redirect = region.indexOf('**`needs:definition` redirect');
  assert.ok(digest !== -1 && hold !== -1 && redirect !== -1, 'anchor missing');
  assert.ok(digest < hold && hold < redirect, `order wrong: ${digest} ${hold} ${redirect}`);
});

test('work-record.md names the planning hold', () => {
  pinned(workRecord(), [
    f('`Held-by: specify-planning` line'),
    f('read by `bin/planning-hold.js`'),
  ], 'work-record');
});
