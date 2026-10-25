// tests/auto-mode-contract-tiebreak-drop-conformance.test.js — #3949: the auto-mode contract
// carries the one-decision amendment that lets a tiebreak-refuted drop clear the findings
// severity ceiling. Reading the live prose is the declared carve-out (skill-prose-conformance-tests,
// [IL-80]): the amendment IS the contract text, so editing it is the response to a change here.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.resolve(__dirname, '..');
const HEADING = '### Tiebreak-refuted drop (one-decision amendment)';

// The subsection from its heading to the next `##`/`###` heading. Throws (with its own
// message) when the heading is gone or unbounded.
function subsection(text) {
  const start = text.indexOf(HEADING);
  assert.notEqual(start, -1, `the contract has no "${HEADING}" subsection`);
  const rest = text.slice(start + HEADING.length);
  const next = rest.search(/\n##+ /);
  assert.notEqual(next, -1, 'the tiebreak-drop subsection has no following heading to bound it');
  return rest.slice(0, next);
}

function assertAmendment(text) {
  const body = subsection(text);
  assert.match(body, /outcome `drop`/, 'the amendment must key on resolveTiebreak outcome `drop`');
  for (const mode of ['auto', 'confirm', 'hybrid', 'interactive']) {
    assert.ok(body.includes(`\`${mode}\``), `the amendment must name mode \`${mode}\``);
  }
  assert.match(body, /Confidence `high`/i, 'the amendment must count the drop as Confidence `high`');
  assert.match(body, /exempt from the (findings )?severity ceiling/i, 'the amendment must exempt the drop from the severity ceiling');
  assert.match(body, /does not loosen the (severity )?ceiling for applying fixes/i, 'the amendment must leave the fixes ceiling unchanged');
  assert.match(body, /can't-tell/, 'the amendment must name the can\'t-tell case');
  assert.match(body, /never dropped/i, 'a can\'t-tell item must be stated as never dropped');
}

const CONTRACT = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'auto-mode-contract.md'));

test('the auto-mode contract carries the tiebreak-refuted drop amendment', () => {
  assertAmendment(CONTRACT);
});

test('go-red control: doctoring the fixes-ceiling clause makes the assertion throw', () => {
  const doctored = CONTRACT.replace(/does not loosen the (severity )?ceiling for applying fixes/i, 'REMOVED');
  assert.notEqual(doctored, CONTRACT, 'the replace matched nothing');
  assert.throws(() => assertAmendment(doctored), /fixes ceiling unchanged/);
});
