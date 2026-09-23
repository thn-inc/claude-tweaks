// tests/dispatch-rederive-from-artifacts-conformance.test.js — pins #2366: the first
// (build,test) Task-call template in dispatch/task-prompt.md had no instruction requiring its
// own DONE/build-test-ok claim to be checked against an actual artifact before being reported,
// unlike the second (review,polish,wrap-up) call's explicit "re-derive from raw artifacts"
// instruction. A first-call report this session claimed "5/5 clean under load" with no
// supporting artifact in the run directory, and nothing in that call's own template would have
// caught it. This suite pins a CRITICAL re-derive-from-artifacts instruction in BOTH fenced
// templates, and proves the check can actually go red (parse-signal-discipline).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TASK_PROMPT = path.join(__dirname, '..', 'plugin', 'skills', 'dispatch', 'task-prompt.md');

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

// Every fenced block must carry a CRITICAL paragraph naming an artifact to check the reported
// claim against, before its own OUTPUT FORMAT (required) section.
const CRITICAL_LINE = /CRITICAL:[\s\S]*?(?:re-derive|artifact\s+you\s+just\s+produced)/i;
const ARTIFACT_REF = /report\.json|test-output (?:log|artifact)/i;

test('task-prompt.md: both fenced Task-prompt templates carry a CRITICAL re-derive-from-artifacts instruction before OUTPUT FORMAT', () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  const blocks = fencedBlocks(text);
  assert.equal(blocks.length, 2, `expected exactly two fenced Task-prompt blocks, found ${blocks.length}`);

  const [firstCall, secondCall] = blocks;
  for (const [label, block] of [['first call (build,test)', firstCall], ['second call (review,polish,wrap-up)', secondCall]]) {
    assert.match(block, CRITICAL_LINE, `${label} template must carry a CRITICAL re-derive-from-artifacts instruction (#2366)`);
    assert.match(block, ARTIFACT_REF, `${label} template must reference a concrete artifact (test-output log / report.json) (#2366)`);

    const outputIdx = block.indexOf('OUTPUT FORMAT (required)');
    assert.notEqual(outputIdx, -1, `${label} template must contain an OUTPUT FORMAT (required) section`);
    const criticalIdx = block.search(CRITICAL_LINE);
    assert.ok(criticalIdx !== -1 && criticalIdx < outputIdx, `${label} template's CRITICAL instruction must appear before OUTPUT FORMAT (required)`);
  }
});

test("first call's CRITICAL instruction is framed as self-verification, not a verbatim copy of the second call's prior-claim-distrust wording (#2366 AC)", () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  const [firstCall, secondCall] = fencedBlocks(text);

  // The second call's instruction is phrased around distrusting a PRIOR call's claim ("never
  // trust a prior claim... including claims written to decisions.md"). The first call has no
  // prior call in this pipeline run, so it must not reuse that framing verbatim.
  assert.match(secondCall, /never (?:from a )?prior claim/i, "second call's instruction should still distrust a prior claim (sanity check on the fixture)");
  assert.doesNotMatch(firstCall, /never (?:from a )?prior claim/i, "first call must not copy the second call's prior-claim-distrust framing verbatim — it is the producer, not a second call checking someone else's work");

  // The first call's instruction should instead name itself as the producer confirming its own
  // freshly produced claim.
  assert.match(firstCall, /own claim against the artifact\s+you just produced/i, "first call's CRITICAL instruction must frame this as confirming its own freshly produced claim");
});

test('the CRITICAL instruction predicate can actually go red (discrimination proof)', () => {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  const paragraphs = text.split(/\r?\n\r?\n/);
  const kept = paragraphs.filter((p) => !CRITICAL_LINE.test(p));
  assert.equal(paragraphs.length - kept.length, 2, 'expected to doctor out exactly the two CRITICAL paragraphs — anchor text not found');

  const blocks = fencedBlocks(kept.join('\n\n'));
  assert.equal(blocks.length, 2);
  for (const block of blocks) {
    assert.doesNotMatch(block, CRITICAL_LINE, 'doctored block unexpectedly still matches — test cannot discriminate');
  }
});
