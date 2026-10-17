'use strict';
// tests/fast-lane-digest.test.js — pins that plugin/skills/_shared/fast-lane-digest.md
// exists and states the fast-lane skip/narrow facts for review and wrap-up (#1765),
// and that the ceremony-gated entry points cite it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIGEST_PATH = path.join(ROOT, 'plugin', 'skills', '_shared', 'fast-lane-digest.md');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('fast-lane-digest.md exists', () => {
  assert.ok(fs.existsSync(DIGEST_PATH), 'plugin/skills/_shared/fast-lane-digest.md must exist');
});

test('digest names the review fast-lane skip list (Steps 1, 1.6, 4)', () => {
  const md = read('plugin/skills/_shared/fast-lane-digest.md');
  assert.ok(/Step 1 .*Spec Compliance/i.test(md), 'must name Step 1 (Spec Compliance Check)');
  assert.ok(/Step 1\.6 .*Cross-Spec Promise/i.test(md), 'must name Step 1.6 (Cross-Spec Promise Check)');
  assert.ok(/Step 4 .*Implementation Hindsight/i.test(md), 'must name Step 4 (Implementation Hindsight)');
  assert.ok(md.includes('**skip**'), 'must mark skipped steps distinctly');
});

test('digest names the wrap-up narrowed caps and reflect light mode', () => {
  const md = read('plugin/skills/_shared/fast-lane-digest.md');
  assert.ok(md.includes('top 2'), 'must state the fast-lane Skills row cap (top 2)');
  assert.ok(md.includes('top 1'), 'must state the fast-lane Docs row cap (top 1)');
  assert.ok(/light.*mode/i.test(md), 'must name Reflect light mode');
  assert.ok(md.includes('Near-misses') && md.includes('Fresh start') && md.includes('Friction'),
    'must name all three light-mode lenses');
});

test('digest names the ceremony escape hatch trigger conditions', () => {
  const md = read('plugin/skills/_shared/fast-lane-digest.md');
  assert.ok(/finding at any severity/i.test(md), 'must name the review-finding trigger');
  assert.ok(/Safety.regression/i.test(md), 'must name the Safety-regression trigger');
});

test('digest states it never overrides its canonical sources', () => {
  const md = read('plugin/skills/_shared/fast-lane-digest.md');
  assert.ok(/never override|restates it, never overrides/i.test(md),
    'must state the restate-not-override relationship to its canonical sources');
});

test('review/SKILL.md points fast-lane runs at the digest before code-mode-steps.md', () => {
  const md = read('plugin/skills/review/SKILL.md');
  assert.ok(md.includes('fast-lane-digest.md'), 'review/SKILL.md must cite fast-lane-digest.md');
});

test('wrap-up/ceremony-derivation.md short-circuits when config.yml already reads fast-lane', () => {
  const md = read('plugin/skills/wrap-up/ceremony-derivation.md');
  assert.ok(md.includes('fast-lane-digest.md'), 'ceremony-derivation.md must cite fast-lane-digest.md');
});

test('wrap-up/skill-curation.md and docs-health-integration.md cite the digest for the cap number', () => {
  const skillMd = read('plugin/skills/wrap-up/skill-curation.md');
  const docsMd = read('plugin/skills/wrap-up/docs-health-integration.md');
  assert.ok(skillMd.includes('fast-lane-digest.md'), 'skill-curation.md must cite fast-lane-digest.md');
  assert.ok(docsMd.includes('fast-lane-digest.md'), 'docs-health-integration.md must cite fast-lane-digest.md');
});

test('wrap-up/SKILL.md is untouched by this change (no new growth, #1808)', () => {
  const md = read('plugin/skills/wrap-up/SKILL.md');
  assert.ok(!md.includes('fast-lane-digest.md'),
    'wrap-up/SKILL.md must not be edited in this plan (no new growth, #1808)');
});
