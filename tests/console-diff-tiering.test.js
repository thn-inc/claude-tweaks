'use strict';
// Pins #906's reversibility-tiered patch-display rule: the canonical statement
// in wrap-up/console-template.md, the citation (not restatement) in
// flow/multispec-console-template.md, and the repo-wide absence of the old
// unconditional show-every-full-patch phrasing (whitespace-normalized, so a
// restatement wrapped mid-phrase cannot slip through).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const CT = path.join(ROOT, 'plugin', 'skills', 'wrap-up', 'console-template.md');
const MSCT = path.join(ROOT, 'plugin', 'skills', 'flow', 'multispec-console-template.md');

// Frozen pre-change bytes (#906) — string literals, not a git read, so they survive
// every later edit to the live files. Per .claude/skills/skill-prose-conformance-tests'
// house pattern: every positive claim below is also checked against these to prove the
// assertion can go red, not just that it currently passes.
const PRE_CHANGE_CT_LINE =
  'Below each table, show the full patch / diff for each pending item so the user can see exactly what will change.';
const PRE_CHANGE_MSCT_LINE =
  'Below each table, show the full patch / diff for each pending item.';

function mdFilesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mdFilesUnder(p));
    else if (entry.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// One claim per call: the pattern must match the live text AND fail against the frozen
// pre-change text, so a green result proves the pattern can actually go red [IL-105].
function assertClaimPinned(liveText, frozenText, pattern, missingMessage) {
  const matches = (s) => (pattern instanceof RegExp ? pattern.test(s) : s.includes(pattern));
  assert.ok(matches(liveText), missingMessage);
  assert.ok(!matches(frozenText), 'pattern must NOT match the pre-change text (proves it can go red)');
}

test('console-template.md states the reversibility-tiered display rule once, in full', () => {
  const text = readText(CT);
  assertClaimPinned(text, PRE_CHANGE_CT_LINE, 'tiered by the item\'s recorded reversibility', 'tier rule heading clause missing');
  assertClaimPinned(text, PRE_CHANGE_CT_LINE, 'cat "{absolute stagePath}"', 'paste-ready view command for the high tier missing');
  assertClaimPinned(text, PRE_CHANGE_CT_LINE, 'fail toward showing more', 'fail-open default (unrecorded reversibility renders full) missing');
  assertClaimPinned(
    text,
    PRE_CHANGE_CT_LINE,
    /`decisions\.md` entry — correlated by `stagePath` basename/,
    'the decisions.md consultation step of the resolution ladder missing — an implementation that always renders full for engine rows must fail this pin',
  );
  assertClaimPinned(text, PRE_CHANGE_CT_LINE, 'no `stagePath` at all also renders in full', 'the no-stagePath full-render branch missing');
});

test('multispec-console-template.md cites the canonical rule instead of restating it', () => {
  const text = readText(MSCT);
  assertClaimPinned(text, PRE_CHANGE_MSCT_LINE, 'console-template.md', 'multispec template must cite wrap-up/console-template.md\'s reversibility-tiered rule (missing file reference)');
  assertClaimPinned(text, PRE_CHANGE_MSCT_LINE, 'reversibility-tiered', 'multispec template must cite wrap-up/console-template.md\'s reversibility-tiered rule (missing "reversibility-tiered" token)');
});

test('the old unconditional full-patch phrasing is gone from plugin/**/*.md', () => {
  const OLD = 'show the full patch / diff for each pending item';
  const offenders = [];
  for (const f of mdFilesUnder(path.join(ROOT, 'plugin'))) {
    const normalized = readText(f).replace(/\s+/g, ' ');
    if (normalized.includes(OLD)) offenders.push(path.relative(ROOT, f));
  }
  assert.deepStrictEqual(offenders, [], 'unconditional full-patch rule restated in: ' + offenders.join(', '));
});
