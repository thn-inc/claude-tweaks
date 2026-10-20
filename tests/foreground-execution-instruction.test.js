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
// red (parse-signal-discipline).
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
    if (start === -1) { start = i + 1; } else { blocks.push(lines.slice(start, i).join('\n')); start = -1; }
  }
  assert.equal(start, -1, 'unbalanced ``` fences — the last fenced block is unclosed');
  return blocks;
}

test('task-prompt.md: both fenced Task-prompt templates carry the foreground-execution instruction', () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  const blocks = fencedBlocks(text);
  assert.equal(blocks.length, 2, `expected exactly two fenced Task-prompt blocks, found ${blocks.length}`);

  const [firstCall, secondCall] = blocks;
  for (const [label, block] of [['first call (build,test)', firstCall], ['second call (review,polish,wrap-up)', secondCall]]) {
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

  const blocks = fencedBlocks(kept.join('\n\n'));
  assert.equal(blocks.length, 2);
  for (const block of blocks) {
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

// Each `\s+` absorbs the hard line wrapping, as in REQUIRED above.
const KEEP_ALIVE = [
  [/always\s+launches\s+async/i, 'a nested Agent call always launches async'],
  [/keep[s]?\s+(?:its|your|the)\s+(?:own\s+)?turn\s+alive/i, 'the dispatcher keeps its own turn alive'],
  [/never\s+end[s]?\s+(?:its|your|the)\s+turn\s+with\s+(?:a|one)\s+child\s+outstanding/i, 'the dispatcher never ends its turn with a child outstanding'],
  [/no\s+`Agent`\/`Task`\s+tool/i, 'the fallback covers the no-Agent/Task-tool case'],
  [/`unconfirmed`/, 'findings from a self-judged unit are marked unconfirmed'],
  [/ignored/i, 'a late child result is ignored'],
];

// Content predicates: each live assertion and its doctored-text proof call the same function.
const missingKeepAlive = (section) => KEEP_ALIVE.filter(([pattern]) => !pattern.test(section)).map(([, fact]) => fact);
const foldsNoTaskParagraph = (core) => !/\*\*No `Task`\/Agent tool available\.\*\*/.test(core);
const dropsYieldRule = (contract) => !/must\s+yield\s+control\s+across\s+several\s+of\s+its\s+own\s+turns/.test(contract);
const keepsInterimMarker = (contract) => /INTERIM_STATUS/.test(contract);

test('subagent-dispatch-core.md states the nested-dispatch keep-alive rule and its fallback (#3078)', () => {
  const core = fs.readFileSync(CORE, 'utf8');
  assert.deepEqual(missingKeepAlive(coreForegroundSection(core)), [], 'Foreground Execution Discipline must state every keep-alive fact (#3078)');
  assert.ok(foldsNoTaskParagraph(core), 'the standalone No-Task paragraph must be folded into the new fallback clause (#3078)');
});

test('subagent-output-contract.md no longer tells a nested dispatcher to yield across turns (#3078)', () => {
  const contract = fs.readFileSync(OUTPUT_CONTRACT, 'utf8');
  assert.ok(dropsYieldRule(contract), 'the output contract still instructs nested dispatchers to yield across turns (#3078)');
  assert.ok(keepsInterimMarker(contract), 'the output contract lost its INTERIM_STATUS marker (#3078)');
});

test('each keep-alive assertion can actually go red on its own (discrimination proof)', () => {
  const section = coreForegroundSection(fs.readFileSync(CORE, 'utf8'));
  for (const [pattern, fact] of KEEP_ALIVE) {
    const doctored = section.replace(pattern, '');
    assert.notEqual(doctored, section, `anchor text for "${fact}" not found — test cannot discriminate`);
    assert.deepEqual(missingKeepAlive(doctored), [fact], `removing only "${fact}" must turn exactly that assertion red`);
  }
});

test('the folded-paragraph, yield-rule and interim-marker assertions can actually go red (discrimination proof)', () => {
  const core = fs.readFileSync(CORE, 'utf8');
  const reinsertedHeading = '\n\n**No `Task`/Agent tool available.** Some environments expose no `Task`/Agent dispatch tool at all.\n';
  assert.equal(foldsNoTaskParagraph(core + reinsertedHeading), false, 'the re-inserted No-Task heading must turn the fold assertion red');

  const contract = fs.readFileSync(OUTPUT_CONTRACT, 'utf8');
  const nestedClause = /keeps its turn alive until every child reports \(`_shared\/subagent-dispatch-core\.md`'s Foreground Execution Discipline\)\./;
  assert.match(contract, nestedClause, 'anchor text for the nested-dispatcher clause not found');
  const yieldDoctored = contract.replace(nestedClause, 'must yield control across several of its own turns before its real final reply.');
  assert.equal(dropsYieldRule(yieldDoctored), false, 'the old yield wording must turn the no-yield assertion red');

  assert.ok(keepsInterimMarker(contract), 'anchor text INTERIM_STATUS not found in the contract');
  assert.equal(keepsInterimMarker(contract.split('INTERIM_STATUS').join('')), false, 'removing INTERIM_STATUS must turn the marker assertion red');
});
