// bin/lib/design-session/status.js — which step a /claude-tweaks:design
// session resumes at, read from its folder's files alone.
'use strict';

const fs = require('fs');
const path = require('path');
const { checkEvidence } = require('./evidence');
const { MAX_ROUNDS, STATUS_RE, checkNotes, parseNotes, splitLines } = require('./notes');

// design.md section headings by step number (steps 2-7; step 1 is evidence.md).
const SECTIONS = { 2: 'Frame', 3: 'Storyboard', 4: 'Perspectives', 5: 'Approaches', 6: 'Pre-mortem', 7: 'Builder check' };
const NOTES_FILE_RE = /^notes-round-(\d+)\.md$/;

// Lines of the `## {heading}` section, heading excluded, up to the next `## `
// line outside a fence; null when the heading is absent.
function sectionLines(designText, heading) {
  const lines = splitLines(designText);
  let fenced = false;
  let body = null;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const h2 = !fenced && /^##\s/.test(line);
    if (body) {
      if (h2) break;
      body.push(line);
    } else if (h2 && line.replace(/^##\s+/, '').trim() === heading) {
      body = [];
    }
  }
  return body;
}

// 'done' | 'partial' (in-progress, or no status line) | 'missing'.
function sectionStatus(designText, heading) {
  const body = sectionLines(designText, heading);
  if (!body) return 'missing';
  const first = body.find((l) => l.trim());
  const m = first && STATUS_RE.exec(first);
  return m && m[1].toLowerCase() === 'done' ? 'done' : 'partial';
}

// First `{key}: value` line in the section, trimmed; null when absent.
function sectionField(designText, heading, key) {
  const re = new RegExp(`^\\s*${key}:\\s*(.*?)\\s*$`, 'i');
  for (const line of sectionLines(designText, heading) || []) {
    const m = re.exec(line);
    if (m) return m[1];
  }
  return null;
}

function readOrNull(file, fsImpl) {
  try {
    return fsImpl.readFileSync(file, 'utf8');
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
    return null;
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

// -> { steps: {1..7}, resumeAt: 1..7|'complete', round, action, openSerious }
function readStatus(folder, fsImpl = fs) {
  const steps = {};

  const evidence = readOrNull(path.join(folder, 'evidence.md'), fsImpl);
  if (evidence === null) steps[1] = 'missing';
  else {
    const e = checkEvidence(evidence);
    steps[1] = e.done && e.unsourced.length === 0 ? 'done' : 'partial';
  }

  const designText = readOrNull(path.join(folder, 'design.md'), fsImpl);
  for (const n of [2, 3, 4, 5, 6, 7]) {
    steps[n] = designText === null ? 'missing' : sectionStatus(designText, SECTIONS[n]);
  }

  // Step 3 also needs the storyboard file it names, a plain name in the folder.
  if (steps[3] === 'done') {
    const file = sectionField(designText, 'Storyboard', 'File');
    const present = file && path.basename(file) === file
      && readOrNull(path.join(folder, file), fsImpl) !== null;
    if (!present) steps[3] = 'partial';
  }

  const first = [1, 2, 3, 4, 5, 6, 7].find((n) => steps[n] !== 'done');
  if (first === undefined) return { steps, resumeAt: 'complete', round: null, action: null, openSerious: [] };
  if (first > 4 || first < 3 || steps[4] === 'done') return { steps, ...plain(first, steps[first]) };

  // The 3<->4 loop. R = highest notes round within the cap; a file past the
  // cap is never a round to resume.
  const rounds = listOrEmpty(folder, fsImpl)
    .map((name) => NOTES_FILE_RE.exec(name))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .filter((n) => n >= 1 && n <= MAX_ROUNDS);
  const R = rounds.length ? Math.max(...rounds) : 0;

  if (R === 0) {
    if (steps[3] !== 'done') return { steps, ...plain(3, steps[3]), round: 1 };
    return { steps, resumeAt: 4, round: 1, action: 'start-round', openSerious: [] };
  }

  const notesText = readOrNull(path.join(folder, `notes-round-${R}.md`), fsImpl) || '';
  const check = checkNotes(notesText);
  if (!check.ok || !parseNotes(notesText).done) {
    return { steps, resumeAt: 4, round: R, action: 'finish-round', openSerious: [] };
  }
  if (check.serious.length === 0) {
    return { steps, resumeAt: 4, round: R, action: 'close-perspectives', openSerious: [] };
  }
  if (R >= MAX_ROUNDS) {
    return { steps, resumeAt: 4, round: MAX_ROUNDS, action: 'cap-reached', openSerious: check.serious };
  }
  const boardRound = Number(sectionField(designText, 'Storyboard', 'Round'));
  if (steps[3] === 'done' && Number.isInteger(boardRound) && boardRound > R) {
    return { steps, resumeAt: 4, round: R + 1, action: 'start-round', openSerious: [] };
  }
  return { steps, resumeAt: 3, round: R + 1, action: 'revise-storyboard', openSerious: [] };
}

module.exports = { sectionStatus, readStatus };
