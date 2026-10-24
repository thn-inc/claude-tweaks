// tests/specify-mechanical-handoff.test.js
// Pins #832's canonical handoff-prompt template: when a caller delegates
// decomposition mode's mechanical Steps (3-9, in decomposition-mode-closeout.md)
// to a subagent instead of continuing in the same thread as the interactive
// Steps (1-2.5d, in decomposition-mode.md), it uses this template rather than
// hand-authoring a bridge prompt per invocation.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(REPO_ROOT, rel));

const HANDOFF = 'plugin/skills/specify/mechanical-handoff.md';
const DECOMPOSITION_MODE = 'plugin/skills/specify/decomposition-mode.md';
const DECOMPOSITION_CLOSEOUT = 'plugin/skills/specify/decomposition-mode-closeout.md';

test('mechanical-handoff.md exists in the specify skill directory', () => {
  assert.ok(fs.existsSync(path.join(REPO_ROOT, HANDOFF)), `${HANDOFF} not found`);
});

test('mechanical-handoff.md names every required input explicitly (AC2)', () => {
  const text = read(HANDOFF);
  assert.match(text, /[Ww]ork[\s-]unit list/, 'names the resolved work-unit list (Step 2 output)');
  assert.match(text, /[Cc]ollapse decision/, 'names Step 2.6\'s collapse verdict');
  assert.match(text, /[Dd]ependency graph/, 'names the dependency graph (explicit + implicit)');
  assert.match(text, /Step 2\.5/, 'names Step 2.5\'s design pre-step answers');
  assert.match(text, /design-intent/, 'names design-intent as a carried input');
  assert.match(text, /phase-N/, 'names phase-N scoping as a carried input');
  assert.match(text, /ORIGIN_RECORD_NUM/, 'names the needs:definition origin-redirect input');
});

test('mechanical-handoff.md follows the Subagent Contract', () => {
  const text = read(HANDOFF);
  assert.match(text, /subagent-output-contract\.md/);
  assert.match(text, /DONE_WITH_CONCERNS/);
  assert.match(text, /NEEDS_CONTEXT/);
  assert.match(text, /BLOCKED/);
});

test('mechanical-handoff.md instructs the subagent to read only decomposition-mode-closeout.md, not decomposition-mode.md', () => {
  const text = read(HANDOFF);
  assert.match(text, /decomposition-mode-closeout\.md/);
  assert.match(text, /Do not read `decomposition-mode\.md`/, 'explicitly tells the subagent not to read decomposition-mode.md');
});

test('mechanical-handoff.md is genuinely reusable — states it applies across overlap, ambiguity, and phase-scoped decompositions', () => {
  const text = read(HANDOFF);
  assert.match(text, /overlap/i);
  assert.match(text, /ambiguity/i);
  assert.match(text, /phase-scoped|phase-N/);
});

test('decomposition-mode.md and decomposition-mode-closeout.md both cite mechanical-handoff.md', () => {
  assert.match(read(DECOMPOSITION_MODE), /mechanical-handoff\.md/);
  assert.match(read(DECOMPOSITION_CLOSEOUT), /mechanical-handoff\.md/);
});

test('mechanical-handoff.md names the accepted scaffold path (Visual-reference:) as a required input (#832 review)', () => {
  const text = read(HANDOFF);
  assert.match(text, /Visual-reference/, 'names the accepted scaffold path Step 3 needs to write onto frontend sub-issues');
});

test('mechanical-handoff.md does not list --chained as a required input — the flag is shaping-mode-only and never reaches decomposition mode (#832 review)', () => {
  const text = read(HANDOFF);
  assert.doesNotMatch(text, /--chained/, 'decomposition mode never receives --chained (SKILL.md: shaping mode only)');
});
