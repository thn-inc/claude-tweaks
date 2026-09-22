'use strict';
// tests/walkthrough-conformance.test.js — #2758: the SKILL.md never *permits* loosening a
// locator to CSS, always requires --base, and never *defaults* a write destination under
// .claude-tweaks/artifacts/. The skill legitimately names these literals as explicit
// prohibitions/exclusions (Anti-Patterns table, Step 3's guard) — so each check discriminates
// prohibition from permission by inspecting the text immediately preceding the mention, rather
// than banning the literal outright. Go-red proof: the skill file does not exist at base
// 09ae6c80d, so every literal below was absent there; each discriminating check is additionally
// proven against a hand-doctored permissive control.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'walkthrough', 'SKILL.md');
const skill = fs.readFileSync(SKILL_PATH, 'utf8').replace(/\r\n/g, '\n');

test('the skill never permits loosening a locator to CSS', () => {
  // Window spans both directions: Step 3's prose states the negation before the mention
  // ("never **loosen**... CSS"), but the Anti-Patterns table states it as a row heading with
  // the rationale ("...stop and report the step instead") in the adjacent table cell, after
  // the mention. A fixed before-only window would miss the table-row phrasing.
  const CSS_MENTION_RE = /(loosen|fall back|degrad\w*)[^.]*CSS/gi;
  const PROHIBITION_RE = /never|do not|don't|must not|stop and report/i;
  const matches = [...skill.matchAll(CSS_MENTION_RE)];
  assert.ok(matches.length > 0, 'expected at least one CSS-related mention to check (the Anti-Patterns/Step-3 prohibition)');
  for (const m of matches) {
    const windowStart = Math.max(0, m.index - 60);
    const windowEnd = Math.min(skill.length, m.index + m[0].length + 150);
    const window = skill.slice(windowStart, windowEnd);
    assert.match(window, PROHIBITION_RE, `CSS mention "${m[0]}" reads as permission, not prohibition (no negation in the surrounding window)`);
  }
  const doctored = 'If the locator cannot be found, loosen the match to a CSS selector.';
  assert.ok(CSS_MENTION_RE.test(doctored), 'doctored control must contain a CSS mention to test against');
  assert.doesNotMatch(doctored, PROHIBITION_RE, 'doctored permissive text must NOT read as a prohibition (proves go-red)');
});

test('--base is described as required', () => {
  assert.match(skill, /--base.*required|require.*--base/i);
});

test('no default write destination under .claude-tweaks/artifacts/', () => {
  // The literal path legitimately appears more than once: the intro paragraph mentions it
  // neutrally (describing where a *different* skill, QA, already discards screenshots, for
  // contrast), while Step 3, Step 5, and the Anti-Patterns row use it as this skill's own
  // explicit exclusion. Requiring every mention to read as a prohibition would fail on the
  // neutral intro sentence; requiring at least one to clearly exclude it is the real bar.
  const LITERAL = '.claude-tweaks/artifacts/';
  const PROHIBITION_RE = /never|not under|outside|disposable|scratch|prune/i;
  const indices = [];
  for (let idx = skill.indexOf(LITERAL); idx !== -1; idx = skill.indexOf(LITERAL, idx + 1)) {
    indices.push(idx);
  }
  assert.ok(indices.length > 0, 'expected the skill to name the excluded path explicitly at least once');
  const hasProhibition = indices.some((idx) => {
    const windowStart = Math.max(0, idx - 60);
    const windowEnd = Math.min(skill.length, idx + LITERAL.length + 150);
    return PROHIBITION_RE.test(skill.slice(windowStart, windowEnd));
  });
  assert.ok(hasProhibition, 'no mention of .claude-tweaks/artifacts/ reads as a prohibition/exclusion for this skill');
  const doctored = 'Save the frames to .claude-tweaks/artifacts/walkthroughs/{story-id}.gif by default.';
  assert.doesNotMatch(doctored, PROHIBITION_RE, 'doctored default-destination text must NOT read as a prohibition (proves go-red)');
});

test('no git commit/git add instruction', () => {
  assert.equal(/git (commit|add)\b/.test(skill), false);
});

test('runs the encode CLI and playwright-cli through the plugin root, never a repo-relative path', () => {
  assert.ok(skill.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/walkthrough-encode.js"'));
});

test('never instructs backend=chrome', () => {
  // The only mention is the Anti-Patterns row heading ("Using `backend=chrome` here"); its
  // rationale ("Restricted to human ad-hoc use...") sits in the adjacent table cell, after
  // the mention, not before it.
  const idx = skill.indexOf('backend=chrome');
  assert.ok(idx > -1, 'expected the skill to name backend=chrome explicitly at least once (the Anti-Patterns row)');
  const PROHIBITION_RE = /never|not|don't|stop|restrict/i;
  const windowStart = Math.max(0, idx - 60);
  const windowEnd = Math.min(skill.length, idx + 'backend=chrome'.length + 150);
  const window = skill.slice(windowStart, windowEnd);
  assert.match(window, PROHIBITION_RE, `backend=chrome mention at ${idx} does not read as a prohibition`);
  const doctored = 'Open the page with backend=chrome for a faster capture.';
  assert.doesNotMatch(doctored, PROHIBITION_RE, 'doctored permissive text must NOT read as a prohibition (proves go-red)');
});
