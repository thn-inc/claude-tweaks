'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', 'execution-and-verification.md');

function section() {
  const content = fs.readFileSync(FILE, 'utf8');
  const start = content.indexOf('### Verify execution');
  assert.notStrictEqual(start, -1, 'Verify execution section header not found');
  const rest = content.slice(start);
  const nextHeader = rest.slice(1).search(/\n#{1,3} /);
  return nextHeader === -1 ? rest : rest.slice(0, nextHeader + 1);
}

test('Verify execution section has no imperative check commands', () => {
  const sec = section();
  assert.doesNotMatch(sec, /git log --grep/);
  assert.doesNotMatch(sec, /gh issue view/);
  assert.doesNotMatch(sec, /ls docs\//);
});

test('Verify execution section carries the four-part shape: expectations write, verb invocation, verbatim-table rule, exit-3 BLOCKED rule', () => {
  const sec = section();
  assert.match(sec, /verify-expectations\.json/, 'must instruct writing the expectations file');
  assert.match(sec, /wrap-up-engine\.js verify/, 'must instruct invoking the verb');
  assert.match(sec, /verbatim/i, 'must instruct inserting the table verbatim');
  assert.match(sec, /BLOCKED/, 'must instruct the exit-3 BLOCKED rule');
  assert.match(sec, /exit(s|\s)?\s*3|exit code 3/i, 'must name exit code 3 specifically, not just "non-zero"');
});

test('Verify execution section tells the reader to pass --run-dir the original pre-archive path (#3222)', () => {
  const sec = section();
  assert.match(sec, /`--run-dir` takes the run's original \(pre-archive\) `\$PIPELINE_RUN_DIR` path/, 'must state the pre-archive --run-dir requirement');
  assert.match(sec, /`run-dir-archived` report `original path still present`/, 'must name the failure an archive path outside the archive root trips');
});

test('the shape pin rejects a paraphrased hand-run instruction (negative control)', () => {
  // Same shape assertions the positive test above requires, run against a
  // hypothetical paraphrase that avoids the banned substrings but still
  // hand-runs a check -- proves substring absence alone would not catch a
  // regression back to hand-run prose.
  const paraphrase = 'Confirm via `git --no-pager log --grep="Fixes #{n}"` that the commit landed.';
  assert.doesNotMatch(paraphrase, /wrap-up-engine\.js verify/, 'the paraphrase must lack the verb invocation (proves it would slip past that one substring check alone)');

  // The real, live-file control: the section must contain no backticked
  // git/gh invocation other than the verb call itself.
  const sec = section();
  const backticked = sec.match(/`[^`]*`/g) || [];
  assert.ok(
    backticked.some((c) => c.includes('wrap-up-engine.js verify')),
    'the verb invocation itself must appear backticked in the section -- proves the extraction actually found command spans, not that it found nothing'
  );
  const otherCommands = backticked.filter((c) => /\bgit\s|\bgh\s/.test(c) && !c.includes('wrap-up-engine.js verify'));
  assert.deepStrictEqual(otherCommands, [], `section must not name any git/gh invocation other than the verb: ${otherCommands.join(', ')}`);
});
