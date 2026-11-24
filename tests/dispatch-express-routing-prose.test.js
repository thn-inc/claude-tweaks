'use strict';
// tests/dispatch-express-routing-prose.test.js — #4025: pins /dispatch's express-lane routing.
// SKILL.md Step 5 routes an eligible singleton to express-prompt.md's express call (gate, verify,
// escalation back to the ordinary first call); Step 3's loop termination runs the post-merge
// sampling sweep; express-prompt.md carries exactly two fenced Task templates whose
// clean-room-facing parts (context pack, status line, model profile, OUTCOME vocabulary) are
// pinned per block, and whose express-call working-directory and no-stash paragraphs equal
// task-prompt.md's first call's after whitespace normalization (the foreground-wait rule is not
// restated in a template: Context pack item 7 carries it once, #5601). All of it is new prose in
// this change, so every go-red control mutates the live text in memory (skill-prose-conformance-tests).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { readText, crlfCheckoutRead } = require('./helpers/read-skill');
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
const WORKDIR = 'Working directory:';
const NO_STASH = 'Never run `git stash`';
const firstCall = () => fencedBlocks(readText(TASK_PROMPT))[0];

test('the express call copies the first call\'s working-directory and no-stash paragraphs', () => {
  const { express } = expressBlocks();
  for (const prefix of [WORKDIR, NO_STASH]) assert.equal(paragraph(express, prefix), paragraph(firstCall(), prefix), prefix);
});

test('go-red control: a reworded copied paragraph fails, a rewrapped one does not', () => {
  const { express } = expressBlocks();
  for (const [prefix, from, to] of [[WORKDIR, 'Do NOT create', 'You may create'], [NO_STASH, 'make a temporary WIP commit', 'stash it']]) {
    const reworded = express.replace(from, to);
    assert.notEqual(reworded, express);
    assert.notEqual(paragraph(reworded, prefix), paragraph(firstCall(), prefix), prefix);
  }
});

// #5601: the foreground-wait rule reaches an express agent through item 7 of the `{context-pack}`
// each template carries once; a template holding its own Foreground paragraph would state it twice.
const PRE_5601_PARAGRAPH = readText(path.join(__dirname, 'fixtures', 'dispatch-prompt', 'foreground-paragraph-pre-5601.txt')).trimEnd();
const FOREGROUND_HEAD = 'Foreground execution (required):';
// The paragraph is found by its heading, or by the primitive and the probe phrase it carried, so an
// indented or re-headed copy is still caught. The raw block never holds item 7's text.
const PRIMITIVE = /`sleep\s+\d+`\s+Bash\s+calls,\s+at\s+most\s+\d+\s+\(\d+\s+minutes\)/;
const PROBE_PHRASE = 'probe the worktree its prompt names, read-only';
const expressDefects = (blocks) => Object.entries(blocks).filter(([, block]) => (
  block.split(/\r?\n\r?\n/).some((p) => p.startsWith(FOREGROUND_HEAD))
  || PRIMITIVE.test(block.replace(/\s+/g, ' '))
  || block.replace(/\s+/g, ' ').includes(PROBE_PHRASE)
  || block.split('{context-pack}').length - 1 !== 1
)).map(([label]) => label);

test('AC2: each express template holds {context-pack} once and no Foreground paragraph (#5601)', () => {
  const blocks = expressBlocks();
  assert.deepEqual(expressDefects(blocks), []);
  for (const label of Object.keys(blocks)) {
    const restored = blocks[label].replace('{context-pack}', `${PRE_5601_PARAGRAPH}\n\n{context-pack}`);
    assert.notEqual(restored, blocks[label]);
    assert.deepEqual(expressDefects({ ...blocks, [label]: restored }), [label], `a restored paragraph in only ${label}`);
    const duplicated = `${blocks[label]}\n\n{context-pack}`;
    assert.deepEqual(expressDefects({ ...blocks, [label]: duplicated }), [label], `a duplicated {context-pack} in only ${label}`);
  }
});

// The restored paragraph can dodge a head-only check: indented, or with its heading renamed (#5601 final review).
test('AC2: the express-template check goes red for an indented or re-headed restored paragraph (#5601)', () => {
  const blocks = expressBlocks();
  const shapes = [
    ['indented two spaces', PRE_5601_PARAGRAPH.split('\n').map((line) => `  ${line}`).join('\n')],
    ['re-headed', PRE_5601_PARAGRAPH.replace(FOREGROUND_HEAD, 'Foreground execution:')],
  ];
  for (const [shape, doctoredParagraph] of shapes) {
    assert.notEqual(doctoredParagraph, PRE_5601_PARAGRAPH, `${shape}: the doctoring changed nothing`);
    for (const label of Object.keys(blocks)) {
      const restored = blocks[label].replace('{context-pack}', `${doctoredParagraph}\n\n{context-pack}`);
      assert.notEqual(restored, blocks[label]);
      assert.deepEqual(expressDefects({ ...blocks, [label]: restored }), [label], `a ${shape} restored paragraph in only ${label}`);
    }
  }
});

const CONTEXT_PACK_DEFINITION = /`\{context-pack\}` is `task-prompt\.md`'s Context pack section, each numbered item resolved as it states/;
const contextPackDefined = (text) => {
  const line = text.split('\n').find((l) => l.startsWith('Referenced by'));
  assert.ok(line, 'express-prompt.md lost its "Referenced by" line');
  assert.match(line.replace(/\s+/g, ' '), CONTEXT_PACK_DEFINITION, 'express-prompt.md must define {context-pack} as the whole Context pack section');
};

test('AC8.1: express-prompt.md defines {context-pack} as the whole Context pack section (#5601)', () => {
  contextPackDefined(readText(EXPRESS_PROMPT));
});

test('AC8.2: narrowing the definition to a list without item 7 goes red', () => {
  const text = readText(EXPRESS_PROMPT);
  const narrowed = text.replace('Context pack section, each numbered item resolved as it states', 'Context pack items 1-6 and 8, each resolved as it states');
  assert.notEqual(narrowed, text);
  assert.throws(() => contextPackDefined(narrowed), /must define \{context-pack\} as the whole Context pack section/);
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
    /\| today's path; the route is never consulted\. The queue pull keeps a record the driver would take out of bundles \(`bin\/lib\/express\/queue\.js`'s `keepSingleton`\), so a bundle has no member the driver would take \|/, 'a bundle group → today\'s path, never consulted'],
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
  [/The queue pull's `near-dup-pairs` pass writes that file \(`\[\]` when no pair is strong\) unless that pass is omitted or fails, and `bin\/queue-pull\.js` omits no pass, so a bare drain passes it too and gets the near-duplicate hold that `drain-pr-overlap\.md` Step 6 applies only to explicit-list firings: deliberate, since it holds more, never less\./, '#5232 Minor 4: a bare drain gets the near-duplicate hold, deliberately'],
  [/Always pass `--in-flight-prs`: without it the driver applies no drain-overlap hold/, 'AC9.2: the route always passes --in-flight-prs'],
  [/The hold and the merge are driver code/, 'AC5.9/AC5.10: the hold and the merge are driver code'],
  [/No model performs the merge/, 'AC5.11: no model performs the merge'],
  [/Never `sleep` or poll while the driver runs\. End the turn and wait for the background task's completion notification/, 'AC6.1: no sleep, wait for the notification'],
  [/^```bash\ntail -n 3 \{output-file\}\n```$/m, 'the tail -n 3 read itself'],
  [/the final event line is the last line above that marker/, 'Review Focus 4: the final line is the last line above [exited with code N]'],
  [/appends a blank line and `\[exited with code N\]`/, 'Review Focus 4: the harness marker named'],
  [/Any other word, no final line, a final line that is not one JSON object, or a non-zero exit that left no parseable final line \(the `--run` guard's exit 3 included\) is `blocked` through `two-call-gate\.md` §5/, 'AC5: the catch-all is blocked through §5'],
  [/a guard failure is a dispatch-side defect, never routed onward to today's path/, 'AC5: a guard failure is a dispatch-side defect'],
  [/Whether the driver took a claim in that case, and so whether §5's cleanup-only call appends `\(driver-no-claim: skip the claim release\)`, is §5's Driver run with no claim paragraph's rule alone/, 'no final line: whether the skip parenthetical applies is §5\'s rule alone'],
  [/A non-zero exit that did leave a parseable final line is not this case: route its outcome word by the table/, 'a non-zero exit with a final line routes by its word'],
  [/A record that takes today's path after a `--check` that did not admit, after a bind that printed no `worktree recorded` line, or after `refused`, gets one `SKIP` line/, 'the decline SKIP covers the failed bind'],
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

// #5232 R2: the near-dup-pairs write is conditional on the pass running (queue-pull.js's
// runNearDupPairs returns early on an omitted pass), and the CLI is what makes "a bare drain passes
// it" true: it omits no pass.
const NEAR_DUP_FACT = '#5232 Minor 4: a bare drain gets the near-duplicate hold, deliberately';
const queuePullCli = require('../plugin/bin/queue-pull');

test('#5232 R2: bin/queue-pull.js omits no pass, as driver-route.md says', () => {
  const seen = [];
  const code = queuePullCli.run(['--transport', 'files'], {
    stdout: () => {}, stderr: () => {}, env: {}, cwd: os.tmpdir(), queuePull: (o) => { seen.push(o); return {}; },
  });
  assert.equal(code, 0);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].omit, []);
});

test('#5232 R2 go-red control: the unconditional "on every firing" sentence fails', () => {
  const text = routeText();
  const old = mutate(text, "The queue pull's `near-dup-pairs` pass writes that file (`[]` when no pair is strong) unless that pass is omitted or fails, and `bin/queue-pull.js` omits no pass, so", 'The queue pull writes that file on every firing, so');
  assert.deepEqual(missingFactsOf(ROUTE_FACTS)(old), [NEAR_DUP_FACT]);
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
  ['| `blocked` |', /which Settle case runs is the Blocked stops list below/, '#5232 blocked row points to the Blocked stops list'],
  ['| `blocked` |', /whose cleanup-only call appends `\(driver-no-claim: skip the claim release\)` when §5's Driver run with no claim paragraph says so \|/, '#5232 blocked row points to §5\'s Driver run with no claim paragraph'],
  ['| `blocked` |', /Then `two-call-gate\.md` §5/, 'AC5.5: blocked → then §5'],
  ['| `refused` |', /take today's path for the record, with one `SKIP` line/, 'AC5.6: refused → today\'s path plus one SKIP'],
  ['| `refused` |', /when `express-lane` resolves `true`, the express gate runs/, 'AC5.6: refused re-decides the bind through the express gate'],
  ['| `refused` |', /on anything but an eligible verdict, re-bind with `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.js" record-worktree --run "\{minted-run-dir\}" "\{worktree\}" --dispatch` before the ordinary first call/, 'AC5.6: refused re-binds with --dispatch before the ordinary first call'],
  ['| `express-escalated` |', /The driver still wrote the run's escalation line \(`Express lane: escalated #\{n\} to \/flow`, or `check` did\), so that call's `\/build` judges "already shipped" against `origin\/\{integration-branch\}` only/, '#5232 Important 1: the driver wrote the escalation line /build reads'],
];

// #5232: the `blocked` row's Settle partition by claim stop lives in its own list, a different rule from
// §5's release skip (which Settle case runs, not whether the release runs).
const blockedStops = (text) => sectionOf(text, '## Blocked stops');
const BLOCKED_STOP_ROWS = [
  ['| a claim stop (`stop.step` is `claim`) whose `stop.reason` is `claim-exit-3`', /the stops Settle's Claim-contest case names, which wrote no claim: only its Claim-contest special case \|/, '#5232 Minor 3: only claim-exit-3 and claim-exit-6 take the Claim-contest special case'],
  ['| a claim stop whose `stop.reason` is `claim-exit-7`', /dispatch's Claim permission stop: its Claim permission denied paragraph, §5's `\(claim-permission-denied: skip the claim release\)`, and the firing ends, as for `failed:claim-permission-denied`/, 'claim-exit-7 → the Claim permission stop, and the firing ends'],
  ['| any other claim stop,', /no Settle; the catch-all paragraph above applies, and §5's release runs because a final line exists, unless §5's Driver run with no claim paragraph skips it/, '#5232 Minor 3: claim-exit-5, claim-exit-none and any other claim stop take the catch-all, whose release runs'],
  ['| any other stop |', /Settle's numbered steps 1-7, with `--reason "failed: driver-\{stop\.step\}"`/, 'any other stop → Settle steps 1-7'],
];

test('#5232 driver-route.md: the Blocked stops list maps each claim stop to its Settle case', () => {
  assert.deepEqual(missingRowsOf(BLOCKED_STOP_ROWS)(blockedStops(routeText())), []);
});

test('#5232 go-red control: each Blocked stops mapping stripped from its row reports itself', () => {
  const section = blockedStops(routeText());
  for (const [prefix, pattern, fact] of BLOCKED_STOP_ROWS) {
    const line = lineStartingWith(section, prefix);
    assert.deepEqual(missingRowsOf(BLOCKED_STOP_ROWS)(mutate(section, line, line.replace(pattern, 'x'))), [fact]);
  }
});

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
  const movedFacts = OUTCOME_ROWS.filter(([prefix]) => prefix === '| `merged` |' || prefix === '| `express-escalated` |').map(([, , fact]) => fact);
  assert.deepEqual(missingRowsOf(OUTCOME_ROWS)(swapped), movedFacts);
});

// #5232 Minor 3: the claim reasons the blocked row names, against claim-exit.js's own reading of them.
// The Claim-contest codes are the ones that wrote no claim (contested, claims branch missing); the
// catch-all's named codes are exactly the reasons claim-exit.js reads as a claim that may have been written.
const { CLAIM_KIND, readClaimExit, readClaimReason } = require('../plugin/bin/lib/driver/claim-exit');
const claimReasonsIn = (clause) => [...clause.matchAll(/`(claim-exit-(?:\d+|none))`/g)].map((m) => m[1]);
function claimClauses(row) {
  const contest = /^\| a claim stop \(`stop\.step` is `claim`\) whose `stop\.reason` is ([^|]*?) \| the stops Settle's Claim-contest case names/m.exec(row);
  const catchAll = /^\| any other claim stop, ([^(]*?) included \(a claim may have been written/m.exec(row);
  assert.ok(contest && catchAll, 'the Blocked stops list names its Claim-contest and catch-all claim reasons');
  return { contest: claimReasonsIn(contest[1]), catchAll: claimReasonsIn(catchAll[1]) };
}
const UNVERIFIED_REASONS = [null, ...Array.from({ length: 256 }, (_, i) => i)]
  .map(readClaimExit).filter((c) => c.kind === CLAIM_KIND.UNVERIFIED).map((c) => c.reason);
// #5232 R3: exactly these, not any reason that wrote no claim — claim-exit-2 also wrote none, yet
// Settle's Claim-contest special case names only the contested/in-flight and claims-branch-missing stops.
const CONTEST_REASONS = ['claim-exit-3', 'claim-exit-6'];
function assertClaimMapping(row) {
  const { contest, catchAll } = claimClauses(row);
  assert.ok(contest.length > 0, 'the Claim-contest clause names a reason');
  for (const reason of contest) {
    const claim = readClaimReason(reason);
    assert.ok(claim && [CLAIM_KIND.CONTESTED, CLAIM_KIND.SHARED_CAUSE].includes(claim.kind), `${reason} wrote no claim`);
  }
  assert.deepEqual([...contest].sort(), CONTEST_REASONS, 'the Claim-contest clause names exactly claim-exit-3 and claim-exit-6');
  assert.deepEqual([...catchAll].sort(), [...UNVERIFIED_REASONS].sort(), 'the catch-all names every possibly-written claim reason');
}

test('#5232 Minor 3: the blocked row\'s claim reasons match claim-exit.js', () => {
  assert.deepEqual([...UNVERIFIED_REASONS].sort(), ['claim-exit-5', 'claim-exit-none']);
  assertClaimMapping(blockedStops(routeText()));
});

test('#5232 go-red control: an unverified reason in the Claim-contest clause, or one dropped from the catch-all, fails', () => {
  const row = blockedStops(routeText());
  const intoContest = row.replace('`claim-exit-3` or `claim-exit-6`', '`claim-exit-3` or `claim-exit-5`');
  assert.notEqual(intoContest, row);
  assert.throws(() => assertClaimMapping(intoContest), /claim-exit-5 wrote no claim/);
  const dropped = row.replace('`claim-exit-5` and `claim-exit-none` included', '`claim-exit-5` included');
  assert.notEqual(dropped, row);
  assert.throws(() => assertClaimMapping(dropped), /every possibly-written claim reason/);
});

test('#5232 R3 go-red control: claim-exit-2 added to the Claim-contest clause, or claim-exit-6 dropped from it, fails', () => {
  const row = blockedStops(routeText());
  const added = row.replace('`claim-exit-3` or `claim-exit-6`', '`claim-exit-2`, `claim-exit-3` or `claim-exit-6`');
  assert.notEqual(added, row);
  assert.throws(() => assertClaimMapping(added), /exactly claim-exit-3 and claim-exit-6/);
  const dropped = row.replace('`claim-exit-3` or `claim-exit-6`', '`claim-exit-3`');
  assert.notEqual(dropped, row);
  assert.throws(() => assertClaimMapping(dropped), /exactly claim-exit-3 and claim-exit-6/);
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
// Sliced by its own CRLF-tolerant anchors, so a Windows checkout's text extracts the same line.
function orderSection(text) {
  const start = text.search(/^## Order\r?$/m);
  assert.notEqual(start, -1, 'no ## Order heading');
  const rest = text.slice(start + 1);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}
function orderBindLines(text) {
  const order = orderSection(text);
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
  const crlf = routeText().replace(/\n/g, '\r\n');
  assert.notEqual(crlf, routeText());
  assert.deepEqual(orderBindLines(crlf), orderBindLines(routeText()), 'a CRLF copy extracts the same bind line');
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
// Step 4's mint writes no decisions.md, so absent is the normal no-claim state: it must skip, never count as claimed.
const ABSENT_SKIPS = 'An absent `decisions.md` carries no such line, so the release is skipped';
// Why an unreadable decisions.md counts as claimed: release when unsure.
const UNREADABLE_REASON = 'release when unsure, as `claim-exit-5` does, since a claim may exist';

function assertDriverSkip(route, gate, sectionE, flags) {
  assert.ok(route.includes(`\`(${DRIVER_SKIP})\``), 'driver-route.md must name the parenthetical');
  const s5 = between(gate, '## 5.', '## 6.');
  const para = s5.split('\n').find((l) => l.trim().startsWith('**Driver run with no claim (#5232).**'));
  assert.ok(para, 'two-call-gate.md section 5 paragraph missing');
  for (const needle of [`\`(${DRIVER_SKIP})\``, 'carries no `Step 2.8: claimed #{n}` line', 'Section E skips its release', ABSENT_SKIPS, 'one that exists but cannot be read counts as claimed, and the release runs', UNREADABLE_REASON]) {
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
  assert.throws(() => assertDriverSkip(files[0], mutate(gate, `, and the release runs: ${UNREADABLE_REASON}.`, '.'), files[2], files[3]), /counts as claimed/);
  // #5232: the reason an unreadable decisions.md counts as claimed rides with the rule.
  assert.throws(() => assertDriverSkip(files[0], mutate(gate, `: ${UNREADABLE_REASON}`, ''), files[2], files[3]), /release when unsure/);
  // The fix-round-2 regression: "cannot be read" covering an absent file brings back the false release.
  const regressedGate = mutate(gate, "An absent `decisions.md` carries no such line, so the release is skipped (Step 4's mint writes none); one that exists but cannot be read counts as claimed, and the release runs", 'A `decisions.md` that cannot be read counts as claimed, and the release runs');
  assert.throws(() => assertDriverSkip(files[0], regressedGate, files[2], files[3]), /absent/);
});

// #5232 R4: after a driver claim stop whose claim-targets.js exit wrote no claim of this run's, the
// cleanup-only call skips the release at every site: release-claim.js would post a false comment on
// an absent blob (exit 2), and on exit 3's in-flight tombstone it comments on and unlabels another
// run's record. Exits 4 and 5 may have written a claim, so their release runs.
const NO_CLAIM_REASONS = ['claim-exit-2', 'claim-exit-3', 'claim-exit-6'];
// claim-exit.js's reading: a contested stop met another run's claim, and a shared cause stops before
// any claim write. 7 has its own phrase; 4 (failed), 5 and none (unverified) may have written one.
const DERIVED_NO_CLAIM = Array.from({ length: 256 }, (_, i) => readClaimExit(i))
  .filter((c) => [CLAIM_KIND.CONTESTED, CLAIM_KIND.SHARED_CAUSE].includes(c.kind)).map((c) => c.reason);
const sectionEOf = (text) => between(text, '## E. Issue claim release', 'This spec\'s record is identified whenever this section runs');
const KEEPS_RELEASE = '`claim-exit-4` and `claim-exit-5` may have written one, so their release runs';
// #5232: driver-route.md and Section E carry a pointer to the owning paragraph, not the rule.
const ROUTE_POINTERS = ["when §5's Driver run with no claim paragraph says so", "is §5's Driver run with no claim paragraph's rule alone"];
const SECTION_E_POINTER = "`dispatch/two-call-gate.md` §5's Driver run with no claim paragraph owns which calls those are";
// Word-bounded: the claim-exit-2/-4 members, the decisions.md probe and the keep-release clause stay in §5.
const RESTATED = [/`claim-exit-(?:2|4)`/, /\babsent `decisions\.md`/, /\bcounts as claimed\b/, /\bmay have written one\b/];

function assertNoClaimSkip(route, gate, sectionE) {
  const para = between(gate, '## 5.', '## 6.').split('\n').find((l) => l.trim().startsWith('**Driver run with no claim (#5232).**')) || '';
  // The one owner: §5's Driver run with no claim paragraph states the claim-exit set and the 4/5 release.
  const m = /Append it too when the call's final line is a claim stop \(`stop\.step` is `claim`\) whose `stop\.reason` is ([^:]*?), whatever Settle ran: those `claim-targets\.js` exits wrote no claim of this run's/.exec(para);
  assert.ok(m, 'section 5: the no-claim skip clause is missing');
  assert.deepEqual(claimReasonsIn(m[1]).sort(), NO_CLAIM_REASONS, 'section 5: the skip names exactly claim-exit-2, claim-exit-3 and claim-exit-6');
  assert.ok(para.includes(KEEPS_RELEASE), 'section 5: exits 4 and 5 must keep their release');
  // driver-route.md points at it and restates none of it.
  for (const pointer of ROUTE_POINTERS) assert.ok(route.includes(pointer), `driver-route.md pointer to section 5 missing: ${pointer}`);
  for (const re of RESTATED) assert.ok(!re.test(route), `driver-route.md restates the no-claim rule: ${re}`);
  // Section E keeps what it needs to act on the parenthetical, and no set.
  const e = sectionEOf(sectionE);
  assert.ok(e.includes(SECTION_E_POINTER), 'Section E must point to section 5\'s Driver run with no claim paragraph');
  assert.ok(!/\bclaim-exit-\d/.test(e), 'Section E restates the claim-exit set');
}

test('#5232 R4: the no-claim reasons are exactly claim-exit.js\'s contested and shared-cause exits', () => {
  assert.deepEqual([...DERIVED_NO_CLAIM].sort(), NO_CLAIM_REASONS);
});

test('#5232 R4: a driver claim stop that wrote no claim skips the claim release at every site', () => {
  assertNoClaimSkip(routeText(), readText(GATE_FILE), readText(SECTION_E_FILE));
});

test('#5232 R4 go-red control: a no-claim exit dropped, or claim-exit-4 or claim-exit-5 added, at any site fails', () => {
  const files = [routeText(), readText(GATE_FILE), readText(SECTION_E_FILE)];
  const OR = {
    list: '`claim-exit-2`, `claim-exit-3` or `claim-exit-6`',
    variants: ['`claim-exit-2` or `claim-exit-6`', '`claim-exit-3` or `claim-exit-6`', '`claim-exit-2`, `claim-exit-3`, `claim-exit-4` or `claim-exit-6`', '`claim-exit-2`, `claim-exit-3`, `claim-exit-5` or `claim-exit-6`'],
  };
  const shape = 'whose `stop.reason` is {list}, whatever Settle ran';
  const clause = shape.replace('{list}', OR.list);
  for (const variant of OR.variants) {
    const args = files.map((f, j) => (j === 1 ? mutate(f, clause, shape.replace('{list}', variant)) : f));
    assert.throws(() => assertNoClaimSkip(...args), /section 5: the skip names exactly/, `section 5: ${variant}`);
  }
  assert.throws(() => assertNoClaimSkip(files[0], mutate(files[1], KEEPS_RELEASE, '`claim-exit-4` may have written one'), files[2]), /exits 4 and 5 must keep their release/);
  // A restated rule in driver-route.md goes red: the set, the probe, the unreadable rule, the keep-release clause.
  for (const restated of ['`claim-exit-2`', '`claim-exit-4`', 'An absent `decisions.md` carries no such line.', 'An unreadable one counts as claimed.', KEEPS_RELEASE]) {
    assert.throws(() => assertNoClaimSkip(`${files[0]}\n\n${restated}\n`, files[1], files[2]), /driver-route\.md restates the no-claim rule/, restated);
  }
  // A dropped pointer goes red, at each of its two sites in driver-route.md and in Section E.
  for (const pointer of ROUTE_POINTERS) {
    assert.throws(() => assertNoClaimSkip(mutate(files[0], pointer, 'x'), files[1], files[2]), /driver-route\.md pointer to section 5 missing/, pointer);
  }
  assert.throws(() => assertNoClaimSkip(files[0], files[1], mutate(files[2], SECTION_E_POINTER, 'x')), /Section E must point/);
  // Section E re-listing a claim-exit goes red.
  assert.throws(() => assertNoClaimSkip(files[0], files[1], mutate(files[2], 'that took no claim (', 'that took no claim after `claim-exit-3` (')), /Section E restates/);
});

test('#5232 the no-claim pointer and Blocked stops extractions hold on a CRLF checkout', () => {
  const { raw, text } = crlfCheckoutRead(ROUTE);
  assert.notEqual(raw, text, 'the raw copy carries CRLF');
  assert.ok(raw.includes('\r\n'));
  assert.deepEqual(blockedStops(text), blockedStops(routeText()));
  assertNoClaimSkip(text, readText(GATE_FILE), readText(SECTION_E_FILE));
});

// #5232: the driver route's blocked stop is the one named exception to "Settle never runs in dispatch's main thread",
// stated where that rule is, in settle-and-merge.md and SKILL.md Step 6; and Step 5 names the one policy call.
const SETTLE_FILE = path.join(DISPATCH, 'settle-and-merge.md');
const SETTLE_EXCEPTION_FACTS = [
  [/never in dispatch's main thread, except the driver route's `blocked` stop \(`driver-route\.md`'s Outcome words\), where no Task call exists for the group/, 'settle-and-merge.md names the driver route blocked stop as the exception'],
];
const STEP6_EXCEPTION_FACTS = [
  [/never reads it on their behalf and gains nothing by reading it up front \(#2423\) — except the driver route's `blocked` stop, which runs Settle here because no Task call exists for that group \(the driver route's Outcome words\)/, 'SKILL.md Step 6 names the driver route blocked stop as the exception'],
];
const ONE_CALL_FACTS = [
  [/read in the one `--values express-lane express-driver` call above, not a second one/, 'the Express lane paragraph names the one express-lane express-driver call'],
];
const OWN_PR_FACTS = [
  [/After a `merged` outcome, and only when `express-lane` resolves `true`, run `express-lane\.js samples --pr \{pr\}`/, 'explicit form: own-PR sampling gated on express-lane'],
  [/On `found: false`, a non-zero exit or a review that does not complete, name the PR in the report as "left to the next drain's sweep"/, 'left to the next drain'],
];
test('#4365 SKILL.md Step 5 explicit-form express path samples its own PR', () => {
  const text = step5(readText(SKILL));
  assert.deepEqual(missingFactsOf(OWN_PR_FACTS)(text), []);
  assertEachFactGoesRed(text, OWN_PR_FACTS);
});
const step6 = (text) => between(text, '### Step 6: Settle', '## Reporting');

test('#5232 settle-and-merge.md names the driver route blocked stop as the exception to its main-thread rule', () => {
  const text = readText(SETTLE_FILE);
  assert.deepEqual(missingFactsOf(SETTLE_EXCEPTION_FACTS)(text), []);
  assertEachFactGoesRed(text, SETTLE_EXCEPTION_FACTS);
});

test('#5232 SKILL.md Step 6 names the driver route blocked stop as the exception to the dispatching session never running Settle', () => {
  const text = step6(readText(SKILL));
  assert.deepEqual(missingFactsOf(STEP6_EXCEPTION_FACTS)(text), []);
  assertEachFactGoesRed(text, STEP6_EXCEPTION_FACTS);
});

test('#5232 SKILL.md Step 5 names the one express-lane express-driver policy call in the Express lane paragraph', () => {
  const text = step5(readText(SKILL));
  assert.deepEqual(missingFactsOf(ONE_CALL_FACTS)(text), []);
  assertEachFactGoesRed(text, ONE_CALL_FACTS);
});
