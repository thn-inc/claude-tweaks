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

const SKILL = path.resolve(__dirname, '..', '..', '..', 'plugin', 'skills', 'code-health', 'SKILL.md');
const read = () => readText(SKILL);

test('frontmatter declares the canonical name', () => {
  assert.match(read(), /^name: code-health$/m);
});

registerInteractionStyleTest(test, assert, read);

test('invokes the CLI via ${CLAUDE_PLUGIN_ROOT}/bin/code-health.js (not $SKILL_DIR)', () => {
  const body = read();
  assert.ok(body.includes('${CLAUDE_PLUGIN_ROOT}/bin/code-health.js'));
  assert.ok(!body.includes('$SKILL_DIR'), 'must not use the non-existent $SKILL_DIR variable (PORT.md delta #9)');
});

test('documents the dry-run-first then run procedure and hands payloads to gh', () => {
  const body = read();
  assert.ok(body.includes('--dry-run'));
  assert.ok(/gh issue create/.test(body));
});

registerHouseSectionOrderTest(test, assert, read);
registerPipelineRunDirTest(test, assert, read);

test('docs/skill-graph.md records the edges to /specify, /capture, /tidy, /flow', () => {
  // These edges used to be asserted against this skill's own Relationship table.
  // That table is gone; the edges live in the graph, which uses the short form.
  const graph = readText(path.join(__dirname, '..', '..', '..', 'docs', 'skill-graph.md'));
  for (const s of ['/specify', '/capture', '/tidy', '/flow']) {
    assert.ok(graph.includes(s), `docs/skill-graph.md is missing the edge to ${s}`);
  }
});

// ── v2 code-health SKILL.md anchors ─────────────────────────────────────────

const skillMdPath = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'code-health', 'SKILL.md');

test('v2 SKILL.md: exists', () => {
  assert.ok(fs.existsSync(skillMdPath), `SKILL.md not found at ${skillMdPath}`);
});

['## When to Use', '## Input', '## Workflow', '## Anti-Patterns',
 '## Component-Skill Contract',
 '## Next Actions', '## Routine Configuration',
].forEach((anchor) => {
  test(`v2 SKILL.md: contains section '${anchor}'`, () => {
    const content = readText(skillMdPath);
    assert.ok(content.includes(anchor), `missing section: ${anchor}`);
  });
});

registerRequiredTokenTests(test, assert, read, [
  'validate-findings', '$PIPELINE_RUN_DIR', '--dry-run', 'criteriaForArea', 'anchor',
  'code-health-fingerprint', 'NearestNamedSymbol', '--min-risk',
  'Multi-slice runs', '_shared/health-state.md', 'relatedAnchors', 'Bundling rule',
  'work-record.md', 'work-fingerprint', 'by:code-health', 'extractFingerprint',
]);

registerNoEmojiTest(test, assert, read);

// ── P4 Task 6: new section anchors ────────────────────────────────────────────
//
// #923: both sections moved out to ci-integration.md (a lazy-loaded sub-file,
// same pattern as filing.md/focus-mode.md) to keep SKILL.md lean — SKILL.md
// now points to them instead of carrying the content inline.

const ciIntegrationPath = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'code-health', 'ci-integration.md');

test('v2 SKILL.md: points to ci-integration.md for CI hooks', () => {
  const content = readText(skillMdPath);
  assert.ok(content.includes('ci-integration.md'), 'missing pointer to ci-integration.md');
});

test('ci-integration.md: contains section \'## Regression and Risk Gating\'', () => {
  const content = readText(ciIntegrationPath);
  assert.ok(content.includes('## Regression and Risk Gating'), 'missing section: ## Regression and Risk Gating');
});

test('ci-integration.md: contains section \'## Fingerprint Churn\'', () => {
  const content = readText(ciIntegrationPath);
  assert.ok(content.includes('## Fingerprint Churn'), 'missing section: ## Fingerprint Churn');
});

test('v2 SKILL.md: contains exactly one occurrence of "subscription"', () => {
  const content = readText(skillMdPath);
  const count = (content.match(/subscription/g) || []).length;
  assert.strictEqual(count, 1, `expected exactly 1 occurrence of "subscription", got ${count}`);
});
