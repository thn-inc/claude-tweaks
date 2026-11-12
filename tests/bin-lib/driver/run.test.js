'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const {
  STEP_NAMES, FINAL_STEP, STEP, OUTCOMES, STOP_CLASSES,
  outcomeFor, neutralize, normalizeTitle, createEventSink,
} = require(path.join(LIB, 'driver', 'events'));

test('AC14.3: neutralize strips closing refs, mentions, fences, newlines', () => {
  const s = neutralize('Fixes #12 and closes owner/repo#3\n@alice ```rm```');
  assert.doesNotMatch(s, /#\d|\bfixes\b|\bcloses\b|\n|`/i);
  assert.match(s, /@​alice/);
});

test('neutralize: non-string is empty, whitespace runs collapse, result is trimmed', () => {
  assert.equal(neutralize(undefined), '');
  assert.equal(neutralize(42), '');
  assert.equal(neutralize('  a\r\n\t b  '), 'a b');
  assert.equal(neutralize('a `b` c'), "a 'b' c");
  assert.equal(neutralize('x CLOSED y Resolved z'), 'x y z');
  assert.equal(neutralize('prefixes and fixture'), 'prefixes and fixture');
});

test('AC3.4: normalizeTitle keeps first line, drops period and keywords', () => {
  assert.equal(normalizeTitle('Add the loop. Resolves #9.\nsecond line'), 'Add the loop');
  assert.equal(normalizeTitle('Closes #4\n'), '');
  assert.equal(normalizeTitle(null), '');
});

test('AC7: outcomeFor maps every stop class', () => {
  assert.deepEqual(['refused', 'claim', 'pre-push', 'blocked', 'none'].map(outcomeFor),
    ['refused', 'blocked', 'express-escalated', 'blocked', 'pending-review']);
  assert.throws(() => outcomeFor('other'));
});

test('constants: step vocabulary, camelCase map and frozen shapes', () => {
  assert.equal(STEP_NAMES.length, 17);
  assert.equal(STEP_NAMES[0], 'policy');
  assert.equal(STEP_NAMES[STEP_NAMES.length - 1], 'ci');
  assert.equal(FINAL_STEP, 'final');
  assert.equal(STEP.runDir, 'run-dir');
  assert.equal(STEP.recordPr, 'record-pr');
  assert.equal(STEP.setConfig, 'set-config');
  assert.equal(STEP.policy, 'policy');
  assert.equal(Object.keys(STEP).length, STEP_NAMES.length);
  for (const o of [STEP_NAMES, STEP, OUTCOMES, STOP_CLASSES]) assert.ok(Object.isFrozen(o));
  assert.deepEqual(Object.values(OUTCOMES).sort(),
    ['blocked', 'express-escalated', 'pending-review', 'refused']);
});

test('AC5.2: sink holds pre-run-dir lines and flushes them first', () => {
  const out = []; const files = {};
  const sink = createEventSink({ stdout: (s) => out.push(s), appendFile: (p, s) => { files[p] = (files[p] || '') + s; } });
  sink.emit({ step: 'policy', run: null }); sink.emit({ step: 'claim', run: null });
  assert.deepEqual(files, {});
  sink.bindRunDir('/r'); sink.emit({ step: 'worktree', run: 'r' });
  assert.equal(files[path.join('/r', 'driver-events.jsonl')], out.join(''));
  assert.deepEqual(sink.events().map((e) => e.step), ['policy', 'claim', 'worktree']);
  assert.ok(out.every((l) => l.endsWith('\n') && !l.slice(0, -1).includes('\n')));
});
