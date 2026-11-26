'use strict';
// #5833: the multi-spec Shared teardown's merge acts on a merge half computed at console time, so step 2
// re-checks the merge-check verdict against the parent run dir before either integration model merges.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const FILE = path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'multispec-review-console.md');
const RECHECK = 'console-resolve.js" --run "$MULTISPEC_PARENT_DIR" --recheck-merge';
const MERGE = "run\n   `_shared/pr-first-merge.md`'s procedure now";

function assertTeardownRecheck(text) {
  const start = text.indexOf('2. **Finish the shared branch.**');
  assert.ok(start !== -1, 'Shared teardown step 2 must exist');
  const step = text.slice(start, text.indexOf('\n3. ', start));
  const at = step.indexOf(RECHECK);
  assert.ok(at !== -1, 'step 2 must run --recheck-merge against $MULTISPEC_PARENT_DIR');
  assert.ok(at < step.indexOf(MERGE), '--recheck-merge must precede the pr-first merge');
  assert.ok(step.includes('Merge only on exit 0 printing `recheck-merge merge`'), 'step 2 merges only on `recheck-merge merge`');
  assert.ok(step.includes('never a `spec-{N}/` dir'), 'step 2 targets the parent dir');
}

test('AC1.1: Shared teardown step 2 re-checks the merge-check verdict against the parent run dir before merging', () => {
  assertTeardownRecheck(readText(FILE));
});

test('go-red: a Shared teardown step 2 without the --recheck-merge call fails the pin', () => {
  const text = readText(FILE);
  const mutated = text.replace(RECHECK, 'console-resolve.js" --run "$MULTISPEC_PARENT_DIR"');
  assert.notStrictEqual(mutated, text);
  assert.throws(() => assertTeardownRecheck(mutated), /--recheck-merge/);
});
