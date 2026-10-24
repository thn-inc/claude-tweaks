'use strict';

// Record #721: run-dir ISO-timestamps are UTC, stated once in
// _shared/pipeline-run-dir.md and cited by every mint site. Two concurrent
// sessions minting in different timezones flipped newest-first ordering and
// let an empty local-time mint steal hook fallback attribution.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const read = (p) => readText(path.join(REPO_ROOT, p));

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
    const text = readText(full);
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

test('extracted override table and summary template live in their sub-files (#724)', () => {
  assert.match(read('plugin/skills/flow/manifesto-overrides.md'), /Override semantics/);
  assert.match(read('plugin/skills/flow/manifesto-overrides.md'), /pr-first-merge\.md/);
  assert.match(read('plugin/skills/flow/multispec-summary.md'), /Multi-Spec Pipeline Complete/);
  assert.match(read('plugin/skills/flow/manifesto.md'), /manifesto-overrides\.md/);
  assert.match(read('plugin/skills/flow/multi-spec.md'), /multispec-summary\.md/);
});
