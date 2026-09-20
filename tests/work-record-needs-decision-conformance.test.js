'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readFlat = (rel) => read(rel).replace(/\s+/g, ' ');

const WORK_RECORD_FLAT = readFlat('plugin/skills/_shared/work-record.md');

test('work-record.md declares needs:decision in the Label taxonomy table, Definition family', () => {
  assert.ok(WORK_RECORD_FLAT.includes('`needs:decision`'), 'needs:decision label missing from work-record.md');
  assert.ok(WORK_RECORD_FLAT.includes('a headless unit proposed an action it may not take alone'), 'needs:decision meaning missing');
  assert.ok(WORK_RECORD_FLAT.includes('newest unresolved decision comment'), 'newest-unresolved-comment pointer missing from needs:decision meaning');
});

test('work-record.md carries the canonical decision-comment template', () => {
  assert.ok(WORK_RECORD_FLAT.includes('<!-- needs-decision: {unit} -->'), 'decision-comment marker template missing');
  assert.ok(WORK_RECORD_FLAT.includes('## Decision needed'), 'Decision needed heading missing');
  assert.ok(WORK_RECORD_FLAT.includes('**Proposed:**'), 'Proposed field missing from template');
  assert.ok(WORK_RECORD_FLAT.includes('**Why:**'), 'Why field missing from template');
  assert.ok(WORK_RECORD_FLAT.includes('**Command:**'), 'Command field missing from template');
});

test('work-record.md states the resolution rule: prepend Resolved, remove label only when zero unresolved comments remain', () => {
  assert.ok(WORK_RECORD_FLAT.includes('**Resolved:** {choice} — {date}'), 'resolution line format missing');
  assert.ok(WORK_RECORD_FLAT.includes('zero unresolved `needs-decision:*` comments remain'), 'zero-unresolved-comments removal condition missing');
  assert.ok(WORK_RECORD_FLAT.includes('A comment with no `**Resolved:**` line is unresolved'), 'unresolved-comment definition missing');
  assert.ok(WORK_RECORD_FLAT.includes('the literal skill/mode name that wrote it'), '{unit} definition missing');
});

test('work-record.md states the worklist rule once: a headless unit skips any open record carrying a needs:* label', () => {
  assert.ok(WORK_RECORD_FLAT.includes('a headless unit skips any open record carrying a `needs:*` label'), 'worklist rule statement missing from work-record.md');
});

// Go-red control: the pre-#1488 taxonomy table had no needs:decision row and no worklist-rule
// statement anywhere in the file. Freeze a short excerpt of the pre-change Definition family row
// to prove the assertions above can actually fail.
const PRE_CHANGE_DEFINITION_ROW = '| Definition (1) | `needs:definition` | Marks a record naming a genuine open choice with no tradeoff made yet, rather than a single clear ask; stamped by `/capture` and `/feedback` at filing time (a content judgment, not a structural heuristic), absent means the ask read clear |';

test('go-red control: pre-change Definition-family row does not carry needs:decision or the worklist rule', () => {
  assert.ok(!PRE_CHANGE_DEFINITION_ROW.includes('needs:decision'), 'control must not already contain needs:decision (proves the row-presence assertion above can fail)');
  assert.ok(!PRE_CHANGE_DEFINITION_ROW.includes('a headless unit skips any open record'), 'control must not already contain the worklist rule (proves that assertion above can fail)');
});

const { ensureLabelPayload } = require('../plugin/bin/lib/issues/labels.js');
const LABEL_BOOTSTRAP_FLAT = readFlat('plugin/skills/_shared/label-bootstrap.md');

test('label-bootstrap.md carries needs:decision in the canonical LABELS_JSON list', () => {
  assert.ok(LABEL_BOOTSTRAP_FLAT.includes('["needs:decision",'), 'needs:decision missing from LABELS_JSON');
  assert.ok(LABEL_BOOTSTRAP_FLAT.includes('a headless unit proposed an action it may not take alone — see the newest decision comment'), 'needs:decision description text missing or altered');
});

test('label-bootstrap.md bumps LABEL_BOOTSTRAP_VERSION from 6 to 7 (#605 adds bot:parked)', () => {
  assert.ok(LABEL_BOOTSTRAP_FLAT.includes('current value: `7`'), 'LABEL_BOOTSTRAP_VERSION must read current value: 7');
  assert.ok(!LABEL_BOOTSTRAP_FLAT.includes('current value: `6`'), 'stale current value: 6 must be gone');
});

test('needs:decision description fits GitHub\'s 100-char label description cap', () => {
  assert.doesNotThrow(() => ensureLabelPayload('needs:decision', 'a headless unit proposed an action it may not take alone — see the newest decision comment'));
});

const AUTONOMY_CEILING_FLAT = readFlat('plugin/skills/_shared/autonomy-ceiling.md');

test('autonomy-ceiling.md documents needsDecisionMarker as a trusted+ Bookkeeping capability', () => {
  assert.ok(AUTONOMY_CEILING_FLAT.includes('`needsDecisionMarker`'), 'needsDecisionMarker row missing from Bookkeeping capabilities table');
  assert.ok(AUTONOMY_CEILING_FLAT.includes('| `needsDecisionMarker` | `trusted`+ |'), 'needsDecisionMarker must be unlocked at trusted+, matching the table\'s own column format');
  assert.ok(AUTONOMY_CEILING_FLAT.includes('a headless unit may write a `needs:*` label plus its explanatory comment as its residue channel, with no per-write approval'), 'needsDecisionMarker description missing its core behavior statement');
  assert.ok(AUTONOMY_CEILING_FLAT.includes('never a per-record override'), 'needsDecisionMarker row must disclaim a per-record ceiling override');
});

test('bookkeepingPermissions() return shape is unchanged by the needsDecisionMarker doc row (no code key added)', () => {
  const { bookkeepingPermissions } = require('../plugin/bin/lib/issues/autonomy.js');
  assert.ok(!('needsDecisionMarker' in bookkeepingPermissions('unattended')), 'needsDecisionMarker must NOT be a bookkeepingPermissions() key — it is documentation-only, per this task\'s own design note');
});
