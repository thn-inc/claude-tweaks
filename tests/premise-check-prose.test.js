// tests/premise-check-prose.test.js
//
// #1829 AC4: a prose pin confirming the Premise-check: contract is actually
// documented where a reader/build needs it — `claude-md-curation.md` names
// both `verifiedAsOf` and `Premise-check:` for its over-budget filing, and
// `flow/materialize.md` carries the "Premise check" paragraph beside its
// existing drift paragraphs. Reads live skill text (not a byte-pinned
// fixture) — the assertion is "these tokens exist in this file", not
// pinning an executable snippet.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SKILLS_ROOT = path.join(__dirname, '..', 'plugin', 'skills');

function read(relPath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, relPath), 'utf8');
}

test('#1829: wrap-up/claude-md-curation.md names verifiedAsOf and Premise-check: for the over-budget filing', () => {
  const body = read(path.join('wrap-up', 'claude-md-curation.md'));
  assert.match(body, /verifiedAsOf/);
  assert.match(body, /Premise-check:/);
  assert.match(body, /claudeMdBudgetTargets/, 'names the measured sibling fact, not just the boolean');
});

test('#1829: flow/materialize.md documents the Premise check paragraph beside the drift paragraphs', () => {
  const body = read(path.join('flow', 'materialize.md'));
  assert.match(body, /\*\*Premise check \(#1829\)\.\*\*/);
  assert.match(body, /Premise-check:/);
  assert.match(body, /satisfiedAtBase/);
  // "beside" — the new paragraph sits after the two existing drift
  // paragraphs, not replacing or duplicating them.
  const namedLocationIdx = body.indexOf('**Named-location drift (#315).**');
  const premiseIdx = body.indexOf('**Premise check (#1829).**');
  assert.ok(namedLocationIdx !== -1 && premiseIdx !== -1 && premiseIdx > namedLocationIdx);
});

test('#1829: build/SKILL.md Spec Step 2 names premise.satisfiedAtBase and routes to the Console staged close', () => {
  const body = read(path.join('build', 'SKILL.md'));
  assert.match(body, /premise\.satisfiedAtBase/);
  assert.match(body, /staged-close|staged close/i);
});
