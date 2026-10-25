// bin/lib/flow/pr-body.js — composes and repairs a pr-first run's PR-early
// body (schema documented in skills/_shared/pr-early-run-lifecycle.md's
// Step 3 and Dual-marker scheme). Mechanizes the template every PR-early
// `gh pr create`/repair call site used to hand-compose inline (#2997) —
// nothing else in this module reads or writes a file; callers own the
// `gh pr create --body-file` / `gh pr edit --body-file` round-trip. Also
// parses build's premise-reversal decisions.md lines and rewrites the Spec
// summary span from them (#3050).
'use strict';

const { escapeRegExp } = require('../shared-primitives');
const { neutralizeClosingPhrases } = require('./closing-links');

// The five canonical phase rows every PR-early body starts with, unchecked
// and in this order — never narrowed to a run's step list (#2877): a skipped
// phase's row is removed at its own would-be exit, never predicted here.
const CANONICAL_PHASES = ['build', 'test', 'review', 'polish', 'wrap-up'];

// Dual-marker scheme (_shared/pr-early-run-lifecycle.md#929) — every marker
// is written in both an HTML-comment form (what a gh-present read sees) and
// a plain-text companion (what survives a gh-absent MCP read, which strips
// every `<!-- ... -->` span). Neither form is ever removed once written.
function runMarkerHtml(runId) {
  return `<!-- claude-tweaks-run: ${runId} -->`;
}
function runMarkerPlain(runId) {
  return `claude-tweaks-run: ${runId}`;
}

function composePhasesBlock() {
  const rows = CANONICAL_PHASES.map((p) => `- [ ] ${p}`).join('\n');
  return [
    '<!-- phases-start -->',
    '[claude-tweaks-phases-start]',
    rows,
    '[claude-tweaks-phases-end]',
    '<!-- phases-end -->',
  ].join('\n');
}

function composeFixesSpan(fixesLines) {
  const lines = fixesLines && fixesLines.length ? fixesLines : [];
  return [
    '<!-- fixes-start -->',
    '[claude-tweaks-fixes-start]',
    ...lines,
    '[claude-tweaks-fixes-end]',
    '<!-- fixes-end -->',
  ].join('\n');
}

function composeResumeLine({ runDir, target, nextStep }) {
  return `\`PIPELINE_RUN_DIR="${runDir || '{run-dir}'}" /claude-tweaks:flow "${target}" ${nextStep}\``;
}

// { runId, specSummary, target, nextStep, fixesLines, runDir? } ->
// the full PR-early body string, matching
// _shared/pr-early-run-lifecycle.md's Step 3 template byte-for-byte in
// shape (the run marker as the unconditional first line, its plain-text
// companion immediately after, then Spec summary / Phases / Resume /
// Fixes, each delimited per the dual-marker scheme above).
function composePrEarlyBody({ runId, specSummary, target, nextStep, fixesLines, runDir }) {
  if (!runId) throw new Error('composePrEarlyBody: runId is required');
  if (!target) throw new Error('composePrEarlyBody: target is required');
  if (!nextStep) throw new Error('composePrEarlyBody: nextStep is required');
  return [
    runMarkerHtml(runId),
    runMarkerPlain(runId),
    '',
    '### Spec summary',
    '',
    specSummary || '',
    '',
    '### Phases',
    '',
    composePhasesBlock(),
    '',
    '### Resume',
    '',
    composeResumeLine({ runDir, target, nextStep }),
    '',
    composeFixesSpan(fixesLines),
    '',
  ].join('\n');
}

// Presence checks — either marker form counts as "present"; a repair never
// needs to know which form a given read actually returned (gh-present vs.
// gh-absent/MCP, _shared/pr-early-run-lifecycle.md's Root cause section),
// only whether the pair survived onto whatever body this call was handed.
function hasRunMarker(body) {
  return /<!--\s*claude-tweaks-run:\s*\S+\s*-->/.test(body) || /^claude-tweaks-run:\s*\S+/m.test(body);
}
function hasPhasesPair(body) {
  const html = body.includes('<!-- phases-start -->') && body.includes('<!-- phases-end -->');
  const plain = body.includes('[claude-tweaks-phases-start]') && body.includes('[claude-tweaks-phases-end]');
  return html || plain;
}
function hasFixesPair(body) {
  const html = body.includes('<!-- fixes-start -->') && body.includes('<!-- fixes-end -->');
  const plain = body.includes('[claude-tweaks-fixes-start]') && body.includes('[claude-tweaks-fixes-end]');
  return html || plain;
}

// Strips an orphaned single-sided delimiter line — a start marker present
// with no matching end, or an end present with no matching start, in either
// marker form — before a repair decides whether to append a fresh pair.
// Without this, a body already carrying one half of a pair (a prior partial
// write, a manual edit, or any other source of a malformed span) would fail
// the presence check below, trigger a fresh pair append, and end up with
// the orphan plus the new pair both present: two starts and one end (or the
// mirror), an unclosed span a downstream "find the span between markers"
// read could misparse — swallowing everything between the orphan and the
// new, unrelated close marker, including real freeform content between
// them. Removes only the marker line itself, never surrounding content.
// "Both present" (a real pair, or already two full pairs) and "both absent"
// are left untouched — there is nothing orphaned in either case.
function stripOrphanedHalf(body, startTokens, endTokens) {
  const hasStart = startTokens.some((t) => body.includes(t));
  const hasEnd = endTokens.some((t) => body.includes(t));
  if (hasStart === hasEnd) return body;
  const orphanTokens = hasStart ? startTokens : endTokens;
  let result = body;
  for (const token of orphanTokens) {
    result = result.split('\n').filter((line) => line.trim() !== token).join('\n');
  }
  return result;
}

const PHASES_START_TOKENS = ['<!-- phases-start -->', '[claude-tweaks-phases-start]'];
const PHASES_END_TOKENS = ['<!-- phases-end -->', '[claude-tweaks-phases-end]'];
const FIXES_START_TOKENS = ['<!-- fixes-start -->', '[claude-tweaks-fixes-start]'];
const FIXES_END_TOKENS = ['<!-- fixes-end -->', '[claude-tweaks-fixes-end]'];

// { body, runId, fixesLines } -> { body, restored }
// Restores whichever of the run marker / phases pair / fixes pair are
// missing from `body`, keeping every byte of its existing content
// (freeform prose included) — never a find-and-replace against content
// that already looks like one of these spans, only an append/prepend of
// what's absent. `restored` names what was added, in restoration order,
// for the caller's own AUTO log line (empty when the body already carried
// everything — a no-op repair, safe to call unconditionally).
function repairPrBody({ body, runId, fixesLines }) {
  if (!runId) throw new Error('repairPrBody: runId is required');
  let result = typeof body === 'string' ? body : '';
  const restored = [];

  if (!hasRunMarker(result)) {
    result = `${runMarkerHtml(runId)}\n${runMarkerPlain(runId)}\n\n${result}`;
    restored.push('run marker');
  }
  result = stripOrphanedHalf(result, PHASES_START_TOKENS, PHASES_END_TOKENS);
  if (!hasPhasesPair(result)) {
    const sep = result.endsWith('\n') ? '\n' : '\n\n';
    result = `${result}${sep}### Phases\n\n${composePhasesBlock()}\n`;
    restored.push('phases block');
  }
  result = stripOrphanedHalf(result, FIXES_START_TOKENS, FIXES_END_TOKENS);
  if (!hasFixesPair(result)) {
    const sep = result.endsWith('\n') ? '\n' : '\n\n';
    result = `${result}${sep}${composeFixesSpan(fixesLines)}\n`;
    restored.push('fixes block');
  }

  return { body: result, restored };
}

// Premise reversals (#3050) — the one canonical decisions.md entry shape,
// defined in _shared/pr-checklist-refresh.md's "Premise-reversal decisions"
// paragraph: `premise reversed: {original claim} → {implemented behavior}`,
// written through bin/log-decision.js, so every real line carries
// formatEntry's `- {STATUS} {HH:MM:SS} — {location}: ` prefix and its
// ` Reversibility: {r}.` suffix. Matched here and nowhere else — a
// differently-worded line for the same decision is silently missed. The
// marker must open the entry text (right after `{location}: `), so a line
// that merely quotes it mid-sentence is never read as a reversal.
const PREMISE_REVERSED_MARKER = 'premise reversed:';
const REVISION_PREFIX = 'Revised during build:';
const PREMISE_REVERSED_RE = new RegExp(
  `^-\\s+[A-Z-]+\\s+\\d{2}:\\d{2}:\\d{2}\\s+—\\s.*?:\\s+${escapeRegExp(PREMISE_REVERSED_MARKER)}\\s+(.+?)\\s+→\\s+(.+?)\\.?\\s+Reversibility:`
);

// A `; ` inside a claim is rewritten to `, ` so no written entry contains the
// note's entry separator: otherwise an existing `X; Y → Z` entry would make a
// distinct new `Y → Z` read as already noted and drop it. A closing-keyword
// phrase is neutralized (#4199): the note lands in the PR body, where GitHub
// would link "closes #N" from a reversal's own wording and close #N at merge.
// The coverage check compares these same neutralized forms.
function formatReversal({ original, replacement }) {
  const clean = (s) => neutralizeClosingPhrases(String(s).replace(/; /g, ', ')).text;
  return `${clean(original)} → ${clean(replacement)}`;
}

// decisions.md text -> [{original, replacement}], first-appearance order,
// deduplicated on formatReversal's key. Splits on the first ` → `; strips at
// most the one trailing period formatEntry adds (internal periods kept).
function parsePremiseReversals(text) {
  const seen = new Set();
  const result = [];
  for (const rawLine of String(text || '').split('\n')) {
    const match = PREMISE_REVERSED_RE.exec(rawLine.replace(/\r$/, ''));
    if (!match) continue;
    const reversal = { original: match[1].trim(), replacement: match[2].trim() };
    const key = formatReversal(reversal);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reversal);
  }
  return result;
}

// The Spec summary has no delimiter markers: locate it by its heading line,
// up to the next level 1-3 heading. Headings survive both a gh read and a
// gh-absent MCP read (only `<!-- ... -->` spans are stripped).
function locateSpecSummary(lines) {
  const start = lines.findIndex((l) => l.trim() === '### Spec summary');
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,3}\s/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

// { body, reversals, summary? } -> { body, changed, uncovered, reason }.
// `reason` is null on a change, else one of: 'no-reversals' (nothing to
// cover), 'no-spec-summary-heading' (nowhere to write), 'already-noted'
// (every reversal is already named), 'summary-required' (no --summary-file
// yet), 'summary-not-one-paragraph' (the given summary is not one
// paragraph — a blank line or a heading line inside it would leave a stale
// tail on the next rewrite, since locateSpecSummary stops at a heading).
// Idempotent: a reversal already named in the span's existing
// `Revised during build:` line is covered. An existing note is kept
// verbatim and only uncovered entries are appended (`; `-joined), so a
// sibling spec's entries in a shared bundle PR are never dropped. The new
// paragraph (agent-written from the diff) replaces the old one.
function reviseSpecSummary({ body, reversals, summary }) {
  const text = typeof body === 'string' ? body : '';
  const wanted = (reversals || []).map(formatReversal);
  if (wanted.length === 0) return { body: text, changed: false, uncovered: [], reason: 'no-reversals' };
  const lines = text.split('\n');
  const span = locateSpecSummary(lines);
  if (!span) return { body: text, changed: false, uncovered: wanted, reason: 'no-spec-summary-heading' };
  const note = lines.slice(span.start + 1, span.end)
    .map((l) => l.replace(/\r$/, ''))
    .find((l) => l.startsWith(REVISION_PREFIX));
  const trimmedNote = note !== undefined ? note.trimEnd() : null;
  // Delimited match, not substring: `note.includes(w)` would also match `w`
  // as a bare substring of a longer, distinct entry (e.g. wanted `A → B`
  // falsely "covered" by an existing `XA → B`). An entry is noted only when
  // it appears as a whole `; `-delimited item in the note's entry list.
  // A stray space after the prefix (leading whitespace on the entry list) and
  // trailing whitespace on the note are stripped so neither defeats this
  // delimited match.
  const entryList = trimmedNote ? trimmedNote.slice(REVISION_PREFIX.length).trimStart() : '';
  const isNoted = (w) => trimmedNote !== null && `; ${entryList}; `.includes(`; ${w}; `);
  const uncovered = wanted.filter((w) => !isNoted(w));
  if (uncovered.length === 0) return { body: text, changed: false, uncovered: [], reason: 'already-noted' };
  const paragraph = neutralizeClosingPhrases(String(summary || '').trim()).text;
  if (!paragraph) return { body: text, changed: false, uncovered, reason: 'summary-required' };
  if (/\n\s*\n/.test(paragraph) || /^#{1,6}\s/m.test(paragraph)) {
    return { body: text, changed: false, uncovered, reason: 'summary-not-one-paragraph' };
  }
  const newNote = trimmedNote ? `${trimmedNote}; ${uncovered.join('; ')}` : `${REVISION_PREFIX} ${uncovered.join('; ')}`;
  const out = [...lines.slice(0, span.start + 1), '', newNote, '', paragraph, '', ...lines.slice(span.end)];
  return { body: out.join('\n'), changed: true, uncovered, reason: null };
}

module.exports = {
  CANONICAL_PHASES,
  composePrEarlyBody,
  composePhasesBlock,
  composeFixesSpan,
  composeResumeLine,
  hasRunMarker,
  hasPhasesPair,
  hasFixesPair,
  repairPrBody,
  PREMISE_REVERSED_MARKER,
  REVISION_PREFIX,
  parsePremiseReversals,
  formatReversal,
  reviseSpecSummary,
};
