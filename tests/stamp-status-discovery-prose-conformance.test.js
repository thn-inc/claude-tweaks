// tests/stamp-status-discovery-prose-conformance.test.js — #4006: pins the shipped prose to the
// behavior of a bare `verify.js --stamp-status` (it discovers `.claude-tweaks/verify-scope.json`
// and composes per-suite records) and `checkFirstCallStamp` (a complete `suiteComposed` verdict
// is verified HEAD with no single stamp). The stamp-reading gates must name the composed verdict.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const SC = readText(path.join(SKILLS, 'test', 'stamp-composition.md'));
const VER = readText(path.join(SKILLS, 'test', 'verification.md'));
const CMS = readText(path.join(SKILLS, 'review', 'code-mode-steps.md'));
const TCG = readText(path.join(SKILLS, 'dispatch', 'two-call-gate.md'));

// Step 1.5 spans `## Step 1.5: Test Gate` up to `### QA Ledger Check`.
function step15(text) {
  const start = text.indexOf('## Step 1.5: Test Gate');
  const end = text.indexOf('### QA Ledger Check', start);
  assert.ok(start >= 0 && end > start, 'Step 1.5 section must be locatable');
  return text.slice(start, end);
}

function assertComposedVerdictNamed(ver, step, tcg) {
  for (const [name, text] of [['verification.md', ver], ['code-mode-steps.md Step 1.5', step], ['two-call-gate.md', tcg]]) {
    assert.match(text, /suiteComposed/, `${name} must name the composed verdict`);
  }
  assert.doesNotMatch(ver, /treat `present: false`, `verifiedHead: false`/);
  assert.match(tcg, /no runner pass stamp verifies the first call/);
}

// A generated-only dirty tree reads `verifiedHead: true` with a live `dirty: true` (#4006), so a
// gate that lists `dirty: true` / "a dirty tree" as "no recent pass" would cancel the exemption.
function assertDirtyNotNoRecentPass(ver, step) {
  const failBullet = step.split('\n').find((l) => /^- \*\*`verifiedHead: false`/.test(l));
  assert.ok(failBullet, 'Step 1.5 must keep its standalone `verifiedHead: false` failure bullet');
  assert.doesNotMatch(failBullet, /dirty: true/, 'Step 1.5 must not list `dirty: true` as no recent pass');
  assert.match(step, /verifiedHead: true[\s\S]{0,320}liveGeneratedExempt/, 'Step 1.5 must name the generated-only dirty tree as verified HEAD');
  const consumerRule = ver.split('\n').find((l) => l.startsWith('- Consumers read it only via'));
  assert.ok(consumerRule, 'verification.md must keep its consumer rule');
  assert.doesNotMatch(consumerRule, /dirty tree as "no recent pass"/, 'the consumer rule must not list a dirty tree as no recent pass');
  assert.match(consumerRule, /generated-only dirty tree \(`liveGeneratedExempt`\)/, 'the consumer rule must name the generated-only case');
}

test('AC10.1: stamp-composition.md no longer says bare --stamp-status never composes', () => {
  assert.doesNotMatch(SC, /never looks at per-suite records/);
  assert.doesNotMatch(SC, /a bare `--stamp-status` never does/);
  assert.match(SC, /with no `--scope`[^.]*`\.claude-tweaks\/verify-scope\.json`/); // the discovery rule is stated
});

test('AC10.2: verification.md, review Step 1.5 and two-call-gate.md name the composed verdict as verified HEAD', () => {
  assertComposedVerdictNamed(VER, step15(CMS), TCG);
});

test('AC10.2 go-red control: the assertions throw on text with suiteComposed removed', () => {
  const strip = (t) => t.replace(/suiteComposed/g, 'REMOVED');
  assert.throws(() => assertComposedVerdictNamed(strip(VER), step15(CMS), TCG));
  assert.throws(() => assertComposedVerdictNamed(VER, strip(step15(CMS)), TCG));
  assert.throws(() => assertComposedVerdictNamed(VER, step15(CMS), strip(TCG)));
});

test('AC10.2: a generated-only dirty tree is not listed as no recent pass in Step 1.5 or the consumer rule', () => {
  assertDirtyNotNoRecentPass(VER, step15(CMS));
});

test('AC10.2 go-red control: the dirty-tree assertion throws when either gate lists dirty as no recent pass', () => {
  const stepWithDirty = step15(CMS).replace('- **`verifiedHead: false`**', '- **`verifiedHead: false` or `dirty: true`**');
  assert.notEqual(stepWithDirty, step15(CMS));
  assert.throws(() => assertDirtyNotNoRecentPass(VER, stepWithDirty));
  const verWithDirty = VER.replace('treat `verifiedHead: false` as', 'treat `verifiedHead: false` or a dirty tree as');
  assert.notEqual(verWithDirty, VER);
  assert.throws(() => assertDirtyNotNoRecentPass(verWithDirty, step15(CMS)));
  assert.throws(() => assertDirtyNotNoRecentPass(VER, step15(CMS).replace(/liveGeneratedExempt/g, 'REMOVED')));
});
