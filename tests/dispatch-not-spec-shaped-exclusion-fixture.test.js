// tests/dispatch-not-spec-shaped-exclusion-fixture.test.js — #2829.
//
// Extract-and-run (skill-prose-conformance-tests): runs the *actual* not-spec-shaped exclusion
// snippet queue-pull-script.md ships, not a hand-reimplementation of shapeGate's rules. Follows
// tests/dispatch-named-target-exclusion-fixture.test.js's pattern for the sibling `target-missing`
// pass — anchored extraction, a scratch dispatch-groups.json/dispatch-exclusions.json pair, one
// `bash -c` invocation. No git fixture needed: shapeGate is pure body-text analysis, no `git
// cat-file` call in this snippet.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const QUEUE_PULL_SCRIPT = fs.readFileSync(
  path.join(ROOT, 'plugin', 'skills', 'dispatch', 'queue-pull-script.md'), 'utf8',
);

// Structurally anchored, not a prose sentence: the start anchor is the `if node ...` line
// unique to this pass (named by its own $DISPATCH_SHAPE_GATE_ERR var), the end anchor is this
// block's own closing `fi`.
const START_ANCHOR = 'if node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_EXCLUSIONS" > "${DISPATCH_GROUPS}.tmp" 2>"$DISPATCH_SHAPE_GATE_ERR" <<NODE_EVAL_EOF';
const END_ANCHOR_FROM = '  echo "Warning: not-spec-shaped pass skipped';

function extractExclusionSnippet() {
  const startIdx = QUEUE_PULL_SCRIPT.indexOf(START_ANCHOR);
  assert.notStrictEqual(startIdx, -1, 'extraction start anchor not found in queue-pull-script.md -- extraction is out of sync with the live file');
  const fromEnd = QUEUE_PULL_SCRIPT.indexOf(END_ANCHOR_FROM, startIdx);
  assert.notStrictEqual(fromEnd, -1, 'extraction end anchor not found in queue-pull-script.md -- extraction is out of sync with the live file');
  const fiIdx = QUEUE_PULL_SCRIPT.indexOf('\nfi', fromEnd);
  assert.notStrictEqual(fiIdx, -1, 'closing fi not found after end anchor -- extraction is out of sync with the live file');
  return QUEUE_PULL_SCRIPT.slice(startIdx, fiIdx + '\nfi'.length);
}

function specShapedBody({
  currentState = 'Some current state.',
  deliverables = 'Some deliverables.',
  acceptanceCriteria = '- [ ] Some criterion.',
  releaseNote = 'Some release note.',
  extra = '',
} = {}) {
  return [
    '## Current State', '', currentState, '',
    '## Deliverables', '', deliverables, '',
    '## Acceptance Criteria', '', acceptanceCriteria, '',
    '## Release Note', '', releaseNote,
    extra,
  ].join('\n');
}

function runSnippet(groups) {
  const snippet = extractExclusionSnippet();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-not-spec-shaped-fixture-'));
  const dispatchGroups = path.join(scratch, 'dispatch-groups.json');
  const exclusions = path.join(scratch, 'dispatch-exclusions.json');
  fs.writeFileSync(dispatchGroups, JSON.stringify(groups));

  execFileSync('bash', ['-c', snippet], {
    cwd: scratch,
    timeout: 10000,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: path.join(ROOT, 'plugin'),
      DISPATCH_GROUPS: dispatchGroups,
      DISPATCH_EXCLUSIONS: exclusions,
      DISPATCH_SHAPE_GATE_ERR: path.join(scratch, 'dispatch-shape-gate.err'),
    },
  });

  return {
    finalGroups: JSON.parse(fs.readFileSync(dispatchGroups, 'utf8')),
    exclusions: fs.existsSync(exclusions) ? JSON.parse(fs.readFileSync(exclusions, 'utf8')) : [],
  };
}

test('queue-pull-script.md\'s not-spec-shaped pass excludes exactly the non-conforming candidate, missing Release Note only (#2829 AC1)', () => {
  const conforming = { number: 101, body: specShapedBody() };
  const missingReleaseNote = {
    number: 102,
    body: [
      '## Current State', '', 'State.', '',
      '## Deliverables', '', 'Stuff.', '',
      '## Acceptance Criteria', '', '- [ ] Thing.',
    ].join('\n'),
  };

  const { finalGroups, exclusions } = runSnippet([[conforming], [missingReleaseNote]]);

  const notSpecShaped = exclusions.filter((e) => e.reason === 'not-spec-shaped');
  assert.strictEqual(notSpecShaped.length, 1, 'exactly one not-spec-shaped exclusion');
  assert.strictEqual(notSpecShaped[0].records[0], 102);
  assert.deepStrictEqual(notSpecShaped[0].detail.missing, ['Release Note']);

  const surviving = finalGroups.flat().map((r) => r.number);
  assert.deepStrictEqual(surviving, [101], 'dispatch-groups.json contains only the conforming candidate');
});

test('queue-pull-script.md\'s not-spec-shaped pass flags an unresolved placeholder in authored prose, exempts the same marker inside Original request / a code span (#2829 AC2)', () => {
  const placeholderInAuthoredProse = {
    number: 201,
    body: specShapedBody({ deliverables: 'TODO: figure this out.' }),
  };
  const placeholderExempt = {
    number: 202,
    body: `${specShapedBody({ deliverables: 'Use the ' + '`TODO`' + ' marker as a literal example in code.' })}\n\n## Original request\n\nThe user wrote TBD in their original ask.`,
  };

  const { finalGroups, exclusions } = runSnippet([[placeholderInAuthoredProse], [placeholderExempt]]);

  const notSpecShaped = exclusions.filter((e) => e.reason === 'not-spec-shaped');
  assert.strictEqual(notSpecShaped.length, 1);
  assert.strictEqual(notSpecShaped[0].records[0], 201);
  assert.ok(notSpecShaped[0].detail.missing.includes('unresolved-placeholder'));

  const surviving = finalGroups.flat().map((r) => r.number);
  assert.deepStrictEqual(surviving, [202], 'the code-span/Original-request marker is exempt, so #202 survives');
});

test('queue-pull-script.md\'s not-spec-shaped pass keeps a conforming group member and drops only the non-conforming one; an all-non-conforming group disappears (#2829 AC3)', () => {
  const conforming = { number: 301, body: specShapedBody() };
  const nonConforming = { number: 302, body: 'Just a sentence, no sections at all.' };
  const bothNonConforming = [
    { number: 401, body: 'Nothing here.' },
    { number: 402, body: 'Also nothing here.' },
  ];

  const { finalGroups, exclusions } = runSnippet([[conforming, nonConforming], bothNonConforming]);

  const excludedNumbers = exclusions
    .filter((e) => e.reason === 'not-spec-shaped')
    .map((e) => e.records[0])
    .sort((a, b) => a - b);
  assert.deepStrictEqual(excludedNumbers, [302, 401, 402]);

  assert.strictEqual(finalGroups.length, 1, 'the all-non-conforming group is dropped entirely');
  assert.deepStrictEqual(finalGroups[0].map((r) => r.number), [301], 'the mixed group keeps only its conforming member');
});

test('queue-pull-script.md\'s not-spec-shaped pass excludes an empty-body candidate with all four sections missing (#2829 AC5)', () => {
  const emptyBody = { number: 501, body: '' };

  const { finalGroups, exclusions } = runSnippet([[emptyBody]]);

  const notSpecShaped = exclusions.filter((e) => e.reason === 'not-spec-shaped');
  assert.strictEqual(notSpecShaped.length, 1);
  assert.deepStrictEqual(
    notSpecShaped[0].detail.missing.sort(),
    ['Acceptance Criteria', 'Current State', 'Deliverables', 'Release Note'].sort(),
  );
  assert.deepStrictEqual(finalGroups, [], 'the group left with no surviving members is dropped');
});
