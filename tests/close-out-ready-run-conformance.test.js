'use strict';
// #5153 AC8 — close-out and the resume rule read the ready run. Pins (1) the close-out step-3
// ordering Mark ready -> CI re-read -> confirmation gate, (2) the ready-run read named at every
// other CI-after-undraft read site, (3) the journey's three reads, (4) the appendix's note that a
// post-ready run which verified nothing does not count, closing the draft-payload race. Live prose is the declared
// contract here: these pins ARE the contract for #5153's prose.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { sectionOf, missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');

const ROOT = path.join(__dirname, '..');
const CLOSE_OUT = readText(path.join(ROOT, 'plugin/skills/dispatch/close-out.md'));
const RESUME = readText(path.join(ROOT, 'plugin/skills/dispatch/resume-confirmation.md'));
const APPENDIX = readText(path.join(ROOT, 'plugin/skills/_shared/pr-first-merge-appendix.md'));
const JOURNEY = readText(path.join(ROOT, 'docs/journeys/recover-a-ci-parked-run.md'));

const STEP3 = '3. **Convert draft to ready';
const MARK_READY = "run `_shared/pr-first-merge.md`'s Step 2 (Mark ready) now";
const REREAD = '**Re-read CI after Mark ready.**';
const GATE = '4. **Confirmation gate.**';
const CHAIN = [STEP3, MARK_READY, REREAD, GATE];

// Asserts each marker exists (own message) and then that positions strictly increase.
function requireOrder(text, markers) {
  let last = -1;
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    assert.notEqual(idx, -1, `marker missing: ${marker}`);
    assert.ok(idx > last, `${marker} must come after the previous marker`);
    last = idx;
  }
}

// Splice the block starting at `later` (up to the next marker in `chain`, or `end`) above `earlier`.
function moveBefore(text, later, earlier, end) {
  const li = text.indexOf(later);
  const le = end === undefined ? text.length : text.indexOf(end, li);
  assert.ok(li !== -1 && le > li, 'permutation anchors must resolve');
  const block = text.slice(li, le);
  const without = text.slice(0, li) + text.slice(le);
  const ei = without.indexOf(earlier);
  assert.notEqual(ei, -1, 'permutation target must resolve');
  const permuted = without.slice(0, ei) + block + without.slice(ei);
  assert.notEqual(permuted, text, 'permutation must change the text');
  return permuted;
}

const reReadParagraph = () => {
  const paragraphs = CLOSE_OUT.split(/\n\s*\n/).filter((p) => p.includes(REREAD));
  assert.equal(paragraphs.length, 1, 'exactly one paragraph carries the re-read marker');
  return paragraphs[0].replace(/\s+/g, ' ');
};

test('AC8.1 AC8.2: close-out performs a CI read after its Mark-ready call and before the confirmation gate', () => {
  requireOrder(CLOSE_OUT, CHAIN);
});

test('AC8.1 AC8.2: the ordering pin goes red when adjacent blocks are permuted or the marker is deleted', () => {
  // Permutation: Mark-ready sentence block moved above the step-3 heading line.
  const markAboveStep = moveBefore(CLOSE_OUT, '   Then, when `isDraft`', STEP3, REREAD);
  assert.throws(() => requireOrder(markAboveStep, CHAIN), /must come after/);
  // Permutation: re-read paragraph above the Mark-ready sentence.
  const rereadAboveMark = moveBefore(CLOSE_OUT, `   ${REREAD}`, '   Then, when `isDraft`', GATE);
  assert.throws(() => requireOrder(rereadAboveMark, CHAIN), /must come after/);
  // Permutation: the confirmation gate above the re-read paragraph.
  const gateAboveReread = moveBefore(CLOSE_OUT, GATE, `   ${REREAD}`, '5. **On confirmation');
  assert.throws(() => requireOrder(gateAboveReread, CHAIN), /must come after/);
  // Deletion: the new marker removed.
  const absent = CLOSE_OUT.replace(REREAD, '');
  assert.notEqual(absent, CLOSE_OUT);
  assert.throws(() => requireOrder(absent, CHAIN), /marker missing/);
});

const collapse = (s) => s.replace(/\s+/g, ' ');

// One fact list per region. Each pattern matches exactly once in its slice and the patterns are
// disjoint, so stripping one reports exactly that fact (assertEachPatternGoesRed's contract).
const REREAD_FACTS = [
  [/the rollup, the head-run read and the ready-run read/, 'the re-read names all three reads'],
  [/with step 1's stop rules/, 'the re-read applies step 1 stop rules'],
  [/this read is `pending` and stops the candidate/, 'a post-undraft pending read stops the candidate'],
];
const STEP1_FACTS = [
  [/\(`bin\/ready-run\.js`: `awaiting` reads `pending`/, 'step 1 maps awaiting to pending'],
  [/`red` or `draft-skip-without-ready-trigger` reads `failing`/, 'step 1 maps red and draft-skip to failing'],
  [/`read-failed` — or a non-zero exit or output with no `state` — stops this candidate as `stopped: CI unreadable`/, 'step 1 fails closed on an unreadable ready-run read'],
  [/on a `DIRTY`\/`CONFLICTING` PR — step 2's read — `awaiting`, `draft-skip-without-ready-trigger` and/, 'step 1 applies the conflict-first rule'],
  // An empty rollup's `pending` on a conflicting PR falls through too: a conflicting PR gets no runs,
  // so stopping there would never reach step 2's update (Step 2.5's empty-rollup Conflict path).
  [/an empty rollup's `pending` do not stop here but fall through to step 2/, 'step 1 lets an empty rollup on a conflicting PR fall through'],
];
const CLOSE_OUT_FACTS = [
  [/`stopped: CI \{status\}`, `stopped: CI unreadable`, /, 'the Reporting list carries stopped: CI unreadable'],
];
const RESUME_FACTS = [
  [/ready-run read, `bin\/ready-run\.js` — `awaiting` reads `pending`/, 'resume names bin/ready-run.js'],
  [/`red` or `draft-skip-without-ready-trigger` reads `failing`/, 'resume maps red and draft-skip to failing'],
  [/`read-failed` \(or a non-zero exit or output with no `state`\) reads `unavailable`, never as no requirement/, 'resume fails closed'],
  [/on a `DIRTY`\/`CONFLICTING` PR `awaiting` and `draft-skip-without-ready-trigger` take Step 2\.5's conflict-first rule/, 'resume applies the conflict-first rule'],
  [/unavailable → the run stays parked/, 'resume parks on unavailable'],
];
const APPENDIX_FACTS = [
  [/the state read, the head-run `gh run list` read and the ready-run read/, 'appendix names the ready-run read'],
  [/not-yet-completed head run reads pending/, 'appendix keeps the pinned head-run clause'],
  [/an `awaiting` ready run pending, `draft-skip-without-ready-trigger` red/, 'appendix maps awaiting and draft-skip'],
  [/on a `DIRTY`\/`CONFLICTING` PR those two take Step 2\.5's conflict-first rule/, 'appendix applies the conflict-first rule'],
];
// The draft-payload race is closed by excluding unverified post-ready runs, and the cost is named.
const RATIONALE_FACTS = [
  [/\*\*A ready run that verified nothing \(#5153\)\.\*\*/, 'appendix records the ready-run-verified-nothing bullet'],
  [/A post-ready run that concluded `skipped`, `cancelled`, `action_required` or `stale` counts for nothing/, 'appendix names the four excluded conclusions'],
  [/a `synchronize` run created after `readySince` whose payload still says `draft: true`/, 'appendix names the race the exclusion closes'],
  [/a ready workflow whose post-ready runs all skip never gets a counted run, so the run parks with `checks-pending-timeout \(no run since ready: \{file\}\)`/, 'appendix names the park consequence'],
];
const JOURNEY_FACTS = [
  [/"Green" means Step 2\.5's three reads agree/, 'journey says three reads'],
  [/the ready-run read has no `awaiting` workflow/, 'journey names the ready-run condition'],
  [/on PR #\{n\}\. \{resume\}`/, 'journey quotes the park comment with {resume}'],
];

const step1Of = () => {
  const from = CLOSE_OUT.indexOf('1. **Re-verify CI is currently green');
  const to = CLOSE_OUT.indexOf('2. **Re-check mergeability');
  assert.ok(from !== -1 && to > from, 'step 1 slice resolves');
  return collapse(CLOSE_OUT.slice(from, to));
};

const REGIONS = [
  ['re-read paragraph', () => reReadParagraph(), REREAD_FACTS],
  ['close-out step 1', step1Of, STEP1_FACTS],
  ['close-out reporting list', () => collapse(CLOSE_OUT), CLOSE_OUT_FACTS],
  ['resume-confirmation', () => collapse(RESUME), RESUME_FACTS],
  ['appendix Resume-to-merge', () => collapse(sectionOf(APPENDIX, '## Resume-to-merge')), APPENDIX_FACTS],
  ['appendix Rationale notes', () => collapse(sectionOf(APPENDIX, '## Rationale notes')), RATIONALE_FACTS],
  ['journey', () => collapse(JOURNEY), JOURNEY_FACTS],
];

test('every ready-run mapping fact is present in its own region', () => {
  for (const [name, slice, facts] of REGIONS) {
    assert.deepEqual(missingFactsOf(facts)(slice()), [], `${name} lost a fact`);
  }
});

test('each mapping fact goes red alone: stripping only its phrase reports exactly that fact', () => {
  for (const [, slice, facts] of REGIONS) {
    assertEachPatternGoesRed(slice(), facts, missingFactsOf(facts));
  }
});

test('the journey no longer says both reads or quotes the retired park comment', () => {
  const j = collapse(JOURNEY);
  assert.doesNotMatch(j, /both of Step 2\.5's reads/);
  assert.doesNotMatch(j, /on PR #\{n\}\. Resume once green\.`/);
});
