'use strict';
// tests/brainstorming-ceremony-citations.test.js — prose-conformance pin (#2347).
//
// Follows tests/ceremony-profile-roster.test.js's own pattern: grep the live
// skill-prose corpus for the citation strings that wire each
// /superpowers:brainstorming call site through skills/specify/brainstorming-ceremony.md's
// design-ceremony procedure, rather than asserting anything about runtime
// behavior. A routine future prose edit that drops one of these citations —
// or renames brainstorming-ceremony.md's compose-brainstorm-args.js reference —
// should fail this test even though the pure-function/CLI layer
// (tests/bin-lib/specify/brainstorming-ceremony.test.js,
// tests/compose-brainstorm-args-cli.test.js) stays green, since those never
// read the prose wiring that actually invokes the procedure.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');

const specifySkill = fs.readFileSync(path.join(SKILLS, 'specify', 'SKILL.md'), 'utf8');
const brainstormingCeremony = fs.readFileSync(path.join(SKILLS, 'specify', 'brainstorming-ceremony.md'), 'utf8');
const captureRouting = fs.readFileSync(path.join(SKILLS, 'capture', 'routing.md'), 'utf8');

test('specify/SKILL.md case 1 (needs:definition redirect) still cites brainstorming-ceremony.md', () => {
  const case1Line = specifySkill
    .split('\n')
    .find((l) => l.includes('needs:definition` redirect') && l.includes('brainstorming-ceremony.md'));
  assert.ok(case1Line, 'case 1 paragraph no longer cites brainstorming-ceremony.md');
});

test('specify/SKILL.md case 4 (bare topic) still cites brainstorming-ceremony.md', () => {
  const case4Line = specifySkill
    .split('\n')
    .find((l) => /^4\. \*\*Topic name with no matching design doc\*\*/.test(l) && l.includes('brainstorming-ceremony.md'));
  assert.ok(case4Line, 'case 4 paragraph no longer cites brainstorming-ceremony.md');
});

test('specify/brainstorming-ceremony.md still names compose-brainstorm-args.js', () => {
  assert.ok(
    brainstormingCeremony.includes('compose-brainstorm-args.js'),
    'brainstorming-ceremony.md no longer names compose-brainstorm-args.js — the sub-file\'s CLI reference was renamed without updating this test'
  );
});

test('capture/routing.md wires --route=brainstorm through brainstorming-ceremony.md (#2347 AC1)', () => {
  assert.ok(
    /brainstorming-ceremony\.md/.test(captureRouting),
    'capture/routing.md no longer cites brainstorming-ceremony.md — the brainstorm route regressed to always-standard behind a green suite'
  );
  assert.ok(
    captureRouting.includes('compose-brainstorm-args.js'),
    'capture/routing.md no longer names compose-brainstorm-args.js'
  );
  assert.ok(
    captureRouting.includes('resolve-policy.js'),
    'capture/routing.md no longer resolves design-ceremony via resolve-policy.js'
  );
});

test('policy-schema.md documents capture as a design-ceremony consumer (#2347)', () => {
  const schema = fs.readFileSync(path.join(SKILLS, '_shared', 'policy-schema.md'), 'utf8');
  const row = schema.split('\n').find((l) => l.includes('| `design-ceremony` |'));
  assert.ok(row, 'design-ceremony row missing from policy-schema.md');
  assert.ok(row.includes('claude-tweaks:capture'), 'design-ceremony row no longer names /claude-tweaks:capture as a consumer');
});
