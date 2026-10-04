'use strict';

// Mechanical drift guard for the four health-sweep skills' FILE step (#240).
//
// skills/_shared/health-filing-mechanics.md documents a canonical shape for
// two boilerplate paragraphs each of code-health/harness-health/docs-health/
// journey-health's own FILE step re-writes inline (never reads-and-substitutes
// at runtime — that file's own header explains why: the FILE step is
// procedural, literal bash a session executes step by step, with no mid-step
// file switch, so an "inline from this file" convention plus a MECHANICAL
// parity check closes the actual hazard — hand-sync drift — without adding a
// weaker runtime "go read X and substitute" binding).
//
// This test is the mechanical check: it catches the exact failure this repo
// already hit once (code-health's "Exception — a headless D5 finding"
// paragraph had drifted to a shorter reworded version relative to its three
// siblings, found and fixed alongside this test — see #240).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');

const SOURCES = {
  'code-health': readText(path.join(ROOT, 'plugin/skills/code-health/SKILL.md'))
    + readText(path.join(ROOT, 'plugin/skills/code-health/filing.md')),
  'harness-health': readText(path.join(ROOT, 'plugin/skills/harness-health/SKILL.md'))
    + readText(path.join(ROOT, 'plugin/skills/harness-health/filing.md')),
  'docs-health': readText(path.join(ROOT, 'plugin/skills/docs-health/SKILL.md')),
  'journey-health': readText(path.join(ROOT, 'plugin/skills/journey-health/SKILL.md')),
};

// Extracts a paragraph starting at `startMarker` up to (not including) the
// next blank line. Throws (test failure, not silent skip) if the marker is
// missing — an absent paragraph is itself a drift the suite must catch, not
// something to quietly pass over (matches this repo's own rule against
// count-based checks that pass identically whether the checked thing holds).
function extractParagraph(source, startMarker) {
  const idx = source.indexOf(startMarker);
  assert.ok(idx !== -1, `marker not found: ${JSON.stringify(startMarker)}`);
  const rest = source.slice(idx);
  const blankIdx = rest.indexOf('\n\n');
  return (blankIdx === -1 ? rest : rest.slice(0, blankIdx)).trim();
}

// Replaces this skill's own name wherever it appears as `by:{skill}` or a
// bare `{skill}` token, so the four paragraphs compare equal modulo the one
// legitimate per-skill substitution.
function normalize(paragraph, skillName) {
  return paragraph.split(skillName).join('{SKILL}');
}

// Extracts the body of a `## {heading}` section — everything between the
// heading line and the next `## ` heading, trimmed. Unlike extractParagraph
// (blank-line-delimited), a section's own heading line is immediately
// followed by a blank line before its body, so a blank-line stop would
// return nothing; this stops at the next top-level heading instead. Throws
// (test failure) if the heading is missing, matching extractParagraph's
// no-silent-skip behavior.
function extractSection(source, heading) {
  const idx = source.indexOf(heading);
  assert.ok(idx !== -1, `heading not found: ${JSON.stringify(heading)}`);
  const afterHeading = source.slice(idx + heading.length);
  const nextHeadingIdx = afterHeading.indexOf('\n## ');
  const body = nextHeadingIdx === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIdx);
  return body.trim();
}

test('the "Subject check before filing" paragraph is byte-identical (modulo skill name) across all four health sweeps', () => {
  const marker = '**Subject check before filing.**';
  const normalized = {};
  for (const [skill, source] of Object.entries(SOURCES)) {
    normalized[skill] = normalize(extractParagraph(source, marker), skill);
  }
  const values = Object.values(normalized);
  const [first, ...rest] = values;
  for (let i = 0; i < rest.length; i++) {
    assert.strictEqual(
      rest[i], first,
      `Subject-check paragraph drifted in one of the four skills (compared against code-health's). `
      + `Got:\n${rest[i]}\n\nExpected (normalized):\n${first}`,
    );
  }
});

test('the "Exception — a headless D5 finding" paragraph is byte-identical (modulo by:{skill}) across all four health sweeps', () => {
  const marker = '**Exception — a headless D5 finding.**';
  const normalized = {};
  for (const [skill, source] of Object.entries(SOURCES)) {
    normalized[skill] = normalize(extractParagraph(source, marker), `by:${skill}`);
  }
  const values = Object.values(normalized);
  const [first, ...rest] = values;
  for (let i = 0; i < rest.length; i++) {
    assert.strictEqual(
      rest[i], first,
      `D5-exception paragraph drifted in one of the four skills (compared against code-health's). `
      + `Got:\n${rest[i]}\n\nExpected (normalized):\n${first}`,
    );
  }
});

test('the "## Component-Skill Contract" section is byte-identical (modulo skill name) across all four health sweeps', () => {
  const heading = '## Component-Skill Contract';
  const normalized = {};
  for (const [skill, source] of Object.entries(SOURCES)) {
    normalized[skill] = normalize(extractSection(source, heading), skill);
  }
  const values = Object.values(normalized);
  const [first, ...rest] = values;
  for (let i = 0; i < rest.length; i++) {
    assert.strictEqual(
      rest[i], first,
      `Component-Skill Contract section drifted in one of the four skills (compared against code-health's). `
      + `Got:\n${rest[i]}\n\nExpected (normalized):\n${first}`,
    );
  }
});

test('every source file actually contains both canonical markers plus the Component-Skill Contract heading (a renamed heading would otherwise silently empty this suite)', () => {
  for (const [skill, source] of Object.entries(SOURCES)) {
    assert.ok(source.includes('**Subject check before filing.**'), `${skill} is missing the Subject-check marker`);
    assert.ok(source.includes('**Exception — a headless D5 finding.**'), `${skill} is missing the D5-exception marker`);
    assert.ok(source.includes('## Component-Skill Contract'), `${skill} is missing the Component-Skill Contract heading`);
  }
});
