'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #3666: a resumed /build (a still-valid plan, Spec Step 2 / Design Step 2) must
// re-decide Common Steps 1.5-1.7 rather than jump to Common Step 2. This file pins
// the resume branches in build/SKILL.md and the resume carve-outs in plan-review.md
// and plan-audit.md. Read live: just-shipped prose expected to evolve. Each pin set
// is a problems(text) function so every go-red control runs the same check on
// doctored text.

const ROOT = path.join(__dirname, '..');
const SKILL_PATH = path.join(ROOT, 'plugin', 'skills', 'build', 'SKILL.md');
const REVIEW_PATH = path.join(ROOT, 'plugin', 'skills', 'build', 'plan-review.md');
const AUDIT_PATH = path.join(ROOT, 'plugin', 'skills', 'build', 'plan-audit.md');
const norm = (t) => t.replace(/\s+/g, ' ');
const doctor = (text, anchor) => text.split(anchor).join('removed');

const UNCONDITIONAL = 'unconditional skip to Common Step 2';

// --- pin sets ---

function sectionBetween(skill, startMarker, endMarker) {
  const start = skill.indexOf(startMarker);
  assert.notStrictEqual(start, -1, `SKILL.md lacks "${startMarker}"`);
  const end = skill.indexOf(endMarker, start);
  assert.notStrictEqual(end, -1, `SKILL.md lacks "${endMarker}" after "${startMarker}"`);
  return skill.slice(start, end);
}

const specResumeSection = (skill) => sectionBetween(skill, '#### If a plan exists:', '#### If no plan exists:');
const designResumeSection = (skill) => sectionBetween(skill, '### Design Step 2: Check for Existing Plan', '### Design Step 3');

const SPEC_ANCHORS = [
  '**Common Step 1.5 (plan audit):**',
  '**Common Step 1.6 (plan review):**',
  '**Common Step 1.7 (design pre-build):**',
  'decisions.md',
  'changed after it',
  're-run under its own skip gate',
  're-run under its own skip conditions',
  'resumed build: plan already reviewed this run, spec and plan unchanged since',
];
const DESIGN_ANCHORS = ['Common Steps 1.5 and 1.7', 'Spec Mode only'];
const anchorProblems = (text, anchors) => anchors.filter((a) => !norm(text).includes(a));

// A resume branch problem: the unconditional skip line, plus each missing anchor.
function resumeProblems(section, anchors) {
  const missing = anchorProblems(section, anchors);
  return /skip to Common Step 2/i.test(norm(section)) ? [UNCONDITIONAL, ...missing] : missing;
}

const REVIEW_ANCHORS = ['resumed build: plan already reviewed this run', '**A resumed build**'];
const AUDIT_ANCHORS = ['Resumed build exception (#3666)'];

// --- tests ---

test('AC1: Spec Step 2 resume branch names Common Steps 1.5, 1.6 and 1.7 and what a resumed build does with each', () => {
  assert.deepStrictEqual(resumeProblems(specResumeSection(readText(SKILL_PATH)), SPEC_ANCHORS), []);
});

test('AC1: Design Step 2 resume branch runs Common Steps 1.5 and 1.7, with 1.6 Spec Mode only', () => {
  assert.deepStrictEqual(resumeProblems(designResumeSection(readText(SKILL_PATH)), DESIGN_ANCHORS), []);
});

test('AC1: plan-review.md carves out the resumed build and the skip-logging text names it', () => {
  assert.deepStrictEqual(anchorProblems(readText(REVIEW_PATH), REVIEW_ANCHORS), []);
});

test('AC1: plan-audit.md excepts a Check C finding on a task already built on a resume', () => {
  assert.deepStrictEqual(anchorProblems(readText(AUDIT_PATH), AUDIT_ANCHORS), []);
});

// AC2: the checker itself must flag the pre-#3666 unconditional skip line.
test('AC2: a resume branch reverted to an unconditional skip to Common Step 2 is reported', () => {
  const revertedSpec = '#### If a plan exists:\n\n- If the plan is still valid and work remains, skip to Common Step 2\n\n';
  assert.ok(resumeProblems(revertedSpec, SPEC_ANCHORS).includes(UNCONDITIONAL));
  const revertedDesign = '### Design Step 2: Check for Existing Plan\n\n- If a plan exists and is still valid → skip to Common Step 2\n\n';
  assert.ok(resumeProblems(revertedDesign, DESIGN_ANCHORS).includes(UNCONDITIONAL));
});

test('go-red: each pin set fails when one anchor is removed', () => {
  const skill = readText(SKILL_PATH);
  const cases = [
    [(t) => resumeProblems(t, SPEC_ANCHORS), norm(specResumeSection(skill)), SPEC_ANCHORS],
    [(t) => resumeProblems(t, DESIGN_ANCHORS), norm(designResumeSection(skill)), DESIGN_ANCHORS],
    [(t) => anchorProblems(t, REVIEW_ANCHORS), norm(readText(REVIEW_PATH)), REVIEW_ANCHORS],
    [(t) => anchorProblems(t, AUDIT_ANCHORS), norm(readText(AUDIT_PATH)), AUDIT_ANCHORS],
  ];
  for (const [problems, source, anchors] of cases) {
    for (const anchor of anchors) {
      const doctored = doctor(source, anchor);
      assert.notStrictEqual(doctored, source, `doctoring found no anchor text for ${anchor}`);
      assert.deepStrictEqual(problems(doctored), [anchor], `removing ${anchor} did not surface exactly that anchor`);
    }
  }
});
