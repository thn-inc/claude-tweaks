// tests/capture-absorb-default.test.js
// Pins the "absorb-by-default" rules added to /capture's Immediate Routing
// (record #1264): absorb recommended as option 1 at high similarity, the
// two-criteria high-similarity definition, the multi-candidate tie-break,
// the headless structural bar and its fail-toward-filing default, bare-auto
// precedence, never-lower-size / never-write-priority, the three absorb
// exclusions, the 55,000-char body-vs-comment threshold, the AUTO log line,
// the `## Absorbed:` heading format, and the byte ceiling.
//
// #1295 split the absorb mechanics out of SKILL.md into routing.md (byte-
// ceiling relief) and completed the local-files driver mapping + the
// Immediate Routing / Workflow Step 1 ordering-prose alignment — most of the
// pins below now read routing.md instead of SKILL.md (path updates only, no
// assertion weakened); the two exceptions (the auto-mode-contract row test
// and the byte-ceiling test) still read their original targets unchanged.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const CAPTURE = 'plugin/skills/capture/SKILL.md';
const ROUTING = 'plugin/skills/capture/routing.md';

// --- recommended-ordering rule (Deliverable 2 / AC1) ---

test('capture/routing.md recommends absorb as Option 1 at high similarity', () => {
  const text = read(ROUTING);
  assert.match(
    text,
    /\*\*High similarity\*\* \(two-criteria bar below, met by one candidate\): absorb is \*\*Option 1\*\* — `label`: `"Absorb into record \{N\} \(Recommended\)"`/
  );
});

// --- two-criteria high-similarity definition (Deliverable 1 / AC1) ---

test('capture/routing.md defines high similarity as two required criteria, including the literal "same kind of change"', () => {
  const text = read(ROUTING);
  assert.match(text, /\*\*\(a\) same file\/subsystem\*\*/);
  assert.match(text, /\*\*\(b\) same kind of change\*\*/);
  assert.match(text, /same kind of change/);
});

// The bar is a conjunction, not a disjunction. Pinned separately so an
// AND→OR rewrite ("either criterion holds") goes red here even though the
// two criterion literals above survive it untouched.
test('capture/routing.md requires BOTH criteria (AND, not OR)', () => {
  const text = read(ROUTING);
  assert.match(text, /\*\*High similarity\*\* means both criteria hold/);
  assert.doesNotMatch(text, /means either criterion holds/);
});

// --- multi-candidate tie-break (Deliverable 2 / AC1) ---

test('capture/routing.md tie-breaks multiple qualifying candidates by most-recently-updated', () => {
  const text = read(ROUTING);
  assert.match(
    text,
    /Several candidates meeting the bar: recommend the one sharing the most file paths, tie-broken by most-recently-updated/
  );
});

// --- headless structural bar + fail-toward-filing default (Deliverable 4 / AC2) ---

test('capture/routing.md states the headless structural bar (shared literal path + identical type, standing in for the operation-match)', () => {
  const text = read(ROUTING);
  assert.match(
    text,
    /absorb only if \(a\) is a literal path match and \(b\)'s `type:\{t\}` matches \(both below\) — standing in for \(b\)'s operation-match judgment/
  );
});

// Anchored on the sentence, not a phrase count: a count survives inverting
// the default ("absorbs anyway rather than files fresh"), which is the single
// most consequential safety rule here.
test('capture/routing.md states the headless fail-toward-filing default as "else files fresh with **Related:** #N"', () => {
  const text = read(ROUTING);
  assert.match(text, /; else files fresh with `\*\*Related:\*\* #N`/);
  assert.match(text, /files fresh with `\*\*Related:\*\* #N` for all three\./);
});

// The bar is judged before the record exists, so an absorbing capture never
// files and never enters the born-ready chain (spec Non-Goal 1).
test('capture/routing.md judges the headless bar at filing time, before creation and before the chain', () => {
  const text = read(ROUTING);
  assert.match(
    text,
    /\*\*Headless bar\*\* \(judged at filing time — before any record is created and before the born-ready chain fires; an absorbing capture never files or chains\)/
  );
});

// --- candidate lookup rides the session snapshot, never the search index ---

test('capture/routing.md matches absorb candidates against the session-scoped record snapshot, not `gh issue list --search`', () => {
  const text = read(ROUTING);
  assert.match(
    text,
    /match the keywords against the open records in the session-scoped record snapshot \(`_shared\/record-queue-fetch\.md`/
  );
  assert.doesNotMatch(text, /gh issue list --search/);
});

// --- bare-auto precedence (Task 4's fix) ---

test('capture/routing.md states bare auto keeps the keep default, absorbing only via explicit --route=absorb:N', () => {
  const text = read(ROUTING);
  assert.match(
    text,
    /Bare `auto` keeps the contract's `keep` default; it absorbs only via explicit front-loaded `--route=absorb:N`\./
  );
});

// The silences table is the single source of truth for auto-mode behavior
// (`_shared/auto-mode-contract.md`, "Per-skill `## Auto-mode behavior` tables
// are deprecated"). The headless bar narrows that file's Capture row's
// guarantee, so the row must name it — otherwise a skill following capture's
// own "apply the silences-table row for /capture" instruction reads a table
// that still says the auto default is unconditionally `keep`.
test('auto-mode-contract.md\'s Capture routing row names the headless absorb bar', () => {
  const row = read('plugin/skills/_shared/auto-mode-contract.md')
    .split('\n')
    .find((l) => l.startsWith('| Capture next-action routing |'));
  assert.ok(row, 'the Capture next-action routing row must exist in the silences table');
  assert.match(row, /headless absorb bar/);
  assert.match(row, /agent-driven filing/);
  assert.match(row, /defaults to `keep`/);
});

// --- never-lower size (raise-only) and never-write priority ---

test('capture/routing.md re-judges size as raise-only, never lower', () => {
  const text = read(ROUTING);
  assert.match(text, /Re-judges `size:` per `_shared\/work-record\.md` — raise only, never lower/);
});

test('capture/routing.md never writes priority, suggesting it in output instead', () => {
  const text = read(ROUTING);
  assert.match(text, /`priority:\*` stays unwritten, suggest higher priority in output/);
});

// --- the three exclusions as one enumerable list citing _shared/work-record.md ---

test('capture/routing.md lists all three absorb exclusions (closed, parent-issue, bot:in-progress) as one list citing _shared/work-record.md', () => {
  const text = read(ROUTING);
  assert.match(
    text,
    /Absorb never targets: \(1\) a closed record, \(2\) a `parent-issue` carrier, \(3\) a `bot:in-progress` carrier \(per `_shared\/work-record\.md`\)/
  );
});

test('capture/routing.md\'s "Unknown or invalid N" stop rule references the absorb exclusions', () => {
  const text = read(ROUTING);
  assert.match(text, /excluded per the absorb exclusions above/);
  assert.match(text, /Do not silently fall back to `keep`\./);
});

// --- the 55,000-char body-vs-comment threshold (and 65,536 cap) ---

test('capture/routing.md switches to a comment past 55,000 post-append chars, against the 65,536 cap', () => {
  const text = read(ROUTING);
  assert.match(text, /past 55,000 post-append chars \(vs 65,536 cap\), comment instead/);
});

// --- the exact AUTO log line ---

test('capture/routing.md logs the exact AUTO absorb line per _shared/auto-decision-log.md (reclassified high, #1296)', () => {
  const text = read(ROUTING);
  assert.match(
    text,
    /AUTO \{time\} — capture absorbed into #\{N\} \(shared path \+ same type\)\. Reversibility: high \(a delimited Absorbed-heading append; deleting that section restores #\{N\}'s prior body exactly\)\./
  );
});

// --- the ## Absorbed: heading format ---

test('capture/routing.md appends under the exact "## Absorbed: {YYYY-MM-DD} — {captured title}" heading', () => {
  const text = read(ROUTING);
  assert.match(text, /## Absorbed: \{YYYY-MM-DD\} — \{captured title\}/);
});

// --- byte ceiling ---

// Per-file 40 KB pin on capture/SKILL.md (raw ceiling and the 4 KB-margin
// headroom variant below) retired by #1997 — the per-file tier is a warning
// since #1990 and this file has no compose call site; removal condition in
// docs/incident-log.md [IL-153].

// --- #1295: local-files driver mapping (Deliverables 1 + 2) ---

test('#1295: no capture/** file still scopes the recommended-absorb ordering to github-issues only', () => {
  for (const rel of [CAPTURE, ROUTING]) {
    assert.doesNotMatch(read(rel), /github-issues`\s*only/i, rel);
  }
});

test('#1295: routing.md maps the headless bar\'s criterion (b) to facets.type under local-files', () => {
  const text = read(ROUTING);
  assert.match(
    text,
    /`local-files` reads the candidate's `facets\.type` field \(same `TYPE_LABELS` vocabulary, `bin\/lib\/issues\/record\.js`\)/
  );
});

test('#1295: routing.md maps the three absorb exclusions to local-files facets (closed, isParentIssue) and states bot:in-progress is vacuous there', () => {
  const text = read(ROUTING);
  assert.match(text, /`local-files` reads \(1\) via the candidate's `facets\.closed` field and \(2\) via `facets\.isParentIssue`/);
  assert.match(text, /`local-files` carries no claim mechanism at all/);
  assert.match(text, /exclusion \(3\) is vacuously satisfied on that driver/);
});

test('#1295: routing.md ties the local-files recency tie-break to the record file\'s last-commit date via record-queue-fetch.md\'s Staleness clock, not raw mtime', () => {
  const text = read(ROUTING);
  assert.match(
    text,
    /the record file's last-commit date under `local-files` — `git log -1 --format=%cI -- \{path\}`, per `_shared\/record-queue-fetch\.md`'s Staleness clock section, not raw filesystem mtime/
  );
});

test('#1295: routing.md states the size:/priority absorb-mechanics rules and the ## Absorbed: heading apply on both drivers', () => {
  const text = read(ROUTING);
  assert.match(text, /\*\*Applies on both drivers:\*\* the `size:`-raise-only and unwritten-`priority` rules/);
});

// --- #1295: Immediate Routing / Workflow Step 1 ordering-prose alignment (Deliverable 3) ---

test('#1295: SKILL.md\'s Immediate Routing opener acknowledges the headless bar\'s filing-time pre-emption', () => {
  const text = read(CAPTURE);
  assert.match(
    text,
    /After adding the record, route the item per the `--route` arg or by asking — except when the headless bar pre-empts filing entirely/
  );
});

test('#1295: SKILL.md\'s Workflow Step 1 forward-points to the headless bar\'s pre-emption', () => {
  const text = read(CAPTURE);
  assert.match(
    text,
    /\*\*Pre-empted by the headless bar\*\* \(`routing\.md`'s Headless bar\): an agent-driven filing that qualifies to absorb never reaches this step at all/
  );
});

test('#1295: SKILL.md points to routing.md for the Immediate Routing procedure', () => {
  const text = read(CAPTURE);
  assert.match(text, /Read `routing\.md` in this skill's directory for the full procedure/);
});

// --- #1296: cross-contract sweep (reversibility, batch-mode precedence, work-types axis) ---

const BATCH_MODE = 'plugin/skills/capture/batch-mode.md';
const TIDY_STEP6_AUTO = 'plugin/skills/tidy/step-6-auto.md';

test('#1296: routing.md states the reclassification rationale from medium to high for the headless absorb append', () => {
  const text = read(ROUTING);
  assert.match(
    text,
    /\*\*Reclassified from `medium` \(#1296\):\*\* unlike an indistinguishable integration, this append is delimited under its own dated `## Absorbed:` heading/
  );
});

test('#1296: tidy/step-6-auto.md\'s github-issues Absorb row explains why capture\'s absorb rates high instead', () => {
  const text = read(TIDY_STEP6_AUTO);
  assert.match(
    text,
    /capture's absorb differs \(delimited append\) and rates `high`; see `capture\/routing\.md`/
  );
});

test('#1296: batch-mode.md states the headless absorb bar\'s precedence over the batch-level absorb:N restriction', () => {
  const text = read(BATCH_MODE);
  assert.match(text, /headless absorb bar/i);
  assert.match(
    text,
    /This batch-level restriction is about the \*batch-wide\* `--route=` arg only — it does not exempt batch filings from `routing\.md`'s per-entry headless bar/
  );
});

test('#1296: routing.md documents that work-types: none disables the headless bar\'s criterion (b)', () => {
  const text = read(ROUTING);
  assert.match(
    text,
    /\*\*`work-types: none` \(#1296\):\*\* criterion \(b\) has no `type:\{t\}`\/`facets\.type` to read on this config — the bar cannot evaluate it and never fires, so every agent-driven capture files fresh/
  );
});
