'use strict';

// Conformance pins (#695): /specify and /demo accept a comma-separated
// `#N,#M[,...]` batch argument that iterates the single-item procedure
// sequentially. These pin the load-bearing rule text so a later edit that
// drops the sequential / refs-only / never-a-sweep rules — or the batch form
// itself — fails loudly instead of silently returning both skills to
// single-ref (which would also silently lengthen /tidy's Yours paste blocks).
//
// Extended by #762: the comma-list grammar (notation, tokenization, element
// classification) moved out of each consumer's own restatement into
// `plugin/skills/_shared/record-batch-input.md`, cited by all four consumers
// (flow, dispatch, specify, demo) instead of restated. These additions pin
// the citation in each of the four, the unified `#N[,#M...]` notation
// (fixing flow's `<#n>[,#m,#o]` drift), and the absence of the retired
// restated-grammar text.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { extractArgumentHint } = require('../plugin/bin/lib/skill-audit/argument-hint');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Whitespace-flattened for substring pins below: a later re-wrap of the skill
// prose must not fail a pin whose meaning is intact, only its line breaks moved.
// Never used for argument-hint extraction (extractArgumentHint needs real
// newlines to find the frontmatter fence and the line-anchored hint field).
const readFlat = (rel) => read(rel).replace(/\s+/g, ' ');

test('specify argument-hint accepts a comma-separated record-ref list (refs #1491: bare drain replaced the headless next prefix)', () => {
  const hint = extractArgumentHint(read('plugin/skills/specify/SKILL.md'));
  assert.ok(hint.startsWith('[#N[,#M...]|#A-#B|record-id[,id...]|'), `specify hint must open with the batch grammar, got: ${hint}`);
});

test('specify Input cites the shared batch grammar and keeps its own stop-all/refs-only rules', () => {
  const src = readFlat('plugin/skills/specify/SKILL.md');
  assert.ok(src.includes('a loop never a fan-out (no Task dispatch, one record at a time)'), 'sequential-per-element (loop, not fan-out) rule missing from specify Input');
  assert.ok(src.includes('decomposition and topic resolution stay single-input'), 'refs-only rule missing from specify Input');
  assert.ok(src.includes('stops the whole invocation before any record is shaped'), 'stop-all unresolvable-element rule missing from specify Input');
  assert.ok(src.includes('_shared/record-batch-input.md'), 'specify Input must cite the shared batch-grammar contract');
  // Retired: the mixed-list/empty-element classification definitions now live
  // solely in the shared contract — specify must not restate them.
  assert.ok(!src.includes('a mixed list is a hard input error, rejected with a one-line message naming the offending element'), 'specify must not restate the shared mixed-list classification definition');
  assert.ok(!src.includes('is named as exactly that, "empty element after'), 'specify must not restate the shared empty-element naming definition');
});

test('specify Next Actions has a multiple-records-shaped row recommending a comma-joined flow', () => {
  // Next Actions moved to its own lazy-loaded sub-file (context-cost trim, #1806)
  // — the SKILL.md pointer cites it rather than restating the table, so this
  // pin reads both files concatenated, same as the SKILL.md-only read before.
  const src = readFlat('plugin/skills/specify/SKILL.md') + readFlat('plugin/skills/specify/next-actions.md');
  assert.ok(src.includes('| Shaping mode — multiple records shaped in place'), 'multiple-records Next Actions row missing');
  assert.ok(src.includes('`/claude-tweaks:flow #{N1},#{N2},...` — sequential pipeline for every record shaped this run **(Recommended)**'), 'multiple-records row must recommend the comma-joined flow command');
});

test('shaping-mode Actions Performed documents the per-element outcome vocabulary and rules out skipped rows', () => {
  // Actions Performed moved to shaping-mode-readback.md (#2841's split).
  const src = readFlat('plugin/skills/specify/shaping-mode-readback.md');
  for (const token of ['`shaped`', '`already shaped, no-op`']) {
    assert.ok(src.includes(token), `outcome token ${token} missing from shaping-mode-stamping.md Actions Performed`);
  }
  // No `skipped` outcome: the batch branch's stop-all failure semantics mean an
  // unresolvable element never reaches shaping mode at all (SKILL.md's Input,
  // Comma-list batch form) — every Actions Performed row is a shaped element.
  assert.ok(src.includes('no `skipped` outcome'), 'stop-all rationale for the missing skipped outcome not documented');
});

test('demo argument-hint accepts a comma-separated record-ref list', () => {
  const hint = extractArgumentHint(read('plugin/skills/demo/SKILL.md'));
  assert.strictEqual(hint, '[#N[,#M...]]');
});

test('demo Input cites the shared batch grammar and keeps its own per-item skip-and-continue semantics', () => {
  const src = readFlat('plugin/skills/demo/SKILL.md');
  assert.ok(src.includes('Step 1 → Step 2 → Step 3 to completion before the next ref begins'), 'per-item completion rule missing from demo Input');
  assert.ok(src.includes("A batch is the human's own list — never a sweep"), 'never-a-sweep restatement missing from demo Input');
  assert.ok(src.includes('Per-item failure isolation: a ref that resolves to nothing'), 'per-item failure isolation missing from demo Input');
  assert.ok(src.includes('_shared/record-batch-input.md'), 'demo Input must cite the shared batch-grammar contract');
});

// --- #762: flow's notation drift fix + shared-grammar citation ---

test('flow argument-hint and Syntax use the unified #N[,#M...] notation, not the drifted <#n>[,#m,#o]', () => {
  const hint = extractArgumentHint(read('plugin/skills/flow/SKILL.md'));
  assert.ok(hint.startsWith('#N[,#M...] '), `flow hint must open with the unified batch notation, got: ${hint}`);
  const src = readFlat('plugin/skills/flow/SKILL.md');
  assert.ok(!src.includes('<#n>[,#m,#o]'), 'flow SKILL.md must not retain the drifted <#n>[,#m,#o] notation');
  assert.ok(!src.includes('#<n>[,#<m>...]'), 'flow SKILL.md must not retain the drifted #<n>[,#<m>...] Arguments-table notation');
  assert.ok(src.includes('/claude-tweaks:flow #N[,#M...] ['), 'flow Syntax code block must use the unified notation');
});

test('flow Input (SKILL.md + materialize.md) cites the shared batch grammar', () => {
  const skillSrc = readFlat('plugin/skills/flow/SKILL.md');
  assert.ok(skillSrc.includes('_shared/record-batch-input.md'), 'flow SKILL.md Arguments table must cite the shared batch-grammar contract');
  const materializeSrc = readFlat('plugin/skills/flow/materialize.md');
  assert.ok(materializeSrc.includes('_shared/record-batch-input.md'), 'flow materialize.md Resolution must cite the shared batch-grammar contract');
});

// --- #762: dispatch gains defined (not silently-dropped) mixed-list/empty-element behavior ---

test('dispatch Input cites the shared batch grammar for its explicit-list form', () => {
  const src = readFlat('plugin/skills/dispatch/SKILL.md');
  assert.ok(src.includes('_shared/record-batch-input.md'), 'dispatch Input must cite the shared batch-grammar contract');
  assert.ok(src.includes('{ numbers, invalid }'), 'dispatch Input must describe parseExplicitIssueList\'s classification-aware return shape');
  assert.ok(src.includes('never aborting over one bad element'), 'dispatch Input must state its own report-and-continue execution semantics for a classification failure');
});

test('dispatch argument-hint already uses the unified #N[,#M...] notation', () => {
  const hint = extractArgumentHint(read('plugin/skills/dispatch/SKILL.md'));
  assert.ok(hint.startsWith('[#N[,#M...]]'), `dispatch hint must open with the unified batch notation, got: ${hint}`);
});

test('parseExplicitIssueList (bin/lib/issues/grouping.js) classifies mixed lists and empty elements instead of silently dropping them', () => {
  const { parseExplicitIssueList } = require('../plugin/bin/lib/issues/grouping');
  const mixed = parseExplicitIssueList('#123,notanumber,#130');
  assert.deepStrictEqual(mixed.numbers, [123, 130]);
  assert.deepStrictEqual(mixed.invalid, [{ token: 'notanumber', reason: "'notanumber' is not a record reference" }]);
  const empty = parseExplicitIssueList('#41,');
  assert.deepStrictEqual(empty.invalid, [{ token: '', reason: 'empty element after #41' }]);
});

// --- #762: reference-card.md must mirror the unified notation ---

test('reference-card.md flow row uses the unified #N[,#M...] notation, not the drifted <#n>[,#m,#o]', () => {
  const src = read('plugin/skills/help/reference-card.md');
  assert.ok(!src.includes('<#n>[,#m,#o]'), 'reference-card.md must not retain the drifted flow notation');
  assert.ok(src.includes('#N[,#M...] [worktree'), 'reference-card.md flow row must mirror the unified notation');
});
