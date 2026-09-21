// tests/review-dispatch-composition.test.js — pins #2019's `review-dispatch` compose call
// site (review/step3-lens-dispatch.md's "Composed dispatch-contract bundle" section) as
// composed behavior, not bytes: composing subagent-dispatch-core.md and run-dir-resolution.md
// together must actually produce every section review/step3-lens-dispatch.md,
// step3-routing.md, and step3-debate-and-refutation.md cite (Working Directory Discipline,
// Model Selection, Template A, Failed-agent retrieval, the fan-out section, Resolution order,
// Bash snippet), and the composed result must stay under the shared byte ceiling with no
// COMPOSED_STEP_EXCEPTIONS entry — the reason this record split the two sources in the first
// place. Neither source carries `when:` markers, so there is no mode-branch to pin the way
// flow-manifesto-composition.test.js does; the composed-behavior surface here is instead
// "the real call site's sources actually compose to the expected content, under the gate."
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compose } = require('../plugin/bin/lib/compose-context/compose');
const {
  findComposeCallSites, composedBytesReport, overComposedCeiling, CEILING_BYTES, COMPOSED_STEP_EXCEPTIONS,
} = require('../plugin/bin/lib/skill-audit/context-cost.js');

const PLUGIN_ROOT = path.join(__dirname, '..', 'plugin');
const CORE = path.join(PLUGIN_ROOT, 'skills', '_shared', 'subagent-dispatch-core.md');
const RUN_DIR_RESOLUTION = path.join(PLUGIN_ROOT, 'skills', '_shared', 'run-dir-resolution.md');

const coreContent = fs.readFileSync(CORE, 'utf8');
const runDirContent = fs.readFileSync(RUN_DIR_RESOLUTION, 'utf8');

const UNRESOLVED_CONDITIONS = {
  'integration-model': 'pr-first',
  mode: 'auto',
  attendance: 'headless',
  transport: 'gh',
  'worktree-policy': 'always',
  'work-backend': 'github-issues',
};

const EXPECTED_HEADINGS = [
  '## Working Directory Discipline',
  '## Model Selection',
  '## Template A — Review-style (returns findings)',
  '## Failed-agent retrieval',
  '## How to integrate at a dispatch site',
  '## Resolution order',
  '## Bash snippet (resolution)',
];

test('review/step3-lens-dispatch.md declares a real, parsed `review-dispatch` compose call site over exactly the two split-out files', () => {
  const rows = findComposeCallSites(PLUGIN_ROOT).filter((c) => c.step === 'review-dispatch' && !c.unparsed);
  assert.ok(rows.length > 0, 'expected at least one parsed review-dispatch call site — the compose call in step3-lens-dispatch.md\'s "Composed dispatch-contract bundle" section is missing or unparsed');
  for (const row of rows) {
    assert.equal(row.file, 'review/step3-lens-dispatch.md', `expected the review-dispatch call site to live in review/step3-lens-dispatch.md, found it in ${row.file}`);
    const basenames = row.sources.map((s) => path.basename(s)).sort();
    assert.deepEqual(basenames, ['run-dir-resolution.md', 'subagent-dispatch-core.md'].sort(), `expected review-dispatch's sources to be exactly the two split-out files, got: ${basenames.join(', ')}`);
  }
});

test('composing the review-dispatch sources produces every section the three review files cite', () => {
  const bundle = compose(
    [
      { path: 'plugin/skills/_shared/subagent-dispatch-core.md', content: coreContent },
      { path: 'plugin/skills/_shared/run-dir-resolution.md', content: runDirContent },
    ],
    UNRESOLVED_CONDITIONS,
  );
  for (const heading of EXPECTED_HEADINGS) {
    assert.ok(bundle.includes(heading), `composed review-dispatch bundle is missing expected heading: ${heading}`);
  }
});

test('the review-dispatch composed bundle stays under CEILING_BYTES with no exception entry needed', () => {
  const rows = composedBytesReport(PLUGIN_ROOT).filter((r) => r.step === 'review-dispatch');
  assert.ok(rows.length > 0, 'expected a measured review-dispatch row — the call site is gone or unparsed');
  for (const row of rows) {
    assert.equal(row.error, undefined, `review-dispatch row carries an error: ${row.error}`);
    assert.ok(row.max < CEILING_BYTES, `review-dispatch bundle measured ${row.max} B — must stay under CEILING_BYTES (${CEILING_BYTES} B)`);
  }
  assert.ok(!Object.prototype.hasOwnProperty.call(COMPOSED_STEP_EXCEPTIONS, 'review-dispatch'), 'review-dispatch must not need a COMPOSED_STEP_EXCEPTIONS entry — it fits under the plain ceiling by construction of this split');
  const overCeiling = overComposedCeiling(composedBytesReport(PLUGIN_ROOT)).filter((r) => r.step === 'review-dispatch');
  assert.deepStrictEqual(overCeiling, [], `review-dispatch composed bundle over ceiling: ${JSON.stringify(overCeiling)}`);
});

test('discrimination: composing only one source is missing the other source\'s sections (the composition actually matters, not just file existence)', () => {
  const coreOnly = compose(
    [{ path: 'plugin/skills/_shared/subagent-dispatch-core.md', content: coreContent }],
    UNRESOLVED_CONDITIONS,
  );
  assert.ok(coreOnly.includes('## Model Selection'), 'sanity: core-only bundle should still carry its own Model Selection section');
  assert.ok(!coreOnly.includes('## Resolution order'), 'core-only bundle must NOT carry run-dir-resolution.md\'s Resolution order section — proves the two-source compose above is not vacuously satisfied by one source alone');

  const runDirOnly = compose(
    [{ path: 'plugin/skills/_shared/run-dir-resolution.md', content: runDirContent }],
    UNRESOLVED_CONDITIONS,
  );
  assert.ok(runDirOnly.includes('## Resolution order'), 'sanity: run-dir-resolution-only bundle should still carry its own Resolution order section');
  assert.ok(!runDirOnly.includes('## Model Selection'), 'run-dir-resolution-only bundle must NOT carry subagent-dispatch-core.md\'s Model Selection section');
});
