'use strict';
// tests/walkthrough-conformance.test.js — #2758: the SKILL.md never *permits* loosening a
// locator to CSS, always requires --base, and never *defaults* a write destination under
// .claude-tweaks/artifacts/. The skill legitimately names these literals as explicit
// prohibitions/exclusions (Anti-Patterns table, Step 3's guard) — so each check discriminates
// prohibition from permission by requiring a negation word on the SAME markdown line as the
// mention, rather than banning the literal outright or bounding the check by a raw character
// count. Line-bounding (not a char-count window) is deliberate: each Anti-Patterns table row
// and each Step-3/Step-5 sentence in this file is authored as one unwrapped markdown line, so
// "same line" is a real structural boundary a future edit can't accidentally straddle the way a
// fixed-width character window could (a review finding on this file's first version — a
// 150-char forward window could, in principle, borrow an unrelated row's negation word). Go-red
// proof: the skill file does not exist at base 09ae6c80d, so every literal below was absent
// there; each discriminating check is additionally proven against a hand-doctored permissive
// control.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'walkthrough', 'SKILL.md');
const skill = fs.readFileSync(SKILL_PATH, 'utf8').replace(/\r\n/g, '\n');

// text, a character index into text -> the single line containing that index (no newlines).
function lineAt(text, index) {
  const start = text.lastIndexOf('\n', index) + 1; // -1 + 1 = 0 when there is no preceding \n
  let end = text.indexOf('\n', index);
  if (end === -1) end = text.length;
  return text.slice(start, end);
}

test('the skill never permits loosening a locator to CSS', () => {
  const CSS_MENTION_RE = /(loosen|fall back|degrad\w*)[^.]*CSS/gi;
  const PROHIBITION_RE = /never|do not|don't|must not|stop and report/i;
  const matches = [...skill.matchAll(CSS_MENTION_RE)];
  assert.ok(matches.length > 0, 'expected at least one CSS-related mention to check (the Anti-Patterns/Step-3 prohibition)');
  for (const m of matches) {
    const line = lineAt(skill, m.index);
    assert.match(line, PROHIBITION_RE, `CSS mention "${m[0]}" reads as permission, not prohibition (no negation on the same line: "${line}")`);
  }
  const doctored = 'If the locator cannot be found, loosen the match to a CSS selector.';
  assert.ok(CSS_MENTION_RE.test(doctored), 'doctored control must contain a CSS mention to test against');
  assert.doesNotMatch(lineAt(doctored, doctored.search(CSS_MENTION_RE)), PROHIBITION_RE, 'doctored permissive text must NOT read as a prohibition (proves go-red)');
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
  const hasProhibition = indices.some((idx) => PROHIBITION_RE.test(lineAt(skill, idx)));
  assert.ok(hasProhibition, 'no mention of .claude-tweaks/artifacts/ reads as a prohibition/exclusion for this skill (same-line check)');
  const doctored = 'Save the frames to .claude-tweaks/artifacts/walkthroughs/{story-id}.gif by default.';
  assert.doesNotMatch(lineAt(doctored, doctored.indexOf(LITERAL)), PROHIBITION_RE, 'doctored default-destination text must NOT read as a prohibition (proves go-red)');
});

test('no git commit/git add instruction', () => {
  assert.equal(/git (commit|add)\b/.test(skill), false);
});

test('runs the encode CLI and playwright-cli through the plugin root, never a repo-relative path', () => {
  assert.ok(skill.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/walkthrough-encode.js"'));
});

test('never instructs backend=chrome', () => {
  // The only mention is the Anti-Patterns row heading ("Using `backend=chrome` here"); its
  // rationale ("Restricted to human ad-hoc use...") sits in the same table-row line, after the
  // mention, not before it — the same-line check reads it regardless of direction.
  const idx = skill.indexOf('backend=chrome');
  assert.ok(idx > -1, 'expected the skill to name backend=chrome explicitly at least once (the Anti-Patterns row)');
  const PROHIBITION_RE = /never|not|don't|stop|restrict/i;
  const line = lineAt(skill, idx);
  assert.match(line, PROHIBITION_RE, `backend=chrome mention at ${idx} does not read as a prohibition (same line: "${line}")`);
  const doctored = 'Open the page with backend=chrome for a faster capture.';
  assert.doesNotMatch(lineAt(doctored, doctored.indexOf('backend=chrome')), PROHIBITION_RE, 'doctored permissive text must NOT read as a prohibition (proves go-red)');
});
