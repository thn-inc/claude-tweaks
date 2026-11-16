// tests/foreground-execution-instruction.test.js — pins #1965: three dispatched Task calls this
// firing (1442 build, 1442 review, 1821 build) ended their turn narrating "Waiting for the
// background test run / fix-round / simplify subagent" with no status line. A Task agent that
// yields expecting a completion notification is never re-woken inside the Task — the dispatching
// session had to detect the missing status line and resume each one via SendMessage manually.
// Neither dispatch/task-prompt.md's Context pack nor build/dispatch.md's
// implementer/reviewer instruction paragraph said anything about foreground execution, so a
// dispatched agent (or the SDD implementer/reviewer sub-dispatches it composes) had no textual
// reason not to background a long-running command and wait on it. This suite pins the
// foreground-execution instruction in item 7, the handoff template and build/dispatch.md, and
// proves the check can actually go red (parse-signal-discipline). It also pins #3078/#3266's
// nested-dispatch keep-alive rule across the core section, task-prompt.md's item 7 and the handoff
// template, plus its output-contract and review/step3 restatements, each with its own go-red proof.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');

const PLUGIN = path.join(__dirname, '..', 'plugin');
const TASK_PROMPT = path.join(PLUGIN, 'skills', 'dispatch', 'task-prompt.md');
const BUILD_DISPATCH = path.join(PLUGIN, 'skills', 'build', 'dispatch.md');
const CORE = path.join(PLUGIN, 'skills', '_shared', 'subagent-dispatch-core.md');
const OUTPUT_CONTRACT = path.join(PLUGIN, 'skills', '_shared', 'subagent-output-contract.md');
const EXPRESS_PROMPT = path.join(PLUGIN, 'skills', 'dispatch', 'express-prompt.md');
const HANDOFF = path.join(PLUGIN, 'skills', 'flow', 'context-handoff.md');

// The load-bearing facts a reader (human or dispatched agent) must come away with — the exact
// failure mode #1965 documents. Each `\s+` absorbs the templates' hard line wrapping; the
// this/the alternation covers the direct address in item 7 and the handoff template versus
// build/dispatch.md's instruction about the dispatches SDD composes.
const REQUIRED = [
  [/never\s+with\s+`run_in_background`/i, 'never background a long-running command'],
  [/never\s+end\s+(?:this|the)\s+turn\s+waiting\s+on\s+a\s+background/i, "never end the turn waiting on a background run or a child agent's notification"],
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

const TEMPLATE_LABELS = ['first call (build,test)', 'second call (review,polish,wrap-up)'];

// task-prompt.md's two fenced Task-prompt templates, in TEMPLATE_LABELS order.
function templateBlocks(text) {
  const blocks = fencedBlocks(text);
  assert.equal(blocks.length, TEMPLATE_LABELS.length, `expected exactly two fenced Task-prompt blocks, found ${blocks.length}`);
  return blocks;
}

test('build/dispatch.md: the SDD invocation instruction directs implementer and reviewer dispatches to run in the foreground', () => {
  const text = readText(BUILD_DISPATCH);
  for (const [pattern, fact] of REQUIRED) {
    assert.match(text, pattern, `build/dispatch.md must instruct SDD's per-task implementer/reviewer dispatches to ${fact} (#1965)`);
  }
  assert.match(
    text,
    /implementer dispatch and every reviewer dispatch/i,
    'build/dispatch.md must scope the foreground instruction to every per-task implementer AND reviewer dispatch — the grandchildren that actually launched the background runs in #1965',
  );
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

// The facts the final-review fix wave added (abandoned child, the whole-final-reply re-wake, the
// 20-minute per-wave window and its log line). Written to match every copy of the rule -- core, item 7, the
// handoff template -- so each copy's list spreads this one array, and each pattern matches exactly once
// per copy so its go-red proof removes the only occurrence.
const SHARED_RULE = [
  [/blocked\s+or\s+fails[^.]*?is\s+not\s+a\s+wait\s+and\s+does\s+not\s+move\s+the\s+window's\s+deadline;\s+never\s+retry\s+it\s+in\s+another\s+form\s+\(a\s+`sleep`\s+of\s+any\s+length/, "a blocked or failed wait does not move the window's deadline and is never retried in another form"],
  [/\bis\s+abandoned\b/, 'a child self-judged at the bound is abandoned'],
  [/no\s+longer\s+counts\s+as\s+outstanding/, 'an abandoned child no longer counts as outstanding'],
  [/final\s+reply\s+still\s+ends\s+with\s+(?:its\s+usual\s+)?`STATUS:/, 'the final reply after an abandoned child still ends with STATUS:'],
  [/re-wakes\s+(?:you|the\s+agent)\s+after\s+(?:your|its)\s+final\s+reply[^.]*?\brepeat(?:ing)?\s+(?:its|your)\s+whole\s+final\s+reply\s+unchanged/, 'a late re-wake after the final reply repeats the whole final reply unchanged'],
  [/dispatcher\s+keeps\s+only\s+(?:the\s+agent's|your)\s+latest\s+reply/, 'the reason: the dispatcher keeps only the latest reply'],
  [/`ToolSearch`\s+finds\s+none,\s+deferred\s+or\s+otherwise/, 'the no-Agent-tool fallback checks ToolSearch for a deferred Agent tool'],
  [/child\s+that\s+reports\s+a\s+failure/i, 'a child that reports a failure has reported and is handled per the dispatching skill'],
  [/write-capable\s+child[\s\S]*?never\s+redone/, 'a write-capable child silent at the bound is never redone in-session'],
  [/returns\s+the\s+child's\s+own\s+reply[\s\S]{0,80}?that\s+child\s+has\s+reported\s+and\s+needs\s+no\s+wait/, "a call that returns the child's own reply means that child has reported"],
];

// #5604: the wait is one CLI call, and every copy of the rule says how to read its result. Each
// pattern matches exactly once per copy; the invocation alternation covers core's `${CLAUDE_PLUGIN_ROOT}`
// and item 7's / the handoff template's `{plugin-root}`.
const WAIT_FOR_FACTS = [
  [/`node\s+"(?:\$\{CLAUDE_PLUGIN_ROOT\}|\{plugin-root\})\/bin\/wait-for\.js"\s+agents\s+--ids\s+\{ids\}\s+--max-seconds\s+150`,\s+20\s+minutes\s+per\s+wave\s+of\s+children/, 'the wait-for.js agents invocation with its 20-minute window per wave'],
  [/`\{ids\}`\s+are\s+the\s+agent\s+ids\s+of\s+the\s+children\s+whose\s+notification\s+has\s+not\s+arrived\s+and\s+that\s+no\s+call\s+has\s+reported,\s+comma-separated\s+\(the\s+last\s+call's\s+`pending`\s+list;\s+empty\s+means\s+the\s+wait\s+is\s+over\)/, '{ids} are the children whose notification has not arrived and that no call has reported, taken from the last call pending list'],
  [/foreground\s+Bash\s+call\s+with\s+no\s+`timeout`\s+parameter:\s+the\s+command\s+returns\s+within\s+150\s+seconds,\s+under\s+the\s+180-second\s+ceiling/, 'a foreground call with no timeout parameter, returning under the 180-second ceiling'],
  [/Exit\s+0\s+means\s+a\s+listed\s+child\s+stopped:\s+its\s+notification\s+is\s+in\s+hand\s+or\s+arrives\s+next;\s+call\s+again\s+while\s+any\s+child\s+is\s+outstanding/, 'exit 0 means a listed child stopped'],
  [/Exit\s+3\s+with\s+`"bound":"call"`\s+means\s+call\s+again/, 'exit 3 with a call bound means call again'],
  [/Exit\s+3\s+with\s+`"bound":"deadline"`\s+means\s+the\s+20-minute\s+window\s+is\s+over:[^.]*?the\s+next\s+call\s+is\s+that\s+window/, 'exit 3 with a deadline bound ends the 20-minute window'],
  [/Any\s+other\s+exit\s+is\s+a\s+failed\s+wait\s+call/, 'any exit other than 0 and 3 is a failed wait call'],
  [/The\s+command's\s+output\s+line\s+is\s+the\s+wait's\s+log\s+line,\s+so\s+(?:write|the\s+agent\s+writes)\s+no\s+separate\s+one/, "the command's output line is the wait's log line"],
];
const INVOCATION_NEEDLE = '/bin/wait-for.js" agents --ids';

// Each `\s+` absorbs the hard line wrapping, as in REQUIRED above.
const KEEP_ALIVE = [
  [/\blaunches\s+async/i, 'a nested Agent call launches async'],
  [/keep[s]?\s+(?:its|your|the)\s+(?:own\s+)?turn\s+alive/i, 'the dispatcher keeps its own turn alive'],
  [/never\s+end[s]?\s+(?:its|your|the)\s+turn\s+with\s+(?:a|one)\s+child\s+outstanding/i, 'the dispatcher never ends its turn with a child outstanding'],
  [/no\s+`Agent`\/`Task`\s+tool/i, 'the fallback covers the no-Agent/Task-tool case'],
  [/`unconfirmed`/, 'findings from a self-judged unit are marked unconfirmed'],
  [/arrives\s+after\s+its\s+unit\s+was\s+self-judged\s+is\s+ignored;\s+it\s+never\s+changes\s+a\s+verdict/, 'a late child result is ignored and never changes a verdict'],
  [/Outside\s+the\s+rendered-UI\s+exception\s+below,\s+a\s+child\s+result/, 'the ignore sentence carries its own rendered-UI scope (#5280)'],
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
  const core = readText(CORE);
  assert.deepEqual(missingKeepAlive(coreForegroundSection(core)), [], 'Foreground Execution Discipline must state every keep-alive fact (#3078)');
  assert.ok(foldsNoTaskParagraph(core), 'the standalone No-Task paragraph must be folded into the new fallback clause (#3078)');
});

test('subagent-output-contract.md no longer tells a nested dispatcher to yield across turns (#3078)', () => {
  const contract = readText(OUTPUT_CONTRACT);
  assert.ok(dropsYieldRule(contract), 'the output contract still instructs nested dispatchers to yield across turns (#3078)');
  assert.deepEqual(contractKeepAliveMissing(contract), [], 'the output contract must state the keep-alive clause and the INTERIM_STATUS marker rule (#3078)');
});

test('each keep-alive assertion can actually go red on its own (discrimination proof)', () => {
  assertEachPatternGoesRed(coreForegroundSection(readText(CORE)), KEEP_ALIVE, missingKeepAlive);
});

test('the folded-paragraph and yield-rule assertions can actually go red (discrimination proof)', () => {
  const core = readText(CORE);
  const reinsertedHeading = '\n\n**No `Task`/Agent tool available.** Some environments expose no `Task`/Agent dispatch tool at all.\n';
  assert.equal(foldsNoTaskParagraph(core + reinsertedHeading), false, 'the re-inserted No-Task heading must turn the fold assertion red');

  const contract = readText(OUTPUT_CONTRACT);
  const nestedClause = /keeps its turn alive until every child reports \(`_shared\/subagent-dispatch-core\.md`'s Foreground Execution Discipline\)\./;
  assert.match(contract, nestedClause, 'anchor text for the nested-dispatcher clause not found');
  const yieldDoctored = contract.replace(nestedClause, 'must yield control across several of its own turns before its real final reply.');
  assert.equal(dropsYieldRule(yieldDoctored), false, 'the old yield wording must turn the no-yield assertion red');
});

test('each output-contract keep-alive and interim-marker assertion can actually go red on its own (discrimination proof)', () => {
  assertEachPatternGoesRed(readText(OUTPUT_CONTRACT), CONTRACT_KEEP_ALIVE, contractKeepAliveMissing);
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

// #4826: the low-tier dispatch rule the carve-out used to amend now lives in step3-tier-variants.md.
const TIER_VARIANTS = path.join(PLUGIN, 'skills', 'review', 'step3-tier-variants.md');

test('step3-lens-dispatch.md has no dispatched-reviewer carve-out (#3078)', () => {
  const step3 = readText(STEP3);
  assert.deepEqual(carveOutPhrases(step3), [], 'step3-lens-dispatch.md still carves out a dispatched reviewer from its lens dispatch (#3078)');
  assert.deepEqual(carveOutPhrases(readText(TIER_VARIANTS)), [], 'step3-tier-variants.md carves out a dispatched reviewer from its low-tier dispatch (#3078)');
});

test("step3 Foreground note covers the reviewer's own lens dispatches (#3078)", () => {
  const note = foregroundNote(readText(STEP3));
  assert.notEqual(note, '', 'the "> **Foreground Execution Discipline:**" note line was not found in step3-lens-dispatch.md');
  assert.deepEqual(lensNoteMissing(note), [], 'the step3 Foreground note must cover the reviewer\'s own lens dispatches (#3078)');
});

test('step3 hung-single-read paragraph exempts a dispatched reviewer from the nudge (#3078)', () => {
  assert.deepEqual(hungAgentMissing(readText(STEP3)), [], 'the hung single-read paragraph must route a dispatched reviewer to its keep-alive bound and skip the nudge (#3078)');
});

test('the step3 hung-single-read assertion can actually go red (discrimination proof)', () => {
  assertEachPatternGoesRed(readText(STEP3), HUNG_AGENT, hungAgentMissing);
});

test('the step3 carve-out predicate can actually go red (discrimination proof)', () => {
  const step3 = readText(STEP3);
  const reinserted = step3 + '\n\n' + CARVE_OUT_SENTENCE + '\n';
  assert.notDeepEqual(carveOutPhrases(reinserted), [], 'the re-inserted carve-out sentence must turn the no-carve-out assertion red');
});

test('the step3 Foreground-note predicate can actually go red (discrimination proof)', () => {
  const note = foregroundNote(readText(STEP3));
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
  [/\blaunches\s+async/i, 'a nested Agent call launches async'],
  [/`unconfirmed`/, 'the self-judged fallback marks findings unconfirmed'],
  [/never\s+end\s+your\s+turn\s+with\s+one\s+outstanding/, 'item 7 never ends the turn with a child outstanding'],
  [/Ignore\s+a\s+late\s+result/, 'item 7 ignores a late result'],
  ...REQUIRED,
  [/run\s+the\s+project's\s+test\s+command\s+and\s+every\s+other\s+long-running\s+command/, "item 7 names the project's test command"],
  [/log\s+the\s+downgrade/i, "item 7's fallback logs the downgrade"],
  [/output\s+redirected\s+to\s+a\s+file/i, 'item 7 says long output is redirected to a file'],
  ...SHARED_RULE,
];
const item7Missing = missingFactsOf(ITEM7);
const dropsNothingWakes = (block) => !/nothing wakes you/.test(block);

const dropsInTurnCarveOut = (block) => !/It\s+does\s+not\s+cover\s+an\s+in-turn/.test(block);

const dropsPrimaryResumeSignal = (text) => !/primary resume signal/.test(text);
const RATIONALE = [
  [/`_shared\/subagent-dispatch-core\.md`'s\s+Foreground\s+Execution\s+Discipline/, 'the #2533 rationale cites the core section'],
];
const rationaleMissing = missingFactsOf(RATIONALE);

test('task-prompt item 7 drops "nothing wakes you" and states what ends a turn (#3078, #3266)', () => {
  const item7 = item7Block(readText(TASK_PROMPT));
  assert.ok(dropsNothingWakes(item7), 'item 7 still says "nothing wakes you" — the framing #3078 retired (#3266)');
  assert.deepEqual(item7Missing(item7), [], 'item 7 must state every turn-ending and keep-alive fact (#3078, #3266)');
});

test('neither fenced template keeps the in-turn carve-out (#3078)', () => {
  const blocks = templateBlocks(readText(TASK_PROMPT));
  for (const [index, block] of blocks.entries()) {
    const label = TEMPLATE_LABELS[index];
    assert.ok(dropsInTurnCarveOut(block), `${label} template still carries the in-turn carve-out (#3078)`);
  }
});

test("the #2533 rationale cites the core section, not dispatch-waiting.md's resume signal (#3078)", () => {
  const text = readText(TASK_PROMPT);
  assert.ok(dropsPrimaryResumeSignal(text), 'task-prompt.md still cites dispatch-waiting.md\'s "primary resume signal" (#3078)');
  assert.deepEqual(rationaleMissing(text), [], 'the #2533 rationale must cite subagent-dispatch-core.md\'s Foreground Execution Discipline (#3078)');
});

test('AC3.1 AC3.2 AC3.3: each task-prompt assertion can actually go red on its own (discrimination proof)', () => {
  const text = readText(TASK_PROMPT);
  assertEachPatternGoesRed(item7Block(text), ITEM7, item7Missing);
  assertEachPatternGoesRed(text, RATIONALE, rationaleMissing);
});

test('the task-prompt absence predicates can actually go red (discrimination proof)', () => {
  const text = readText(TASK_PROMPT);
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
  const contract = readText(OUTPUT_CONTRACT);
  assert.deepEqual(contractAbandonedMissing(contract), [], 'the output contract must say an abandoned child no longer counts as outstanding (#3078)');
});

test('each output-contract abandoned-child assertion can actually go red on its own (discrimination proof)', () => {
  assertEachPatternGoesRed(readText(OUTPUT_CONTRACT), CONTRACT_ABANDONED, contractAbandonedMissing);
});

// context-handoff.md's one fenced template carries the rule as its "Async-wait discipline (required):" paragraph.
function handoffWaitParagraph(text) {
  const blocks = fencedBlocks(text);
  assert.equal(blocks.length, 1, `context-handoff.md must hold exactly one fenced template, found ${blocks.length}`);
  const found = blocks[0].split(/\r?\n\r?\n/).filter((p) => p.startsWith('Async-wait discipline (required):'));
  assert.equal(found.length, 1, `expected exactly one "Async-wait discipline (required):" paragraph in the handoff template, found ${found.length}`);
  return found[0];
}

test('AC3: REQUIRED holds on the handoff template paragraph (#5601)', () => {
  const paragraph = handoffWaitParagraph(readText(HANDOFF));
  assert.deepEqual(missingFactsOf(REQUIRED)(paragraph), [], 'the handoff template must state the foreground rule as item 7 does (#5601)');
  assertEachPatternGoesRed(paragraph, REQUIRED, missingFactsOf(REQUIRED));
});

// AC7.1: the multi-spec wave prompt copies items 1, 6 and 7 of the Context pack and no template clause.
const MULTISPEC = path.join(PLUGIN, 'skills', 'flow', 'multispec-parallel-waves.md');
const MULTISPEC_PACK = /`\{context-pack\}` is `dispatch\/task-prompt\.md`'s Context pack items 1 \(the literal plugin root\), 6 \(the worktree shell constraint\) and 7 \(async-wait discipline, with its `INTERIM_STATUS` rule\)/;
// Item 7 carries `{plugin-root}` in its wait-for.js line, so the orchestrator resolves it there as in item 1 (#5604).
const MULTISPEC_RESOLVES_ROOT = /`\{plugin-root\}` resolved to this session's own plugin root wherever it appears in them \(item 1, and item 7's `wait-for\.js` line\)/;
const multispecPackGaps = (p) => [
  ...(MULTISPEC_PACK.test(p) ? [] : ['names items 1, 6 and 7']),
  ...(MULTISPEC_RESOLVES_ROOT.test(p) ? [] : ['resolves {plugin-root} in items 1 and 7']),
  ...(/template's Foreground execution clause/i.test(p) ? ['no template clause'] : []),
];
function multispecPackParagraph(text) {
  const found = text.split(/\r?\n\r?\n/).filter((p) => p.startsWith('Inline the block below verbatim'));
  assert.equal(found.length, 1, `expected exactly one "Inline the block below verbatim" paragraph, found ${found.length}`);
  return found[0].replace(/\s+/g, ' ');
}

test('AC7.1: multispec-parallel-waves.md inlines items 1, 6 and 7 and no template clause (#5601)', () => {
  const paragraph = multispecPackParagraph(readText(MULTISPEC));
  assert.deepEqual(multispecPackGaps(paragraph), []);
  const withClause = `${paragraph.replace(/ all copied verbatim/, ", plus that file's `build,test` template's Foreground execution clause, all copied verbatim")}`;
  assert.notEqual(withClause, paragraph);
  assert.deepEqual(multispecPackGaps(withClause), ['no template clause']);
  const dropped = paragraph.replace(' and 7 (async-wait discipline, with its `INTERIM_STATUS` rule)', '');
  assert.notEqual(dropped, paragraph);
  assert.deepEqual(multispecPackGaps(dropped), ['names items 1, 6 and 7']);
  const stripped = paragraph.replace(MULTISPEC_RESOLVES_ROOT, '');
  assert.notEqual(stripped, paragraph);
  assert.deepEqual(multispecPackGaps(stripped), ['resolves {plugin-root} in items 1 and 7']);
  const itemOneOnly = paragraph.replace(MULTISPEC_RESOLVES_ROOT, "item 1 resolved to this session's own plugin root");
  assert.notEqual(itemOneOnly, paragraph);
  assert.deepEqual(multispecPackGaps(itemOneOnly), ['resolves {plugin-root} in items 1 and 7']);
});

// #5601: a dispatched agent's prompt states the foreground-wait rule once, through Context pack item 7;
// the fenced templates no longer carry their own paragraph. Counted on the rendered prompt, because
// that is the text the agent reads.
const { renderTaskPrompt } = require('../plugin/bin/lib/dispatch/task-prompt');
const PRE_5601_PARAGRAPH = path.join(__dirname, 'fixtures', 'dispatch-prompt', 'foreground-paragraph-pre-5601.txt');
const RENDER_OPTS = {
  issues: [5601],
  runDir: '/tmp/x y/.claude-tweaks/pipelines/2026-11-16T000000-record-5601',
  pluginRoot: '/p/root',
  policyValues: 'autonomy=unattended, integration-model=pr-first',
  selectedAt: '2026-11-16T00:00:00.000Z',
  effortLine: '[Effort: high — apply high-level reasoning depth to this task.]',
};
const countOf = (squashed, pattern) => squashed.split(pattern).length - 1;
function renderedCounts(prompt) {
  const squashed = prompt.replace(/\s+/g, ' ');
  return {
    invocation: countOf(squashed, INVOCATION_NEEDLE),
    filled: countOf(squashed, 'node "/p/root/bin/wait-for.js" agents --ids'),
    probe: countOf(squashed, 'probe the worktree its prompt names, read-only'),
    runInBackground: countOf(squashed, '`run_in_background`'),
    projectTestCmd: countOf(squashed, "the project's test command"),
  };
}
const renderCall = (text, call) => renderTaskPrompt(text, { ...RENDER_OPTS, call });

test('AC4.1: a rendered first-call and second-call prompt each hold the invocation once, plugin root filled (#5604)', () => {
  const text = readText(TASK_PROMPT);
  for (const call of ['first', 'second']) {
    const rendered = renderCall(text, call);
    const counts = renderedCounts(rendered);
    assert.equal(counts.invocation, 1, `${call} call: the wait-for.js invocation`);
    assert.equal(counts.filled, 1, `${call} call: the invocation with the plugin root filled`);
    assert.ok(!rendered.replace(/\s+/g, ' ').includes('{plugin-root}/bin/wait-for.js'), `${call} call: no unfilled {plugin-root} in the invocation`);
    assert.equal(counts.probe, 1, `${call} call: the worktree probe`);
    assert.ok(counts.runInBackground >= 1, `${call} call: names run_in_background`);
    assert.ok(counts.projectTestCmd >= 1, `${call} call: names the project's test command`);
  }
});

// Insert the paragraph immediately before the first `{context-pack}` line of each fenced template.
function withParagraphRestored(text, paragraph) {
  const out = [];
  let inFence = false;
  let done = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) { inFence = !inFence; done = false; }
    if (inFence && !done && line === '{context-pack}') { out.push(paragraph, ''); done = true; }
    out.push(line);
  }
  return out.join('\n');
}

test('AC1.1: the rendered-count check goes red with a template paragraph restored (#5601)', () => {
  const text = readText(TASK_PROMPT);
  const restored = withParagraphRestored(text, readText(PRE_5601_PARAGRAPH).trimEnd());
  assert.notEqual(restored, text);
  for (const call of ['first', 'second']) {
    const counts = renderedCounts(renderCall(restored, call));
    assert.equal(counts.probe, 2, `${call} call: the base-commit probe count`);
  }
});

test('AC4.1: the rendered-count check goes red with the invocation line restored in a template (#5604)', () => {
  const text = readText(TASK_PROMPT);
  const restored = withParagraphRestored(text, 'keep alive with `node "{plugin-root}/bin/wait-for.js" agents --ids {ids} --max-seconds 150`.');
  assert.notEqual(restored, text);
  for (const call of ['first', 'second']) {
    const counts = renderedCounts(renderCall(restored, call));
    assert.equal(counts.invocation, 2, `${call} call: the invocation held once by item 7 and once by the restored line`);
  }
});

// A fenced template holds no Foreground paragraph and its `{context-pack}` exactly once (#5601). The
// paragraph is found by its heading, or by the wait-for.js invocation and the probe phrase it carried, so an
// indented or re-headed copy is still caught. The raw block never holds item 7's text.
const templateDefects = (blocks) => blocks.flatMap(([label, block]) => {
  const squashed = block.replace(/\s+/g, ' ');
  const foreground = block.split(/\r?\n\r?\n/).some((p) => p.startsWith('Foreground execution (required):'))
    || squashed.includes(INVOCATION_NEEDLE)
    || squashed.includes('probe the worktree its prompt names, read-only');
  return foreground || countOf(block, '{context-pack}') !== 1 ? [label] : [];
});
function labelledTemplates() {
  const task = templateBlocks(readText(TASK_PROMPT));
  const express = fencedBlocks(readText(EXPRESS_PROMPT));
  assert.equal(express.length, 2, `expected exactly two fenced express-prompt blocks, found ${express.length}`);
  return [
    ['task-prompt first call', task[0]], ['task-prompt second call', task[1]],
    ['express-prompt express call', express[0]], ['express-prompt review call', express[1]],
  ];
}

test('AC2.1 AC2.2: no fenced template holds a Foreground paragraph; each holds {context-pack} once (#5601)', () => {
  assert.deepEqual(templateDefects(labelledTemplates()), []);
});

test('AC2.1 AC2.2: the template-defect check goes red for a restored paragraph and a duplicated placeholder (#5601)', () => {
  const blocks = labelledTemplates();
  const paragraph = readText(PRE_5601_PARAGRAPH).trimEnd();
  for (const [index, [label, block]] of blocks.entries()) {
    const restored = blocks.map((b, i) => (i === index ? [label, withParagraphRestored(`\`\`\`\n${block}\n\`\`\``, paragraph)] : b));
    assert.notEqual(restored[index][1], block);
    assert.deepEqual(templateDefects(restored), [label], `a restored paragraph in only ${label}`);
    const duplicated = blocks.map((b, i) => (i === index ? [label, `${block}\n\n{context-pack}`] : b));
    assert.notEqual(duplicated[index][1], block);
    assert.deepEqual(templateDefects(duplicated), [label], `a duplicated {context-pack} in only ${label}`);
  }
});

// The restored paragraph can dodge a head-only check: indented, or with its heading renamed (#5601 final review).
test('AC2.1: the template-defect check goes red for an indented or re-headed restored paragraph (#5601)', () => {
  const blocks = labelledTemplates();
  const paragraph = readText(PRE_5601_PARAGRAPH).trimEnd();
  const shapes = [
    ['indented two spaces', paragraph.split('\n').map((line) => `  ${line}`).join('\n')],
    ['re-headed', paragraph.replace('Foreground execution (required):', 'Foreground execution:')],
  ];
  for (const [shape, doctoredParagraph] of shapes) {
    assert.notEqual(doctoredParagraph, paragraph, `${shape}: the doctoring changed nothing`);
    for (const [index, [label, block]] of blocks.entries()) {
      const restored = blocks.map((b, i) => (i === index ? [label, withParagraphRestored(`\`\`\`\n${block}\n\`\`\``, doctoredParagraph)] : b));
      assert.notEqual(restored[index][1], block);
      assert.deepEqual(templateDefects(restored), [label], `a ${shape} restored paragraph in only ${label}`);
    }
  }
});

// The invocation line (its call bound and window length) is restated in three copies; they must
// agree. Each copy is reduced to the one place the rule appears in it.
function primitiveCopies() {
  return {
    'subagent-dispatch-core.md': coreForegroundSection(readText(CORE)),
    'task-prompt.md item 7': item7Block(readText(TASK_PROMPT)),
    'context-handoff.md template': handoffWaitParagraph(readText(HANDOFF)),
  };
}
const statesInvocationOnce = (text) => {
  const squashed = text.replace(/\s+/g, ' ');
  return countOf(squashed, INVOCATION_NEEDLE) === 1
    && /--max-seconds\s+150`,\s+20\s+minutes\s+per\s+wave/.test(squashed);
};
const mismatchedPrimitiveCopies = (copies) => Object.entries(copies)
  .filter(([, text]) => !statesInvocationOnce(text))
  .map(([name]) => name);

test('AC1.1: each copy holds the invocation line exactly once, with --max-seconds 150 and a 20-minute window (#5604)', () => {
  assert.deepEqual(mismatchedPrimitiveCopies(primitiveCopies()), [], 'every copy of the keep-alive rule must state the wait-for.js invocation exactly once, with --max-seconds 150 and a 20-minute window');
});

test('AC1.1: a mismatched invocation copy can actually go red (discrimination proof)', () => {
  const copies = primitiveCopies();
  for (const name of Object.keys(copies)) {
    for (const [label, doctor] of [
      ['call bound', (t) => t.replace(/--max-seconds\s+150/, '--max-seconds 100')],
      ['window', (t) => t.replace(/20\s+minutes\s+per\s+wave/, '30 minutes per wave')],
      ['duplicate', (t) => `${t} node "{plugin-root}/bin/wait-for.js" agents --ids {ids} --max-seconds 150`],
    ]) {
      const doctored = doctor(copies[name]);
      assert.notEqual(doctored, copies[name], `anchor text for the ${label} in ${name} not found — proof cannot discriminate`);
      assert.deepEqual(mismatchedPrimitiveCopies({ ...copies, [name]: doctored }), [name], `a ${label} mismatch in only ${name} must turn exactly that copy red`);
    }
  }
});

test('AC1.1 AC1.2: every copy states each wait-for.js fact (#5604)', () => {
  for (const [name, text] of Object.entries(primitiveCopies())) {
    assert.deepEqual(missingFactsOf(WAIT_FOR_FACTS)(text), [], name);
  }
});

test('AC1.2: each wait-for.js fact goes red when removed from any single copy (discrimination proof)', () => {
  for (const text of Object.values(primitiveCopies())) {
    assertEachPatternGoesRed(text, WAIT_FOR_FACTS, missingFactsOf(WAIT_FOR_FACTS));
  }
});

test('AC5.1: the core invocation line runs against the real CLI and reports a call bound in window 1 (#5604)', (t) => {
  const section = coreForegroundSection(readText(CORE));
  const line = section.replace(/\s+/g, ' ').match(/`(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/wait-for\.js" agents [^`]*)`/);
  assert.ok(line, 'the core section holds no wait-for.js invocation line');
  assert.strictEqual(line[1], 'node "${CLAUDE_PLUGIN_ROOT}/bin/wait-for.js" agents --ids {ids} --max-seconds 150');
  const fwd = (p) => p.replace(/\\/g, '/');
  const fill = (cmd) => {
    let out = cmd;
    for (const [from, to] of [
      ['node', `"${fwd(process.execPath)}"`],
      ['${CLAUDE_PLUGIN_ROOT}', fwd(PLUGIN)],
      ['{ids}', 'fixture-a,fixture-b'],
    ]) {
      const next = out.replace(from, to);
      assert.notEqual(next, out, `filling ${from} changed nothing`);
      out = next;
    }
    return out;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wait-for-5604-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (cmd) => spawnSync('bash', ['-c', cmd], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir, CLAUDE_CODE_SESSION_ID: `fixture-5604-${process.pid}` },
  });
  const filled = fill(line[1]);
  const bounded = filled.replace('--max-seconds 150', '--max-seconds 1');
  assert.notEqual(bounded, filled, 'the --max-seconds replace changed nothing');
  const result = run(bounded);
  assert.equal(result.status, 3, `stdout: ${result.stdout} stderr: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.equal(parsed.bound, 'call');
  assert.equal(parsed.window, 1);
  const control = filled.replace('--max-seconds 150', '--max-seconds 151');
  assert.notEqual(control, filled, 'the control --max-seconds replace changed nothing');
  assert.equal(run(control).status, 2, 'an over-ceiling --max-seconds 151 must exit 2');
});

// #3722: the dispatcher keeps only the latest reply, so a re-wake answered with the bare STATUS line
// replaced the report. No copy may keep the STATUS-only wording.
const STATUS_ONLY = /repeat(?:ing)?\s+that\s+final\s+`STATUS:`\s+line/;
const repeatsStatusOnlyCopies = (copies) => Object.entries(copies).filter(([, t]) => STATUS_ONLY.test(t)).map(([n]) => n);

test('no copy answers a late re-wake with the STATUS line alone (#3722)', () => {
  assert.deepEqual(repeatsStatusOnlyCopies(primitiveCopies()), [], 'no copy may answer a late re-wake with the bare STATUS line (#3722)');
});

test('a copy reverting to the STATUS-only wording goes red (discrimination proof)', () => {
  const copies = primitiveCopies();
  for (const name of Object.keys(copies)) {
    const doctored = { ...copies, [name]: copies[name] + ' repeat that final `STATUS:` line unchanged.' };
    assert.deepEqual(repeatsStatusOnlyCopies(doctored), [name], `a STATUS-only wording in only ${name} must turn exactly that copy red`);
  }
});

const CORE_ABANDONED = [
  [/abandoned\s+child\s+cannot\s+be\s+stopped/, 'an abandoned child cannot be stopped'],
  [/`TaskStop`\s+refuses\s+a\s+nested\s+child/, 'TaskStop refuses a nested child'],
  [/hold\s+the\s+agent's\s+final\s+result\s+until\s+it\s+finishes/, "the harness may hold the agent's final result until it finishes"],
  [/bound\s+caps\s+the\s+wait,\s+not\s+the\s+delivery/, 'the bound caps the wait, not the delivery'],
];
const coreAbandonedMissing = missingFactsOf(CORE_ABANDONED);

test('the core section records that an abandoned nested child cannot be stopped and may delay the final result (#3722)', () => {
  assert.deepEqual(coreAbandonedMissing(coreForegroundSection(readText(CORE))), [], 'Foreground Execution Discipline must record the abandoned-child facts (#3722)');
});

test('each core abandoned-child assertion can actually go red on its own (discrimination proof)', () => {
  assertEachPatternGoesRed(coreForegroundSection(readText(CORE)), CORE_ABANDONED, coreAbandonedMissing);
});

// #3722: interactive 2.1.302 re-wakes a dispatched agent; what holds everywhere is "cannot count on it".
const UNQUALIFIED = /never\s+(?:be\s+)?(?:re-)?woken|nothing\s+(?:ever\s+)?re-wakes|no\s+notification\s+mechanism|none\s+reaches\s+a\s+dispatched\s+agent/i;
const claimSites = () => ({
  ...primitiveCopies(),
  'build/dispatch.md': readText(BUILD_DISPATCH),
  'review/step3 Foreground note': foregroundNote(readText(STEP3)),
});
const unqualifiedClaimSites = (sites) => Object.entries(sites).filter(([, t]) => UNQUALIFIED.test(t)).map(([n]) => n);
test('no copy states the never-re-woken claim unqualified (#3722)', () => {
  assert.deepEqual(unqualifiedClaimSites(claimSites()), [], 'no copy may state the never-re-woken claim unqualified (#3722)');
});
test('an unqualified never-re-woken claim in any one copy goes red (discrimination proof)', () => {
  const sites = claimSites();
  for (const name of Object.keys(sites)) {
    const doctored = { ...sites, [name]: sites[name] + ' It is never re-woken.' };
    assert.deepEqual(unqualifiedClaimSites(doctored), [name], `an unqualified claim in only ${name} must turn exactly that copy red`);
  }
});

// The positive twin of the check above: every claim site must carry the qualified wording.
const QUALIFIED = /cannot\s+count\s+on\s+being\s+re-woken/;
const unqualifiedWordingSites = (sites) => Object.entries(sites).filter(([, t]) => !QUALIFIED.test(t)).map(([n]) => n);
test('every re-wake claim site carries the qualified "cannot count on being re-woken" wording (#3722)', () => {
  assert.deepEqual(unqualifiedWordingSites(claimSites()), [], 'every claim site must state the qualified wording (#3722)');
});
test('a claim site losing the qualified wording goes red (discrimination proof)', () => {
  const sites = claimSites();
  for (const name of Object.keys(sites)) {
    const doctored = { ...sites, [name]: sites[name].replace(new RegExp(QUALIFIED.source, 'g'), '') };
    assert.notEqual(doctored[name], sites[name], `anchor text for the qualified wording in ${name} not found — proof cannot discriminate`);
    assert.deepEqual(unqualifiedWordingSites(doctored), [name], `losing the qualified wording in only ${name} must turn exactly that site red`);
  }
});

// A synchronous nested call returns the child's own reply, so "always launches async" is false.
const ALWAYS_ASYNC = /always\s+launches\s+async/i;
const alwaysAsyncCopies = (copies) => Object.entries(copies).filter(([, t]) => ALWAYS_ASYNC.test(t)).map(([n]) => n);
test('no copy says a nested Agent call always launches async (#3722)', () => {
  assert.deepEqual(alwaysAsyncCopies(primitiveCopies()), [], 'no copy may say a nested Agent call always launches async (#3722)');
});
test('a copy reverting to "always launches async" goes red (discrimination proof)', () => {
  const copies = primitiveCopies();
  for (const name of Object.keys(copies)) {
    const doctored = { ...copies, [name]: copies[name] + ' It always launches async.' };
    assert.deepEqual(alwaysAsyncCopies(doctored), [name], `an "always launches async" in only ${name} must turn exactly that copy red`);
  }
});

const CORE_MEASURED = [
  [/cannot\s+count\s+on\s+being\s+re-woken\s+once\s+its\s+turn\s+ends/, 'the Background work claim is qualified'],
  [/Measured\s+on\s+Claude\s+Code\s+\(#3722\)/, 'the measured facts cite #3722'],
  [/interactive\s+2\.1\.302\s+holds\s+it\s+open/, 'interactive 2.1.302 holds the agent open'],
  [/headless\s+\(`claude\s+-p`\)\s+2\.1\.299\s+and\s+older\s+never\s+re-wake\s+it/, 'headless 2.1.299 and older never re-wake it'],
  [/headless\s+2\.1\.302\s+and\s+later\s+runs\s+a\s+nested\s+`Agent`\s+call\s+synchronously/, 'headless 2.1.302+ runs nested Agent calls synchronously'],
];
const coreMeasuredMissing = missingFactsOf(CORE_MEASURED);
test('the core Background work paragraph names the measured re-wake facts (#3722)', () => {
  assert.deepEqual(coreMeasuredMissing(coreForegroundSection(readText(CORE))), [], 'Background work must name the measured re-wake facts (#3722)');
});
test('each core measured-fact assertion can actually go red on its own (discrimination proof)', () => {
  assertEachPatternGoesRed(coreForegroundSection(readText(CORE)), CORE_MEASURED, coreMeasuredMissing);
});

// #4557: at the 20-minute window's bound, a still-outstanding write-capable child's worktree is probed
// read-only and the wait continues while it progresses, instead of stopping BLOCKED on elapsed time
// alone. One passage, the same words in all three copies; each pattern matches once per copy.
const PROGRESS_CHECK = [
  [/probe\s+the\s+worktree\s+its\s+prompt\s+names,\s+read-only/, 'the probe reads the worktree the child prompt names, read-only'],
  [/`git\s+-C\s+"\{child-worktree\}"\s+rev-parse\s+HEAD`/, 'the probe reads the child worktree HEAD'],
  [/`git\s+-C\s+"\{child-worktree\}"\s+--no-optional-locks\s+status\s+--porcelain`/, 'the probe reads its --no-optional-locks porcelain status'],
  [/`git\s+-C\s+"\{child-worktree\}"\s+--no-optional-locks\s+diff\s+HEAD`\s+piped\s+to\s+`git\s+hash-object\s+--stdin`\s+\(a\s+`fatal:`\s+line\s+fails\s+the\s+probe\)/, 'the probe hashes the diff against HEAD, so re-edits count as progress (AC9.1)'],
  [/against\s+the\s+previous\s+probe\s+\(taken\s+right\s+after\s+launching\s+the\s+wave,\s+then\s+at\s+each\s+bound/, 'each bound compares with the previous probe, the first taken right after the wave launches (AC1.1)'],
  [/lacking\s+one,\s+the\s+first\s+bound's\s+probe\s+sets\s+it\s+and\s+grants\s+a\s+window/, 'with no launch probe, the first bound sets the baseline and grants one window'],
  [/Per\s+wave,\s+while\s+any\s+child\s+shows\s+a\s+change,\s+log\s+one\s+wait\s+line\s+and\s+grant\s+one\s+more\s+20-minute\s+window/, 'per wave, a change in any child logs a wait line and grants one more 20-minute window (Decision: Reading B)'],
  [/stop\s+when\s+a\s+whole\s+window\s+passes\s+with\s+no\s+change/, 'BLOCKED only after a whole window with no change'],
  [/ceiling\s+of\s+3\s+windows\s+\(60\s+minutes\)\s+per\s+wave/, 'the 3-window (60-minute) ceiling'],
  [/\(`no\s+progress\s+for\s+one\s+window`\s+or\s+`ceiling\s+reached\s+while\s+progressing`\)/, 'the BLOCKED report names which of exactly two conditions fired — no third (AC8.2)'],
  [/and\s+every\s+unchanged\s+child/, 'the BLOCKED report names every child that showed no change (Decision: Reading B)'],
  [/Children\s+sharing\s+a\s+worktree\s+progress\s+together/, 'children sharing one worktree count as progressing together (Decision: Reading B)'],
  [/a\s+child\s+whose\s+prompt\s+names\s+no\s+worktree\s+counts\s+as\s+unchanged/, 'a child with no named worktree counts as unchanged (spec Technical Approach)'],
  [/A\s+failed\s+wait\s+call\s+counts\s+as\s+no\s+wait\s+but\s+ends\s+its\s+window,\s+and\s+the\s+probe\s+runs\s+as\s+at\s+any\s+bound/, 'a failed wait call in an extension window expires that bound and the probe runs (AC8.1)'],
  [/failed\s+probe\s+command\s+counts\s+as\s+no\s+change,\s+never\s+retried\s+in\s+another\s+form/, 'a failed probe command counts as no change and is never retried in another form'],
  [/Read-only\s+units\s+keep\s+the\s+first-bound\s+self-judge/, 'a read-only unit is still self-judged at the first bound'],
];
// The two standing rules the passage sits between must survive byte-unchanged in every copy.
const STANDING_RULES = [
  [/never\s+reading\s+or\s+tailing\s+a\s+running\s+child's\s+`output_file`/, 'the never-read output_file rule stands'],
  [/write-capable\s+child\s+\(one\s+that\s+edits\s+files\)\s+still\s+silent\s+at\s+the\s+bound\s+is\s+never\s+redone\s+in-session/, 'the never-redone-in-session rule stands'],
];
const missingProgress = missingFactsOf(PROGRESS_CHECK);
const missingStanding = missingFactsOf(STANDING_RULES);

test('AC1.1 AC1.2 AC1.3 AC2.1 AC4.1 AC7.1 AC7.2 AC7.3 AC7.4 AC8.1 AC8.2 AC9.1: every copy states the at-bound progress check for write-capable children (#4557)', () => {
  for (const [name, text] of Object.entries(primitiveCopies())) {
    assert.deepEqual(missingProgress(text), [], name);
  }
});

test('AC5.1: each progress-check assertion goes red when removed from any single copy (discrimination proof)', () => {
  for (const text of Object.values(primitiveCopies())) {
    assertEachPatternGoesRed(text, PROGRESS_CHECK, missingProgress);
  }
});

test('AC3.1: the never-redone and never-read-output_file rules stand in every copy (#4557)', () => {
  for (const [name, text] of Object.entries(primitiveCopies())) {
    assert.deepEqual(missingStanding(text), [], name);
  }
});

test('AC3.1: each standing-rule assertion goes red when removed from any single copy (discrimination proof)', () => {
  for (const text of Object.values(primitiveCopies())) {
    assertEachPatternGoesRed(text, STANDING_RULES, missingStanding);
  }
});

// The passage extends the write-capable stop, so it must follow that stop's last sentence in each
// copy, directly: only the lead-in `Before that stop` (core adds `(#4557)`) may sit between them.
const STOP_SENTENCE = 'naming that child and its unit.';
const LEAD_IN = /^\s*Before that stop( \(#4557\))?,\s*$/;
const anchorsOf = (text) => ({ stopAt: text.indexOf(STOP_SENTENCE), passageAt: text.search(PROGRESS_CHECK[0][0]) });
const misorderedCopies = (copies) => Object.entries(copies)
  .filter(([, text]) => {
    const { stopAt, passageAt } = anchorsOf(text);
    return stopAt === -1 || passageAt === -1 || stopAt > passageAt
      || !LEAD_IN.test(text.slice(stopAt + STOP_SENTENCE.length, passageAt));
  })
  .map(([name]) => name);

test('AC1.3: the progress check follows the write-capable stop sentence in every copy', () => {
  assert.deepEqual(misorderedCopies(primitiveCopies()), []);
});

test('AC1.3: a copy with the passage moved before the stop sentence goes red (discrimination proof)', () => {
  const copies = primitiveCopies();
  for (const [name, text] of Object.entries(copies)) {
    const { stopAt, passageAt } = anchorsOf(text);
    assert.ok(stopAt !== -1 && passageAt !== -1, `anchor text for the stop sentence or the passage not found in ${name}`);
    const first = text.slice(passageAt).match(/^[^.]*\./)[0];
    const doctored = text.slice(0, stopAt) + first + ' ' + text.slice(stopAt, passageAt) + text.slice(passageAt + first.length);
    assert.notEqual(doctored, text, `permutation anchor for ${name} not found`);
    assert.deepEqual(misorderedCopies({ ...copies, [name]: doctored }), [name], `moving the passage before the stop sentence in only ${name} must turn exactly that copy red`);
  }
});

test('AC1.3: a copy with an unrelated sentence between the stop sentence and the passage goes red (discrimination proof)', () => {
  const copies = primitiveCopies();
  for (const [name, text] of Object.entries(copies)) {
    const { stopAt } = anchorsOf(text);
    assert.notEqual(stopAt, -1, `anchor text for the stop sentence not found in ${name}`);
    const stopEnd = stopAt + STOP_SENTENCE.length;
    const doctored = text.slice(0, stopEnd) + ' Then redo the child in-session.' + text.slice(stopEnd);
    assert.deepEqual(misorderedCopies({ ...copies, [name]: doctored }), [name], `an unrelated sentence before the passage in only ${name} must turn exactly that copy red`);
  }
});

// #5280: a rendered-UI unit (review Step 6 / 6.5) outlives the wait bound more often than a lens: it
// gets artifact-directory progress windows and its late result is staged. The rule lives in its own
// _shared file (headroom-forced); the core section carries one exception sentence pointing at it.
const RENDERED_UI = path.join(PLUGIN, 'skills', '_shared', 'rendered-ui-units.md');
const RENDERED_UI_EXCEPTION = 'Exception: a rendered-UI unit (review Step 6/6.5) gets more windows while its artifact directory changes; stage its late result (`_shared/rendered-ui-units.md`).';
const RENDERED_UI_CONTRACT = [
  [/review\s+Step\s+6\s+\(visual-review\)\s+and\s+Step\s+6\.5\s+\(design-wrapper\s+review\)/, 'names review Step 6 and Step 6.5 as the rendered-UI units'],
  [/Steps?\s+3\.7\s+and\s+3\.8[^.]*?no\s+artifact\s+directory/, 'the 3.7/3.8 children have no artifact directory'],
  [/`\.claude-tweaks\/artifacts\/screenshots\/browse\/\{session\}\/`/, 'names the visual-review artifact directory'],
  [/`\.impeccable\/review\/`/, 'names the design-wrapper review artifact directory'],
  [/`ls\s+-lR\s+"\{artifact-dir\}"`\s+piped\s+to\s+`git\s+hash-object\s+--stdin`/, 'the read-only artifact-directory probe'],
  [/ceiling\s+of\s+3\s+windows\s+\(60\s+minutes\)/, 'the 3-window ceiling'],
  [/names\s+no\s+artifact\s+directory\s+counts\s+as\s+unchanged/, 'a unit naming no artifact directory counts as unchanged'],
  [/missing\s+directory\s+or\s+a\s+failed\s+probe\s+counts\s+as\s+no\s+change/, 'a missing directory or failed probe counts as no change'],
  [/Lenses,\s+single\s+reads\s+and\s+judges\s+are\s+not\s+rendered-UI\s+units/, 'lenses, single reads and judges are not rendered-UI units'],
  [/never\s+satisfies\s+the\s+rendered-UI\s+check\s+before\s+merge/, 'a self-judged unit never satisfies the rendered-UI check'],
  [/explicit\s+decline/, 'it surfaces as an explicit decline'],
  [/session-tmp-resolve\.js[\s\S]*?never\s+under\s+the\s+run\s+dir/, 'the findings file is a session temp path, never under the run dir'],
  [/stage-item\.js"\s+--run\s+"\{run-dir\}"\s+--id\s+visual-review-late-1\s+--allocate/, 'stages with the allocated visual-review-late- id'],
  [/staged\/visual-review-late-\{n\}\.md/, 'names the staged file'],
  [/--status\s+STAGED[\s\S]*?--reversibility\s+high\s+--text-file/, 'logs the staging decision'],
  [/late\s+rendered-UI\s+result\s+from\s+\{unit\}\s+staged\s+to\s+staged\/\{written-file\}\./, 'the decision log text'],
  [/`status`\s+is\s+anything\s+but\s+`active`[\s\S]{0,240}?`console\.json`\s+exists[\s\S]{0,240}?exits\s+3\s+\(archived\s+or\s+unanchored\)\s+or\s+with\s+any\s+other\s+non-zero\s+code,\s+write\s+nothing\s+under\s+the\s+run\s+dir[\s\S]{0,240}?name\s+the\s+findings\s+in\s+your\s+reply\s+instead/, 'a closed run, or any non-zero stage-item.js exit, stages nothing and names the findings in the reply'],
  [/never\s+changes\s+a\s+verdict\s+already\s+reached/, 'a late result never changes a verdict already reached'],
  [/`\{section\}`\s+is\s+`\/review`/, 'binds the log-decision {section}'],
  [/basename\s+of\s+the\s+first\s+path\s+stage-item\s+printed/, '{written-file} is the basename of the first path stage-item printed'],
  [/`\{text-file\}`\s+is\s+a\s+path\s+`bin\/session-tmp-resolve\.js`\s+prints/, 'binds the {text-file} location'],
  [/artifact\s+directory\s+in\s+its\s+prompt\s+as\s+an\s+absolute\s+path/, 'the artifact directory is named as an absolute path'],
  [/`LATE_FINDING:\s+\{severity\}\s+—\s+\{one-line\s+finding\}`/, 'a closed-run finding is one LATE_FINDING: {severity} — {one-line finding} line'],
  [/immediately\s+before\s+the\s+reply's\s+trailing\s+`STATUS:`\s+line/, 'the LATE_FINDING lines sit immediately before the trailing STATUS: line'],
  [/re-woken\s+agent\s+after\s+its\s+final\s+reply\s+repeats\s+the\s+whole\s+final\s+reply\s+with\s+those\s+lines\s+inserted\s+before\s+`STATUS:`/, 'a re-wake after a closed run repeats the reply with the lines inserted before STATUS:'],
  [/no\s+pipeline\s+run\s+directory,\s+or\s+no\s+`run-state\.json`\s+in\s+it,\s+treat\s+the\s+run\s+as\s+not\s+active/, 'no run dir or no run-state.json counts as not active'],
  [/downgrade\s+line\s+\(`decisions\.md`,\s+under\s+the\s+dispatching\s+skill's\s+section\)[\s\S]{0,120}?review\s+summary's\s+Visual\s+Review\s+or\s+Design\s+Quality\s+section/, 'the explicit decline lands in the downgrade line and the review summary'],
  [/`\{unit\}`\s+is\s+the\s+child\s+as\s+its\s+launch\s+site\s+named\s+it[^.]*?`\{unit-slug\}`\s+is\s+its\s+lowercase,\s+hyphen-joined\s+form/, 'binds {unit} and {unit-slug}'],
  [/every\s+character\s+outside\s+`a-z`,\s+`0-9`\s+and\s+`-`\s+replaced\s+by\s+`-`/, '{unit-slug} is restricted to a-z, 0-9 and - before it reaches a shell command'],
  [/non-zero\s+`log-decision\.js`\s+exit[\s\S]{0,120}?name\s+the\s+findings\s+in\s+your\s+reply/, 'a failed log-decision.js call also names the findings in the reply'],
];
const renderedUiMissing = missingFactsOf(RENDERED_UI_CONTRACT);

test('AC1.1 AC1.2 AC2.1 AC3.1 AC4.1 AC5.1 AC5.2: rendered-ui-units.md states the rendered-UI unit rule (#5280)', () => {
  assert.deepEqual(renderedUiMissing(readText(RENDERED_UI)), []);
});

test('AC1.1: each rendered-UI contract assertion goes red on its own (discrimination proof)', () => {
  assertEachPatternGoesRed(readText(RENDERED_UI), RENDERED_UI_CONTRACT, renderedUiMissing);
});

test('AC3.1: the contract stage-item id classifies to a mapped console section (#5280)', () => {
  const id = readText(RENDERED_UI).match(/--id\s+(\S+)/)[1];
  const { classifyStagedItem, SECTIONS } = require('../plugin/bin/lib/console/resolve');
  const mapped = classifyStagedItem(`${id}.md`, '');
  assert.equal(mapped.section, SECTIONS.PENDING);
  assert.notEqual(mapped.reason, 'unmapped-prefix');
  assert.equal(classifyStagedItem('rendered-late-1.md', '').reason, 'unmapped-prefix');
});

test('AC1.1: the core section carries the rendered-UI exception sentence once (#5280)', () => {
  const section = coreForegroundSection(readText(CORE)).replace(/\s+/g, ' ');
  assert.equal(section.split(RENDERED_UI_EXCEPTION).length - 1, 1);
});

const RENDERED_UI_EXCEPTION_FACTS = [
  [/Exception:\s+a\s+rendered-UI\s+unit\s+\(review\s+Step\s+6\/6\.5\)\s+gets\s+more\s+windows\s+while\s+its\s+artifact\s+directory\s+changes;/, 'names the rendered-UI unit exception and its extra windows'],
  [/stage\s+its\s+late\s+result\s+\(`_shared\/rendered-ui-units\.md`\)\./, 'stages the late result per _shared/rendered-ui-units.md'],
];
const missingRenderedUiException = missingFactsOf(RENDERED_UI_EXCEPTION_FACTS);

test('AC1.1 AC2.1: every copy carries the rendered-UI exception sentence (#5280)', () => {
  for (const [name, text] of Object.entries(primitiveCopies())) {
    assert.deepEqual(missingRenderedUiException(text), [], name);
  }
});

test('AC1.1: each exception assertion goes red when removed from any single copy (discrimination proof)', () => {
  for (const text of Object.values(primitiveCopies())) {
    assertEachPatternGoesRed(text, RENDERED_UI_EXCEPTION_FACTS, missingRenderedUiException);
  }
});

const SELF_JUDGE_THEN_EXCEPTION = 'Read-only units keep the first-bound self-judge. Exception: a rendered-UI unit (review Step 6/6.5)';
const exceptionMisplacedCopies = (copies) => Object.entries(copies)
  .filter(([, text]) => !text.replace(/\s+/g, ' ').includes(SELF_JUDGE_THEN_EXCEPTION))
  .map(([name]) => name);

test('AC1.1: the exception sentence directly follows the read-only self-judge sentence in every copy', () => {
  assert.deepEqual(exceptionMisplacedCopies(primitiveCopies()), []);
});

test('AC1.1: a copy with the exception sentence moved to its start goes red (discrimination proof)', () => {
  const copies = primitiveCopies();
  for (const [name, text] of Object.entries(copies)) {
    const flat = text.replace(/\s+/g, ' ');
    assert.ok(flat.includes(RENDERED_UI_EXCEPTION), `exception sentence not found in ${name}`);
    const doctored = RENDERED_UI_EXCEPTION + ' ' + flat.replace(' ' + RENDERED_UI_EXCEPTION, '');
    assert.deepEqual(exceptionMisplacedCopies({ ...copies, [name]: doctored }), [name], `moving the exception in only ${name} must turn exactly that copy red`);
  }
});

// #5604: the bounded-polling paragraph names wait-for.js for a pull request's checks, a workflow run and a
// local process, and keeps its cap, interval and logging rules for any other condition. Each pattern matches
// exactly once in that one paragraph, so its go-red proof removes the only occurrence.
function boundedPollingParagraph(core) {
  const found = coreForegroundSection(core).split(/\n\n/).filter((p) => p.startsWith('**Bounded polling for a long external wait.**'));
  assert.equal(found.length, 1, 'the Foreground Execution Discipline section must hold exactly one Bounded polling paragraph');
  return found[0];
}
const BOUNDED_POLLING = [
  [/wait-for\.js\s+ci\s+--pr/, 'a pull request wait is `wait-for.js ci --pr`'],
  [/wait-for\.js\s+ci\s+--run/, 'a workflow run wait is `wait-for.js ci --run`'],
  [/wait-for\.js\s+pid\b/, 'a local process wait is `wait-for.js pid`'],
  [/`--max-seconds\s+150`;\s+a\s+`ci`\s+call\s+may\s+run\s+20\s+s\s+past\s+it/, 'a ci call may run 20 s past --max-seconds'],
  [/:\s+0\s+means\s+read\s+the\s+result/, 'exit 0 means read the result'],
  [/3\s+with\s+`"bound":"call"`\s+means\s+call\s+again/, 'exit 3 with a call bound means call again'],
  [/3\s+with\s+`"bound":"deadline"`\s+means\s+the\s+bound\s+is\s+exhausted/, 'exit 3 with a deadline bound means the bound is exhausted'],
  [/on\s+exit\s+2\s+call\s+it\s+once\s+more,\s+which\s+joins\s+the\s+failed\s+call's\s+window,\s+and\s+a\s+second\s+exit\s+2\s+ends\s+the\s+wait\s+unresolved/, 'a first exit 2 is retried once and a second ends the wait unresolved'],
  [/the\s+cap,\s+interval\s+and\s+logging\s+rules\s+below\s+are\s+for\s+any\s+other\s+condition/, 'the cap, interval and logging rules are for any other condition'],
];
const missingBoundedPolling = missingFactsOf(BOUNDED_POLLING);

test('AC7.1: the bounded-polling paragraph names wait-for.js ci --pr, ci --run and pid (#5604)', () => {
  const paragraph = boundedPollingParagraph(readText(CORE));
  assert.deepEqual(missingBoundedPolling(paragraph), []);
  assertEachPatternGoesRed(paragraph, BOUNDED_POLLING, missingBoundedPolling);
});

// #5604: no skill file shows a wait as a backtick-quoted `sleep N` (the harness refuses a leading sleep).
// Every file under plugin/skills is read, whatever its extension.
function skillFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? skillFiles(full) : [[full, readText(full)]];
  });
}
const backtickSleepHits = (files) => files.filter(([, text]) => /`sleep \d/.test(text)).map(([file]) => file);
const sleep30Count = (text) => (text.match(/sleep 30/g) || []).length;
const PR_FIRST_MERGE = path.join(PLUGIN, 'skills', '_shared', 'pr-first-merge.md');

test('AC3.1 AC3.2: no file under plugin/skills puts a backtick directly before sleep and a digit (#5604)', () => {
  const files = skillFiles(path.join(PLUGIN, 'skills'));
  assert.ok(files.length > 100, `expected over 100 skill files, found ${files.length}`);
  assert.deepEqual(backtickSleepHits(files), []);
  const merge = files.find(([file]) => file === PR_FIRST_MERGE);
  assert.ok(merge, 'pr-first-merge.md is not among the swept files');
  assert.equal(sleep30Count(merge[1]), 2, 'the unmatched anchors (two bare sleep 30 lines in code blocks) are not both there, so the sweep proves nothing about them');
  const oneGone = merge[1].replace('sleep 30', 'true');
  assert.notEqual(oneGone, merge[1]);
  assert.equal(sleep30Count(oneGone), 1, 'dropping one bare sleep 30 must move the count off two');
});

test('AC3.3: the backtick-sleep sweep goes red on a fixture copy carrying such text (#5604)', () => {
  const files = skillFiles(path.join(PLUGIN, 'skills'));
  const doctored = files.map(([file, text]) => (file === CORE ? [file, `${text} \`sleep 20\` `] : [file, text]));
  assert.notDeepEqual(doctored, files, 'the core is not among the swept files');
  assert.deepEqual(backtickSleepHits(doctored), [CORE]);
});
