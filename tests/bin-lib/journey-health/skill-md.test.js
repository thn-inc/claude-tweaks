const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readText } = require('../../helpers/read-skill');
const {
  registerHouseSectionOrderTest,
  registerInteractionStyleTest,
  registerPipelineRunDirTest,
  registerNoEmojiTest,
  registerRequiredTokenTests,
} = require('../health-core/skill-md-house-checks');

const SKILL = path.resolve(__dirname, '..', '..', '..', 'plugin', 'skills', 'journey-health', 'SKILL.md');
const read = () => readText(SKILL);

test('exists', () => {
  assert.ok(fs.existsSync(SKILL), `SKILL.md not found at ${SKILL}`);
});

test('frontmatter declares the canonical name', () => {
  assert.match(read(), /^name: journey-health$/m);
});

registerInteractionStyleTest(test, assert, read);

test('invokes the CLI via ${CLAUDE_PLUGIN_ROOT}/bin/journey-health.js (not $SKILL_DIR)', () => {
  const body = read();
  assert.ok(body.includes('${CLAUDE_PLUGIN_ROOT}/bin/journey-health.js'));
  assert.ok(!body.includes('$SKILL_DIR'), 'must not use the non-existent $SKILL_DIR variable');
});

test('documents the dry-run-first procedure and hands payloads to gh', () => {
  const body = read();
  assert.ok(body.includes('--dry-run'));
  assert.ok(/gh issue create/.test(body));
});

registerHouseSectionOrderTest(test, assert, read);
registerPipelineRunDirTest(test, assert, read);

test('docs/skill-graph.md records the edges to /journeys, /stories, /test, /tidy, /backlog, /routine', () => {
  // These edges used to be asserted against this skill's own Relationship table.
  // That table is gone; the edges live in the graph, which uses the short form.
  const graph = readText(path.join(__dirname, '..', '..', '..', 'docs', 'skill-graph.md'));
  for (const s of ['/journeys', '/stories', '/test', '/tidy', '/backlog', '/routine']) {
    assert.ok(graph.includes(s), `docs/skill-graph.md is missing the edge to ${s}`);
  }
});

registerNoEmojiTest(test, assert, read);

// ── spec 15: recordPayload migration anchors ────────────────────────────────

registerRequiredTokenTests(test, assert, read, [
  'validate-findings', '$PIPELINE_RUN_DIR', '--dry-run', '_shared/health-state.md',
  'work-record.md', 'work-fingerprint', 'by:journey-health', 'extractFingerprint',
  'work-types', 'TYPE_LABELS', 'journey-health:drift', 'journey-health:coverage',
  'journey-health:regression-suspected', 'relatedSections', 'Bundling rule',
]);

test('states the severity -> risk fold table literally', () => {
  const body = read();
  assert.ok(/\|\s*`?high`?\s*\|\s*`risk:high`\s*\|\s*`size:medium`\s*\|/.test(body), 'missing literal high -> risk:high/size:medium table row');
  assert.ok(/\|\s*`?med`?\s*\|\s*`risk:medium`\s*\|\s*`size:medium`\s*\|/.test(body), 'missing literal med -> risk:medium/size:medium table row');
  assert.ok(/\|\s*`?low`?\s*\|\s*`risk:low`\s*\|\s*`size:medium`\s*\|/.test(body), 'missing literal low -> risk:low/size:medium table row');
});

test('states the born-ready rule explicitly', () => {
  assert.ok(read().includes('born-`ready`'), 'missing an explicit born-ready statement');
});

test('states the Type rule (bug iff regression-suspected, else task)', () => {
  const body = read();
  assert.ok(/regression-suspected/.test(body) && /\bbug\b/.test(body) && /\btask\b/.test(body));
});

test('never emits the bare journey-health label as mechanical origin (by:journey-health only)', () => {
  const body = read();
  assert.ok(!/`journey-health`-labelled/.test(body), 'must not describe issues as bare `journey-health`-labelled anymore');
  assert.ok(!body.includes('--label journey-health --label'), 'must not file with a bare --label journey-health anymore');
  assert.ok(!body.includes('gh issue list --label journey-health '), 'must not gather issues via the bare journey-health label anymore');
  assert.ok(body.includes('--label by:journey-health'), 'filing snippets must use the qualified by:journey-health label');
});

test('does not carry a "not pulled by / never pulled by" triage carve-out', () => {
  assert.ok(!/not pulled by|never pulled by|deliberately outside triage/i.test(read()));
});

test('states pipeline membership (records enter the same gate worklist as the other producers)', () => {
  assert.ok(/same gate worklist as the other/i.test(read()));
});

test('documents the wontfix suppression and the dual fingerprint marker (legacy journey-health-fingerprint, read via extractFingerprint)', () => {
  const body = read();
  assert.ok(body.includes('wontfix'));
  assert.ok(body.includes('journey-health-fingerprint'), 'legacy marker name must still be documented as a read-only fallback');
  assert.ok(body.includes('extractFingerprint'));
});
