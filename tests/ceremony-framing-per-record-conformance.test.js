// tests/ceremony-framing-per-record-conformance.test.js
// Pins the "one ceremony-check/framing-check invocation per record" wording
// across plugin/skills/specify/shaping-mode.md, plugin/skills/specify/record-creation.md,
// plugin/skills/challenge/SKILL.md, and plugin/skills/assess-agent-autonomy/ceremony-check.md
// so the four files cannot silently drift out of agreement with each other.
// See #708.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(REPO_ROOT, rel));

const CHALLENGE = read('plugin/skills/challenge/SKILL.md');
// #1346 split shaping-mode.md at the ### Metadata block boundary; the Framing bullet,
// Self-check, and Compose-then-write-once section all landed in shaping-mode-stamping.md.
const SHAPING = read('plugin/skills/specify/shaping-mode-stamping.md');
// #1346 split record-creation.md at the Step 3 Parent record/Sub-issues boundary; the
// per-sub-issue self-check, create call, and framing-check mirror sentence all landed in
// record-creation-subissues.md.
const RECORD_CREATION = read('plugin/skills/specify/record-creation-subissues.md');
const CEREMONY_CHECK = read('plugin/skills/assess-agent-autonomy/ceremony-check.md');

test('challenge/SKILL.md argument-hint documents framing-check\'s optional #{n}', () => {
  assert.ok(
    CHALLENGE.includes('argument-hint: "framing-check [#<n>] | #<n> | --lens=<n[,n...]> <#n|topic|problem statement>"'),
    'argument-hint frontmatter must document the optional #{n} suffix on framing-check'
  );
});

test('challenge/SKILL.md framing-check mode states the per-record #{n} invocation rule', () => {
  assert.ok(
    CHALLENGE.includes('one `framing-check #{n}` invocation per record'),
    'Mode: framing-check must state the per-record #{n} invocation rule'
  );
  assert.ok(
    CHALLENGE.includes('the identical pre-numbering exception `ceremony-check` already documents'),
    'Mode: framing-check must cite ceremony-check\'s existing pre-numbering exception for record-creation.md\'s bare call'
  );
});

test('shaping-mode.md invokes framing-check with #{n} attribution', () => {
  assert.ok(
    SHAPING.includes('args: "framing-check #{n}"'),
    'shaping-mode.md\'s Framing bullet must pass #{n} to framing-check'
  );
});

test('shaping-mode.md states the per-record self-check before compose-then-write-once', () => {
  const selfCheckIdx = SHAPING.indexOf('**Self-check before writing:**');
  const composeIdx = SHAPING.indexOf('### Compose-then-write-once');
  assert.ok(selfCheckIdx >= 0, 'shaping-mode.md must contain a "Self-check before writing:" paragraph');
  assert.ok(composeIdx >= 0, 'shaping-mode.md must still contain "### Compose-then-write-once"');
  assert.ok(selfCheckIdx < composeIdx, 'the self-check must appear before Compose-then-write-once');
});

test('record-creation.md states the per-sub-issue self-check before the create call', () => {
  const selfCheckIdx = RECORD_CREATION.indexOf('**Self-check before creating:**');
  const createCallIdx = RECORD_CREATION.indexOf('SUB_ISSUE_URL=$(gh issue create');
  assert.ok(selfCheckIdx >= 0, 'record-creation.md must contain a "Self-check before creating:" paragraph');
  assert.ok(createCallIdx >= 0, 'record-creation.md must still contain the sub-issue create call');
  assert.ok(selfCheckIdx < createCallIdx, 'the self-check must appear before the create call');
  assert.ok(
    RECORD_CREATION.includes('`framing-check` mirrors it here for the identical reason'),
    'record-creation.md must explicitly extend ceremony-check\'s bare-call reasoning to framing-check'
  );
});

test('ceremony-check.md documents the per-record #{n} invocation rule citing SKILL.md', () => {
  assert.ok(
    CEREMONY_CHECK.includes('one `ceremony-check #{n}` invocation per record'),
    'ceremony-check.md must state the per-record #{n} invocation rule'
  );
});

test('record-creation.md and ceremony-check.md each cite assess-agent-autonomy/SKILL.md\'s Input section for the bare-call exception', () => {
  assert.ok(
    RECORD_CREATION.includes('`assess-agent-autonomy/SKILL.md`\'s Input section'),
    'record-creation.md must cite assess-agent-autonomy/SKILL.md\'s Input section for the pre-numbering exception'
  );
  assert.ok(
    CEREMONY_CHECK.includes('`SKILL.md`\'s Input section'),
    'ceremony-check.md must cite SKILL.md\'s Input section (same-directory relative reference) for the pre-numbering exception'
  );
});
