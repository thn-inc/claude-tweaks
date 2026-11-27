// bin/lib/design-session/notes.js — the perspective-notes file of one round
// (notes-round-N.md): parse its entries and gate on every note having an
// outcome and every perspective being recorded.
'use strict';

const MAX_ROUNDS = 4;
const PERSPECTIVES = ['user', 'smallest', 'ownership', 'token-cost', 'introduction'];
const OUTCOMES = ['changed', 'declined', 'accepted-risk'];

// Shared with status.js: a `Status:` line, whitespace- and case-tolerant.
const STATUS_RE = /^\s*status:\s*(done|in-progress)\s*$/i;
const FENCE_RE = /^\s*```/;
const H2_RE = /^##\s/;
const ENTRY_RE = /^##\s+(\d+\.\d+)\s+[—–]\s+(\S+)\s+[—–]\s+(serious|minor|none)\s*$/i;
const ROUND_H1_RE = /^#\s+perspective notes\s+[—–]\s+round\s+(\d+)\s*$/i;
const OUTCOME_LINE_RE = /^\s*outcome:\s*(.*?)\s*$/i;
// An outcome counts only with its explanation: `changed — {what changed}`.
const OUTCOME_VALUE_RE = new RegExp(`^(${OUTCOMES.join('|')})\\s+[—–]\\s+\\S`, 'i');

function splitLines(text) {
  return String(text).split(/\r?\n/);
}

// Status of the first non-blank line after the first H1 (or of the first
// non-blank line when there is no H1): 'done' | 'in-progress' | null.
function leadingStatus(lines) {
  const h1 = lines.findIndex((l) => /^# /.test(l));
  for (let i = h1 + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const m = STATUS_RE.exec(lines[i]);
    return m ? m[1].toLowerCase() : null;
  }
  return null;
}

// -> { done, round, notes: [{ id, perspective, severity, outcome }], perspectivesRecorded,
//      malformed: one `line N: {why}` string per bad H1 or entry heading }
// `round` is the H1's N; `expectedRound` (the file name's N), when given, must match it.
function parseNotes(text, expectedRound) {
  const lines = splitLines(text);
  const notes = [];
  const malformed = [];
  const h1 = lines.findIndex((l) => /^# /.test(l));
  const hm = h1 === -1 ? null : ROUND_H1_RE.exec(lines[h1]);
  const round = hm ? Number(hm[1]) : null;
  const h1Line = h1 === -1 ? 1 : h1 + 1;
  if (round === null) malformed.push(`line ${h1Line}: missing '# Perspective notes — round N' heading`);
  else if (expectedRound != null && round !== Number(expectedRound)) {
    malformed.push(`line ${h1Line}: heading says round ${round}, expected round ${expectedRound}`);
  }
  const ids = new Set();
  let current = null;
  let fenced = false;
  lines.forEach((line, idx) => {
    if (FENCE_RE.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    if (H2_RE.test(line)) {
      const m = ENTRY_RE.exec(line);
      const perspective = m && m[2].toLowerCase();
      let why = null;
      if (!m) why = `'${line.trim()}' is not an entry heading`;
      else if (!PERSPECTIVES.includes(perspective)) why = `unknown perspective '${m[2]}' in ${m[1]}`;
      else if (ids.has(m[1])) why = `duplicate id ${m[1]}`;
      else if (round !== null && Number(m[1].split('.')[0]) !== round) why = `id ${m[1]} is not in round ${round}`;
      if (why) {
        malformed.push(`line ${idx + 1}: ${why}`);
        current = null;
        return;
      }
      ids.add(m[1]);
      current = { id: m[1], perspective, severity: m[3].toLowerCase(), outcome: null, seen: false };
      notes.push(current);
      return;
    }
    if (!current || current.seen || current.severity === 'none') return;
    const o = OUTCOME_LINE_RE.exec(line);
    if (!o) return;
    current.seen = true;
    const v = OUTCOME_VALUE_RE.exec(o[1]);
    current.outcome = v ? v[1].toLowerCase() : null;
  });

  const perspectivesRecorded = [];
  for (const n of notes) {
    delete n.seen;
    if (!perspectivesRecorded.includes(n.perspective)) perspectivesRecorded.push(n.perspective);
  }
  return { done: leadingStatus(lines) === 'done', round, notes, perspectivesRecorded, malformed };
}

// -> { ok, pending: ids with no outcome, serious: ids marked serious,
//      missingPerspectives, malformed }. `ok` needs nothing pending, every
//      perspective recorded, and nothing malformed.
function checkNotes(text, expectedRound) {
  const { notes, perspectivesRecorded, malformed } = parseNotes(text, expectedRound);
  const pending = notes.filter((n) => n.severity !== 'none' && n.outcome === null).map((n) => n.id);
  const serious = notes.filter((n) => n.severity === 'serious').map((n) => n.id);
  const missingPerspectives = PERSPECTIVES.filter((p) => !perspectivesRecorded.includes(p));
  return {
    ok: pending.length === 0 && missingPerspectives.length === 0 && malformed.length === 0,
    pending,
    serious,
    missingPerspectives,
    malformed,
  };
}

module.exports = {
  MAX_ROUNDS, PERSPECTIVES, OUTCOMES, STATUS_RE, parseNotes, checkNotes, leadingStatus, splitLines,
};
