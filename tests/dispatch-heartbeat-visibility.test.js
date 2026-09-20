'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// #2427: a dispatched group's Task call ran ~2h40m with no intermediate
// output and no documented way to tell "still working" from "stuck". These
// pin the passive, artifact-polling convention documented as the answer --
// never a mechanism that has the dispatched call yield or check in mid-turn.

test('#2427 AC1+AC3: sequential-execution.md documents a heartbeat convention and keeps "no per-group timeout" with an explicit visibility-over-deadline rationale', () => {
  const t = read('plugin/skills/dispatch/sequential-execution.md');
  assert.match(t, /^## Heartbeat: how a long-running group's progress becomes observable mid-flight \(#2427\)$/m);
  assert.match(t, /the fix for that question is visibility, below, not a deadline/);
  assert.match(t, /There is no per-group timeout/);
});

test('#2427 AC2: the heartbeat convention is explicitly passive -- neither the dispatched call nor the dispatching session does anything different mid-flight', () => {
  const t = read('plugin/skills/dispatch/sequential-execution.md');
  const section = t.slice(t.indexOf('## Heartbeat'));
  assert.match(section, /Not from the dispatched Task call itself/);
  assert.match(section, /recreating the exact stall hazard the Foreground execution clause/);
  assert.match(section, /Not from the dispatching session either, while that Task call is in flight/);
  assert.match(section, /needs no new mechanism/);
  assert.match(section, /decisions\.md/);
  assert.match(section, /manifest\.yml/);
});

test('#2427: the singleton-group granularity gap (no manifest.yml) is named explicitly, not silently glossed over', () => {
  const t = read('plugin/skills/dispatch/sequential-execution.md');
  const section = t.slice(t.indexOf('## Heartbeat'));
  assert.match(section, /A \*\*singleton\*\* group \(1 issue\) has no `manifest\.yml`/);
  assert.match(section, /this is a real, documented granularity gap, not one\nthis record closes/);
});

test('#2427: task-prompt.md cross-references the heartbeat convention beside the Foreground execution clause it must not conflict with', () => {
  const t = read('plugin/skills/dispatch/task-prompt.md');
  assert.match(t, /sequential-execution\.md`'s Heartbeat section \(#2427\)/);
  assert.match(t, /never a\s+reason to relax the Foreground execution clause above or have this call check in mid-turn/);
});
