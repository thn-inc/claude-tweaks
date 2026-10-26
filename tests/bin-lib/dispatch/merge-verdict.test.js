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

// #2941 review fix: VERDICT_RE used to match the marker as a bare substring anywhere in a line,
// so free-text narrative that merely QUOTES the marker (a /review or /reflect write-up) counted
// as a logged verdict. Anchoring on parseEntry + an action-start match closes this.
test('a narrative line under another step that quotes the marker text does not confirm', () => {
  const content = `${line('Step 2.8', 'Reviewing decisions.md, noticed the passing marker Auto-merge short-circuit: #2941 assess-agent-autonomy verdict auto-merge was logged for this record')}\n`;
  assert.deepStrictEqual(confirmPassingVerdicts(content, [2941]), { 2941: { confirmed: false, latest: null } });
});

test('a genuine needs-human verdict followed by a narrative line quoting the marker stays unconfirmed with latest needs-human', () => {
  const content = [
    line(VERDICT_STEPS.shortCircuit, '#2941 assess-agent-autonomy verdict needs-human — Review Console renders normally'),
    line('Reflect', 'Summary notes that Auto-merge short-circuit: #2941 assess-agent-autonomy verdict auto-merge would have been the ideal outcome'),
  ].join('\n');
  assert.deepStrictEqual(confirmPassingVerdicts(content, [2941]), { 2941: { confirmed: false, latest: 'needs-human' } });
});

test('a raw non-entry line (no "- AUTO HH:MM:SS — " prefix) containing the marker does not confirm', () => {
  const content = 'Auto-merge short-circuit: #2941 assess-agent-autonomy verdict auto-merge\n';
  assert.deepStrictEqual(confirmPassingVerdicts(content, [2941]), { 2941: { confirmed: false, latest: null } });
});

// A passing verdict is the outcome that relaxes the merge gate, so it must match the writer's whole
// emitted action, not just its opening (parse-signal-discipline item 6).
test('a pass line carrying extra text after the verdict does not confirm, and overrides an earlier pass', () => {
  const tail = `${line(VERDICT_STEPS.shortCircuit, '#2941 assess-agent-autonomy verdict auto-merge — but blast radius exceeded')}\n`;
  assert.deepStrictEqual(confirmPassingVerdicts(tail, [2941]), { 2941: { confirmed: false, latest: 'unparsed' } });
  const after = `${line(VERDICT_STEPS.shortCircuit, verdictText(2941))}\n${tail}`;
  assert.strictEqual(confirmPassingVerdicts(after, [2941])[2941].confirmed, false);
});

test('a pass line cut off mid-write does not confirm', () => {
  const full = line(VERDICT_STEPS.shortCircuit, verdictText(2941));
  const cut = full.slice(0, full.indexOf('Reversibility') + 'Revers'.length);
  assert.deepStrictEqual(confirmPassingVerdicts(`${cut}\n`, [2941]), { 2941: { confirmed: false, latest: 'unparsed' } });
});

test('a pass line with a lever suffix still confirms', () => {
  const content = `${line(VERDICT_STEPS.gate, verdictText(5), { lever: 'auto-merge-max-lines=40 (default)' })}\n`;
  assert.strictEqual(confirmPassingVerdicts(content, [5])[5].confirmed, true);
});

test('AC3.1: a pass line whose Reversibility carries a note confirms, with and without a lever suffix', () => {
  for (const reversibility of ['n/a (a policy read, not a code mutation)', 'n/a (see docs/x.md)']) {
    const plain = `${line(VERDICT_STEPS.shortCircuit, verdictText(2941), { reversibility })}\n`;
    assert.deepStrictEqual(confirmPassingVerdicts(plain, [2941]), { 2941: { confirmed: true, latest: 'auto-merge' } }, reversibility);
    const levered = `${line(VERDICT_STEPS.gate, verdictText(5), { reversibility, lever: 'auto-merge-max-lines=40 (default)' })}\n`;
    assert.strictEqual(confirmPassingVerdicts(levered, [5])[5].confirmed, true, reversibility);
  }
});

test('AC3.2: a noted pass line cut off inside the note does not confirm', () => {
  const full = line(VERDICT_STEPS.shortCircuit, verdictText(2941), { reversibility: 'n/a (a policy read, not a code mutation)' });
  const cut = full.slice(0, full.indexOf('policy re') + 'policy re'.length);
  assert.deepStrictEqual(confirmPassingVerdicts(`${cut}\n`, [2941]), { 2941: { confirmed: false, latest: 'unparsed' } });
});

test('AC3.2: a noted pass line with a tail after the note does not confirm; nested parens and periods inside the note still do', () => {
  const tailed = `${line(VERDICT_STEPS.shortCircuit, verdictText(2941), { reversibility: 'n/a (x). trailing narrative (y)' })}\n`;
  assert.deepStrictEqual(confirmPassingVerdicts(tailed, [2941]), { 2941: { confirmed: false, latest: 'unparsed' } });
  for (const reversibility of ['n/a (see (a))', 'high (commit abc.def)']) {
    const ok = `${line(VERDICT_STEPS.gate, verdictText(5), { reversibility })}\n`;
    assert.strictEqual(confirmPassingVerdicts(ok, [5])[5].confirmed, true, reversibility);
  }
});

test('a --spec location prefix is still recognized', () => {
  const content = `${line(VERDICT_STEPS.shortCircuit, verdictText(2941), { spec: 2941 })}\n`;
  assert.strictEqual(confirmPassingVerdicts(content, [2941])[2941].confirmed, true);
});

test('CRLF content is handled', () => {
  const content = `${line(VERDICT_STEPS.gate, verdictText(5))}\r\n`;
  assert.strictEqual(confirmPassingVerdicts(content, [5])[5].confirmed, true);
});

test('confirmFromFile reads the file; a missing file fails closed with an error', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-verdict-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'decisions.md');
  fs.writeFileSync(file, `${line(VERDICT_STEPS.shortCircuit, verdictText(3))}\n`);
  assert.deepStrictEqual(confirmFromFile(file, [3]), { 3: { confirmed: true, latest: 'auto-merge' } });
  const missing = confirmFromFile(path.join(dir, 'nope.md'), [3, 4]);
  assert.strictEqual(missing[3].confirmed, false);
  assert.strictEqual(missing[4].confirmed, false);
  assert.match(missing[3].error, /ENOENT/);
});
