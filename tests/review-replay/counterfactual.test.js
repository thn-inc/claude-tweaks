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
const CLEAN = { rowsSkipped: 0, extraDispatches: 0, duplicateIds: 0 };
const SHARES_3A = { total: 2, located: 2, byA: 2, byB: 1, byBoth: 1, singleReviewerShare: 0.75 };

// A copy of the fixture archive whose run-a decisions.md gains `decisionLine` and timing.json gains `timingItems`.
function archiveCopy({ decisionLine, timingItems = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-cf-arch-'));
  fs.cpSync(ARCHIVE, root, { recursive: true });
  const runA = path.join(root, 'run-a');
  if (decisionLine) fs.appendFileSync(path.join(runA, 'decisions.md'), `${decisionLine}\n`);
  const timingFile = path.join(runA, 'timing.json');
  const timing = JSON.parse(fs.readFileSync(timingFile, 'utf8'));
  timing.dispatches.items.push(...timingItems);
  fs.writeFileSync(timingFile, JSON.stringify(timing));
  return root;
}

async function counterfactual(transcripts = TRANSCRIPTS, extra = [], runs = ARCHIVE) {
  const deps = makeDeps();
  const code = await run({ argv: ['counterfactual', '--runs', runs, '--transcripts', transcripts, ...extra], deps });
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
  assert.equal(code, 3, 'one transcript is unreadable, which is not a clean result');
  assert.equal(out.runs, 1);
  assert.equal(out.lensPairs, 2);
  // Confirmed in lens 3a: src/alpha.js:10 and src/pair.js:5. A raised alpha (12) and pair (5); B raised pair (9, four
  // lines away) but alpha only six lines away and beta.js at alpha's line number on the wrong path.
  assert.deepEqual(out.confirmed, { total: 2, located: 2, byA: 2, byB: 1, byBoth: 1, singleReviewerShare: 0.75 });
});

test('AC6.2: a reviewer transcript with no findings table counts as unreadable, not zero findings, and the unreadable share is reported', async () => {
  const { out } = await counterfactual();
  assert.deepEqual(out.transcripts, { total: 4, unreadable: 1, unreadableShare: 0.25, ...CLEAN });
  // The 3b pair has an unreadable side: its refuted finding (reviewer A raised it) is left out of the shares, not scored as a miss by B.
  assert.deepEqual(out.refuted, { total: 0, byA: 0, byB: 0 });
  assert.equal(parseFindingsTable('I read the diff and ran out of turns.'), null);
});

test('a No findings reply is a readable empty table', async () => {
  assert.deepEqual(parseFindingsTable('No findings.'), []);
  assert.deepEqual(parseFindingsTable('Reviewed everything.\n\nNo findings'), []);
  const root = withReplyB('No findings.');
  try {
    // run-b holds a lens with one reviewer (counted as unpaired, below), so this one is read alone.
    const { code, out } = await counterfactual(root, ['--select', 'run-a']);
    assert.equal(code, 0, 'every transcript is readable');
    assert.deepEqual(out.transcripts, { total: 4, unreadable: 0, unreadableShare: 0, ...CLEAN });
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
    const { code, out } = await counterfactual(empty);
    assert.equal(code, 3, 'every transcript unreadable is not a clean result');
    assert.deepEqual(out.transcripts, { total: 4, unreadable: 4, unreadableShare: 1, ...CLEAN });
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
  assert.equal(none.code, 3, 'a selected run with no lens pair measures nothing, which is not a clean result');
  assert.equal(none.out.runs, 0);
  assert.equal(none.out.lensPairs, 0);
});

test('a --runs root that holds no run exits 1 instead of reporting an empty measurement', async () => {
  const missing = path.join(os.tmpdir(), 'rr-cf-no-such-root');
  const { code, deps } = await counterfactual(TRANSCRIPTS, [], missing);
  assert.equal(code, 1);
  assert.match(deps.errs.join('\n'), /ENOENT|no such file/i);
});

test('a lens with one reviewer dispatched is counted as unpaired and is not a clean result', async () => {
  const archive = archiveCopy({ timingItems: [{ agentId: '3c-a', description: 'Review lens 3c errors (A)', wallClockMs: 1, tokens: {} }] });
  try {
    const alone = await counterfactual(TRANSCRIPTS, ['--select', 'run-b']);
    assert.equal(alone.out.unpairedLenses, 1, 'run-b dispatched lens 3a to reviewer A only');
    assert.equal(alone.code, 3);
    const { code, out } = await counterfactual(TRANSCRIPTS, ['--select', 'run-a'], archive);
    assert.equal(code, 3);
    assert.equal(out.unpairedLenses, 1, 'the added 3c reviewer has no partner');
    assert.equal(out.lensPairs, 2, 'the paired lenses are still measured');
  } finally {
    fs.rmSync(archive, { recursive: true, force: true });
  }
});

test('prose that mentions "no findings" mid-sentence is unreadable, not an empty table', async () => {
  assert.equal(parseFindingsTable('I looked and there were no findings I could stand behind, so I stopped.'), null);
  assert.deepEqual(parseFindingsTable('**No findings**'), []);
  const root = withReplyB('I ran out of turns; there are no findings to report yet.');
  try {
    const { out } = await counterfactual(root);
    assert.equal(out.transcripts.unreadable, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a line that starts with "No findings" but goes on is not an empty table', () => {
  assert.equal(parseFindingsTable('No findings were possible: the transcript ended before the table.'), null);
  assert.equal(parseFindingsTable('No findings yet; still reading.'), null);
  assert.deepEqual(parseFindingsTable('_No findings_.'), []);
  assert.deepEqual(parseFindingsTable('Done.\r\n\r\n**No findings.**\r\n'), []);
});

test('table rows that cannot be read are counted in transcripts.rowsSkipped, not dropped silently', async () => {
  const root = withReplyB('| low | src/beta.js:22 | kept |\n| low | src/beta.js:23 | no trailing pipe\n| low | src/beta.js | no line number |');
  try {
    const { out } = await counterfactual(root);
    assert.equal(out.transcripts.unreadable, 0);
    assert.equal(out.transcripts.rowsSkipped, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the first dispatch per lens and side is kept; later ones and duplicate transcript ids are counted', async () => {
  const item = (agentId, desc) => ({ agentId, description: desc, wallClockMs: 1, tokens: { output: 1, cacheRead: 1, cacheCreate: 1 } });
  const archive = archiveCopy({ timingItems: [item('3a-a-rerun', 'Review lens 3a convention (A)')] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-cf-dup-'));
  fs.cpSync(TRANSCRIPTS, root, { recursive: true });
  // A same-id file in a later directory must not replace the first, and the re-review has no table of its own.
  fs.mkdirSync(path.join(root, 'proj2', 'sess', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'proj2', 'sess', 'subagents', 'agent-3a-a.jsonl'), `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'no table' }] } })}\n`);
  try {
    const { out } = await counterfactual(root, [], archive);
    assert.deepEqual(out.confirmed, SHARES_3A);
    assert.equal(out.transcripts.total, 4);
    assert.equal(out.transcripts.extraDispatches, 1);
    assert.equal(out.transcripts.duplicateIds, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(archive, { recursive: true, force: true });
  }
});

test('a confirmed finding in a pair with an unreadable side is left out of located and the shares', async () => {
  const archive = archiveCopy({ decisionLine: '- AUTO 10:00:08 — Reproduction: lens "3b" finding src/beta.js:22 reproduced. Confirmed. Reversibility: high.' });
  try {
    const unreadable = await counterfactual(TRANSCRIPTS, [], archive);
    assert.equal(unreadable.out.transcripts.unreadable, 1);
    assert.deepEqual(unreadable.out.confirmed, SHARES_3A);
    const root = withReplyB('No findings.');
    try {
      const readable = await counterfactual(root, [], archive);
      assert.deepEqual(readable.out.confirmed, { total: 3, located: 3, byA: 3, byB: 1, byBoth: 1, singleReviewerShare: 2 / 3 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(archive, { recursive: true, force: true });
  }
});
