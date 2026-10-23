// tests/fetch-sub-issues-prose-conformance.test.js
//
// Conformance test for the batched sub-issue fetch's prose contract (bin/fetch-sub-issues.js,
// #1097's final-review fix wave): both consumers of the CLI —
// _shared/trust-table.md's native `work-links` branch and both scopes in
// _shared/github-pr-scan-acceptance.md that share its batched-probe-with-fallback shape —
// must actually cite the CLI, and each of their `Fallback` blocks must retain the older,
// verbatim per-parent `while read -r N` REST loop the batched probe falls back to on exit 4.
// Follows tests/record-queue-fetch-conformance.test.js's style: read the live corpus, assert
// on it, then prove the detector itself can go red (AC3's regression shape).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const SKILLS_DIR = path.join(__dirname, '..', 'plugin', 'skills');
const CLI_CITATION = 'bin/fetch-sub-issues.js';
const FALLBACK_LOOP_RE = /while read -r N\b/;

function read(rel) {
  return readText(path.join(SKILLS_DIR, rel));
}

// A "Fallback" label is either a markdown heading ("#### Fallback ...") or a bold inline
// label ("**Fallback** ...") sitting at the start of a line (allowing for a leading list
// marker). Returns the byte offset of the start of each label's line, in document order.
function findFallbackLabelOffsets(text) {
  const lines = text.split('\n');
  const offsets = [];
  let offset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,6}\s*Fallback\b/.test(trimmed) || /^\*\*Fallback\b/.test(trimmed)) {
      offsets.push(offset);
    }
    offset += line.length + 1; // +1 for the '\n' the split() consumed
  }
  return offsets;
}

// Count how many "Fallback"-labeled blocks (label through the next label, or EOF) still
// retain the verbatim `while read -r N` per-parent REST loop.
function countLabeledFallbackBlocksWithLoop(text) {
  const offsets = findFallbackLabelOffsets(text);
  let count = 0;
  for (let i = 0; i < offsets.length; i++) {
    const start = offsets[i];
    const end = i + 1 < offsets.length ? offsets[i + 1] : text.length;
    const block = text.slice(start, end);
    if (FALLBACK_LOOP_RE.test(block)) count++;
  }
  return count;
}

test('trust-table.md and github-pr-scan-acceptance.md both cite bin/fetch-sub-issues.js', () => {
  const trustTable = read('_shared/trust-table.md');
  const prScan = read('_shared/github-pr-scan-acceptance.md');
  assert.ok(trustTable.includes(CLI_CITATION), '_shared/trust-table.md must cite bin/fetch-sub-issues.js');
  assert.ok(prScan.includes(CLI_CITATION), '_shared/github-pr-scan-acceptance.md must cite bin/fetch-sub-issues.js');
});

test('trust-table.md has exactly one Fallback block retaining the while-read REST loop', () => {
  const text = read('_shared/trust-table.md');
  assert.strictEqual(
    countLabeledFallbackBlocksWithLoop(text),
    1,
    'expected exactly one Fallback-labeled block with the while-read -r N loop in _shared/trust-table.md'
  );
});

test('github-pr-scan-acceptance.md has exactly two Fallback blocks retaining the while-read REST loop', () => {
  const text = read('_shared/github-pr-scan-acceptance.md');
  assert.strictEqual(
    countLabeledFallbackBlocksWithLoop(text),
    2,
    'expected exactly two Fallback-labeled blocks with the while-read -r N loop in _shared/github-pr-scan-acceptance.md (acceptance-gap + parent-gate)'
  );
});

// Regression shape: prove the detector actually goes red when a Fallback block's REST loop
// is removed — not merely toothless because the label always happens to match.
test('countLabeledFallbackBlocksWithLoop goes red when the REST loop is stripped from a Fallback block (regression shape)', () => {
  const intact = [
    '#### Fallback (probe unavailable — older GHE)',
    '',
    '```bash',
    ': > /tmp/x-numbers.jsonl',
    'node -e "..." | while read -r N; do',
    '  gh api "repos/{owner}/{repo}/issues/$N/sub_issues" --jq \'.[].number\' >> /tmp/x-numbers.jsonl',
    'done',
    '```',
  ].join('\n');
  assert.strictEqual(countLabeledFallbackBlocksWithLoop(intact), 1, 'sanity: intact synthetic block should count as 1');

  const strippedOfLoop = [
    '#### Fallback (probe unavailable — older GHE)',
    '',
    '```bash',
    '# the while-read REST loop used to be here',
    'node "${CLAUDE_PLUGIN_ROOT}/bin/fetch-sub-issues.js" $(node -e "...")',
    '```',
  ].join('\n');
  assert.strictEqual(
    countLabeledFallbackBlocksWithLoop(strippedOfLoop),
    0,
    'detector failed to flag a Fallback block whose while-read -r N loop was removed'
  );
});

test('countLabeledFallbackBlocksWithLoop does not flag a block with no Fallback label at all', () => {
  const noLabel = [
    '### Some other section',
    '',
    '```bash',
    'node -e "..." | while read -r N; do',
    '  echo "$N"',
    'done',
    '```',
  ].join('\n');
  assert.strictEqual(countLabeledFallbackBlocksWithLoop(noLabel), 0, 'a while-read loop with no Fallback label must not be counted');
});
