'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readTsv } = require('../../../plugin/bin/lib/calibration/tsv-reader.js');
const { classifyDecisionLine, TERMINAL_DECISION_VALUES } = require('../../../plugin/bin/lib/calibration/decisions-classifier.js');
const { readEventsKinds } = require('../../../plugin/bin/lib/calibration/events-reader.js');
const { appendTelemetry } = require('../../../plugin/bin/lib/wrap-up/engine-record.js');

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'calib-')), name);
}

test('readTsv parses rows, counts malformed lines, and returns null for a missing file', () => {
  const p = tmpFile('outcomes.tsv');
  fs.writeFileSync(p, '2026-08-01\trun-a\trow1\tclosed\t0\tna\n2026-08-01\trun-a\trow2\tclosed\t2\tfindings\nnot-enough-columns\n');
  const result = readTsv(p);
  assert.strictEqual(result.rows.length, 2);
  assert.deepStrictEqual(result.rows[0], { date: '2026-08-01', runId: 'run-a', rowId: 'row1', gate: 'closed', count: '0', outcome: 'na' });
  assert.strictEqual(result.malformed, 1);
  assert.strictEqual(readTsv(tmpFile('missing.tsv')), null);
});

test('readTsv returns null (never throws) when the path exists but is unreadable as a file', () => {
  // A directory in place of a file triggers EISDIR on readFileSync — a
  // portable stand-in for the TOCTOU race (file deleted/permission-changed
  // between an existsSync check and the read) review finding #901 flagged.
  const dirAsFile = tmpFile('not-a-file.tsv');
  fs.mkdirSync(dirAsFile);
  assert.strictEqual(readTsv(dirAsFile), null);
});

test('readTsv output is coupled to the real writer (fails loudly on column drift)', () => {
  const p = tmpFile('coupling.tsv');
  appendTelemetry(p, { now: new Date('2026-08-01T00:00:00Z'), runId: 'run-x', rowId: 'skills', gate: 'closed', findings: [], result: 'na' });
  const result = readTsv(p);
  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.rows[0].runId, 'run-x');
  assert.strictEqual(result.rows[0].rowId, 'skills');
});

test('classifyDecisionLine recognizes every entry kind and the terminal-decision line', () => {
  assert.strictEqual(classifyDecisionLine('- AUTO 14:32:14 — Step 1.5: scope-creep. Reversibility: high (commit abc1234).').kind, 'AUTO');
  assert.strictEqual(classifyDecisionLine('- STAGED 14:41:15 — Step 3 Routing: 2 findings staged.').kind, 'STAGED');
  assert.strictEqual(classifyDecisionLine('- KEPT-PROMPT 14:41:22 — Step 3 Routing: 1 finding.').kind, 'KEPT-PROMPT');
  assert.strictEqual(classifyDecisionLine('- REFUSED 09:00:00 — Queue write blocked, no Defer-reason.').kind, 'REFUSED');
  assert.strictEqual(classifyDecisionLine('- SCANNED 09:00:00 — Step 4.5 scan complete, 0 findings.').kind, 'SCANNED');
  assert.strictEqual(classifyDecisionLine('- FAILED 09:00:00 — apply-refine-labels: priority write failed on #42: HTTP 500.').kind, 'FAILED');
  assert.strictEqual(classifyDecisionLine('this is not a decision line at all').kind, 'other');

  const terminal = classifyDecisionLine('- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.');
  assert.strictEqual(terminal.kind, 'AUTO');
  assert.strictEqual(terminal.terminalDecision, 'approve-all');
  assert.strictEqual(terminal.reversibility, 'n/a');

  for (const value of TERMINAL_DECISION_VALUES) {
    const line = `- AUTO 12:00:00 — Review Console: terminal decision ${value}. Reversibility: n/a.`;
    assert.strictEqual(classifyDecisionLine(line).terminalDecision, value, `must parse ${value}`);
  }
});

test('AC3.2: classifyDecisionLine reads the leading enum token of a noted Reversibility, never the note', () => {
  const cases = [
    ['high', 'high (commit abc1234)'],
    ['med', 'med (staged patch)'],
    ['low', 'low (divergence persists)'],
    ['n/a', 'n/a (a policy read, not a code mutation)'],
  ];
  for (const [token, value] of cases) {
    const line = `- AUTO 10:00:00 — Step 2.5: pre-flight branch-divergence-check. Reversibility: ${value}.`;
    assert.strictEqual(classifyDecisionLine(line).reversibility, token, value);
  }
});

test('classifyDecisionLine tolerates unrecognized shapes without throwing', () => {
  assert.doesNotThrow(() => classifyDecisionLine(''));
  assert.doesNotThrow(() => classifyDecisionLine('- FUTURE-STATUS 00:00:00 — a shape from a later plugin version'));
  assert.strictEqual(classifyDecisionLine('- FUTURE-STATUS 00:00:00 — a shape from a later plugin version').kind, 'other');
});

test('readEventsKinds counts typed events and fails open on malformed lines', () => {
  const p = tmpFile('events.jsonl');
  fs.writeFileSync(p, '{"type":"gate-denial"}\n{"type":"wd-deny"}\nnot json\n{"type":"gate-denial"}\n');
  const result = readEventsKinds(p);
  assert.deepStrictEqual(result.counts, { 'gate-denial': 2, 'wd-deny': 1 });
  assert.strictEqual(readEventsKinds(tmpFile('missing.jsonl')), null);
});

test('readEventsKinds returns null (never throws) when the path exists but is unreadable as a file', () => {
  const dirAsFile = tmpFile('not-a-file.jsonl');
  fs.mkdirSync(dirAsFile);
  assert.strictEqual(readEventsKinds(dirAsFile), null);
});

test('AC1.1: readEventsKinds drops test:true gate-denial/wd-guard-refusal, keeps the real one (#4186)', () => {
  const p = tmpFile('events.jsonl');
  fs.writeFileSync(p, [
    '{"type":"gate-denial","test":true}',
    '{"type":"gate-denial"}',
    '{"type":"gate-denial","test":false}',
    '{"type":"wd-guard-refusal","test":true}',
    '{"type":"commit","test":true}',
  ].join('\n') + '\n');
  assert.deepStrictEqual(readEventsKinds(p).counts, { 'gate-denial': 2, commit: 1 });
});
