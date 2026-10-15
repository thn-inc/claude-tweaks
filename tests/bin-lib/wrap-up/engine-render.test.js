'use strict';
// tests/bin-lib/wrap-up/engine-render.test.js — phase-trace table, Review
// Console sections, strict-mode completeness, and the forbidden-vocabulary
// guard. Uses real buildWorklist() output (Task 3) as the worklist half of
// the fixture state, per CLAUDE.md's Task 4 precedent — only `results` is
// hand-shaped, never the worklist.
const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const path = require('node:path');

const { buildWorklist } = require('../../../plugin/bin/lib/wrap-up/engine-plan');
const {
  renderTrace, renderConsoleSections, strictCheck, FORBIDDEN_VOCABULARY,
  PROCEDURE_HEADS, resolveProcedureHeadPath,
} = require('../../../plugin/bin/lib/wrap-up/engine-render');

const PLUGIN_ROOT = path.join(__dirname, '..', '..', '..', 'plugin');

const FACTS = {
  isRepo: true, changedFiles: ['src/a.js', 'src/b.js'], renamedDeleted: ['old.md'],
  skillsLibraryExists: true, multiFileDiff: true, docsTreeNonEmpty: true,
  journeysExist: true, journeyFiles: ['docs/journeys/j1.md'],
  claudeMdCommandRenamed: true, renamedOrDeleted: true,
};

function makeWorklist() {
  return buildWorklist({ facts: FACTS, signals: { adrCandidateCount: 1 }, ceremonyProfile: 'standard', budgets: {} });
}

// Fixture covering all three result kinds plus one missing row:
//   skills            -> clean
//   docs              -> n/a (closed gate)
//   journeys          -> absent from results entirely (MISSING)
//   claude-md         -> findings, mixed applied+staged
//   decision-records  -> n/a
//   references        -> findings, all applied
//   memory            -> n/a
//   upstream          -> n/a
function makeMixedResults() {
  return {
    skills: {
      rowId: 'skills', target: 'Skills', result: 'clean',
      detail: 'Read 1: upstream-drift', findings: [],
      read: [{ path: '.claude/skills/upstream-drift.md', mode: 'full' }], gapDetection: 'run',
    },
    docs: { rowId: 'docs', target: 'Docs', result: 'na', detail: 'no docs/ tree' },
    // journeys intentionally omitted — the row present-in-worklist,
    // absent-from-results case.
    'claude-md': {
      rowId: 'claude-md', target: 'CLAUDE.md & rules', result: 'findings',
      detail: "Fetch-first rule; IL carve-out; new Don't",
      findings: [
        { kind: 'addition', summary: 'Fetch-first rule', targetPath: 'CLAUDE.md', action: 'applied', stagePath: null, commit: 'abc1234' },
        { kind: 'addition', summary: 'IL carve-out', targetPath: 'CLAUDE.md', action: 'staged', stagePath: 'staged/claude-md-1.md', commit: null },
        { kind: 'addition', summary: "new Don't", targetPath: 'CLAUDE.md', action: 'staged', stagePath: 'staged/claude-md-2.md', commit: null },
      ],
    },
    'decision-records': { rowId: 'decision-records', target: 'Decision records', result: 'na', detail: 'no ADR candidates found' },
    references: {
      rowId: 'references', target: 'Broken references', result: 'findings',
      detail: 'Fixed 2 broken links',
      findings: [
        { kind: 'repair', summary: 'build/setup.md -> build/worktree-setup.md', targetPath: 'docs/plugin-structure.md', action: 'applied', stagePath: null, commit: 'def5678' },
        { kind: 'repair', summary: 'build/setup.md -> build/worktree-setup.md', targetPath: 'tests/paths.test.js', action: 'applied', stagePath: null, commit: 'def5678' },
      ],
    },
    // memory/upstream detail below is the real (post-fix) closed-gate
    // gateReason text from engine-plan.js's SIGNAL_COUNT_REASONS — see the
    // dedicated producer-side guard tests further down for why that matters.
    memory: { rowId: 'memory', target: 'Memory', result: 'na', detail: 'no insights routed to memory' },
    upstream: { rowId: 'upstream', target: 'Upstream feedback', result: 'na', detail: 'no learnings routed upstream' },
  };
}

const EXPECTED_TRACE = [
  '| Target | Result | Detail |',
  '|--------|--------|--------|',
  '| Skills | Clean | Read 1: upstream-drift |',
  '| Docs | n/a | no docs/ tree |',
  '| Journeys | MISSING — judge never reported |  |',
  "| CLAUDE.md & rules | 1 applied, 2 staged | Fetch-first rule; IL carve-out; new Don't |",
  '| Decision records | n/a | no ADR candidates found |',
  '| Broken references | 2 applied | Fixed 2 broken links |',
  '| Memory | n/a | no insights routed to memory |',
  '| Upstream feedback | n/a | no learnings routed upstream |',
].join('\n');

test('renderTrace pins the exact phase-trace table for a mixed fixture (clean, n/a, findings, MISSING)', () => {
  const state = { version: 1, worklist: makeWorklist(), results: makeMixedResults() };
  const out = renderTrace(state);
  assert.strictEqual(out, EXPECTED_TRACE);
  // [IL-105] inversion discipline: audit-log vocabulary must never leak into
  // the trace table.
  assert.doesNotMatch(out, /\bSCANNED\b/);
});

test('strictCheck flags the row present in the worklist but absent from results', () => {
  const state = { version: 1, worklist: makeWorklist(), results: makeMixedResults() };
  const result = strictCheck(state);
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.missing, ['journeys']);
});

test('strictCheck reports ok:true and an empty missing list when every row is recorded', () => {
  const results = makeMixedResults();
  results.journeys = { rowId: 'journeys', target: 'Journeys', result: 'na', detail: 'no journeys' };
  const state = { version: 1, worklist: makeWorklist(), results };
  assert.deepStrictEqual(strictCheck(state), { ok: true, missing: [] });
});

test('renderTrace throws when a detail field smuggles forbidden vocabulary', () => {
  const results = makeMixedResults();
  results.docs = { rowId: 'docs', target: 'Docs', result: 'na', detail: 'D0 domain-overlap candidate' };
  const state = { version: 1, worklist: makeWorklist(), results };
  assert.throws(() => renderTrace(state), /forbidden vocabulary/);
});

// Fixed: engine-plan.js's SIGNAL_COUNT_REASONS for d4Count/d5Count used to
// read "... classified D4" / "... classified D5", which — once copied
// verbatim into results[id].detail by engine-record.js's initState for a
// closed row — tripped FORBIDDEN_VOCABULARY's /\bD[0-5]\b/ on every real
// wrap-up run. Reworded to "routed to memory" / "routed upstream" in
// engine-plan.js. The three tests below are the producer-side guard, and
// together they exercise every gateReason string engine-plan.js's
// evaluateGate() can actually produce and hand to renderTrace as `detail`
// (mirroring engine-record.js's initState, which copies gateReason verbatim
// for a closed row):
//   - all-gates-closed: every FACT_REASONS.closed / SIGNAL_COUNT_REASONS.closed
//     string, across all 8 rows.
//   - memory/upstream-open: the two SIGNAL_COUNT_REASONS.open strings that
//     were the actual collision (d4Count/d5Count).
//   - all-gates-open (below): every FACT_REASONS.open string reachable, plus
//     the remaining SIGNAL_COUNT_REASONS.open string (adrCandidateCount).
// One gap remains, by construction rather than oversight: claude-md's gate
// is `{kind:'facts', anyOf:['claudeMdCommandRenamed', 'claudeMdOverBudget'],
// orSignals:[...]}`, and evaluateGate() returns on the first satisfied
// *fact* before ever consulting orSignals — so SIGNAL_BOOL_REASONS's three
// strings (dontCandidate/contradictedConvention/incidentRecorded) can only
// become a row's gateReason when both claudeMdCommandRenamed and
// claudeMdOverBudget are false, which no "make every gate open" fixture can
// express alongside two true facts. None of the three strings contains any
// FORBIDDEN_VOCABULARY token by inspection, but that claim is unverified by
// a render test today. claudeMdOverBudget's own open string IS exercised —
// see the dedicated test below.
function resultsFromGateReasons(worklist) {
  const results = {};
  for (const row of worklist.rows) {
    results[row.id] = {
      rowId: row.id,
      target: row.target,
      result: row.gate === 'closed' ? 'na' : 'clean',
      detail: row.gateReason,
    };
  }
  return results;
}

const CLOSED_FACTS = {
  isRepo: true, changedFiles: [], renamedDeleted: [],
  skillsLibraryExists: false, multiFileDiff: false, docsTreeNonEmpty: false,
  journeysExist: false, journeyFiles: [],
  claudeMdCommandRenamed: false, renamedOrDeleted: false,
};

test('every gateReason with all gates closed passes FORBIDDEN_VOCABULARY (renderTrace does not throw)', () => {
  const wl = buildWorklist({ facts: CLOSED_FACTS, signals: {}, ceremonyProfile: 'standard', budgets: {} });
  assert.ok(wl.rows.every((r) => r.gate === 'closed'), 'fixture must close every gate');
  const state = { version: 1, worklist: wl, results: resultsFromGateReasons(wl) };
  assert.doesNotThrow(() => renderTrace(state));
});

test('memory/upstream gateReason with signals open (recorded clean) passes FORBIDDEN_VOCABULARY', () => {
  const wl = buildWorklist({ facts: CLOSED_FACTS, signals: { d4Count: 2, d5Count: 3 }, ceremonyProfile: 'standard', budgets: {} });
  const memoryRow = wl.rows.find((r) => r.id === 'memory');
  const upstreamRow = wl.rows.find((r) => r.id === 'upstream');
  assert.strictEqual(memoryRow.gate, 'open');
  assert.strictEqual(upstreamRow.gate, 'open');
  assert.strictEqual(memoryRow.gateReason, '2 insights routed to memory');
  assert.strictEqual(upstreamRow.gateReason, '3 learnings routed upstream');

  const state = { version: 1, worklist: wl, results: resultsFromGateReasons(wl) };
  assert.doesNotThrow(() => renderTrace(state));
});

test('every gateReason with all gates open passes FORBIDDEN_VOCABULARY (renderTrace does not throw)', () => {
  const openFacts = {
    isRepo: true, changedFiles: ['src/a.js', 'src/b.js'], renamedDeleted: ['old.md', 'moved.md'],
    skillsLibraryExists: true, multiFileDiff: true, docsTreeNonEmpty: true,
    journeysExist: true, journeyFiles: ['docs/journeys/j1.md', 'docs/journeys/j2.md'],
    claudeMdCommandRenamed: true, renamedOrDeleted: true,
  };
  const openSignals = {
    dontCandidate: true, contradictedConvention: true, incidentRecorded: true,
    adrCandidateCount: 5, d4Count: 2, d5Count: 3,
  };
  const wl = buildWorklist({ facts: openFacts, signals: openSignals, ceremonyProfile: 'standard', budgets: {} });
  assert.ok(wl.rows.every((r) => r.gate === 'open'), 'fixture must open every gate');

  const state = { version: 1, worklist: wl, results: resultsFromGateReasons(wl) };
  assert.doesNotThrow(() => renderTrace(state));
});

test('claude-md gateReason for claudeMdOverBudget alone passes FORBIDDEN_VOCABULARY', () => {
  const facts = {
    isRepo: true, changedFiles: [], renamedDeleted: [],
    skillsLibraryExists: false, multiFileDiff: false, docsTreeNonEmpty: false,
    journeysExist: false, journeyFiles: [],
    claudeMdCommandRenamed: false, renamedOrDeleted: false, claudeMdOverBudget: true,
  };
  const wl = buildWorklist({ facts, signals: {}, ceremonyProfile: 'standard', budgets: {} });
  const claudeMdRow = wl.rows.find((r) => r.id === 'claude-md');
  assert.strictEqual(claudeMdRow.gate, 'open');
  assert.strictEqual(claudeMdRow.gateReason, 'CLAUDE.md/rules over the size budget');

  const state = { version: 1, worklist: wl, results: { [claudeMdRow.id]: { rowId: claudeMdRow.id, target: claudeMdRow.target, result: 'clean', detail: claudeMdRow.gateReason } } };
  assert.doesNotThrow(() => renderTrace(state));
});

test('FORBIDDEN_VOCABULARY exports exactly the five specified patterns', () => {
  assert.strictEqual(FORBIDDEN_VOCABULARY.length, 5);
  const src = FORBIDDEN_VOCABULARY.map((r) => r.source).sort();
  const expected = ['\\bD[0-5]\\b', '\\bStep 7\\.\\d+', '\\[route:', 'domain-overlap', 'gap detection'].sort();
  assert.deepStrictEqual(src, expected);
});

// ---- renderTrace collapse (re-read cut: all-empty run -> one summary line) --

test('renderTrace collapses to one summary line when every row is na or clean-with-zero-findings', () => {
  const worklist = makeWorklist();
  const results = {};
  for (const row of worklist.rows) {
    results[row.id] = { rowId: row.id, target: row.target, result: 'na', detail: 'gate closed' };
  }
  const state = { version: 1, worklist, results };
  const out = renderTrace(state);
  assert.strictEqual(out, `${worklist.rows.length} rows scanned, 0 findings — nothing to update.`);
  assert.doesNotMatch(out, /\|/); // not a table
});

test('renderTrace collapse also fires when every row is clean with an empty findings array', () => {
  const worklist = makeWorklist();
  const results = {};
  for (const row of worklist.rows) {
    results[row.id] = { rowId: row.id, target: row.target, result: 'clean', detail: 'read, nothing found', findings: [] };
  }
  const state = { version: 1, worklist, results };
  const out = renderTrace(state);
  assert.match(out, /^\d+ rows scanned, 0 findings — nothing to update\.$/);
});

test('renderTrace does NOT collapse when a row is MISSING, even if every present row is empty', () => {
  const worklist = makeWorklist();
  const results = {};
  for (const row of worklist.rows) {
    results[row.id] = { rowId: row.id, target: row.target, result: 'na', detail: 'gate closed' };
  }
  delete results[worklist.rows[0].id];
  const state = { version: 1, worklist, results };
  const out = renderTrace(state);
  assert.match(out, /^\| Target \| Result \| Detail \|/);
  assert.match(out, /MISSING — judge never reported/);
});

test('renderTrace does NOT collapse when any single row has findings', () => {
  const worklist = makeWorklist();
  const results = {};
  for (const row of worklist.rows) {
    results[row.id] = { rowId: row.id, target: row.target, result: 'na', detail: 'gate closed' };
  }
  const firstId = worklist.rows[0].id;
  results[firstId] = {
    rowId: firstId, target: worklist.rows[0].target, result: 'findings', detail: '1 change',
    findings: [{ kind: 'addition', summary: 'x', targetPath: 'y', action: 'applied', stagePath: null, commit: 'a' }],
  };
  const state = { version: 1, worklist, results };
  const out = renderTrace(state);
  assert.match(out, /^\| Target \| Result \| Detail \|/);
});

test('renderTrace does NOT collapse a clean row that (defensively) carries findings', () => {
  const worklist = makeWorklist();
  const results = {};
  for (const row of worklist.rows) {
    results[row.id] = { rowId: row.id, target: row.target, result: 'na', detail: 'gate closed' };
  }
  const firstId = worklist.rows[0].id;
  results[firstId] = {
    rowId: firstId, target: worklist.rows[0].target, result: 'clean', detail: 'unexpected',
    findings: [{ kind: 'addition', summary: 'x', targetPath: 'y', action: 'staged', stagePath: 'staged/x.md', commit: null }],
  };
  const state = { version: 1, worklist, results };
  const out = renderTrace(state);
  assert.match(out, /^\| Target \| Result \| Detail \|/);
});

// ---- renderConsoleSections ------------------------------------------------

function makeConsoleResults() {
  return {
    skills: {
      rowId: 'skills', target: 'Skills', result: 'findings', detail: '2 changes',
      findings: [
        { kind: 'additive', summary: 'Add anti-pattern row', targetPath: '.claude/skills/auth/SKILL.md', action: 'applied', stagePath: null, commit: 'aaa1111' },
        { kind: 'new', summary: 'Create session-management skill', targetPath: '.claude/skills/session-management/SKILL.md', action: 'staged', stagePath: 'staged/skills-1.md', commit: null },
      ],
    },
    docs: { rowId: 'docs', target: 'Docs', result: 'na', detail: 'no changes' },
    journeys: { rowId: 'journeys', target: 'Journeys', result: 'clean', detail: 'Read 1', findings: [] },
    'claude-md': {
      rowId: 'claude-md', target: 'CLAUDE.md & rules', result: 'findings', detail: '3 changes',
      findings: [
        { kind: 'addition', summary: 'Fetch-first rule', targetPath: 'CLAUDE.md', action: 'staged', stagePath: 'staged/claude-md-1.md', commit: null },
        { kind: 'addition', summary: 'IL carve-out', targetPath: 'CLAUDE.md', action: 'staged', stagePath: 'staged/claude-md-2.md', commit: null },
        { kind: 'addition', summary: "new Don't", targetPath: 'CLAUDE.md', action: 'staged', stagePath: 'staged/claude-md-3.md', commit: null },
      ],
    },
    'decision-records': {
      rowId: 'decision-records', target: 'Decision records', result: 'findings', detail: '1 change',
      findings: [
        { kind: 'new', summary: 'ADR: adopt the fetch-first rule', targetPath: 'docs/decisions/0018-fetch-first.md', action: 'staged', stagePath: 'staged/adr-1.md', commit: null },
      ],
    },
    references: {
      rowId: 'references', target: 'Broken references', result: 'findings', detail: '2 changes',
      findings: [
        { kind: 'repair', summary: 'build/setup.md -> build/worktree-setup.md', targetPath: 'docs/plugin-structure.md', action: 'applied', stagePath: null, commit: 'bbb2222' },
        { kind: 'repair', summary: 'build/setup.md -> build/worktree-setup.md', targetPath: 'tests/paths.test.js', action: 'staged', stagePath: 'staged/references-1.md', commit: null },
      ],
    },
    // memory/upstream carry findings too, but must never render here — those
    // are the console's per-item M#/U# sections, owned by console prose.
    memory: {
      rowId: 'memory', target: 'Memory', result: 'findings', detail: '1 change',
      findings: [{ kind: 'feedback', summary: 'THIS MUST NOT RENDER — memory row', targetPath: 'memory/x.md', action: 'staged', stagePath: 'staged/memory-1.md', commit: null }],
    },
    upstream: {
      rowId: 'upstream', target: 'Upstream feedback', result: 'findings', detail: '1 change',
      findings: [{ kind: 'defect', summary: 'THIS MUST NOT RENDER — upstream row', targetPath: 'skills/x/SKILL.md', action: 'staged', stagePath: 'staged/upstream-1.md', commit: null }],
    },
  };
}

test('renderConsoleSections numbers rows globally starting at startAt and reports nextNumber', () => {
  const state = { version: 1, worklist: makeWorklist(), results: makeConsoleResults() };
  const { markdown, nextNumber } = renderConsoleSections(state, { startAt: 5 });

  // Section order: Skill updates, [Documentation/Journey omitted — no
  // findings], Configuration updates (claude-md + decision-records merged),
  // Reference repairs.
  assert.match(markdown, /^#### Skill updates/);
  assert.doesNotMatch(markdown, /#### Documentation updates/);
  assert.doesNotMatch(markdown, /#### Journey updates/);
  assert.match(markdown, /#### Configuration updates/);
  assert.match(markdown, /#### Reference repairs/);

  // Skill updates has 2 rows -> numbered 5, 6. Configuration updates merges
  // claude-md's 3 findings and decision-records' 1 finding -> 7, 8, 9, 10.
  // Reference repairs has 2 findings -> 11, 12. nextNumber = 5 + 8 = 13.
  assert.match(markdown, /^\| 5 \|/m);
  assert.match(markdown, /^\| 6 \|/m);
  assert.match(markdown, /^\| 10 \|/m);
  assert.match(markdown, /^\| 12 \|/m);
  assert.doesNotMatch(markdown, /^\| 13 \|/m);
  assert.strictEqual(nextNumber, 13);

  // memory/upstream findings never leak into these sections.
  assert.doesNotMatch(markdown, /THIS MUST NOT RENDER/);
});

test('renderConsoleSections merges claude-md and decision-records into one Configuration updates section', () => {
  const state = { version: 1, worklist: makeWorklist(), results: makeConsoleResults() };
  const { markdown } = renderConsoleSections(state, { startAt: 1 });
  const matches = markdown.match(/#### Configuration updates/g) || [];
  assert.strictEqual(matches.length, 1);
  assert.match(markdown, /Fetch-first rule/);
  assert.match(markdown, /ADR: adopt the fetch-first rule/);
});

test('renderConsoleSections disposition column: applied carries commit, staged carries stagePath', () => {
  const state = { version: 1, worklist: makeWorklist(), results: makeConsoleResults() };
  const { markdown } = renderConsoleSections(state, { startAt: 1 });
  assert.match(markdown, /\| applied \(aaa1111\) \|/);
  assert.match(markdown, /\| staged \(staged\/skills-1\.md\) \|/);
});

test('renderConsoleSections omits every section when no row has findings', () => {
  const results = makeConsoleResults();
  for (const key of Object.keys(results)) {
    results[key] = { rowId: key, target: results[key].target, result: 'na', detail: 'nothing to do' };
  }
  const state = { version: 1, worklist: makeWorklist(), results };
  const { markdown, nextNumber } = renderConsoleSections(state, { startAt: 3 });
  assert.strictEqual(markdown, '');
  assert.strictEqual(nextNumber, 3);
});

test('renderConsoleSections defaults startAt to 1 when omitted', () => {
  const state = { version: 1, worklist: makeWorklist(), results: makeConsoleResults() };
  const { markdown } = renderConsoleSections(state, {});
  assert.match(markdown, /^\| 1 \|/m);
});

test('renderConsoleSections throws when a finding summary smuggles forbidden vocabulary', () => {
  const results = makeConsoleResults();
  results.skills.findings[0].summary = 'D0 domain-overlap smuggled in';
  const state = { version: 1, worklist: makeWorklist(), results };
  assert.throws(() => renderConsoleSections(state, { startAt: 1 }), /forbidden vocabulary/);
});

// ---- renderConsoleSectionsMulti -------------------------------------------

const { renderConsoleSectionsMulti } = require('../../../plugin/bin/lib/wrap-up/engine-render');

function makeConsoleResultsB() {
  return {
    skills: {
      rowId: 'skills', target: 'Skills', result: 'findings', detail: '1 change',
      findings: [
        { kind: 'additive', summary: 'Add anti-pattern row (spec B)', targetPath: '.claude/skills/other/SKILL.md', action: 'applied', stagePath: null, commit: 'ccc3333' },
      ],
    },
    docs: { rowId: 'docs', target: 'Docs', result: 'na', detail: 'no changes' },
    journeys: { rowId: 'journeys', target: 'Journeys', result: 'clean', detail: 'Read 1', findings: [] },
    'claude-md': { rowId: 'claude-md', target: 'CLAUDE.md & rules', result: 'na', detail: 'no changes' },
    'decision-records': { rowId: 'decision-records', target: 'Decision records', result: 'na', detail: 'no ADR candidates found' },
    references: { rowId: 'references', target: 'Broken references', result: 'na', detail: 'no broken references' },
    memory: { rowId: 'memory', target: 'Memory', result: 'na', detail: 'no insights routed to memory' },
    upstream: { rowId: 'upstream', target: 'Upstream feedback', result: 'na', detail: 'no learnings routed upstream' },
  };
}

test('renderConsoleSectionsMulti merges N specs into one table per section, Spec column right after #, rows in specStates order', () => {
  const stateA = { version: 1, worklist: makeWorklist(), results: makeConsoleResults() };
  const stateB = { version: 1, worklist: makeWorklist(), results: makeConsoleResultsB() };
  const { markdown, nextNumber } = renderConsoleSectionsMulti(
    [{ specId: '157', state: stateA }, { specId: '159', state: stateB }],
    { startAt: 1 },
  );

  // One "Skill updates" heading total (merged, not one per spec).
  const skillHeadings = markdown.match(/#### Skill updates/g) || [];
  assert.strictEqual(skillHeadings.length, 1);

  // Header row: # | Spec | Target | Change | Disposition
  assert.match(markdown, /^\| # \| Spec \| Target \| Change \| Disposition \|$/m);

  // Spec 157's skills row (2 findings) precedes spec 159's skills row (1 finding) within the section.
  const skillsSection = markdown.split('#### Skill updates')[1].split('####')[0];
  const specColumnValues = [...skillsSection.matchAll(/^\| \d+ \| (\d+) \|/gm)].map((m) => m[1]);
  assert.deepStrictEqual(specColumnValues, ['157', '157', '159']);

  // Continuous numbering across specs and sections: 157 contributes 2 (skills) + 3+1 (config) + 2 (refs) = 8 rows; 159 contributes 1 (skills) = 1 row. Total 9 rows, startAt 1 -> nextNumber 10.
  assert.strictEqual(nextNumber, 10);
});

test('renderConsoleSectionsMulti: a spec contributing zero findings to a section contributes zero rows to it', () => {
  const stateA = { version: 1, worklist: makeWorklist(), results: makeConsoleResults() };
  const stateB = { version: 1, worklist: makeWorklist(), results: makeConsoleResultsB() };
  const { markdown } = renderConsoleSectionsMulti(
    [{ specId: '157', state: stateA }, { specId: '159', state: stateB }],
    { startAt: 1 },
  );
  // stateB has zero Configuration-updates findings -> only 157's 4 rows appear there.
  const configSection = markdown.split('#### Configuration updates')[1].split('#### Reference repairs')[0];
  const specColumnValues = [...configSection.matchAll(/^\| \d+ \| (\d+) \|/gm)].map((m) => m[1]);
  assert.deepStrictEqual(specColumnValues, ['157', '157', '157', '157']);
});

test('renderConsoleSectionsMulti omits a section entirely when every given spec has zero findings for it', () => {
  const resultsA = makeConsoleResults();
  resultsA.skills = { rowId: 'skills', target: 'Skills', result: 'na', detail: 'no changes' };
  const stateA = { version: 1, worklist: makeWorklist(), results: resultsA };

  const resultsB = makeConsoleResultsB();
  resultsB.skills = { rowId: 'skills', target: 'Skills', result: 'na', detail: 'no changes' };
  const stateB = { version: 1, worklist: makeWorklist(), results: resultsB };

  const { markdown } = renderConsoleSectionsMulti(
    [{ specId: '157', state: stateA }, { specId: '159', state: stateB }],
    { startAt: 1 },
  );
  assert.doesNotMatch(markdown, /#### Skill updates/);
});

test('renderConsoleSectionsMulti runs assertCleanVocabulary over the full merged output', () => {
  const stateA = { version: 1, worklist: makeWorklist(), results: makeConsoleResults() };
  const resultsB = makeConsoleResultsB();
  resultsB.skills.findings[0].summary = 'D0 domain-overlap smuggled in (spec B)';
  const stateB = { version: 1, worklist: makeWorklist(), results: resultsB };
  assert.throws(
    () => renderConsoleSectionsMulti([{ specId: '157', state: stateA }, { specId: '159', state: stateB }], { startAt: 1 }),
    /forbidden vocabulary/,
  );
});

test('renderConsoleSectionsMulti defaults startAt to 1 when omitted', () => {
  const stateA = { version: 1, worklist: makeWorklist(), results: makeConsoleResults() };
  const { markdown } = renderConsoleSectionsMulti([{ specId: '157', state: stateA }], {});
  assert.match(markdown, /^\| 1 \|/m);
});

test('renderConsoleSectionsMulti does NOT deduplicate two entries sharing the same specId', () => {
  const stateA = { version: 1, worklist: makeWorklist(), results: makeConsoleResults() };
  const { markdown } = renderConsoleSectionsMulti(
    [{ specId: '157', state: stateA }, { specId: '157', state: stateA }],
    { startAt: 1 },
  );
  const skillsSection = markdown.split('#### Skill updates')[1].split('####')[0];
  const specColumnValues = [...skillsSection.matchAll(/^\| \d+ \| (\d+) \|/gm)].map((m) => m[1]);
  // stateA's skills row has 2 findings; passed twice under the same id -> 4 rows, all tagged 157.
  assert.deepStrictEqual(specColumnValues, ['157', '157', '157', '157']);
});

test('renderConsoleSectionsMulti with a single spec matches renderConsoleSections\'s rows plus a Spec column', () => {
  const state = { version: 1, worklist: makeWorklist(), results: makeConsoleResults() };
  const specId = '157';
  const single = renderConsoleSections(state, { startAt: 1 });
  const multi = renderConsoleSectionsMulti([{ specId, state }], { startAt: 1 });

  // renderConsoleSections itself must be byte-for-byte unchanged from before this plan — re-assert its own pinned expectations still hold.
  assert.match(single.markdown, /^#### Skill updates/);
  assert.strictEqual(single.nextNumber, 9);

  assert.strictEqual(multi.nextNumber, single.nextNumber);

  // Structural equivalence: multi's markdown must equal single's markdown
  // with one extra "Spec" column (containing specId) inserted immediately
  // after "#" in the header row, the separator row, and every data row.
  // Section headings and blank lines pass through unchanged.
  const expectedMulti = single.markdown
    .split('\n')
    .map((line) => {
      if (line.startsWith('#### ')) return line;
      if (line === '') return line;
      if (line.startsWith('| # | Target')) return '| # | Spec | Target | Change | Disposition |';
      if (line.startsWith('|---')) return '|---|---|---|---|---|';
      const m = line.match(/^\| (\d+) \| (.*) \|$/);
      if (m) return `| ${m[1]} | ${specId} | ${m[2]} |`;
      return line;
    })
    .join('\n');

  assert.strictEqual(multi.markdown, expectedMulti);
});

// --- #2546: procedure-head registry ---

test('resolveProcedureHeadPath resolves every registered name to a real file under the plugin root', () => {
  for (const [name, relPath] of Object.entries(PROCEDURE_HEADS)) {
    assert.strictEqual(resolveProcedureHeadPath(name), relPath, `registry mismatch for ${name}`);
    assert.ok(
      fs.existsSync(path.join(PLUGIN_ROOT, relPath)),
      `${name} -> ${relPath} does not exist under the plugin root`,
    );
  }
});

test('resolveProcedureHeadPath returns null for an unregistered name', () => {
  assert.strictEqual(resolveProcedureHeadPath('not-a-real-one'), null);
  assert.strictEqual(resolveProcedureHeadPath(''), null);
});

test('PROCEDURE_HEADS names exactly the four files split by #2546, no more, no fewer', () => {
  assert.deepStrictEqual(
    Object.keys(PROCEDURE_HEADS).sort(),
    ['cleanup-procedures-execution', 'curation-engine', 'pr-first-merge', 'review-console'].sort(),
  );
});
