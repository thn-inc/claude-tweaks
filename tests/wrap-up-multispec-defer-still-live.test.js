'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', 'execution-and-verification.md');
const ENGINE = path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'wrap-up', 'engine-verify.js');

// Pre-change text of the **MULTISPEC_REVIEW_DEFER branch:** paragraph (line 9), verbatim.
const PRE_CHANGE_PARAGRAPH = `**MULTISPEC_REVIEW_DEFER branch:** When \`$MULTISPEC_REVIEW_DEFER=1\` is set, this step SKIPS the state-changing cleanups marked deferred in \`cleanup-procedures.md\` (items 3 Design caches, 4 Git worktree, 6 Ephemeral dev server, 7 Issue claim release, 8 Pipeline run dir archival). Those defer to \`/flow\`'s consolidated multi-spec Review Console at end-of-run, which has authority to apply or override them across all specs in the run. This step still executes the idempotent cleanups (items 1 Execution plans, 2 Open items ledger, 5 Record/spec lifecycle) — those do not interact with parent-orchestrated cleanup.`;

// The sentence appended to that paragraph by #3400's Step 3, verbatim.
const SENTENCE = `In particular, the **Acceptance labeling** bullet below still runs for every spec (its Try it block, the oversight-floor gate, \`--oversight-exempt\`); \`_shared/pr-run-comments.md\`'s "Multi-spec brief and timing comments (#2970)" section keys each spec's brief to its own marker on the shared PR.`;

const CLAIMS = [
  { id: 'acceptance labeling', pattern: /\*\*Acceptance labeling\*\* bullet below still runs for every spec/ },
  { id: '#2970 citation', pattern: /`_shared\/pr-run-comments\.md`'s "Multi-spec brief and timing comments \(#2970\)"/ },
  { id: 'verify execution', pattern: /\*\*Verify execution\*\* still runs/ },
  { id: 'deferred rows skip', pattern: /`worktree-removed` and `run-dir-archived` rows read `skip \(deferred to parent console\)`/ },
];

function live() {
  return fs.readFileSync(FILE, 'utf8');
}

function engineSource() {
  return fs.readFileSync(ENGINE, 'utf8');
}

function deferParagraph(text) {
  const matches = text.split(/\r?\n\r?\n/).filter((p) => p.startsWith('**MULTISPEC_REVIEW_DEFER branch:**'));
  assert.strictEqual(matches.length, 1, 'expected exactly one MULTISPEC_REVIEW_DEFER branch paragraph');
  return matches[0];
}

function assertClaim(paragraph, claim) {
  assert.match(paragraph, claim.pattern, `claim not named in the defer paragraph: ${claim.id}`);
}

// Waived AC3.1: the full-suite pass is verified at /build Common Step 5 and /test, not by a test in this suite.

for (const claim of CLAIMS) {
  test(`AC1.1: ${claim.id} is named in the defer paragraph`, () => {
    assertClaim(deferParagraph(live()), claim);
  });

  test(`AC2.1: ${claim.id} goes red against the pre-change paragraph`, () => {
    assert.throws(() => assertClaim(PRE_CHANGE_PARAGRAPH, claim));
  });
}

test('AC2.1: acceptance-labeling pin goes red when only its sentence is removed', () => {
  const text = live();
  assert.ok(text.includes(SENTENCE), 'the Step 3 sentence must be present in the live file');
  const doctored = text.replace(SENTENCE, '');
  assert.match(doctored, /acceptance-labeling/, 'a lookalike outside the paragraph must still match');
  assert.throws(() => assertClaim(deferParagraph(doctored), CLAIMS[0]));
});

test('the defer paragraph is still found as one paragraph under CRLF line endings', () => {
  const paragraph = deferParagraph(live().replace(/\n/g, '\r\n'));
  assert.match(paragraph, /^\*\*MULTISPEC_REVIEW_DEFER branch:\*\*/);
});

// Slices one registerCheck body: from its own registerCheck( call to its closing `});` at column 0.
// Ending at the next registerCheck( instead would also swallow any helper declared between two checks.
function checkBody(src, name) {
  const start = src.indexOf(`registerCheck('${name}'`);
  assert.notStrictEqual(start, -1, `registerCheck('${name}' not found in engine source`);
  const end = src.indexOf('\n});', start);
  assert.notStrictEqual(end, -1, `no closing }); follows registerCheck('${name}' in engine source`);
  return src.slice(start, end);
}

const DEFERRED_DETAIL = `detail: 'deferred to parent console'`;

function assertDeferredRow(src, name) {
  assert.ok(checkBody(src, name).includes(DEFERRED_DETAIL), `${name} must skip with ${DEFERRED_DETAIL}`);
}

test('engine-verify.js skips run-dir-archived and worktree-removed with the deferred detail, and renders skip cells with it', () => {
  const src = engineSource();
  assertDeferredRow(src, 'run-dir-archived');
  assertDeferredRow(src, 'worktree-removed');
  assert.ok(
    src.includes('`${row.result} (${sanitizeCell(row.detail)})`'),
    'renderer must form the skip/unknown Result cell as `${row.result} (${sanitizeCell(row.detail)})`'
  );
});

test('the per-check pin goes red when only run-dir-archived loses its skip line (same helper, in-memory copy)', () => {
  const src = engineSource();
  const body = checkBody(src, 'run-dir-archived');
  const skipLine = `if (deferred.has('run-dir-archival')) return { result: 'skip', detail: 'deferred to parent console' };`;
  assert.ok(body.includes(skipLine), 'control precondition: the run-dir-archived skip line is in its body');
  const doctored = src.replace(body, () => body.replace(skipLine, ''));
  assert.notStrictEqual(doctored, src, 'control precondition: the doctored source differs from the real one');
  assert.throws(() => assertDeferredRow(doctored, 'run-dir-archived'));
  assert.doesNotThrow(() => assertDeferredRow(doctored, 'worktree-removed'));
});

test('the per-check pin goes red when the skip line moves into a helper declared between two checks', () => {
  const src = engineSource();
  const body = checkBody(src, 'run-dir-archived');
  const skipLine = `if (deferred.has('run-dir-archival')) return { result: 'skip', detail: 'deferred to parent console' };`;
  const stripped = src.replace(body, () => body.replace(skipLine, ''));
  const doctored = stripped.replace("registerCheck('worktree-removed'", () => `function skipHelper(deferred) {\n  ${skipLine}\n}\n\nregisterCheck('worktree-removed'`);
  assert.notStrictEqual(doctored, stripped, 'control precondition: the helper was inserted between the two checks');
  assert.throws(() => assertDeferredRow(doctored, 'run-dir-archived'));
});
