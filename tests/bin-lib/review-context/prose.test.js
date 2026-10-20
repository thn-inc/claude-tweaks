'use strict';

// #1893: review-effort-derivation.md read as if `build-review-context.js mint` prints a bare
// directory path (it prints a one-line JSON object by default). Pins that the prose now names
// the actual JSON shape and the `--print-dir` flag, and that step3-lens-dispatch.md defines
// `{ctx-dir}` before it is first used as a bare path.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { PER_FILE_CAP_BYTES } = require('../../../plugin/bin/lib/review-context/build');

const ROOT = path.join(__dirname, '..', '..', '..');

const EFFORT_DERIVATION = fs.readFileSync(
  path.join(ROOT, 'plugin', 'skills', 'review', 'review-effort-derivation.md'),
  'utf8',
);
const LENS_DISPATCH = fs.readFileSync(
  path.join(ROOT, 'plugin', 'skills', 'review', 'step3-lens-dispatch.md'),
  'utf8',
);
const DEBATE_AND_REFUTATION = fs.readFileSync(
  path.join(ROOT, 'plugin', 'skills', 'review', 'step3-debate-and-refutation.md'),
  'utf8',
);

test('review-effort-derivation.md names the JSON shape mint prints by default', () => {
  assert.match(EFFORT_DERIVATION, /\{"dir":\s*"…"\}/);
});

test('review-effort-derivation.md uses --print-dir for the {ctx-dir} shell variable', () => {
  assert.match(EFFORT_DERIVATION, /mint --print-dir --run "\$PIPELINE_RUN_DIR"/);
});

test('review-effort-derivation.md documents the .dir fallback for a pre-flag build', () => {
  assert.match(EFFORT_DERIVATION, /JSON\.parse\(require\('fs'\)\.readFileSync\(0\)\)\.dir/);
});

test('step3-lens-dispatch.md defines {ctx-dir} before using it as a bare path in --dir {ctx-dir}', () => {
  const usageIndex = LENS_DISPATCH.indexOf('--dir {ctx-dir}');
  const definitionIndex = LENS_DISPATCH.indexOf('{ctx-dir}` is that path');
  assert.notEqual(usageIndex, -1, 'expected a --dir {ctx-dir} reuse call in step3-lens-dispatch.md');
  assert.notEqual(definitionIndex, -1, 'expected {ctx-dir} to be defined as the printed bare path');
  assert.ok(
    definitionIndex < usageIndex,
    '{ctx-dir} must be defined before the --dir {ctx-dir} reuse call that follows it',
  );
});

test('AC7.1-AC7.2: step3-lens-dispatch.md and docs/plugin-structure.md both name oversizeSections', () => {
  const plugStructure = fs.readFileSync(path.join(ROOT, 'docs', 'plugin-structure.md'), 'utf8');
  assert.ok(LENS_DISPATCH.includes('oversizeSections'), 'step3-lens-dispatch.md must name oversizeSections');
  assert.ok(plugStructure.includes('oversizeSections'), 'docs/plugin-structure.md must name oversizeSections');
  assert.match(LENS_DISPATCH, /\{dir, contextPath, bytes, files, emptySections, oversizeSections, baselinePath, listenersPath\}/);
});

test('3302 AC: step3-lens-dispatch.md never tells the reviewer to write a file under {ctx-dir} by hand', () => {
  assert.ok(!/>\s*\{ctx-dir\}\//.test(LENS_DISPATCH), 'no > {ctx-dir}/ redirect may remain');
  const start = LENS_DISPATCH.indexOf('**Pre-dispatch listing (scratch-sweep baseline).**');
  assert.notEqual(start, -1, 'pre-dispatch listing paragraph must exist');
  const para = LENS_DISPATCH.slice(start, LENS_DISPATCH.indexOf('\n', start));
  assert.match(para, /baselinePath/);
  assert.match(para, /listenersPath/);
  assert.match(para, /Never write either file by hand/);
  assert.doesNotMatch(para, /\btee\b|Write tool|`Write`/, 'no non-redirect hand-write phrasing may creep in');
});

test('F5: step3-lens-dispatch.md names the per-file cap as the build.js constant in KB', () => {
  assert.ok(
    LENS_DISPATCH.includes(`${PER_FILE_CAP_BYTES / 1024} KB`),
    `step3-lens-dispatch.md must name the cap as ${PER_FILE_CAP_BYTES / 1024} KB`,
  );
});

// #2956: the orchestrator-written coordination inputs live in the session-scoped temp dir, not {ctx-dir}.
test('2956: neither step file directs writing the coordination inputs into {ctx-dir}', () => {
  const stepFiles = [
    ['step3-lens-dispatch.md', LENS_DISPATCH],
    ['step3-debate-and-refutation.md', DEBATE_AND_REFUTATION],
  ];
  for (const [name, text] of stepFiles) {
    // Any {ctx-dir}-rooted path ending in lens-*.json or findings-by-lens.json, whatever sits between.
    assert.ok(!/\{ctx-dir\}[^\s`]*\/lens-/.test(text), `${name} must not write {ctx-dir}/…/lens-*.json`);
    assert.ok(!/\{ctx-dir\}[^\s`]*\/findings-by-lens\.json/.test(text), `${name} must not write {ctx-dir}/…/findings-by-lens.json`);
  }
});

test('2956: step3-lens-dispatch.md resolves the per-agent inputs in the session temp dir', () => {
  assert.ok(LENS_DISPATCH.includes('session-tmp-resolve.js'), 'must name session-tmp-resolve.js');
  assert.ok(LENS_DISPATCH.includes('_shared/session-tmp-root.md'), 'must cite _shared/session-tmp-root.md');
  assert.ok(LENS_DISPATCH.includes('review-{ctx-id}-lens-{LENS}-agentA.json'), 'must name the agentA file');
  assert.ok(LENS_DISPATCH.includes('review-{ctx-id}-lens-{LENS}-agentB.json'), 'must name the agentB file');
});

test('2956: step3-debate-and-refutation.md resolves findings-by-lens.json in the session temp dir', () => {
  assert.ok(DEBATE_AND_REFUTATION.includes('session-tmp-resolve.js'), 'must name session-tmp-resolve.js');
  assert.ok(DEBATE_AND_REFUTATION.includes('_shared/session-tmp-root.md'), 'must cite _shared/session-tmp-root.md');
  assert.ok(DEBATE_AND_REFUTATION.includes('review-{ctx-id}-findings-by-lens.json'), 'must name the findings-by-lens file');
});

test('2956: step3-lens-dispatch.md defines {ctx-id} from the {ctx-dir} basename before first use', () => {
  const definition = LENS_DISPATCH.match(/`\{ctx-id\}` is `\{ctx-dir\}`'s parent-directory basename joined with `-` to `\{ctx-dir\}`'s own basename/);
  assert.ok(definition, '{ctx-id} must be defined as the parent-directory basename joined with - to the own basename');
  assert.ok(definition.index < LENS_DISPATCH.indexOf('review-{ctx-id}-'), '{ctx-id} must be defined before its first use');
});

test('2956: the Agent-scratch cleanup check no longer excludes lens-*.json or findings-by-lens.json', () => {
  const cleanup = LENS_DISPATCH.split('\n').find((line) => line.includes('**Agent-scratch cleanup check.**'));
  assert.ok(cleanup, 'Agent-scratch cleanup check paragraph must exist');
  assert.ok(!cleanup.includes('lens-*.json'), 'cleanup check must not name lens-*.json');
  assert.ok(!cleanup.includes('findings-by-lens.json'), 'cleanup check must not name findings-by-lens.json');
});
