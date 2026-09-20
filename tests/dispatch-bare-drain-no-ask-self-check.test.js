'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// #2424: an interactive, human-present bare `/dispatch` invocation triggered an
// AskUserQuestion despite the skill's own contract stating bare invocation
// never asks. The Input table row and Step 3's bare-drain description already
// said the right thing but were violated anyway (an instruction-following
// lapse, not a prose gap) -- these pin the broadened "no carve-out" framing
// and the explicit self-check gate added at Step 3's entry point.

test('#2424: the Input table\'s bare-invocation row forbids AskUserQuestion for any undocumented reason, not just the infra-outage carve-out', () => {
  const t = read('plugin/skills/dispatch/SKILL.md');
  const row = t.slice(t.indexOf('| *(none)* |'), t.indexOf('\n', t.indexOf('| *(none)* |')));
  assert.match(row, /No `AskUserQuestion` fires, full stop/);
  assert.match(row, /not for queue size, an unusually large `--budget`, or any other reason this table doesn't name/);
  assert.match(row, /\(#2424\)/);
  assert.match(row, /not a judgment call this table left open/);
});

test('#2424: Step 3 opens with an explicit self-check naming every documented stop, before any AskUserQuestion can be rendered', () => {
  const t = read('plugin/skills/dispatch/SKILL.md');
  const step3 = t.slice(t.indexOf('### Step 3: Select'), t.indexOf('**Zero eligible groups'));
  assert.match(step3, /Self-check before any `AskUserQuestion` in this step \(#2424\)/);
  assert.match(step3, /that is not a\ndocumented case/);
  assert.match(step3, /for a bare invocation specifically it is forbidden outright/);
});

test('#2424: the Input table row and Step 3 self-check stay textually consistent (both cite the same forbidding rule, neither contradicts the other)', () => {
  const t = read('plugin/skills/dispatch/SKILL.md');
  const rowIdx = t.indexOf('| *(none)* |');
  const step3Idx = t.indexOf('### Step 3: Select');
  assert.ok(rowIdx > -1 && step3Idx > -1 && rowIdx < step3Idx, 'Input table row precedes Step 3, so Step 3 can cite it forward');
  assert.match(t.slice(step3Idx), /Input table above/);
});
