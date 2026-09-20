// tests/specify-decomposition-collapse.test.js
// Pins the "collapse decision" rules added to /specify's decomposition mode
// (record #1263): a decomposition yielding 1 work unit always collapses (no
// parent), 2 units keep a parent only when dependency-ordered, 3+ units never
// collapse, and every downstream reference to "the parent" (record-creation.md,
// SKILL.md) is conditional on that decision.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const DECOMPOSITION_MODE = 'plugin/skills/specify/decomposition-mode.md';
const DECOMPOSITION_CLOSEOUT = 'plugin/skills/specify/decomposition-mode-closeout.md';
const COLLAPSE_DECISION = 'plugin/skills/specify/collapse-decision.md';
const RECORD_CREATION = 'plugin/skills/specify/record-creation.md';
// #1346 split record-creation.md at the Step 3 Parent record/Sub-issues boundary and the
// Step 3/Step 4 boundary. Sub-issues content (Origin-set carve-out, the sub-issue `Parent:`
// line, Type derivation) landed in record-creation-subissues.md; Step 4 content (Related:
// cross-link format, Decision Rationale, Cross-Spec Promises) landed in
// record-creation-linking.md.
const RECORD_CREATION_SUBISSUES = 'plugin/skills/specify/record-creation-subissues.md';
const RECORD_CREATION_LINKING = 'plugin/skills/specify/record-creation-linking.md';
const SKILL = 'plugin/skills/specify/SKILL.md';

// --- decomposition-mode.md: the collapse step itself ---

test('collapse-decision.md states the 1-unit-always-collapses rule', () => {
  const text = read(COLLAPSE_DECISION);
  assert.match(text, /1 work unit.*always collapses/i);
});

test('collapse-decision.md states the 2-unit dependency-ordered branch (Blocked by / internal-conflict)', () => {
  const text = read(COLLAPSE_DECISION);
  assert.match(text, /Blocked by #N.*flag between the two units/i);
  assert.match(text, /internal-conflict row/i);
});

test('collapse-decision.md states the 2-unit independent-collapse branch', () => {
  const text = read(COLLAPSE_DECISION);
  assert.match(text, /independent.*collapses/i);
  // The two facts this branch exists to state — asserting the heading alone would
  // survive a rewrite that dropped either one.
  assert.match(text, /No parent is created; the two units become two ordinary ready records/);
  assert.match(text, /cross-linked via a `\*\*Related:\*\* #N` body line/);
});

test('collapse-decision.md states ambiguity keeps the parent', () => {
  const text = read(COLLAPSE_DECISION);
  assert.match(text, /[Aa]mbiguous.*keep the parent/);
});

test('collapse-decision.md names the strangler-fig early-production shape as parent-keeping', () => {
  const text = read(COLLAPSE_DECISION);
  assert.match(text, /early-production.*always parent-keeping/i);
});

test('collapse-decision.md states 3+ units never collapse', () => {
  const text = read(COLLAPSE_DECISION);
  assert.match(text, /3\+ work units.*never collapses/i);
});

test('the collapse-decision step cites Implicit Dependency Detection, not the ceiling-headroom flag, as its data source', () => {
  const text = read(COLLAPSE_DECISION);
  assert.match(text, /never read the adjacent Ceiling-headroom flag/);
});

// --- decomposition-mode.md: Step 9 origin-closure + summary ---

test('decomposition-mode-closeout.md Step 9 covers all three origin-closure branches', () => {
  const text = read(DECOMPOSITION_CLOSEOUT);
  assert.match(text, /Parent kept, or 2-unit collapse/);
  assert.match(text, /1-unit collapse.*[Ss]hape the origin record in place/s);
});

test('Step 9 summary template names the collapse outcome', () => {
  const text = read(DECOMPOSITION_CLOSEOUT);
  assert.match(text, /Collapse outcome:/);
});

// --- the retired "exactly one parent every run" premise ---

test('the "exactly one parent" premise sentence is gone from every specify file', () => {
  for (const rel of [DECOMPOSITION_MODE, DECOMPOSITION_CLOSEOUT, COLLAPSE_DECISION, RECORD_CREATION, RECORD_CREATION_SUBISSUES, RECORD_CREATION_LINKING, SKILL]) {
    assert.doesNotMatch(read(rel), /exactly one parent/i, `${rel} still contains "exactly one parent"`);
  }
});

test('the spec\'s AC#2 phrase-absence check: "one parent per decomposition" is gone from record-creation.md', () => {
  // record-creation.md's original text was "One parent per decomposition run" — Task 3's
  // fix rewrote the sentence rather than merely qualifying it in place. Spec 1263's AC#2
  // requires `grep -in "one parent per decomposition" plugin/skills/specify/record-creation.md`
  // to return zero matches; this is the literal phrase that grep checks, not the brief's
  // drafted `/exactly one parent/i` pattern (which never matched record-creation.md's actual
  // wording in the first place).
  assert.doesNotMatch(read(RECORD_CREATION), /one parent per decomposition/i);
  assert.doesNotMatch(read(RECORD_CREATION_SUBISSUES), /one parent per decomposition/i);
  assert.doesNotMatch(read(RECORD_CREATION_LINKING), /one parent per decomposition/i);
});

// --- record-creation.md: conditional Parent record section ---

test('record-creation.md\'s Parent record section is conditional on the collapse decision', () => {
  const text = read(RECORD_CREATION);
  assert.match(text, /[Ss]kip this whole section entirely when Step 2\.6/);
});

test('record-creation-subissues.md\'s sub-issue Parent: line is conditional', () => {
  const text = read(RECORD_CREATION_SUBISSUES);
  assert.match(text, /only when Step 2\.6 kept the parent, also prefix `Parent: #\$PARENT_NUM`/);
});

test('record-creation-linking.md defines the uniform Related: cross-link format for independent 2-unit collapse', () => {
  const text = read(RECORD_CREATION_LINKING);
  // The repo-canonical form is BOLDED (`capture/SKILL.md`'s body template,
  // `/backlog refine`'s in-place replace) — an unbolded line would fork the
  // convention and make refine append a competing second Related line.
  assert.match(text, /\*\*Related:\*\* #N/);
  assert.match(text, /\*\*Related:\*\* \{id\}/);
  assert.doesNotMatch(text, /`Related: (?:#N|\{id\})`/, 'the unbolded `Related:` form must not survive');
});

test('the Related: cross-link is written as a post-create edit in Step 4, not before the create call', () => {
  // Finding 1: each line names the other record's number, which does not exist
  // until that record is created — a pre-create append is unexecutable.
  const text = read(RECORD_CREATION_LINKING);
  assert.match(text, /post-create edit inside this Step 4 pass/);
  assert.doesNotMatch(text, /before its create call/, 'the impossible pre-create instruction must be gone');
});

test('record-creation.md states no parent fingerprint is minted under collapse', () => {
  const text = read(RECORD_CREATION);
  assert.match(text, /no `\{design-doc-slug\}:parent` fingerprint is ever minted/);
});

// --- SKILL.md ---

test('SKILL.md states --granularity never overrides collapse', () => {
  const text = read(SKILL);
  assert.match(text, /never overrides the collapse decision/);
});

test('the parent-record guard in SKILL.md is untouched by this change', () => {
  // Global Constraint 1 protects the guard's BEHAVIOUR, not its heading — pin
  // load-bearing sentences from the guard's own body, so a rewrite of the two-tier
  // detection or the tier-1 hard stop goes red here.
  const text = read(SKILL);
  assert.match(text, /Parent-record guard \(before the `needs:definition` check\)/);
  assert.match(text, /the two markers are driver-exclusive, so exactly one can ever be present on a record/);
  assert.match(text, /On a \*\*tier-1 match\*\*: hard stop, no prompt — never shape/);
  assert.match(text, /\^## Leaves/, 'the tier-2 legacy sniff must stay line-anchored');
});

// --- AC4 gap: origin-closure wording ---

test('decomposition-mode-closeout.md Step 9 contains the literal "Superseded by decomposition:" closure wording', () => {
  const text = read(DECOMPOSITION_CLOSEOUT);
  assert.match(text, /Superseded by decomposition:/);
});

// --- AC1 gap: collapse step reading-order position ---

test('Step 2.6 Collapse Decision appears between Implicit Dependency Detection and Step 2.5 in reading order', () => {
  const text = read(DECOMPOSITION_MODE);
  const idxImplicitDependency = text.indexOf('### Implicit Dependency Detection');
  const idxStep26 = text.indexOf('## Step 2.6: Collapse Decision');
  const idxStep25 = text.indexOf('## Step 2.5: Design Pre-Steps');

  assert.ok(idxImplicitDependency >= 0, 'Implicit Dependency Detection heading not found');
  assert.ok(idxStep26 >= 0, 'Step 2.6: Collapse Decision heading not found');
  assert.ok(idxStep25 >= 0, 'Step 2.5: Design Pre-Steps heading not found');

  assert.ok(idxStep26 > idxImplicitDependency, 'Step 2.6 should come after Implicit Dependency Detection');
  assert.ok(idxStep25 > idxStep26, 'Step 2.5 should come after Step 2.6 (backwards numbering in reading order)');
});

// --- the conditional "parent-first" sentences (Tasks 2-3's core deliverable) ---

test('both files state parent-first ordering conditionally on the collapse decision', () => {
  // Step 3 ("Create the records") moved from decomposition-mode.md to
  // decomposition-mode-closeout.md as part of #832's interactive/mechanical
  // split — this sentence is Step 3's own opening line, so it moved with it.
  const dc = read(DECOMPOSITION_CLOSEOUT);
  const rc = read(RECORD_CREATION);
  assert.match(dc, /When Step 2\.6 kept the parent, records are created \*\*parent-first\*\*/);
  assert.match(dc, /Under collapse \(Step 2\.6\), there is no parent — every produced record is created independently/);
  assert.match(rc, /When `decomposition-mode\.md`'s Step 2\.6 kept the parent, records are created \*\*parent-first\*\*/);
  assert.match(rc, /Under collapse, there is no parent — every produced record is created independently/);
});

// --- the 1-unit origin-set write point (finding 2: the write lands at Step 3) ---

test('record-creation-subissues.md carries the origin-set carve-out: a 1-unit collapse shapes the origin in place instead of creating', () => {
  const text = read(RECORD_CREATION_SUBISSUES);
  assert.match(text, /\*\*Origin-set carve-out \(1-unit collapse\)\.\*\*/);
  assert.match(text, /that unit gets \*\*no fresh create\*\*/);
  assert.match(text, /Treat `\$ORIGIN_RECORD_NUM` as this unit's `\$SUB_ISSUE_NUM`\/`\$SUB_ISSUE_ID`/);
  assert.match(text, /With `\$ORIGIN_RECORD_NUM` unset \(every other entry path\), a 1-unit collapse creates one fresh standalone ready record/);
});

test('decomposition-mode-closeout.md Step 9\'s 1-unit branch only skips the closure — the write already happened at Step 3', () => {
  const text = read(DECOMPOSITION_CLOSEOUT);
  assert.match(text, /\*\*this step closes nothing\*\*/);
  assert.match(text, /Step 3 already ran its origin-set carve-out to shape the origin record in place/);
});

// --- Type derivation with no parent (finding 3) ---

test('record-creation-subissues.md\'s Type derivation has a no-parent branch', () => {
  const text = read(RECORD_CREATION_SUBISSUES);
  assert.match(text, /Under collapse there is no parent to match: derive the type from the unit itself/);
  assert.match(text, /keep the origin record's existing type/);
});

// --- Cross-Spec Promises is unreachable under collapse (spec Deliverable 3) ---

test('record-creation-linking.md notes Cross-Spec Promises is unreachable under collapse by arithmetic', () => {
  const text = read(RECORD_CREATION_LINKING);
  assert.match(text, /unreachable under collapse by arithmetic/);
  assert.match(text, /collapses at most 2 units and this threshold is 4/);
});

// --- resume-stability of the collapse verdict (Global Constraint 6) ---

test('Step 2.6 defines its unit set as this run\'s Step 2 list, resume-stable and phase-scoped', () => {
  const text = read(COLLAPSE_DECISION);
  assert.match(text, /unit set counted here is Step 2's own design-doc-derived work-unit list for this run/);
  assert.match(text, /per `phase-N` scope when the run is phase-scoped/);
  assert.match(text, /never double-counted as both a work unit and an open record/);
});

// --- review-driven fixes from the per-task rounds, previously unpinned ---

test('the Actions Performed template has a row for every collapse outcome, including both 1-unit paths', () => {
  const text = read(DECOMPOSITION_CLOSEOUT);
  assert.match(text, /\{1-unit collapse, `\$ORIGIN_RECORD_NUM` set: "Shaped origin record \{ref\} in place \(no new record created\)"\}/);
  assert.match(text, /\{1-unit collapse, `\$ORIGIN_RECORD_NUM` unset: "Created 1 standalone ready record \(no parent\) — \{ref\}"\}/);
  assert.match(text, /\{2-unit collapse: "Created 2 independent records \(no parent\)/);
});

test('record-creation-linking.md\'s Decision Rationale has a no-parent fallback', () => {
  const text = read(RECORD_CREATION_LINKING);
  assert.match(text, /Under collapse, no parent exists to hold it: fold it into each produced record's own body/);
});

// --- review-gate findings (independent /review pass on the finished branch) ---

test('the origin-set carve-out preserves the origin body as `## Original request`', () => {
  // The carve-out replaces the origin record's whole body with a sub-issue-shaped
  // one. Shaping mode treats `## Original request` as the record's ground truth and
  // verifies it on read-back; without this clause the 1-unit collapse is the ONE
  // /specify path that destroys the human's original ask — and Step 7 then deletes
  // the design doc, so nothing else retains it.
  const text = read(RECORD_CREATION_SUBISSUES);
  assert.match(text, /This write replaces the origin's own body, so preserve that body as a `## Original request` block/);
  // The Framing bullet's blanket "sub-issues have no Original request block" claim
  // must not contradict the carve-out it now shares a file with.
  assert.doesNotMatch(text, /Sub-issues have no `## Original request` block/);
});

test('spec-template.md\'s canonical `Parent:` field reference is conditional on a kept parent', () => {
  // record-creation.md names spec-template.md as the canonical field reference, so
  // leaving this copy unconditional would have an agent composing a `Parent:` line
  // onto a record that has no parent.
  const text = read('plugin/skills/specify/spec-template.md');
  assert.match(text, /\*\*and only when that decomposition kept a parent\*\*/);
  assert.match(text, /only when Step 2\.6 kept a parent; omitted otherwise \(a collapsed decomposition/);
});

// --- byte ceiling ---

// Per-file 40 KB pin on the seven specify files (DECOMPOSITION_MODE,
// DECOMPOSITION_CLOSEOUT, COLLAPSE_DECISION, RECORD_CREATION,
// RECORD_CREATION_SUBISSUES, RECORD_CREATION_LINKING, SKILL) retired by
// #1997 — the per-file tier is a warning since #1990 and these files have no
// compose call site; removal condition in docs/incident-log.md [IL-153].
