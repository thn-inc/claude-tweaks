'use strict';
// #2628: focus=app-store-readiness must land its criterion, fragment, both
// focus-mode.md per-vertical rows, and its /review participation (Step 6.66,
// the Step 6.7 category row, the summary-template section) in the same
// change as its registry key — same discipline code-health-focus-vertical's
// skill documents, pinned here the way #2749's agent-trust-scope wiring test
// pins its own vertical.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const FOCUS_MODE = read('plugin/skills/code-health/focus-mode.md');
const { getCriterion } = require('../plugin/bin/lib/code-health/criteria');
const { FOCUS_GENERATORS } = require('../plugin/bin/lib/code-health/focus-generators');

const KINDS = [
  'missing-apple-signin-parity',
  'external-payment-no-iap',
  'missing-account-deletion',
  'incomplete-demo-login',
  'unverified-ipad-layout',
  'unlabeled-paid-screenshot',
  'dead-support-privacy-link',
  'coming-soon-placeholder',
  'missing-ugc-report-path',
  'broken-restore-purchases',
];

function section(md, heading, nextHeading) {
  const start = md.indexOf(`## ${heading}`);
  const end = md.indexOf(`## ${nextHeading}`, start + 1);
  assert.ok(start >= 0 && end > start, `focus-mode.md must have "## ${heading}" followed by "## ${nextHeading}"`);
  return md.slice(start, end);
}

test('the app-store-readiness criterion is registered with its fragment', () => {
  assert.equal(getCriterion('app-store-readiness').fragment, 'criteria-app-store-readiness.md');
});

test('app-store-readiness is registered in FOCUS_GENERATORS', () => {
  assert.equal(typeof FOCUS_GENERATORS['app-store-readiness'], 'function');
});

test('focus-mode.md pins app-store-readiness to its criterion and fragment', () => {
  const pinning = section(FOCUS_MODE, 'Criterion pinning', 'F0');
  assert.match(pinning, /^\| `app-store-readiness` \| `app-store-readiness` \| `criteria-app-store-readiness\.md` \|$/m);
});

test('focus-mode.md Coverage points at the app-store-readiness generator', () => {
  assert.match(section(FOCUS_MODE, 'Coverage', 'Criterion pinning'), /candidates-app-store-readiness\.js/);
});

test('focus-mode.md F2 names the app-store-readiness not-applicable message', () => {
  const f2 = section(FOCUS_MODE, 'F2', 'F3');
  assert.match(f2, /focus=app-store-readiness: not applicable — no mobile-app signal detected/);
});

test('criteria-app-store-readiness.md names all ten candidate kinds', () => {
  const fragment = read('plugin/skills/_shared/criteria-app-store-readiness.md');
  for (const kind of KINDS) {
    assert.ok(fragment.includes(`\`${kind}\``), `fragment missing candidate kind \`${kind}\``);
  }
});

test('review wires in Step 6.66 and consolidates it into Step 6.7 routing', () => {
  const passes = read('plugin/skills/review/focus-criterion-passes.md');
  assert.match(passes, /## Step 6\.66: App Store Readiness Pass/);
  assert.match(passes, /candidates-app-store-readiness\.js/);
  assert.match(passes, /getCriterion\('app-store-readiness'\)/);

  const steps = read('plugin/skills/review/code-mode-steps.md');
  assert.match(steps, /App Store Readiness`\s*\(from Step 6\.66\)/);
});

test('review-summary-template.md carries an App Store Readiness section', () => {
  const template = read('plugin/skills/review/review-summary-template.md');
  assert.match(template, /^### App Store Readiness \(from Step 6\.66/m);
});
