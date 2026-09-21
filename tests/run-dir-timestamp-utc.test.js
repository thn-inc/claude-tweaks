'use strict';

// Record #721: run-dir ISO-timestamps are UTC, stated once in
// _shared/pipeline-run-dir.md and cited by every mint site. Two concurrent
// sessions minting in different timezones flipped newest-first ordering and
// let an empty local-time mint steal hook fallback attribution.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { composedBytesReport, overComposedCeiling } = require('../plugin/bin/lib/skill-audit/context-cost.js');

const REPO_ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

function mdFilesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mdFilesUnder(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

test('every run-dir timestamp snippet under skills/ uses date -u (#721)', () => {
  const offenders = [];
  for (const full of mdFilesUnder(path.join(REPO_ROOT, 'plugin', 'skills'))) {
    const text = fs.readFileSync(full, 'utf8');
    for (const line of text.split('\n')) {
      if (line.includes('%Y-%m-%dT%H%M%S') && line.includes('date ') && !line.includes('date -u ')) {
        offenders.push(`${path.relative(REPO_ROOT, full)}: ${line.trim()}`);
      }
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test('run-dir-resolution.md states the UTC ISO-timestamp rule once (#721)', () => {
  // Moved from pipeline-run-dir.md to run-dir-resolution.md at #2019, alongside the
  // Resolution order and Bash snippet it's adjacent to.
  const content = read('plugin/skills/_shared/run-dir-resolution.md');
  assert.match(content, /ISO-timestamp rule/);
  assert.match(content, /UTC/);
  assert.match(content, /date -u \+%Y-%m-%dT%H%M%S/);
});

test('the three mint sites cite the UTC rule instead of restating a bare format (#721)', () => {
  for (const p of ['plugin/skills/flow/claim-targets.md', 'plugin/skills/flow/manifesto.md', 'plugin/skills/dispatch/SKILL.md']) {
    const content = read(p);
    assert.match(content, /ISO-timestamp rule/, `${p} must cite the ISO-timestamp rule`);
    assert.match(content, /UTC|date -u/, `${p} must carry the UTC signal at its mint/path site`);
  }
});

test('claim-targets contest path removes a self-minted empty dir immediately (#721)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  assert.match(content, /remove (the|it|that) (self-)?mint(ed)?[^.]*immediately/i);
  assert.match(content, /PIPELINE_RUN_DIR[^.]*unset on entry/);
  assert.doesNotMatch(content, /isOrphanedMint` sweep reclaims after 24h if it was freshly minted here/);
});

test('claim-targets spec-slug rule cites run-dir-resolution.md, not manifesto.md (#724)', () => {
  // SPEC_SLUG conventions moved from pipeline-run-dir.md to run-dir-resolution.md at #2019.
  const content = read('plugin/skills/flow/claim-targets.md');
  const slugLines = content.split('\n').filter((l) => l.includes('{spec-slug}') && l.includes('follows'));
  assert.ok(slugLines.length > 0, 'the mint step must still state where the spec-slug rule lives');
  for (const l of slugLines) {
    assert.match(l, /run-dir-resolution\.md/);
    assert.doesNotMatch(l, /manifesto\.md/);
  }
});

test('flow SKILL.md defers the manifesto.md read until Step 2.8 passes (#724)', () => {
  assert.match(read('plugin/skills/flow/SKILL.md'), /read `manifesto\.md`[^.]*after Step 2\.8 passes|after Step 2\.8 passes[^.]*read `manifesto\.md`/i);
});

test('multi-spec.md and manifesto.md fit their single-read budgets (#724, #1997)', () => {
  // multi-spec.md is a lazy sub-file's single-read budget (the multi-spec
  // branch only), not a 40 KB compose-source pin — #1997 leaves it as-is.
  //
  // manifesto.md's composed-bundle gate (below, `manifesto.md has no
  // over-ceiling composed-bytes row (#1997)`) covers the *adopted*-run read
  // (config.yml already exists, so flow/SKILL.md Step 3 reads the composed
  // bundle via compose-context.js). It does not cover the *fresh*-run read:
  // on a fresh run config.yml doesn't exist yet, so Step 3 reads
  // manifesto.md directly, and the compose command's own fallback (source
  // files read directly when compose-context.js is unavailable/non-zero)
  // hits the same raw file. #724's ~21760-byte raw budget still binds on
  // both of those direct-read paths, so it's restored here alongside
  // multi-spec.md's — #1997 keeps both, as #1991's "final, considered form".
  const BUDGETS = {
    'plugin/skills/flow/multi-spec.md': 20480,
    'plugin/skills/flow/manifesto.md': 21760,
  };
  for (const [p, budget] of Object.entries(BUDGETS)) {
    const bytes = fs.statSync(path.join(REPO_ROOT, p)).size;
    assert.ok(bytes < budget, `${p} is ${bytes} bytes — must stay under ${budget}`);
  }
});

// manifesto.md is also a compose source (`flow/SKILL.md`'s `manifesto` step,
// #1991), so on the adopted-run path the hard gate is the composed bundle at
// that call site, not the raw file (#1997) — the raw budget above still
// binds on the fresh-run direct read. `context-cost.test.js` measures the
// `manifesto` bundle under every mode; this test only confirms it carries
// no over-ceiling row.
test('manifesto.md has no over-ceiling composed-bytes row (#1997)', () => {
  const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugin');
  // Guard against a vacuous pass (#1997): if the `manifesto` call site is
  // ever removed or renamed, the filter below yields [] regardless of
  // whether manifesto.md is actually over budget anywhere — retarget this
  // test or restore the raw per-file pin instead of leaving it vacuous.
  assert.ok(
    composedBytesReport(PLUGIN_ROOT).some((r) => r.step === 'manifesto' && !r.unparsed),
    'the manifesto call site is gone — retarget or restore the raw pin',
  );
  const manifestoRows = overComposedCeiling(composedBytesReport(PLUGIN_ROOT)).filter((r) => r.step === 'manifesto');
  assert.deepStrictEqual(manifestoRows, [], `manifesto composed bundle over ceiling: ${JSON.stringify(manifestoRows)}`);
});

test('extracted override table and summary template live in their sub-files (#724)', () => {
  assert.match(read('plugin/skills/flow/manifesto-overrides.md'), /Override semantics/);
  assert.match(read('plugin/skills/flow/manifesto-overrides.md'), /pr-first-merge\.md/);
  assert.match(read('plugin/skills/flow/multispec-summary.md'), /Multi-Spec Pipeline Complete/);
  assert.match(read('plugin/skills/flow/manifesto.md'), /manifesto-overrides\.md/);
  assert.match(read('plugin/skills/flow/multi-spec.md'), /multispec-summary\.md/);
});
