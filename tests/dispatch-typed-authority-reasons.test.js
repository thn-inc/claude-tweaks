// tests/dispatch-typed-authority-reasons.test.js — #5584 AC19.2.
//
// Reads dispatch/queue-pull-notes.md's `## Typed command` section live: its reason table restates
// bin/lib/issues/build-authority.js's REASONS and REMEDIES, so updating the table IS the intended
// response to a change there — the [IL-80] live-read carve-out (the same as
// tests/wrap-up-registry-pin.test.js). The first column must equal REASONS in order, the remedy
// column REMEDIES[word] byte for byte. The section's quoted lines come from formatAuthorityLine
// (the two composed lines, built here through the composer) and from admitNamed's fixed lines in
// bin/lib/dispatch/queue-pull.js, whose code side tests/bin-lib/dispatch/queue-pull.test.js pins
// with the same literals. It also pins that dispatch/SKILL.md and _shared/headless-self-report.md
// no longer say the `#N` forms need the label or always run with a person present.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { sectionOf } = require('./helpers/conformance-asserts');
const { REASONS, REMEDIES, formatAuthorityLine } = require('../plugin/bin/lib/issues/build-authority');

const ROOT = path.join(__dirname, '..');
const DISPATCH = path.join(ROOT, 'plugin', 'skills', 'dispatch');
const NOTES = readText(path.join(DISPATCH, 'queue-pull-notes.md'));
const SKILL = readText(path.join(DISPATCH, 'SKILL.md'));
const SELF_REPORT = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'headless-self-report.md'));
const HEADING = '## Typed command';

// The section's first table -> [{ word, remedy }]. Each row is `| `word` | meaning | `remedy` |`.
function tableRows(section) {
  const lines = section.split('\n');
  const start = lines.findIndex((l) => l.startsWith('| '));
  assert.notEqual(start, -1, 'no table in the Typed command section');
  const rows = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i += 1) {
    const cells = lines[i].split(' | ');
    const word = /^\| `([a-z-]+)`$/.exec(cells[0]);
    const remedy = /^`(.+)` \|$/.exec(cells[cells.length - 1]);
    assert.ok(word && remedy && cells.length === 3, `not a word | meaning | remedy row: ${lines[i]}`);
    rows.push({ word: word[1], remedy: remedy[1] });
  }
  return rows;
}

function assertTablePinned(notes) {
  const rows = tableRows(sectionOf(notes, HEADING));
  assert.deepEqual(rows.map((r) => r.word), [...REASONS], 'the reason column must list REASONS in order');
  for (const { word, remedy } of rows) assert.equal(remedy, REMEDIES[word], `the ${word} remedy must be REMEDIES['${word}']`);
}

test('the reason table lists the 21 REASONS in order, each with its REMEDIES text (AC19.2)', () => {
  assert.equal(REASONS.length, 21);
  assertTablePinned(NOTES);
});

test('go-red: a dropped, reordered or reworded row fails the table pin', () => {
  const row = (word) => NOTES.split('\n').find((l) => l.startsWith(`| \`${word}\` |`));
  const dropped = NOTES.replace(`${row('expired')}\n`, '');
  assert.notEqual(dropped, NOTES);
  assert.throws(() => assertTablePinned(dropped), { message: /REASONS in order/ });
  const swapped = NOTES.replace(`${row('remote')}\n${row('hub-run')}\n`, `${row('hub-run')}\n${row('remote')}\n`);
  assert.notEqual(swapped, NOTES);
  assert.throws(() => assertTablePinned(swapped), { message: /REASONS in order/ });
  const reworded = NOTES.replace(row('launcher'), row('launcher').replace('CC_LAUNCHED_BY=user', 'CC_LAUNCHED_BY=hub'));
  assert.notEqual(reworded, NOTES);
  assert.throws(() => assertTablePinned(reworded), { message: /launcher remedy/ });
  // A row moved out of the section no longer counts.
  const movedOut = `${dropped}\n## Elsewhere\n\n| Word | Meaning | Remedy |\n|---|---|---|\n${row('expired')}\n`;
  assert.throws(() => assertTablePinned(movedOut), { message: /REASONS in order/ });
});

// The lines the pull prints for a named record outside the pool, with `{n}` for the number.
const COMPOSED_ADMIT = formatAuthorityLine('{n}', { authority: 'typed', reasons: [] });
const COMPOSED_REFUSAL = formatAuthorityLine('{n}', { authority: 'none', reasons: ['{reason words}'] })
  .replace(REMEDIES['not-named'].split('#N').join('#{n}'), '{remedy}');
const FIXED_LINES = [
  "#{n} carries auto:build but is not in this pull's queue — not built this firing",
  '#{n} is {state} — not built: the queue pull takes open records only',
  '#{n} is already claimed (bot:in-progress) — not built this firing',
  '#{n} not admitted: the decisions.md audit line could not be written',
  '#{n}: --named admits nothing under --transport files; the auto:build label is required',
];

function assertLinesQuoted(notes) {
  const section = sectionOf(notes, HEADING);
  for (const line of [COMPOSED_ADMIT, COMPOSED_REFUSAL, ...FIXED_LINES]) {
    assert.ok(section.includes(`\`${line}\``), `the Typed command section does not quote: ${line}`);
  }
  assert.match(section.replace(/\s+/g, ' '), /A typed command writes no label/, 'the section must say a typed command writes no label');
  // The separator the section states is the one the composer joins two reason words with.
  const sep = /joined with `([^`]+)`/.exec(section);
  assert.ok(sep, 'the section must state how the reason words are joined');
  const two = formatAuthorityLine(1, { authority: 'none', reasons: ['remote', 'hub-run'] });
  assert.ok(two.includes(`(remote${sep[1]}hub-run)`), `the stated separator \`${sep[1]}\` is not the one in: ${two}`);
}

test('the section quotes every line the named path prints, the composed ones built through formatAuthorityLine', () => {
  assert.ok(COMPOSED_REFUSAL.includes('({reason words}); {remedy} ('), COMPOSED_REFUSAL);
  assertLinesQuoted(NOTES);
  for (const line of [COMPOSED_ADMIT, COMPOSED_REFUSAL, FIXED_LINES[1]]) {
    const mutated = NOTES.split(`\`${line}\``).join('`#{n} skipped`');
    assert.notEqual(mutated, NOTES);
    assert.throws(() => assertLinesQuoted(mutated), { message: /does not quote/ });
  }
  const noLabelClause = NOTES.split('A typed command writes no label').join('A typed command writes the label');
  assert.notEqual(noLabelClause, NOTES);
  assert.throws(() => assertLinesQuoted(noLabelClause), { message: /writes no label/ });
  const otherSep = NOTES.split('joined with `, `').join('joined with `; `');
  assert.notEqual(otherSep, NOTES);
  assert.throws(() => assertLinesQuoted(otherSep), { message: /stated separator/ });
});

// ---- SKILL.md and headless-self-report.md: the retired claims ----

const bullet = (text, anchor) => {
  const line = text.split('\n').find((l) => l.startsWith(anchor));
  assert.ok(line, `${anchor} bullet not found`);
  return line;
};

function assertSkillReworded(skill) {
  const step2 = skill.slice(skill.indexOf('### Step 2:'), skill.indexOf('### Step 3:'));
  assert.ok(step2.includes('--named <the numbers> --run "$RUN_ID"'), 'Step 2 must pass --named and --run on the #N forms');
  const single = bullet(skill, '**`#N`** — direct.');
  const list = bullet(skill, '**`#N[,#M,#O...]`**');
  assert.ok(!single.includes('currently carries `auto:build`'), 'the #N bullet still requires the label');
  assert.ok(single.includes("`queue-pull-notes.md`'s Typed command section"), 'the #N bullet must cite the Typed command section');
  assert.ok(!list.includes('no `auto:build` grant'), 'the list bullet still reports a missing grant');
  assert.ok(list.includes("the queue pull's typed-command line"), "the list bullet must report the queue pull's typed-command line");
  assert.ok(!skill.includes('those always run with a human present'), 'SKILL.md still says the #N forms always run with a human present');
}

function assertSelfReportReworded(text) {
  const flat = text.replace(/\s+/g, ' ');
  assert.ok(!/Dispatch's explicit `#N`\/`#N,#M,\.\.\.` forms always run with a human present/.test(flat), 'headless-self-report.md still says dispatch #N forms always run with a human present');
  assert.ok(!flat.includes('the explicit `#N`/`#N,#M,...` forms always run with a human present (per the Input table in `dispatch/SKILL.md`)'),
    "headless-self-report.md's scope paragraph still says dispatch #N forms always run with a human present");
}

test('SKILL.md passes --named on the #N forms and no longer requires the label for them', () => {
  assertSkillReworded(SKILL);
  for (const [from, to] of [
    ['--named <the numbers> --run "$RUN_ID"', '--named <the numbers>'],
    ["`queue-pull-notes.md`'s Typed command section", '`queue-pull-notes.md`'],
    ["the queue pull's typed-command line", 'no `auto:build` grant'],
  ]) {
    const mutated = SKILL.split(from).join(to);
    assert.notEqual(mutated, SKILL, from);
    assert.throws(() => assertSkillReworded(mutated), assert.AssertionError, from);
  }
  assert.throws(() => assertSkillReworded(`${SKILL}\nthose always run with a human present\n`), { message: /human present/ });
});

test('headless-self-report.md no longer says the dispatch #N forms always run with a human present', () => {
  assertSelfReportReworded(SELF_REPORT);
  assert.throws(() => assertSelfReportReworded(`${SELF_REPORT}\nDispatch's explicit \`#N\`/\`#N,#M,...\` forms always run with a human present\n`), { message: /still says dispatch/ });
  assert.throws(() => assertSelfReportReworded(`${SELF_REPORT}\nthe explicit \`#N\`/\`#N,#M,...\` forms always run with a human present (per the Input table in \`dispatch/SKILL.md\`)\n`), { message: /scope paragraph/ });
});
