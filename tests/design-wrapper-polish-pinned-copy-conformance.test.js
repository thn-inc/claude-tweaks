'use strict';
// tests/design-wrapper-polish-pinned-copy-conformance.test.js — pins the
// #2743 addition: `design-wrapper polish` honoring a record's spec-pinned
// copy. Three load-bearing mechanisms, spread across the three files the
// record's own Technical Approach names as Key Files:
//   1. A pinned-copy constraint suffix appended to every Impeccable dispatch
//      this phase makes, when the record's derived pinned-copy list is
//      non-empty (modes/polish.md Step 2.5; derivation in
//      flow/polish-execution.md).
//   2. A `Polish-skip:` body-metadata line letting a record opt a named
//      command out of this phase entirely (staged as `kind:
//      "skipped-by-record"` rather than silently dropped).
//   3. A `Polish-scope: record-created` body-metadata line restricting the
//      refinement set's default file scope to files the record's own branch
//      created.
// Reads the live skill files (this test pins prose we just wrote, not a
// third-party fact — the skill-prose-conformance-tests live-vs-fixture
// distinction).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const POLISH_MD = path.join(__dirname, '..', 'plugin', 'skills', 'design-wrapper', 'modes', 'polish.md');
const POLISH_EXECUTION_MD = path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'polish-execution.md');
const COMMAND_MAP_MD = path.join(__dirname, '..', 'plugin', 'skills', 'design-wrapper', 'command-map.md');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

test('polish.md has a Step 2.5 resolving pinned-copy list, Polish-skip:, and Polish-scope:', () => {
  const text = read(POLISH_MD);
  assert.match(text, /### Step 2\.5: Resolve record-declared polish constraints \(#2743\)/);
  assert.match(text, /\*\*Pinned-copy list\*\*/);
  assert.match(text, /`Polish-skip:`/);
  assert.match(text, /`Polish-scope:`/);
  assert.match(text, /record-created/);
});

test('polish.md Step 2.5 is positioned between Step 2 and Step 3', () => {
  const text = read(POLISH_MD);
  const step2Idx = text.indexOf('### Step 2: Resolve changed files');
  const step25Idx = text.indexOf('### Step 2.5: Resolve record-declared polish constraints');
  const step3Idx = text.indexOf('### Step 3: Read prior audit findings cache');
  assert.ok(step2Idx > -1 && step25Idx > step2Idx && step3Idx > step25Idx, 'Step 2.5 must sit between Step 2 and Step 3');
});

test('polish.md documents the skip check and that a skip is staged, never silently dropped', () => {
  const text = read(POLISH_MD);
  const step = text.slice(text.indexOf('### Step 2.5'), text.indexOf('### Step 3'));
  assert.match(step, /\*\*Skip check \(every step\)\.\*\*/);
  assert.match(step, /kind: "skipped-by-record"/);
  assert.match(step, /This is never a silent drop/);
});

test('polish.md documents the pinned-copy suffix text and that it is appended last', () => {
  const text = read(POLISH_MD);
  const step = text.slice(text.indexOf('### Step 2.5'), text.indexOf('### Step 3'));
  assert.match(step, /Pinned copy — do not change these exact strings/);
  assert.match(step, /pinned-copy is always last/i);
  assert.match(step, /not a post-hoc diff check/);
});

test('polish.md Step 4 applies the Polish-scope: record-created filter and the skip+suffix checks', () => {
  const text = read(POLISH_MD);
  const step4 = text.slice(text.indexOf('### Step 4:'), text.indexOf('### Step 5:'));
  assert.match(step4, /`Polish-scope: record-created` filter/);
  assert.match(step4, /status `A`/);
  assert.match(step4, /No refinement set — all resolved files pre-dated this record \(Polish-scope: record-created\)/);
  assert.match(step4, /Skip check and pinned-copy suffix/);
});

test('polish.md Step 5 rule 4 applies the skip check before dispatching normally', () => {
  const text = read(POLISH_MD);
  const step5 = text.slice(text.indexOf('### Step 5:'), text.indexOf('### Step 6:'));
  assert.match(step5, /apply Step 2\.5's skip check first/);
});

test('polish.md Step 6 applies the skip check and pinned-copy suffix to intent-driven dispatch', () => {
  const text = read(POLISH_MD);
  const step6 = text.slice(text.indexOf('### Step 6:'), text.indexOf('### Step 6.5:'));
  assert.match(step6, /apply Step 2\.5's skip check/);
  assert.match(step6, /appending Step 2\.5's pinned-copy suffix/);
});

test('polish.md Output to caller documents the skipped-by-record staged kind', () => {
  const text = read(POLISH_MD);
  assert.match(text, /"kind": "skipped-by-record"/);
  assert.match(text, /\| `skipped-by-record` \| `command` \|/);
});

test('polish.md Step 7 decision_summary accounts for skipped-by-record commands', () => {
  const text = read(POLISH_MD);
  assert.match(text, /skipped-by-record: \{comma-separated command names\}/);
});

test('polish.md Anti-Patterns table warns against dispatching a Polish-skip: command', () => {
  const text = read(POLISH_MD);
  assert.match(text, /Dispatching a command the record named in `Polish-skip:`/);
});

test('polish-execution.md derives the pinned-copy list from Deliverables/Acceptance Criteria and exact: true e2e assertions', () => {
  const text = read(POLISH_EXECUTION_MD);
  assert.match(text, /\*\*Pinned-copy derivation \(#2743\)\.\*\*/);
  assert.match(text, /## Deliverables.*## Acceptance Criteria/s);
  assert.match(text, /exact: true/);
  assert.match(text, /cap at 30 entries/);
});

test('polish-execution.md staged_suggestions table branches on skipped-by-record', () => {
  const text = read(POLISH_EXECUTION_MD);
  assert.match(text, /\| `skipped-by-record` \|/);
  assert.match(text, /stages for three different reasons/);
});

test('command-map.md Steps 1-3 each cross-reference the pinned-copy / skip overrides without restating them', () => {
  const text = read(COMMAND_MAP_MD);
  const matches = text.match(/\*\*Pinned-copy \/ skip overrides/g) || [];
  assert.equal(matches.length, 3, 'expected exactly three cross-reference call-outs, one per dispatch category');
  assert.match(text, /modes\/polish\.md`'s Step 2\.5/);
});
