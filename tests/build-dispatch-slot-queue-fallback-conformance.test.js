'use strict';
// tests/build-dispatch-slot-queue-fallback-conformance.test.js — pins record #5257: a per-task
// implementer whose verify.js run queues for the machine-wide test-suite slot (a sibling session
// holds it) must not return BLOCKED for that contention alone. dispatch.md's Affected-set testing
// (#5117) rule tells it to stop its own queued run by its own PID, run the fallback focused set,
// say so in its reply, and commit, with Common Step 5's run staying the branch's one suite run.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const ROOT = path.join(__dirname, '..');
const DISPATCH = readText(path.join(ROOT, 'plugin', 'skills', 'build', 'dispatch.md'));

// The queued-slot sentence as pinned. Frozen copy so the go-red checks can mutate it.
const SLOT_SENTENCE =
  'An implementer whose run waits on a test-suite slot (`waiting for a test-suite slot`, or is still queued after the bound its output states) never ends BLOCKED for that alone — slot contention alone is not a `BLOCKED` status: it stops its own queued run by the PID it captured at start (never a name-based kill), runs the fallback set itself through the project\'s test command, says so in its reply, and commits on that set; Common Step 5\'s run stays the branch\'s one suite run, so the fallback loses no coverage.';

function assertSlotQueueFallback(text) {
  assert.ok(
    text.includes(SLOT_SENTENCE),
    'dispatch.md must carry the queued-slot fallback sentence verbatim (#5257): a slot-queued implementer runs the focused fallback set, reports it, commits, and is never BLOCKED for slot contention alone.'
  );
  assert.match(
    text,
    /slot contention alone is not a `BLOCKED` status/,
    'dispatch.md must state that slot contention alone is not a BLOCKED status (#5257).'
  );
  assert.match(
    text,
    /stops its own queued run by the PID it captured at start/,
    'dispatch.md must direct the implementer to stop only its own queued run by its captured PID (#5257).'
  );
}

test('dispatch.md: a queued test-suite slot never makes the implementer BLOCKED, and it falls back to the focused set and commits (#5257)', () => {
  assertSlotQueueFallback(DISPATCH);
});

test('the #5257 pin goes red when the queued-slot sentence is removed or weakened (go-red)', () => {
  assert.throws(() => assertSlotQueueFallback(DISPATCH.split(SLOT_SENTENCE).join('')));
  assert.throws(() => assertSlotQueueFallback(DISPATCH.split('slot contention alone is not a `BLOCKED` status: ').join('')));
  assert.throws(() => assertSlotQueueFallback(DISPATCH.split('it stops its own queued run by the PID it captured at start').join('it waits')));
});
