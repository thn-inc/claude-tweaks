'use strict';

// Prose-pin for /specify's comma-list batch shaping path (refs #702).
//
// The batch form is documented in prose only (skill markdown), so a later
// slimming pass could silently drop it without any test noticing. These
// pins hold the two facts a reader must be able to find: SKILL.md's ## Input
// documents the comma-list grammar, and shaping-mode.md states the per-record
// loop. tests/argument-hint-input.test.js and
// tests/argument-hint-mirrors.test.js pin hint<->Input and hint<->card
// sync; this file pins the batch semantics themselves.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { extractArgumentHint } = require('../plugin/bin/lib/skill-audit/argument-hint');

const ROOT = path.join(__dirname, '..');
const SKILL = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'specify', 'SKILL.md'), 'utf8');
const SHAPING = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'specify', 'shaping-mode.md'), 'utf8');

function inputSection(content) {
  const headings = [...content.matchAll(/^## .*$/gm)];
  const idx = headings.findIndex((m) => m[0] === '## Input');
  assert.ok(idx !== -1, 'skills/specify/SKILL.md has no ## Input section');
  const start = headings[idx];
  const next = headings[idx + 1];
  return content.slice(start.index + start[0].length, next ? next.index : content.length);
}

test('specify argument-hint opens with the comma-list record-reference group (refs #1491: bare drain replaced the headless next prefix)', () => {
  const hint = extractArgumentHint(SKILL);
  assert.ok(hint, 'skills/specify/SKILL.md declares no argument-hint');
  assert.ok(
    hint.startsWith('[#N[,#M...]|#A-#B|record-id[,id...]|design-doc-path|topic|backlog-title]'),
    `argument-hint does not open with the comma-list group: ${hint}`,
  );
});

test('specify ## Input documents the comma-list batch form', () => {
  const body = inputSection(SKILL);
  assert.ok(body.includes('#N[,#M...]'), '## Input does not show the literal #N[,#M...] leaf');
  assert.ok(body.includes('comma-joined'), '## Input does not say "comma-joined"');
  assert.ok(/shaping-mode-only/i.test(body), '## Input does not state the comma list is shaping-mode-only');
  assert.ok(/`--chained` on a comma list is rejected — the flag is ignored with a one-line notice/.test(body),
    '## Input does not state that --chained on a comma list is rejected (flag ignored with a notice)');
});

test('specify Next Actions has a multiple-records-shaped row recommending a comma-list /flow', () => {
  // Next Actions moved to its own lazy-loaded sub-file (context-cost trim, #1806)
  // — SKILL.md's pointer cites it rather than restating the table.
  const NEXT_ACTIONS = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'specify', 'next-actions.md'), 'utf8');
  assert.ok(
    /\| Shaping mode — multiple records shaped in place[^|]*\|[^\n]*\/claude-tweaks:flow #\{N1\},#\{N2\}/.test(NEXT_ACTIONS),
    'Next Actions Situation table has no "multiple records shaped in place" row recommending /claude-tweaks:flow #{N1},#{N2},...',
  );
});

test('shaping-mode.md states the per-record loop', () => {
  assert.ok(/one row per record/.test(SHAPING), 'shaping-mode.md does not say "one row per record"');
  assert.ok(/comma-joined/.test(SHAPING), 'shaping-mode.md does not name the comma-joined batch form');
});

test('shaping-mode.md documents github-issues parallel-safety and the local-files contrast (refs #782)', () => {
  assert.ok(/\*\*Parallel-safety\.\*\*/.test(SHAPING), 'shaping-mode.md has no Parallel-safety callout');
  assert.ok(
    /shaping a record writes no local files — it edits the GitHub issue directly via `gh`, so no worktree is required and multiple records may be shaped concurrently/.test(SHAPING),
    'shaping-mode.md does not state the github-issues no-worktree/concurrency-safe property',
  );
  assert.ok(
    /`work-backend: local-files` does write a tracked file \(`writeRecord`\) and is not safe to parallelize without isolation/.test(SHAPING),
    'shaping-mode.md does not state the local-files contrast (tracked file, needs isolation)',
  );
});
