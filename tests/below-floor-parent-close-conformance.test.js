// tests/below-floor-parent-close-conformance.test.js
//
// Conformance for #4466: a decomposition parent whose last sub-issue closes below the oversight
// floor is closed by the pipeline with a closing comment. The prose in plugin/skills/ is the
// contract (an agent runs these fences), so the live files are read.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(__dirname, '..', 'plugin', 'skills');

function read(rel) {
  return readText(path.join(SKILLS_DIR, rel));
}

// The text from `startHeading` up to (not including) `endHeading`, or to the end of the text when
// `endHeading` is null. Throws when either anchor is missing so a renamed heading is a loud
// failure rather than an empty slice that every assertion silently runs over.
function section(text, startHeading, endHeading) {
  const start = text.indexOf(startHeading);
  assert.ok(start !== -1, `heading not found: ${startHeading}`);
  if (endHeading === null) return text.slice(start);
  const end = text.indexOf(endHeading, start + startHeading.length);
  assert.ok(end !== -1, `end heading not found after "${startHeading}": ${endHeading}`);
  return text.slice(start, end);
}

test('AC4.1: both acceptance-gap scans pass isParent to needsBackstop', () => {
  const gapScope = section(
    read('_shared/github-pr-scan-acceptance.md'),
    '## Scope: `acceptance-gap`',
    '## Scope: `parent-gate`',
  );
  assert.match(gapScope, /isParent: parseRecordFacets\(r\.labels\)\.isParentIssue,/);

  const shape8 = section(
    read('tidy/step-1-records.md'),
    '### Shape 8 — closed record with no acceptance disposition',
    'Each line is `{path}<TAB>{finding}`, the same shape Shape 7 emits',
  );
  assert.match(shape8, /isParent: r\.facets\.isParentIssue === true,/);
});

// ---- Task 2: the Parent-Gate Procedure's below-floor close section ----

const GATE_REL = 'wrap-up/verification-brief-parent-gate.md';
const collapse = (s) => s.replace(/\s+/g, ' ');

// The paragraph opening with `opener`, up to the next blank line.
function paragraph(text, opener) {
  const start = text.indexOf(opener);
  assert.ok(start !== -1, `paragraph not found: ${opener}`);
  const end = text.indexOf('\n\n', start);
  return text.slice(start, end === -1 ? undefined : end);
}

// The local-files close-timing invariant, stated identically in the exceeds: false bullet and the
// close section, and the two false merge-mechanism claims it replaced.
const CLOSE_TIMING =
  "The parent is never closed ahead of the merge: on wrap-up's execution step the commit follows item 4's merge, and on the auto-merge short-circuit labeling and the commit happen on the run's branch before its merge.";
const FALSE_MERGE_CLAIMS = [
  'reaches the integration branch only with the merge commit',
  'never reaches the integration branch ahead of the merge',
];

const belowFloorBullet = (gate) => section(gate, '**`exceeds: false`**', '**`exceeds: true`**');
const entryShapes = (gate) => section(gate, '## Two entry shapes', '## What this path deliberately does not run');
const closeSection = (gate) => section(gate, '## Close the parent below the floor', '## Compose the parent brief');

test('AC2.2: the exceeds: false bullet routes the close by entry and never closes ahead of the merge', () => {
  const below = belowFloorBullet(read(GATE_REL));
  assert.ok(!collapse(below).includes('closes cleanly'), 'the unbacked "closes cleanly" claim is gone');
  assert.match(below, /no `demo:pending`, no brief/);
  assert.match(below, /Step 4\.0b/);
  assert.match(below, /\*\*Close the parent below the floor\*\*/);
  assert.match(below, /never closed ahead of the merge/);
  assert.match(below, /commit the parent record with the entry's own close commit/);
  assert.ok(collapse(below).includes(CLOSE_TIMING), 'per-path close-timing invariant');
  for (const claim of FALSE_MERGE_CLAIMS) assert.ok(!collapse(below).includes(claim), `false claim gone: ${claim}`);
  assert.match(below, /end-to-end variant/, 'the Try-it walkthrough sentence is kept');
  assert.match(below, /Parent-side entry/);
});

test('AC1.1: the close section composes the listing comment, then comments, then closes', () => {
  const close = closeSection(read(GATE_REL));
  assert.ok(close.includes('## Closed below the oversight floor'), 'marker heading');
  assert.ok(close.includes('closed by PR #{pr}'), 'listing line suffix');
  assert.match(close, /Never[^.]*merge SHA/);
  const comment = close.indexOf('gh issue comment $PARENT_NUM --body-file');
  const shut = close.indexOf('gh issue close $PARENT_NUM --reason completed');
  assert.ok(comment !== -1 && shut > comment, `comment (${comment}) before close (${shut})`);
  const write = close.indexOf('writeRecord(parentPath');
  const closeRec = close.indexOf('closeRecord(parentPath)');
  assert.ok(write !== -1 && closeRec > write, `writeRecord (${write}) before closeRecord (${closeRec})`);
  assert.match(close, /which call failed/);
  assert.match(close, /the entry's own close commit/);
  assert.ok(collapse(close).includes(CLOSE_TIMING), 'per-path close-timing invariant');
  for (const claim of FALSE_MERGE_CLAIMS) assert.ok(!collapse(close).includes(claim), `false claim gone: ${claim}`);
  assert.ok(
    collapse(close).includes(
      'When the entry has no later commit before its merge (the auto-merge short-circuit), commit the parent record file itself before the merge, with a `{Verb} … — refs #{parent}` subject.',
    ),
    'the short-circuit commits the parent record itself',
  );
  assert.ok(!collapse(close).includes("item 5's commit"), 'no claim of sharing cleanup item 5\'s commit');
  assert.ok(
    collapse(close).includes('A pre-merge sub-issue-side entry under `github-issues` never runs this section.'),
    'the opener states the pre-merge exclusion',
  );
  assert.match(close, /uses `\$MERGING_PR` instead/);
  assert.match(close, /arbitrary but deterministic/);
});

test('AC5.1: the close section is idempotent on a closed parent and a trusted heading comment', () => {
  const close = closeSection(read(GATE_REL));
  assert.match(close, /already `CLOSED`/);
  assert.match(close, /Trusted authors/);
});

test('AC2.2: the entry shapes name Step 4.0b as the post-merge sub-issue-side entry', () => {
  const gate = read(GATE_REL);
  const shapes = entryShapes(gate);
  assert.ok(shapes.includes('Step 4.0b'));
  assert.ok(!collapse(shapes).includes('the four sub-issue callers'));
  assert.ok(
    collapse(shapes).includes('Step 4.0b also passes `$MERGING_PR` — the merged PR\'s number, empty on a no-PR local merge'),
    'Step 4.0b declares its merging-PR input',
  );
  assert.ok(paragraph(gate, '**Return to the Try it post').includes('Step 4.0b'), 'Return-to-Try-it exempts Step 4.0b');
  assert.ok(paragraph(gate, '**Fail open on every `gh` call').includes('Step 4.0b'), 'Fail open exempts Step 4.0b');
  const table = section(gate, '| Sub-issue-side caller |', 'The two wrap-up entries close exactly one record');
  assert.ok(table.includes('Step 4.0b'), 'Self-inclusion table row');
  const routing = section(read('wrap-up/verification-brief.md'), '## Routing', '## Try it block');
  assert.ok(routing.includes('Six call sites exist today'));
  assert.ok(routing.includes('Step 4.0b'));
});

test('AC2.2: no resolvable parent is a no-op for the post-merge Step 4.0b entry on both no-parent branches', () => {
  const NO_OP = 'Step 4.0b\'s post-merge entry, for which no resolvable parent is a no-op: no labeling, no Try it.';
  const gateNoParent = collapse(paragraph(read(GATE_REL), '**No parent resolvable**'));
  assert.ok(gateNoParent.includes(NO_OP), 'Resolve the parent\'s no-parent branch');
  const routingOtherwise = collapse(paragraph(read('wrap-up/verification-brief.md'), '**Otherwise — no resolvable parent**'));
  assert.ok(routingOtherwise.includes(NO_OP), 'Routing\'s Otherwise branch');
});

test('AC1.1: /demo no longer claims to be the only closer of a parent', () => {
  const demo = read('demo/SKILL.md');
  assert.ok(!collapse(demo).includes('nothing else in the system ever closes a parent'));
  assert.match(demo, /Close the parent below the floor/);
});

// Go-red control: the pre-change gate file carries both literals the absence assertions above
// reject, so those assertions can fail. Guarded so an unreachable commit skips only this test.
const PRE_CHANGE_SHA = '1ab4e17d9';
let preChangeGate = null;
let goRedSkip = false;
try {
  preChangeGate = execFileSync('git', ['show', `${PRE_CHANGE_SHA}:plugin/skills/${GATE_REL}`], {
    cwd: ROOT,
    encoding: 'utf8',
  }).replace(/\r\n/g, '\n');
} catch (err) {
  goRedSkip = `commit ${PRE_CHANGE_SHA} is not reachable in this checkout's git history — the go-red control needs full history: ${String(err.message).split('\n')[0]}`;
}

test('go-red control: the pre-change gate says "closes cleanly" and counts four callers', { skip: goRedSkip }, () => {
  assert.ok(collapse(belowFloorBullet(preChangeGate)).includes('closes cleanly'));
  assert.ok(collapse(entryShapes(preChangeGate)).includes('the four sub-issue callers'));
});
