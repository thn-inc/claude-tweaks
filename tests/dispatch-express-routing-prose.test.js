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

const missingFactsOf = (facts) => (text) => facts.filter(([re]) => !re.test(text)).map(([, name]) => name);

// Strip one fact's match from the live region; the predicate must report exactly that fact.
function assertEachFactGoesRed(text, facts) {
  const missing = missingFactsOf(facts);
  for (const [re, name] of facts) {
    const doctored = text.replace(re, '');
    assert.notEqual(doctored, text, `anchor for "${name}" not found — the proof cannot discriminate`);
    assert.deepEqual(missing(doctored), [name], `removing only "${name}" must turn exactly that fact red`);
  }
}

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
  [/`express: \{outcome\}`/, 'express block names its outcome'],
  [/the one express call's transcript/, 'timing line takes the one express call\'s transcript'],
];

test('reporting.md: an express group\'s block and timing line', () => {
  assert.deepEqual(missingFactsOf(REPORTING_FACTS)(readText(REPORTING)), []);
});

test('go-red control: each reporting fact stripped reports exactly itself', () => {
  assertEachFactGoesRed(readText(REPORTING), REPORTING_FACTS);
});
