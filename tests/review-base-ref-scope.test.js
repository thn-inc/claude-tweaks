'use strict';
// tests/review-base-ref-scope.test.js (#2256) — /claude-tweaks:review accepts a
// `base:{ref}` scope token (the whole-branch review /claude-tweaks:release's Step 3
// runs before any bump): the three surfaces that list accepted arguments agree,
// and code-mode-steps.md's Step 1/Step 2 name the token's effect.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', 'review', 'SKILL.md'), 'utf8');
const STEPS = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', 'review', 'code-mode-steps.md'), 'utf8');

test('argument-hint lists base:<ref>', () => {
  const hint = /^argument-hint:\s*"(.*)"$/m.exec(SKILL);
  assert.ok(hint, 'argument-hint present');
  assert.match(hint[1], /base:<ref>/);
});

test('the ## Input section carries a numbered rule for base:{ref} naming the first-parent scope', () => {
  const input = SKILL.slice(SKILL.indexOf('## Input'), SKILL.indexOf('## Code-Mode Procedure'));
  // the restatement sentence is the third mirror (#679) — pin it independently of rule 9
  assert.match(input, /`\$ARGUMENTS` = spec number, file paths, a `base:\{ref\}` scope, mode, effort tier, or visual review target\./);
  assert.match(input, /^9\. \*\*`base:\{ref\}`\*\*/m);
  assert.match(input, /first-parent/);
  assert.match(input, /origin\/\{integration-branch\}/);
  assert.match(input, /\/claude-tweaks:release/);
});

test('code-mode-steps: Step 1 skips on a base:{ref} scope, Step 2 resolves {base} from it', () => {
  const step1 = STEPS.slice(STEPS.indexOf('## Step 1: Spec Compliance'), STEPS.indexOf('## Step 1.5'));
  assert.match(step1, /base:\{ref\}/);
  const step2 = STEPS.slice(STEPS.indexOf('## Step 2: Identify What Changed'), STEPS.indexOf('### Merge-Provenance Check'));
  assert.match(step2, /base:\{ref\}/);
  assert.match(step2, /--first-parent/);
});
