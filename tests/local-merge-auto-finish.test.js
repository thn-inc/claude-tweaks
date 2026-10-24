'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readText } = require('./helpers/read-skill');

// #771: local-merge + auto mode had no auto-mode-aware finish path —
// `wrap-up/cleanup-procedures-execution.md` Section C called
// `/superpowers:finishing-a-development-branch` unconditionally, blocking on
// a human answer even under `auto`. `_shared/local-merge-auto-finish.md`
// mirrors `_shared/pr-first-merge.md`'s no-prompt role for local-merge.
// Prose-as-implementation — pin the key claims against the actual file text,
// same convention as tests/pr-first-merge.test.js and
// tests/integration-model.test.js.

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'plugin', 'skills', '_shared', 'local-merge-auto-finish.md');
const read = () => readText(FILE);

test('the file exists', () => {
  assert.ok(fs.existsSync(FILE), 'plugin/skills/_shared/local-merge-auto-finish.md must exist');
});

test('cites _shared/integration-model.md (required by the repo-wide integration-model consumer-conformance test)', () => {
  const text = read();
  assert.match(text, /_shared\/integration-model\.md/);
});

test('the precondition requires both local-merge AND config.yml presence — never one alone', () => {
  const text = read();
  const section = text.slice(text.indexOf('## Precondition'), text.indexOf('## Default policy'));
  assert.match(section, /integration-model.*resolves.*local-merge/is);
  assert.match(section, /config\.yml.*exists/is);
});

test('the default policy is merge-locally only — discard and keep-as-is are explicitly never defaults', () => {
  const text = read();
  const section = text.slice(text.indexOf('## Default policy'), text.indexOf('## Procedure'));
  assert.match(section, /\*\*Merge locally\*\*/);
  assert.match(section, /Discard is never a default/i);
  assert.match(section, /[Kk]eep-as-is.*never a default/is);
});

test('the procedure never resolves a merge conflict itself — aborts and parks instead', () => {
  const text = read();
  const section = text.slice(text.indexOf('## Procedure'), text.indexOf('## Interactive mode is unaffected'));
  assert.match(section, /never attempt(s)? (conflict )?resolution/i);
  assert.match(section, /pending-review/);
});

test('the procedure logs both outcomes via bin/log-decision.js, per the canonical entry schema', () => {
  const text = read();
  const section = text.slice(text.indexOf('## Procedure'), text.indexOf('## Interactive mode is unaffected'));
  assert.match(section, /log-decision\.js/);
  assert.match(section, /outcome: merged/);
  assert.match(section, /outcome: pending-review/);
});

test('interactive/standalone runs fall back to the unmodified finishing-a-development-branch handoff', () => {
  const text = read();
  const section = text.slice(text.indexOf('## Interactive mode is unaffected'));
  assert.match(section, /finishing-a-development-branch/);
  assert.match(section, /unmodified/i);
});

// --- Task 2: cleanup-procedures-execution.md Section C routing ---

const EXEC = readText(path.join(ROOT, 'plugin', 'skills', 'wrap-up', 'cleanup-procedures-execution.md'));

function localMergeSection() {
  const localMergeStart = EXEC.indexOf('**`integration-model: local-merge`:**');
  assert.ok(localMergeStart > 0, 'the local-merge branch heading must exist');
  const nextSectionStart = EXEC.indexOf('3.5.', localMergeStart);
  return EXEC.slice(localMergeStart, nextSectionStart > 0 ? nextSectionStart : undefined);
}

test('Section C local-merge branch checks the precondition before falling back to the interactive skill', () => {
  const section = localMergeSection();
  assert.match(section, /local-merge-auto-finish\.md/);
  assert.match(section, /config\.yml/);
});

test('Section C still preserves the original unmodified finishing-a-development-branch fallback', () => {
  const section = localMergeSection();
  assert.match(section, /unmodified/i);
  assert.match(section, /finishing-a-development-branch/);
});

test('Section C maps the new pending-review outcome onto the same posture as kept-as-is (no teardown)', () => {
  const section = localMergeSection();
  assert.match(section, /pending-review/);
});

// --- Task 3: review-console.md + auto-mode-contract.md accuracy fixes ---

const CONSOLE = readText(path.join(ROOT, 'plugin', 'skills', 'wrap-up', 'review-console.md'));
const CONTRACT = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'auto-mode-contract.md'));

test('review-console.md no longer claims local-merge cleanup runs "unchanged" — it cites the auto-finish path', () => {
  assert.doesNotMatch(CONSOLE, /Under `local-merge`, cleanup runs unchanged/);
  assert.match(CONSOLE, /local-merge-auto-finish\.md/);
});

test('auto-mode-contract.md\'s "What auto silences" table lists the local-merge finish decision', () => {
  const start = CONTRACT.indexOf('## What `auto` silences');
  const end = CONTRACT.indexOf('## What `auto` does NOT silence');
  const section = CONTRACT.slice(start, end);
  assert.match(section, /local-merge-auto-finish\.md/);
});

// --- Task 4: skill-graph.md edge ---

const SKILL_GRAPH = readText(path.join(ROOT, 'docs', 'skill-graph.md'));

test('skill-graph.md documents the new local-merge-auto-finish.md edge(s)', () => {
  assert.match(SKILL_GRAPH, /local-merge-auto-finish\.md/);
});
