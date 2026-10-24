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

const STEP15 = step15(CMS);

// Each gate must name a complete composed verdict on its verified side, sentence by sentence and
// per Step 1.5 branch, so a mention in a negated or unrelated sentence, or in one branch only,
// does not satisfy the pin.
function assertComposedVerdictNamed(ver, step, tcg) {
  const standaloneAt = step.indexOf('### Standalone');
  const checks = [
    ['verification.md', ver, /`true` covers a complete `suiteComposed`/],
    ['code-mode-steps.md Step 1.5 flow branch', step.slice(0, standaloneAt), /`verifiedHead: true` \([^)]*complete per-suite records, `suiteComposed`/],
    ['code-mode-steps.md Step 1.5 standalone branch', step.slice(standaloneAt), /\*\*`verifiedHead: true`\*\* \([^\n]*complete per-suite records `suiteComposed`/],
    ['two-call-gate.md', tcg, /`verified: true` \([^)]*a complete `suiteComposed` verdict/],
  ];
  for (const [name, text, pattern] of checks) {
    assert.match(text, pattern, `${name} must name the composed verdict as verified HEAD`);
  }
  assert.doesNotMatch(ver, /treat `present: false`, `verifiedHead: false`/);
  assert.match(tcg, /no runner pass stamp verifies the first call/, 'two-call-gate.md must keep its no-stamp note fragment');
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
  assertComposedVerdictNamed(VER, STEP15, TCG);
});

test('AC10.2 go-red control: the assertions throw when any one gate, branch or fragment drops the composed verdict', () => {
  const mutate = (text, from, to) => {
    const out = text.replaceAll(from, to);
    assert.notEqual(out, text, `control mutation must change the text: ${from}`);
    return out;
  };
  assert.throws(() => assertComposedVerdictNamed(mutate(VER, '`true` covers a complete', '`true` never covers a complete'), STEP15, TCG),
    { message: /verification\.md must name the composed verdict/ });
  assert.throws(() => assertComposedVerdictNamed(VER, mutate(STEP15, 'records, `suiteComposed`', 'records, REMOVED'), TCG),
    { message: /Step 1\.5 flow branch must name the composed verdict/ });
  assert.throws(() => assertComposedVerdictNamed(VER, mutate(STEP15, 'records `suiteComposed`', 'records REMOVED'), TCG),
    { message: /Step 1\.5 standalone branch must name the composed verdict/ });
  assert.throws(() => assertComposedVerdictNamed(VER, STEP15, mutate(TCG, 'a complete `suiteComposed` verdict', 'REMOVED')),
    { message: /two-call-gate\.md must name the composed verdict/ });
  assert.throws(() => assertComposedVerdictNamed(VER, STEP15, mutate(TCG, 'no runner pass stamp verifies the first call', 'REMOVED')),
    { message: /two-call-gate\.md must keep its no-stamp note fragment/ });
});

test('AC10.2: a generated-only dirty tree is not listed as no recent pass in Step 1.5 or the consumer rule', () => {
  assertDirtyNotNoRecentPass(VER, STEP15);
});

test('AC10.2 go-red control: the dirty-tree assertion throws when either gate lists dirty as no recent pass', () => {
  const stepWithDirty = STEP15.replace('- **`verifiedHead: false`**', '- **`verifiedHead: false` or `dirty: true`**');
  assert.notEqual(stepWithDirty, STEP15);
  assert.throws(() => assertDirtyNotNoRecentPass(VER, stepWithDirty), { message: /must not list `dirty: true` as no recent pass/ });
  const verWithDirty = VER.replace('treat `verifiedHead: false` as', 'treat `verifiedHead: false` or a dirty tree as');
  assert.notEqual(verWithDirty, VER);
  assert.throws(() => assertDirtyNotNoRecentPass(verWithDirty, STEP15), { message: /the consumer rule must not list a dirty tree as no recent pass/ });
  assert.throws(() => assertDirtyNotNoRecentPass(VER, STEP15.replace(/liveGeneratedExempt/g, 'REMOVED')), { message: /must name the generated-only dirty tree as verified HEAD/ });
});
