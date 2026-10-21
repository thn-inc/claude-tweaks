// tests/review-cross-lens-corroboration-conformance.test.js — pins #3604: at review-effort `medium`
// a finding reported independently by two different lenses is promoted to `confirmed` by the
// deterministic `review-coordination.js corroborate-cross-lens` pass; `low` and `high`+ are unchanged.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readText, crlfCheckoutRead } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
// Pinned seam: the #3698 CRLF test reads through readAt, so keep every skill read routed here.
const readAt = (abs) => readText(abs);
const read = (...p) => readAt(path.join(SKILLS, ...p));

// Slice between two anchors, asserting both resolve — a missing end anchor would otherwise
// make slice(start, -1) silently widen the region to the rest of the file.
function between(text, startAnchor, endAnchor) {
  const start = text.indexOf(startAnchor);
  assert.notEqual(start, -1, `missing start anchor: ${startAnchor}`);
  const end = text.indexOf(endAnchor, start);
  assert.notEqual(end, -1, `missing end anchor: ${endAnchor}`);
  return text.slice(start, end);
}

const LOG_LINE =
  'AUTO {HH:MM:SS} — Cross-lens corroboration (medium tier): finding {path}:{line} reported independently by lenses {lens list}. Confirmed. Reversibility: high.';
const ONLY_ONE_BULLET = "> - Findings present in only one agent's output";
const SINGLE_READ_RULE =
  'Every finding a single-read agent returns enters as `unconfirmed`, and the only path to `confirmed` is the Direct-verification override';

function bullet(dispatch) {
  const line = dispatch.split('\n').find((l) => l.startsWith(ONLY_ONE_BULLET));
  assert.ok(line, 'only-one-agent bullet not found');
  return line;
}

// Go-red mutation: strip the At `medium` sentence from the bullet line that starts with `prefix`.
function stripAtMedium(dispatch, prefix) {
  return dispatch
    .split('\n')
    .map((l) => (l.startsWith(prefix) ? l.replace(/ At `medium`.*$/, '') : l))
    .join('\n');
}

const CONTESTED_LOG_LINE =
  'AUTO {HH:MM:SS} — Cross-lens corroboration (medium tier): finding {path}:{line} reported independently by lenses {lens list}, severity contested (took the highest). Confirmed. Reversibility: high.';
const PROMOTE_CLAUSE = 'Emit each `corroborated` entry as `confirmed`';
const INPUT_STEP = '1. **Collect the input.**';
const VACUITY_SCOPE = 'however it became `unconfirmed`';
const OVERRIDES_FIRST = 'Direct-verification overrides run before the pass';

function assertPromotes(file) {
  assert.match(file, /corroborate-cross-lens/);
  assert.ok(file.includes(LOG_LINE), 'missing the exact corroboration log line');
  assert.ok(file.includes(CONTESTED_LOG_LINE), 'missing the exact contested corroboration log line');
  assert.ok(file.includes(PROMOTE_CLAUSE), 'missing the promote-to-confirmed clause');
  assert.match(file, /Step 3 Routing/);
}

function inputStep(file) {
  const line = file.split('\n').find((l) => l.startsWith(INPUT_STEP));
  assert.ok(line, 'input step not found');
  return line;
}

function assertInputScope(file) {
  const step = inputStep(file);
  assert.match(step, /vacuity/);
  assert.match(step, /excluded/);
  assert.ok(step.includes(VACUITY_SCOPE), 'vacuity exclusion is not scoped to every route into unconfirmed');
  assert.ok(step.includes('Direct-verification override'), 'vacuity exclusion does not cite the override paragraph');
  assert.ok(step.includes(OVERRIDES_FIRST), 'input step does not order overrides before the pass');
}

function assertKeepsStaged(file, dispatch) {
  assert.match(file, /not reproduced/);
  const b = bullet(dispatch);
  assert.ok(b.includes('At `medium`'), 'bullet does not defer its STAGED write at medium');
  assert.ok(b.includes('step3-cross-lens-corroboration.md'), 'bullet does not cite the new file');
}

const SHARE_LOC_BULLET = '> - Findings at the same location (path exact, line ±2)';

function assertShareLocationDeferred(file, dispatch) {
  const line = dispatch.split('\n').find((l) => l.startsWith(SHARE_LOC_BULLET));
  assert.ok(line, 'share-a-location bullet not found');
  assert.ok(line.includes('At `medium`'), 'share-a-location bullet does not defer its STAGED write at medium');
  assert.ok(line.includes('step3-cross-lens-corroboration.md'), 'share-a-location bullet does not cite the new file');
  assert.match(file, /nearLocation/);
  assert.match(file, /neither side/);
}

function assertTiersUnchanged(file, dispatch) {
  assert.match(file, /never runs at `low` or `high`/);
  assert.ok(dispatch.includes(SINGLE_READ_RULE), 'low single-read rule changed');
}

test('AC1.1: the medium-tier pass promotes cross-lens findings to confirmed and logs the lenses', () => {
  assertPromotes(read('review', 'step3-cross-lens-corroboration.md'));
});

test('AC1.1 go-red: dropping the corroborate-cross-lens command fails the same assertions', () => {
  const mutated = read('review', 'step3-cross-lens-corroboration.md').replace(/corroborate-cross-lens/g, 'corroborate-lenses');
  assert.throws(() => assertPromotes(mutated));
});

test('AC1.2: a finding left unconfirmed keeps its deferred STAGED line', () => {
  assertKeepsStaged(read('review', 'step3-cross-lens-corroboration.md'), read('review', 'step3-lens-dispatch.md'));
});

test('AC1.2 go-red: stripping the At `medium` sentence from the bullet fails the same assertions', () => {
  const dispatch = read('review', 'step3-lens-dispatch.md');
  const mutated = stripAtMedium(dispatch, ONLY_ONE_BULLET);
  assert.notEqual(mutated, dispatch, 'mutation did not change the text');
  assert.throws(() => assertKeepsStaged(read('review', 'step3-cross-lens-corroboration.md'), mutated));
});

test('AC1.2: the share-a-location bullet defers its STAGED write at medium; neither-side-promoted rule is stated', () => {
  assertShareLocationDeferred(read('review', 'step3-cross-lens-corroboration.md'), read('review', 'step3-lens-dispatch.md'));
});

test('AC1.2 go-red: stripping the At `medium` sentence from the share-a-location bullet fails the same assertions', () => {
  const dispatch = read('review', 'step3-lens-dispatch.md');
  const mutated = stripAtMedium(dispatch, SHARE_LOC_BULLET);
  assert.notEqual(mutated, dispatch, 'mutation did not change the text');
  assert.throws(() => assertShareLocationDeferred(read('review', 'step3-cross-lens-corroboration.md'), mutated));
});

test('the only-one-agent bullet stays a single line (decisionLogPattern pin)', () => {
  const dispatch = read('review', 'step3-lens-dispatch.md');
  assert.equal(dispatch.split('\n').filter((l) => l.includes('Findings present in only one')).length, 1);
});

test('AC1.3: the low single-read rule and the high+ debate are unchanged', () => {
  assertTiersUnchanged(read('review', 'step3-cross-lens-corroboration.md'), read('review', 'step3-lens-dispatch.md'));
});

test('AC1.3 go-red: dropping the never-at-low-or-high statement fails the same assertions', () => {
  const mutated = read('review', 'step3-cross-lens-corroboration.md').replace(/never runs at `low` or `high`/g, 'runs everywhere');
  assert.throws(() => assertTiersUnchanged(mutated, read('review', 'step3-lens-dispatch.md')));
});

test('gate: code-mode-steps.md reads the file at medium, before Step 3.5', () => {
  const steps = read('review', 'code-mode-steps.md');
  const sec = between(steps, '### Cross-Lens Corroboration', '### Step 3.5 & 3.6');
  assert.match(sec, /step3-cross-lens-corroboration\.md/);
  assert.match(sec, /`medium`/);
  assert.ok(steps.indexOf('### Cross-Lens Corroboration') < steps.indexOf('### Step 3.5 & 3.6'));
});

test('AC1.1 go-red: dropping the contested log line fails the same assertions', () => {
  const file = read('review', 'step3-cross-lens-corroboration.md');
  const mutated = file.replace(', severity contested (took the highest)', '');
  assert.notEqual(mutated, file, 'mutation did not change the text');
  assert.throws(() => assertPromotes(mutated));
});

test('every lens 3f vacuity finding is excluded from the input; overrides run before the pass', () => {
  assertInputScope(read('review', 'step3-cross-lens-corroboration.md'));
});

test('go-red: narrowing the vacuity exclusion fails the same assertions', () => {
  const file = read('review', 'step3-cross-lens-corroboration.md');
  const mutated = file.replace(VACUITY_SCOPE, 'when downgraded');
  assert.notEqual(mutated, file, 'mutation did not change the text');
  assert.throws(() => assertInputScope(mutated));
});

test('go-red: dropping the overrides-before-the-pass clause fails the same assertions', () => {
  const file = read('review', 'step3-cross-lens-corroboration.md');
  const mutated = file.replace(OVERRIDES_FIRST, 'Overrides may run');
  assert.notEqual(mutated, file, 'mutation did not change the text');
  assert.throws(() => assertInputScope(mutated));
});

test('#3698 AC1.1: on a CRLF checkout both go-red mutations still change the text', (t) => {
  const { raw } = crlfCheckoutRead(path.join(SKILLS, 'review', 'step3-lens-dispatch.md'));
  assert.ok(raw.includes('\r\n'), 'CRLF fixture has no CRLF line endings');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-3698-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tmp = path.join(dir, 'step3-lens-dispatch.md');
  fs.writeFileSync(tmp, raw);
  const text = readAt(tmp);
  for (const [name, prefix] of [
    ['only-one-agent bullet', ONLY_ONE_BULLET],
    ['share-a-location bullet', SHARE_LOC_BULLET],
  ]) {
    assert.notEqual(stripAtMedium(text, prefix), text, `mutation did not change the text (${name})`);
  }
});
