'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');

// #1139: pipeline-run-dir.md's "CLI-argument boundary" paragraph (## Anchoring)
// makes testable factual claims about six binaries — which of the two rules
// each carries, and which exit code — but nothing pinned it (#1065 whole-branch
// review, Minor #11); [IL-127] recurred twice from prose-only defenses. This
// pins both bullets' binary lists and exit codes against the live doc.

const ROOT = path.join(__dirname, '..');
const DOC_PATH = path.join(ROOT, 'plugin', 'skills', '_shared', 'pipeline-run-dir.md');
const DOC = readText(DOC_PATH);

// Anchored on the bullet's own bold lead-in text (structure), not on a
// sentence elsewhere in the paragraph — the sentence around it is the part
// most likely to be reworded (docs/skill-authoring.md's Executable-snippets
// discipline, restated for prose extraction).
function extractBullet(marker) {
  const re = new RegExp(`- \\*\\*${marker}[\\s\\S]*?(?=\\n\\n)`);
  const m = DOC.match(re);
  assert.ok(m, `pipeline-run-dir.md must have a "- **${marker}" bullet — extraction pattern is out of sync with the doc`);
  return m[0];
}

const PIPELINE_OWNED_BULLET = extractBullet('Pipeline-owned binaries');
const RESOLVER_CLI_BULLET = extractBullet('Resolver CLIs with a documented sandbox use');

const PIPELINE_OWNED_BINARIES = [
  'bin/hooks.js',
  'bin/wrap-up-engine.js',
  'bin/materialize.js',
  'bin/apply-refine-labels.js',
];

const RESOLVER_BINARIES = [
  'bin/resolve-profile.js',
  'bin/resolve-policy.js',
];

for (const binary of PIPELINE_OWNED_BINARIES) {
  test(`pipeline-owned binaries bullet names ${binary}`, () => {
    assert.ok(
      PIPELINE_OWNED_BULLET.includes(binary),
      `expected "${binary}" in the pipeline-owned binaries bullet — the binary list may have drifted from the paragraph's claim`,
    );
  });
}

test('pipeline-owned binaries bullet states exit code 2', () => {
  assert.match(PIPELINE_OWNED_BULLET, /exit code 2/);
});

for (const binary of RESOLVER_BINARIES) {
  test(`resolver CLIs bullet names ${binary}`, () => {
    assert.ok(
      RESOLVER_CLI_BULLET.includes(binary),
      `expected "${binary}" in the resolver CLIs bullet — the binary list may have drifted from the paragraph's claim`,
    );
  });
}

test('resolver CLIs bullet states its own rejection exits 1 (not the pipeline-owned family\'s exit 2)', () => {
  assert.match(RESOLVER_CLI_BULLET, /exits 1\b/);
});

// Discrimination proof for AC 1 ("deleting either bullet ... goes red"): the
// module-level extractBullet() calls above already assert.ok(m, ...) at
// require time — if either bullet is deleted from the live doc, the whole
// suite fails to load rather than silently reporting zero tests. Proven live
// per the skill's Gotchas ("temporarily revert ... to confirm the test
// fails"): both bullet markers were momentarily renamed in the live file
// during authoring, which reproduced this exact failure, then reverted.
