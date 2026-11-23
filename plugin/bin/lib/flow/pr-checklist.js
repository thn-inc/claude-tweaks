// bin/lib/flow/pr-checklist.js — pure transforms behind bin/pr-checklist.js,
// the CLI that flips or removes one phase row in a pr-first run's PR body
// (#3263). The edit is line-based on the Phases span: every byte outside the
// one edited row — `\r` included — stays identical, so a CRLF body round-trips.
// Nothing here touches gh or the network; the CLI owns the PR round-trip.
// Also hosts readRunReversals, shared with bin/revise-pr-summary.js.
'use strict';

const path = require('path');
const { CANONICAL_PHASES, parsePremiseReversals } = require('./pr-body');

const SPANS = [
  { start: '<!-- phases-start -->', end: '<!-- phases-end -->' },
  { start: '[claude-tweaks-phases-start]', end: '[claude-tweaks-phases-end]' },
];

const bare = (line) => line.replace(/\r$/, '').trim();

// The first start line through the next end line, for the first marker form
// that has both (HTML comment form first, plain-text companion second).
function locatePhasesSpan(lines) {
  for (const { start, end } of SPANS) {
    const s = lines.findIndex((l) => bare(l) === start);
    if (s === -1) continue;
    const e = lines.findIndex((l, i) => i > s && bare(l) === end);
    if (e !== -1) return { start: s, end: e };
  }
  return null;
}

// { body, phase, remove? } -> { body, changed, row }. `row` is one of
// 'checked' | 'removed' | 'already-checked' | 'row-absent' | 'no-phases-span'.
// A row matches on its exact phase name (`test` never matches `test-smoke`);
// rows outside the span are never touched.
function setPhaseRow({ body, phase, remove = false }) {
  if (!CANONICAL_PHASES.includes(phase)) {
    throw new Error(`setPhaseRow: unknown phase: ${phase} (expected one of ${CANONICAL_PHASES.join(', ')})`);
  }
  const text = typeof body === 'string' ? body : '';
  const lines = text.split('\n');
  const span = locatePhasesSpan(lines);
  if (!span) return { body: text, changed: false, row: 'no-phases-span' };

  const unchecked = `- [ ] ${phase}`;
  const checked = new Set([`- [x] ${phase}`, `- [X] ${phase}`]);
  const out = [];
  let matched = 0;
  let edited = 0;
  lines.forEach((line, i) => {
    const trimmed = i > span.start && i < span.end ? bare(line) : null;
    if (trimmed === unchecked) {
      matched++;
      edited++;
      if (!remove) out.push(line.replace('- [ ]', '- [x]'));
      return;
    }
    // A checked row is never a skipped phase's row: --remove leaves it in place.
    if (checked.has(trimmed)) matched++;
    out.push(line);
  });

  if (matched === 0) return { body: text, changed: false, row: 'row-absent' };
  if (edited === 0) return { body: text, changed: false, row: 'already-checked' };
  return { body: out.join('\n'), changed: true, row: remove ? 'removed' : 'checked' };
}

// Read-only view of the Phases span: { span, rows } where rows maps each
// canonical phase present inside the span to 'checked' | 'unchecked'. Same
// exact-name match and `\r` tolerance as setPhaseRow; rows outside the span
// are ignored. `span` is false (rows {}) when the body has no Phases span.
function phaseRowStates(body) {
  const lines = (typeof body === 'string' ? body : '').split('\n');
  const span = locatePhasesSpan(lines);
  if (!span) return { span: false, rows: {} };
  const rows = {};
  for (let i = span.start + 1; i < span.end; i++) {
    const m = /^- \[( |x|X)\] (.+)$/.exec(bare(lines[i]));
    if (m && CANONICAL_PHASES.includes(m[2])) rows[m[2]] = m[1] === ' ' ? 'unchecked' : 'checked';
  }
  return { span: true, rows };
}

// The subset of ['build', 'test'], in that order, whose row is present and unchecked.
function uncheckedBuildOrTest(body) {
  const { rows } = phaseRowStates(body);
  return ['build', 'test'].filter((p) => rows[p] === 'unchecked');
}

// The run id from the body's first line — the HTML-comment marker or its
// plain-text companion — else null (the marker must be the unconditional
// first line, so a marker further down never identifies the run).
function firstLineRunId(body) {
  const first = String(body || '').split('\n')[0].replace(/\r$/, '').trim();
  const match = /^<!--\s*claude-tweaks-run:\s*(\S+)\s*-->$/.exec(first) || /^claude-tweaks-run:\s*(\S+)$/.exec(first);
  return match ? match[1] : null;
}

// A missing decisions.md contributes nothing — the same fail-open posture as
// manifest.js's readDeferredClosures. A bundle reads every spec-{id}/decisions.md,
// else the run's own decisions.md.
function readRunReversals(runDir, deps) {
  const manifest = deps.readManifest(runDir);
  const specs = manifest && manifest.multispec && Array.isArray(manifest.multispec.specs) ? manifest.multispec.specs : null;
  const files = specs
    ? specs.map((s) => path.join(runDir, `spec-${s.id}`, 'decisions.md'))
    : [path.join(runDir, 'decisions.md')];
  let text = '';
  for (const f of files) {
    try { text += `${deps.readFile(f)}\n`; } catch { /* no decisions.md for this spec */ }
  }
  return parsePremiseReversals(text);
}

module.exports = { setPhaseRow, phaseRowStates, uncheckedBuildOrTest, firstLineRunId, readRunReversals };
