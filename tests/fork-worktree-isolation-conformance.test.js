const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { CEILING_BYTES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'skill-audit', 'context-cost'));
const NEW_CONTRACT = path.join(ROOT, 'plugin/skills/_shared/fork-worktree-isolation.md');
const SUBAGENT_CONTRACT = path.join(ROOT, 'plugin/skills/_shared/subagent-output-contract.md');
const DONTS = path.join(ROOT, 'docs/donts.md');
const INCIDENT_LOG = path.join(ROOT, 'docs/incident-log.md');
const SKILL_GRAPH = path.join(ROOT, 'docs/skill-graph.md');

// Whitespace-collapsed read, per skill-prose-conformance-tests' control-scan convention --
// a hard-wrapped literal must not silently defeat these assertions.
function collapsed(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\s+/g, ' ');
}

test('fork-worktree-isolation.md exists and carries the isolation mandate', () => {
  const text = collapsed(NEW_CONTRACT);
  assert.match(text, /Mandate: isolation: "worktree" for narrow\/read-only dispatch/);
  assert.match(text, /isolation: "worktree"/);
});

test('fork-worktree-isolation.md stays well clear of the _shared ceiling', () => {
  const bytes = fs.statSync(NEW_CONTRACT).size;
  assert.ok(bytes < 8000, `expected < 8000 bytes, got ${bytes}`);
});

test('subagent-output-contract.md cites the new file and stays under the CEILING_BYTES ceiling', () => {
  const text = collapsed(SUBAGENT_CONTRACT);
  assert.match(text, /_shared\/fork-worktree-isolation\.md/);
  const bytes = fs.statSync(SUBAGENT_CONTRACT).size;
  assert.ok(bytes <= CEILING_BYTES, `expected <= ${CEILING_BYTES} bytes (CEILING_BYTES), got ${bytes}`);
});

test('subagent-output-contract.md no longer restates the old fork clause verbatim', () => {
  const text = collapsed(SUBAGENT_CONTRACT);
  // The retired clause's own distinguishing sentence -- absence-checked per the
  // shared-contract-extraction skill's "absence assertions, whitespace-collapsed" rule.
  assert.doesNotMatch(
    text,
    /fork is for continuing a single prior agent with its own memory intact/
  );
});

test('docs/donts.md fork rule cites the isolation mandate', () => {
  const text = collapsed(DONTS);
  assert.match(text, /fork-worktree-isolation\.md/);
  assert.match(text, /isolation: "worktree"/);
});

test('docs/incident-log.md IL-07 entry records the fifth recurrence and resolution', () => {
  const text = collapsed(INCIDENT_LOG);
  assert.match(text, /Fifth recurrence \(#2278/);
  assert.match(text, /fork-worktree-isolation\.md/);
});

test('docs/skill-graph.md registers the new file exactly once', () => {
  const text = fs.readFileSync(SKILL_GRAPH, 'utf8');
  const matches = text.match(/_shared\/fork-worktree-isolation\.md/g) || [];
  assert.equal(matches.length, 1, `expected exactly one row, found ${matches.length}`);
});
