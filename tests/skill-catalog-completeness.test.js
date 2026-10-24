'use strict';

// Skill-catalog completeness guard.
//
// Four documentation surfaces each claim to enumerate (or at least mention)
// every shipped skill: docs/skill-graph.md (a `## {name}` section per skill,
// since v6.34.0 the sole home for cross-skill relationships), skills/help/
// reference-card.md (the command reference table), skills/help/context-flow.md
// (the Artifact Flow "What Each Skill Reads and Writes" table), and
// docs/getting-started.md (the onboarding narrative). Nothing enforced that a
// newly-added skill actually landed in all four -- confirmed drift at the time
// this test was written: 12 skills were missing from context-flow.md (the
// motivating issue claimed 13; a live grep found 12 -- trust the grep, not the
// issue body, `[IL-71]`), and `backlog` had no row in docs/plugin-structure.md's
// sub-file table despite shipping two mode files (fixed in the same change,
// see tests/skill-conventions.test.js for the sibling structural checks that
// file already carries).
//
// Directory names, not the frontmatter `name:` field, are the source of truth
// (mirrors tests/bin-lib/skill-audit/house-structure.test.js) -- a frontmatter
// typo would otherwise hide a skill from this test instead of failing it.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { listSkillDirs, mentionsSkill } = require('../plugin/bin/lib/skill-audit/skill-catalog');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const SKILLS = listSkillDirs(path.join(ROOT, 'plugin'));

const read = (rel) => readText(path.join(ROOT, rel));

test('the corpus resolves to every skill directory that has a SKILL.md', () => {
  // A path or glob mistake that silently matched nothing would make every
  // check below vacuous, so pin the shape of the corpus itself -- same guard
  // as house-structure.test.js's identically-named test.
  assert.ok(SKILLS.length >= 30, `expected the whole skill corpus, found ${SKILLS.length}`);
  assert.ok(!SKILLS.includes('_shared'), 'skills/_shared holds fragments, not a skill');
  for (const known of ['build', 'flow', 'review', 'wrap-up']) {
    assert.ok(SKILLS.includes(known), `corpus is missing a known skill: ${known}`);
  }
});

test('docs/skill-graph.md carries a `## {name}` section for every skill', () => {
  const body = read('docs/skill-graph.md');
  const sections = new Set([...body.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()));
  for (const name of SKILLS) {
    assert.ok(sections.has(name), `docs/skill-graph.md is missing a '## ${name}' section`);
  }
});

test('skills/help/reference-card.md mentions every skill', () => {
  const body = read('plugin/skills/help/reference-card.md');
  for (const name of SKILLS) {
    assert.ok(
      mentionsSkill(body, name),
      `skills/help/reference-card.md never mentions /claude-tweaks:${name}`,
    );
  }
});

test("skills/help/context-flow.md mentions every skill in its Artifact Flow table", () => {
  const body = read('plugin/skills/help/context-flow.md');
  for (const name of SKILLS) {
    assert.ok(
      mentionsSkill(body, name),
      `skills/help/context-flow.md never mentions ${name} -- add a row to its `
      + "'What Each Skill Reads and Writes' table",
    );
  }
});

test('docs/getting-started.md mentions every skill', () => {
  const body = read('docs/getting-started.md');
  for (const name of SKILLS) {
    assert.ok(
      mentionsSkill(body, name),
      `docs/getting-started.md never mentions /claude-tweaks:${name}`,
    );
  }
});
