// tests/scope-resolution-conformance.test.js — pins the _shared/scope-resolution.md
// extraction: the deterministic no-argument scope ladder lives once in the contract,
// every consumer cites it, and no consumer still carries the retired "base branch or
// recent commits" phrasing or a restated copy of the ladder. Absence assertions run on
// whitespace-collapsed text so a hard-wrapped literal cannot make them pass vacuously
// (the [IL-66] failure mode).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (...p) => readText(path.join(SKILLS, ...p));
const collapse = (s) => s.replace(/\s+/g, ' ');

const CONTRACT = read('_shared', 'scope-resolution.md');

// Every no-argument-scope consumer. deepen and simplify retired a restated copy of the
// ladder; review, reflect, and journeys retired the vague phrase and keep their own
// outcome wording (mode selection, content diffs, journey mapping).
const CONSUMERS = [
  ['deepen', 'SKILL.md'],
  ['simplify', 'SKILL.md'],
  ['review', 'SKILL.md'],
  ['reflect', 'SKILL.md'],
  ['journeys', 'SKILL.md'],
];

test('contract carries the ladder anchors', () => {
  assert.match(CONTRACT, /first rung that yields files wins/i, 'ladder framing');
  assert.ok(CONTRACT.includes('git diff --name-only HEAD'), 'rung 1: uncommitted work');
  assert.ok(CONTRACT.includes('git merge-base HEAD {integration-branch}'), 'rung 2: fork point');
  assert.ok(CONTRACT.includes('git diff --name-only HEAD~5'), 'rung 3: integration-branch fallback');
  assert.ok(CONTRACT.includes('_shared/integration-branch.md'), 'integration branch resolved by the canonical ladder, never hardcoded');
  assert.match(CONTRACT, /State which rung resolved the scope/i, 'runs must name their rung');
});

for (const [dir, file] of CONSUMERS) {
  test(`${dir}/${file} cites the contract and carries no retired phrasing`, () => {
    const text = read(dir, file);
    assert.ok(text.includes('_shared/scope-resolution.md'), `${dir}/${file} must cite the contract`);
    const flat = collapse(text);
    assert.ok(
      !flat.includes('base branch or recent commits'),
      `${dir}/${file} still carries the retired vague phrasing (whitespace-collapsed check)`
    );
    // A restated ladder is drift waiting to happen — rung 2's two-command form is the
    // contract's signature; consumers cite, never restate.
    assert.ok(
      !flat.includes('git merge-base HEAD {integration-branch}'),
      `${dir}/${file} restates the ladder instead of citing the contract`
    );
  });
}

test('the retired phrasing is gone from every shipped skill, not just the named consumers', () => {
  const walk = (dir, acc = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, acc);
      else if (e.name.endsWith('.md')) acc.push(full);
    }
    return acc;
  };
  for (const file of walk(SKILLS)) {
    const flat = collapse(readText(file));
    if (path.relative(SKILLS, file) === path.join('_shared', 'scope-resolution.md')) continue; // the contract's own tombstone line names it
    assert.ok(
      !flat.includes('base branch or recent commits'),
      `${path.relative(SKILLS, file)} carries the retired vague phrasing`
    );
  }
});
