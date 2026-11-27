// bin/lib/design-session/brief.js — the text a /claude-tweaks:design reader is
// handed, composed from the session folder's files and the skill's
// reader-briefs.md blocks alone. Nothing else (evidence, decisions, the
// conversation) can reach a reader through this module.
'use strict';

const fs = require('fs');
const path = require('path');
const { MAX_ROUNDS, PERSPECTIVES, STATUS_RE, checkNotes, splitLines } = require('./notes');
const { sectionLines, sectionField } = require('./status');

const NOTES_FILE_RE = /^notes-round-(\d+)\.md$/;
const INLINE_EXT = new Set(['.md', '.txt', '.html']);
const PROCESS_READERS = ['pre-mortem', 'builder'];
const START_RE = /^<!-- brief:([a-z0-9-]+):start -->$/;
const END_RE = /^<!-- brief:([a-z0-9-]+):end -->$/;

// Name -> trimmed block text. Markers count only as a whole line, so the
// file's lead may mention the syntax inline. Throws on a start with no end,
// an end with no start, a nested start or a block named twice.
function readBlocks(briefsText) {
  const blocks = new Map();
  let open = null;
  let body = [];
  for (const line of splitLines(briefsText)) {
    const s = START_RE.exec(line);
    const e = END_RE.exec(line);
    if (s) {
      if (open) throw new Error(`brief block '${s[1]}' starts inside '${open}'`);
      if (blocks.has(s[1])) throw new Error(`brief block '${s[1]}' is defined twice`);
      open = s[1];
      body = [];
    } else if (e) {
      if (open !== e[1]) throw new Error(`brief block '${e[1]}' ends without its start`);
      blocks.set(open, body.join('\n').trim());
      open = null;
    } else if (open) {
      body.push(line);
    }
  }
  if (open) throw new Error(`brief block '${open}' has no end marker`);
  return blocks;
}

function readOrNull(file, fsImpl) {
  try {
    return fsImpl.readFileSync(file, 'utf8');
  } catch (err) {
    if (!err || (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')) throw err;
    return null;
  }
}

// design.md text without its `## Decisions` section (through the next
// top-level heading outside a fence, or the end).
function withoutDecisions(text) {
  const out = [];
  let fenced = false;
  let skipping = false;
  for (const line of splitLines(text)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const h2 = !fenced && /^##\s/.test(line);
    if (h2) skipping = line.replace(/^##\s+/, '').trim() === 'Decisions';
    if (!skipping) out.push(line);
  }
  return out.join('\n').trim();
}

const refuse = (reason, detail) => ({ ok: false, reason, detail });

// The first pending-outcome id list of `notes-round-{n}.md`, or a refusal.
function pendingRefusal(folder, n, fsImpl) {
  const text = readOrNull(path.join(folder, `notes-round-${n}.md`), fsImpl);
  if (text === null) return refuse('pending-outcomes', `notes-round-${n}.md is missing`);
  const c = checkNotes(text, n);
  if (c.ok) return null;
  const parts = [];
  if (c.pending.length) parts.push(`pending: ${c.pending.join(', ')}`);
  if (c.missingPerspectives.length) parts.push(`missing perspectives: ${c.missingPerspectives.join(', ')}`);
  if (c.malformed.length) parts.push(`malformed: ${c.malformed.join('; ')}`);
  return refuse('pending-outcomes', `round ${n} is not settled — ${parts.join(' | ')}`);
}

function lastNotesRound(folder, fsImpl) {
  let names;
  try {
    names = fsImpl.readdirSync(folder);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
    return 0;
  }
  const rounds = names.map((n) => NOTES_FILE_RE.exec(n)).filter(Boolean).map((m) => Number(m[1]));
  return rounds.length ? Math.max(...rounds) : 0;
}

function storyboardPiece(folder, file, fsImpl) {
  const abs = path.join(folder, file);
  if (INLINE_EXT.has(path.extname(file).toLowerCase())) {
    const text = readOrNull(abs, fsImpl);
    return text === null ? null : text.trim();
  }
  return readOrNull(abs, fsImpl) === null ? null : `Storyboard file: ${abs}\nRead this file.`;
}

// -> { ok: true, text } | { ok: false, reason, detail }
function composeBrief({ folder, reader, round, briefsText }, fsImpl = fs) {
  const isPerspective = PERSPECTIVES.includes(reader);
  if (!isPerspective && !PROCESS_READERS.includes(reader)) {
    return refuse('unknown-reader', `'${reader}' is not one of ${[...PERSPECTIVES, ...PROCESS_READERS].join(', ')}`);
  }
  const blocks = readBlocks(briefsText);
  const need = isPerspective ? ['perspective-common', reader, 'perspective-output'] : [reader];
  for (const name of need) {
    if (!blocks.has(name)) throw new Error(`reader-briefs.md has no '${name}' block`);
  }

  if (isPerspective) {
    if (round > MAX_ROUNDS) return refuse('round-cap', `round ${round} is past the cap of ${MAX_ROUNDS}`);
    if (round > 1) {
      const r = pendingRefusal(folder, round - 1, fsImpl);
      if (r) return r;
    }
  } else {
    const last = lastNotesRound(folder, fsImpl);
    if (last > 0) {
      const text = readOrNull(path.join(folder, `notes-round-${last}.md`), fsImpl) || '';
      const c = checkNotes(text, last);
      if (c.pending.length) {
        return refuse('pending-outcomes', `round ${last} is not settled — pending: ${c.pending.join(', ')}`);
      }
    }
  }

  const design = readOrNull(path.join(folder, 'design.md'), fsImpl);
  if (design === null) return refuse('no-frame', 'design.md is missing');
  if (!isPerspective) return { ok: true, text: [blocks.get(reader), withoutDecisions(design)].join('\n\n') };

  const frame = sectionLines(design, 'Frame');
  // The section's own `Status:` line is bookkeeping, not frame.
  const frameLines = frame ? [...frame] : [];
  const firstAt = frameLines.findIndex((l) => l.trim());
  if (firstAt !== -1 && STATUS_RE.test(frameLines[firstAt])) frameLines.splice(firstAt, 1);
  const frameBody = frameLines.join('\n').trim();
  if (!frameBody) return refuse('no-frame', 'design.md has no ## Frame section with content');

  const file = sectionField(design, 'Storyboard', 'File');
  if (!file || path.basename(file) !== file) return refuse('no-storyboard', 'design.md ## Storyboard names no File in the folder');
  const board = storyboardPiece(folder, file, fsImpl);
  if (board === null) return refuse('no-storyboard', `${file} is missing`);
  const boardRound = Number(sectionField(design, 'Storyboard', 'Round'));
  if (!(boardRound >= round)) {
    return refuse('stale-storyboard', `the storyboard is at round ${Number.isNaN(boardRound) ? 'none' : boardRound}, this brief is for round ${round}`);
  }

  return {
    ok: true,
    text: [blocks.get('perspective-common'), blocks.get(reader), frameBody, board, blocks.get('perspective-output')].join('\n\n'),
  };
}

module.exports = { readBlocks, composeBrief, withoutDecisions };
