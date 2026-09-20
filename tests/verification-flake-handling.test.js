'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('verification.md: the runner owns flake retries — the section is "Flake handling" and the agent is no longer told to re-run every failed file first (#1925)', () => {
  const text = read('plugin/skills/test/verification.md');
  assert.ok(text.includes('### Flake handling (tests check only)'));
  assert.ok(!text.includes('### Flake adjudication'));
  assert.ok(!text.includes('Before reporting a `tests` check failure, re-run each failed file in isolation once'));
  assert.ok(text.includes('CAVEAT: flaky-retried:'));
  assert.ok(text.includes('CAVEAT: flaky-allowlist:'));
  assert.ok(text.includes('`flaky.files`'));
  assert.ok(text.includes('kind `flaky-allowlist`'), 'the agent stages an allowlist proposal, never edits the allowlist itself');
  assert.ok(text.includes('AUTO {time} — Flaky retry: {files} passed on isolated rerun (declared in verify-scope.json). Reversibility: high.'));
  assert.ok(text.includes('node --test path/to/file.test.js'), 'the isolated rerun still applies to an UNLISTED failing file');
});

test('verification.md: the isolate-and-rerun-once rule names two paths — named-file isolation and whole-suite re-run — selected by retryDecision.reason (#2026)', () => {
  const text = read('plugin/skills/test/verification.md');
  assert.ok(text.includes('#### Named-file isolation'));
  assert.ok(text.includes('#### Whole-suite re-run'));
  assert.ok(text.includes('retryDecision.reason'));
  assert.ok(text.includes("an `unlisted: […]` reason selects **named-file isolation**"));
  assert.ok(text.includes("a `no-parse` reason"));
  assert.ok(text.includes('(retry: no-parse — whole-suite re-run applies)'), 'the stdout clause is documented');
  assert.ok(text.includes('One re-run, never more'), 'the whole-suite path states the single-re-run cap');
  assert.ok(text.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --cmd tests="{command}"'), 'the whole-suite re-run command is documented');
  assert.ok(text.includes('Whole-suite re-run path below is the fallback for that'), 'the pre-existing-failures section cross-references the whole-suite path');
});

test('verification.md: flaky.files entries may be globs, reusing the same engine rules[].match uses (#2029)', () => {
  const text = read('plugin/skills/test/verification.md');
  assert.ok(text.includes('repo-relative paths or globs (the same `**`/`*` forms `rules[].match` accepts)'));
  assert.ok(!text.includes('exact repo-relative paths'), 'the old "exact" wording is fully replaced');
  assert.ok(text.includes('a glob is matched against the same printed path'));
});

test('docs/plugin-structure.md names flaky.js and the count stamp\'s flakyHits (#1925)', () => {
  const text = read('docs/plugin-structure.md');
  assert.ok(text.includes('flaky.js (#1925'));
  assert.ok(text.includes('flakyHits'));
  assert.ok(text.includes('extractFailingFiles'));
});
