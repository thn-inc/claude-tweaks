'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

// CLAUDE.md is inherited by every dispatched subagent (72-144 per /dispatch run),
// so bytes here are the most expensive bytes in the repo. #233/#234 landed the file
// at ~51.8 KB, driven mostly by `## Don'ts` — 141 bullets carrying immutable
// [IL-nn] tags, each pinned to a real incident and never renumbered once shipped.
// #278 moved that section's full body (everything past the intro paragraph) out
// to docs/donts.md behind a short pointer, following the same extracted-doc
// convention as docs/plugin-structure.md and docs/skill-authoring.md; the rule
// text and its [IL-nn] tags are unchanged, only their always-loaded cost is gone.
// BUDGET_BYTES is measured-landing (20,840 B) rounded up to the next KiB (21 KiB
// = 21,504 B) plus 3 KiB headroom for the sections that remain.
// Lowering this budget as the file shrinks is encouraged; raising it is an
// explicit decision with the incident-log discipline behind it (ADR-0010 regrew
// 77% with nothing watching).
const BUDGET_BYTES = 24576;

test('CLAUDE.md stays within its context-cost budget', () => {
  const size = Buffer.byteLength(readText(path.join(__dirname, '..', 'CLAUDE.md')), 'utf8');
  assert.ok(
    size <= BUDGET_BYTES,
    `CLAUDE.md is ${size} B, over its ${BUDGET_BYTES} B budget. Every dispatched agent inherits ` +
      'this file; evict or compress per docs/skill-authoring.md and ADR-0010 rather than raising the budget.',
  );
});
