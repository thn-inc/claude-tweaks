// tests/review-ac-evidence-citation-prose.test.js — pins #3079's review-side
// citation rule: plugin/skills/review/code-mode-steps.md Step 1, check 2
// (Acceptance Criteria) reads the run's decisions.md for an `AC evidence` entry
// written by /claude-tweaks:build's AC-evidence persistence check and cites it
// instead of re-executing the scratch check, while keeping the entry
// "evidence, not proof" and leaving the standalone (unset $PIPELINE_RUN_DIR)
// path unchanged. Reads the live skill file. The check-2 line is located by its
// leading `2. **Acceptance Criteria**` and every assertion runs on that line
// alone. The negative control runs the same assertion function against the
// frozen pre-change line and expects it to throw.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TEXT = fs.readFileSync(
  path.join(__dirname, '..', 'plugin', 'skills', 'review', 'code-mode-steps.md'),
  'utf8',
);

const LINE_PREFIX = '2. **Acceptance Criteria**';
const UNSET_PHRASE = 'When `$PIPELINE_RUN_DIR` is unset (standalone review), this check is unchanged';
const PRE_CHANGE_LINE =
  "2. **Acceptance Criteria** — for each criterion, determine whether it's verifiable from the code and tests. Mark as `met`, `partially met`, or `not met`.";

function assertAcEvidenceCitation(line) {
  assert.ok(
    line.includes('Before marking a criterion `not met` for lack of code or test evidence'),
    'gates the not-met verdict on the evidence check',
  );
  assert.ok(line.includes('an `AC evidence` entry naming it'), 'reads an AC evidence entry naming the criterion');
  assert.ok(line.includes('decisions.md'), 'reads decisions.md');
  assert.ok(
    line.includes("cite it as the criterion's evidence instead of re-executing the check"),
    'cites the entry instead of re-running the check',
  );
  assert.ok(
    line.includes('its `evidence/` log is present and matches it'),
    'cites the entry only when its evidence/ log is present and matches it',
  );
  assert.ok(line.includes('AC-evidence persistence check'), 'names the build-side AC-evidence persistence check');
  assert.ok(line.includes('evidence, not proof'), 'keeps the entry evidence, not proof');
  assert.ok(line.includes(UNSET_PHRASE), 'keeps the standalone unset-$PIPELINE_RUN_DIR path unchanged');
  assert.ok(
    line.includes("determine whether it's verifiable from the code and tests"),
    'original sentence survives',
  );
}

const HITS = TEXT.split(/\r?\n/).filter((l) => l.startsWith(LINE_PREFIX));
const LIVE_LINE = HITS[0];

test('AC2.1 (#3079): check 2 reads decisions.md for an AC evidence entry and cites it rather than re-running', () => {
  assert.strictEqual(HITS.length, 1, 'expected exactly one check-2 Acceptance Criteria line');
  assertAcEvidenceCitation(LIVE_LINE);
});

test('AC2.2 (#3079): check 2 names the unset-$PIPELINE_RUN_DIR standalone case as unchanged', () => {
  assert.strictEqual(HITS.length, 1, 'expected exactly one check-2 Acceptance Criteria line');
  assert.ok(LIVE_LINE.includes(UNSET_PHRASE), 'names the standalone unset case as unchanged');
});

test('AC2.1 (#3079): negative control — the pre-change line fails the pin', () => {
  assert.throws(() => assertAcEvidenceCitation(PRE_CHANGE_LINE));
});

test('AC2.1 (#3079): negative control — rewording "evidence, not proof" fails the pin', () => {
  const mutated = LIVE_LINE.replace('evidence, not proof', 'proof');
  assert.notStrictEqual(mutated, LIVE_LINE, 'control must actually reword the clause');
  assert.throws(() => assertAcEvidenceCitation(mutated));
});

test('AC2.1 (#3079): negative control — rewording the "its evidence/ log is present and matches it" clause fails the pin', () => {
  const mutated = LIVE_LINE.replace('its `evidence/` log is present and matches it', 'it exists');
  assert.notStrictEqual(mutated, LIVE_LINE, 'control must actually reword the clause');
  assert.throws(() => assertAcEvidenceCitation(mutated));
});

// The second-call template carries the stamp-status guidance twice (an earlier mention and
// the CRITICAL paragraph's closing line), so the anchor is the closing line's own opening
// words, never the first `verify.js --stamp-status` hit.
const STAMP_LINE_PREFIX = 'A runner-written pass stamp matching HEAD (`verify.js --stamp-status`) is the raw artifact';
const TASK_PROMPT_LINES = fs
  .readFileSync(path.join(__dirname, '..', 'plugin', 'skills', 'dispatch', 'task-prompt.md'), 'utf8')
  .split(/\r?\n/);

function assertAcEvidenceDirectlyAfterStamp(lines) {
  const stampHits = lines.flatMap((l, i) => (l.startsWith(STAMP_LINE_PREFIX) ? [i] : []));
  assert.strictEqual(stampHits.length, 1, 'expected exactly one closing stamp-status line');
  const next = lines[stampHits[0] + 1] ?? '';
  assert.ok(
    next.includes('`AC evidence` entry') && next.includes('evidence/ log it cites'),
    'the AC evidence line sits directly after the closing stamp-status line',
  );
}

test('AC2.1 (#3079): the second-call dispatch template checks AC evidence entries against their evidence/ log, directly after the stamp line', () => {
  assertAcEvidenceDirectlyAfterStamp(TASK_PROMPT_LINES);
});

test('AC2.1 (#3079): negative control — an AC evidence line moved away from the stamp line fails the placement pin', () => {
  const stampIdx = TASK_PROMPT_LINES.findIndex((l) => l.startsWith(STAMP_LINE_PREFIX));
  const moved = TASK_PROMPT_LINES.slice();
  const [acLine] = moved.splice(stampIdx + 1, 1);
  moved.push(acLine);
  assert.notDeepStrictEqual(moved, TASK_PROMPT_LINES, 'control must actually move the line');
  assert.throws(() => assertAcEvidenceDirectlyAfterStamp(moved));
});
