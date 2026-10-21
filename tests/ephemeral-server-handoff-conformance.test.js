'use strict';
// #1937 — dispatch two-call hand-off: an ephemeral worktree dev server started in the first
// Task call does not survive into the second. This suite pins the prose additions this record
// makes outside dev-url-detection.md itself: dispatch/task-prompt.md's two fenced templates
// (detach-and-keep in the first call, liveness-recheck-and-restart in the second) and
// wrap-up/cleanup-procedures-execution.md Section D's process-group-kill and
// already-stopped-is-not-an-error clauses.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText, crlfCheckoutRead } = require('./helpers/read-skill');

const PLUGIN = path.join(__dirname, '..', 'plugin');
const TASK_PROMPT = path.join(PLUGIN, 'skills', 'dispatch', 'task-prompt.md');
const CLEANUP_EXEC = path.join(PLUGIN, 'skills', 'wrap-up', 'cleanup-procedures-execution.md');

function fencedBlocks(text) {
  const blocks = [];
  const lines = text.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('```')) continue;
    if (start === -1) { start = i + 1; } else { blocks.push(lines.slice(start, i).join('\n')); start = -1; }
  }
  assert.equal(start, -1, 'unbalanced ``` fences — the last fenced block is unclosed');
  return blocks;
}

test('task-prompt.md still carries exactly two fenced Task-prompt templates (this record adds prose only, no new fences)', () => {
  const text = readText(TASK_PROMPT);
  const blocks = fencedBlocks(text);
  assert.equal(blocks.length, 2, `expected exactly two fenced Task-prompt blocks, found ${blocks.length}`);
});

test("first call's template detaches the ephemeral server and forbids deleting ephemeral-server.txt at call end", () => {
  const text = readText(TASK_PROMPT);
  const [firstCall] = fencedBlocks(text);
  assert.match(firstCall, /start it detached/);
  assert.match(firstCall, /setsid/);
  assert.match(firstCall, /Never delete `ephemeral-server\.txt`/);
  assert.match(firstCall, /the record belongs to the run, not to this call/);
  assert.doesNotMatch(firstCall, /_shared\//, 'must not cite a raw _shared/ path (tests/dispatch-prompt-bundle-citations.test.js)');
});

test("second call's template re-checks liveness before the first browser step and before trace stop, and restarts on a dead pid with the documented log line", () => {
  const text = readText(TASK_PROMPT);
  const [, secondCall] = fencedBlocks(text);
  assert.match(secondCall, /before\s+the first browser-driving step, and again before any `trace stop`/);
  assert.match(secondCall, /verify the recorded pid\s+answers on the recorded port/);
  assert.match(secondCall, /On a dead pid, start a fresh server/);
  assert.match(secondCall, /ephemeral server restarted:\s+recorded pid \{old\} dead, new pid \{new\} on port\s*\{port\}/);
  const livenessIdx = secondCall.indexOf('Ephemeral dev server liveness');
  const livenessParagraphEnd = secondCall.indexOf('\n\n', livenessIdx);
  const livenessParagraph = secondCall.slice(livenessIdx, livenessParagraphEnd === -1 ? undefined : livenessParagraphEnd);
  assert.doesNotMatch(livenessParagraph, /_shared\//, 'the liveness paragraph must not cite a raw _shared/ path (tests/dispatch-prompt-bundle-citations.test.js)');
});

test('Section D kills the process group when detached:yes and never when detached:no', () => {
  const text = readText(CLEANUP_EXEC);
  const idx = text.indexOf('## D. Ephemeral dev server');
  const endIdx = text.indexOf('## E. Issue claim release');
  assert.ok(idx !== -1 && endIdx !== -1 && idx < endIdx);
  const body = text.slice(idx, endIdx);
  assert.match(body, /detached:yes.*also kill the process group/s);
  assert.match(body, /kill -- -\{pid\}/);
  assert.match(body, /never do this when the field reads `detached:no`/);
});

test('Section D logs an already-gone pid as "already stopped", never as an error', () => {
  const text = readText(CLEANUP_EXEC);
  const idx = text.indexOf('## D. Ephemeral dev server');
  const endIdx = text.indexOf('## E. Issue claim release');
  const body = text.slice(idx, endIdx);
  assert.match(body, /already-gone pid is not an error/);
  assert.match(body, /already stopped: pid \{pid\}/);
  assert.match(body, /never surface this as a cleanup failure/);
});

// #3083 — win32 has no process-group primitive, so the recorded PID is
// stopped with a tree kill instead of a leader-only `kill`.
test('Section D stops the recorded pid with a win32 tree kill (taskkill /T /F), independent of the detached: field, and names the platform check', () => {
  const text = readText(CLEANUP_EXEC);
  const idx = text.indexOf('## D. Ephemeral dev server');
  const endIdx = text.indexOf('## E. Issue claim release');
  assert.ok(idx !== -1 && endIdx !== -1 && idx < endIdx);
  const body = text.slice(idx, endIdx);
  assert.match(body, /\*\*win32:\*\*.*taskkill \/PID \{pid\} \/T \/F.*regardless of what the `detached:` field reads/s);
  assert.match(body, /process\.platform/);
});

test('Section D treats a win32 "not found" taskkill result as already-stopped, and any other non-zero exit as a real failure', () => {
  const text = readText(CLEANUP_EXEC);
  const idx = text.indexOf('## D. Ephemeral dev server');
  const endIdx = text.indexOf('## E. Issue claim release');
  const body = text.slice(idx, endIdx);
  assert.match(body, /win32: `taskkill` reporting the PID was not found means the same thing/);
  assert.match(body, /any other non-zero exit \(access-denied or otherwise\) is a real cleanup failure/);
});

// #3664 — one predicate per rule, shared by the live test and its go-red control.
function sectionD(text) {
  const idx = text.indexOf('## D. Ephemeral dev server');
  const endIdx = text.indexOf('## E. Issue claim release');
  assert.ok(idx !== -1 && endIdx !== -1 && idx < endIdx);
  return text.slice(idx, endIdx);
}

function assertRecordGate(body) {
  assert.match(body, /A record that cannot be parsed — fewer than four fields, a pid or port that is not a positive integer, or no trailing `detached:` token — is unprovable: log `SKIP` via `log-decision\.js` naming that condition/);
  assert.match(body, /leave the file and every process alone, signal nothing, and skip the rest of this step and steps 3-4\. Otherwise, \*\*detect the platform first\*\*/);
  const gate = body.indexOf('is unprovable');
  const kills = ['kill {pid}', 'taskkill'].map((s) => body.indexOf(s)).filter((i) => i !== -1);
  assert.ok(gate !== -1 && kills.length > 0 && gate < Math.min(...kills), 'the record gate must sit before the first kill {pid} / taskkill');
}

function assertPortHeldBranch(body) {
  const bare = body.indexOf('Confirm the port is free, then delete `ephemeral-server.txt`');
  const held = body.indexOf('**Port still held after the kill**');
  assert.ok(bare !== -1 && held > bare, 'the port-still-held branch must follow the verbatim step 4 sentence');
  const eol = body.indexOf('\n', held);
  const branch = body.slice(held, eol === -1 ? undefined : eol);
  assert.match(branch, /keep `ephemeral-server\.txt` — do not delete it/);
  assert.match(branch, /log `SKIP` via `log-decision\.js` naming that condition/);
  assert.match(branch, /report a cleanup failure naming the survivor: the recorded pid and the port still held/);
}

test('Section D validates the record before step 2 acts: an unparseable record is unprovable, logged SKIP, and signals nothing', () => {
  assertRecordGate(sectionD(readText(CLEANUP_EXEC)));
});

test("Section D's step 4 keeps the record when the port is still held after the kill, and reports the survivor", () => {
  assertPortHeldBranch(sectionD(readText(CLEANUP_EXEC)));
});

test('go-red: removing the record-gate sentence fails the gate predicate', () => {
  const body = sectionD(readText(CLEANUP_EXEC));
  const mutated = body.replace(/A record that cannot be parsed[^\n]*?skip the rest of this step and steps 3-4\. /, '');
  assert.notEqual(mutated, body);
  assert.throws(() => assertRecordGate(mutated), assert.AssertionError);
});

test('go-red: moving the record-gate sentence after the kill bullets fails the ordering assertion', () => {
  const body = sectionD(readText(CLEANUP_EXEC));
  const bullets = body.match(/^ {3}- \*\*win32:\*\*[^\n]*\n {3}- \*\*POSIX:\*\*[^\n]*\n/m)[0];
  const mutated = body.replace(bullets, '').replace('2. Read the server record', bullets + '2. Read the server record');
  assert.notEqual(mutated, body);
  assert.throws(() => assertRecordGate(mutated), /the record gate must sit before the first kill/);
});

test('go-red: reverting step 4 to the bare sentence fails the port-still-held predicate', () => {
  const body = sectionD(readText(CLEANUP_EXEC));
  const mutated = body.replace(/\*\*Port still held after the kill\*\*[^\n]*?the port still held\./, '');
  assert.notEqual(mutated, body);
  assert.throws(() => assertPortHeldBranch(mutated), assert.AssertionError);
});

// #3083 — the standalone stop path and the Windows Ownership bullet in
// dev-url-detection.md also name the win32 tree kill.
test("dev-url-detection.md's standalone stop names the win32 PID tree kill alongside the POSIX lsof port kill", () => {
  const doc = readText(path.join(PLUGIN, 'skills', '_shared', 'dev-url-detection.md'));
  const idx = doc.indexOf('### Cleanup');
  assert.notEqual(idx, -1);
  const body = doc.slice(idx);
  assert.match(body, /on win32, where `lsof` does not exist, `taskkill \/PID \{pid\} \/T \/F`/);
});

test("dev-url-detection.md's Windows Ownership bullet mentions the tree kill and points to Section D", () => {
  const doc = readText(path.join(PLUGIN, 'skills', '_shared', 'dev-url-detection.md'));
  const idx = doc.indexOf('- **Windows:**');
  const nextBulletIdx = doc.indexOf('\n\n', idx);
  assert.notEqual(idx, -1);
  const body = doc.slice(idx, nextBulletIdx === -1 ? undefined : nextBulletIdx);
  assert.match(body, /stopped as a tree, not a leader-only kill/);
  assert.match(body, /cleanup-procedures-execution\.md` Section D/);
  assert.match(body, /taskkill \/PID \{pid\} \/T \/F/);
});

test('multispec-review-console.md line still delegates to Section D without restating the kill', () => {
  const doc = readText(path.join(PLUGIN, 'skills', 'flow', 'multispec-review-console.md'));
  assert.doesNotMatch(doc, /kill \{pid\}/);
  assert.doesNotMatch(doc, /taskkill/);
  assert.match(doc, /Section D/);
});

test('the ephemeral-server-handoff predicates can actually go red (discrimination proof)', () => {
  const text = readText(TASK_PROMPT);
  const paragraphs = text.split(/\r?\n\r?\n/);
  const kept = paragraphs.filter((p) => !p.startsWith('Ephemeral dev server'));
  assert.equal(
    paragraphs.length - kept.length,
    2,
    'expected to doctor out exactly the two ephemeral-dev-server paragraphs — anchor text not found',
  );
  const blocks = fencedBlocks(kept.join('\n\n'));
  assert.equal(blocks.length, 2);
  assert.doesNotMatch(blocks[0], /start it detached/);
  assert.doesNotMatch(blocks[1], /verify the recorded pid\s+answers on the recorded port/);
});

test('ephemeral-server: the paragraph searches still find their breaks under CRLF line endings (#3574)', () => {
  const DEV_URL_DETECTION = path.join(PLUGIN, 'skills', '_shared', 'dev-url-detection.md');
  for (const FILE of [TASK_PROMPT, DEV_URL_DETECTION]) {
    const { raw, text } = crlfCheckoutRead(FILE);
    assert.ok(raw.includes('\r\n'), 'the CRLF input must contain \\r\\n line breaks');
    assert.ok(!raw.includes('\r\r\n'), 'the CRLF input must not contain \\r\\r\\n');
    assert.strictEqual(raw.indexOf('\n\n'), -1, 'a raw CRLF read has no LF paragraph break');
    assert.strictEqual(text, readText(FILE));
    if (FILE === TASK_PROMPT) {
      const block = fencedBlocks(text)[1];
      const at = block.indexOf('Ephemeral dev server liveness');
      const end = block.indexOf('\n\n', at);
      assert.ok(at !== -1 && end !== -1, 'the liveness paragraph and its break must be found');
      const paragraph = block.slice(at, end);
      assert.ok(paragraph.length > 0);
      const following = block.slice(end + 2).split('\n')[0];
      assert.ok(following.trim().length > 0, 'text must follow the liveness paragraph break');
      assert.ok(!paragraph.includes(following), 'the paragraph must stop at its break, not run into the next paragraph');
    } else {
      const idx = text.indexOf('- **Windows:**');
      const end = text.indexOf('\n\n', idx);
      assert.notStrictEqual(idx, -1);
      assert.notStrictEqual(end, -1);
      assert.match(text.slice(idx, end), /stopped as a tree, not a leader-only kill/);
    }
  }
});
