// tests/design-wrapper-review-surface-gate-prose.test.js — pins the #1863
// addition to skills/design-wrapper/modes/review.md's Step 3.8: the
// design-surface gate at (b) that skips craft-critic dispatch on a
// control-flow-only diff, and the instructed-read shape for the decisions
// layer in (e) item 3 (replacing verbatim inlining). Reads the live skill
// file — this test pins prose we just wrote, not a third-party fact (the
// skill-prose-conformance-tests live-vs-fixture distinction).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REVIEW_MD = path.join(__dirname, '..', 'plugin', 'skills', 'design-wrapper', 'modes', 'review.md');
const DESIGN_CRAFT_MD = path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'design-craft.md');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function stepSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `expected to find "${startMarker}"`);
  const end = endMarker ? text.indexOf(endMarker, start) : text.length;
  return text.slice(start, end === -1 ? text.length : end);
}

// --- Step 3.8 (b): design-surface gate ---

test('review.md Step 3.8 (b) is a design-surface gate before roster selection', () => {
  const text = read(REVIEW_MD);
  assert.match(text, /\*\*\(b\) Design-surface gate, then roster selection\.\*\*/);
});

test('review.md design-surface gate scopes to the web track only', () => {
  const text = read(REVIEW_MD);
  const step = stepSlice(text, '**(b) Design-surface gate', '**Roster selection.**');
  assert.match(step, /This gate applies \*\*only on `surface_track === "web"`\*\*/);
});

test('review.md design-surface gate calls the design-detect.js --surface-lines CLI', () => {
  const text = read(REVIEW_MD);
  const step = stepSlice(text, '**(b) Design-surface gate', '**Roster selection.**');
  assert.match(step, /design-detect\.js" --surface-lines <scratch-path>/);
});

test('review.md design-surface gate skips dispatch and logs SCANNED naming the gate', () => {
  const text = read(REVIEW_MD);
  const step = stepSlice(text, '**(b) Design-surface gate', '**Roster selection.**');
  assert.match(step, /no roster read, no dispatch, and `craft_critics` is \*\*omitted\*\* from/);
  assert.match(step, /SCANNED \{time\} — review Step 3\.8: design-surface gate: no JSX\/CSS\/template\/copy lines changed\. Reversibility: n\/a\./);
});

test('review.md design-surface gate fails open (never blocks) on an unreadable diff', () => {
  const text = read(REVIEW_MD);
  const step = stepSlice(text, '**(b) Design-surface gate', '**Roster selection.**');
  assert.match(step, /never blocks the step — fail open toward\s*\ndispatching/);
  assert.match(step, /SCANNED \{time\} — review Step 3\.8: design-surface gate: diff unavailable/);
});

// --- Step 3.8 (e): instructed-read shape for the decisions layer ---

test('review.md (e) item 1 rewords the rationale as an unnamed, uninstructed path', () => {
  const text = read(REVIEW_MD);
  assert.match(text, /an unnamed, uninstructed path reaches nothing/);
  assert.doesNotMatch(text, /\(a path string reaches nothing — see/);
});

test('review.md (e) item 3 sends an instructed read of DESIGN.md and the sidecar, never inlined verbatim', () => {
  const text = read(REVIEW_MD);
  const item3 = stepSlice(text, '3. The decisions layer from (d) as an **instructed read**', '4. The two questions');
  assert.match(item3, /Read these files first, before judging — DESIGN\.md, then\s*\n\s*\.impeccable\/design\.json when both are listed\./);
  assert.match(item3, /subagent_type: general-purpose`.*carries the `Read`\s*\n\s*tool unconditionally/s);
  assert.match(item3, /No DESIGN\.md or sidecar exists for this project — emit no `decisions` rows/);
});

test('review.md no longer inlines DESIGN.md/sidecar verbatim in (e)', () => {
  const text = read(REVIEW_MD);
  assert.doesNotMatch(text, /inlined verbatim \(`DESIGN\.md`, then `\.impeccable\/design\.json`\)/);
});

test('review.md (d) resolves decisions-layer paths for an instructed read, not verbatim inlining', () => {
  const text = read(REVIEW_MD);
  const stepD = stepSlice(text, '**(d) Decisions layer.**', '**(e) Dispatch.**');
  assert.match(stepD, /Resolve both to their \*\*absolute paths\*\* when present/);
  assert.match(stepD, /instructed read of those paths, never the file content itself/);
});

// --- design-craft.md Subagent Contract compliance reword ---

test('design-craft.md Subagent Contract compliance names the instructed-read exception', () => {
  const text = read(DESIGN_CRAFT_MD);
  const section = stepSlice(text, '## Subagent Contract compliance');
  assert.match(section, /an unnamed, uninstructed path/);
  assert.match(section, /A \*\*named\*\* path paired with an\s*\nexplicit "read this file first" instruction is not that case/);
  assert.match(section, /Step 3\.8 \(e\) item 3's instructed read of the\s*\ndecisions layer is the one consumer that takes this exception/);
});

test('design-craft.md states pre-build/explore still inline unconditionally', () => {
  const text = read(DESIGN_CRAFT_MD);
  const section = stepSlice(text, '## Subagent Contract compliance');
  assert.match(section, /`pre-build`\/`explore` inline every source class\s*\nunconditionally/);
});

// --- Prompt byte-size acceptance criterion (#1863) ---
//
// review.md's Step 3.8 (e) prompt items are literal template text assembled
// by an LLM at dispatch time, not code — so this composes a reference
// fixture from the SAME literal blocks review.md itself defines (items 4-6,
// extracted below, never hand-duplicated) plus fixture SKILL.md/paths
// content sized to the incident's own numbers (~28 KB SKILL.md, ~25 KB
// DESIGN.md, ~20 KB sidecar — the #1863 issue body's own figures), and
// asserts the new instructed-read shape lands under the 35 KB ceiling while
// proving the old verbatim-inlining shape it replaced would not have
// (discrimination, not just a passing number — reverting to the old shape
// must make this test fail).

function extractItem4Questions(reviewText) {
  const start = reviewText.indexOf('4. The two questions, verbatim:');
  const end = reviewText.indexOf('5. The status-line protocol', start);
  assert.ok(start !== -1 && end !== -1, 'expected to find item 4 in review.md');
  return reviewText.slice(start, end);
}

function extractItem5Template(reviewText) {
  const marker = '5. The status-line protocol and the findings template — this literal block:';
  const start = reviewText.indexOf(marker);
  assert.notEqual(start, -1, 'expected to find item 5 marker in review.md');
  const fenceStart = reviewText.indexOf('```', start);
  const fenceEnd = reviewText.indexOf('```', fenceStart + 3);
  assert.ok(fenceStart !== -1 && fenceEnd !== -1, 'expected a fenced block for item 5');
  return reviewText.slice(fenceStart, fenceEnd + 3);
}

function extractItem6Constraint(reviewText) {
  const marker = '6. The read-only constraint, verbatim:';
  const start = reviewText.indexOf(marker);
  assert.notEqual(start, -1, 'expected to find item 6 in review.md');
  const end = reviewText.indexOf('\n\n', start);
  return reviewText.slice(start, end === -1 ? reviewText.length : end);
}

const FIXTURE_SKILL_MD = 'x'.repeat(28 * 1024); // emil-design-eng-sized fixture, per the issue body
const FIXTURE_DESIGN_MD = 'y'.repeat(25 * 1024); // DESIGN.md-sized fixture, per the issue body
const FIXTURE_SIDECAR = 'z'.repeat(20 * 1024); // .impeccable/design.json-sized fixture, per the issue body
const FIXTURE_FILE_LIST = '/repo/src/components/Widget.tsx\n/repo/src/components/Widget.module.css';
const FIXTURE_REPO_PATH = '/repo';

test('reference-fixture prompt (new instructed-read shape) is under the 35 KB ceiling', () => {
  const reviewText = read(REVIEW_MD);
  const item4 = extractItem4Questions(reviewText);
  const item5 = extractItem5Template(reviewText);
  const item6 = extractItem6Constraint(reviewText);

  const item3InstructedRead = `3. The decisions layer as an instructed read: ${FIXTURE_REPO_PATH}/DESIGN.md, then `
    + `${FIXTURE_REPO_PATH}/.impeccable/design.json — "Read these files first, before judging."`;

  const prompt = [
    `1. ${FIXTURE_SKILL_MD}`,
    `2. ${FIXTURE_REPO_PATH}\n${FIXTURE_FILE_LIST}`,
    item3InstructedRead,
    item4,
    item5,
    item6,
  ].join('\n\n');

  const bytes = Buffer.byteLength(prompt, 'utf8');
  assert.ok(bytes < 35 * 1024, `expected the new-shape prompt under 35 KB, got ${(bytes / 1024).toFixed(1)} KB`);
});

test('reference-fixture prompt (old verbatim-inlining shape) exceeds the 35 KB ceiling — proves discrimination', () => {
  const reviewText = read(REVIEW_MD);
  const item4 = extractItem4Questions(reviewText);
  const item5 = extractItem5Template(reviewText);
  const item6 = extractItem6Constraint(reviewText);

  const item3VerbatimInlined = `3. ${FIXTURE_DESIGN_MD}\n${FIXTURE_SIDECAR}`;

  const prompt = [
    `1. ${FIXTURE_SKILL_MD}`,
    `2. ${FIXTURE_REPO_PATH}\n${FIXTURE_FILE_LIST}`,
    item3VerbatimInlined,
    item4,
    item5,
    item6,
  ].join('\n\n');

  const bytes = Buffer.byteLength(prompt, 'utf8');
  assert.ok(bytes >= 35 * 1024, `expected the old-shape prompt to exceed 35 KB (this proves the test can discriminate), got ${(bytes / 1024).toFixed(1)} KB`);
});
