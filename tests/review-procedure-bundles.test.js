// tests/review-procedure-bundles.test.js — pins #4359 Task 7: /review composes its two large
// procedure files once per run (`--step review-code-mode` over code-mode-steps.md, `--step
// review-lens-procedure` over step3-lens-dispatch.md) and reads each bundle whole, instead of
// raw, piecewise reads of the source. Both call sites must be measured rail rows, so the
// composed-bytes gate sees them.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findComposeCallSites, measureComposed } = require('../plugin/bin/lib/skill-audit/context-cost.js');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets.js');
const { readText } = require('./helpers/read-skill.js');

const PLUGIN = path.join(__dirname, '..', 'plugin');
const REVIEW = path.join(PLUGIN, 'skills', 'review');
const FALLBACK = 'if the compose command is unavailable or exits non-zero, read the named source files directly.';
const HEADROOM = 2000;

const SITES = [
  {
    name: 'review SKILL.md composes code-mode-steps.md once and reads the bundle whole',
    file: path.join(REVIEW, 'SKILL.md'),
    step: 'review-code-mode',
    source: 'code-mode-steps.md',
    callLine: 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step review-code-mode "${CLAUDE_PLUGIN_ROOT}/skills/review/code-mode-steps.md"',
    limit: RAIL_BYTES - HEADROOM,
  },
  {
    name: 'code-mode-steps.md composes step3-lens-dispatch.md once',
    file: path.join(REVIEW, 'code-mode-steps.md'),
    step: 'review-lens-procedure',
    source: 'step3-lens-dispatch.md',
    callLine: 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step review-lens-procedure "${CLAUDE_PLUGIN_ROOT}/skills/review/step3-lens-dispatch.md"',
    limit: RAIL_BYTES,
  },
];

for (const site of SITES) {
  test(site.name, () => {
    const text = readText(site.file);
    const line = text.split('\n').find((l) => l.includes(site.callLine));
    assert.ok(line, `${path.basename(site.file)} is missing the call line: ${site.callLine}`);
    // Every clause sits on the call line's own paragraph line, so a reader of the call sees them all.
    for (const needle of [`context/${site.step}.md`, 'once, whole', 'compacted since', FALLBACK, site.source]) {
      assert.ok(line.includes(needle), `${path.basename(site.file)}'s ${site.step} line is missing: ${needle}`);
    }
    // The standalone path (no run directory) still reads the raw source by name.
    const standalone = `Standalone, with no \`$PIPELINE_RUN_DIR\`, read \`${site.source}\``;
    assert.ok(line.includes(standalone), `${site.step} line is missing the standalone read: ${standalone}`);
    // The compose is gated on the run directory, and the gate comes before the call.
    const gate = 'With `$PIPELINE_RUN_DIR` set, compose it first';
    assert.ok(line.includes(gate), `${site.step} line is missing the gating clause: ${gate}`);
    assert.ok(line.indexOf(gate) < line.indexOf(site.callLine), `${site.step} line states the gate after the call`);
  });
}

test('both call sites are measured rail rows', () => {
  const rows = findComposeCallSites(PLUGIN);
  for (const site of SITES) {
    const matches = rows.filter((r) => r.step === site.step);
    assert.equal(matches.length, 1, `expected exactly one ${site.step} call site, got ${matches.length}`);
    const measured = measureComposed(PLUGIN, matches[0]);
    assert.equal(measured.unparsed, undefined, `${site.step} row is unparsed: ${measured.reason}`);
    assert.equal(measured.error, undefined, `${site.step} row errored: ${measured.error}`);
    assert.deepEqual(measured.sources, [path.join(REVIEW, site.source)]);
    assert.ok(measured.max <= site.limit, `${site.step} composes to ${measured.max} B, over ${site.limit} B`);
  }
});

test('discrimination: a SKILL.md without the call line yields no review-code-mode row', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-bundles-'));
  try {
    const dir = path.join(tmp, 'skills', 'review');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(REVIEW, 'code-mode-steps.md'), path.join(dir, 'code-mode-steps.md'));
    const original = readText(path.join(REVIEW, 'SKILL.md'));
    const stripped = original.split('\n').filter((l) => !l.includes('--step review-code-mode')).join('\n');
    assert.notEqual(stripped, original, 'fixture removed nothing — the call line moved');

    fs.writeFileSync(path.join(dir, 'SKILL.md'), original);
    assert.ok(findComposeCallSites(tmp).some((r) => r.step === 'review-code-mode'), 'positive control found no row');

    fs.writeFileSync(path.join(dir, 'SKILL.md'), stripped);
    assert.ok(!findComposeCallSites(tmp).some((r) => r.step === 'review-code-mode'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
