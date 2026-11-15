'use strict';
// tests/dispatch-express-routing-prose.test.js — #4025: pins /dispatch's express-lane routing.
// SKILL.md Step 5 routes an eligible singleton to express-prompt.md's express call (gate, verify,
// escalation back to the ordinary first call); Step 3's loop termination runs the post-merge
// sampling sweep; express-prompt.md carries exactly two fenced Task templates whose
// clean-room-facing parts (context pack, status line, model profile, OUTCOME vocabulary) are
// pinned per block, and whose Foreground execution paragraph — plus the express call's
// working-directory and no-stash paragraphs — equal task-prompt.md's first call's after
// whitespace normalization. All of it is new prose in this change, so every go-red control
// mutates the live text in memory (skill-prose-conformance-tests).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith, sectionOf } = require('./helpers/conformance-asserts');

const DISPATCH = path.join(__dirname, '..', 'plugin', 'skills', 'dispatch');
const SKILL = path.join(DISPATCH, 'SKILL.md');
const EXPRESS_PROMPT = path.join(DISPATCH, 'express-prompt.md');
const TASK_PROMPT = path.join(DISPATCH, 'task-prompt.md');
const REPORTING = path.join(DISPATCH, 'reporting.md');

// The text between two anchors; both must resolve, so a lost end anchor cannot widen the region.
function between(text, start, end) {
  const s = text.indexOf(start);
  assert.notEqual(s, -1, `start anchor not found: ${start}`);
  const e = text.indexOf(end, s + start.length);
  assert.notEqual(e, -1, `end anchor not found: ${end}`);
  return text.slice(s, e);
}
const step5 = (text) => between(text, '### Step 5: Dispatch', '### Step 6: Settle');
const loopTermination = (text) => between(text, '**At loop termination', '**`next` (deprecated alias');

function fencedBlocks(text) {
  const blocks = [];
  const lines = text.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('```')) continue;
    if (start === -1) start = i + 1;
    else { blocks.push(lines.slice(start, i).join('\n')); start = -1; }
  }
  assert.equal(start, -1, 'unbalanced ``` fences — the last fenced block is unclosed');
  return blocks;
}

// Strip one fact's match from the live region; the predicate must report exactly that fact.
const assertEachFactGoesRed = (text, facts) => assertEachPatternGoesRed(text, facts, missingFactsOf(facts));

const STEP5_FACTS = [
  [/When `express-lane` resolves `true` \(`resolve-policy\.js --values express-lane`, read once per firing\)/, 'no gate call when the lane is off'],
  [/express-lane\.js" gate --issue \{n\} --run "\{minted-run-dir\}"/, 'gate before the first call'],
  [/after Step 4's mint and before `sibling-session-check\.md`'s bind/, 'gate between the mint and the bind'],
  [/or any non-zero exit, is not eligible: take the normal path/, 'any non-zero gate exit → the normal path'],
  [/An eligible singleton is bound without `--dispatch` — the #3225 config gate guards a `\/flow`-framed run, and the express agent writes `config\.yml` only once its PR exists/, 'eligible singleton bound without --dispatch, and why'],
  [/`express-prompt\.md`'s express call/, 'eligible → the express call from express-prompt.md'],
  [/`sequential-execution\.md`'s status-line check applies/, 'the status-line check applies'],
  [/express-lane\.js verify --run "\{minted-run-dir\}" --issue \{n\}` exits 0/, 'verify exit 0 ends the group'],
  [/\(non-zero: `blocked`\)/, 'verify non-zero is blocked'],
  [/`express-escalated` → re-bind with `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.js" record-worktree --run "\{minted-run-dir\}" "\{worktree\}" --dispatch`/, 'express-escalated → re-bind with --dispatch'],
  [/then the ordinary first call \(same run dir, same worktree\)/, 'express-escalated → the ordinary first call'],
  [/, `NEEDS_CONTEXT`\/`BLOCKED` or a malformed status → `two-call-gate\.md` §5/, 'blocked or a failed status → §5'],
  [/`blocked` \(the express call already ran Settle\)/, 'Settle already ran, scoped to blocked only'],
  [/a verify-derived `blocked` ran no Settle: its claim lapses via TTL/, 'a verify-derived blocked is unsettled, stated'],
  [/`settle-and-merge\.md`'s Drain-overlap hold/, 'counts for the drain-overlap hold'],
];
const LOOP_FACTS = [
  [/When `express-lane` resolves `true`/, 'only when express-lane is on'],
  [/express-lane\.js" samples`/, 'samples verb'],
  [/`express-prompt\.md`'s review call per sampled PR, sequentially/, 'one review call per sampled PR, sequentially'],
];

test('SKILL.md Step 5 routes an eligible singleton through the express lane', () => {
  assert.deepEqual(missingFactsOf(STEP5_FACTS)(step5(readText(SKILL))), []);
});

test('go-red control: each Step 5 express fact stripped reports exactly itself', () => {
  assertEachFactGoesRed(step5(readText(SKILL)), STEP5_FACTS);
});

test('SKILL.md Step 3 loop termination runs the post-merge sampling sweep', () => {
  assert.deepEqual(missingFactsOf(LOOP_FACTS)(loopTermination(readText(SKILL))), []);
});

test('go-red control: each loop-termination fact stripped reports exactly itself', () => {
  assertEachFactGoesRed(loopTermination(readText(SKILL)), LOOP_FACTS);
});

const EXPRESS_FACTS = [
  [/\{context-pack\}/, 'context pack'],
  [/^GROUP: \{issue\}$/m, 'GROUP line'],
  [/^MANIFEST: /m, 'MANIFEST line'],
  [/`STATUS: \{WORD\}`/, 'status line'],
  [/^\[Use: Capable\] -- [^\n]*#3212/m, 'Use: Capable with the #3212 evidence'],
  [/resolve-profile\.js" capable`/, 'capable resolve-profile call'],
  [/On outcome `blocked`, before reporting, run Step 6's Settle/, 'Settle runs on blocked'],
  [/only its Claim-contest\s+special case/, 'claim failure → the claim-contest special case'],
  [/--reason "failed: express-\{step\}"/, 'Settle reason names the express step'],
];
const REVIEW_FACTS = [
  [/\{context-pack\}/, 'context pack'],
  [/^PR: #\{pr\}$/m, 'PR line'],
  [/^FINDINGS: \{k\} \(filed as #a, #b\)$/m, 'FINDINGS line'],
  [/`STATUS: \{WORD\}`/, 'status line'],
  [/^\[Use: Standard\] -- /m, 'Use: Standard'],
  [/resolve-profile\.js" standard`/, 'standard resolve-profile call'],
];

function expressBlocks() {
  const blocks = fencedBlocks(readText(EXPRESS_PROMPT));
  assert.equal(blocks.length, 2, `express-prompt.md must carry exactly two fenced templates, found ${blocks.length}`);
  return { express: blocks[0], review: blocks[1] };
}

// The one OUTCOME line's vocabulary, braces stripped.
function outcomeVocab(block) {
  const lines = block.split('\n').filter((l) => l.startsWith('OUTCOME: '));
  assert.equal(lines.length, 1, `expected exactly one OUTCOME line, found ${lines.length}`);
  return lines[0].slice('OUTCOME: '.length).replace(/^\{|\}$/g, '').split(/\s*\|\s*/);
}

test('express-prompt.md: both templates carry their clean-room facts', () => {
  const { express, review } = expressBlocks();
  assert.deepEqual(missingFactsOf(EXPRESS_FACTS)(express), [], 'express call');
  assert.deepEqual(missingFactsOf(REVIEW_FACTS)(review), [], 'post-merge sample review call');
});

test('go-red control: each template fact stripped reports exactly itself', () => {
  const { express, review } = expressBlocks();
  assertEachFactGoesRed(express, EXPRESS_FACTS);
  assertEachFactGoesRed(review, REVIEW_FACTS);
});

test('express-prompt.md: OUTCOME vocabularies are exactly the express outcomes and `reviewed`', () => {
  const { express, review } = expressBlocks();
  assert.deepEqual(outcomeVocab(express), ['merged', 'armed', 'pending-review', 'express-escalated', 'blocked']);
  assert.deepEqual(outcomeVocab(review), ['reviewed']);
});

test('go-red control: a dropped or added outcome breaks the vocabulary check', () => {
  const { express, review } = expressBlocks();
  const dropped = express.replace(' | express-escalated', '');
  assert.notEqual(dropped, express);
  assert.notDeepEqual(outcomeVocab(dropped), outcomeVocab(express));
  const added = review.replace('OUTCOME: reviewed', 'OUTCOME: {reviewed | skipped}');
  assert.notEqual(added, review);
  assert.notDeepEqual(outcomeVocab(added), ['reviewed']);
});

// One blank-line paragraph per prefix, whitespace-collapsed.
function paragraph(block, prefix) {
  const found = block.split(/\n\n/).filter((p) => p.startsWith(prefix));
  assert.equal(found.length, 1, `expected exactly one "${prefix}" paragraph, found ${found.length}`);
  return found[0].replace(/\s+/g, ' ').trim();
}
const FOREGROUND = 'Foreground execution (required):';
const WORKDIR = 'Working directory:';
const NO_STASH = 'Never run `git stash`';
const firstCall = () => fencedBlocks(readText(TASK_PROMPT))[0];

test('both templates restate the first call\'s Foreground execution paragraph verbatim', () => {
  const { express, review } = expressBlocks();
  const canonical = paragraph(firstCall(), FOREGROUND);
  assert.equal(paragraph(express, FOREGROUND), canonical, 'express call');
  assert.equal(paragraph(review, FOREGROUND), canonical, 'post-merge sample review call');
});

test('the express call copies the first call\'s working-directory and no-stash paragraphs', () => {
  const { express } = expressBlocks();
  for (const prefix of [WORKDIR, NO_STASH]) assert.equal(paragraph(express, prefix), paragraph(firstCall(), prefix), prefix);
});

test('go-red control: a reworded copied paragraph fails, a rewrapped one does not', () => {
  const { express, review } = expressBlocks();
  const canonical = paragraph(firstCall(), FOREGROUND);
  for (const block of [express, review]) {
    const reworded = block.replace('never with `run_in_background`', 'with `run_in_background`');
    assert.notEqual(reworded, block);
    assert.notEqual(paragraph(reworded, FOREGROUND), canonical);
    const rewrapped = block.replace(`${FOREGROUND} run`, `${FOREGROUND}\nrun`);
    assert.notEqual(rewrapped, block);
    assert.equal(paragraph(rewrapped, FOREGROUND), canonical);
  }
  for (const [prefix, from, to] of [[WORKDIR, 'Do NOT create', 'You may create'], [NO_STASH, 'make a temporary WIP commit', 'stash it']]) {
    const reworded = express.replace(from, to);
    assert.notEqual(reworded, express);
    assert.notEqual(paragraph(reworded, prefix), paragraph(firstCall(), prefix), prefix);
  }
});

// The dispatcher-facing text of each template's section: from its heading to its fence.
const preambleOf = (heading) => between(readText(EXPRESS_PROMPT), heading, '\n```\n');
const HEADLESS_FACTS = [
  [/decides whether to add the line `DISPATCH_HEADLESS=1` as its first line, above `Task scope:`/, 'headless marker decided by the dispatching session'],
  [/omit it entirely \(no `\{headless-marker\}` placeholder/, 'no placeholder in the copied block'],
];
const REVIEW_PREAMBLE_FACTS = [
  [/this session then runs that section's close-run for `\{minted-run-dir\}`/, 'the dispatching session closes the sampling run dir'],
  [/a `reviewed` reply's `FINDINGS` line, filed record numbers included, goes into this firing's report/, 'I2: the filed findings reach the drain report'],
];
// The marker never lives inside the fenced block: no placeholder, no literal first line.
const markerInBlock = (block) => block.includes('{headless-marker}') || /^DISPATCH_HEADLESS=1/m.test(block);

test('express-prompt.md: the headless marker is decided outside the fenced express call', () => {
  assert.deepEqual(missingFactsOf(HEADLESS_FACTS)(preambleOf('## Express call')), []);
  assert.equal(markerInBlock(expressBlocks().express), false);
});

test('go-red control: each headless fact stripped reports itself, and a marker inside the block is caught', () => {
  assertEachFactGoesRed(preambleOf('## Express call'), HEADLESS_FACTS);
  const { express } = expressBlocks();
  assert.equal(markerInBlock(`DISPATCH_HEADLESS=1\n${express}`), true);
  assert.equal(markerInBlock(`{headless-marker}${express}`), true);
});

test('express-prompt.md: the review call\'s run dir is closed by the dispatching session', () => {
  assert.deepEqual(missingFactsOf(REVIEW_PREAMBLE_FACTS)(preambleOf('## Post-merge sample review call')), []);
  assertEachFactGoesRed(preambleOf('## Post-merge sample review call'), REVIEW_PREAMBLE_FACTS);
});

const SIBLING = path.join(DISPATCH, 'sibling-session-check.md');
const SIBLING_FACTS = [
  [/An express-eligible singleton is bound with the same call minus `--dispatch`/, 'the bind names the express exception'],
  [/`express-lane\.js gate` runs first, before this bind/, 'the express gate runs before the bind'],
];

test('sibling-session-check.md: the #3225 bind names the express-lane exception', () => {
  const bind = between(readText(SIBLING), '**Bind the run before call 1 (#3225).**', '`{worktree}` is the group');
  assert.deepEqual(missingFactsOf(SIBLING_FACTS)(bind), []);
  assertEachFactGoesRed(bind, SIBLING_FACTS);
});

const REPORTING_FACTS = [
  [/A driver group's block \(`driver-route\.md`\) names its outcome as `driver: \{outcome\}`[^.]*omits the timing line: no Task transcript exists for the driver call, and the line is never composed by hand/, 'a driver group\'s block and its omitted timing line'],
  [/`express: \{outcome\}`/, 'express block names its outcome'],
  [/the one express call's transcript/, 'timing line takes the one express call\'s transcript'],
];

test('reporting.md: an express group\'s block and timing line', () => {
  assert.deepEqual(missingFactsOf(REPORTING_FACTS)(readText(REPORTING)), []);
});

test('go-red control: each reporting fact stripped reports exactly itself', () => {
  assertEachFactGoesRed(readText(REPORTING), REPORTING_FACTS);
});

// #5232: the driver route. SKILL.md carries one conditional pointer to driver-route.md and no
// drive.js call; driver-route.md carries the Closed rule, the order, the call, the read, the outcome
// mapping and the decline log. All of it is new prose in this change, so every go-red control
// mutates the live text in memory, behind an assert.notEqual that the mutation landed.
const ROUTE = path.join(DISPATCH, 'driver-route.md');
const { OUTCOMES } = require('../plugin/bin/lib/driver/events');
const { parseArgs } = require('../plugin/bin/lib/driver/run');

const mutate = (text, from, to) => {
  const out = text.replace(from, to);
  assert.notEqual(out, text, `mutation did not land: ${from}`);
  return out;
};

// AC3.2: exactly one driver-route.md mention, inside a sentence carrying the off condition; no drive.js.
function assertOnePointerNoDriveCall(text) {
  const hits = text.match(/driver-route\.md/g) || [];
  assert.equal(hits.length, 1, `SKILL.md must name driver-route.md exactly once, found ${hits.length}`);
  const sentence = text.split('\n\n').find((p) => p.includes('driver-route.md'))
    .split(/(?<=\.)\s+/).find((s) => s.includes('driver-route.md'));
  assert.match(sentence, /unless it resolves `off`/, 'the pointer sentence must carry its off condition');
  assert.equal(/drive\.js/.test(text), false, 'SKILL.md must name no drive.js call');
}
const POINTER_START = '**Driver route (#5232).**';
const pointerParagraph = (text) => text.split('\n\n').find((p) => p.startsWith(POINTER_START));

test('AC3.2: SKILL.md names driver-route.md in exactly one conditional pointer and names no drive.js call', () => {
  assertOnePointerNoDriveCall(readText(SKILL));
});

test('go-red control: a drive.js mention, a duplicated pointer, or the pointer moved out of its condition fails', () => {
  const text = readText(SKILL);
  assert.throws(() => assertOnePointerNoDriveCall(`${text} drive.js`));
  const pointer = pointerParagraph(text);
  assert.ok(pointer, 'pointer paragraph not found');
  assert.throws(() => assertOnePointerNoDriveCall(mutate(text, pointer, `${pointer}\n\n${pointer}`)));
  const movedOut = mutate(text, '`driver-route.md` in this skill\'s directory', 'the driver route') + '\n\nRead `driver-route.md` in this skill\'s directory.\n';
  assert.throws(() => assertOnePointerNoDriveCall(movedOut));
});

test('AC3.3: express-driver is resolved by the same resolve-policy.js call as express-lane', () => {
  const pattern = /`resolve-policy\.js --values express-lane express-driver`/;
  const text = readText(SKILL);
  assert.match(pointerParagraph(text), pattern);
  assert.doesNotMatch(mutate(text, pattern, '`resolve-policy.js --values express-driver`'), pattern);
});

const routeText = () => readText(ROUTE);
const closedRule = (text) => sectionOf(text, '## Closed rule');

// Each Closed rule row: its State cell's opening, then the facts its own line must carry.
const CLOSED_ROWS = [
  ['| `express-driver` resolves `off`, or to a value other than `off`, `split`, `on`, or cannot be read |',
    /\| `driver-route\.md` is not read, no `drive\.js` call is made, today's path applies \|/, 'AC3.1: off, unknown or unreadable → not read, no drive.js call'],
  ['| `split` or `on`, record is a singleton group |',
    /\| `drive\.js --check` runs, whatever `express-lane` resolves/, 'split or on singleton → --check whatever express-lane resolves'],
  ['| `--check` exits non-zero, prints no line, prints a line that is not one JSON object, or the object\'s `admitted` field is missing or not `true` |',
    /\| today's path \(the express gate when `express-lane` resolves `true`, else the normal path\); one `SKIP` line/, 'AC4.2: a --check that does not admit → today\'s path plus one SKIP'],
  ['| `--check` admits |',
    /\| `drive\.js \{n\} --run "\{minted-run-dir\}" --no-settle --in-flight-prs "\{drain-prs\}"` runs as one background Bash call [^|]*; no express gate call is made for this record \|/, 'AC5.1: admits → drive.js --run as one background call, no express gate'],
  ['| a bundle group |',
    /\| today's path; the route is never consulted \|/, 'a bundle group → today\'s path, never consulted'],
];
const missingRowsOf = (rows) => (text) => rows.filter(([prefix, pattern]) => !pattern.test(lineStartingWith(text, prefix))).map(([, , fact]) => fact);

test('driver-route.md: the Closed rule has exactly its five rows, each with its result', () => {
  const section = closedRule(routeText());
  const rows = section.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| State |'));
  assert.equal(rows.length, 5, `expected five Closed rule rows, found ${rows.length}`);
  assert.deepEqual(missingRowsOf(CLOSED_ROWS)(section), []);
  assert.match(section, /A state not listed here is refused with one line naming the state, and the record takes today's path\./);
});

test('go-red control: each Closed rule result stripped from its row, or moved to another row, reports itself', () => {
  const section = closedRule(routeText());
  for (const [prefix, pattern, fact] of CLOSED_ROWS) {
    const line = lineStartingWith(section, prefix);
    assert.deepEqual(missingRowsOf(CLOSED_ROWS)(mutate(section, line, line.replace(pattern, '| x |'))), [fact]);
  }
  // Move-out: swap the results of the first and last rows.
  const first = lineStartingWith(section, CLOSED_ROWS[0][0]);
  const last = lineStartingWith(section, CLOSED_ROWS[4][0]);
  const cell = (l) => l.slice(l.lastIndexOf(' |', l.length - 3) + 2);
  const swapped = mutate(mutate(section, first, first.replace(cell(first), cell(last))), last, last.replace(cell(last), cell(first)));
  assert.deepEqual(missingRowsOf(CLOSED_ROWS)(swapped), [CLOSED_ROWS[0][2], CLOSED_ROWS[4][2]]);
});

test('driver-route.md: the order is mint → --check → bind without --dispatch → --run', () => {
  const items = sectionOf(routeText(), '## Order').split('\n').filter((l) => /^\d+\. /.test(l));
  const ORDER = [/^1\. Step 4 mints `\{minted-run-dir\}`/, /^2\. Run `drive\.js --check` before any bind/, /^3\. .*Admitted: bind without `--dispatch`/, /^4\. .*`drive\.js --run`/];
  const check = (list) => list.length === ORDER.length && ORDER.every((re, i) => re.test(list[i]));
  assert.equal(check(items), true, `order items: ${JSON.stringify(items)}`);
  assert.equal(check([items[0], items[2], items[1], items[3]]), false, 'go-red: --check after the bind must fail');
});

const ROUTE_FACTS = [
  [/before any bind, because its verdict decides the bind's form/, 'the check precedes the bind, and why'],
  [/A bind that does not print its `claude-tweaks: worktree recorded for \{run-id\}` line is a state the Closed rule does not list: refuse it with the one line naming the state, write one `SKIP` line \(Logging a decline\), and take today's path[^.]*so `--run` never runs unbound/, 'a failed bind → the refusal line, one SKIP, today\'s path'],
  [/the #3225 config gate guards a `\/flow`-framed run, and the driver writes `config\.yml` only once its PR exists/, 'bound without --dispatch, and why'],
  [/`--run` refuses a run directory whose `run-state\.json` does not name this worktree/, 'the bind precedes --run, and why'],
  [/Claim nothing yourself: the driver claims the record under `\{minted-run-dir\}`'s basename/, 'dispatch never claims before --run'],
  [/as one Bash call with `run_in_background: true`/, 'one background Bash call'],
  [/prefix it with `cd \{worktree-path\} &&`/, 'cwd-pinned case prefix (#447)'],
  [/`\{drain-prs\}` is the path `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/session-tmp-resolve\.js" --value dispatch-drain-prs\.json` prints/, 'the drain-PR list path'],
  [/When that file does not exist yet, write `\[\]` to it with the Write tool first/, 'Review Focus 1: [] written when the list is absent'],
  [/When this firing's queue pull wrote `dispatch-near-dup-pairs\.json`, pass `--near-dup-pairs "\{near-dup-pairs\}"` too/, 'near-dup pairs passed whenever the firing wrote them'],
  [/Always pass `--in-flight-prs`: without it the driver applies no drain-overlap hold/, 'AC9.2: the route always passes --in-flight-prs'],
  [/The hold and the merge are driver code/, 'AC5.9/AC5.10: the hold and the merge are driver code'],
  [/No model performs the merge/, 'AC5.11: no model performs the merge'],
  [/Never `sleep` or poll while the driver runs\. End the turn and wait for the background task's completion notification/, 'AC6.1: no sleep, wait for the notification'],
  [/^```bash\ntail -n 3 \{output-file\}\n```$/m, 'the tail -n 3 read itself'],
  [/the final event line is the last line above that marker/, 'Review Focus 4: the final line is the last line above [exited with code N]'],
  [/appends a blank line and `\[exited with code N\]`/, 'Review Focus 4: the harness marker named'],
  [/Any other word, no final line, a final line that is not one JSON object, or a non-zero exit that left no parseable final line \(the `--run` guard's exit 3 included\) is `blocked` through `two-call-gate\.md` §5/, 'AC5: the catch-all is blocked through §5'],
  [/a guard failure is a dispatch-side defect, never routed onward to today's path/, 'AC5: a guard failure is a dispatch-side defect'],
  [/When `\{minted-run-dir\}\/decisions\.md` carries no `Step 2\.8: claimed #\{n\}` line — always so after exit 3, which writes nothing — the driver took no claim: §5's cleanup-only call appends `\(driver-no-claim: skip the claim release\)`/, 'no final line and no claim log → the skip parenthetical'],
  [/A `decisions\.md` that cannot be read counts as claimed\. A non-zero exit that did leave a parseable final line is not this case: route its outcome word by the table/, 'an unreadable log counts as claimed; a non-zero exit with a final line routes by its word'],
  [/run `drain-pr-overlap\.md`'s Step 5 list write as it runs after the express call/, 'AC5.7: the Step 5 list write after the call'],
  [/The group counts for `settle-and-merge\.md`'s Drain-overlap hold like any auto-merge group/, 'AC5.8: counts for the Drain-overlap hold'],
  [/Report it by `reporting\.md`'s driver-group sentence/, 'the report block per reporting.md'],
  [/Write no model-selection log line for the group/, 'no model-selection log line'],
  [/log-decision\.js" --run "\{minted-run-dir\}" --status SKIP --step "Driver route \(skipped\)" --reversibility n\/a --text-file "\{text-file\}"/, 'the SKIP line via log-decision.js --text-file'],
];

test('driver-route.md: the route\'s facts', () => {
  assert.deepEqual(missingFactsOf(ROUTE_FACTS)(routeText()), []);
});

test('go-red control: each route fact stripped reports exactly itself', () => {
  assertEachFactGoesRed(routeText(), ROUTE_FACTS);
});

// AC5: each outcome word's own row carries its mapping.
const outcomeTable = (text) => sectionOf(text, '## Outcome words');
const OUTCOME_ROWS = [
  ['| `merged` |', /the group ends once `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/express-lane\.js" verify --run "\{minted-run-dir\}" --issue \{n\}` exits 0 \(non-zero: `blocked`/, 'AC5.2: merged → verify exit 0 ends the group, non-zero blocked'],
  ['| `armed` |', /\| as `merged` \|/, 'AC5.2: armed as merged'],
  ['| `pending-review` |', /\| as `merged` \|/, 'AC5.2: pending-review as merged'],
  ['| `express-escalated` |', /re-bind with `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.js" record-worktree --run "\{minted-run-dir\}" "\{worktree\}" --dispatch`, then the ordinary first call on the same run dir and the same worktree/, 'AC5.3: express-escalated re-binds with --dispatch, then the ordinary first call'],
  ['| `blocked` |', /this session runs `settle-and-merge\.md`'s Step 6 Settle for the record/, 'AC5.5: blocked → dispatch\'s Settle'],
  ['| `blocked` |', /the deliberate exception to that file's rule that Settle never runs in dispatch's main thread: no Task call exists for this group, and the driver ran with its settle off/, 'blocked: Settle in this thread is the named exception'],
  ['| `blocked` |', /`stop\.reason` is `claim-exit-7`, it is dispatch's Claim permission stop/, 'claim-exit-7 → the Claim permission stop'],
  ['| `blocked` |', /the firing ends, as for `failed:claim-permission-denied`/, 'claim-exit-7 ends the firing'],
  ['| `blocked` |', /Then `two-call-gate\.md` §5/, 'AC5.5: blocked → then §5'],
  ['| `refused` |', /take today's path for the record, with one `SKIP` line/, 'AC5.6: refused → today\'s path plus one SKIP'],
  ['| `refused` |', /when `express-lane` resolves `true`, the express gate runs/, 'AC5.6: refused re-decides the bind through the express gate'],
  ['| `refused` |', /on anything but an eligible verdict, re-bind with `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.js" record-worktree --run "\{minted-run-dir\}" "\{worktree\}" --dispatch` before the ordinary first call/, 'AC5.6: refused re-binds with --dispatch before the ordinary first call'],
];

test('driver-route.md: each outcome word\'s row carries its mapping', () => {
  assert.deepEqual(missingRowsOf(OUTCOME_ROWS)(outcomeTable(routeText())), []);
});

test('go-red control: each outcome mapping stripped from its row, or moved to another row, reports itself', () => {
  const table = outcomeTable(routeText());
  for (const [prefix, pattern, fact] of OUTCOME_ROWS) {
    const line = lineStartingWith(table, prefix);
    assert.deepEqual(missingRowsOf(OUTCOME_ROWS)(mutate(table, line, line.replace(pattern, 'x'))), [fact]);
  }
  const merged = lineStartingWith(table, '| `merged` |');
  const escalated = lineStartingWith(table, '| `express-escalated` |');
  const swap = (l, other) => `${l.slice(0, l.indexOf(' |', 2) + 2)}${other.slice(other.indexOf(' |', 2) + 2)}`;
  const swapped = mutate(mutate(table, merged, swap(merged, escalated)), escalated, swap(escalated, merged));
  assert.deepEqual(missingRowsOf(OUTCOME_ROWS)(swapped), [OUTCOME_ROWS[0][2], OUTCOME_ROWS[3][2]]);
});

// AC5.4: the table's words, both directions, against the driver's own vocabulary.
const outcomeWords = (text) => outcomeTable(text).split('\n').map((l) => /^\| `([a-z-]+)` \|/.exec(l)).filter(Boolean).map((m) => m[1]);
const sameSet = (a, b) => a.length === new Set(a).size && a.length === b.length && b.every((w) => a.includes(w));

test('AC5.4: the outcome words driver-route.md maps equal the driver\'s OUTCOMES', () => {
  const words = outcomeWords(routeText());
  assert.equal(words.length, new Set(words).size, `a word has two rows: ${words}`);
  assert.deepEqual(new Set(words), new Set(Object.values(OUTCOMES)));
});

test('go-red control: a driver word without a row, a dropped row, or a row for an unknown word fails', () => {
  const text = routeText();
  const words = outcomeWords(text);
  const outcomes = Object.values(OUTCOMES);
  assert.equal(sameSet(words, outcomes), true);
  assert.equal(sameSet(words, [...outcomes, 'parked']), false);
  assert.equal(sameSet(words.slice(1), outcomes), false);
  const refusedRow = lineStartingWith(text, '| `refused` |');
  assert.equal(sameSet(outcomeWords(mutate(text, refusedRow, `${refusedRow}\n| \`parked\` | x |`)), outcomes), false);
});

const PARITY_PATTERNS = [[/\bodd\b/i, ' odd'], [/\beven\b/i, ' even'], [/parity/i, ' parity'], [/`auto:/, ' `auto:merge`'], [/`size:/, ' `size:low`'], [/`risk:/, ' `risk:low`'], [/`ceremony:/, ' `ceremony:light`'], [/% ?2\b/, ' n % 2']];

test('AC4.1: driver-route.md states no parity, label or number rule', () => {
  const text = routeText();
  for (const [pattern] of PARITY_PATTERNS) assert.doesNotMatch(text, pattern);
});

test('go-red control: each parity, label or number token appended is caught', () => {
  const text = routeText();
  for (const [pattern, token] of PARITY_PATTERNS) assert.match(`${text}${token}`, pattern, token);
});

// The fenced drive.js lines, as drive.js's own parseArgs reads them.
function driveLines(text) {
  const lines = [];
  // A fence may sit indented under a list item: anchor on the line start, indentation allowed.
  for (const m of text.matchAll(/^[ \t]*```bash\r?\n([\s\S]*?)\r?\n[ \t]*```/gm)) {
    for (const line of m[1].split(/\r?\n/)) if (line.includes('/bin/drive.js"')) lines.push(line.trim());
  }
  return lines;
}
function parseDriveLine(line) {
  const sub = line.replace(/\{n\}/g, '7').replace(/\{minted-run-dir\}/g, '/r/x y')
    .replace(/\{drain-prs\}/g, '/t/dispatch-drain-prs.json').replace(/\{near-dup-pairs\}/g, '/t/dispatch-near-dup-pairs.json');
  const tokens = [...sub.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1] : m[2]));
  assert.equal(tokens[0], 'node', line);
  assert.match(tokens[1], /\/bin\/drive\.js$/, line);
  return parseArgs(tokens.slice(2));
}
const RUN = { records: [7], settle: false, runDir: '/r/x y', inFlightPrsFile: '/t/dispatch-drain-prs.json' };
const EXPECTED_PARSES = [{ check: 7 }, RUN, { ...RUN, nearDupPairsFile: '/t/dispatch-near-dup-pairs.json' }];

test('the route\'s drive.js command lines parse through drive.js\'s own parseArgs', () => {
  const lines = driveLines(routeText());
  assert.deepEqual(lines.map(parseDriveLine), EXPECTED_PARSES);
  assert.deepEqual(driveLines(routeText().replace(/\n/g, '\r\n')), lines, 'a CRLF copy extracts the same lines');
});

test('go-red control: a dropped --no-settle or an unquoted spaced run dir fails the parse', () => {
  const text = routeText();
  const noSettle = mutate(text, '--run "{minted-run-dir}" --no-settle --in-flight-prs "{drain-prs}"\n', '--run "{minted-run-dir}" --in-flight-prs "{drain-prs}"\n');
  assert.notDeepEqual(driveLines(noSettle).map(parseDriveLine), EXPECTED_PARSES);
  const unquoted = mutate(text, '--run "{minted-run-dir}" --no-settle --in-flight-prs "{drain-prs}"\n', '--run {minted-run-dir} --no-settle --in-flight-prs "{drain-prs}"\n');
  assert.notDeepEqual(driveLines(unquoted).map(parseDriveLine), EXPECTED_PARSES);
});

// The first bind, in the Order section's fence, is the express form: never --dispatch.
function orderBindLines(text) {
  const order = sectionOf(text, '## Order');
  const lines = [];
  for (const m of order.matchAll(/^[ \t]*```bash\r?\n([\s\S]*?)\r?\n[ \t]*```/gm)) {
    for (const line of m[1].split(/\r?\n/)) if (line.includes('/bin/hooks.js" record-worktree')) lines.push(line.trim());
  }
  return lines;
}
const assertFirstBindWithoutDispatch = (text) => {
  const lines = orderBindLines(text);
  assert.equal(lines.length, 1, `expected one bind fence line in Order, found ${lines.length}`);
  assert.doesNotMatch(lines[0], /--dispatch/);
};

test('driver-route.md: the Order bind fence binds without --dispatch', () => {
  assertFirstBindWithoutDispatch(routeText());
});

test('go-red control: --dispatch appended to the Order bind fence fails', () => {
  const text = routeText();
  const bind = '"{minted-run-dir}" "{worktree}"\n   ```';
  assert.throws(() => assertFirstBindWithoutDispatch(mutate(text, bind, '"{minted-run-dir}" "{worktree}" --dispatch\n   ```')));
});

// A driver call that left no final line and no claim log took no claim: every release site skips.
const GATE_FILE = path.join(DISPATCH, 'two-call-gate.md');
const WRAP_UP = path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up');
const SECTION_E_FILE = path.join(WRAP_UP, 'cleanup-procedures-execution.md');
const FLAGS_FILE = path.join(WRAP_UP, 'flags.md');
const DRIVER_SKIP = 'driver-no-claim: skip the claim release';

function assertDriverSkip(route, gate, sectionE, flags) {
  assert.ok(route.includes(`\`(${DRIVER_SKIP})\``), 'driver-route.md must name the parenthetical');
  const s5 = between(gate, '## 5.', '## 6.');
  const para = s5.split('\n').find((l) => l.trim().startsWith('**Driver run with no claim (#5232).**'));
  assert.ok(para, 'two-call-gate.md section 5 paragraph missing');
  for (const needle of [`\`(${DRIVER_SKIP})\``, 'carries no `Step 2.8: claimed #{n}` line', 'Section E skips its release', 'A `decisions.md` that cannot be read counts as claimed']) {
    assert.ok(para.includes(needle), `section 5 paragraph must carry: ${needle}`);
  }
  assert.ok(!between(gate, '## 6.', '## 7.').includes(DRIVER_SKIP), 'a second call (section 6) must not append it');
  const e = between(sectionE, '## E. Issue claim release', 'This spec\'s record is identified whenever this section runs');
  assert.ok(e.includes(`**Skip it too when the invocation names \`${DRIVER_SKIP}\` (#5232)**`), 'Section E clause missing');
  assert.ok(e.includes('--text "condition: driver-no-claim named by the cleanup-only call → fallback: claim release skipped"'), 'Section E skip log line missing');
  assert.ok(flags.includes(`\`(${DRIVER_SKIP})\` (#5232)`), 'flags.md must declare the phrase');
}

test('a driver call with no final line and no claim skips the claim release at every site (#5232)', () => {
  assertDriverSkip(routeText(), readText(GATE_FILE), readText(SECTION_E_FILE), readText(FLAGS_FILE));
});

test('go-red control: the phrase dropped from any one site fails', () => {
  const files = [routeText(), readText(GATE_FILE), readText(SECTION_E_FILE), readText(FLAGS_FILE)];
  const drop = (text) => {
    const out = text.split(DRIVER_SKIP).join('');
    assert.notEqual(out, text, 'control must change the text');
    return out;
  };
  const messages = [/driver-route\.md/, /section 5 paragraph/, /Section E/, /flags\.md/];
  files.forEach((_, i) => {
    const args = files.map((f, j) => (j === i ? drop(f) : f));
    assert.throws(() => assertDriverSkip(...args), messages[i]);
  });
  const gate = files[1];
  assert.throws(() => assertDriverSkip(files[0], mutate(gate, 'A `decisions.md` that cannot be read counts as claimed, and the release runs.', ''), files[2], files[3]), /counts as claimed/);
});
