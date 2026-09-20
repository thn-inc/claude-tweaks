'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// #1781: residue-sweep.md states the pr-first disposition for a run's own
// recorded PR explicitly — an `observation` row naming Phase 4's merge
// decision, never `open` and never routed to a backlog record.
test('residue-sweep.md names the own-PR disposition and the --own-pr manual command flag (#1781)', () => {
  const t = read('plugin/skills/wrap-up/residue-sweep.md');
  assert.ok(t.includes('--own-pr'), 'manual command block carries --own-pr');
  assert.ok(t.includes('This run\'s own pr-first PR'), 'own-PR subsection present');
  assert.ok(t.includes('disposition is Phase 4'), 'row names Phase 4 as the disposition');
  assert.ok(!/Status: open.{0,80}own pr-first/s.test(t), 'the own-PR row is never Status: open');
});

test('bin/residue.js documents --own-pr in the command reference (#1781)', () => {
  const t = read('docs/plugin-structure.md');
  assert.ok(t.includes('--own-pr <n>'), 'command reference carries --own-pr');
});
