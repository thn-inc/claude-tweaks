'use strict';
// #5153 AC8 — close-out and the resume rule read the ready run. Pins (1) the close-out step-3
// ordering Mark ready -> CI re-read -> confirmation gate, (2) the ready-run read named at every
// other CI-after-undraft read site, (3) the journey's three reads. Live prose is the declared
// contract here: these pins ARE the contract for #5153's prose.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { sectionOf } = require('./helpers/conformance-asserts');

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

test('the post-Mark-ready re-read names the ready-run read and stops on pending', () => {
  const para = reReadParagraph();
  assert.match(para, /ready-run read/);
  assert.match(para, /step 1's stop rules/);
  assert.match(para, /\bpending\b[^.]*stops the candidate/);
  assert.match(para, /rollup/);
  assert.match(para, /head-run read/);
  // go-red: each claim is lost when its phrase is removed from the paragraph.
  for (const pattern of [/ready-run read/, /step 1's stop rules/, /stops the candidate/]) {
    assert.doesNotMatch(para.replace(pattern, ''), pattern);
  }
});

test('close-out step 1 and resume-confirmation name bin/ready-run.js; the appendix resume rule names the ready-run read and keeps its pinned clause', () => {
  const step1 = CLOSE_OUT.slice(CLOSE_OUT.indexOf('1. **Re-verify CI is currently green'), CLOSE_OUT.indexOf('2. **Re-check mergeability'));
  assert.ok(step1.length > 0, 'step 1 slice resolves');
  const s1 = step1.replace(/\s+/g, ' ');
  assert.match(s1, /ready-run read \(`bin\/ready-run\.js`/);
  assert.match(s1, /`awaiting` reads `pending`/);
  assert.match(s1, /`red` or `draft-skip-without-ready-trigger` reads `failing`/);
  assert.match(s1, /`read-failed`[^)]*`stopped: CI unreadable`/);
  // Fail closed: a failed call or output with no state is unreadable, never "no requirement".
  assert.match(s1, /non-zero exit or output with no `state`[^)]*`stopped: CI unreadable`/);

  const resume = RESUME.replace(/\s+/g, ' ');
  assert.match(resume, /ready-run read, `bin\/ready-run\.js`/);
  assert.match(resume, /`awaiting` reads `pending`, `red` or `draft-skip-without-ready-trigger` reads `failing`/);
  assert.match(resume, /`read-failed`[^.;]*unavailable/);
  assert.match(resume, /non-zero exit or output with no `state`[^.;]*unavailable/);

  const rule = sectionOf(APPENDIX, '## Resume-to-merge').replace(/\s+/g, ' ');
  assert.match(rule, /the state read, the head-run `gh run list` read and the ready-run read/);
  assert.match(rule, /not-yet-completed head run reads pending/);
  assert.match(rule, /an `awaiting` ready run pending, `draft-skip-without-ready-trigger` red/);

  // go-red: each pin fails once its phrase is stripped.
  assert.doesNotMatch(s1.replace('`bin/ready-run.js`', ''), /ready-run read \(`bin\/ready-run\.js`/);
  assert.doesNotMatch(rule.replace('and the ready-run read', ''), /and the ready-run read/);
  assert.doesNotMatch(resume.replace('`bin/ready-run.js`', ''), /ready-run read, `bin\/ready-run\.js`/);
});

test('the recover-a-ci-parked-run journey names three reads and quotes the park comment with {resume}', () => {
  const j = JOURNEY.replace(/\s+/g, ' ');
  assert.match(j, /"Green" means Step 2\.5's three reads agree/);
  assert.doesNotMatch(j, /both of Step 2\.5's reads/);
  assert.match(j, /ready-run read/);
  assert.match(j, /on PR #\{n\}\. \{resume\}`/);
  assert.doesNotMatch(j, /on PR #\{n\}\. Resume once green\.`/);
  assert.doesNotMatch(j.replace('three reads', ''), /Step 2\.5's three reads agree/);
});
