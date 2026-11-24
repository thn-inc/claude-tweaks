'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { listMarkdownFiles } = require('./helpers/option-description');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (...p) => readText(path.join(SKILLS, ...p));

const PROHIBITION = /[Nn]ever delete a parent, the session scratchpad or temp root, or any path outside that exact SCRATCH: path\./;

// A dispatch template's SCRATCH: line: the line itself opens with `SCRATCH:`,
// after any blockquote markers, indentation, or an opening backtick.
const SCRATCH_LINE = /^[\s>]*`?SCRATCH:/;

function offenders(text) {
  return text.split('\n').filter((l) => SCRATCH_LINE.test(l) && !PROHIBITION.test(l));
}

function scratchLines(root) {
  const out = [];
  for (const file of listMarkdownFiles(root)) {
    readText(file).split('\n').forEach((line, i) => {
      if (SCRATCH_LINE.test(line)) out.push({ file: path.relative(root, file).split(path.sep).join('/'), line: i + 1, text: line });
    });
  }
  return out;
}

test('the contract Scratch rule names the never-delete scope (#4472)', () => {
  const t = read('_shared', 'subagent-output-contract.md');
  assert.match(t, /never a recursive delete of a parent, of the session scratchpad or temp root, or of any path not textually under the `SCRATCH:` path/);
});

test('lens dispatch tells each lens agent the never-delete prohibition beside its SCRATCH: line (#4472)', () => {
  assert.match(read('review', 'step3-lens-dispatch.md'), /Tell the agent: never delete a parent, the session scratchpad or temp root, or any path outside that exact SCRATCH: path\./);
});

test('every SCRATCH: dispatch line under plugin/skills carries the never-delete prohibition (#4472)', () => {
  const lines = scratchLines(SKILLS);
  // Floor: step3-debate-and-refutation.md (2), step3-tiebreak.md (2), step3-workflow-dispatch.md (1).
  assert.ok(lines.length >= 5, `expected at least 5 SCRATCH: dispatch lines, found ${lines.length}`);
  for (const f of ['review/step3-tiebreak.md', 'review/step3-workflow-dispatch.md', 'review/step3-debate-and-refutation.md']) {
    assert.ok(lines.some((l) => l.file === f), `the sweep must reach ${f}`);
  }
  const missing = lines.filter((l) => !PROHIBITION.test(l.text)).map((l) => `${l.file}:${l.line}`);
  assert.deepStrictEqual(missing, [], `SCRATCH: lines without the prohibition: ${missing.join(', ')}`);
});

test('go-red: the sweep flags a SCRATCH: line without the prohibition in every template shape (#4472)', () => {
  // Pre-change step3-tiebreak.md line 69, as frozen bytes.
  const tiebreakBefore = "SCRATCH: {ctx-dir}/agent-scratch/{agent-id} — any probe script or fixture you create to verify this finding goes there (never in the repository tree) and must be deleted before your status word (`_shared/subagent-output-contract.md`'s Scratch rule). If this path lies outside your own worktree.";
  // Pre-change step3-workflow-dispatch.md line 17 (backtick-opened).
  const workflowBefore = '`SCRATCH: make your own scratch directory — run mkdir -p {ctx-dir}/agent-scratch as one call, then mktemp -d {ctx-dir}/agent-scratch/{lens}-XXXXXX as another, and use the path it prints as your scratch path.`';
  // Blockquoted, indented shape (step3-debate-and-refutation.md's refutation template).
  const quotedBefore = '>    SCRATCH: {ctx-dir}/agent-scratch/{agent-id} — any probe script goes there.';
  assert.strictEqual(offenders(tiebreakBefore).length, 1);
  assert.strictEqual(offenders(workflowBefore).length, 1);
  assert.strictEqual(offenders(quotedBefore).length, 1);
  assert.strictEqual(offenders(`${tiebreakBefore} Never delete a parent, the session scratchpad or temp root, or any path outside that exact SCRATCH: path.`).length, 0);
  assert.strictEqual(offenders('Give each agent a `SCRATCH:` line in prose.').length, 0, 'prose mentioning SCRATCH: mid-line is not a template line');
});
