'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #2294: a --run-dir that already resolves to a per-spec {parent}/spec-{N}/
// directory (flow's own internal multi-spec sequential mode) must never
// also be passed --multi-record-slug — the CLI's own tested contract
// (materialize-format.test.js: "--multi-record-slug writes under
// spec-{slug}/work/") appends one more spec-{n}/ level beneath whatever
// --run-dir already names, so combining both descends twice:
// {parent}/spec-C/spec-A-B-C/work/C-spec.md instead of the expected
// {parent}/spec-C/work/C-spec.md. materialize.md's own documented CLI
// signature previously said nothing about when the flag should or
// shouldn't accompany --run-dir, letting this mismatch ship silently.
// These pins ensure the interaction stays stated explicitly.

const ROOT = path.join(__dirname, '..');
const MATERIALIZE = fs.readFileSync(
  path.join(ROOT, 'plugin', 'skills', 'flow', 'materialize.md'), 'utf8',
);

test('materialize.md states the --run-dir/--multi-record-slug interaction by issue number', () => {
  assert.match(MATERIALIZE, /#2294/);
});

test('materialize.md names the dispatch bundled-group case as the one that DOES pass --multi-record-slug', () => {
  assert.match(MATERIALIZE, /shared \*parent\* directory/);
  assert.match(MATERIALIZE, /dispatch\/task-prompt\.md/);
});

test("materialize.md names /flow's own per-spec PIPELINE_RUN_DIR case as the one that must NOT also pass --multi-record-slug", () => {
  assert.match(MATERIALIZE, /already resolves to a per-spec `\{parent\}\/spec-\{N\}\/` directory/);
  assert.match(MATERIALIZE, /do \*\*not\*\* also pass `--multi-record-slug`/);
});

test('materialize.md states the double-descent failure shape concretely, not just abstractly', () => {
  assert.match(MATERIALIZE, /spec-\{N\}\/spec-\{N\}\/work\/\{N\}-spec\.md/);
});
