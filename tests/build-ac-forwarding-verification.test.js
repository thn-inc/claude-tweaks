'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// #496: #360's AC-forwarding instruction (dispatch.md's "Forward the spec's
// Acceptance Criteria to per-task review" paragraph) went two real
// occurrences (the #360 batch itself, record #1537) without ever being
// verified live, because SDD's own scratch directory is gitignored and
// swept by its Cleanup step before /build regains control. These pin the
// standing verification added so a third unverified occurrence can't happen
// silently again.

test('#496: dispatch.md instructs SDD to preserve one composed per-task review prompt under $PIPELINE_RUN_DIR, past its own Cleanup step', () => {
  const t = read('plugin/skills/build/dispatch.md');
  assert.match(t, /\*\*Standing AC-forwarding verification \(#496\)\.\*\*/);
  const section = t.slice(t.indexOf('**Standing AC-forwarding verification (#496).**'));
  assert.match(section, /copy the composed reviewer prompt verbatim to `\$PIPELINE_RUN_DIR\/sdd-dispatch-sample\.txt`/);
  assert.match(section, /so it survives past SDD's own Cleanup step/);
  assert.match(section, /Skip this entirely for a single-task plan/);
});

test('#496: the three verification outcomes (present / absent / no-sample) are each logged, never silently skipped', () => {
  const t = read('plugin/skills/build/dispatch.md');
  const section = t.slice(t.indexOf('**Standing AC-forwarding verification (#496).**'));
  assert.match(section, /\*\*Present:\*\* log `AUTO \{time\} — AC-forwarding verified/);
  assert.match(section, /\*\*Absent from an existing sample file:\*\*/);
  assert.match(section, /file it via `\/claude-tweaks:capture` as its own fix-shaped record/);
  assert.match(section, /\*\*No sample file at all\*\*/);
  assert.match(section, /log-decision\.js --status SKIP --section "\/build"/);
  assert.match(section, /Standalone `\/build` \(no `\$PIPELINE_RUN_DIR`\): skip this verification entirely/);
});
