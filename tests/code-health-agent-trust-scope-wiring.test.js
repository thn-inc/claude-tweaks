'use strict';
// #2749: focus=agent-trust-scope must land its criterion, fragment, and both
// focus-mode.md per-vertical rows in the same change as its registry key —
// same discipline code-health-focus-vertical's skill documents, pinned here
// the same way #2693's prelaunch wiring test pins its own vertical.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FOCUS_MODE = fs.readFileSync(path.join(ROOT, 'plugin/skills/code-health/focus-mode.md'), 'utf8');
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
  const fragment = fs.readFileSync(path.join(ROOT, 'plugin/skills/_shared/criteria-agent-trust-scope.md'), 'utf8');
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
  const passes = fs.readFileSync(path.join(ROOT, 'plugin/skills/review/focus-criterion-passes.md'), 'utf8');
  assert.match(passes, /## Step 6\.65: Agent Trust Scope Pass/);
  assert.match(passes, /candidates-agent-trust-scope\.js/);
  assert.match(passes, /getCriterion\('agent-trust-scope'\)/);

  const steps = fs.readFileSync(path.join(ROOT, 'plugin/skills/review/code-mode-steps.md'), 'utf8');
  assert.match(steps, /focus-criterion-passes\.md/);
  assert.match(steps, /Agent Trust Scope`\s*\(from Step 6\.65\)/);
});

test('docs/getting-started.md counts the shipped verticals including agent-trust-scope', () => {
  // The exact count (originally "seven" at #2749) bumps as new verticals
  // ship (#2628 made it eight) — this test only pins that the prose and the
  // actual count stay in sync, not a frozen historical number.
  const docs = fs.readFileSync(path.join(ROOT, 'docs/getting-started.md'), 'utf8');
  const { FOCUS_GENERATORS } = require('../plugin/bin/lib/code-health/focus-generators');
  const countWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const expectedWord = countWords[Object.keys(FOCUS_GENERATORS).length];
  assert.match(docs, new RegExp(`${expectedWord} verticals shipped`));
  assert.match(docs, /`agent-trust-scope`/);
  assert.match(docs, /`app-store-readiness`/);
});
