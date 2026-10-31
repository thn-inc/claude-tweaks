// tests/specify-next-actions-blocked.test.js
//
// Pins #4703's blocker-aware row in /specify's Next Actions table
// (plugin/skills/specify/next-actions.md): the row exists, it reuses the
// `blocked-by` reader from flow's materialize.md, it never bolds a /flow line
// for a blocked record, and the six pre-existing rows render byte-identically.
// The mutation control proves removing the row is what fails the row pin.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const NEXT_ACTIONS = readText(path.join(ROOT, 'plugin/skills/specify/next-actions.md'));

const BLOCKED_ROW = '| Any shaped or produced record has an open blocker (Blocker check above) | 1. `gh issue view #{blocker}` — see what #{N} is waiting on **(Recommended)**, or, when the blocker carries `ready` and no `bot:in-progress` claim, `/claude-tweaks:flow #{blocker}` — clear the blocker first **(Recommended)** instead<br>2. `/claude-tweaks:flow #{N}` — once #{blocker} closes (never bolded)<br>3. for a multi-record run, `/claude-tweaks:flow #{unblocked Ns}` — pipeline only the unblocked records<br>4. `/claude-tweaks:help` — pipeline dashboard |';

const ROW_SHAPING_ONE = '| Shaping mode — one record shaped in place | 1. `/claude-tweaks:flow #{N}` — automated pipeline for record #{N}: "{title}" **(Recommended)**<br>2. `/claude-tweaks:build #{N}` — build only (no test/review/wrap-up)<br>3. `/claude-tweaks:help` — pipeline dashboard |';
const ROW_SHAPING_MULTI = '| Shaping mode — multiple records shaped in place (a comma-separated list) | 1. `/claude-tweaks:flow #{N1},#{N2},...` — sequential pipeline for every record shaped this run **(Recommended)**<br>2. `/claude-tweaks:flow #{N1}` — pipeline just the first shaped record<br>3. `/claude-tweaks:help` — pipeline dashboard |';
const ROW_DECOMP_ONE = '| Decomposition mode — single sub-issue record produced | 1. `/claude-tweaks:flow #{N}` — automated pipeline for record #{N}: "{title}" **(Recommended)**<br>2. `/claude-tweaks:build #{N}` — build only (no test/review/wrap-up)<br>3. `/claude-tweaks:help` — pipeline dashboard |';
const ROW_DECOMP_MULTI = '| Multiple sub-issue records produced from a single phase / single-phase doc | 1. `/claude-tweaks:flow #{N1},#{N2},...,#{Nk}` — sequential pipeline, all sub-issues **(Recommended)**<br>2. `/claude-tweaks:flow #{N1}` — pipeline just the highest-priority sub-issue<br>3. `/claude-tweaks:help` — pipeline dashboard |';
const ROW_PHASE_N = "| Phase-N decomposition with remaining phases in design doc | 1. `/claude-tweaks:flow #{N1},#{N2},...` — pipeline this phase's sub-issues **(Recommended)**<br>2. `/claude-tweaks:specify {doc} phase-{N+1}` — decompose next phase<br>3. `/claude-tweaks:help` — pipeline dashboard |";
const ROW_ALL_PHASES = '| All phases decomposed in one run (large multi-phase decomposition) | 1. `/claude-tweaks:flow #{first-phase-sub-issue-Ns}` — pipeline phase 1 sub-issues first **(Recommended)**<br>2. `/claude-tweaks:flow #{all-sub-issue-Ns}` — pipeline everything sequentially (long-running)<br>3. `/claude-tweaks:help` — see the full dependency graph before deciding |';

function blockedRowLine(text) {
  return text.split('\n').find((line) => line.startsWith('| Any shaped or produced record has an open blocker')) || '';
}

function optionWith(row, needle) {
  return row.split('<br>').find((option) => option.includes(needle)) || '';
}

function assertBlockedRow(text) {
  const row = blockedRowLine(text);
  assert.ok(row, 'Next Actions has no blocked-record row');
  const flat = text.replace(/\s+/g, ' ');
  assert.ok(flat.includes('bin/resolve-blockers.js'), 'the Blocker check must name bin/resolve-blockers.js');
  assert.ok(flat.includes('`skills/flow/materialize.md`\'s `blocked-by`'), "the Blocker check must cite materialize.md's `blocked-by` reader as the one it reuses");
  assert.ok(flat.includes('parseDependencies'), 'the Blocker check must name parseDependencies for the body-text leg');
  assert.ok(flat.includes('facets.blockedBy'), 'the Blocker check must name facets.blockedBy for the local-files leg');
  const ghOption = optionWith(row, '`gh issue view #{blocker}`');
  assert.ok(ghOption.includes('**(Recommended)**'), 'the blocked-record row must bold **(Recommended)** on the gh issue view #{blocker} option');
  const flowOption = optionWith(row, '`/claude-tweaks:flow #{N}`');
  assert.ok(flowOption.includes('once #{blocker} closes'), 'the /flow #{N} option must read "once #{blocker} closes"');
  assert.ok(!flowOption.includes('**(Recommended)**'), 'the /flow #{N} option for a blocked record must never be **(Recommended)**');
}

test('Next Actions carries a blocker-aware row that reuses the blocked-by reader and never bolds /flow for a blocked record (#4703)', () => {
  assertBlockedRow(NEXT_ACTIONS);
});

test('the six pre-existing Next Actions rows stay byte-identical (#4703 AC3)', () => {
  const lines = NEXT_ACTIONS.split('\n');
  for (const row of [ROW_SHAPING_ONE, ROW_SHAPING_MULTI, ROW_DECOMP_ONE, ROW_DECOMP_MULTI, ROW_PHASE_N, ROW_ALL_PHASES]) {
    assert.ok(lines.includes(row), `pre-existing Next Actions row changed or missing: ${row.slice(0, 60)}`);
  }
});

test('AC4 mutation control: removing the blocked-record row is what fails the row pin (#4703)', () => {
  const mutated = NEXT_ACTIONS.replace(BLOCKED_ROW, '');
  assert.notStrictEqual(mutated, NEXT_ACTIONS, 'the mutation must remove the blocked-record row line');
  assert.throws(() => assertBlockedRow(mutated), /Next Actions has no blocked-record row/);
});
