// tests/manifesto-auto-fast-path.test.js — #657: pins that flow/manifesto.md's confirm/hybrid-
// only elicitation content (the AskUserQuestion call, Rendering rules for the preview, and the
// On-override/On-cancel approval-flow branches) was split into flow/manifesto-confirm.md, and
// that manifesto.md itself explicitly tells an auto-mode reader never to open that companion
// file — the mechanism that makes those sections genuinely unreached on the auto path rather
// than merely present-but-unused in the same file.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (...p) => readText(path.join(SKILLS, ...p));

const MANIFESTO = read('flow', 'manifesto.md');
const MANIFESTO_CONFIRM = read('flow', 'manifesto-confirm.md');
const FLOW_SKILL = read('flow', 'SKILL.md');

test('manifesto.md tells an auto-mode reader never to open manifesto-confirm.md', () => {
  assert.match(MANIFESTO, /never open `manifesto-confirm\.md` for an `auto` run/);
});

test('manifesto.md routes confirm/hybrid readers to manifesto-confirm.md for the AskUserQuestion call', () => {
  assert.match(MANIFESTO, /read `manifesto-confirm\.md` in this skill's directory for the `AskUserQuestion` call/);
});

test('the AskUserQuestion invocation itself moved out of manifesto.md', () => {
  assert.doesNotMatch(MANIFESTO, /call `AskUserQuestion` with/);
});

test('manifesto-confirm.md carries the AskUserQuestion call, Rendering rules, and On-override/On-cancel branches', () => {
  assert.match(MANIFESTO_CONFIRM, /call `AskUserQuestion` with/);
  assert.match(MANIFESTO_CONFIRM, /^## Rendering rules for the preview$/m);
  assert.match(MANIFESTO_CONFIRM, /^## On override \/ On cancel$/m);
});

test('manifesto.md still carries the on-approval config.yml write and the Policy levers FYI table (both modes need them)', () => {
  // Regression guard for the two pinned facts flow-run-dir-anchoring.test.js and
  // merge-verification-gate-conformance.test.js already check independently — restated here as
  // the specific "these must NOT have been swept into the split" claim this record's own AC4
  // makes (confirm/hybrid must render byte-identical policy-lever content to before).
  assert.match(MANIFESTO, /write the chosen values to `\$RUN_ROOT\/\.claude-tweaks\/pipelines\/\{ISO-timestamp\}-\{spec-slug\}\/config\.yml`/);
  assert.match(MANIFESTO, /\| # \| Lever \| Recommended \| Options \| Effect if approved \|/);
});

test('flow/SKILL.md documents the auto vs confirm/hybrid manifesto-confirm.md read split', () => {
  assert.match(FLOW_SKILL, /never open that companion file for an `auto` run/);
});
