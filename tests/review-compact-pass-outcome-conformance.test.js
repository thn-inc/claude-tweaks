'use strict';
// Pins #5359: /review's compact clean-PASS form must not render over a partial
// Current-State outcome (Step 1 item 5). The template's compact-form list carries
// the condition; Step 7 names spec compliance and defers to that list.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const template = readText(path.join(SKILLS, 'review', 'review-summary-template.md'));
const steps = readText(path.join(SKILLS, 'review', 'code-mode-steps.md'));

// Both anchors must resolve; the end anchor is searched after the start so a
// repeated end string elsewhere in the file cannot pull the slice wider.
function between(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `anchor missing: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `anchor missing: ${end}`);
  return text.slice(from, to);
}

const compact = between(template, '## Compact form — clean PASS', '```markdown');
const step7 = between(steps, '## Step 7: Present Review Summary', '### Key Learnings for Wrap-Up');

const OUTCOME_BULLET_RE = /^- Step 1 item 5's Current-State outcome is not `partial` — /m;
const STEP7_RE = /\*\*compact clean-PASS form\*\* \([^)]*spec compliance[^)]*\)/;

// Frozen at base 79cd5710d: the compact-form bullet list before this change.
const PRE_CHANGE_COMPACT = `- Verdict is PASS
- Every deliverable is \`done\` and every criterion \`met\` — a \`partial\`, \`missing\` or \`unverifiable\` item (Step 1 item 6) needs the full template's Spec Compliance tables
- Zero findings in every category (code review, hindsight, visual, design quality, coverage, docs) and zero unresolved QA ledger entries. A non-empty skill load delta (3j) is informational and does not disqualify the compact form. A Coverage caveat (\`step3-tier-variants.md\`'s partner-died single-read degrade) is informational and does not disqualify the compact form either. An **Independence: degraded** line is informational the same way.
- Zero tradeoffs accepted, zero autonomous actions performed (no fixes, no simplifier changes, no ledger resolutions)
- No manual steps required
- No \`/build\` plan step left not run (the full template's "Not run by /build" section would be omitted)
- Zero untracked files and zero new listeners reported by the post-fan-out sweep (\`step3-lens-dispatch.md\`)
- Step 3.7's tiebreak (\`step3-tiebreak.md\`) had nothing to judge, or every verdict was \`confirmed\` or \`drop\`, and no Tiebreak caveat applies`;

// Frozen at base 79cd5710d: Step 7's compact-condition sentence before this change.
const PRE_CHANGE_STEP7 = 'For the complete template, the context-signal rules, and the **compact clean-PASS form** (rendered instead of the full template when the verdict is PASS with zero findings, zero actions, and zero manual steps), read `review-summary-template.md` in this skill\'s directory.';

function assertOutcomeBullet(text) {
  assert.match(text, OUTCOME_BULLET_RE, 'compact form must exclude a partial Current-State outcome');
}

function assertStep7NamesSpecCompliance(text) {
  assert.match(text, STEP7_RE, 'Step 7 must name spec compliance in the compact-condition sentence');
}

test('AC1.1: the compact-form list excludes a partial Current-State outcome (Step 1 item 5)', () => {
  assertOutcomeBullet(compact);
});

test('AC1.1: the compact-form pin goes red when the clause is removed', () => {
  const mutated = compact.split('\n').filter((l) => !OUTCOME_BULLET_RE.test(l)).join('\n');
  assert.notStrictEqual(mutated, compact);
  assert.throws(() => assertOutcomeBullet(mutated));
  assert.throws(() => assertOutcomeBullet(PRE_CHANGE_COMPACT));
});

test("AC2.1: Step 7's compact-condition sentence names spec compliance", () => {
  assertStep7NamesSpecCompliance(step7);
});

test('AC2.1: the Step 7 pin goes red against the pre-change sentence', () => {
  assert.throws(() => assertStep7NamesSpecCompliance(PRE_CHANGE_STEP7));
});
