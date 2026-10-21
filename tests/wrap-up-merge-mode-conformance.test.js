'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const flat = (s) => s.replace(/\s+/g, ' ');

// Returns the names of facts whose pattern does not match `text`.
function missingFactsOf(text, facts) {
  return Object.entries(facts).filter(([, re]) => !re.test(text)).map(([name]) => name);
}

// Per fact: strip only that fact's first match and assert exactly [name] goes missing.
function assertEachFactGoesRed(text, facts) {
  for (const [name, re] of Object.entries(facts)) {
    const doctored = text.replace(re, '');
    assert.notEqual(doctored, text, `${name}: pattern matched nothing to strip`);
    assert.deepStrictEqual(missingFactsOf(doctored, facts), [name], `${name}: stripping it must report exactly itself`);
  }
}

const HINT = '[#N|<spec>|<context>|resume] [--dry-run] [--skill-budget <n>] [--doc-budget <n>] [cleanup-only] [merge]';

const MERGE_MODE_FACTS = {
  invocation: /`\/claude-tweaks:wrap-up #\{n\} merge`/,
  'human-confirmation': /typed invocation is the human merge confirmation/,
  tag: /`\{tag\}` = `human-approved`/,
  'no-console-resolve': /never runs `console-resolve\.js`/,
  'no-console-question': /never asks a `"Review Console"`-headed question/,
  'run-dir': /`_shared\/run-dir-resolution\.md`'s resolution order/,
  'not-resume': /not the `resume` form/,
  'precondition-open': /PR is not `OPEN`/,
  'precondition-pr': /`run-state\.json` carries no `pr` object/,
  'precondition-model': /`integration-model: pr-first`/,
  'steps-1-4': /`_shared\/pr-first-merge\.md` Steps 1 through 4/,
  'step-4-1': /Step 4\.1/,
  'section-c': /Section C steps 3\.6-5\.5/,
  'section-e': /Section E/,
  'reconcile-last': /Step 4\.2's reconcile runs last/,
  'reread-merge-state': /re-read `mergeStateStatus`/,
  'rejects-cleanup-only': /`merge` with `cleanup-only` is rejected/,
  'needs-record': /`merge` with no record reference stops/,
  outcomes: /`merged`, `armed`, or `pending-review`/,
  bundle: /--step merge/,
};

// SKILL.md's router bullet: `merge` routes on the token alone, so a bare `merge` reaches
// merge-mode.md's no-record stop instead of being stripped as a flag.
const ROUTER_FACTS = {
  'routes-on-token': /If `\$ARGUMENTS` carries the literal `merge` token anywhere \(`#42 merge` or `merge #42`\), with or without a record reference, read `merge-mode\.md`/,
  'routing-not-flag': /`merge` is a routing token handled before the flag strip, never a flag/,
};

// The region is merge-mode.md before its `## Conflict` heading, so the Conflict body
// (written separately) can never add a second match to one of these facts.
function mergeModeRegion() {
  const raw = read('plugin', 'skills', 'wrap-up', 'merge-mode.md');
  const idx = raw.indexOf('## Conflict');
  assert.notEqual(idx, -1, 'merge-mode.md must carry a `## Conflict` heading');
  return flat(raw.slice(0, idx));
}

test('merge-mode.md carries every Task 1 fact before its Conflict heading', () => {
  assert.deepStrictEqual(missingFactsOf(mergeModeRegion(), MERGE_MODE_FACTS), []);
});

test('merge-mode.md facts each go red when stripped', () => {
  assertEachFactGoesRed(mergeModeRegion(), MERGE_MODE_FACTS);
});

test('wrap-up grammar surfaces carry the merge token', () => {
  const skill = read('plugin', 'skills', 'wrap-up', 'SKILL.md');
  const frontmatterHint = /^argument-hint: "(.*)"$/m.exec(skill);
  assert.ok(frontmatterHint, 'SKILL.md frontmatter has an argument-hint');
  assert.strictEqual(frontmatterHint[1], HINT);

  const inputSection = skill.slice(skill.indexOf('## Input'), skill.indexOf('## Overview'));
  const parseLine = /parsed as `([^`]*)`/.exec(inputSection);
  assert.ok(parseLine, 'SKILL.md ## Input has a parse-line code span');
  assert.strictEqual(parseLine[1], HINT);

  assert.deepStrictEqual(missingFactsOf(flat(skill), ROUTER_FACTS), []);
  assertEachFactGoesRed(flat(skill), ROUTER_FACTS);

  // `merge` is not a flag: the flag strip list must not name it.
  const stripLine = /^Flags \(([^)]*)\) may appear anywhere/m.exec(skill);
  assert.ok(stripLine, 'SKILL.md has the flag strip sentence');
  assert.ok(!/`merge`/.test(stripLine[1]), 'the flag strip list must not include `merge`');

  const flagsMd = read('plugin', 'skills', 'wrap-up', 'flags.md');
  assert.match(flagsMd, /^- \*\*`merge`\*\*/m);
  assert.match(flat(flagsMd), /a routing token, not a flag/);

  const card = read('plugin', 'skills', 'help', 'reference-card.md');
  const row = card.split('\n').find((l) => l.startsWith('| `/claude-tweaks:wrap-up` |'));
  assert.ok(row, 'reference card has a wrap-up row');
  const takes = row.split(/(?<!\\)\|/)[3].trim().replace(/^`|`$/g, '').replace(/\\\|/g, '|');
  assert.strictEqual(takes, HINT);
});
