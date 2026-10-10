'use strict';
// tests/build-skip-degrade-trace-adoption.test.js — pins #904: the auto-decision-log's
// degrade-trace rule (a new SKIP entry-status vocabulary member for a documented conditional
// step that was skipped or degraded, with no staged artifact) and its adoption in /build's
// seven documented conditional steps (Common Steps 1.7/4.5/5.5/6.5/7, Spec Steps 1/2.5).
//
// AC2's repo-wide vocabulary sweep is covered by the code-level pins below (STATUSES,
// KIND_RE) plus tests/bin-lib/log-decision/{append,cli}.test.js and
// tests/wrap-up-console-fast-path-scanned-exclusion.test.js (the Empty-console fast path's
// SKIP exclusion). This file covers the prose contract and /build's adoption sites.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const AUTO_DECISION_LOG = read('plugin', 'skills', '_shared', 'auto-decision-log.md');
const BUILD_SKILL = read('plugin', 'skills', 'build', 'SKILL.md');
const HANDOFF_TEMPLATE = read('plugin', 'skills', 'build', 'handoff-template.md');
const DESIGN_PREBUILD = read('plugin', 'skills', 'build', 'design-prebuild.md');
const ARCHITECTURE_ALIGNMENT = read('plugin', 'skills', 'build', 'architecture-alignment.md');
const PR_EARLY_RUN_LIFECYCLE = read('plugin', 'skills', '_shared', 'pr-early-run-lifecycle.md');
const GIT_DISCIPLINE = read('plugin', 'skills', '_shared', 'git-discipline.md');

// --- Contract text (auto-decision-log.md) ---

test('auto-decision-log.md: SKIP is in the entry-status vocabulary table', () => {
  assert.match(AUTO_DECISION_LOG, /`SKIP` \(a documented conditional action was skipped or degraded/);
});

test('auto-decision-log.md: Degrade-trace rule section exists with the SKIP entry grammar', () => {
  assert.match(AUTO_DECISION_LOG, /## Degrade-trace rule \(SKIP\)/);
  assert.match(AUTO_DECISION_LOG, /SKIP \{HH:MM:SS\} — \{step-name\} \(\{skipped\|degraded\}\): \{condition that fired\} → \{fallback taken\}/);
});

test('auto-decision-log.md: STAGED/SKIP disjointness is stated explicitly', () => {
  assert.match(AUTO_DECISION_LOG, /`STAGED` and `SKIP` are disjoint by the presence of a staged artifact/);
});

test('auto-decision-log.md: no-op rule (a clean run writes nothing) is stated for SKIP', () => {
  assert.match(AUTO_DECISION_LOG, /A step that executes as documented writes nothing/);
  assert.doesNotMatch(AUTO_DECISION_LOG.split('## Degrade-trace rule (SKIP)')[1].split('## Append protocol')[0], /Never log "ran fine"\.[\s\S]*Never log "ran fine"\./);
});

test('auto-decision-log.md: no-run-dir carrier points at the handoff template', () => {
  assert.match(AUTO_DECISION_LOG, /No-run-dir carrier.*list the skip inline in the handoff instead/s);
});

test('auto-decision-log.md: self-adoption obligation for new conditional actions', () => {
  assert.match(AUTO_DECISION_LOG, /Self-adoption obligation/);
  assert.match(AUTO_DECISION_LOG, /any \*new\* documented conditional action added to any skill after this rule lands adopts/);
});

test('auto-decision-log.md: worked example cites the pr-first bootstrap skip (#778 class)', () => {
  assert.match(AUTO_DECISION_LOG, /#778 incident class/);
  assert.match(AUTO_DECISION_LOG, /draft-PR bootstrap \(skipped\): condition: integration-model=local-merge/);
});

// --- /build adoption: each of the 7 documented conditional steps names a SKIP-write instruction ---

const BUILD_STEP_SKIP_SITES = [
  { name: 'Spec Step 1 (pr-first draft-PR bootstrap)', source: BUILD_SKILL, pattern: /a no-op under `local-merge`\. \*\*On skip\*\* \(local-merge\), write a `SKIP` entry/ },
  { name: 'Spec Step 2.5 (Manual Steps probing)', source: BUILD_SKILL, pattern: /\*\*No Manual Steps section \(skip\):\*\* write one `SKIP` entry/ },
  { name: 'Common Step 1.7 (Design Pre-Build gate)', source: BUILD_SKILL, pattern: /see `design-prebuild\.md` in this skill's directory\. \*\*On skip\*\*, write a `SKIP` entry/ },
  { name: 'Common Step 4.5 (Architecture Alignment)', source: BUILD_SKILL, pattern: /\*\*On skip\*\* \(one of the three conditions fires — never for a normal run finding zero deviations\), write a `SKIP` entry/ },
  { name: 'Common Step 5.5 (Operational Checklist)', source: BUILD_SKILL, pattern: /Otherwise skip this step entirely\. \*\*On skip\*\*, write a `SKIP` entry per the degrade-trace rule \(condition: no schema\/env\/IaC\/CI\/platform-config files in diff\)/ },
  { name: 'Common Step 6.5 (Documentation Sync)', source: BUILD_SKILL, pattern: /skip this step entirely\. \*\*On skip\*\*, write a `SKIP` entry per the degrade-trace rule \(condition: no `docs\/REGISTRY\.md`\)/ },
  { name: 'Common Step 7 (phase-exit push)', source: BUILD_SKILL, pattern: /A no-op under `local-merge` or `current-branch` mode\. \*\*On skip\*\*, write a `SKIP` entry/ },
];

for (const site of BUILD_STEP_SKIP_SITES) {
  test(`build/SKILL.md: ${site.name} names its SKIP-write instruction`, () => {
    assert.match(site.source, site.pattern, `${site.name} is missing its SKIP-write instruction`);
  });
}

test('build/SKILL.md: every SKIP-write site cites the degrade-trace rule (directly or via a sub-file pointer)', () => {
  const onSkipCount = (BUILD_SKILL.match(/\*\*On skip\*\*/g) || []).length;
  assert.equal(onSkipCount, 6, 'expected 6 "**On skip**" sites in SKILL.md (Spec Step 1, Common Steps 1.7/4.5/5.5/6.5/7) — Spec Step 2.5 uses its own "(skip)" phrasing instead');
});

test('design-prebuild.md: On-skip subsection distinguishes surface-gate vs. its own conditions', () => {
  assert.match(DESIGN_PREBUILD, /## On skip \(write the trace\)/);
  assert.match(DESIGN_PREBUILD, /--step "Common Step 1\.7 \(skipped\)"/);
});

test('architecture-alignment.md: On-skip subsection states the skip-vs-normal-partial-run distinction', () => {
  assert.match(ARCHITECTURE_ALIGNMENT, /## On skip \(write the trace\)/);
  assert.match(ARCHITECTURE_ALIGNMENT, /Do not write a `SKIP` entry for "ran, found no deviations\."/);
});

test('pr-early-run-lifecycle.md: local-merge row gets a SKIP write, connectivity-degrade rows keep their existing AUTO lines', () => {
  assert.match(PR_EARLY_RUN_LIFECYCLE, /local-merge` row specifically/);
  assert.match(PR_EARLY_RUN_LIFECYCLE, /every connectivity-degrade row\nalready writes its own `AUTO … FAILED` line.*and keeps doing so unchanged/s);
});

test('git-discipline.md: Phase-exit push SKIP write is distinct from the existing failure-degrade warning', () => {
  assert.match(GIT_DISCIPLINE, /the existing failure-degrade warning above is\nunaffected/);
});

// --- handoff-template.md: inline-skip listing for no-run-dir runs ---

test('handoff-template.md: Skipped steps section exists with a rendered example', () => {
  assert.match(HANDOFF_TEMPLATE, /### Skipped steps/);
  assert.match(HANDOFF_TEMPLATE, /the no-run-dir carrier/);
  assert.match(HANDOFF_TEMPLATE, /Rendered example/);
  // The rendered example must actually use the condition → fallback shape.
  assert.match(HANDOFF_TEMPLATE, /condition: surface=backend, not web\/mobile\/desktop\/terminal → fallback: no design pre-load/);
});

test('handoff-template.md: Skipped steps section is explicitly scoped to standalone (no run dir) runs', () => {
  assert.match(HANDOFF_TEMPLATE, /Render this section only for a standalone `\/build` run \(no run dir\)/);
});
