// bin/lib/design-session/status.js — which step a /claude-tweaks:design
// session resumes at, read from its folder's files alone.
'use strict';

const fs = require('fs');
const path = require('path');
const { checkEvidence } = require('./evidence');
const { MAX_ROUNDS, STATUS_RE, roundSettled, lastNotesRound } = require('./notes');
const { sectionLines, sectionField } = require('./design-md');
const {
  parseParts, checkApproval, leftForRepository, sameRepository, PARTS_HEADING, APPROVAL_HEADING, FILING_HEADING,
} = require('./parts');

// design.md section headings by step number; step 1 is evidence.md. Adding a
// step is one row here: STEPS and the per-step loop below derive from it. Steps
// 8-10 also carry a content check, applied after the loop (like the storyboard file).
const SECTIONS = {
  2: 'Frame', 3: 'Storyboard', 4: 'Perspectives', 5: 'Approaches', 6: 'Pre-mortem', 7: 'Builder check',
  8: PARTS_HEADING, 9: APPROVAL_HEADING, 10: FILING_HEADING,
};
const EVIDENCE_STEP = 1;
const STEPS = [EVIDENCE_STEP, ...Object.keys(SECTIONS).map(Number)];
// The two steps of the storyboard <-> perspectives loop.
const STORYBOARD_STEP = 3;
const PERSPECTIVES_STEP = 4;
const PARTS_STEP = 8;
const APPROVAL_STEP = 9;
const FILING_STEP = 10;

// 'done' | 'partial' (in-progress, or no status line) | 'missing'.
function sectionStatus(designText, heading) {
  const body = sectionLines(designText, heading);
  if (!body) return 'missing';
  const first = body.find((l) => l.trim());
  const m = first && STATUS_RE.exec(first);
  return m && m[1].toLowerCase() === 'done' ? 'done' : 'partial';
}

// The file's text, or null when it is absent or not a regular file (a
// directory, a FIFO), the way brief.js's readLeaf never counts one as present.
// O_NONBLOCK keeps a FIFO with no writer from blocking the open; any other IO
// error throws.
function readOrNull(file, fsImpl) {
  const { O_RDONLY, O_NONBLOCK } = fsImpl.constants || fs.constants;
  let fd;
  try {
    fd = fsImpl.openSync(file, O_RDONLY | (O_NONBLOCK || 0));
  } catch (err) {
    const code = err && err.code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return null;
    throw err;
  }
  try {
    return fsImpl.fstatSync(fd).isFile() ? fsImpl.readFileSync(fd, 'utf8') : null;
  } finally {
    fsImpl.closeSync(fd);
  }
}

function listOrEmpty(dir, fsImpl) {
  try {
    return fsImpl.readdirSync(dir);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
    return [];
  }
}

function plain(step, state) {
  return { resumeAt: step, round: null, action: state === 'partial' ? 'continue' : 'start', openSerious: [] };
}

// -> { steps: {1..10}, resumeAt: 1..10|'complete', round, action, openSerious }
// `repository` is `() => 'owner/name' | null`, this checkout's repository. It is
// called at most once, and only when `## Filing` is done and a part is marked
// `left for …`: a part marked `left for` that repository is still to file here,
// so step 10 is not done. With no resolver, or one that returns null, every
// `left for …` mark counts as marked.
function readStatus(folder, fsImpl = fs, { repository } = {}) {
  const steps = {};

  const evidence = readOrNull(path.join(folder, 'evidence.md'), fsImpl);
  if (evidence === null) steps[EVIDENCE_STEP] = 'missing';
  else {
    const e = checkEvidence(evidence);
    steps[EVIDENCE_STEP] = e.done && e.unsourced.length === 0 ? 'done' : 'partial';
  }

  const designText = readOrNull(path.join(folder, 'design.md'), fsImpl);
  for (const n of STEPS.filter((s) => s !== EVIDENCE_STEP)) {
    steps[n] = designText === null ? 'missing' : sectionStatus(designText, SECTIONS[n]);
  }

  // The storyboard step also needs the file it names, a plain name in the folder.
  if (steps[STORYBOARD_STEP] === 'done') {
    const file = sectionField(designText, SECTIONS[STORYBOARD_STEP], 'File');
    const present = file && path.basename(file) === file
      && readOrNull(path.join(folder, file), fsImpl) !== null;
    if (!present) steps[STORYBOARD_STEP] = 'partial';
  }

  // Steps 8-10 count only when the table parses clean, the approval's digest
  // matches it, and every part carries an Issue mark (`left for …` counts,
  // unless it names this checkout's repository).
  let reapprove = false;
  if (designText !== null) {
    const parsed = parseParts(designText);
    if (steps[PARTS_STEP] === 'done' && (!parsed.present || parsed.errors.length)) steps[PARTS_STEP] = 'partial';
    if (steps[APPROVAL_STEP] === 'done' || steps[FILING_STEP] === 'done') {
      const verdict = checkApproval(designText);
      if (!verdict.approved) {
        reapprove = verdict.reason === 'digest-mismatch';
        if (steps[APPROVAL_STEP] === 'done') steps[APPROVAL_STEP] = 'partial';
      }
    }
    if (steps[FILING_STEP] === 'done' && (!parsed.parts.length || parsed.parts.some((p) => p.issue === null))) {
      steps[FILING_STEP] = 'partial';
    }
    const leftFor = parsed.parts.map((p) => p.issue && leftForRepository(p.issue)).filter(Boolean);
    if (steps[FILING_STEP] === 'done' && leftFor.length && typeof repository === 'function') {
      const here = repository();
      if (here && leftFor.some((r) => sameRepository(r, here))) steps[FILING_STEP] = 'partial';
    }
  }

  // R = highest notes round within the cap; a file past the cap is never a
  // round to resume.
  const R = lastNotesRound(listOrEmpty(folder, fsImpl));
  const notesText = R ? readOrNull(path.join(folder, `notes-round-${R}.md`), fsImpl) || '' : '';
  const check = roundSettled(notesText, R);
  const roundDone = R > 0 && check.settled;

  // A `done` Perspectives section counts only when the loop really closed:
  // the last round is complete and has no serious note, or the cap was reached.
  if (steps[PERSPECTIVES_STEP] === 'done' && !(roundDone && (check.serious.length === 0 || R >= MAX_ROUNDS))) {
    steps[PERSPECTIVES_STEP] = 'partial';
  }

  const first = STEPS.find((n) => steps[n] !== 'done');
  if (first === undefined) return { steps, resumeAt: 'complete', round: null, action: null, openSerious: [] };
  // An approval whose digest no longer matches the table is asked for again.
  if (first === APPROVAL_STEP && reapprove) {
    return { steps, resumeAt: APPROVAL_STEP, round: null, action: 'reapprove', openSerious: [] };
  }
  // Loop-exit guard: outside the storyboard/perspectives pair, or once Perspectives
  // is really closed, resume is a plain start/continue of the first open step.
  if (first > PERSPECTIVES_STEP || first < STORYBOARD_STEP || steps[PERSPECTIVES_STEP] === 'done') {
    return { steps, ...plain(first, steps[first]) };
  }

  // The storyboard <-> perspectives loop. Its action vocabulary is defined in
  // plugin/skills/design/step-4-perspectives.md (and step-3-storyboard.md); each
  // branch below returns one action, in this order:
  //   - no round yet: the storyboard step (start/continue) until it is done, then
  //     start-round 1;
  //   - finish-round: round R is not settled (an outcome pending, a perspective
  //     missing, a malformed entry, or its Status: not done);
  //   - close-perspectives: round R is settled with no serious note;
  //   - cap-reached: round R is the cap and still has serious notes (openSerious
  //     names them; a round past the cap is never started);
  //   - start-round R+1: the storyboard is done and its Round: is already past R,
  //     i.e. it was revised for the next round — so boardRound > R picks
  //     start-round over revise-storyboard;
  //   - revise-storyboard R+1: otherwise (a serious note, and the storyboard not
  //     yet revised past R, half-revised, or with no numeric Round:).
  if (R === 0) {
    if (steps[STORYBOARD_STEP] !== 'done') return { steps, ...plain(STORYBOARD_STEP, steps[STORYBOARD_STEP]), round: 1 };
    return { steps, resumeAt: PERSPECTIVES_STEP, round: 1, action: 'start-round', openSerious: [] };
  }

  if (!roundDone) {
    return { steps, resumeAt: PERSPECTIVES_STEP, round: R, action: 'finish-round', openSerious: [] };
  }
  if (check.serious.length === 0) {
    return { steps, resumeAt: PERSPECTIVES_STEP, round: R, action: 'close-perspectives', openSerious: [] };
  }
  if (R >= MAX_ROUNDS) {
    return { steps, resumeAt: PERSPECTIVES_STEP, round: MAX_ROUNDS, action: 'cap-reached', openSerious: check.serious };
  }
  const boardRound = Number(sectionField(designText, SECTIONS[STORYBOARD_STEP], 'Round'));
  if (steps[STORYBOARD_STEP] === 'done' && Number.isInteger(boardRound) && boardRound > R) {
    return { steps, resumeAt: PERSPECTIVES_STEP, round: R + 1, action: 'start-round', openSerious: [] };
  }
  return { steps, resumeAt: STORYBOARD_STEP, round: R + 1, action: 'revise-storyboard', openSerious: [] };
}

module.exports = { sectionStatus, readStatus };
