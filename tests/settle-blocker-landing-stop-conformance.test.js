// tests/settle-blocker-landing-stop-conformance.test.js — pins #4792: dispatch's Settle treats /flow's
// pre-claim blocker-landing stop (`ISSUE #{n}: failed:blocker-landing`) as a non-failing stop. Pins, in
// file order: settle-and-merge.md's "Blocker-landing special case (#4792)" paragraph (the gate line, the
// claimed-case release and PR tombstone, the unclaimed-case skip, the skipped failure machinery, the
// headless self-report), its placement before Settle step 1, the shared gate token with
// flow/failure-cards.md, step 5's tombstone that the claimed case runs, the pointer's immunity to the
// retry counter, and the skill-graph edge. Test-title ids (AC*) are the acceptance-criterion ids of the
// #4792 spec.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith, sectionOf } = require('./helpers/conformance-asserts');
const { countFailedAttempts } = require('../plugin/bin/lib/issues/retry');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const SETTLE = path.join(SKILLS, 'dispatch', 'settle-and-merge.md');
const FAILURE_CARDS = path.join(SKILLS, 'flow', 'failure-cards.md');
const SKILL_GRAPH = path.join(ROOT, 'docs', 'skill-graph.md');
const SETTLE_PREFIX = '**Blocker-landing special case (#4792).**';
const SETTLE_STEP1 = '1. The CLI in step 2 performs the ownership read itself';

// The live line of `text` starting with `prefix`. Asserts it exists.
function requireLine(text, prefix, name) {
  const line = lineStartingWith(text, prefix);
  assert.ok(line, `${name} has no line starting "${prefix}"`);
  return line;
}

const SETTLE_FACTS = [
  [/`ISSUE #\{n\}: failed:blocker-landing`/, 'AC1.1: Settle recognizes the stop by its gate line'],
  [/on an `open` or `unlanded` out-of-run blocker/, 'AC1.1: names both stopping verdicts'],
  [/treat it as a non-failing stop: the blocker, not the record, is at fault/, 'AC1.1: non-failing stop'],
  [/The claimed case is when this run's `decisions\.md` already carries a `Step 2\.8: claimed #\{n\}` line/, 'AC5.1: the claimed case keys on the Step 2.8 claim line'],
  [/a handoff continuation of either call re-ran the pre-claim checks/, 'AC6.1: the claimed case covers a second call\'s continuation too'],
  [/A `decisions\.md` that cannot be read counts as the claimed case, so step 1's ownership check decides whether a claim is released/, 'a failed decisions.md read holds (counts as claimed), never passes to the unclaimed branch'],
  [/In the claimed case, run steps 1-2 with `--reason "failed: blocker-landing"`/, 'AC2.1: the claimed case releases the claim'],
  [/then step 5's PR tombstone and nothing else of step 5/, 'AC5.1: the claimed case runs only step 5\'s tombstone'],
  [/post the `failure`-kind pointer with the sentence `Stopped: an out-of-run blocker has not landed\. Resume with the ### Resume command in this PR body once it lands\.`/, 'AC5.1: the pointer carries the resume command'],
  [/then `gh pr close` the PR, so the record is not stranded behind the `open-pr` exclusion/, 'AC5.1: the claimed case closes the draft PR'],
  [/When step 2's ownership read exits 4 \(a successor holds the lock\), skip the tombstone too/, 'AC5.1: a successor\'s PR is never tombstoned'],
  [/Otherwise the stop came before any claim of this run's, so skip steps 1-2 and the tombstone/, 'AC2.1: no release or tombstone without a claim of this run\'s'],
  [/no `failure-check` classification/, 'AC2.1: no failure-check'],
  [/no `auto:merge`\/`auto:merge-pending` revocation/, 'AC2.1: auto:merge stays'],
  [/no attempt counted against `dispatch-retry-ceiling`/, 'AC1.1: does not count toward the retry ceiling'],
  [/no failure comment on the issue/, 'AC1.1: no failure comment'],
  [/never reaches `bot:blocked` on this stop/, 'AC1.1: never bot:blocked'],
  [/When `DISPATCH_HEADLESS=1` was set, read `_shared\/headless-self-report\.md`/, 'self-report gated on DISPATCH_HEADLESS=1'],
  [/failing-check-name `flow-step-2\.7b-blocker-landing`/, 'self-report name'],
  [/with the stop message as the diagnostic body \(the `unlanded` card, or the `open` verdict's one-line stop, which has no card\)/, 'the self-report body exists for both verdicts: an `open` stop has no card'],
];
const settleMissing = missingFactsOf(SETTLE_FACTS);

const assertSettle = (text) => assert.deepEqual(
  settleMissing(requireLine(text, SETTLE_PREFIX, 'settle-and-merge.md')),
  [],
  'the Settle special case must state every fact (#4792)',
);

test('AC1.1 AC2.1 AC5.1 AC6.1: Settle settles a blocker-landing stop as a non-failing stop (#4792)', () => {
  assertSettle(readText(SETTLE));
});

test('AC1.2: each Settle blocker-landing fact can go red', () => {
  assertEachPatternGoesRed(requireLine(readText(SETTLE), SETTLE_PREFIX, 'settle-and-merge.md'), SETTLE_FACTS, settleMissing);
});

test('AC1.2: reverting the Settle paragraph turns the suite red', () => {
  const text = readText(SETTLE);
  const chunks = text.split('\n\n');
  const kept = chunks.filter((chunk) => !chunk.startsWith(SETTLE_PREFIX));
  assert.equal(chunks.length - kept.length, 1, 'exactly one chunk must start with the Settle prefix');
  const reverted = kept.join('\n\n');
  assert.notEqual(reverted, text, 'the revert control must change the text');
  assert.throws(() => assertSettle(reverted), /settle-and-merge\.md has no line starting/);
});

test('AC1.1: the special case sits before Settle step 1', () => {
  const placed = (text) => {
    const at = text.indexOf(SETTLE_PREFIX);
    return at >= 0 && at < text.indexOf(SETTLE_STEP1);
  };
  const text = readText(SETTLE);
  assert.ok(text.includes(SETTLE_STEP1), 'Settle step 1 anchor not found');
  assert.ok(placed(text), 'the Blocker-landing special case must precede Settle step 1');

  // Control: a copy with the paragraph removed and re-inserted after the END of step 1's full line
  // must fail the same check.
  const paragraph = requireLine(text, SETTLE_PREFIX, 'settle-and-merge.md');
  const without = text.replace(`${paragraph}\n\n`, '');
  const step1End = without.indexOf('\n', without.indexOf(SETTLE_STEP1));
  assert.notEqual(step1End, -1, 'step 1 line end not found — control cannot discriminate');
  const moved = `${without.slice(0, step1End)}\n\n${paragraph}${without.slice(step1End)}`;
  assert.notEqual(moved, text, 'move anchor not found — control cannot discriminate');
  assert.ok(!placed(moved), 'a paragraph moved after step 1 must turn the placement check red');
});

test('AC1.1: Settle and failure-cards name the same gate', () => {
  const GATE = 'failed:blocker-landing';
  const paragraph = requireLine(readText(SETTLE), SETTLE_PREFIX, 'settle-and-merge.md');
  const cardsLine = requireLine(readText(FAILURE_CARDS), '| Step 2.7b blocker landing', 'failure-cards.md');
  const namesGate = (t) => t.includes(GATE);
  assert.ok(namesGate(cardsLine), 'the failure-cards routing row must name the gate token');
  assert.ok(namesGate(paragraph), 'the Settle paragraph must name the same gate token');

  // Control: a drifted Settle paragraph must fail the same check.
  const drifted = paragraph.replaceAll('blocker-landing', 'blocker-landed');
  assert.notEqual(drifted, paragraph, 'drift anchor not found — control cannot discriminate');
  assert.ok(!namesGate(drifted), 'a Settle paragraph with a drifted gate token must turn the check red');
});

// The claimed case runs step 5's tombstone, so step 5 must still carry it.
const TOMBSTONE_START = '5. Compose the failure comment';
const TOMBSTONE_END = '6. **If `ceilingHit`';
const TOMBSTONE_CHECKS = [
  ['**`run-state.json` carries a `pr` object — this is the failure tombstone**', 'step 5 lost its failure-tombstone block'],
  ['Attempt failed — see the full comment on #%s.', 'step 5 lost the generic failure pointer sentence the claimed case replaces'],
  ['gh pr close {pr-number} --repo {owner}/{repo}', 'step 5 lost the `gh pr close` the claimed case runs'],
];

function assertTombstone(text) {
  const start = text.indexOf(TOMBSTONE_START);
  const end = text.indexOf(TOMBSTONE_END);
  assert.notEqual(start, -1, 'Settle step 5 start anchor not found');
  assert.notEqual(end, -1, 'Settle step 6 start anchor not found');
  assert.ok(start < end, 'Settle step 5 must precede step 6');
  const slice = text.slice(start, end);
  for (const [needle, message] of TOMBSTONE_CHECKS) assert.ok(slice.includes(needle), message);
}

test('AC5.2: step 5 still carries the tombstone the claimed case runs', () => {
  const text = readText(SETTLE);
  assertTombstone(text);

  // Control: a copy with the `gh pr close {pr-number}` line removed must throw that check's message.
  const doctored = text.split('\n').filter((line) => !line.includes('gh pr close {pr-number}')).join('\n');
  assert.notEqual(doctored, text, 'the `gh pr close` anchor was not found — control cannot discriminate');
  assert.throws(() => assertTombstone(doctored), { message: 'step 5 lost the `gh pr close` the claimed case runs' });
});

test('AC5.1: the claimed-case pointer never counts as a failed attempt', () => {
  const paragraph = requireLine(readText(SETTLE), SETTLE_PREFIX, 'settle-and-merge.md');
  const found = paragraph.match(/pointer with the sentence `([^`]+)`/);
  assert.ok(found, 'the paragraph does not carry the pointer sentence');
  const body = `<!-- run-comment: failure -->\n\n${found[1]}`;
  assert.equal(countFailedAttempts([{ body }]), 0, 'the tombstone pointer must not count toward dispatch-retry-ceiling');

  // Counter control: the counter does count a real failed-attempt comment.
  assert.equal(countFailedAttempts([{ body: 'Attempt 1 failed: x' }]), 1, 'countFailedAttempts must count an "Attempt N failed:" body');
});

test('skill-graph names the blocker-landing Settle edge (#4792)', () => {
  const PREFIX = '| `flow/failure-cards.md` |';
  const text = readText(SKILL_GRAPH);
  // The row belongs to `## dispatch`: search that section, not the whole file.
  const rowOf = (t) => {
    const row = lineStartingWith(sectionOf(t, '## dispatch'), PREFIX);
    assert.ok(row, `skill-graph.md's dispatch section has no line starting "${PREFIX}"`);
    return row;
  };
  const row = rowOf(text);
  for (const token of ['failed:blocker-landing', 'flow-step-2.7b-blocker-landing', 'PR tombstone']) {
    assert.ok(row.includes(token), `the skill-graph row must name ${token}`);
  }

  // Control: a copy with that line removed must fail the existence check.
  const without = text.split('\n').filter((line) => !line.startsWith(PREFIX)).join('\n');
  assert.notEqual(without, text, 'row anchor not found — control cannot discriminate');
  assert.throws(() => rowOf(without), /dispatch section has no line starting/);

  // Control: the row moved out of `## dispatch` (to just under `## docs-health`) must fail the same check.
  const moved = without.replace('\n## docs-health\n', `\n## docs-health\n${row}\n`);
  assert.notEqual(moved, without, 'the move control must change the text');
  assert.throws(() => rowOf(moved), /dispatch section has no line starting/);
});

// --- assess-agent-autonomy's failure-check classifies a stray blocker-landing stop (Task 3) ---

const FAILURE_CHECK = path.join(SKILLS, 'assess-agent-autonomy', 'failure-check.md');
const BULLET_PREFIX = '- **Blocker-landing stop**:';

// The bullet is hard-wrapped to match its neighbours: its start line up to, not including, the next
// `- **` bullet or `## ` heading, joined and whitespace-collapsed.
function bulletRange(lines) {
  const start = lines.findIndex((line) => line.startsWith(BULLET_PREFIX));
  assert.notEqual(start, -1, `failure-check.md has no line starting "${BULLET_PREFIX}"`);
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith('- **') && !lines[end].startsWith('## ')) end += 1;
  return { start, end };
}

function bulletOf(text) {
  const lines = text.split('\n');
  const { start, end } = bulletRange(lines);
  return lines.slice(start, end).join(' ').replace(/\s+/g, ' ').trim();
}

const FAILURE_CHECK_FACTS = [
  [/`ISSUE #\{n\}: failed:blocker-landing`/, 'failure-check keys on the gate line'],
  [/Settle skips this mode for it \(`dispatch\/settle-and-merge\.md`'s Blocker-landing special case\)/, 'failure-check cites the Settle special case'],
  [/classify it `transient`/, 'AC2.1: a stray stop classifies transient, so auto:merge is preserved'],
  [/no build or test ran, so no diff is at fault/, 'failure-check states why'],
];
const failureCheckMissing = missingFactsOf(FAILURE_CHECK_FACTS);

const assertFailureCheck = (text) => assert.deepEqual(
  failureCheckMissing(bulletOf(text)),
  [],
  'the failure-check bullet must state every fact (#4792)',
);

test('AC2.1: failure-check.md classifies the blocker-landing stop (#4792)', () => {
  assertFailureCheck(readText(FAILURE_CHECK));
});

test('each failure-check blocker-landing fact can go red', () => {
  assertEachPatternGoesRed(bulletOf(readText(FAILURE_CHECK)), FAILURE_CHECK_FACTS, failureCheckMissing);
});

test('the bullet sits inside Step 2: Judge', () => {
  const JUDGE = '## Step 2: Judge';
  const RENDER = '## Step 3: Render';
  const placed = (text) => {
    const at = text.indexOf(BULLET_PREFIX);
    return text.indexOf(JUDGE) >= 0 && at > text.indexOf(JUDGE) && text.indexOf(RENDER) >= 0 && at < text.indexOf(RENDER);
  };
  const text = readText(FAILURE_CHECK);
  assert.ok(placed(text), 'the Blocker-landing stop bullet must sit between the Step 2 and Step 3 headings');

  // Control: the bullet's lines moved to just after the Step 3 heading line must fail the same check.
  const lines = text.split('\n');
  const { start, end } = bulletRange(lines);
  const bullet = lines.splice(start, end - start);
  const render = lines.findIndex((line) => line.startsWith(RENDER));
  assert.notEqual(render, -1, 'Step 3 heading not found — control cannot discriminate');
  lines.splice(render + 1, 0, ...bullet);
  const moved = lines.join('\n');
  assert.notEqual(moved, text, 'the move control must change the text');
  assert.ok(!placed(moved), 'a bullet moved after the Step 3 heading must fail the placement check');
});

// --- the teardown skips its claim release after a blocker-landing stop (Task 8) ---

const TWO_CALL_GATE = path.join(SKILLS, 'dispatch', 'two-call-gate.md');
const SECTION_E = path.join(SKILLS, 'wrap-up', 'cleanup-procedures-execution.md');
const FLAGS = path.join(SKILLS, 'wrap-up', 'flags.md');
const PACK_JOURNEY = path.join(ROOT, 'docs', 'journeys', 'gather-the-wrap-up-fact-pack-1930.md');
const TEARDOWN_PREFIX = '   **Blocker-landing stop (#4792).**';
const SECOND_CALL_PREFIX = '**Blocker-landing stop (#4792).** A second call\'s handoff continuation';
const SECTION_E_PREFIX = '**Skip it too when the invocation names `blocker-landing: skip the claim release` (#4792)**';
const PHRASE = /`\((blocker-landing:[^)`]*)\)`/;

function requireOrder(text, markers) {
  let last = -1;
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    assert.notStrictEqual(idx, -1, `marker missing: ${marker}`);
    assert.ok(idx > last, `${marker} must come after the previous marker`);
    last = idx;
  }
}

// The text from the line starting `start` to the line starting `end`. Asserts both exist.
function sectionBetween(text, start, end) {
  const from = text.indexOf(`\n${start}`);
  assert.notStrictEqual(from, -1, `section start not found: ${start}`);
  const to = text.indexOf(`\n${end}`, from + 1);
  assert.notStrictEqual(to, -1, `section end not found: ${end}`);
  return text.slice(from + 1, to);
}

const teardownParagraph = (text) => requireLine(text, TEARDOWN_PREFIX, 'two-call-gate.md');
const secondCallParagraph = (text) => requireLine(text, SECOND_CALL_PREFIX, 'two-call-gate.md');

const TEARDOWN_FACTS = [
  [/`ISSUE #\{n\}: failed:blocker-landing`/, 'the teardown keys on the gate line'],
  [/its last handoff continuation \(section 8\)/, 'AC5.1: covers the claimed case reached through a continuation'],
  [/so the paragraph above, on Settle's already-released claim, does not apply/, 'the overlap paragraph does not apply'],
  [/Append the parenthetical `\(blocker-landing: skip the claim release\)` to the cleanup-only invocation above, in both cases/, 'AC2.1: the phrase, in both cases'],
  [/`release-claim\.js` posts a release comment on an absent blob or a tombstone too \(`bin\/lib\/release-claim\/release\.js`\)/, 'states the non-idempotent mechanism'],
  [/a false one when this run never claimed the record, a duplicate when Settle already released it/, 'names both wrong comments'],
  [/the firing goes on to the next group/, 'not a firing stop'],
];
const teardownMissing = missingFactsOf(TEARDOWN_FACTS);

const SECOND_CALL_FACTS = [
  [/A second call's handoff continuation \(section 8\) whose step list includes `test` re-runs `\/flow`'s pre-claim checks/, 'AC6.1: names the path'],
  [/reports `OUTCOME: blocked` with `ISSUE #\{n\}: failed:blocker-landing` before reaching wrap-up, so the group's worktree is still up/, 'AC6.1: the outcome, and why a teardown is owed'],
  [/Make item 1's call for it too, with the parenthetical `\(blocker-landing: skip the claim release\)` appended/, 'AC6.1: the same skip as the first-call path'],
  [/the same phrase section 5's Blocker-landing stop paragraph appends/, 'AC6.1: one phrase for both sections'],
  [/the continuation's own Settle already released the claim and closed the draft PR \(`settle-and-merge\.md`'s Blocker-landing special case, claimed case\)/, 'AC5.1 AC6.1: always the claimed case'],
  [/item 2 does not apply/, 'AC6.1: carves out item 2\'s overlap'],
  [/`release-claim\.js` would post a duplicate release comment on the tombstone/, 'AC6.1: the mechanism'],
];
const secondCallMissing = missingFactsOf(SECOND_CALL_FACTS);

test('AC2.1 AC5.1: two-call-gate.md §5 tells the teardown to skip the claim release after a blocker-landing stop (#4792)', () => {
  const paragraph = teardownParagraph(readText(TWO_CALL_GATE));
  assert.deepEqual(teardownMissing(paragraph), []);
  assertEachPatternGoesRed(paragraph, TEARDOWN_FACTS, teardownMissing);
});

test('the teardown paragraph sits after the overlap paragraph, so both "below" and "above" resolve', () => {
  const MARKERS = ['**Claim permission stop (#4899).**', 'Settle has already released this group\'s claim', '**Blocker-landing stop (#4792).**', 'Only once that cleanup call returns'];
  const text = readText(TWO_CALL_GATE);
  requireOrder(text, MARKERS);

  // Permutation control: the paragraph moved to just after the #4899 paragraph must fail the order check.
  const paragraph = teardownParagraph(text);
  const without = text.replace(`${paragraph}\n\n`, '');
  const permission = requireLine(without, '   **Claim permission stop (#4899).**', 'two-call-gate.md');
  const moved = without.replace(`${permission}\n\n`, `${permission}\n\n${paragraph}\n\n`);
  assert.notEqual(moved, text, 'the move control must change the text');
  assert.throws(() => requireOrder(moved, MARKERS), /must come after/);
});

// §6's paragraph sits after item 3, unindented, inside §6.
function assertSecondCallPlacement(text) {
  const section = sectionBetween(text, '## 6. Terminal path', '## 7. Terminal path');
  const item3 = section.indexOf('3. **Worktree teardown is unaffected by which call reached it.**');
  assert.notStrictEqual(item3, -1, '§6 item 3 not found');
  const at = section.indexOf(SECOND_CALL_PREFIX);
  assert.ok(at > item3, 'the second-call Blocker-landing stop paragraph must sit inside §6, after item 3');
}

test('AC6.1: two-call-gate.md §6 gives a second call\'s continuation the same teardown skip (#4792)', () => {
  const text = readText(TWO_CALL_GATE);
  const paragraph = secondCallParagraph(text);
  assert.deepEqual(secondCallMissing(paragraph), []);
  assertEachPatternGoesRed(paragraph, SECOND_CALL_FACTS, secondCallMissing);
  assertSecondCallPlacement(text);

  // Permutation control: the paragraph moved to just after §5's teardown paragraph must fail placement.
  const without = text.replace(`${paragraph}\n\n`, '');
  const teardown = teardownParagraph(without);
  const moved = without.replace(`${teardown}\n\n`, `${teardown}\n\n${paragraph}\n\n`);
  assert.notEqual(moved, text, 'the move control must change the text');
  assert.throws(() => assertSecondCallPlacement(moved), /must sit inside §6, after item 3/);

  // Deletion control: the paragraph removed throws the existence message.
  assert.notEqual(without, text, 'the deletion control must change the text');
  assert.throws(() => secondCallParagraph(without), /two-call-gate\.md has no line starting "\*\*Blocker-landing stop \(#4792\)\.\*\* A second call's handoff continuation"/);
});

test('AC6.1: §8 item 4 routes a second call\'s blocker-landing blocked to §6 (#4792)', () => {
  const HEADING = '## 8. Continuing a handed-off call';
  const ROUTE = /section 6 for a missing or malformed status line, or for a blocker-landing stop's `blocked`, per its Blocker-landing stop paragraph\)/;
  const sectionEight = (text) => {
    const at = text.indexOf(`\n${HEADING}`);
    assert.notStrictEqual(at, -1, `heading not found: ${HEADING}`);
    return text.slice(at).replace(/\s+/g, ' ');
  };
  const text = readText(TWO_CALL_GATE);
  assert.match(sectionEight(text), ROUTE);

  // Control: the pre-edit clause fails the same match.
  const reverted = text.replace(', or for a blocker-landing stop\'s `blocked`, per its Blocker-landing stop paragraph)', ')');
  assert.notEqual(reverted, text, 'the revert control must change the text');
  assert.doesNotMatch(sectionEight(reverted), ROUTE);
});

test('AC6.1: the phrase both sections append is the one Section E and flags.md declare', () => {
  const samePhrase = (five, six) => {
    const first = five.match(PHRASE);
    const second = six.match(PHRASE);
    assert.ok(first && second, 'both paragraphs must carry the parenthetical phrase');
    assert.equal(first[1], second[1], '§5 and §6 must append the same phrase');
    return first[1];
  };
  const text = readText(TWO_CALL_GATE);
  const phrase = samePhrase(teardownParagraph(text), secondCallParagraph(text));
  assert.ok(requireLine(readText(SECTION_E), SECTION_E_PREFIX, 'cleanup-procedures-execution.md').includes(`\`${phrase}\``), 'Section E must name the same phrase');
  assert.ok(readText(FLAGS).includes(`\`(${phrase})\``), 'flags.md must declare the phrase in parentheses');

  // Control: a §6 copy spelling the phrase differently fails the equality.
  const drifted = secondCallParagraph(text).replace('blocker-landing: skip the claim release', 'blocker-landing: skip claim release');
  assert.notEqual(drifted, secondCallParagraph(text), 'the drift control must change the text');
  assert.throws(() => samePhrase(teardownParagraph(text), drifted), /§5 and §6 must append the same phrase/);

  // Control: a §6 copy with the phrase removed fails the existence half.
  const absent = secondCallParagraph(text).replace(PHRASE, '');
  assert.notEqual(absent, secondCallParagraph(text), 'the removal control must change the text');
  assert.throws(() => samePhrase(teardownParagraph(text), absent), /both paragraphs must carry the parenthetical phrase/);
});

test('AC2.1 AC6.1: Section E skips its release on the blocker-landing phrase and logs the skip (#4792)', () => {
  const text = readText(SECTION_E);
  const clause = requireLine(text, SECTION_E_PREFIX, 'cleanup-procedures-execution.md').replace(/\s+/g, ' ');
  assert.match(clause, /`dispatch\/two-call-gate\.md` §5 or §6/);
  assert.match(clause, /log-decision\.js" --run "\$PIPELINE_RUN_DIR" --status SKIP --section "\/wrap-up" --step "Section E" --text "condition: blocker-landing named by the cleanup-only call → fallback: claim release skipped" --reversibility n\/a/);
  assert.match(clause, /`flags\.md`'s `cleanup-only` entry declares the phrase/);

  requireOrder(text, ['## E. Issue claim release', 'Skip this whole section when the invocation names `claim-permission-denied', SECTION_E_PREFIX, 'This spec\'s record is identified whenever this section runs']);

  // Control: a copy with the clause line removed throws the existence message.
  const without = text.split('\n').filter((line) => !line.startsWith(SECTION_E_PREFIX)).join('\n');
  assert.notEqual(without, text, 'the removal control must change the text');
  assert.throws(() => requireLine(without, SECTION_E_PREFIX, 'cleanup-procedures-execution.md'), /cleanup-procedures-execution\.md has no line starting "\*\*Skip it too when the invocation names/);
});

test('flags.md declares the blocker-landing phrase beside #4899\'s', () => {
  const DECLARED = /`\(blocker-landing: skip the claim release\)` \(#4792\), each stripped before input classification like a flag and never read as a record reference/;
  const PRIOR = /`\(claim-permission-denied: skip the claim release\)`[^\n]*stripped before input classification[^\n]*never read as a record reference/;
  const text = readText(FLAGS);
  assert.match(text, DECLARED);
  assert.match(text, PRIOR);

  // Control: the blocker-landing declaration removed fails the first match and leaves the second.
  const stripped = text.replace(' and `(blocker-landing: skip the claim release)` (#4792)', '');
  assert.notEqual(stripped, text, 'the removal control must change the text');
  assert.doesNotMatch(stripped, DECLARED);
});

test('the fact-pack journey names both phrases that skip Section E and the pack', () => {
  const SENTENCE = '`claim-permission-denied: skip the claim release` (#4899), `prompt-not-dispatched: skip the claim release` (#4589) or `blocker-landing: skip the claim release` (#4792), any of which skips Section E and the pack with it';
  const text = readText(PACK_JOURNEY);
  assert.ok(text.includes(SENTENCE), 'the journey must name all three skip phrases');

  // Control: the pre-edit sentence does not carry the second phrase.
  const reverted = text.replace(SENTENCE, '`claim-permission-denied: skip the claim release` (#4899), which skips Section E and the pack with it');
  assert.notEqual(reverted, text, 'the revert control must change the text');
  assert.ok(!reverted.includes(SENTENCE));
});
