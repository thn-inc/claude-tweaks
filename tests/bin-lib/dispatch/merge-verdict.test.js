'use strict';
// #2941: the shared merge-verdict backstop used by wrap-up/auto-merge-short-circuit.md (singleton)
// and dispatch/settle-and-merge.md (bundle + local-merge fallback).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  VERDICT_STEPS, PASS_VERDICT, verdictText, verdictMarker, confirmPassingVerdicts, confirmFromFile,
} = require('../../../plugin/bin/lib/dispatch/merge-verdict');
const { formatEntry } = require('../../../plugin/bin/lib/log-decision/append');

const NOW = new Date('2026-10-16T12:00:00Z');
const line = (step, text, extra = {}) => formatEntry({ status: 'AUTO', now: NOW, step, text, ...extra });

test('marker strings are the documented ones', () => {
  assert.strictEqual(PASS_VERDICT, 'auto-merge');
  assert.strictEqual(verdictText(2941), '#2941 assess-agent-autonomy verdict auto-merge');
  assert.strictEqual(verdictMarker(VERDICT_STEPS.shortCircuit, 2941), 'Auto-merge short-circuit: #2941 assess-agent-autonomy verdict auto-merge');
  assert.strictEqual(verdictMarker(VERDICT_STEPS.gate, '{n}'), 'Auto-merge gate: #{n} assess-agent-autonomy verdict auto-merge');
});

test('no passing line (Layer 2 skipped) -> unconfirmed', () => {
  const content = `${line('Step 2.8', 'claimed #2941 (bin/claim-targets.js, transport: git)')}\n`;
  assert.deepStrictEqual(confirmPassingVerdicts(content, [2941]), { 2941: { confirmed: false, latest: null } });
});

test('passing short-circuit line -> confirmed', () => {
  const content = `${line(VERDICT_STEPS.shortCircuit, verdictText(2941))}\n`;
  assert.deepStrictEqual(confirmPassingVerdicts(content, ['2941']), { 2941: { confirmed: true, latest: 'auto-merge' } });
});

test('bundle gate marker also satisfies (settle-and-merge local-merge fallback accepts either)', () => {
  const content = `${line(VERDICT_STEPS.gate, verdictText(7))}\n${line(VERDICT_STEPS.shortCircuit, verdictText(8))}\n`;
  const r = confirmPassingVerdicts(content, [7, 8]);
  assert.strictEqual(r[7].confirmed, true);
  assert.strictEqual(r[8].confirmed, true);
});

test('latest verdict wins: needs-human after auto-merge -> unconfirmed', () => {
  const content = [
    line(VERDICT_STEPS.shortCircuit, verdictText(2941)),
    line(VERDICT_STEPS.shortCircuit, '#2941 assess-agent-autonomy verdict needs-human — Review Console renders normally'),
  ].join('\n');
  assert.deepStrictEqual(confirmPassingVerdicts(content, [2941]), { 2941: { confirmed: false, latest: 'needs-human' } });
});

test("another record's passing line never satisfies (prefix numbers included)", () => {
  const content = `${line(VERDICT_STEPS.shortCircuit, verdictText(29))}\n${line(VERDICT_STEPS.gate, verdictText(29410))}\n`;
  assert.strictEqual(confirmPassingVerdicts(content, [2941])[2941].confirmed, false);
  assert.strictEqual(confirmPassingVerdicts(`${line(VERDICT_STEPS.shortCircuit, verdictText(2941))}\n`, [29])[29].confirmed, false);
});

test('post-merge Fast-lane line never satisfies the pre-merge check', () => {
  const content = `${line('Fast-lane auto-merge', 'issue #2941, assess-agent-autonomy verdict auto-merge (see RATIONALE), pr-first-merge outcome merged')}\n`;
  assert.strictEqual(confirmPassingVerdicts(content, [2941])[2941].confirmed, false);
});

test('refusal line is not itself a passing verdict', () => {
  const content = [
    line(VERDICT_STEPS.shortCircuit, verdictText(2941)),
    line(VERDICT_STEPS.shortCircuit, '#2941 merge-check verdict not confirmed in decisions.md (latest: none) — treated as needs-human, Review Console renders normally'),
  ].join('\n');
  // The refusal does not parse as a verdict line, so the earlier pass is still the latest verdict.
  assert.strictEqual(confirmPassingVerdicts(content, [2941])[2941].latest, 'auto-merge');
});

test('a --spec location prefix is still recognized', () => {
  const content = `${line(VERDICT_STEPS.shortCircuit, verdictText(2941), { spec: 2941 })}\n`;
  assert.strictEqual(confirmPassingVerdicts(content, [2941])[2941].confirmed, true);
});

test('CRLF content is handled', () => {
  const content = `${line(VERDICT_STEPS.gate, verdictText(5))}\r\n`;
  assert.strictEqual(confirmPassingVerdicts(content, [5])[5].confirmed, true);
});

test('confirmFromFile reads the file; a missing file fails closed with an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-verdict-'));
  const file = path.join(dir, 'decisions.md');
  fs.writeFileSync(file, `${line(VERDICT_STEPS.shortCircuit, verdictText(3))}\n`);
  assert.deepStrictEqual(confirmFromFile(file, [3]), { 3: { confirmed: true, latest: 'auto-merge' } });
  const missing = confirmFromFile(path.join(dir, 'nope.md'), [3, 4]);
  assert.strictEqual(missing[3].confirmed, false);
  assert.strictEqual(missing[4].confirmed, false);
  assert.match(missing[3].error, /ENOENT/);
});
