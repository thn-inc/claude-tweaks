'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// #2423: dispatch/SKILL.md Step 6 unconditionally instructed the dispatching
// session to "Read settle-and-merge.md ... for the full procedure" even on
// the common clean path where neither Settle nor the Auto-merge gate apply.
// The dispatching session's own share of Step 6 is narrow (the local-merge
// fallback's merge execution); everything else runs inside the second Task
// call, whose own template (task-prompt.md) already cites settle-and-merge.md
// conditionally on its own. This pins the narrowed, conditional citation.

test('#2423: Step 6 no longer instructs the dispatching session to read settle-and-merge.md unconditionally', () => {
  const t = read('plugin/skills/dispatch/SKILL.md');
  const step6 = t.slice(t.indexOf('### Step 6: Settle'), t.length);
  assert.ok(!/^Read `settle-and-merge\.md`/m.test(step6), 'no unconditional "Read settle-and-merge.md" imperative at the top of Step 6');
  assert.match(step6, /this dispatching session never reads it on their behalf and gains nothing by reading it up front \(#2423\)/);
});

test('#2423: Step 6 states exactly the one case where the dispatching session itself reads settle-and-merge.md (local-merge, OUTCOME: ready-to-merge)', () => {
  const t = read('plugin/skills/dispatch/SKILL.md');
  const step6 = t.slice(t.indexOf('### Step 6: Settle'), t.length);
  assert.match(step6, /This dispatching session itself reads `settle-and-merge\.md` only for the one piece of Step 6 that runs in its own thread/);
  assert.match(step6, /under `local-merge`.*on `OUTCOME: ready-to-merge`, read the \*\*Dispatching-session merge execution \(local-merge fallback\)\*\* section now/s);
  assert.match(step6, /this dispatching session never reads `settle-and-merge\.md` for a `pr-first` group at all/);
  assert.match(step6, /this session has nothing left to read `settle-and-merge\.md` for — move straight to the next group/);
});

test('#2423: settle-and-merge.md itself is untouched in structure -- every existing citer (task-prompt.md, two-call-gate.md) still resolves without a sweep', () => {
  const settle = read('plugin/skills/dispatch/settle-and-merge.md');
  // The two section headings the narrowed Step 6 text names must still exist,
  // unmoved and unrenamed, since this fix changed WHEN the dispatching
  // session reads the file, never the file's own structure.
  assert.match(settle, /^## Dispatching-session merge execution \(local-merge fallback/m);
  assert.match(settle, /^## Auto-merge gate \(/m);
  for (const rel of ['plugin/skills/dispatch/task-prompt.md', 'plugin/skills/dispatch/two-call-gate.md']) {
    assert.match(read(rel), /settle-and-merge\.md/, `${rel} still cites settle-and-merge.md`);
  }
});
