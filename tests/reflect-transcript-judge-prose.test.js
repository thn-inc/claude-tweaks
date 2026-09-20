'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #857: reflect's standalone Frontier singleton reads the transcript via the
// shared transcript-judge harness (skills/_shared/transcript-judge.md, #856).
// Pins the dispatch-prompt additions, the watermark write timing/payload,
// the degradation binding, and the component-invoked path staying
// unaffected. Sibling #858 extends this same file with the finding-shape
// (Evidence:/Cost this session:) pins.
//
// Read live, not frozen fixtures — same posture as
// tests/transcript-judge-prose.test.js: just-shipped prose expected to keep
// evolving in place, not content scheduled for deletion.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const SKILL = read('plugin', 'skills', 'reflect', 'SKILL.md');
const FULL_MODE = read('plugin', 'skills', 'reflect', 'full-mode.md');
const LIGHT_MODE = read('plugin', 'skills', 'reflect', 'light-mode.md');
const HINDSIGHT_MODE = read('plugin', 'skills', 'reflect', 'hindsight-mode.md');
const WRAP_UP = read('plugin', 'skills', 'wrap-up', 'SKILL.md');

// Every mode file, and the subset whose findings can also come from the
// dispatched singleton (hindsight mode is inline-only — see section 7).
const MODE_FILES = [
  ['full-mode.md', FULL_MODE],
  ['light-mode.md', LIGHT_MODE],
  ['hindsight-mode.md', HINDSIGHT_MODE],
];
const DISPATCHING_MODE_FILES = [
  ['full-mode.md', FULL_MODE],
  ['light-mode.md', LIGHT_MODE],
];

// --- 1. Step 2 cites _shared/transcript-judge.md with consumer key reflect ---

test('reflect SKILL.md Step 2 cites _shared/transcript-judge.md', () => {
  assert.match(SKILL, /_shared\/transcript-judge\.md/);
});

test('reflect SKILL.md Step 2 names the reflect watermark consumer key', () => {
  assert.match(SKILL, /consumer key `reflect`/);
});

// --- 2. Dispatch prompt gains the transcript path, cross-session scope statement, and offset clause ---

test('reflect SKILL.md documents the transcript path immediately followed by the cross-session coverage-limit scope statement', () => {
  assert.match(
    SKILL,
    /the resolved transcript path, immediately followed by the shared contract's cross-session coverage-limit scope statement/,
  );
});

test('reflect SKILL.md documents the conditional watermark offset clause via readWatermark with consumer: reflect', () => {
  assert.match(SKILL, /`readWatermark\(path, \{ consumer: 'reflect' \}\)` returns non-null/);
});

// --- 2b. #1119: reflect's standalone dispatch gains the shared Skip check (promoted from #701) ---

test('reflect SKILL.md documents the Skip check citing the shared procedure with consumer key reflect', () => {
  assert.match(
    SKILL,
    /run `_shared\/transcript-judge\.md`'s Skip\ncheck with consumer key `reflect`/,
  );
  assert.match(SKILL, /isTranscriptUnchanged\(watermark, currentBytes\)/);
});

test('reflect SKILL.md states reflect defines no full-reset override', () => {
  assert.match(SKILL, /Reflect\ndefines no full-reset override, so there is no bypass flag to check/);
});

test('reflect SKILL.md documents skipping the dispatch reports a pointer to filedRecords, not issueUrls', () => {
  assert.match(
    SKILL,
    /Report a pointer to the prior watermark's `filedRecords`\n\(below\) at Step 5 instead of a fresh finding list/,
  );
  assert.match(SKILL, /prior filings: \{filedRecords, or "none" if empty\}/);
});

// --- 3. Watermark write timing: captured before dispatch, written after Step 3, gated on status ---

test('reflect SKILL.md documents bytesAtDispatch captured before dispatch and write after Step 3 routing', () => {
  assert.match(SKILL, /Capture `bytesAtDispatch` before dispatch and the judge's return status at return time/);
  assert.match(SKILL, /The write itself executes \*\*after\*\* Step 3 routing completes/);
});

test('reflect SKILL.md documents the watermark write is gated on DONE/DONE_WITH_CONCERNS only', () => {
  assert.match(SKILL, /gated on that captured status being `DONE`\/`DONE_WITH_CONCERNS`/);
});

test('reflect SKILL.md documents the reflect-specific filedRecords payload (routed-insight summaries)', () => {
  assert.match(
    SKILL,
    /filedRecords` holds one short summary per insight that Step 3 resolved to a \*\*durable routed outcome\*\*/,
  );
});

// --- 3b. #1033: reflect's own judge dispatch supplies dismissedSubjects, computed live ---
// (#849's final review flagged that reflect's judge dispatch always rendered an inert
// "previously declined: none" segment — the payload carried no dismissedSubjects/
// dismissedFingerprints field at all. This mirrors session-evaluation.md's fix for feedback.)

test('reflect SKILL.md documents dismissedSubjects sourced from listDeclined({ source: \'reflect\' })', () => {
  assert.match(SKILL, /listDeclined\(\{ source: 'reflect' \}\)` mapped to each entry's `subject` text/);
});

test('reflect SKILL.md documents dismissedSubjects is computed live, never read off the returned watermark object', () => {
  assert.match(SKILL, /computed live, immediately before composing the offset clause, never read off the watermark object/);
});

test('reflect SKILL.md documents the written watermark payload deliberately excludes dismissedSubjects', () => {
  assert.match(SKILL, /`dismissedSubjects` is deliberately not part of this written payload/);
});

// --- 4. Degradation binding names the shared self-assessment path ---

test('reflect SKILL.md documents the degradation binding to the shared self-assessment path', () => {
  assert.match(SKILL, /A transcript-resolution failure or a terminal dispatch failure resolves to the existing inline lens procedure/);
  assert.match(SKILL, /\(self-assessment\)` header tags on each block and the `record-failure` clause/);
});

// Degradation equivalence (AC6): the degradation binding and the
// component-invoked path both resolve to the SAME inline lens procedure —
// pin that both paths' surrounding sentences name "the existing inline lens
// procedure" / "the inline lens procedure a parent skill's ... signal
// selects", not two different procedures under two different names.
test('reflect SKILL.md: degradation fallback and component-invoked path both name the same inline lens procedure (equivalence pinned, not assumed)', () => {
  assert.match(SKILL, /resolves to the existing inline lens procedure — named, per `_shared\/transcript-judge\.md`'s self-assessment path/);
  assert.match(
    SKILL,
    /the transcript-judge integration is exclusively a property of the standalone singleton dispatch, never of the inline lens procedure a parent skill's `\$PIPELINE_RUN_DIR`\/`--source` signal selects/,
  );
});

// --- 5. Component-invoked branch carries no transcript/watermark instruction ---

test('reflect SKILL.md: component-invoked path is stated as unaffected — no dispatch, no transcript read, no watermark', () => {
  assert.match(SKILL, /\*\*Component-invoked path is unaffected\.\*\* No dispatch, no transcript read, no watermark read or write/);
});

// The transcript-judge integration paragraphs must sit strictly between the
// standalone singleton dispatch sentence and Step 3 — never inside the
// Component-Skill Contract's component-invoked branch description, which
// would wrongly imply the component-invoked path also reads a transcript.
test('reflect SKILL.md: transcript-judge integration paragraphs are scoped to the standalone singleton, not the component-invoked branch', () => {
  const singleton = SKILL.indexOf('**Standalone-only `[Use: Frontier]` singleton');
  const integration = SKILL.indexOf('**Transcript-judge integration (record #857).**');
  const step3 = SKILL.indexOf('## Step 3: Route Findings');
  assert.ok(singleton > 0, 'standalone singleton paragraph must exist');
  assert.ok(integration > singleton, 'transcript-judge integration must come after the singleton paragraph');
  assert.ok(step3 > integration, 'transcript-judge integration must come before Step 3');
});

// ============================================================================
// #858: Evidence and cost lines on the reflect finding shape (all three modes)
// ============================================================================

// --- 6. Each mode file requires the two lines and states the no-manufacture norm ---

for (const [name, content] of MODE_FILES) {
  test(`${name} requires an Evidence: line and a Cost this session: line on every finding`, () => {
    assert.match(content, /an `Evidence:` line and a `Cost this session:` line/);
    assert.match(content, /`unclear` is valid — retries, hand-work, a reverted decision/);
  });

  test(`${name} states "No finding" is the expected common answer (no-manufacture norm)`, () => {
    assert.match(content, /\*\*"No finding" is the expected common answer\*\*/);
    assert.match(content, /rather than manufacturing an? (insight|finding) to look thorough/);
  });
}

// --- 7. Evidence format is path-specific: inline vs dispatched ---

test('full-mode.md and light-mode.md define both the inline and dispatched Evidence formats', () => {
  for (const [name, content] of DISPATCHING_MODE_FILES) {
    assert.match(content, /\*\*Inline path\*\*.*Never a transcript byte offset/s, `${name}: no inline Evidence format`);
    assert.match(content, /\*\*Dispatched path\*\*.*_shared\/transcript-judge\.md/s, `${name}: no dispatched Evidence format`);
  }
});

test('hindsight-mode.md defines only the inline Evidence format — it never dispatches its own singleton', () => {
  assert.match(HINDSIGHT_MODE, /\*\*Inline path\*\*.*hindsight mode's only path, since it never dispatches its own singleton/s);
  assert.doesNotMatch(HINDSIGHT_MODE, /\*\*Dispatched path\*\*/);
});

// --- 8. hindsight-mode.md's evidence wording is pinned to partial-session framing ---

test('hindsight-mode.md frames Evidence pointers as partial-session, never end-of-run knowledge', () => {
  assert.match(
    HINDSIGHT_MODE,
    /hindsight mode runs mid-pipeline \(during `\/claude-tweaks:review`, before the run's later phases/,
  );
  assert.match(HINDSIGHT_MODE, /can only reference the \*\*partial session state visible at that point\*\*/);
  assert.match(HINDSIGHT_MODE, /never end-of-run knowledge the rest of the pipeline hasn't produced yet/);
});

// --- 9. No mode file requires Measurement: (AC5 discrimination: template requirement vs contrast clause) ---

test('no mode file requires Measurement: inside a finding template — it stays feedback-only', () => {
  // A `**Measurement:** {...}` line reads as a template-required field unless
  // the same line also carries the feedback-only contrast clause. Matches
  // across the whole file (not line-by-line) so a `{...}` payload spanning
  // no newline is caught regardless of surrounding prose.
  const templateFieldWithoutContrast = /\*\*Measurement:\*\*\s*\{[^}]*\}(?![^\n]*feedback-only)/;
  for (const [name, content] of MODE_FILES) {
    assert.doesNotMatch(
      content,
      templateFieldWithoutContrast,
      `${name}: found a Measurement: template field with no feedback-only contrast clause on the same line`,
    );
  }
});

// --- 10. SKILL.md Step 2's dispatch output template gains evidence + costThisSession fields ---

test('reflect SKILL.md Step 2 output template includes evidence and costThisSession fields', () => {
  assert.match(SKILL, /\{lens name, finding summary, category, evidence, costThisSession\}/);
});

// --- 11. SKILL.md Step 3 names Cost this session: as a triage input ---

test('reflect SKILL.md Step 3 names Cost this session: as a triage input for classification', () => {
  assert.match(SKILL, /`Cost this session:` line \(#858\) is a triage input to this classification/);
});

// --- 12. wrap-up/SKILL.md carries the two lines through to staged proposals and the anti-pattern row ---

test('wrap-up SKILL.md documents that staged proposals keep Evidence:/Cost this session: verbatim', () => {
  assert.match(WRAP_UP, /Every reflect insight in this whole-insight-set carries its own `Evidence:` and `Cost this session:` lines/);
  assert.match(WRAP_UP, /Reflect's own `staged\/reflect-\{n\}\.md` template \(`reflect\/SKILL\.md`'s `## Finding` body\) carries both lines/);
  assert.match(WRAP_UP, /Phase 2's judges \(Skills, Memory, Upstream feedback rows\) read that same insight text as their input/);
});

test('wrap-up SKILL.md anti-pattern row cites the Evidence: line as the mechanical anchor carrier', () => {
  assert.match(
    WRAP_UP,
    /a reflect insight's own `Evidence:` line \(#858\) is the mechanical carrier of that anchor/,
  );
});

// --- 13. Byte-budget guard (AC3 for #858): wrap-up SKILL.md net addition and ceiling ---

// Per-file 40 KB pin on wrap-up/SKILL.md retired by #1997 — the per-file tier is
// a warning since #1990 and this file has no compose call site; removal
// condition in docs/incident-log.md [IL-153].

// --- 14. #1033: full-mode.md's Subject scan for a near-miss (agent-judgment fallback when the
// exact-hash Prior-decline lookup finds nothing — AC2's "wording differs but subject is the same") ---

test('full-mode.md documents the Subject scan for a near-miss, sourced from listDeclined({ source: \'reflect\' })', () => {
  assert.match(FULL_MODE, /\*\*Subject scan for a near-miss \(#1033\)\.\*\*/);
  assert.match(FULL_MODE, /listDeclined\(\{ source: 'reflect' \}\)` and read each\nreturned entry's `subject` text/);
});

test('full-mode.md frames the subject scan as agent judgment, not a mechanical match', () => {
  assert.match(FULL_MODE, /Judge — as the agent already forming this table, not via any\nmechanical string match/);
  assert.match(FULL_MODE, /when genuinely uncertain whether two insights are "the\nsame point," do not annotate/);
});

test('full-mode.md clears the matched listDeclined entry\'s own fingerprint on a subject-scan match, not a freshly-computed one', () => {
  assert.match(
    FULL_MODE,
    /For a subject-scan match \(no exact-hash match\), clear the matched entry's own\nfingerprint — the one the `listDeclined` entry carries/,
  );
});

test('full-mode.md\'s Don\'t-capture resolution passes subject: description to recordDecline', () => {
  assert.match(FULL_MODE, /recordDecline\(fingerprint, \{ reason, source: 'reflect', subject: description \}\)/);
});
