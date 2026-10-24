'use strict';
// #4045: the "has a PR's acceptance labeling landed?" rule has one home,
// `_shared/acceptance-labeling-landed.md`; its three citers state only what they
// do on each outcome. Prose-as-implementation — pin the rule against the live
// text, with a negative control proving the live-state pins can go red.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p)).replace(/\s+/g, ' ');

const slice = (text, from, to) => {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `section ${from} .. ${to} must exist`);
  return text.slice(a, b);
};

const MERGE_PATH = path.join(ROOT, 'plugin', 'skills', '_shared', 'pr-first-merge.md');

const CONTRACT = read('plugin', 'skills', '_shared', 'acceptance-labeling-landed.md');
const MERGE = read('plugin', 'skills', '_shared', 'pr-first-merge.md');
// Tasks 3-4 append tests that use these three.
const CLOSE_OUT = read('plugin', 'skills', 'dispatch', 'close-out.md');
const TIDY = read('plugin', 'skills', 'tidy', 'actions-github-issues.md');
const SKILL_GRAPH = read('docs', 'skill-graph.md');

test('AC1.1: the Landed check has exactly one home', () => {
  assert.match(CONTRACT, /# Acceptance Labeling — the Landed check/);
  assert.doesNotMatch(MERGE, /### Landed check/);
});

test('AC1.2 (run dir): resolution from the validated marker, archive fallback', () => {
  assert.match(CONTRACT, /claude-tweaks-run:/);
  assert.match(CONTRACT, /validat\w+ .{0,60}`flow\/claim-targets\.md/);
  assert.match(CONTRACT, /archive\/\{run-id\}/);
});

test('AC1.2 (verify.json tier): multi-spec read and the pass/skip rule', () => {
  assert.match(CONTRACT, /read every `spec-\*\/verify\.json`/);
  assert.match(CONTRACT, /`acceptance-labeling` row/);
  assert.match(CONTRACT, /pass.{0,12}skip/);
  assert.match(CONTRACT, /every file read exists/);
});

const LIVE_PINS = [
  /demo:pending/,
  /at least one record/,
  /every label read succeeded/,
  /<!-- run-comment: brief -->/,
  /<!-- run-comment: try-it -->/,
  /brief:\{N\}.{0,20}try-it:\{N\}/,
  /Trusted authors/,
];

function assertLive(text) {
  for (const re of LIVE_PINS) assert.match(text, re);
}

test('AC1.2 (live-state tier): the live-state rule lives in the contract', () => {
  assertLive(CONTRACT);
});

test('AC1.2 (live-state tier): negative control — the contract before its Live-state tier fails the pins', () => {
  assert.throws(() => assertLive(slice(CONTRACT, '# Acceptance Labeling', '## Live-state tier')), assert.AssertionError);
});

test('AC1.2 (outcomes): the not-landed outcome vocabulary', () => {
  assert.match(CONTRACT, /`no run dir`/);
  assert.match(CONTRACT, /`verify\.json missing`/);
  assert.match(CONTRACT, /`acceptance-labeling: \{result\}`/);
  assert.match(CONTRACT, /`unparseable`/);
  assert.match(CONTRACT, /`row absent`/);
  assert.match(CONTRACT, /`unreadable: \{verify\.json \| labels \| comments\}`/);
});

test('AC1.2 (failed read): a failed read never counts as landed', () => {
  assert.match(CONTRACT, /A failed read never counts as landed/);
});

test("AC2.1: Step 1's not-landed sentence cites the contract and names no caller", () => {
  const sentence = slice(MERGE, '## Step 1:', '## Step 1.5').match(/Labeling has not landed when.*?reached this merge\./)[0];
  assert.match(sentence, /acceptance-labeling-landed\.md/);
  assert.doesNotMatch(sentence, /close-out/);
  assert.doesNotMatch(sentence, /tidy/);
});

test('AC2.1: pr-first-merge does not grow (merge bundle headroom)', () => {
  assert.ok(Buffer.byteLength(readText(MERGE_PATH)) <= 38412, 'pr-first-merge.md must stay <= 38412 bytes');
});

// Kept referenced so Tasks 3-4's appended tests find them defined.
void [CLOSE_OUT, TIDY, SKILL_GRAPH];
