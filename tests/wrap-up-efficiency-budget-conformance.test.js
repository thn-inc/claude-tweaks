'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');

// #4029: phase-timing.js --check-budgets stages an efficiency-budget Queue write
// on a breach. The Review Console reads staged/ at Phase 4, so the check has to
// run in Phase 3 SETTLE — a call site after Phase 4 starts would stage a record
// nobody ever sees. This pins the call site's presence and its position.

const SKILL = readText(path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', 'SKILL.md'));

const HEADING = '### Efficiency budget (#4029)';
const COMMAND =
  'node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "$PIPELINE_RUN_DIR" --auto-transcript --check-budgets';

function assertWired(text) {
  const at = text.indexOf(HEADING);
  assert.notStrictEqual(at, -1, `wrap-up/SKILL.md has no "${HEADING}" subsection`);
  const leftover = text.indexOf('### Leftover work');
  const phase4 = text.indexOf('## Phase 4');
  assert.ok(leftover !== -1 && phase4 !== -1, 'wrap-up/SKILL.md lost its "### Leftover work" or "## Phase 4" anchor');
  assert.ok(
    at > leftover && at < phase4,
    'the efficiency budget subsection must sit in Phase 3 SETTLE, between "### Leftover work" and "## Phase 4"',
  );
  const next = text.indexOf('\n### ', at + HEADING.length);
  const section = text.slice(at, next === -1 ? phase4 : next);
  assert.ok(section.includes(COMMAND), `the subsection must carry the literal command: ${COMMAND}`);
  assert.match(section, /--status SKIP/, 'the subsection must log a SKIP trace for the degrade case');
}

test('#4029: wrap-up Phase 3 runs the efficiency budget check before the Review Console', () => {
  assertWired(SKILL);
});

test('#4029: go-red control — assertWired throws when the subsection is removed', () => {
  const at = SKILL.indexOf(HEADING);
  const next = SKILL.indexOf('\n### ', at + HEADING.length);
  const without = at === -1 ? SKILL : SKILL.slice(0, at) + SKILL.slice(next + 1);
  assert.throws(() => assertWired(without), /no "### Efficiency budget \(#4029\)" subsection/);
});

test('#4029: go-red control — assertWired throws when the subsection is moved past Phase 4', () => {
  const at = SKILL.indexOf(HEADING);
  const next = SKILL.indexOf('\n### ', at + HEADING.length);
  const block = SKILL.slice(at, next + 1);
  const moved = SKILL.slice(0, at) + SKILL.slice(next + 1);
  const phase4 = moved.indexOf('## Phase 4');
  const misplaced = moved.slice(0, phase4) + moved.slice(phase4).replace('\n### ', `\n${block}### `);
  assert.throws(() => assertWired(misplaced), /between "### Leftover work" and "## Phase 4"/);
});

test('#4029: go-red control — assertWired throws when the command loses --check-budgets', () => {
  const mutated = SKILL.replace(' --check-budgets', '');
  assert.throws(() => assertWired(mutated), /literal command/);
});
