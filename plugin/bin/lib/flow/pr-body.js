// bin/lib/flow/pr-body.js — composes and repairs a pr-first run's PR-early
// body (schema documented in skills/_shared/pr-early-run-lifecycle.md's
// Step 3 and Dual-marker scheme). Mechanizes the template every PR-early
// `gh pr create`/repair call site used to hand-compose inline (#2997) —
// nothing else in this module reads or writes a file; callers own the
// `gh pr create --body-file` / `gh pr edit --body-file` round-trip.
'use strict';

const DEFAULT_PHASES = ['build', 'test', 'review', 'polish', 'wrap-up'];

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

function composePhasesBlock(phases) {
  const list = phases && phases.length ? phases : DEFAULT_PHASES;
  const rows = list.map((p) => `- [ ] ${p}`).join('\n');
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

// { runId, specSummary, target, nextStep, fixesLines, phases?, runDir? } ->
// the full PR-early body string, matching
// _shared/pr-early-run-lifecycle.md's Step 3 template byte-for-byte in
// shape (the run marker as the unconditional first line, its plain-text
// companion immediately after, then Spec summary / Phases / Resume /
// Fixes, each delimited per the dual-marker scheme above).
function composePrEarlyBody({ runId, specSummary, target, nextStep, fixesLines, phases, runDir }) {
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
    composePhasesBlock(phases),
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

// { body, runId, fixesLines, phases? } -> { body, restored }
// Restores whichever of the run marker / phases pair / fixes pair are
// missing from `body`, keeping every byte of its existing content
// (freeform prose included) — never a find-and-replace against content
// that already looks like one of these spans, only an append/prepend of
// what's absent. `restored` names what was added, in restoration order,
// for the caller's own AUTO log line (empty when the body already carried
// everything — a no-op repair, safe to call unconditionally).
function repairPrBody({ body, runId, fixesLines, phases }) {
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
    result = `${result}${sep}### Phases\n\n${composePhasesBlock(phases)}\n`;
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

module.exports = {
  DEFAULT_PHASES,
  composePrEarlyBody,
  composePhasesBlock,
  composeFixesSpan,
  composeResumeLine,
  hasRunMarker,
  hasPhasesPair,
  hasFixesPair,
  repairPrBody,
};
