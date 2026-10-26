'use strict';

// Conformance pin (#889, extracted #927): SKILL.md's Error Handling section must distinguish
// could-not-gather (transport/tooling failure) from gathered-but-inconclusive
// (a genuine content-ambiguity read) -- the two render different RATIONALE
// shapes. If SKILL.md's prose ever collapses this back into one case, this
// pin fails loudly instead of letting the distinction silently erode.
//
// #927 extracted the three-part gather-resilience shape (primary gather command -> MCP
// fallback via the issue_read mapping -> two could-not-gather short-circuits) that
// grant-check.md and failure-check.md each used to restate independently into a shared
// fragment, _gather-resilience.md. These pins now check both halves of that citation: that
// each mode file actually cites the fragment (rather than silently dropping the reference),
// and that the fragment itself still carries the shared shape's anchor phrases -- so reverting
// the fragment alone (deleting it, or blanking its could-not-gather section) fails these tests
// even though the citing mode files are untouched.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILL_DIR = path.join(__dirname, '..', 'plugin/skills/assess-agent-autonomy');
const FRAGMENT_FILE = '_gather-resilience.md';

// The two modes whose Step 1 gather fetches from GitHub, and so must carry the
// MCP fallback and both no-content short-circuits.
const FETCHING_MODES = ['grant-check', 'failure-check'];

function readSkillFile(name) {
  return readText(path.join(SKILL_DIR, name));
}

test('SKILL.md Error Handling names both could-not-gather and gathered-but-inconclusive cases', () => {
  const source = readSkillFile('SKILL.md');
  assert.ok(source.includes('could-not-gather'), 'expected the literal case name "could-not-gather" in SKILL.md');
  assert.ok(
    source.includes('gathered-but-inconclusive'),
    'expected the literal case name "gathered-but-inconclusive" in SKILL.md'
  );
});

test('SKILL.md Anti-Patterns table pins the content-judgment-rationale rule', () => {
  const source = readSkillFile('SKILL.md');
  assert.ok(
    source.includes('content-judgment'),
    'expected an Anti-Patterns row naming the content-judgment rationale hazard in SKILL.md'
  );
});

test('_gather-resilience.md carries the shared three-part shape (MCP mapping + both could-not-gather short-circuits)', () => {
  const source = readSkillFile(FRAGMENT_FILE);
  assert.ok(source.includes('issue_read'), `expected ${FRAGMENT_FILE} to cite the issue_read MCP mapping`);
  assert.ok(
    source.includes('could-not-gather'),
    `expected ${FRAGMENT_FILE} to define the could-not-gather case by name`
  );
  assert.ok(
    source.includes('Neither available'),
    `expected ${FRAGMENT_FILE} to state the "neither transport available" short-circuit`
  );
  assert.ok(
    source.includes('Or the fetch itself fails'),
    `expected ${FRAGMENT_FILE} to state the fetch-error short-circuit`
  );
});

for (const mode of FETCHING_MODES) {
  test(`${mode}.md Step 1 cites the shared gather-resilience fragment instead of restating it`, () => {
    const source = readSkillFile(`${mode}.md`);
    assert.ok(
      source.includes(FRAGMENT_FILE),
      `expected ${mode}.md to cite ${FRAGMENT_FILE} rather than restating the could-not-gather shape inline`
    );
    assert.ok(source.includes('issue_read'), `expected ${mode}.md to still name the issue_read MCP mapping`);
  });
}

test('grant-check.md Step 1 states its own could-not-gather output lines', () => {
  const source = readSkillFile('grant-check.md');
  assert.ok(source.includes('RECOMMEND_BUILD: false'), 'expected grant-check.md to state its could-not-gather RECOMMEND_BUILD line');
  assert.ok(source.includes('RECOMMEND_MERGE: false'), 'expected grant-check.md to state its could-not-gather RECOMMEND_MERGE line');
});

test('failure-check.md Step 1 states its own could-not-gather output lines', () => {
  const source = readSkillFile('failure-check.md');
  assert.ok(source.includes('CLASSIFICATION: correctness'), 'expected failure-check.md to state its could-not-gather CLASSIFICATION line');
  assert.ok(source.includes('NOTIFY_NOW: false'), 'expected failure-check.md to state its could-not-gather NOTIFY_NOW line');
});

test('merge-check.md Step 1 cites the fragment\'s could-not-gather framing for its own resolution failures', () => {
  const source = readSkillFile('merge-check.md');
  assert.ok(
    source.includes(FRAGMENT_FILE),
    `expected merge-check.md to cite ${FRAGMENT_FILE}'s could-not-gather section for its own resolution-failure handling`
  );
  assert.ok(source.includes('could-not-gather'), 'expected merge-check.md to still name the could-not-gather case');
});
