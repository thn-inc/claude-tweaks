'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, parseArgs } = require('../../tools/review-replay');
const { parseFindingsTable } = require('../../tools/review-replay/counterfactual');
const { FIXTURES, ARCHIVE, makeDeps } = require('./helpers');

const TRANSCRIPTS = path.join(FIXTURES, 'transcripts');
const B_FILE = path.join('proj', 'sess', 'subagents', 'agent-3b-b.jsonl');

async function counterfactual(transcripts = TRANSCRIPTS, extra = []) {
  const deps = makeDeps();
  const code = await run({ argv: ['counterfactual', '--runs', ARCHIVE, '--transcripts', transcripts, ...extra], deps });
  return { code, deps, out: deps.logs.length ? JSON.parse(deps.logs.join('\n')) : null };
}

// A copy of the fixture transcripts with reviewer 3b-B's final reply replaced by `text`.
function withReplyB(...texts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-cf-'));
  fs.cpSync(TRANSCRIPTS, root, { recursive: true });
  const lines = texts.map((text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }));
  fs.writeFileSync(path.join(root, B_FILE), `${lines.join('\n')}\n`);
  return root;
}

test('AC6.1: counterfactual over two paired reviewer transcripts reports the single-reviewer share', async () => {
  const { code, out } = await counterfactual();
  assert.equal(code, 0);
  assert.equal(out.runs, 1);
  assert.equal(out.lensPairs, 2);
  // Confirmed in lens 3a: src/alpha.js:10 and src/pair.js:5. A raised alpha (12) and pair (5); B raised pair (9, four
  // lines away) but alpha only six lines away and beta.js at alpha's line number on the wrong path.
  assert.deepEqual(out.confirmed, { total: 2, located: 2, byA: 2, byB: 1, byBoth: 1, singleReviewerShare: 0.75 });
});

test('AC6.2: a reviewer transcript with no findings table counts as unreadable, not zero findings, and the unreadable share is reported', async () => {
  const { out } = await counterfactual();
  assert.deepEqual(out.transcripts, { total: 4, unreadable: 1, unreadableShare: 0.25 });
  // The 3b pair has an unreadable side: its refuted finding (reviewer A raised it) is left out of the shares, not scored as a miss by B.
  assert.deepEqual(out.refuted, { total: 0, byA: 0, byB: 0 });
  assert.equal(parseFindingsTable('I read the diff and ran out of turns.'), null);
});

test('a No findings reply is a readable empty table', async () => {
  assert.deepEqual(parseFindingsTable('No findings.'), []);
  assert.deepEqual(parseFindingsTable('Reviewed everything.\n\nNo findings'), []);
  const root = withReplyB('No findings.');
  try {
    const { out } = await counterfactual(root);
    assert.deepEqual(out.transcripts, { total: 4, unreadable: 0, unreadableShare: 0 });
    // Now the 3b pair is readable: refuted beta.js:20 was raised by A (line 22) and not by B.
    assert.deepEqual(out.refuted, { total: 1, byA: 1, byB: 0 });
    assert.deepEqual(out.confirmed, { total: 2, located: 2, byA: 2, byB: 1, byBoth: 1, singleReviewerShare: 0.75 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('parseFindingsTable reads sev, path, line and text, strips markdown and skips header and separator rows', () => {
  const rows = parseFindingsTable('| Severity | Location | Finding |\n|---|---|---|\n| **High** | `src/a.js:12` | text one |\r\n| low | b.js:3:7 | text two |\n| bogus | c.js:1 | not a severity |');
  assert.deepEqual(rows, [
    { sev: 'high', path: 'src/a.js', line: 12, text: 'text one' },
    { sev: 'low', path: 'b.js', line: 3, text: 'text two' },
  ]);
  assert.equal(parseFindingsTable('| bogus | c.js:1 | not a severity |'), null);
});

test('a missing transcript file is unreadable, and a pair with an unreadable side never counts toward the shares', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-cf-empty-'));
  try {
    const { out } = await counterfactual(empty);
    assert.deepEqual(out.transcripts, { total: 4, unreadable: 4, unreadableShare: 1 });
    assert.deepEqual(out.confirmed, { total: 0, located: 0, byA: 0, byB: 0, byBoth: 0, singleReviewerShare: null });
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('the last assistant text decides: an earlier table does not rescue a final reply with none', async () => {
  const root = withReplyB('| low | src/beta.js:21 | earlier draft |', 'Final answer without a table.');
  try {
    const { out } = await counterfactual(root);
    assert.equal(out.transcripts.unreadable, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('counterfactual needs --transcripts, rejects an unknown run name and honours --select', async () => {
  assert.match(parseArgs(['counterfactual', '--runs', 'x']).error, /--transcripts/);
  assert.match(parseArgs(['counterfactual', '--transcripts', 'x']).error, /--runs/);
  assert.match(parseArgs(['counterfactual', '--runs', 'x', '--transcripts', 'y', '--out', 'z']).error, /unknown argument/);
  const bad = await counterfactual(TRANSCRIPTS, ['--select', 'run-nope']);
  assert.equal(bad.code, 2);
  assert.match(bad.deps.errs.join('\n'), /run-nope/);
  const none = await counterfactual(TRANSCRIPTS, ['--select', 'run-b']);
  assert.equal(none.code, 0);
  assert.equal(none.out.runs, 0);
  assert.equal(none.out.lensPairs, 0);
});
