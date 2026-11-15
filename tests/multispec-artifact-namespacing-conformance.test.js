// tests/multispec-artifact-namespacing-conformance.test.js — pins #786's fix: journeys and
// stories filenames get namespaced by spec id when generated inside a multi-spec `/flow` run's
// shared worktree (so two specs can't silently overwrite each other's artifact), and
// flow/multi-spec.md carries a completion-time check that verifies no overwrite happened by
// walking the run's own git history.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const JOURNEYS_FILE = path.join(__dirname, '..', 'plugin', 'skills', 'journeys', 'SKILL.md');
const STORIES_FILE = path.join(__dirname, '..', 'plugin', 'skills', 'stories', 'SKILL.md');
const MULTISPEC_FILE = path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'multi-spec.md');
const NAMESPACING_FILE = path.join(
  __dirname,
  '..',
  'plugin',
  'skills',
  'flow',
  'multispec-artifact-namespacing.md',
);

const flatten = (s) => s.replace(/\s+/g, ' ');
const read = (file) => flatten(readText(file));

test('journeys/SKILL.md namespaces docs/journeys/{journey-name}.md by spec id in a multi-spec shared worktree', () => {
  const text = read(JOURNEYS_FILE);
  assert.match(text, /Multi-spec shared worktree \(#786\)/);
  assert.match(text, /MULTISPEC_SHARED_WORKTREE=1/);
  assert.match(text, /docs\/journeys\/\{journey-name\}-\{N\}\.md/);
});

test('stories/SKILL.md namespaces {OUTPUT_DIR}/{site-name}-{persona-or-area}.yaml by spec id in a multi-spec shared worktree', () => {
  const text = read(STORIES_FILE);
  assert.match(text, /Multi-spec shared worktree \(#786\)/);
  assert.match(text, /MULTISPEC_SHARED_WORKTREE=1/);
  assert.match(text, /\{OUTPUT_DIR\}\/\{site-name\}-\{persona-or-area\}-\{N\}\.yaml/);
});

test('flow/multi-spec.md cites the artifact-overwrite completion check before the Consolidated Review Console', () => {
  const text = read(MULTISPEC_FILE);
  assert.match(text, /Artifact-overwrite completion check \(#786\)/);
  assert.match(text, /multispec-artifact-namespacing\.md/);
  // Ordering: the citing section must precede the Consolidated Review Console section so the
  // check actually runs before the console renders, not after.
  const checkIdx = text.indexOf('Artifact-overwrite completion check (#786)');
  const consoleIdx = text.indexOf('Consolidated Review Console (end of run)');
  assert.ok(checkIdx !== -1 && consoleIdx !== -1, 'both sections must be present');
  assert.ok(checkIdx < consoleIdx, 'completion check must precede the Consolidated Review Console section');
});

test('multispec-artifact-namespacing.md holds the full completion-check procedure', () => {
  const text = read(NAMESPACING_FILE);
  assert.match(text, /git -C "\$WORKTREE" log --name-status --diff-filter=AM/);
  assert.match(text, /HARD-GATE: stop before rendering the console/);
});

// --- Go-red proof: these checks can actually fail (per skill-prose-conformance-tests'
// go-red guidance) ---

test('go-red proof: a copy missing the journeys namespacing rule fails the same assertion', () => {
  const withoutRule = flatten('For each new journey identified, create a file at docs/journeys/{journey-name}.md.');
  assert.throws(() => assert.match(withoutRule, /Multi-spec shared worktree \(#786\)/));
});

test('go-red proof: a copy missing the stories namespacing rule fails the same assertion', () => {
  const withoutRule = flatten('4. File naming: {OUTPUT_DIR}/{site-name}-{persona-or-area}.yaml');
  assert.throws(() => assert.match(withoutRule, /Multi-spec shared worktree \(#786\)/));
});

test('go-red proof: a copy missing the completion check, or ordered after the console, fails the ordering assertion', () => {
  const wrongOrder = flatten(
    '## Consolidated Review Console (end of run)\n\nRenders the console.\n\n## Artifact-overwrite completion check (#786)\n\nRuns too late to matter.',
  );
  const checkIdx = wrongOrder.indexOf('Artifact-overwrite completion check (#786)');
  const consoleIdx = wrongOrder.indexOf('Consolidated Review Console (end of run)');
  assert.throws(() => assert.ok(checkIdx < consoleIdx));
});

// --- #4593: the check reads the multi-spec manifest for untrailered-commit attribution ---

function assertRunFlagInCommand(text) {
  assert.match(text, /check-artifact-overwrite\.js" --base "\{EXPECTED_BASE\}" --run "\{parent\}"/);
}
test('AC9.1: multispec-artifact-namespacing.md passes --run "{parent}" to the check', () => {
  assertRunFlagInCommand(read(NAMESPACING_FILE));
});
test('go-red proof: a command block without --run fails the same assertion', () => {
  assert.throws(() =>
    assertRunFlagInCommand(
      flatten('node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base "{EXPECTED_BASE}" --path docs/journeys/'),
    ),
  );
});
function assertRunOmissionRule(text) {
  assert.match(
    flatten(text),
    /Omit `--run` only when this run's `parallel` waves actually ran with two or more members/,
  );
}
test('Q11: the procedure omits --run only for waves that ran with two or more members', () => {
  assertRunOmissionRule(read(NAMESPACING_FILE));
});
test('go-red proof: the old "a parallel run omits --run" wording fails the Q11 assertion', () => {
  assert.throws(() => assertRunOmissionRule('a run started with the `parallel` token omits `--run`'));
});

// --- #4845: the run's events exclude the integration branch's history ---

function assertRawWalkExcludesIntegrationRef(text) {
  assert.match(text, /log --name-status --diff-filter=AM "\{EXPECTED_BASE\}\.\.HEAD" "\^origin\/\{integration-branch\}" -- docs\/journeys\/ stories\//);
}
test('AC6.1: the raw walk excludes the integration branch\'s history (Q1 decision)', () => {
  assertRawWalkExcludesIntegrationRef(read(NAMESPACING_FILE));
});
test('go-red proof: the pre-#4845 raw walk fails the AC6.1 assertion', () => {
  assert.throws(() => assertRawWalkExcludesIntegrationRef(flatten('git -C "$WORKTREE" log --name-status --diff-filter=AM "{EXPECTED_BASE}..HEAD" -- docs/journeys/ stories/')));
});
function assertIntegrationRefInCommand(text) {
  assert.match(text, /check-artifact-overwrite\.js" --base "\{EXPECTED_BASE\}" --run "\{parent\}" --integration-ref "origin\/\{integration-branch\}"/);
}
test('AC1.1: the procedure passes --integration-ref "origin/{integration-branch}" to the check', () => {
  assertIntegrationRefInCommand(read(NAMESPACING_FILE));
});
test('go-red proof: a command without --integration-ref fails the same assertion', () => {
  assert.throws(() => assertIntegrationRefInCommand(flatten('node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base "{EXPECTED_BASE}" --run "{parent}" --path docs/journeys/')));
});
function assertMembershipClearing(text) {
  assert.match(text, /blamed commit is not one of the run's own commits/);
  assert.match(text, /merge commit inside the run is never cleared/);
}
test('AC2.1: the procedure names the membership check and the merge fail-closed', () => {
  assertMembershipClearing(read(NAMESPACING_FILE));
});
test('go-red proof: a procedure naming only the five tests fails the membership assertion', () => {
  assert.throws(() => assertMembershipClearing(flatten('Only a commit that deletes lines failing all five tests is a real overwrite.')));
});
