'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { GATE_FRAGMENTS } = require('../../tools/guard-refusals/transcripts');
const { readText } = require('../helpers/read-skill');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../helpers/strip-comments');

// #5587 AC2: every GATE_FRAGMENTS fragment is deny text a plugin gate really emits. The fragments are
// substrings of the gates' deny messages in the two files below, matched over keep-literals stripped
// text (comments blanked to spaces, string literals kept), so a fragment that survives only in a
// comment fails. Recall limits: a deny message built from two literals joined across a `+` is only
// seen when the fragment sits inside one literal, which is how every fragment here was chosen; a
// fragment is matched as a substring, so a fragment that also occurs in unrelated code passes. The
// stripper-verdict oracle cannot see a mis-parse whose stripped text still compiles (one that keeps a
// comment's text), so in keep mode a fragment surviving only in a comment could pass.

const GATE_FILES = [
  path.join(__dirname, '..', '..', 'plugin', 'bin', 'lib', 'hooks', 'pre-tool-use.js'),
  path.join(__dirname, '..', '..', 'plugin', 'bin', 'lib', 'hooks', 'dispatch-prompt-gate.js'),
];

// The verdict of one raw/stripped pair as an offender line, or null when it parsed.
function verdictOffender(label, raw, stripped) {
  const verdict = stripperVerdict(raw, stripped);
  return verdict === 'ok' ? null : `${label}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`;
}

// Every fragment of `table` absent from all of `texts`.
function missingFragments(table, texts) {
  const missing = [];
  for (const [gate, fragments] of table) {
    for (const fragment of fragments) {
      if (!texts.some((t) => t.includes(fragment))) missing.push(`${gate}: ${fragment}`);
    }
  }
  return missing;
}

function loadStripped() {
  const offenders = [];
  const texts = [];
  for (const file of GATE_FILES) {
    const raw = readText(file);
    const stripped = stripComments(raw);
    const offender = verdictOffender(path.basename(file), raw, stripped);
    if (offender) offenders.push(offender);
    texts.push(stripped);
  }
  return { offenders, texts };
}

test('AC2: every GATE_FRAGMENTS fragment occurs in the code of pre-tool-use.js or dispatch-prompt-gate.js', () => {
  const { offenders, texts } = loadStripped();
  assert.deepEqual(offenders, []);
  assert.ok(texts.every((t) => t.length > 1000), 'both gate files were read');
  assert.ok(GATE_FRAGMENTS.length >= 10, 'the table did not shrink');
  assert.deepEqual(missingFragments(GATE_FRAGMENTS, texts), []);
});

test('AC2 go-red: a fragment absent from both files is reported', () => {
  const { texts } = loadStripped();
  const missing = missingFragments([...GATE_FRAGMENTS, ['x', ['no such deny text zz']]], texts);
  assert.deepEqual(missing, ['x: no such deny text zz']);
});

test('AC2 go-red: a fragment kept only in a comment is reported', () => {
  const raw = "// the deny text zz lives here\nconst a = 'real deny text';\n";
  assert.deepEqual(missingFragments([['c', ['deny text zz']]], [stripComments(raw)]), ['c: deny text zz']);
  assert.deepEqual(missingFragments([['c', ['real deny text']]], [stripComments(raw)]), []);
});

test('AC2 go-red: a planted mis-parse is an offender', () => {
  const raw = "if (b) /'/.test(b); const c = 'x';";
  const stripped = stripComments(raw, { literals: 'blank' });
  assert.notEqual(stripperVerdict(raw, stripped), 'ok');
  assert.ok(verdictOffender('planted', raw, stripped));
  assert.equal(verdictOffender('planted', raw, stripComments(raw)), null);
});
