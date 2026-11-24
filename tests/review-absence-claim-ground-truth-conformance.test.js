// tests/review-absence-claim-ground-truth-conformance.test.js — pins #3329: review Step 3's lens
// dispatch warns agents not to infer code state from a plan/spec's own code listings, and a
// reproduction-pair disagreement whose unpaired side claims code is absent gets one grep/Read
// check against the live file before staging — a refuted claim is dropped, not staged. Since #5595 the
// refuted claim's line is composed by reproduction-log.js's absenceRefuted and written by
// log-reproduction-judgment: the bullet names that call and the hold file, and the line text is checked
// against the composer.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { absenceRefuted } = require('../plugin/bin/lib/reproduction-log');
const { formatEntry } = require('../plugin/bin/lib/log-decision/append');

const FILE = path.join(__dirname, '..', 'plugin', 'skills', 'review', 'step3-lens-dispatch.md');
const read = () => readText(FILE);

function between(text, startAnchor, endAnchor) {
  const start = text.indexOf(startAnchor);
  assert.notEqual(start, -1, `missing start anchor: ${startAnchor}`);
  const end = text.indexOf(endAnchor, start);
  assert.notEqual(end, -1, `missing end anchor: ${endAnchor}`);
  return text.slice(start, end);
}

const NOTE = "> **Code state comes from the live file, never from a plan's code listing.**";
const NOTE_END = '> Do **not** `Read` the changed files';
const BULLET = '> - **An unpaired absence claim gets a ground-truth check before it is staged.**';
const ONLY_ONE = "> - Findings present in only one agent's output";
const VACUITY = '> - **Lens 3f vacuity findings need execution evidence';

function assertNote(text) {
  const sec = between(text, NOTE, NOTE_END);
  assert.match(sec, /Tell each dispatched agent explicitly/);
  assert.match(sec, /plan or spec document's code blocks show code to add, not code that exists/);
  assert.match(sec, /never infer that a function, export, or parameter is missing/);
  assert.match(sec, /`Read` or `grep -n` the actual target file/);
  assert.match(sec, /dispatch prompt/);
}

function assertBullet(text) {
  const sec = between(text, BULLET, VACUITY);
  assert.match(sec, /asserts that code is absent/);
  assert.match(sec, /function, export, parameter, or file/);
  assert.match(sec, /`BLOCKED`/);
  assert.match(sec, /one `grep -n` or `Read`/);
  assert.match(sec, /live target file/);
  assert.match(sec, /before any STAGED write for it/);
  assert.match(sec, /not a bare token match/);
  assert.match(sec, /ambiguous hit/);
  assert.match(sec, /put the finding's entry in the hold file \(a `BLOCKED`\/`NEEDS_CONTEXT` reason has none\)/);
  assert.match(sec, /`\{kind: "absence-refuted", path, symbol, command, foundAt: \{path, line\}\}`/);
  assert.match(sec, /log-reproduction-judgment "\{path-J\}" --lens "\{lens\}" --run "\$PIPELINE_RUN_DIR"/);
  assert.match(sec, /before any STAGED write for it \(the `--only unconfirmed` call\)/);
  assert.match(sec, /stays `unconfirmed`/);
  assert.match(sec, /Any other disagreement keeps the `unconfirmed` default/);
  assert.match(sec, /before the cross-lens pass/);
}

test('AC2.1: the lens prompt warns against inferring code state from a plan/spec code listing', () => {
  assertNote(read());
});

test('AC2.1 go-red: dropping the never-infer clause fails the same assertions', () => {
  const mutated = read().replace(/never infer that/g, 'you may infer that');
  assert.throws(() => assertNote(mutated));
});

test('AC1.1: an unpaired absence claim is ground-truth-checked and a refuted one is not staged', () => {
  assertBullet(read());
});

test('AC1.1 go-red: dropping the hold-file outcome fails the same assertions', () => {
  const live = read();
  const mutated = live.replace("put the finding's entry in the hold file", 'stage it');
  assert.notEqual(mutated, live);
  assert.throws(() => assertBullet(mutated), /put the finding/);
});

// The line's wording is pinned once, in tests/bin-lib/reproduction-log.test.js; this rule needs only that the
// refuted claim is an AUTO line that stages nothing and names where the check found the construct.
test('AC1.1: the refuted claim\'s line, from its composer, is an AUTO line that stages nothing', () => {
  const entry = absenceRefuted({ lens: '3a', path: 'src/a.js', symbol: 'checkExpiry', command: 'grep -n checkExpiry src/a.js', foundAt: { path: 'src/b.js', line: 12 } });
  const line = formatEntry({ ...entry, now: new Date(2026, 0, 1, 10, 0, 0) });
  assert.equal(entry.status, 'AUTO');
  assert.match(line, / Not staged\. /);
  assert.doesNotMatch(line, /Staged to Review Console/);
  assert.match(line, /src\/a\.js:checkExpiry /);
  assert.match(line, /found it at src\/b\.js:12\)/);
});

test('placement: note after Scratch path, bullet between only-one and vacuity bullets, both outside Calibration', () => {
  const d = read();
  const scratch = d.indexOf('> **Scratch path (per dispatch).**');
  const note = d.indexOf(NOTE);
  const onlyOne = d.indexOf(ONLY_ONE);
  const bullet = d.indexOf(BULLET);
  const vacuity = d.indexOf(VACUITY);
  const calib = d.indexOf('CALIBRATION (required):');
  for (const [name, i] of Object.entries({ scratch, note, onlyOne, bullet, vacuity, calib })) {
    assert.notEqual(i, -1, `${name} anchor not found`);
  }
  assert.ok(scratch < note, 'note must follow the Scratch path note');
  assert.ok(onlyOne < bullet && bullet < vacuity, 'bullet must sit between the only-one and vacuity bullets');
  assert.ok(bullet < calib, 'bullet must precede the Calibration block');
  const cal = between(d, 'CALIBRATION (required):', 'Self-check before sending');
  assert.doesNotMatch(cal, /code listing|ground-truth/);
});
