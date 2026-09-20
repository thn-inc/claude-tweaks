'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #856: extraction of plugin/skills/_shared/transcript-judge.md from
// plugin/skills/feedback/session-evaluation.md. Pins the shared file's own
// content (the consumer-invariant mechanics moved verbatim) and the fact
// that session-evaluation.md cites it rather than restating it.
//
// Read live, not frozen fixtures — same posture as
// tests/feedback-watermark-prose.test.js: this is just-shipped prose
// expected to keep evolving in place (a third consumer, more prompt items)
// rather than content scheduled for deletion.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const SHARED = read('plugin', 'skills', '_shared', 'transcript-judge.md');
const SESSION_EVAL = read('plugin', 'skills', 'feedback', 'session-evaluation.md');

// --- 1. Consumer parameterization is documented as four named points ---

test('transcript-judge.md documents the four consumer parameterization points', () => {
  assert.match(SHARED, /## Consumer parameterization/);
  assert.match(SHARED, /1\. \*\*Rubric\*\*/);
  assert.match(SHARED, /2\. \*\*Output template\*\*/);
  assert.match(SHARED, /3\. \*\*Model profile\*\*/);
  assert.match(SHARED, /4\. \*\*Watermark consumer key\*\*/);
});

test('transcript-judge.md names both known consumers by their watermark key', () => {
  assert.match(SHARED, /consumer key `feedback`/);
  assert.match(SHARED, /consumer key `reflect`/);
});

// --- 2. Transcript resolution mechanics moved verbatim ---

test('transcript-judge.md documents the main-session-only scope statement', () => {
  assert.match(SHARED, /resolves the \*\*main session's own transcript only\.\*\*/);
});

test('transcript-judge.md documents project-slug derivation with the doubled-hyphen rule', () => {
  assert.match(SHARED, /each `\/`,\s*\n\s*space, and `\.` in that path is replaced by `-`/);
  assert.match(SHARED, /produces a doubled hyphen where the directory separator and the/);
});

test('transcript-judge.md documents the mtime-newest fallback with mandatory disclosure', () => {
  assert.match(SHARED, /pick the newest\s*\n`\.jsonl` file in the resolved project-slug directory by mtime/);
  assert.match(SHARED, /never silent newest-wins/);
});

// --- 3. Watermark protocol moved verbatim, including timing and degrade-open ---

test('transcript-judge.md documents bytesAtDispatch captured BEFORE dispatch', () => {
  assert.match(
    SHARED,
    /bytesAtDispatch,\s*\/\/ captured BEFORE dispatch — the judge's own tool calls append/,
  );
});

test('transcript-judge.md documents watermark write-failure degrade-open', () => {
  assert.match(SHARED, /On a write failure: degrade open — the evaluation result itself is unaffected/);
});

test('transcript-judge.md documents the watermark write is gated on DONE\\/DONE_WITH_CONCERNS only', () => {
  assert.match(SHARED, /On a `DONE` or `DONE_WITH_CONCERNS` return from the judge \(not/);
});

// --- 4. Self-assessment degradation + record-failure clause moved verbatim ---

test('transcript-judge.md documents the (self-assessment) header-tag mitigation', () => {
  assert.match(SHARED, /appended to each block's header line —\s*\n\s*e\.g\. `## Avoidable interactions \(self-assessment\)`/);
});

test('transcript-judge.md documents the record-failure clause on terminal dispatch failure', () => {
  assert.match(SHARED, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/resolve-profile\.js" record-failure \{model\}/);
});

// --- 5. Slicing guidance and finding norms moved verbatim ---

test('transcript-judge.md documents countable vs judgment lens slicing guidance', () => {
  assert.match(SHARED, /\*\*Countable lenses\*\* — anchor on keywords/);
  assert.match(SHARED, /\*\*Judgment lenses\*\* — sample rather than anchor/);
});

test('transcript-judge.md documents "NO FINDING" as the expected common answer', () => {
  assert.match(SHARED, /\*\*"NO FINDING" is\s*\nthe expected common answer\*\*/);
});

// --- 6. session-evaluation.md cites this file for everything moved ---

test('session-evaluation.md cites the shared file rather than restating transcript resolution', () => {
  assert.match(SESSION_EVAL, /_shared\/transcript-judge\.md/);
});

// --- 6b. #1119: Skip check (#701) promoted into the shared contract ---

test('transcript-judge.md documents the Skip check section, positioned before the judge dispatch', () => {
  const skipIdx = SHARED.indexOf('## Skip check (before dispatch)');
  const dispatchIdx = SHARED.indexOf('## The judge dispatch');
  assert.ok(skipIdx > 0, 'Skip check section must exist');
  assert.ok(dispatchIdx > skipIdx, 'Skip check must come before the judge dispatch section');
});

test('transcript-judge.md documents isTranscriptUnchanged as the skip check\'s core call', () => {
  assert.match(SHARED, /isTranscriptUnchanged\(watermark, currentBytes\)/);
});

test('transcript-judge.md documents the self-assessment exemption for the skip check', () => {
  assert.match(SHARED, /Self-assessment is exempted, explicitly \(not an oversight\)/);
});

test('transcript-judge.md states the consumer\'s full-reset override and its own report are consumer-owned', () => {
  assert.match(SHARED, /the consumer's own full-reset override was not passed/);
  assert.match(SHARED, /is consumer-owned, named in the consumer's own file, never restated here/);
});

// --- 7. Byte ceiling ---

// Per-file 40 KB pin on transcript-judge.md retired by #1997 — the per-file
// tier is a warning since #1990 and this file has no compose call site;
// removal condition in docs/incident-log.md [IL-153].
