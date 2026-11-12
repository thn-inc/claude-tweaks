'use strict';
// #5160 AC8/AC9 — `_shared/pr-first-merge.md` Step 2.5 records CI wall time through
// bin/ci-gate-record.js: a start epoch written once on entry from the top (outside the reusable
// state-read fence), a green call before every gate-decided green merge, and a Red-path call whose
// verdict follows the park reason. The writer is a post-hoc recorder: a non-zero exit is a logged
// SKIP that never changes the merge path. Live prose is the declared contract here: this prose is
// new in #5160, so each pin is proved red by mutating the live text in memory
// (.claude/skills/skill-prose-conformance-tests/SKILL.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith } = require('./helpers/conformance-asserts');
const { parseArgs, VERDICTS } = require('../plugin/bin/ci-gate-record.js');

const LIVE = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'pr-first-merge.md'));

const STEP_25 = '## Step 2.5: Merge-verification gate';
const STEP_3 = '## Step 3:';
const RED_PATH = '**Red path — never merge; park.**';
const RED_PATH_END = '**Log the armed outcome too**';
const STEP_4 = '## Step 4 and Step 5';

function sliceBetween(text, start, end, name) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `${name}: start anchor missing (${start})`);
  const to = text.indexOf(end, from);
  assert.notEqual(to, -1, `${name}: end anchor missing (${end})`);
  return text.slice(from, to);
}
const step25Of = (text) => sliceBetween(text, STEP_25, STEP_3, 'Step 2.5');
const redPathOf = (text) => sliceBetween(text, RED_PATH, RED_PATH_END, 'Red path');

// Each pattern matches exactly once in its region (assertEachPatternGoesRed proves it).
const STEP_25_FACTS = [
  [/session-tmp-resolve\.js" [^\n]*GATE_START=gate-start-\{n\}\.txt/, 'resolve'],
  [/Then, on entry from the top only, record the pass start \(`date \+%s > "\{gate-start-path\}"`; a mid-pass re-read never repeats it\) and read state:/, 'epoch'],
  [/before every merge on a gate-decided \*\*green\*\* \(Green column, `wait` re-read, `RC=0`\), never under an explicit `off`:/, 'green-site'],
  [/`--run` follows the per-merged-run rule above\./, 'run-rule'],
  [/```bash\r?\nnode "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/ci-gate-record\.js" [^\n]*--verdict green[^\n]*\r?\n```/, 'green-call'],
  [/A non-zero exit logs `SKIP \{HH:MM:SS\} — Step 2\.5 \(merge-verification gate\): ci-gate not recorded \(\{error\}\)` and the merge path continues unchanged — the writer never gates a merge/, 'skip'],
  [/A Red-path resume is a new gate pass with its own call\./, 'resume'],
  [/Dispatch close-out skips this step, so records nothing;/, 'close-out'],
  [/so do an explicit `off`, an armed merge and a failed read\./, 'no-verdict'],
];
const RED_PATH_FACTS = [
  [/`--verdict timeout-park` for `checks-pending-timeout`, else `--verdict red`/, 'red-mapping'],
];
const ALL_FACTS = [...STEP_25_FACTS, ...RED_PATH_FACTS];

const ciGateFacts = (text) => [
  ...missingFactsOf(STEP_25_FACTS)(step25Of(text)),
  ...missingFactsOf(RED_PATH_FACTS)(redPathOf(text)),
];

const count = (haystack, needle) => haystack.split(needle).length - 1;

const EPOCH_CMD = 'date +%s > "{gate-start-path}"';
const STATE_FENCE = '```bash\ngh pr view';
const EPOCH_MSG = 'epoch must be written once, outside the reusable state-read fence';

function assertEpochOutsideFence(text) {
  const from = text.indexOf(STATE_FENCE);
  assert.notEqual(from, -1, 'state-read fence start missing');
  const to = text.indexOf('```', from + STATE_FENCE.length);
  assert.notEqual(to, -1, 'state-read fence end missing');
  assert.ok(!text.slice(from, to).includes('date +%s'), EPOCH_MSG);
  assert.equal(count(step25Of(text), EPOCH_CMD), 1, EPOCH_MSG);
}

const NEW_PAREN = '(CI-gate record, then re-run its composer call)';
const OLD_PAREN = '(re-run its composer call first)';
const WAIT_ROW = '| `wait` |';
const RC0_START = '`RC=0` → **green**';
const RC0_END = '`RC=1` (a check failed';

const rc0Of = (text) => sliceBetween(text, RC0_START, RC0_END, 'RC=0 bullet');

function assertGreenAfterWatch(text) {
  const waitRow = lineStartingWith(text, WAIT_ROW);
  assert.notEqual(waitRow, '', 'wait table row missing');
  const waitMsg = 'wait green re-read must name the CI-gate record';
  assert.equal(count(waitRow, NEW_PAREN), 1, waitMsg);
  assert.equal(count(waitRow, OLD_PAREN), 0, waitMsg);
  const rc0 = rc0Of(text);
  const rc0Msg = 'RC=0 green must name the CI-gate record';
  assert.equal(count(rc0, NEW_PAREN), 1, rc0Msg);
  assert.equal(count(rc0, OLD_PAREN), 0, rc0Msg);
}

const RED_MAPPING = '`--verdict timeout-park` for `checks-pending-timeout`, else `--verdict red`';

function assertCallSitesOrdered(text) {
  const at = (marker) => {
    const idx = text.indexOf(marker);
    assert.notEqual(idx, -1, `ordering marker missing: ${marker}`);
    return idx;
  };
  const epochAt = at(EPOCH_CMD);
  const greenAt = at('--verdict green');
  const redAt = at(RED_MAPPING);
  const step4At = at(STEP_4);
  assert.ok(epochAt < greenAt, 'epoch capture must precede the green call');
  assert.ok(epochAt < redAt, 'epoch capture must precede the Red-path call');
  assert.ok(greenAt < step4At, 'the green call must precede Step 4');
  assert.ok(redAt < step4At, 'the Red-path call must precede Step 4');
}

const GREEN_FENCE = /```bash\r?\n(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/ci-gate-record\.js" [^\n]*--verdict green[^\n]*)\r?\n```/;
const SHA = 'a'.repeat(40);

function assertGreenFenceParses(text) {
  const m = step25Of(text).match(GREEN_FENCE);
  assert.ok(m, 'green ci-gate-record.js fence missing — nothing to run through parseArgs');
  const line = m[1]
    .replace('"$(cat "{gate-start-path}")"', '1000')
    .replace('{pr-number}', '123')
    .replace('{headRefOid}', SHA)
    .replace('"$PIPELINE_RUN_DIR"', '/tmp/r')
    .replace('{owner}/{repo}', 'o/r');
  const argv = line.split(' ').slice(2);
  assert.ok(argv.every((a) => !/[{}$"]/.test(a)), `green fence has an unsubstituted placeholder for parseArgs: ${argv.join(' ')}`);
  const parsed = parseArgs(argv);
  assert.equal(parsed.error, undefined, `green fence fails ci-gate-record.js parseArgs: ${parsed.error}`);
  assert.equal(parsed.verdict, 'green', 'parseArgs reads the green fence as verdict green');
  assert.equal(parsed.gateStartEpoch, 1000, 'parseArgs reads the epoch from the green fence');
  assert.equal(parsed.pr, 123, 'parseArgs reads --pr from the green fence');
  assert.equal(parsed.headSha, SHA, 'parseArgs reads --head-sha from the green fence');
  assert.equal(parsed.run, '/tmp/r', 'parseArgs reads --run from the green fence');
  assert.equal(parsed.repo, 'o/r', 'parseArgs reads --repo from the green fence');
}

test('AC8.1: Step 2.5 carries the epoch capture, the green call and the Red-path verdict-by-reason mapping', () => {
  assert.deepEqual(ciGateFacts(LIVE), []);
});

test('AC8.1: the start epoch is written once on entry, never inside the state-read fence a mid-pass re-read repeats', () => {
  assertEpochOutsideFence(LIVE);
});

test('AC8.1: every green path after the watch names the CI-gate record before its merge', () => {
  assertGreenAfterWatch(LIVE);
});

test('AC8.2 go-red: the epoch moved into the state-read fence fails the fence pin', () => {
  const anchor = '--json state,mergeStateStatus,mergeable,headRefOid,statusCheckRollup\n';
  assert.equal(count(LIVE, anchor), 1, 'state-read gh pr view line is unique');
  const mutated = LIVE.replace(anchor, `${anchor.slice(0, -1)}\n${EPOCH_CMD}\n`);
  assert.notEqual(mutated, LIVE);
  assert.throws(() => assertEpochOutsideFence(mutated), { message: /epoch must be written once, outside/ });
});

test('AC8.2 go-red: the wait re-read without the record fails, and so does RC=0 without it', () => {
  // The wait row precedes the RC=0 bullet, so the first occurrence is the wait row's.
  const waitRow = lineStartingWith(LIVE, WAIT_ROW);
  assert.ok(waitRow.includes(NEW_PAREN), 'wait row carries the record before the mutation');
  const waitMutated = LIVE.replace(waitRow, waitRow.replace(NEW_PAREN, OLD_PAREN));
  assert.notEqual(waitMutated, LIVE);
  assert.throws(() => assertGreenAfterWatch(waitMutated), { message: /^wait green re-read must name the CI-gate record/ });

  const rc0 = rc0Of(LIVE);
  const rc0Mutated = LIVE.replace(rc0, rc0.replace(NEW_PAREN, OLD_PAREN));
  assert.notEqual(rc0Mutated, LIVE);
  assert.throws(() => assertGreenAfterWatch(rc0Mutated), { message: /^RC=0 green must name the CI-gate record/ });
});

test('AC8.1: both call sites follow the epoch capture and precede Step 4', () => {
  assertCallSitesOrdered(LIVE);
});

test('AC8.1: the green fence parses through ci-gate-record.js parseArgs as verdict green', () => {
  assertGreenFenceParses(LIVE);
});

test('AC8.1: every verdict the Red path names is one ci-gate-record.js accepts', () => {
  const named = [...redPathOf(LIVE).matchAll(/--verdict ([a-z-]+)/g)].map((m) => m[1]);
  assert.deepEqual(named, ['timeout-park', 'red']);
  for (const v of named) assert.ok(VERDICTS.includes(v), `${v} is not a ci-gate-record.js verdict`);
});

test('AC9.2: the SKIP sentence states the writer never gates a merge', () => {
  assert.ok(!ciGateFacts(LIVE).includes('skip'), 'the SKIP sentence is missing from Step 2.5');
  assert.match(step25Of(LIVE), STEP_25_FACTS.find(([, f]) => f === 'skip')[0]);
});

test('AC8.2 AC9.2 go-red: removing each fact returns exactly that fact', () => {
  assertEachPatternGoesRed(LIVE, ALL_FACTS, ciGateFacts);
});

test('AC8.2 go-red: the epoch capture moved after the Red path fails the ordering pin', () => {
  const span = `\`${EPOCH_CMD}\``;
  assert.equal(count(LIVE, span), 1, 'the epoch span is unique');
  const without = LIVE.replace(span, '');
  const at = without.indexOf(RED_PATH_END);
  assert.notEqual(at, -1);
  const mutated = `${without.slice(0, at)}${span}\n\n${without.slice(at)}`;
  assert.notEqual(mutated, LIVE);
  assert.throws(() => assertCallSitesOrdered(mutated), { message: /epoch.*precede/ });

  // The Step 4 bound: the Red-path mapping moved below the Step 4 heading.
  const noMapping = LIVE.replace(RED_MAPPING, '');
  const step4At = noMapping.indexOf(STEP_4);
  const late = `${noMapping.slice(0, step4At)}${STEP_4}\n${RED_MAPPING}${noMapping.slice(step4At + STEP_4.length)}`;
  assert.notEqual(late, LIVE);
  assert.throws(() => assertCallSitesOrdered(late), { message: /^the Red-path call must precede Step 4/ });
});

test('AC8.2 go-red: a renamed flag in the green fence fails the parseArgs pin', () => {
  const mutated = LIVE.replace('--head-sha {headRefOid} --verdict green', '--sha {headRefOid} --verdict green');
  assert.notEqual(mutated, LIVE);
  assert.throws(() => assertGreenFenceParses(mutated), { message: /parseArgs/ });
});

test('AC8.2 go-red: swapping the mapping (red for checks-pending-timeout) returns exactly red-mapping', () => {
  const mutated = LIVE.replace(RED_MAPPING, '`--verdict red` for `checks-pending-timeout`, else `--verdict timeout-park`');
  assert.notEqual(mutated, LIVE);
  assert.deepEqual(ciGateFacts(mutated), ['red-mapping']);
});
