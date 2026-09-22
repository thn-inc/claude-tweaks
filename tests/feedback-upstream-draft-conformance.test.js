'use strict';
// tests/feedback-upstream-draft-conformance.test.js — #2759: /claude-tweaks:feedback's
// draft-only `--upstream <owner/name>` path. Five live-corpus pins, read fresh from the
// working tree rather than frozen into fixtures: this is just-shipped skill prose that is
// expected to keep evolving in place, and a fixture copy would pin the fixture, not the
// shipped instruction the model actually follows.
//
// Discrimination proof (skill-prose-conformance-tests): all five were RUN red before any
// implementation landed. (1) and (2) failed on content — learning-routing.md still ended
// its third-party rule in "and stop", and the Anti-Patterns row was not yet scoped to
// *filing*. (3), (4), and (5) failed because plugin/skills/feedback/upstream-draft.md did
// not exist. Each test reads its own files lazily so a missing file fails exactly one test
// instead of crashing the module at load.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const ROUTING_PATH = 'plugin/skills/_shared/learning-routing.md';
const SKILL_PATH = 'plugin/skills/feedback/SKILL.md';
const DRAFT_PATH = 'plugin/skills/feedback/upstream-draft.md';

// The third-party rule is one paragraph: its bold lead-in through the next blank line.
function thirdPartyParagraph() {
  const routing = read(ROUTING_PATH);
  const start = routing.indexOf('**Non-claude-tweaks upstream.**');
  assert.ok(start >= 0, `${ROUTING_PATH} must still carry the "Non-claude-tweaks upstream" rule`);
  const end = routing.indexOf('\n\n', start);
  return routing.slice(start, end === -1 ? routing.length : end);
}

test('(1) the third-party rule routes to --upstream and no longer dead-ends in "and stop"', () => {
  const para = thirdPartyParagraph();
  assert.ok(para.includes('--upstream'), 'the rule must hand the learning to --upstream');
  assert.ok(para.includes('publishes nothing'), 'the rule must state that the path publishes nothing');
  assert.equal(/\band stop\b/.test(para), false, 'the rule must no longer end by telling the classifier to stop');
});

test('(2) feedback/SKILL.md still forbids FILING against a non-claude-tweaks repo', () => {
  const skill = read(SKILL_PATH);
  const table = skill.slice(skill.indexOf('## Anti-Patterns'));
  const rows = table.split('\n').filter((l) => l.startsWith('|') && l.includes('other than `thomasholknielsen/claude-tweaks`'));
  assert.equal(rows.length, 1, 'exactly one Anti-Patterns row may forbid a non-claude-tweaks target — rewrite it, never add a second');
  assert.ok(rows[0].includes('**Filing**'), 'the row must scope the prohibition to *filing*, since drafting is now sanctioned');
  assert.ok(rows[0].includes('--upstream'), 'the row must name --upstream as the sanctioned alternative');
});

test('(3) upstream-draft.md never names the filing CLI', () => {
  const draft = read(DRAFT_PATH);
  assert.equal(draft.includes('file-feedback.js'), false, 'the draft path must never invoke the filing CLI');
});

test('(4) the persisted draft sits outside the consoles\' glob and the path never pre-confirms', () => {
  const draft = read(DRAFT_PATH);
  const m = draft.match(/`staged\/([a-z0-9-]+-\{N\}\.md)`/);
  assert.ok(m, 'upstream-draft.md must name its persisted staged/ filename as a backticked literal');
  assert.equal(m[1], 'upstream-draft-{N}.md', `persisted filename is ${m[1]}`);
  assert.equal(/wrap-up-upstream-.*\.md/.test(m[1]), false,
    `${m[1]} must not match the staged/wrap-up-upstream-*.md aggregation glob the wrap-up and multi-spec consoles scan`);
  assert.equal(draft.includes('--pre-confirmed'), false, 'nothing is published on this path, so nothing is pre-confirmed');
});

test('(5) upstream-draft.md renders the hand-off block and states the single-quote escaping rule', () => {
  const draft = read(DRAFT_PATH);
  assert.ok(draft.includes("gh issue create --repo <owner/name> --title '<title>' --body-file"),
    'the hand-off block must render verbatim, with the body via --body-file');
  assert.ok(draft.includes("'\\''"), "the escaping rule must name the four-character '\\'' form");
});
