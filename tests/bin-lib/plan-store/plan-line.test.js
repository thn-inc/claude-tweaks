'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { composePlanLine, parsePlanLine, SPEC_HASH_EXCLUDED_PREFIXES } = require('../../../plugin/bin/lib/issues/plan-line');

const SHA = 'a'.repeat(40);
const H = 'b'.repeat(64);

test('composePlanLine writes the exact grammar and parsePlanLine reads it back', () => {
  const line = composePlanLine({ record: 7, commit: SHA, specHash: H });
  assert.strictEqual(line, `Plan: refs/claude-tweaks/plans/7 ${SHA} spec-sha256:${H}`);
  assert.deepStrictEqual(parsePlanLine(line), { ok: true, record: 7, ref: 'refs/claude-tweaks/plans/7', commit: SHA, specHash: H });
  assert.strictEqual(parsePlanLine(`${line} \r`).ok, true); // trailing whitespace/CR tolerated
  assert.strictEqual(parsePlanLine(composePlanLine({ record: 7, commit: 'c'.repeat(64), specHash: H })).ok, true); // sha256 repos
});

test('parsePlanLine names why a line is malformed', () => {
  const cases = [
    ['Plan:refs/claude-tweaks/plans/7', 'shape'],
    ['plan: x y z', 'not-plan-line'],
    [`Plan: refs/claude-tweaks/plans/07 ${SHA} spec-sha256:${H}`, 'bad-ref'],
    [`Plan: refs/claude-tweaks/plans/7 ${SHA.toUpperCase()} spec-sha256:${H}`, 'bad-commit'],
    [`Plan: refs/claude-tweaks/plans/7 ${SHA} sha256:${H}`, 'bad-hash'],
    [`Plan: refs/claude-tweaks/plans/7  ${SHA} spec-sha256:${H}`, 'shape'],
  ];
  for (const [line, reason] of cases) assert.deepStrictEqual(parsePlanLine(line), { ok: false, reason });
  assert.throws(() => composePlanLine({ record: 7, commit: 'xyz', specHash: H }), TypeError);
  assert.throws(() => composePlanLine({ record: 0, commit: SHA, specHash: H }), TypeError);
  assert.throws(() => composePlanLine({ record: 7, commit: SHA, specHash: 'zz' }), TypeError);
});

test('SPEC_HASH_EXCLUDED_PREFIXES lists the ten literal prefixes', () => {
  assert.deepStrictEqual(SPEC_HASH_EXCLUDED_PREFIXES, [
    'Surface:', 'Design-intent:', 'Ui-stack:', 'Visual-reference:', 'Parent:', 'Risk-flags:',
    'Risk-flags-unconfirmed:', 'Risk-flags-added-by-tripwire:', 'Acceptance-target:', '**Related:**',
  ]);
});
