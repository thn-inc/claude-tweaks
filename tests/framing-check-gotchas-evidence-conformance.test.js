// tests/framing-check-gotchas-evidence-conformance.test.js
// Pins the framing-check mode's evidence-aware Gather/Judge wording added for #772:
// Step 1 (Gather) now names the body's ## Gotchas evidence bullets, and Step 2 (Judge)
// weighs a `supported` evidence bullet toward `open`, one-directionally only. See #772.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const CHALLENGE = readText(path.join(REPO_ROOT, 'plugin/skills/challenge/SKILL.md'));

const step1Idx = CHALLENGE.indexOf('### Step 1: Gather');
const step2Idx = CHALLENGE.indexOf('### Step 2: Judge');
const step3Idx = CHALLENGE.indexOf('### Step 3: Render');

test('framing-check Step 1 (Gather) names the body\'s ## Gotchas evidence bullets', () => {
  assert.ok(step1Idx >= 0 && step2Idx > step1Idx, 'Step 1 and Step 2 headings must both be present and in order');
  const step1Text = CHALLENGE.slice(step1Idx, step2Idx);
  assert.ok(
    step1Text.includes('## Gotchas'),
    'Step 1 (Gather) must name the ## Gotchas section as something it reads'
  );
  assert.ok(
    step1Text.includes('- evidence ({YYYY-MM-DD}): {classification} — {citation}'),
    'Step 1 (Gather) must name the evidence-bullet shape the bare-#N mode writes'
  );
  assert.ok(
    step1Text.includes('Missing section or no matching bullets: no signal'),
    'Step 1 (Gather) must state the no-signal fallback so a record with no evidence bullets is unaffected'
  );
});

test('framing-check Step 2 (Judge) weighs a supported evidence bullet toward open, one-directionally', () => {
  assert.ok(step2Idx >= 0 && step3Idx > step2Idx, 'Step 2 and Step 3 headings must both be present and in order');
  const step2Text = CHALLENGE.slice(step2Idx, step3Idx);
  assert.ok(
    step2Text.includes('Weighing supplied `## Gotchas` evidence'),
    'Step 2 (Judge) must state the evidence-weighing rule'
  );
  assert.ok(
    step2Text.includes('classified `supported` with a real `file:line` citation'),
    'Step 2 (Judge) must key the weighing rule on the supported classification with a real citation'
  );
  assert.ok(
    step2Text.includes('it counts toward `open`'),
    'Step 2 (Judge) must state the supported bullet counts toward open'
  );
  assert.ok(
    step2Text.includes('This only ever moves a verdict toward `open`'),
    'Step 2 (Judge) must state the one-directional constraint explicitly'
  );
  assert.ok(
    step2Text.includes('a `contradicted` or `no evidence found` bullet') &&
    step2Text.includes('adds no signal'),
    'Step 2 (Judge) must state that a contradicted/no-evidence-found bullet, or no bullet at all, adds no signal'
  );
});

test('framing-check Step 2 (Judge) still states the ambiguity-resolves-to-open rule, after the new weighing paragraph', () => {
  const weighIdx = CHALLENGE.indexOf('Weighing supplied `## Gotchas` evidence');
  const ambiguityIdx = CHALLENGE.indexOf('**Ambiguity resolves to `open`.**');
  assert.ok(weighIdx >= 0, 'the weighing paragraph must be present');
  assert.ok(ambiguityIdx >= 0, 'the pre-existing ambiguity-resolves-to-open rule must still be present, untouched');
  assert.ok(weighIdx < ambiguityIdx, 'the weighing paragraph must precede the untouched ambiguity rule, per the plan\'s insertion point');
});

test('bare-#N mode\'s Next Actions no longer claims re-shaping unconditionally re-applies the label', () => {
  const nextActionsIdx = CHALLENGE.indexOf('## Next Actions');
  assert.ok(nextActionsIdx >= 0, 'Next Actions heading must be present');
  const nextActionsText = CHALLENGE.slice(nextActionsIdx);
  assert.ok(
    !nextActionsText.includes('so the label returns unless the framing itself changed (recommended after a bare-`#N` run that changed the framing)'),
    'the stale unconditional claim (pre-#772 wording) must no longer be present'
  );
  assert.ok(
    nextActionsText.includes('after **accept the risk** the label still returns unless the framing itself changed'),
    'Next Actions must state accept-the-risk still re-derives the same verdict on re-shape'
  );
  assert.ok(
    nextActionsText.includes('after **supply evidence**, a `supported`-classified assumption can now clear the label even with an unchanged framing'),
    'Next Actions must state supply-evidence with supported classification can now clear the label on re-shape'
  );
});
