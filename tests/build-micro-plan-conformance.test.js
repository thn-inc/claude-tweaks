'use strict';
// tests/build-micro-plan-conformance.test.js — pins #1911: a fast-lane, size-low,
// single-implementation-file record composes a one-task plan directly (`build/micro-plan.md`)
// instead of invoking `/superpowers:writing-plans`, and any other header shape falls through
// to the full path unchanged. Reads live skill prose deliberately — the prose IS the contract
// an implementer subagent follows; there is no separate mechanical engine to unit-test here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Normalize CRLF to LF: the git-tracked content is LF-only, but a Windows
// checkout with core.autocrlf=true rewrites working-tree line endings to
// CRLF, which breaks a literal multi-line string match (though not a `.`/`s`
// regex, which already treats `\r` as ordinary whitespace via `\s`).
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const MICRO_PLAN = read('plugin', 'skills', 'build', 'micro-plan.md');
const BUILD_SKILL = read('plugin', 'skills', 'build', 'SKILL.md');
const SKILL_GRAPH = read('docs', 'skill-graph.md');
const MATERIALIZE = read('plugin', 'skills', 'flow', 'materialize.md');

test('SKILL.md Spec Step 3 points to micro-plan.md before invoking writing-plans', () => {
  const stepIdx = BUILD_SKILL.indexOf('### Spec Step 3: Create the Plan');
  assert.notEqual(stepIdx, -1, 'Spec Step 3 heading not found');
  const section = BUILD_SKILL.slice(stepIdx, stepIdx + 1200);
  const microPlanIdx = section.indexOf('micro-plan.md');
  const writingPlansIdx = section.indexOf('Invoke the `/superpowers:writing-plans` skill');
  assert.notEqual(microPlanIdx, -1, 'Spec Step 3 does not mention micro-plan.md');
  assert.notEqual(writingPlansIdx, -1, 'Spec Step 3 does not invoke writing-plans');
  assert.ok(microPlanIdx < writingPlansIdx, 'micro-plan check must be read before the writing-plans invocation');
});

test('micro-plan.md: applicability gate names all three conditions', () => {
  assert.match(MICRO_PLAN, /ceremony: fast-lane/);
  assert.match(MICRO_PLAN, /size: low/);
  assert.match(MICRO_PLAN, /### Key Files.*at most one implementation file/s);
});

test('micro-plan.md: any other header shape falls through to today\'s path unchanged', () => {
  assert.match(MICRO_PLAN, /falls through to today's path unchanged/);
  assert.match(MICRO_PLAN, /ceremony: standard.*falls through/s);
});

test('micro-plan.md: an unparseable ### Key Files section falls through rather than being guessed at zero', () => {
  assert.match(MICRO_PLAN, /cannot parse.*also falls through/s);
  assert.match(MICRO_PLAN, /never guess a\s*\ncount from an absent or malformed section/);
});

test('micro-plan.md: plan-audit.md is skipped via the existing fast-lane gate, not a new one', () => {
  assert.match(MICRO_PLAN, /Skip plan-audit\.md too/);
  assert.match(MICRO_PLAN, /Common Step 1\.5 already skips when `config\.yml`'s `ceremony-profile`\s*\nis `fast-lane`/);
});

test('micro-plan.md: composed plan uses the same docs/superpowers/plans/ naming convention', () => {
  assert.match(MICRO_PLAN, /docs\/superpowers\/plans\/YYYY-MM-DD-\{feature\}-\{n\}\.md/);
});

test('micro-plan.md: the skip is logged via log-decision.js --status SKIP', () => {
  assert.match(MICRO_PLAN, /log-decision\.js" --run "\$PIPELINE_RUN_DIR" --status SKIP/);
  assert.match(MICRO_PLAN, /--section "\/build" --step "Spec Step 3 \(skipped\)"/);
});

test('micro-plan.md: standalone /build (no run dir) lists the skip in the Step 7 handoff', () => {
  assert.match(MICRO_PLAN, /Standalone `\/build` \(no run dir\): list the skip in the Step 7 handoff/);
});

test('micro-plan.md: NEEDS_CONTEXT escape hatch re-runs the full path once, with a one-cycle cap', () => {
  assert.match(MICRO_PLAN, /## Escape hatch: NEEDS_CONTEXT re-run/);
  assert.match(MICRO_PLAN, /re-runs the full path \*\*once\*\*/);
  assert.match(MICRO_PLAN, /One cycle cap/);
  assert.match(MICRO_PLAN, /never a second micro-plan attempt or a\s*\nsecond full-path re-run/);
});

test('docs/skill-graph.md: the /superpowers:writing-plans build-section row documents the micro-plan bypass', () => {
  const buildSectionIdx = SKILL_GRAPH.indexOf('\n## build\n');
  assert.notEqual(buildSectionIdx, -1);
  const nextSectionIdx = SKILL_GRAPH.indexOf('\n## capture\n', buildSectionIdx);
  assert.notEqual(nextSectionIdx, -1);
  const buildSection = SKILL_GRAPH.slice(buildSectionIdx, nextSectionIdx);
  assert.match(buildSection, /`\/superpowers:writing-plans`/);
  assert.match(buildSection, /#1911/);
  assert.match(buildSection, /skips this invocation entirely/);
});

test('materialize.md: size and ceremony reader rows name micro-plan.md as a second reader', () => {
  const sizeRowIdx = MATERIALIZE.indexOf('| `size` |');
  const ceremonyRowIdx = MATERIALIZE.indexOf('| `ceremony` |');
  assert.notEqual(sizeRowIdx, -1);
  assert.notEqual(ceremonyRowIdx, -1);
  assert.match(MATERIALIZE.slice(sizeRowIdx, sizeRowIdx + 900), /build\/micro-plan\.md/);
  assert.match(MATERIALIZE.slice(ceremonyRowIdx, ceremonyRowIdx + 500), /build\/micro-plan\.md/);
});
