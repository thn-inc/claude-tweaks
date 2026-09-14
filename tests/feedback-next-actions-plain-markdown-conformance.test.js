'use strict';

// tests/feedback-next-actions-plain-markdown-conformance.test.js (#835) — pins
// that /claude-tweaks:feedback's terminal `## Next Actions` step renders as
// plain markdown and never forces an `AskUserQuestion` call. At the time #835
// was filed (plugin v6.87.0), this section's own closing-step logic asked
// "what next?" via `AskUserQuestion` even when the Recommended option already
// restated a next step the skill had fully determined. The repo-wide
// Interaction style banner every session gets injected by the SessionStart
// hook (#1909; pinned separately by tests/skill-conventions.test.js and
// tests/hooks-session-start.test.js) states the general convention, but does
// not itself check that this skill's own Next Actions section complies —
// this test pins the section's own content directly, so a future edit to
// this skill specifically can't silently reintroduce the forced question.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'feedback', 'SKILL.md');
const skillText = fs.readFileSync(SKILL_PATH, 'utf8');

// Extracts the body of a `## {heading}` section: everything after the heading
// line up to (not including) the next `## ` heading, or end of file. Anchored
// on a line-start `## ` (via the `m` flag) so a prose sentence that merely
// mentions "## {heading}" in passing (the Interaction style banner does,
// describing the convention) is never mistaken for the real heading.
function section(text, heading) {
  const headingRe = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  const m = headingRe.exec(text);
  assert.ok(m, `heading not found at line start: ## ${heading}`);
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

// The pre-#835-fix shape: a forced `AskUserQuestion` at the closing step
// whose Recommended option restates information the skill already knows.
// Frozen here (not read from history) so this control survives future edits
// to the live file — [IL-80]'s fixture pattern.
const PRE_FIX_NEXT_ACTIONS = `

Ask the user what to do next:

\`\`\`
AskUserQuestion({
  question: "What would you like to do next?",
  options: [
    { label: "Resume the interrupted flow", description: "Continue the spec review that was in progress before this filing.", recommended: true },
    { label: "Do something else", description: "..." },
  ],
})
\`\`\`
`;

// One claim per call, matching both directions — the pattern must NOT match
// the live section, and MUST match the frozen pre-fix control, proving the
// assertion can actually go red [IL-105].
function assertNoAskUserQuestion(liveSection, control) {
  assert.doesNotMatch(
    liveSection,
    /AskUserQuestion/,
    'closing ## Next Actions must not call AskUserQuestion — plain markdown per the Interaction style banner',
  );
  assert.match(
    control,
    /AskUserQuestion/,
    'control fixture must itself contain AskUserQuestion, proving the pattern above can go red',
  );
}

test('feedback: terminal ## Next Actions section never calls AskUserQuestion (#835)', () => {
  const nextActions = section(skillText, 'Next Actions');
  assertNoAskUserQuestion(nextActions, PRE_FIX_NEXT_ACTIONS);
});

test('feedback: terminal ## Next Actions renders at least one bold, fully-qualified recommended command', () => {
  const nextActions = section(skillText, 'Next Actions');
  assert.match(
    nextActions,
    /\*\*.*`\/claude-tweaks:/,
    'expected a bold, fully-qualified recommended command line (plain-markdown rendering, not a question)',
  );
});
