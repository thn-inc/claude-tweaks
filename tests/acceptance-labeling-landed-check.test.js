'use strict';
// #4045: the "has a PR's acceptance labeling landed?" rule has one home,
// `_shared/acceptance-labeling-landed.md`; its three citers state only what they
// do on each outcome. Prose-as-implementation — pin the rule against the live
// text, with a negative control proving the live-state pins can go red.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
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

const CONTRACT = read('plugin', 'skills', '_shared', 'acceptance-labeling-landed.md');
const MERGE = read('plugin', 'skills', '_shared', 'pr-first-merge.md');
const PR_SCAN = read('plugin', 'skills', '_shared', 'github-pr-scan.md');
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
  // The section, not the whole file: the intro names `demo:pending` too.
  assertLive(slice(CONTRACT, '## Live-state tier', '## Outcomes'));
});

test('AC1.2 (live-state tier): negative control — the contract before its Live-state tier fails the pins', () => {
  // Sliced outside the callback so a renamed heading fails here, not inside `throws`.
  const beforeLive = slice(CONTRACT, '# Acceptance Labeling', '## Live-state tier');
  assert.throws(() => assertLive(beforeLive), assert.AssertionError);
});

test('AC1.2 (unreadable verify.json is not rescued): the live-state tier cannot override a read failure', () => {
  const live = slice(CONTRACT, '## Live-state tier', '## Outcomes');
  assert.match(live, /An unreadable `verify\.json` is not rescued by this tier/);
  assert.match(live, /outcome stays `unreadable: verify\.json`/);
});

test('AC1.2 (outcomes): an unreadable outcome takes precedence only over the other not-landed outcomes', () => {
  const outcomes = slice(CONTRACT, '## Outcomes', 'A failed read never counts as landed');
  assert.match(outcomes, /`unreadable: …` outcome from any tier takes precedence over the other not-landed outcomes/);
});

test("AC1.2 (live-state tier): a failed read in one check does not cancel the other check's success", () => {
  const live = slice(CONTRACT, '## Live-state tier', '## Outcomes');
  assert.match(live, /lands when either check positively holds; a failed read in one check does not cancel the other check's success/);
  assert.match(live, /yields `unreadable: \{labels \| comments\}` only when neither check shows landed/);
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

// The files (by key, in insertion order) that define the live-state clause: they
// name both a run comment and the demo:pending label.
function restaters(files) {
  return Object.keys(files).filter((k) => /run-comment: try-it/.test(files[k]) && /demo:pending/.test(files[k]));
}

const CLAUSE_HOLDERS = {
  contract: CONTRACT,
  'pr-first-merge': MERGE,
  'close-out': CLOSE_OUT,
  tidy: TIDY,
  'github-pr-scan': PR_SCAN,
};
const RESTATED_CLAUSE = ' `demo:pending` <!-- run-comment: try-it -->';

test('AC6.1: the live-state clause is defined only in the contract', () => {
  assert.deepStrictEqual(restaters(CLAUSE_HOLDERS), ['contract']);
});

test('AC6.1: negative control — a caller restating the clause fails the pin', () => {
  assert.throws(() => assert.deepStrictEqual(
    restaters({ ...CLAUSE_HOLDERS, 'close-out': CLOSE_OUT + RESTATED_CLAUSE }),
    ['contract'],
  ), assert.AssertionError);
});

test('AC6.1: negative control — a third inline copy in github-pr-scan fails the pin', () => {
  assert.throws(() => assert.deepStrictEqual(
    restaters({ ...CLAUSE_HOLDERS, 'github-pr-scan': PR_SCAN + RESTATED_CLAUSE }),
    ['contract'],
  ), assert.AssertionError);
});

test('AC8.1: skill-graph names the contract on the dispatch and tidy edges', () => {
  const edge = /\| `_shared\/acceptance-labeling-landed\.md` \|/;
  assert.match(slice(SKILL_GRAPH, '## dispatch', '## docs-health'), edge);
  assert.match(slice(SKILL_GRAPH, '## tidy', '## visual-review'), edge);
});

test("AC7.1: no citation names close-out step 3 as the rule's home", () => {
  // plans and the incident log are historical records, not live citations; this file holds the pattern.
  const excluded = (rel) => rel.startsWith(path.join('docs', 'superpowers', 'plans') + path.sep)
    || rel.startsWith(path.join('docs', 'plans') + path.sep)
    || rel === path.join('docs', 'incident-log.md')
    || rel === path.join('tests', path.basename(__filename));
  const stale = /close-out\.md` step 3's (acceptance-labeling )?landed rule|live-state precheck/;
  const offenders = [];
  let scanned = 0;
  for (const dir of ['plugin', 'docs', 'tests']) {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { recursive: true })) {
      const rel = path.join(dir, entry);
      if (!/\.(md|js)$/.test(rel) || excluded(rel)) continue;
      scanned++;
      if (stale.test(readText(path.join(ROOT, rel)).replace(/\s+/g, ' '))) offenders.push(rel);
    }
  }
  assert.ok(scanned > 100, 'the walk must reach the plugin and docs trees');
  assert.deepStrictEqual(offenders, []);
});
