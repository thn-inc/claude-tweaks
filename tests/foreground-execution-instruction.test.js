// tests/foreground-execution-instruction.test.js — pins #1965: three dispatched Task calls this
// firing (1442 build, 1442 review, 1821 build) ended their turn narrating "Waiting for the
// background test run / fix-round / simplify subagent" with no status line. A Task agent that
// yields expecting a completion notification is never re-woken inside the Task — the dispatching
// session had to detect the missing status line and resume each one via SendMessage manually.
// Neither dispatch/task-prompt.md's two fenced Task-prompt templates nor build/dispatch.md's
// implementer/reviewer instruction paragraph said anything about foreground execution, so a
// dispatched agent (or the SDD implementer/reviewer sub-dispatches it composes) had no textual
// reason not to background a long-running command and wait on it. This suite pins the
// foreground-execution instruction in all three locations, and proves the check can actually go
// red (parse-signal-discipline). It also pins #3078/#3266's nested-dispatch keep-alive rule across
// the core section, task-prompt.md's item 7 and both fenced templates, plus its output-contract and
// review/step3 restatements, each with its own go-red proof.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', 'plugin');
const TASK_PROMPT = path.join(PLUGIN, 'skills', 'dispatch', 'task-prompt.md');
const BUILD_DISPATCH = path.join(PLUGIN, 'skills', 'build', 'dispatch.md');
const CORE = path.join(PLUGIN, 'skills', '_shared', 'subagent-dispatch-core.md');
const OUTPUT_CONTRACT = path.join(PLUGIN, 'skills', '_shared', 'subagent-output-contract.md');

// The load-bearing facts a reader (human or dispatched agent) must come away with — the exact
// failure mode #1965 documents. Each `\s+` absorbs the templates' hard line wrapping; the
// this/the alternation covers the direct address in task-prompt.md's templates versus
// build/dispatch.md's instruction about the dispatches SDD composes.
const REQUIRED = [
  [/never with\s+`run_in_background`/i, 'never background a long-running command'],
  [/never end\s+(?:this|the) turn waiting on a background/i, "never end the turn waiting on a background run or a child agent's notification"],
];

function fencedBlocks(text) {
  const blocks = [];
  const lines = text.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('```')) continue;
    if (start === -1) {
      start = i + 1;
    } else {
      blocks.push(lines.slice(start, i).join('\n'));
      start = -1;
    }
  }
  assert.equal(start, -1, 'unbalanced ``` fences — the last fenced block is unclosed');
  return blocks;
}

// A fact-list predicate: the facts whose pattern the text no longer matches.
const missingFactsOf = (patterns) => (text) => patterns.filter(([pattern]) => !pattern.test(text)).map(([, fact]) => fact);

// Per-assertion go-red proof (the 6bb1bb695 shape): strip one pattern's matched phrase from the live
// text, and the shared predicate must report exactly that one fact missing.
function assertEachPatternGoesRed(text, patterns, missingOf) {
  for (const [pattern, fact] of patterns) {
    const doctored = text.replace(pattern, '');
    assert.notEqual(doctored, text, `anchor text for "${fact}" not found — proof cannot discriminate`);
    assert.deepEqual(missingOf(doctored), [fact], `removing only "${fact}" must turn exactly that assertion red`);
  }
}

const TEMPLATE_LABELS = ['first call (build,test)', 'second call (review,polish,wrap-up)'];

// task-prompt.md's two fenced Task-prompt templates, in TEMPLATE_LABELS order.
function templateBlocks(text) {
  const blocks = fencedBlocks(text);
  assert.equal(blocks.length, TEMPLATE_LABELS.length, `expected exactly two fenced Task-prompt blocks, found ${blocks.length}`);
  return blocks;
}

test('task-prompt.md: both fenced Task-prompt templates carry the foreground-execution instruction', () => {
  const blocks = templateBlocks(fs.readFileSync(TASK_PROMPT, 'utf8'));

  for (const [index, block] of blocks.entries()) {
    const label = TEMPLATE_LABELS[index];
    for (const [pattern, fact] of REQUIRED) {
      assert.match(block, pattern, `${label} template must instruct the dispatched agent to ${fact} (#1965)`);
    }
  }
});

test('build/dispatch.md: the SDD invocation instruction directs implementer and reviewer dispatches to run in the foreground', () => {
  const text = fs.readFileSync(BUILD_DISPATCH, 'utf8');
  for (const [pattern, fact] of REQUIRED) {
    assert.match(text, pattern, `build/dispatch.md must instruct SDD's per-task implementer/reviewer dispatches to ${fact} (#1965)`);
  }
  assert.match(
    text,
    /implementer dispatch and every reviewer dispatch/i,
    'build/dispatch.md must scope the foreground instruction to every per-task implementer AND reviewer dispatch — the grandchildren that actually launched the background runs in #1965',
  );
});

test('the foreground-instruction predicate can actually go red (discrimination proof)', () => {
  const paragraphs = fs.readFileSync(TASK_PROMPT, 'utf8').split(/\r?\n\r?\n/);
  const kept = paragraphs.filter((p) => !p.startsWith('Foreground execution (required):'));
  assert.equal(
    paragraphs.length - kept.length,
    2,
    'expected to doctor out exactly the two foreground-execution paragraphs — anchor text not found',
  );

  for (const block of templateBlocks(kept.join('\n\n'))) {
    for (const [pattern] of REQUIRED) {
      assert.doesNotMatch(block, pattern, 'doctored block unexpectedly still matches — test cannot discriminate');
    }
  }
});

// #3078: a nested Agent child launches async, and its <task-notification> reaches the dispatcher
// only while the dispatcher's turn is alive. The core section must state that rule and its
// fallback; the output contract must no longer tell a nested dispatcher to yield across turns.
function coreForegroundSection(text) {
  const start = text.indexOf('## Foreground Execution Discipline');
  assert.notEqual(start, -1, 'subagent-dispatch-core.md lost its "## Foreground Execution Discipline" heading (Tasks 3-4 cite it by name)');
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next === -1 ? undefined : next);
}

// The facts the final-review fix wave added (abandoned child, final STATUS, re-wake, the 30s x 40
// per-wave bound and its log line). Written to match every copy of the rule -- core, item 7, both
// templates -- so each copy's list spreads this one array, and each pattern matches exactly once
// per copy so its go-red proof removes the only occurrence.
const SHARED_RULE = [
  [/`sleep\s+20`\s+Bash\s+calls,\s+at\s+most\s+60\s+\(20\s+minutes\)\s+per\s+wave\s+of\s+children/, 'the sleep 20 x 60 (20 minute) per-wave bound'],
  [/blocked\s+or\s+fails[^.]*?is\s+not\s+a\s+wait\s+and\s+never\s+counts\s+toward\s+the\s+bound;\s+never\s+retry\s+it\s+in\s+another\s+form/, 'a blocked or failed wait never counts and is never retried in another form'],
  [/how\s+many\s+children\s+are\s+still\s+pending/, 'each wait logs how many children are still pending'],
  [/\bis\s+abandoned\b/, 'a child self-judged at the bound is abandoned'],
  [/no\s+longer\s+counts\s+as\s+outstanding/, 'an abandoned child no longer counts as outstanding'],
  [/final\s+reply\s+still\s+ends\s+with\s+(?:its\s+usual\s+)?`STATUS:/, 'the final reply after an abandoned child still ends with STATUS:'],
  [/re-wakes\s+(?:you|the\s+agent)\s+after\s+(?:your|its)\s+final\s+reply[^.]*?\brepeat(?:ing)?\s+that\s+final\s+`STATUS:`\s+line\s+unchanged/, 'a late re-wake after the final reply repeats the final STATUS: line unchanged'],
  [/`ToolSearch`\s+finds\s+none,\s+deferred\s+or\s+otherwise/, 'the no-Agent-tool fallback checks ToolSearch for a deferred Agent tool'],
  [/child\s+that\s+reports\s+a\s+failure/i, 'a child that reports a failure has reported and is handled per the dispatching skill'],
  [/write-capable\s+child[\s\S]*?never\s+redone/, 'a write-capable child silent at the bound is never redone in-session'],
];

// Each `\s+` absorbs the hard line wrapping, as in REQUIRED above.
const KEEP_ALIVE = [
  [/always\s+launches\s+async/i, 'a nested Agent call always launches async'],
  [/keep[s]?\s+(?:its|your|the)\s+(?:own\s+)?turn\s+alive/i, 'the dispatcher keeps its own turn alive'],
  [/never\s+end[s]?\s+(?:its|your|the)\s+turn\s+with\s+(?:a|one)\s+child\s+outstanding/i, 'the dispatcher never ends its turn with a child outstanding'],
  [/no\s+`Agent`\/`Task`\s+tool/i, 'the fallback covers the no-Agent/Task-tool case'],
  [/`unconfirmed`/, 'findings from a self-judged unit are marked unconfirmed'],
  [/arrives\s+after\s+its\s+unit\s+was\s+self-judged\s+is\s+ignored;\s+it\s+never\s+changes\s+a\s+verdict/, 'a late child result is ignored and never changes a verdict'],
  ...SHARED_RULE,
];

// Content predicates: each live assertion and its doctored-text proof call the same function.
const missingKeepAlive = missingFactsOf(KEEP_ALIVE);
const foldsNoTaskParagraph = (core) => !/\*\*No `Task`\/Agent tool available\.\*\*/.test(core);
const dropsYieldRule = (contract) => !/must\s+yield\s+control\s+across\s+several\s+of\s+its\s+own\s+turns/.test(contract);

// Each `\s+` absorbs the hard line wrapping. The second fact subsumes a bare INTERIM_STATUS token
// check: it pins the marker as the rule for a turn that ends mid keep-alive wait.
const CONTRACT_KEEP_ALIVE = [
  [/keeps\s+its\s+turn\s+alive\s+until\s+every\s+child\s+reports/, 'a nested dispatcher keeps its turn alive until every child reports'],
  [/End\s+every\s+such\s+interim\s+turn\s+with\s+its\s+own\s+trailing\s+marker\s+line,\s+`INTERIM_STATUS:/, 'an interim turn ends with its own INTERIM_STATUS: marker line'],
];
const contractKeepAliveMissing = missingFactsOf(CONTRACT_KEEP_ALIVE);

test('subagent-dispatch-core.md states the nested-dispatch keep-alive rule and its fallback (#3078)', () => {
  const core = fs.readFileSync(CORE, 'utf8');
  assert.deepEqual(missingKeepAlive(coreForegroundSection(core)), [], 'Foreground Execution Discipline must state every keep-alive fact (#3078)');
  assert.ok(foldsNoTaskParagraph(core), 'the standalone No-Task paragraph must be folded into the new fallback clause (#3078)');
});

test('subagent-output-contract.md no longer tells a nested dispatcher to yield across turns (#3078)', () => {
  const contract = fs.readFileSync(OUTPUT_CONTRACT, 'utf8');
  assert.ok(dropsYieldRule(contract), 'the output contract still instructs nested dispatchers to yield across turns (#3078)');
  assert.deepEqual(contractKeepAliveMissing(contract), [], 'the output contract must state the keep-alive clause and the INTERIM_STATUS marker rule (#3078)');
});

test('each keep-alive assertion can actually go red on its own (discrimination proof)', () => {
  assertEachPatternGoesRed(coreForegroundSection(fs.readFileSync(CORE, 'utf8')), KEEP_ALIVE, missingKeepAlive);
});

test('the folded-paragraph and yield-rule assertions can actually go red (discrimination proof)', () => {
  const core = fs.readFileSync(CORE, 'utf8');
  const reinsertedHeading = '\n\n**No `Task`/Agent tool available.** Some environments expose no `Task`/Agent dispatch tool at all.\n';
  assert.equal(foldsNoTaskParagraph(core + reinsertedHeading), false, 'the re-inserted No-Task heading must turn the fold assertion red');

  const contract = fs.readFileSync(OUTPUT_CONTRACT, 'utf8');
  const nestedClause = /keeps its turn alive until every child reports \(`_shared\/subagent-dispatch-core\.md`'s Foreground Execution Discipline\)\./;
  assert.match(contract, nestedClause, 'anchor text for the nested-dispatcher clause not found');
  const yieldDoctored = contract.replace(nestedClause, 'must yield control across several of its own turns before its real final reply.');
  assert.equal(dropsYieldRule(yieldDoctored), false, 'the old yield wording must turn the no-yield assertion red');
});

test('each output-contract keep-alive and interim-marker assertion can actually go red on its own (discrimination proof)', () => {
  assertEachPatternGoesRed(fs.readFileSync(OUTPUT_CONTRACT, 'utf8'), CONTRACT_KEEP_ALIVE, contractKeepAliveMissing);
});

// #3078: review/step3-lens-dispatch.md's dispatched-reviewer carve-out is deleted, and its
// Foreground note now covers the reviewer's own lens dispatches (nested-children rule + partner-died downgrade).
const STEP3 = path.join(PLUGIN, 'skills', 'review', 'step3-lens-dispatch.md');
const CARVE_OUT_SENTENCE = '**When the reviewing agent is itself a Task-tool subagent** (dispatched by `/claude-tweaks:dispatch` or any other orchestrator), it cannot safely wait on this dispatch\'s own completion notification — see `dispatch/task-prompt.md`\'s Async-wait discipline item. In that case, skip the Task-tool dispatch for this tier entirely and have the reviewing agent apply the Direct-verification override from the start: read the diff directly and judge 3b/3c itself, rather than dispatching and then abandoning an agent whose findings cannot be safely awaited.';
const CARVE_OUT = [
  [/cannot safely wait/, 'the reviewer "cannot safely wait" on its own dispatch'],
  [/skip the Task-tool dispatch for this tier entirely/, 'the Task-tool dispatch is skipped for a dispatched reviewer at this tier'],
];
const carveOutPhrases = (text) => CARVE_OUT.filter(([pattern]) => pattern.test(text)).map(([, fact]) => fact);

const FOREGROUND_NOTE_PREFIX = '> **Foreground Execution Discipline:**';
const foregroundNote = (text) => text.split('\n').find((line) => line.startsWith(FOREGROUND_NOTE_PREFIX)) || '';
const LENS_NOTE = [
  [/lens dispatches?/i, "the reviewer's own lens dispatches"],
  [/nested-children\s+rule\s+in\s+`_shared\/subagent-dispatch-core\.md`/, 'the nested-children rule, cited by its core file'],
  [/agents\s+are\s+unavailable\s+\(no\s+`Agent`\s+tool\)/, 'the unavailable-agents case routes to the single-read treatment'],
  [/time out at that section's bound/, 'the timed-out-at-the-keep-alive-bound case routes to the single-read treatment'],
  [/lose\s+a\s+partner\s+to\s+a\s+session\s+limit\s+gets\s+the\s+partner-died\s+single-read\s+treatment/, 'the lost-partner case routes to the partner-died single-read treatment'],
  [/`unconfirmed`, logged/, 'the routed findings are unconfirmed and logged'],
];
const lensNoteMissing = missingFactsOf(LENS_NOTE);

// The hung single-read agent paragraph (2-3 minute wait + nudge) must not govern a dispatched reviewer,
// which follows the keep-alive bound in the Foreground note and may have no SendMessage.
const HUNG_AGENT = [
  [/a\s+dispatched\s+reviewer\s+waits\s+its\s+keep-alive\s+bound\s+instead\s+\(the\s+Foreground\s+note\s+below\)\s+and\s+skips\s+the\s+nudge/, 'a dispatched reviewer waits its keep-alive bound and skips the SendMessage nudge'],
];
const hungAgentMissing = missingFactsOf(HUNG_AGENT);
const LENS_NOTE_SENTENCE = /When the reviewer is itself a dispatched agent,.*?\(findings `unconfirmed`, logged\)\./;

test('step3-lens-dispatch.md has no dispatched-reviewer carve-out (#3078)', () => {
  const step3 = fs.readFileSync(STEP3, 'utf8');
  assert.deepEqual(carveOutPhrases(step3), [], 'step3-lens-dispatch.md still carves out a dispatched reviewer from its lens dispatch (#3078)');
});

test("step3 Foreground note covers the reviewer's own lens dispatches (#3078)", () => {
  const note = foregroundNote(fs.readFileSync(STEP3, 'utf8'));
  assert.notEqual(note, '', 'the "> **Foreground Execution Discipline:**" note line was not found in step3-lens-dispatch.md');
  assert.deepEqual(lensNoteMissing(note), [], 'the step3 Foreground note must cover the reviewer\'s own lens dispatches (#3078)');
});

test('step3 hung-single-read paragraph exempts a dispatched reviewer from the nudge (#3078)', () => {
  assert.deepEqual(hungAgentMissing(fs.readFileSync(STEP3, 'utf8')), [], 'the hung single-read paragraph must route a dispatched reviewer to its keep-alive bound and skip the nudge (#3078)');
});

test('the step3 hung-single-read assertion can actually go red (discrimination proof)', () => {
  assertEachPatternGoesRed(fs.readFileSync(STEP3, 'utf8'), HUNG_AGENT, hungAgentMissing);
});

test('the step3 carve-out predicate can actually go red (discrimination proof)', () => {
  const step3 = fs.readFileSync(STEP3, 'utf8');
  const reinserted = step3 + '\n\n' + CARVE_OUT_SENTENCE + '\n';
  assert.notDeepEqual(carveOutPhrases(reinserted), [], 'the re-inserted carve-out sentence must turn the no-carve-out assertion red');
});

test('the step3 Foreground-note predicate can actually go red (discrimination proof)', () => {
  const note = foregroundNote(fs.readFileSync(STEP3, 'utf8'));
  assert.match(note, LENS_NOTE_SENTENCE, 'anchor text for the appended lens-dispatch sentence not found in the Foreground note');
  const doctored = note.replace(LENS_NOTE_SENTENCE, '');
  assert.notDeepEqual(lensNoteMissing(doctored), [], 'removing the appended sentence must turn the lens-coverage assertion red');
  assertEachPatternGoesRed(note, LENS_NOTE, lensNoteMissing);
});

// #3078 / #3266: task-prompt.md's item 7 drops the "nothing wakes you" framing and states what ends
// a turn. Each template is inlined into a Task() prompt, so each carries the nested-Agent rule
// itself; the #2533 rationale cites the core section instead of dispatch-waiting.md's resume signal.
function item7Block(text) {
  const start = text.indexOf('7. **Async-wait discipline**');
  assert.notEqual(start, -1, 'task-prompt.md lost its item 7 "Async-wait discipline" heading (#3078)');
  const next = text.slice(start + 1).search(/\n(?:8\. |## )/);
  assert.notEqual(next, -1, 'task-prompt.md: no "8. " item or "## " heading follows item 7 — its boundary is unknown, so the block would run to end-of-file (#3078)');
  return text.slice(start, start + 1 + next);
}

const ITEM7 = [
  [/reply that ends without a tool call ends\s+(?:the|your)\s+turn/i, 'a reply that ends without a tool call ends the turn'],
  [/INTERIM_STATUS/, 'the #2714 interim-marker rule is kept'],
  [/always\s+launches\s+async/i, 'a nested Agent call always launches async'],
  [/`unconfirmed`/, 'the self-judged fallback marks findings unconfirmed'],
  [/never\s+end\s+your\s+turn\s+with\s+one\s+outstanding/, 'item 7 never ends the turn with a child outstanding'],
  [/Ignore\s+a\s+late\s+result/, 'item 7 ignores a late result'],
  ...SHARED_RULE,
];
const item7Missing = missingFactsOf(ITEM7);
const dropsNothingWakes = (block) => !/nothing wakes you/.test(block);

const TEMPLATE_KEEP_ALIVE = [
  [/always\s+launches\s+async/i, 'a nested Agent call always launches async'],
  [/never\s+end\s+this\s+turn\s+with\s+(?:a|one)\s+child\s+outstanding/i, 'the turn never ends with a child outstanding'],
  [/ignore\s+that\s+child's\s+result\s+if\s+it\s+arrives\s+later/i, 'a late child result is ignored'],
  [/reply\s+that\s+ends\s+without\s+a\s+tool\s+call\s+ends\s+the\s+turn/i, 'a reply that ends without a tool call ends the turn'],
  [/`unconfirmed`/, "the template's fallback marks findings unconfirmed"],
  [/log\s+the\s+downgrade/i, "the template's fallback logs the downgrade"],
  ...SHARED_RULE,
];
const foregroundParagraph = (block) => {
  const found = block.split(/\r?\n\r?\n/).filter((p) => p.startsWith('Foreground execution (required):'));
  assert.equal(found.length, 1, `expected exactly one "Foreground execution (required):" paragraph per template, found ${found.length}`);
  return found[0];
};
// Takes the template's "Foreground execution (required):" paragraph, not the whole fenced block, so
// a pattern's one occurrence is the paragraph's (the block mentions `unconfirmed` elsewhere).
const templateKeepAliveMissing = missingFactsOf(TEMPLATE_KEEP_ALIVE);
const dropsInTurnCarveOut = (block) => !/It\s+does\s+not\s+cover\s+an\s+in-turn/.test(block);

const dropsPrimaryResumeSignal = (text) => !/primary resume signal/.test(text);
const RATIONALE = [
  [/`_shared\/subagent-dispatch-core\.md`'s\s+Foreground\s+Execution\s+Discipline/, 'the #2533 rationale cites the core section'],
];
const rationaleMissing = missingFactsOf(RATIONALE);

test('task-prompt item 7 drops "nothing wakes you" and states what ends a turn (#3078, #3266)', () => {
  const item7 = item7Block(fs.readFileSync(TASK_PROMPT, 'utf8'));
  assert.ok(dropsNothingWakes(item7), 'item 7 still says "nothing wakes you" — the framing #3078 retired (#3266)');
  assert.deepEqual(item7Missing(item7), [], 'item 7 must state every turn-ending and keep-alive fact (#3078, #3266)');
});

test('neither fenced template keeps the in-turn carve-out (#3078)', () => {
  const blocks = templateBlocks(fs.readFileSync(TASK_PROMPT, 'utf8'));
  for (const [index, block] of blocks.entries()) {
    const label = TEMPLATE_LABELS[index];
    assert.ok(dropsInTurnCarveOut(block), `${label} template still carries the in-turn carve-out (#3078)`);
    assert.deepEqual(templateKeepAliveMissing(foregroundParagraph(block)), [], `${label} template must carry the nested-Agent rule itself (#3078)`);
  }
});

test("the #2533 rationale cites the core section, not dispatch-waiting.md's resume signal (#3078)", () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  assert.ok(dropsPrimaryResumeSignal(text), 'task-prompt.md still cites dispatch-waiting.md\'s "primary resume signal" (#3078)');
  assert.deepEqual(rationaleMissing(text), [], 'the #2533 rationale must cite subagent-dispatch-core.md\'s Foreground Execution Discipline (#3078)');
});

test('each task-prompt assertion can actually go red on its own (discrimination proof)', () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  assertEachPatternGoesRed(item7Block(text), ITEM7, item7Missing);
  for (const block of templateBlocks(text)) assertEachPatternGoesRed(foregroundParagraph(block), TEMPLATE_KEEP_ALIVE, templateKeepAliveMissing);
  assertEachPatternGoesRed(text, RATIONALE, rationaleMissing);
});

test('the task-prompt absence predicates can actually go red (discrimination proof)', () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  assert.equal(dropsNothingWakes(item7Block(text) + '\n   nothing wakes you automatically.'), false, 'the re-inserted "nothing wakes you" must turn the item-7 assertion red');

  const [firstCall] = templateBlocks(text);
  assert.equal(
    dropsInTurnCarveOut(firstCall + '\n\nIt does not cover an in-turn `Agent`-tool dispatch.'),
    false,
    'the appended in-turn carve-out sentence must turn the template assertion red',
  );
  assert.equal(
    dropsInTurnCarveOut(firstCall + '\n\nIt does\nnot cover an in-turn `Agent`-tool dispatch.'),
    false,
    'a re-wrapped in-turn carve-out sentence must turn the template assertion red',
  );

  assert.equal(dropsPrimaryResumeSignal(text + '\n\nSee the primary resume signal.'), false, 'the re-inserted resume-signal citation must turn the rationale assertion red');
});

// #3078 final-review fix wave: the output contract's #2714 interim-marker paragraph narrows
// INTERIM_STATUS to a turn that ends mid keep-alive wait; an abandoned child is not outstanding.
const CONTRACT_ABANDONED = [
  [/\bis\s+abandoned\b/, 'a child abandoned at the bound is named'],
  [/no\s+longer\s+counts\s+as\s+outstanding/, 'an abandoned child no longer counts as outstanding'],
];
const contractAbandonedMissing = missingFactsOf(CONTRACT_ABANDONED);

test('subagent-output-contract.md says an abandoned child is not outstanding, so INTERIM_STATUS is not its marker (#3078)', () => {
  const contract = fs.readFileSync(OUTPUT_CONTRACT, 'utf8');
  assert.deepEqual(contractAbandonedMissing(contract), [], 'the output contract must say an abandoned child no longer counts as outstanding (#3078)');
});

test('each output-contract abandoned-child assertion can actually go red on its own (discrimination proof)', () => {
  assertEachPatternGoesRed(fs.readFileSync(OUTPUT_CONTRACT, 'utf8'), CONTRACT_ABANDONED, contractAbandonedMissing);
});

// The primitive's numbers (sleep interval, call cap, minutes) are restated in four copies; they must
// agree. Each copy is reduced to the one place the primitive appears in it.
const PRIMITIVE = /`sleep\s+(\d+)`\s+Bash\s+calls,\s+at\s+most\s+(\d+)\s+\((\d+)\s+minutes\)/g;
const EXPECTED_PRIMITIVE = '20/60/20';
function primitiveCopies() {
  const taskPrompt = fs.readFileSync(TASK_PROMPT, 'utf8');
  const [firstCall, secondCall] = templateBlocks(taskPrompt);
  return {
    'subagent-dispatch-core.md': coreForegroundSection(fs.readFileSync(CORE, 'utf8')),
    'task-prompt.md item 7': item7Block(taskPrompt),
    'task-prompt.md first-call template': foregroundParagraph(firstCall),
    'task-prompt.md second-call template': foregroundParagraph(secondCall),
  };
}
const primitiveOf = (text) => [...text.matchAll(PRIMITIVE)].map((m) => m.slice(1).join('/'));
const statesPrimitiveOnce = (text) => {
  const found = primitiveOf(text);
  return found.length === 1 && found[0] === EXPECTED_PRIMITIVE;
};
const mismatchedPrimitiveCopies = (copies) => Object.entries(copies)
  .filter(([, text]) => !statesPrimitiveOnce(text))
  .map(([name]) => name);

test('the keep-alive primitive (sleep 20, at most 60, 20 minutes) agrees across all four copies (#3078)', () => {
  assert.deepEqual(mismatchedPrimitiveCopies(primitiveCopies()), [], 'every copy of the keep-alive primitive must state sleep 20, at most 60 (20 minutes), exactly once');
});

test('a mismatched keep-alive primitive copy can actually go red (discrimination proof)', () => {
  const copies = primitiveCopies();
  for (const name of Object.keys(copies)) {
    for (const [label, doctor] of [
      ['interval', (t) => t.replace(/`sleep\s+20`/, '`sleep 30`')],
      ['cap', (t) => t.replace(/at\s+most\s+60/, 'at most 15')],
      ['minutes', (t) => t.replace(/\(20\s+minutes\)/, '(5 minutes)')],
    ]) {
      const doctored = doctor(copies[name]);
      assert.notEqual(doctored, copies[name], `anchor text for the ${label} in ${name} not found — proof cannot discriminate`);
      assert.deepEqual(mismatchedPrimitiveCopies({ ...copies, [name]: doctored }), [name], `a ${label} mismatch in only ${name} must turn exactly that copy red`);
    }
  }
});
