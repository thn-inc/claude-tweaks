'use strict';
// tests/feedback-upstream-draft-conformance.test.js — #2759: /claude-tweaks:feedback's
// draft-only `--upstream <owner/name>` path. Six live-corpus pins, read fresh from the
// working tree rather than frozen into fixtures: this is just-shipped skill prose that is
// expected to keep evolving in place, and a fixture copy would pin the fixture, not the
// shipped instruction the model actually follows.
//
// Discrimination proof (skill-prose-conformance-tests): (1) through (5) were all RUN red
// before any implementation landed. (1) and (2) failed on content — learning-routing.md
// still ended its third-party rule in "and stop", and the Anti-Patterns row was not yet
// scoped to *filing*. (3), (4), and (5) failed because plugin/skills/feedback/
// upstream-draft.md did not exist. (6) landed later in the fix wave and carries its own
// proof at its site below. Each test reads its own files lazily so a missing file fails
// exactly one test instead of crashing the module at load.
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
  const antiPatterns = skill.slice(skill.indexOf('## Anti-Patterns'));
  const rows = antiPatterns.split('\n').filter((l) => l.startsWith('|') && l.includes('other than `thn-inc/claude-tweaks`'));
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
  const match = draft.match(/`staged\/([a-z0-9-]+-\{N\}\.md)`/);
  assert.ok(match, 'upstream-draft.md must name its persisted staged/ filename as a backticked literal');
  // Pinned to the exact literal: any drift is a drift into the staged/wrap-up-upstream-*.md
  // aggregation glob the wrap-up and multi-spec consoles scan.
  assert.equal(match[1], 'upstream-draft-{N}.md',
    `persisted filename is ${match[1]}, which must stay outside the staged/wrap-up-upstream-*.md aggregation glob`);
  assert.equal(draft.includes('--pre-confirmed'), false, 'nothing is published on this path, so nothing is pre-confirmed');
});

test('(5) upstream-draft.md renders the hand-off block and states the single-quote escaping rule', () => {
  const draft = read(DRAFT_PATH);
  assert.ok(draft.includes("gh issue create --repo <owner/name> --title '<title>' --body-file"),
    'the hand-off block must render verbatim, with the body via --body-file');
  assert.ok(draft.includes("'\\''"), "the escaping rule must name the four-character '\\'' form");
});

// C1 (the critical bug this fix wave closed): Step 2's `--upstream` routing paragraph must
// precede the "stop" clause, or `--upstream` dispatch is unreachable — a learning that names
// `--upstream` never gets past the stop before it can be routed into upstream-draft.md. This is
// a pure prose-ordering defect: nothing else in the corpus goes red if the paragraphs are swapped
// back, so this test exists purely to pin the order (skill-prose-conformance-tests' "prove it can
// actually go red" discipline).
test('(6) SKILL.md Step 2: the --upstream routing paragraph precedes the stop clause', () => {
  const skill = read(SKILL_PATH);
  const stepStart = skill.indexOf('### Step 2: Classify the kind');
  assert.ok(stepStart >= 0, `${SKILL_PATH} must still carry Step 2`);
  const stepEnd = skill.indexOf('### Step 3:', stepStart);
  assert.ok(stepEnd > stepStart, `${SKILL_PATH} must still carry Step 3 after Step 2`);
  const step2 = skill.slice(stepStart, stepEnd);

  const routingIdx = step2.indexOf('**`--upstream` routing.**');
  const stopIdx = step2.indexOf('**If it is not D5 and `--upstream` was not given, stop.**');
  assert.ok(routingIdx >= 0, 'Step 2 must still carry the --upstream routing paragraph');
  assert.ok(stopIdx >= 0, 'Step 2 must still carry the "stop" clause');
  assert.ok(routingIdx < stopIdx,
    'the --upstream routing paragraph must precede the stop clause, or --upstream dispatch is unreachable (C1)');
});
