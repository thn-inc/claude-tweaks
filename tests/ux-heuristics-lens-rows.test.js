'use strict';
// Pins the rows later records added to visual-review's UX heuristics lens
// (#2655's 20-row checklist): each row's rationale is part of the contract,
// since the lens's rows are manual-inspection prompts, not mechanical rules.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LENS = fs.readFileSync(path.join(__dirname, '../plugin/skills/visual-review/ux-heuristics-lens.md'), 'utf8');

function checklistRows() {
  const start = LENS.indexOf('## The checklist');
  const end = LENS.indexOf('\n## ', start + 1);
  assert.ok(start >= 0 && end > start, 'ux-heuristics-lens.md must keep its "## The checklist" section');
  return LENS.slice(start, end).split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| Heuristic') && !l.startsWith('|---'));
}

function row(heuristic) {
  const found = checklistRows().find((l) => l.startsWith(`| ${heuristic} |`));
  assert.ok(found, `no checklist row for "${heuristic}"`);
  return found;
}

test('#2706: a status dot plus a count badge on one element is flagged, with the reason', () => {
  const r = row('One signal per element');
  assert.match(r, /status dot and a count badge on the same element/);
  assert.match(r, /noise/);
  assert.match(r, /learn to ignore/);
});

test('#2706: badge colour must map to meaning, and badging everything is flagged', () => {
  const r = row('Tie badge color to meaning');
  assert.match(r, /red = act now/);
  assert.match(r, /badge everything/i);
});

test('#2706: a badge must clear on view and a count must tick down', () => {
  const r = row('Clear badges on view');
  assert.match(r, /lingers after the user has viewed/);
  assert.match(r, /resets to zero/);
});
