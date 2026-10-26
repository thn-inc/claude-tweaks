'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

test('flake-handling.md: the runner owns flake retries — the section is "Flake handling" and the agent is no longer told to re-run every failed file first (#1925)', () => {
  const text = read('plugin/skills/test/flake-handling.md');
  assert.match(text, /^# Flake handling \(tests check only\)$/m);
  assert.ok(!text.includes('### Flake adjudication'));
  assert.ok(!text.includes('Before reporting a `tests` check failure, re-run each failed file in isolation once'));
  assert.ok(text.includes('CAVEAT: flaky-retried:'));
  assert.ok(text.includes('CAVEAT: flaky-allowlist:'));
  assert.ok(text.includes('`flaky.files`'));
  assert.ok(text.includes('kind `flaky-allowlist`'), 'the agent stages an allowlist proposal, never edits the allowlist itself');
  assert.ok(text.includes('AUTO {time} — Flaky retry: {files} passed on isolated rerun (declared in verify-scope.json). Reversibility: high.'));
  assert.ok(text.includes('node --test path/to/file.test.js'), 'the isolated rerun still applies to an UNLISTED failing file');
});

test('flake-handling.md: the isolate-and-rerun-once rule names two paths — named-file isolation and whole-suite re-run — selected by retryDecision.reason (#2026)', () => {
  const text = read('plugin/skills/test/flake-handling.md');
  assert.match(text, /^## Named-file isolation$/m);
  assert.match(text, /^## Whole-suite re-run$/m);
  assert.ok(text.includes('retryDecision.reason'));
  assert.ok(text.includes("an `unlisted: […]` reason selects **named-file isolation**"));
  assert.ok(text.includes("a `no-parse` reason"));
  assert.ok(text.includes('an `unattributed-failures: {N}` reason (#3066'), 'the third retryDecision.reason value is documented and routed');
  assert.ok(text.includes('a `no-accounting-guard: {family}` reason (#3204'), 'the fourth retryDecision.reason value is documented and routed to the whole-suite re-run');
  assert.ok(text.includes('(retry: no-parse — whole-suite re-run applies)'), 'the stdout clause is documented');
  assert.ok(text.includes('One re-run, never more'), 'the whole-suite path states the single-re-run cap');
  assert.ok(text.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --cmd tests="{command}"'), 'the whole-suite re-run command is documented');
  const v = read('plugin/skills/test/verification.md');
  assert.ok(v.includes("`flake-handling.md`'s Whole-suite re-run path is the fallback for that"), 'the pre-existing-failures section cross-references the whole-suite path');
});

test('flake-handling.md: flaky.files entries may be globs, reusing the same engine rules[].match uses (#2029)', () => {
  const text = read('plugin/skills/test/flake-handling.md');
  assert.ok(text.includes('repo-relative paths or globs (the same `**`/`*` forms `rules[].match` accepts)'));
  assert.ok(!text.includes('exact repo-relative paths'), 'the old "exact" wording is fully replaced');
  assert.ok(text.includes('a glob is matched against the same printed path'));
});

test('AC3.1: verification.md keeps only a pointer stub at the moved heading (#4059)', () => {
  const v = read('plugin/skills/test/verification.md');
  assert.ok(v.includes('### Flake handling (tests check only)'));
  assert.ok(v.includes("read `flake-handling.md` in this skill's directory"));
  const start = v.indexOf('### Flake handling (tests check only)');
  const end = v.indexOf('### Gate behavior');
  assert.ok(start !== -1 && end > start);
  const stub = v.slice(start, end);
  assert.ok(stub.includes('CAVEAT: flaky-retried:'), 'the stub names the caveat that triggers the load');
  assert.ok(stub.includes('CAVEAT: flaky-allowlist:'), 'the stub names the second caveat that triggers the load');
  assert.ok(stub.includes('When a `tests`-family check fails'), 'the stub names the tests-family failure trigger');
  assert.ok(!v.includes('#### Named-file isolation'));
  assert.ok(!v.includes('#### Whole-suite re-run'));
  assert.ok(!v.includes('One re-run, never more'));
  assert.ok(!v.includes('Bracketed path segments'));
  assert.ok(!v.includes('Flake handling lists below'));
  assert.ok(v.includes('any unattributed signal `flake-handling.md` lists'));
});

test('AC3.1: external citations name test/flake-handling.md (#4059)', () => {
  const seq = read('plugin/skills/dispatch/sequential-execution.md');
  assert.ok(seq.includes('`test/flake-handling.md`'));
  assert.ok(!seq.includes("`test/verification.md`'s Flake handling"));
});

test('docs/plugin-structure.md names flaky.js and the count stamp\'s flakyHits (#1925)', () => {
  const text = read('docs/plugin-structure.md');
  assert.ok(text.includes('flaky.js (#1925'));
  assert.ok(text.includes('flakyHits'));
  assert.ok(text.includes('extractFailingFiles'));
});
