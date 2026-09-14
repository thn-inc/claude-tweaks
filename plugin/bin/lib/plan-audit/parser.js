// plugin/bin/lib/plan-audit/parser.js — plan markdown parsing for
// bin/plan-audit.js (#903). No formal plan grammar exists (materialize.md's
// Prerequisites); this parser's tolerated shapes are derived from real plans
// under docs/superpowers/plans/ and pinned by tests/bin-lib/plan-audit/
// fixtures. Pure: no fs, no process access.
'use strict';

const FILE_TYPES = ['Create', 'Modify', 'Delete', 'Test'];

// Matches one "Files:" bullet line, e.g.:
//   - Modify: `plugin/bin/lib/foo.js`
//   - Create: tests/foo.test.js
//   - Modify: `plugin/skills/flow/materialize.md:142-147` (trailing note)
// Captures the type and the raw remainder (path + any trailing annotation).
const FILE_BULLET_RE = new RegExp(
  `^[-*]\\s+(${FILE_TYPES.join('|')}):\\s*(.+)$`,
);

// A "Files:" (or "**Files:**") section header — the label may carry inline
// text on the same line (e.g. "**Files:** none (verification only).").
const FILES_HEADER_RE = /^\*{0,2}Files:\*{0,2}\s*(.*)$/;

// Extracts the path from a Files-bullet remainder: prefer a backticked span
// (the dominant style in real plans); otherwise take the first
// whitespace-delimited token. Either way, strip a trailing line-range suffix
// (":123-145" or ":123") — Check A needs a bare filesystem path.
function extractPath(remainder) {
  const backticked = remainder.match(/`([^`]+)`/);
  let raw = backticked ? backticked[1] : remainder.split(/\s+/)[0];
  raw = raw.replace(/:\d+(-\d+)?$/, '');
  return raw;
}

// Returns every { type, path } bullet found under any "Files:" section in
// the plan, across every Task block — a plan-authoring.md-shaped plan
// declares one Files: section per task, and Check A/headroom scan all of
// them, not just the first.
function extractFileEntries(text) {
  const lines = text.split('\n');
  const entries = [];
  let inFilesSection = false;
  for (const line of lines) {
    const bullet = line.match(FILE_BULLET_RE);
    if (bullet) {
      inFilesSection = true;
      entries.push({ type: bullet[1], path: extractPath(bullet[2]) });
      continue;
    }
    if (FILES_HEADER_RE.test(line.trim())) {
      inFilesSection = true;
      continue;
    }
    // A blank line doesn't end the section (bullets are often preceded by
    // one); any other non-bullet, non-blank line does.
    if (inFilesSection && line.trim() !== '' && !line.trim().startsWith('-') && !line.trim().startsWith('*')) {
      inFilesSection = false;
    }
  }
  return entries;
}

// "Scope keywords: foo, bar, baz" — line-anchored, case-insensitive label.
// Returns a trimmed, de-duplicated array (empty when the field is absent).
function extractScopeKeywords(text) {
  const match = text.match(/^Scope keywords:\s*(.+)$/im);
  if (!match) return [];
  return [...new Set(
    match[1].split(',').map((k) => k.trim()).filter(Boolean),
  )];
}

// Splits the plan into per-task blocks: { taskNumber, title, body }, one per
// "### Task N: ..." heading, body running to the next such heading (or EOF).
function extractTaskBlocks(text) {
  const headingRe = /^###\s+Task\s+(\d+):\s*(.*)$/gm;
  const headings = [];
  let m;
  while ((m = headingRe.exec(text)) !== null) {
    headings.push({ index: m.index, taskNumber: m[1], title: m[2].trim(), headingEnd: m.index + m[0].length });
  }
  return headings.map((h, i) => {
    const end = i + 1 < headings.length ? headings[i + 1].index : text.length;
    return { taskNumber: h.taskNumber, title: h.title, body: text.slice(h.headingEnd, end) };
  });
}

// Within one task body, extracts the Step 2 Run:/Expected: pair (writing-plans'
// "Run test to verify it fails" sub-step). Matched by step NUMBER, not by the
// step's wording — real plans phrase the heading differently ("Run the new
// tests to verify they fail" vs "Run test to verify it fails"). Returns null
// when the task carries no Step 2 (or no Run:/Expected: pair under it) — a
// non-code task, per plan-audit.md's Check C.
function extractStep2Verification(taskBody) {
  const stepRe = /\*\*Step\s+2:[^*\n]*\*\*/g;
  const stepMatch = stepRe.exec(taskBody);
  if (!stepMatch) return null;
  // Scope the search window to the text between this Step 2 heading and the
  // next "- [ ] **Step" heading (or end of task body).
  const rest = taskBody.slice(stepMatch.index + stepMatch[0].length);
  const nextStep = rest.match(/\n[-*]\s*\[[ xX]?\]\s*\*\*Step\s+\d+:/);
  const window = nextStep ? rest.slice(0, nextStep.index) : rest;
  const runMatch = window.match(/^Run:\s*(.+)$/m);
  const expectedMatch = window.match(/^Expected:\s*(.+)$/m);
  if (!runMatch || !expectedMatch) return null;
  const backtickedCmd = runMatch[1].match(/`([^`]+)`/);
  const command = (backtickedCmd ? backtickedCmd[1] : runMatch[1]).trim();
  return { command, expected: expectedMatch[1].trim() };
}

// Broader than the strict heading matched by extractStep2Verification above
// (which requires bold "**Step 2:...**" text) — detects any checkbox-style
// Step 2 line regardless of wording or bold formatting, so a task can be
// classified as "Step 2 present" even when the strict extractor can't parse
// it. Used to distinguish "no Step 2 at all" (nothing to report; a non-code
// task, per plan-audit.md's Check C) from "Step 2 present but unparseable"
// (#1594's signal).
const STEP2_CHECKBOX_RE = /^[-*]\s*\[[ xX]?\]\s*.*\bStep\s+2\b.*$/m;

// Within one task body whose STEP2_CHECKBOX_RE already matched, returns a
// short raw excerpt (up to 5 non-blank lines, from the checkbox line to the
// next step heading or end of body) for diagnostic display when the strict
// Run:/Expected: extraction can't parse a verification pair from it. Returns
// null if no checkbox line is found (callers only invoke this after
// confirming one exists, but stays defensive rather than assuming).
function extractStep2RawExcerpt(taskBody) {
  const heading = STEP2_CHECKBOX_RE.exec(taskBody);
  if (!heading) return null;
  const afterHeading = taskBody.slice(heading.index + heading[0].length);
  const nextStep = afterHeading.match(/\n[-*]\s*\[[ xX]?\]\s*.*\bStep\s+\d+\b/);
  const window = heading[0] + (nextStep ? afterHeading.slice(0, nextStep.index) : afterHeading);
  return window.trim().split('\n').filter((line) => line.trim() !== '').slice(0, 5).join('\n');
}

// Convenience: every task whose Step 2 is present (a checkbox line matching
// STEP2_CHECKBOX_RE) but unparseable (extractStep2Verification finds no
// Run:/Expected: pair under it). A task with no Step 2 at all is never
// reported — that's a non-code task, per plan-audit.md's Check C.
// plan-audit.js's Check C reports these as warnings (never a hard finding) so
// a human can judge whether the plan needs updating to the canonical template
// or the parser needs to learn a legitimately new shape (#1594).
function extractUnparseableStep2s(text) {
  return extractTaskBlocks(text)
    .filter((task) => STEP2_CHECKBOX_RE.test(task.body) && extractStep2Verification(task.body) === null)
    .map((task) => ({
      taskNumber: task.taskNumber,
      title: task.title,
      raw: extractStep2RawExcerpt(task.body),
    }));
}

// Within one task body, extracts the Step 1 text (heading through the next
// Step heading or end of body) — #1999's Check C append-shape exception
// needs Step 1's own prose to look for a named path, alongside Step 2's
// Run:/Expected: pair. Returns null when the task carries no Step 1 heading.
function extractStep1Text(taskBody) {
  const stepRe = /\*\*Step\s+1:[^*\n]*\*\*/;
  const stepMatch = stepRe.exec(taskBody);
  if (!stepMatch) return null;
  const rest = taskBody.slice(stepMatch.index + stepMatch[0].length);
  const nextStep = rest.match(/\n[-*]\s*\[[ xX]?\]\s*\*\*Step\s+\d+:/);
  const window = stepMatch[0] + (nextStep ? rest.slice(0, nextStep.index) : rest);
  return window.trim();
}

// "Expected: FAIL after Step 1 ..." — the author-side escape hatch for
// Check C's append-shape heuristic (#1999): declares the shape explicitly,
// no path-matching needed. Still starts with "FAIL" so the existing
// extractVerificationChecks scope filter below keeps selecting the task.
const APPEND_MARKER_RE = /^FAIL\s+after\s+Step\s*1\b/i;

// Convenience: every task's Step 2 verification pair, only for tasks that
// have one and whose Expected text starts with FAIL (Check C's own scope —
// see plan-audit.md's "Finding" section). Each entry also carries #1999's
// append-shape inputs: step1Text (that task's own Step 1 prose, or null),
// taskFileEntries (that task's own Files: bullets — Check C's caller filters
// to Modify:/Test:), and appendMarker (the explicit marker above).
function extractVerificationChecks(text) {
  return extractTaskBlocks(text)
    .map((task) => ({ task, verification: extractStep2Verification(task.body) }))
    .filter(({ verification }) => verification && /^FAIL\b/i.test(verification.expected))
    .map(({ task, verification }) => ({
      taskNumber: task.taskNumber,
      title: task.title,
      command: verification.command,
      expected: verification.expected,
      step1Text: extractStep1Text(task.body),
      taskFileEntries: extractFileEntries(task.body),
      appendMarker: APPEND_MARKER_RE.test(verification.expected.trim()),
    }));
}

// Strips fenced code blocks (```...```) from text before it is tested for a
// prose marker — a plan header that quotes another plan's `**Execution:**
// batched` line inside a fenced example must not itself read as batched.
function stripFencedCodeBlocks(text) {
  // Backtick and tilde fences alike (both are CommonMark fences); an
  // unclosed fence strips nothing — the lazy quantifier needs its closer.
  return text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '');
}

// Task count for /build's single-task fast-lane condition (#1926): the plan
// file is the authority, never the diff or SDD's own narration. `batched`
// is true only for the two markers this record defines — the header line
// `**Execution:** batched` (text before the first "### Task" heading) or a
// task title carrying `[batch]` — because a batched dispatch bundles work
// items reviewed together, which the single-task equivalence never covers.
// The header check strips fenced code blocks first (task titles are single
// lines and need no such stripping).
function countTasks(text) {
  const blocks = extractTaskBlocks(text);
  const firstHeading = text.search(/^###\s+Task\s+\d+:/m);
  const header = firstHeading === -1 ? text : text.slice(0, firstHeading);
  const batched = /^\*\*Execution:\*\*\s*batched\s*$/m.test(stripFencedCodeBlocks(header))
    || blocks.some((b) => /\[batch\]/i.test(b.title));
  return { tasks: blocks.length, batched };
}

module.exports = {
  extractFileEntries,
  extractScopeKeywords,
  extractTaskBlocks,
  extractStep1Text,
  extractStep2Verification,
  extractVerificationChecks,
  extractUnparseableStep2s,
  countTasks,
};
