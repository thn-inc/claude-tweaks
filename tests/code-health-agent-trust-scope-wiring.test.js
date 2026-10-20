'use strict';
// #2749: focus=agent-trust-scope must land its criterion, fragment, and both
// focus-mode.md per-vertical rows in the same change as its registry key —
// same discipline code-health-focus-vertical's skill documents, pinned here
// the same way #2693's prelaunch wiring test pins its own vertical.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const FOCUS_MODE = readText(path.join(ROOT, 'plugin/skills/code-health/focus-mode.md'));
const { getCriterion } = require('../plugin/bin/lib/code-health/criteria');
const { FOCUS_GENERATORS } = require('../plugin/bin/lib/code-health/focus-generators');

function section(md, heading, nextHeading) {
  const start = md.indexOf(`## ${heading}`);
  const end = md.indexOf(`## ${nextHeading}`, start + 1);
  assert.ok(start >= 0 && end > start, `focus-mode.md must have "## ${heading}" followed by "## ${nextHeading}"`);
  return md.slice(start, end);
}

test('the agent-trust-scope criterion is registered with its fragment', () => {
  assert.deepStrictEqual(getCriterion('agent-trust-scope'), {
    id: 'agent-trust-scope',
    appliesTo: ['infra'],
    confidenceFloor: 'medium',
    fragment: 'criteria-agent-trust-scope.md',
  });
});

test('agent-trust-scope is registered in FOCUS_GENERATORS', () => {
  assert.equal(typeof FOCUS_GENERATORS['agent-trust-scope'], 'function');
});

test('focus-mode.md pins agent-trust-scope to its criterion and fragment', () => {
  const pinning = section(FOCUS_MODE, 'Criterion pinning', 'F0');
  assert.match(pinning, /^\| `agent-trust-scope` \| `agent-trust-scope` \| `criteria-agent-trust-scope\.md` \|$/m);
});

test('focus-mode.md Coverage points at the agent-trust-scope generator', () => {
  assert.match(section(FOCUS_MODE, 'Coverage', 'Criterion pinning'), /candidates-agent-trust-scope\.js/);
});

test('focus-mode.md F2 names the agent-trust-scope not-applicable message', () => {
  const f2 = section(FOCUS_MODE, 'F2', 'F3');
  assert.match(f2, /focus=agent-trust-scope: not applicable — no \.claude-tweaks\/policy\.yml/);
});

test('criteria-agent-trust-scope.md names all three candidate kinds', () => {
  const fragment = readText(path.join(ROOT, 'plugin/skills/_shared/criteria-agent-trust-scope.md'));
  for (const kind of ['registry-access', 'network-egress', 'credential-scope']) {
    assert.ok(fragment.includes(`\`${kind}\``), `fragment missing candidate kind \`${kind}\``);
  }
});

test('review wires in Step 6.65 and consolidates Step 6.7 routing', () => {
  // #2628 split the Step 6.6/6.65/6.66 component-pass bodies out of
  // code-mode-steps.md into focus-criterion-passes.md to stay under the
  // per-file byte ceiling (tests/ceremony-profile-roster.test.js's #1926 AC7
  // check) — step numbering and the Step 6.7 consolidated-routing table
  // (still in code-mode-steps.md) are unaffected by the split.
  const passes = readText(path.join(ROOT, 'plugin/skills/review/focus-criterion-passes.md'));
  assert.match(passes, /## Step 6\.65: Agent Trust Scope Pass/);
  assert.match(passes, /candidates-agent-trust-scope\.js/);
  assert.match(passes, /getCriterion\('agent-trust-scope'\)/);

  const steps = readText(path.join(ROOT, 'plugin/skills/review/code-mode-steps.md'));
  assert.match(steps, /focus-criterion-passes\.md/);
  assert.match(steps, /Agent Trust Scope`\s*\(from Step 6\.65\)/);
});

test('docs/getting-started.md counts the shipped verticals including agent-trust-scope', () => {
  // The exact count (originally "seven" at #2749) bumps as new verticals
  // ship (#2628 made it eight) — this test only pins that the prose and the
  // actual count stay in sync, not a frozen historical number.
  const docs = readText(path.join(ROOT, 'docs/getting-started.md'));
  const { FOCUS_GENERATORS } = require('../plugin/bin/lib/code-health/focus-generators');
  const countWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const expectedWord = countWords[Object.keys(FOCUS_GENERATORS).length];
  assert.match(docs, new RegExp(`${expectedWord} verticals shipped`));
  assert.match(docs, /`agent-trust-scope`/);
  assert.match(docs, /`app-store-readiness`/);
});

const CRITERIA_PATH = path.join(ROOT, 'plugin/skills/_shared/criteria-agent-trust-scope.md');

function assertAcceptedRiskGuard(fragment) {
  const start = fragment.indexOf('## What NOT to flag');
  const end = fragment.indexOf('## Severity calibration', start + 1);
  assert.ok(start >= 0 && end > start, 'fragment must have "## What NOT to flag" before "## Severity calibration"');
  const notFlag = fragment.slice(start, end);
  for (const needle of ['docs/decisions/', '**Status:**', '`accepted`', '## Decision', 'superseded', 'proposed',
    'accepted risk — ADR NNNN ({kind})', 'never as a finding', 'never as a filed issue']) {
    assert.ok(notFlag.includes(needle), `What NOT to flag is missing the accepted-risk guard element: ${needle}`);
  }
  const prompt = fragment.slice(fragment.indexOf('## Copy-paste prompt'));
  assert.ok(prompt.includes('accepted risk — ADR NNNN'), 'copy-paste prompt must mirror the accepted-risk exception');
}

test('AC1.1/AC2.1/AC3.1: criteria fragment carries the accepted-risk ADR guard', () => {
  assertAcceptedRiskGuard(readText(CRITERIA_PATH));
});

test('go-red: the accepted-risk guard check fails when the bullet is removed', () => {
  const fragment = readText(CRITERIA_PATH);
  const mutated = fragment.replace(/^- A dimension the project has formally accepted in an ADR[\s\S]*?(?=\n\n## Severity calibration)/m, '');
  assert.notEqual(mutated, fragment, 'mutation did not apply — the bullet must start with "- A dimension the project has formally accepted in an ADR"');
  assert.throws(() => assertAcceptedRiskGuard(mutated));
});
