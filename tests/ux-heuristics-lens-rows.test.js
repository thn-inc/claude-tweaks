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

test('#2707: an unbounded type scale is flagged by the rule it breaks', () => {
  const r = row('Bound the type scale');
  assert.match(r, /not derived from one ratio/);
  assert.match(r, /weights/);
  assert.match(r, /line-height/);
});

test('#2707: paragraph measure outside 45-75 characters is flagged', () => {
  assert.match(row('Cap line length'), /45-75 characters/);
});

test('#2707: numeric UI without tabular figures is flagged', () => {
  assert.match(row('Use tabular figures for numbers'), /tabular-nums/);
});

test('#2709: the seven covered rows name their law, without adding rows', () => {
  const laws = {
    'Reduce choices per screen': "Hick's law",
    'Use large targets': "Fitts's law",
    'Favor familiar patterns': "Jakob's law",
    'Chunk content': "Miller's law",
    'End flows memorably': 'peak-end rule',
    'Group related info': 'law of common region / proximity',
    'Highlight the primary action': 'Von Restorff effect',
  };
  for (const [heuristic, law] of Object.entries(laws)) row(`${heuristic} (${law})`);
  // 20 rows from #2655, plus 3 from #2706 and 3 from #2707; #2709 adds none.
  assert.strictEqual(checklistRows().length, 26);
});

test('#2709: the Chunk content example covers an unchunked numeric identifier', () => {
  assert.match(row("Chunk content (Miller's law)"), /16-digit/);
});

test('#2709: a finding cites its row\'s law by name', () => {
  const start = LENS.indexOf('## Reporting a finding');
  const reporting = LENS.slice(start, LENS.indexOf('\n## ', start + 1));
  assert.match(reporting, /cite that law by name/);
});

test('#2706: a badge must clear on view and a count must tick down', () => {
  const r = row('Clear badges on view');
  assert.match(r, /lingers after the user has viewed/);
  assert.match(r, /resets to zero/);
});
