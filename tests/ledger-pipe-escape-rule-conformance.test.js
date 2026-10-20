// tests/ledger-pipe-escape-rule-conformance.test.js
// Pins the ledger `\|` rule: stated once in skills/_shared/ledger-format.md's
// Format section, cited (never restated) by every prose writer of a ledger row.
// The code half (escapeLedgerCell / splitLedgerRow / flipLedgerRow) is covered by
// its own suites; this file pins the prose half.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(REPO_ROOT, rel));

const CITE = "`_shared/ledger-format.md`'s Format section";
const RULE_LEAD = '**A `|` inside a cell is written `\\|`.**';
const RULE_RE = /\*\*A `\|` inside a cell is written `\\\|`\.\*\*/;

// One shared assertion helper: the positive test runs it on the real files, the
// go-red control runs it on a copy of ledger-format.md with the rule removed.
function assertRuleSites({ format, ledgerSkill, routing, dispatch }) {
  assert.match(format, RULE_RE, 'ledger-format.md Format section must state the pipe rule');
  assert.equal(format.match(new RegExp(RULE_RE.source, 'g')).length, 1, 'ledger-format.md must state the pipe rule exactly once');
  for (const name of ['ledger-cells.js', 'escapeLedgerCell', 'splitLedgerRow', 'ledgerRowCells', 'flipLedgerRow']) {
    assert.ok(format.includes(name), `pipe rule paragraph must name ${name}`);
  }
  const citers = { 'ledger/SKILL.md': ledgerSkill, 'review/step3-routing.md': routing, 'build/dispatch.md': dispatch };
  for (const [file, text] of Object.entries(citers)) {
    const citesWithPipe = text.split('\n').some((line) => line.includes(CITE) && line.includes('`|`'));
    assert.ok(citesWithPipe, `${file} must cite ${CITE} on a line that also mentions \`|\``);
    assert.ok(!text.includes('escapeLedgerCell'), `${file} must cite the rule, not restate escapeLedgerCell`);
  }
}

test('AC1.1: ledger-format.md states the pipe rule once and the three prose writers cite it', () => {
  assertRuleSites({
    format: read('plugin/skills/_shared/ledger-format.md'),
    ledgerSkill: read('plugin/skills/ledger/SKILL.md'),
    routing: read('plugin/skills/review/step3-routing.md'),
    dispatch: read('plugin/skills/build/dispatch.md'),
  });
});

test('AC1.1 go-red control: the shared helper throws when the rule paragraph is removed from a copy of ledger-format.md', () => {
  const format = read('plugin/skills/_shared/ledger-format.md');
  const paragraph = format.split('\n\n').find((p) => p.startsWith(RULE_LEAD));
  assert.ok(paragraph, 'control needs the rule paragraph present in the real file to remove it');
  const mutated = format.replace(paragraph, '');
  assert.notEqual(mutated, format);
  assert.throws(
    () => assertRuleSites({
      format: mutated,
      ledgerSkill: read('plugin/skills/ledger/SKILL.md'),
      routing: read('plugin/skills/review/step3-routing.md'),
      dispatch: read('plugin/skills/build/dispatch.md'),
    }),
    { name: 'AssertionError', message: /ledger-format\.md Format section must state the pipe rule/ },
  );
});

test('AC1.1 go-red control: the shared helper throws when the citation sentence is removed from a copy of review/step3-routing.md', () => {
  const routing = read('plugin/skills/review/step3-routing.md');
  const sentence = ` A finding whose text quotes a \`|\` is escaped per ${CITE} before its row is appended.`;
  assert.ok(routing.includes(sentence), 'control needs the citation sentence present in the real file to remove it');
  const mutated = routing.replace(sentence, '');
  assert.notEqual(mutated, routing);
  assert.throws(
    () => assertRuleSites({
      format: read('plugin/skills/_shared/ledger-format.md'),
      ledgerSkill: read('plugin/skills/ledger/SKILL.md'),
      routing: mutated,
      dispatch: read('plugin/skills/build/dispatch.md'),
    }),
    { name: 'AssertionError', message: /review\/step3-routing\.md must cite/ },
  );
});
