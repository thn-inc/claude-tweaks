'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// #1826/#1810: two real occurrences left a run directory with no config.yml
// and no explanatory trace either way -- the Manifesto's write logged no
// absolute path (so a shadow-path write elsewhere in the tree couldn't be
// told apart from a write that never happened at all), and no conditional
// skip on that write path ever logged a SKIP entry. These pin the fix.

test('#1826/#1810: manifesto.md logs the absolute config.yml path on a successful write', () => {
  const t = read('plugin/skills/flow/manifesto.md');
  assert.match(t, /Log the absolute path written \(#1826\/#1810\)\./);
  assert.match(t, /AUTO \{time\} — Manifesto: levers written to \{absolute path of \$PIPELINE_RUN_DIR\/config\.yml\}/);
});

test('#1826: manifesto.md logs a SKIP entry on both legitimate write-skip paths (interactive mode, case 1 adoption)', () => {
  const t = read('plugin/skills/flow/manifesto.md');
  assert.match(t, /Log a `SKIP` on every path where this write does not run \(#1826\)\./);
  const section = t.slice(t.indexOf('Log a `SKIP` on every path where this write does not run'));
  assert.match(section, /interactive mode, no Manifesto this run/);
  assert.match(section, /case 1 adoption, config\.yml already present/);
  assert.match(section, /_shared\/auto-decision-log\.md`'s degrade-trace rule/);
});

test('#1826/#1810: steps-and-gates.md case 3 prefers decisions.md\'s Pipeline config snapshot header over recomputing from the precedence chain', () => {
  const t = read('plugin/skills/flow/steps-and-gates.md');
  const start = t.indexOf('### Adopting an inherited run directory');
  assert.notStrictEqual(start, -1);
  const end = t.indexOf('\n### Partial step lists', start);
  const region = t.slice(start, end === -1 ? t.length : end);
  assert.match(region, /Prefer `decisions\.md`'s "Pipeline config snapshot" header as the lever source, ahead of recomputing from the precedence chain/);
  assert.match(region, /Recompute fresh from the precedence chain only when the header is absent or fails to parse/);
});

test('#1826/#1810: steps-and-gates.md case 3 explicitly covers a completed first call whose config.yml is missing, not only an interrupted one', () => {
  const t = read('plugin/skills/flow/steps-and-gates.md');
  const start = t.indexOf('### Adopting an inherited run directory');
  const end = t.indexOf('\n### Partial step lists', start);
  const region = t.slice(start, end === -1 ? t.length : end);
  assert.match(region, /it may have completed normally/);
  assert.match(region, /Case 3 covers both shapes identically; do not assume interruption before checking/);
});
