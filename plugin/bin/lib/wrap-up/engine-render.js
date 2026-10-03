// bin/lib/wrap-up/engine-render.js — pure renderer for the wrap-up curation
// engine: turns engine-state.json (Task 4's shape: { version, worklist,
// results }) into the Phase 2 phase-trace table and the Review Console's
// engine-fed sections, plus a strict-mode completeness check.
//
// No fs, no git, no clock — reading engine-state.json off disk is the CLI's
// job (a later task). Every function here is a pure function of the state
// object passed in.
'use strict';

// ---- forbidden vocabulary (defense in depth) -------------------------
//
// Sources are structured fields (targetPath/summary/detail strings supplied
// by the judge payloads), never free-form engine internals, so none of these
// patterns should ever be reachable through a rendered table. Both render
// functions below post-check their own output and throw on a match anyway.
const FORBIDDEN_VOCABULARY = [
  /\bD[0-5]\b/,
  /domain-overlap/i,
  /gap detection/i,
  /\bStep 7\.\d+/,
  /\[route:/,
];

function assertCleanVocabulary(markdown, source) {
  for (const pattern of FORBIDDEN_VOCABULARY) {
    if (pattern.test(markdown)) {
      throw new Error(`engine-render: ${source} output matched forbidden vocabulary pattern ${pattern}`);
    }
  }
}

// ---- shared helpers -----------------------------------------------------

// engine-state.json stores the full buildWorklist() output ({ version,
// ceremonyProfile, rows }) under state.worklist. Unwrap defensively, the
// same way engine-record.js's own worklistRows() does, so a bare rows array
// also works.
function worklistRows(worklist) {
  return worklist && Array.isArray(worklist.rows) ? worklist.rows : worklist;
}

function findingCounts(findings) {
  const applied = (findings || []).filter((f) => f.action === 'applied').length;
  const staged = (findings || []).filter((f) => f.action === 'staged').length;
  return { applied, staged };
}

// ---- Phase 2 phase-trace table --------------------------------------------

function formatResultCell(entry) {
  if (!entry) return 'MISSING — judge never reported';
  if (entry.result === 'na') return 'n/a';
  if (entry.result === 'clean') return 'Clean';
  if (entry.result === 'findings') {
    const { applied, staged } = findingCounts(entry.findings);
    if (staged === 0) return `${applied} applied`;
    if (applied === 0) return `${staged} staged`;
    return `${applied} applied, ${staged} staged`;
  }
  return String(entry.result);
}

function formatDetailCell(entry) {
  if (!entry) return '';
  return entry.detail || '';
}

// A row is "empty" for collapse purposes when it produced nothing worth a
// human reading a dedicated line for: gate-closed (na) or judged clean with
// zero findings. A MISSING row (never judged) is never empty — collapsing
// that away would hide the one genuinely bad outcome this table can show.
// 'clean' is not assumed finding-free by construction (validatePayload does
// not forbid a 'clean' payload from carrying a findings array) — count it
// defensively, the same way formatResultCell counts 'findings' results.
function isRowEmpty(entry) {
  if (!entry) return false;
  if (entry.result === 'na') return true;
  if (entry.result === 'clean') {
    const { applied, staged } = findingCounts(entry.findings);
    return applied === 0 && staged === 0;
  }
  return false;
}

function renderTrace(state) {
  const rows = worklistRows(state.worklist);
  const results = state.results || {};

  // Re-read cut: seven-plus per-row SCANNED-equivalent lines collapse to one
  // summary when the run produced literally nothing — the common case for a
  // small or config/docs-only diff. Any MISSING or non-empty row still
  // renders the full table, so a real problem or a real finding is never
  // hidden behind the summary.
  if (rows.length > 0 && rows.every((row) => isRowEmpty(results[row.id]))) {
    const markdown = `${rows.length} row${rows.length === 1 ? '' : 's'} scanned, 0 findings — nothing to update.`;
    assertCleanVocabulary(markdown, 'renderTrace');
    return markdown;
  }

  const lines = ['| Target | Result | Detail |', '|--------|--------|--------|'];

  for (const row of rows) {
    const entry = results[row.id];
    lines.push(`| ${row.target} | ${formatResultCell(entry)} | ${formatDetailCell(entry)} |`);
  }

  const markdown = lines.join('\n');
  assertCleanVocabulary(markdown, 'renderTrace');
  return markdown;
}

// ---- Review Console engine-fed sections ------------------------------

// Row id -> console section title. claude-md and decision-records merge into
// one 'Configuration updates' section when either (or both) has findings.
// memory/upstream are deliberately absent: those are the console's per-item
// M#/U# sections, owned by console prose, never rendered here.
const SECTION_SPECS = [
  { rowIds: ['skills'], title: 'Skill updates' },
  { rowIds: ['docs'], title: 'Documentation updates' },
  { rowIds: ['journeys'], title: 'Journey updates' },
  { rowIds: ['claude-md', 'decision-records'], title: 'Configuration updates' },
  { rowIds: ['references'], title: 'Reference repairs' },
];

function dispositionFor(finding) {
  if (finding.action === 'applied') return `applied (${finding.commit})`;
  if (finding.action === 'staged') return `staged (${finding.stagePath})`;
  return String(finding.action);
}

// Shared by renderConsoleSections and renderConsoleSectionsMulti: every
// 'findings' entry across a section's rowIds, in row-id order.
function collectFindings(results, rowIds) {
  const findings = [];
  for (const rowId of rowIds) {
    const entry = results[rowId];
    if (entry && entry.result === 'findings') {
      findings.push(...(entry.findings || []));
    }
  }
  return findings;
}

function renderConsoleSections(state, { startAt = 1 } = {}) {
  const results = state.results || {};
  let n = startAt;
  const blocks = [];

  for (const spec of SECTION_SPECS) {
    const findings = collectFindings(results, spec.rowIds);
    if (findings.length === 0) continue;

    const tableLines = ['| # | Target | Change | Disposition |', '|---|---|---|---|'];
    for (const finding of findings) {
      tableLines.push(`| ${n} | ${finding.targetPath} | ${finding.summary} | ${dispositionFor(finding)} |`);
      n += 1;
    }
    blocks.push(`#### ${spec.title}\n\n${tableLines.join('\n')}`);
  }

  const markdown = blocks.join('\n\n');
  assertCleanVocabulary(markdown, 'renderConsoleSections');
  return { markdown, nextNumber: n };
}

function renderConsoleSectionsMulti(specStates, { startAt = 1 } = {}) {
  let n = startAt;
  const blocks = [];

  for (const spec of SECTION_SPECS) {
    const tableLines = ['| # | Spec | Target | Change | Disposition |', '|---|---|---|---|---|'];
    let any = false;
    for (const { specId, state } of specStates) {
      const findings = collectFindings(state.results || {}, spec.rowIds);
      for (const finding of findings) {
        tableLines.push(`| ${n} | ${specId} | ${finding.targetPath} | ${finding.summary} | ${dispositionFor(finding)} |`);
        n += 1;
        any = true;
      }
    }
    if (!any) continue;
    blocks.push(`#### ${spec.title}\n\n${tableLines.join('\n')}`);
  }

  const markdown = blocks.join('\n\n');
  assertCleanVocabulary(markdown, 'renderConsoleSectionsMulti');
  return { markdown, nextNumber: n };
}

// ---- strict-mode completeness check ----------------------------------

function strictCheck(state) {
  const rows = worklistRows(state.worklist);
  const results = state.results || {};
  const missing = rows
    .filter((row) => !Object.prototype.hasOwnProperty.call(results, row.id))
    .map((row) => row.id);
  return { ok: missing.length === 0, missing };
}

// ---- procedure-head registry (#2546) ----------------------------------
//
// Maps a stable `procedure:<name>` --section value to a split skill file's
// path, relative to the plugin payload root (the directory with `skills/`
// directly beneath it — `plugin/` in this repo, `${CLAUDE_PLUGIN_ROOT}` in an
// installed consumer). This registry is the single source of truth for valid
// names, shared by the CLI's validation and this suite's own tests. No fs
// here, per this module's header — reading the file off disk is the CLI's
// job (bin/wrap-up-engine.js's runRender).
const PROCEDURE_HEADS = {
  'review-console': 'skills/wrap-up/review-console.md',
  'curation-engine': 'skills/wrap-up/curation-engine.md',
  'cleanup-procedures-execution': 'skills/wrap-up/cleanup-procedures-execution.md',
  'pr-first-merge': 'skills/_shared/pr-first-merge.md',
};

function resolveProcedureHeadPath(name) {
  return Object.prototype.hasOwnProperty.call(PROCEDURE_HEADS, name) ? PROCEDURE_HEADS[name] : null;
}

module.exports = {
  renderTrace, renderConsoleSections, renderConsoleSectionsMulti, strictCheck, FORBIDDEN_VOCABULARY,
  PROCEDURE_HEADS, resolveProcedureHeadPath,
};
