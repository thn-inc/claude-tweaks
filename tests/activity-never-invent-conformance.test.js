'use strict';
// tests/activity-never-invent-conformance.test.js — #2757: /claude-tweaks:activity's
// anti-fabrication rule and its mandatory render step, pinned in the live skill prose (the
// convention-enforcement row of .claude/skills/skill-prose-conformance-tests — read live,
// never frozen, because a future edit weakening either is exactly what this must catch).
// Go-red proof: the skill file did not exist at base 6d0f768a4, so every literal below was
// absent there; each assertion is additionally proven against a hand-doctored copy.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'activity', 'SKILL.md');
const skill = fs.readFileSync(SKILL_PATH, 'utf8').replace(/\r\n/g, '\n');
const collapse = (s) => s.replace(/\s+/g, ' ');

const NEVER_INVENT = 'never invent PRs, issues, numbers, dates, or people';

test('the never-invent sentence is present verbatim, once, in bold', () => {
  const flat = collapse(skill);
  assert.ok(flat.includes(`**${NEVER_INVENT}**`), 'never-invent sentence missing or not bold');
  assert.equal(flat.split(NEVER_INVENT).length - 1, 1, 'the sentence must appear exactly once');
  const doctored = collapse(skill.replace(NEVER_INVENT, 'be careful with numbers'));
  assert.equal(doctored.includes(NEVER_INVENT), false, 'doctored control must lose the sentence (proves go-red)');
});

test('the render step is mandatory: the report shown is always the renderer output, never optional', () => {
  const flat = collapse(skill);
  assert.ok(/always the renderer's output, never the skill's own prose/.test(flat), 'mandatory-render sentence missing');
  const renderStep = flat.slice(flat.indexOf('activity-render.js'));
  assert.equal(/\b(optional|may skip|can skip|if desired)\b/i.test(renderStep.slice(0, 1200)), false, 'the render step must not be described as optional');
  const doctored = collapse(skill.replace('always the renderer\'s output', 'optionally the renderer\'s output'));
  assert.equal(/always the renderer's output, never the skill's own prose/.test(doctored), false, 'doctored control must fail (proves go-red)');
});

test('AC9: no artifacts write destination, docs/reports default, no git commit/add instruction', () => {
  assert.equal(skill.includes('.claude-tweaks/artifacts/'), false);
  assert.ok(skill.includes('docs/reports/activity-{from}-{to}.md'));
  assert.equal(/git (commit|add)\b/.test(skill), false, 'the skill must never commit on the user\'s behalf');
});

test('the skill runs gather and render through the plugin root, never a repo-relative path', () => {
  assert.ok(skill.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/activity-gather.js"'));
  assert.ok(skill.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/activity-render.js"'));
  assert.equal(/node plugin\/bin\/activity-/.test(skill), false);
});
