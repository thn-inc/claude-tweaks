'use strict';
// tests/walkthrough-conformance.test.js — #2758: the SKILL.md never instructs loosening a
// locator to CSS, always requires --base, and never defaults a write destination under
// .claude-tweaks/artifacts/. Go-red proof: the skill file does not exist at base 09ae6c80d, so
// every literal below was absent there; the CSS-permissiveness pattern is additionally proven
// against a hand-doctored copy.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'walkthrough', 'SKILL.md');
const skill = fs.readFileSync(SKILL_PATH, 'utf8').replace(/\r\n/g, '\n');

const CSS_PERMISSIVE_RE = /loosen[^.]*CSS|fall back[^.]*CSS/i;

test('the skill never permits loosening a locator to CSS', () => {
  assert.equal(CSS_PERMISSIVE_RE.test(skill), false);
  const doctored = skill + '\nIf the locator cannot be found, loosen the match to a CSS selector.';
  assert.ok(CSS_PERMISSIVE_RE.test(doctored), 'doctored control must trip the pattern (proves go-red)');
});

test('--base is described as required', () => {
  assert.match(skill, /--base.*required|require.*--base/i);
});

test('no default write destination under .claude-tweaks/artifacts/', () => {
  assert.equal(skill.includes('.claude-tweaks/artifacts/'), false);
});

test('no git commit/git add instruction', () => {
  assert.equal(/git (commit|add)\b/.test(skill), false);
});

test('runs the encode CLI and playwright-cli through the plugin root, never a repo-relative path', () => {
  assert.ok(skill.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/walkthrough-encode.js"'));
});

test('never instructs backend=chrome', () => {
  assert.equal(/backend=chrome/.test(skill), false);
});
