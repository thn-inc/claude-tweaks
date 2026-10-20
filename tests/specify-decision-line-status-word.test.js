// tests/specify-decision-line-status-word.test.js
//
// Pins record #3557's prose wiring: shaping-mode.md and record-creation-subissues.md
// must both carry the "Mandated decision-line status word (#3557)" check, placed
// after composition and before the record is written, citing
// _shared/auto-decision-log.md's Status semantics, and rewriting (never prompting)
// a non-conformant STAGED/AUTO/SKIP line. docs/skill-graph.md's ## specify section
// must carry the matching edge. Sized like tests/specify-premise-verification-prose.test.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const SHAPING_MODE = read('plugin/skills/specify/shaping-mode.md');
const SUBISSUES = read('plugin/skills/specify/record-creation-subissues.md');
const SKILL_GRAPH = read('docs/skill-graph.md');

const LABEL = 'Mandated decision-line status word (#3557)';

function checkSlice(text, fileLabel) {
  const idx = text.indexOf(LABEL);
  assert.notStrictEqual(idx, -1, `${fileLabel} must carry the bold label "${LABEL}"`);
  const end = text.indexOf('\n\n', idx);
  return text.slice(idx, end === -1 ? text.length : end);
}

function assertCheck(text, fileLabel) {
  const slice = checkSlice(text, fileLabel);
  assert.match(slice, /_shared\/auto-decision-log\.md`'s Status semantics/);
  assert.match(slice, /`STAGED` line must name the `staged\/` artifact/);
  assert.match(slice, /`AUTO`/);
  assert.match(slice, /`SKIP` for a degrade trace/);
  assert.match(slice, /`SCANNED`\/`KEPT-PROMPT`\/`FAILED` per their rows/);
  assert.match(slice, /missing `staged\/` path/);
  assert.match(slice, /rewrite/i);
  assert.match(slice, /never stop mid-flow to ask/);
  assert.match(slice, /only on a mismatch|On a mismatch/);
  assert.doesNotMatch(slice, /AskUserQuestion/);
}

test('AC1.1: shaping-mode.md carries the mandated decision-line status-word check', () => {
  assertCheck(SHAPING_MODE, 'shaping-mode.md');
});

test('AC1.1: record-creation-subissues.md carries the same check', () => {
  assertCheck(SUBISSUES, 'record-creation-subissues.md');
});

test('AC3.1 + AC3.2: the specify check rewrites rather than prompts (no mid-flow stop)', () => {
  for (const [text, fileLabel] of [[SHAPING_MODE, 'shaping-mode.md'], [SUBISSUES, 'record-creation-subissues.md']]) {
    const slice = checkSlice(text, fileLabel);
    assert.match(slice, /rewrite/i, `${fileLabel}: the check must rewrite a mismatch`);
    assert.match(slice, /never stop mid-flow to ask/, `${fileLabel}: the check must forbid a mid-flow stop`);
    assert.doesNotMatch(slice, /AskUserQuestion/, `${fileLabel}: the check must not prompt via AskUserQuestion`);
  }
});

test('shaping-mode.md places the check after premise verification and before the near-duplicate check', () => {
  const labelIdx = SHAPING_MODE.indexOf(LABEL);
  const premiseIdx = SHAPING_MODE.indexOf("Run `_shared/premise-verification.md`'s check against the composed");
  const nearDupIdx = SHAPING_MODE.indexOf('**Near-duplicate candidate check (#1944)');
  assert.ok(premiseIdx !== -1 && nearDupIdx !== -1, 'premise-verification and near-duplicate anchors must exist');
  assert.ok(labelIdx > premiseIdx, 'the status-word check must follow the premise-verification paragraph');
  assert.ok(labelIdx < nearDupIdx, 'the status-word check must precede the near-duplicate check');
  assert.match(checkSlice(SHAPING_MODE, 'shaping-mode.md'), /before the record is written or stamped `ready`/);
});

test('record-creation-subissues.md places the check after premise verification and before Ceremony', () => {
  const labelIdx = SUBISSUES.indexOf(LABEL);
  const premiseIdx = SUBISSUES.indexOf('Premise verification (#1769)');
  const ceremonyIdx = SUBISSUES.indexOf('**Ceremony**');
  assert.ok(premiseIdx !== -1 && ceremonyIdx !== -1, 'premise-verification and Ceremony anchors must exist');
  assert.ok(labelIdx > premiseIdx, 'the status-word check must follow the premise-verification paragraph');
  assert.ok(labelIdx < ceremonyIdx, 'the status-word check must precede the Ceremony paragraph');
  assert.match(checkSlice(SUBISSUES, 'record-creation-subissues.md'), /before `gh issue create` \/ `writeRecord`/);
});

test('docs/skill-graph.md ## specify section carries the auto-decision-log edge', () => {
  const headingIdx = SKILL_GRAPH.search(/^## specify$/m);
  assert.notStrictEqual(headingIdx, -1, 'the ## specify section heading must exist');
  const specifySection = SKILL_GRAPH.slice(headingIdx, headingIdx + 6000);
  assert.match(specifySection, /_shared\/auto-decision-log\.md/);
});
