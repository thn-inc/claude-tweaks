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
  'routes-on-token': /If `\$ARGUMENTS` consists of nothing but the literal `merge` token, at most one record reference \(`#42 merge` or `merge #42`\), and this skill's own flags \(`--dry-run`, `--skill-budget <n>`, `--doc-budget <n>`, `cleanup-only`\), read `merge-mode\.md`/,
  'bare-and-cleanup-route': /A bare `merge` and `merge` with `cleanup-only` route there too/,
  'routing-not-flag': /`merge` is a routing token handled before the flag strip, never a flag/,
  'free-text-falls-through': /Free text that merely contains the word merge \(`fix the merge bug`\) does not route there and falls through to the branches below/,
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

// Task 2: the attended Conflict-path branch. The procedure lives in merge-mode.md's
// `## Conflict` (merge mode's only reader); `_shared/pr-first-merge.md` carries a pointer
// bullet only, because the composed `merge` bundle has too little rail headroom for it.
const ATTENDED_FACTS = {
  'both-intents': /both sides' intent can be kept and stated in one line per file/,
  renumber: /renumbers the branch's own entry and every citation the branch added, never the integration branch's/,
  suite: /`verify\.js`/,
  reenter: /re-enter Step 2\.5 from the top/,
  abort: /`git merge --abort`/,
};
const POINTER_FACTS = {
  scope: /\*\*Attended branch \(merge mode only\)\.\*\*/,
  owner: /`wrap-up\/merge-mode\.md`'s `## Conflict`/,
  'headless-unchanged': /- \*\*Conflict markers remain\*\*: this is what "unresolvable headlessly" means — stop, do not attempt resolution\./,
  'other-callers': /Every other caller keeps the stop-at-markers bullet above/,
};

function conflictRegion() {
  const raw = read('plugin', 'skills', 'wrap-up', 'merge-mode.md');
  const start = raw.indexOf('## Conflict');
  assert.notEqual(start, -1, 'merge-mode.md must carry a `## Conflict` heading');
  const next = raw.indexOf('\n## ', start + 1);
  return flat(next === -1 ? raw.slice(start) : raw.slice(start, next));
}

function conflictPathRegion() {
  const raw = read('plugin', 'skills', '_shared', 'pr-first-merge.md');
  const start = raw.indexOf('## Conflict path');
  const end = raw.indexOf('## Outcome vocabulary');
  assert.notEqual(start, -1, 'pr-first-merge.md must carry a `## Conflict path` heading');
  assert.notEqual(end, -1, 'pr-first-merge.md must carry a `## Outcome vocabulary` heading');
  return flat(raw.slice(start, end));
}

test('merge-mode.md Conflict section carries the attended procedure', () => {
  assert.deepStrictEqual(missingFactsOf(conflictRegion(), ATTENDED_FACTS), []);
});

test('attended Conflict facts each go red when stripped', () => {
  assertEachFactGoesRed(conflictRegion(), ATTENDED_FACTS);
});

test('pr-first-merge.md Conflict path carries the pointer and keeps the headless bullet', () => {
  assert.deepStrictEqual(missingFactsOf(conflictPathRegion(), POINTER_FACTS), []);
});

test('pointer facts each go red when stripped', () => {
  assertEachFactGoesRed(conflictPathRegion(), POINTER_FACTS);
});

test('the pointer bullet stays within its 400 B budget', () => {
  const m = /- \*\*Attended branch \(merge mode only\)\.\*\*[\s\S]*?(?=\n\n|\n- |\n#)/.exec(
    read('plugin', 'skills', '_shared', 'pr-first-merge.md'),
  );
  assert.ok(m, 'pointer bullet present');
  assert.ok(Buffer.byteLength(m[0], 'utf8') <= 400, `pointer is ${Buffer.byteLength(m[0], 'utf8')} B`);
});

test('the composed merge bundle stays within the read-limit rail', () => {
  const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');
  const { composedBytesReport } = require('../plugin/bin/lib/skill-audit/context-cost');
  const rows = composedBytesReport(path.join(ROOT, 'plugin')).filter((r) => r.step === 'merge');
  assert.ok(rows.length > 0, 'at least one compose call site names --step merge');
  for (const r of rows) {
    assert.ok(r.max <= RAIL_BYTES, `${r.file}:${r.line} composes ${r.max} B > ${RAIL_BYTES}`);
  }
});
