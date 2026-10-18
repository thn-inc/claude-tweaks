'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// refs #2908 — candidates-security-hardening.js must require
// ('./focus-generators') before require('./candidates-dead-code')
// (.claude/skills/code-health-focus-vertical/SKILL.md pitfall 1). Reversing
// the order emits Node's "inside circular dependency" warning on stderr
// (listTrackedSourceFiles, isGlobDiscoveredTestFile, extractModuleExports,
// escapeRegExp bound to undefined in that process) — #2628 fixed this exact
// shape in candidates-app-store-readiness.js. Scoped to this one generator,
// not every candidates-*.js file: candidates-experiment-cleanup.js had the
// same reversed order and was fixed separately in #3330.

const CODE_HEALTH_DIR = path.join(__dirname, '../../../plugin/bin/lib/code-health');
const MODULE_PATH = path.join(CODE_HEALTH_DIR, 'candidates-security-hardening.js');

test('candidates-security-hardening.js loads in a fresh process with no circular-dependency warning', () => {
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(MODULE_PATH)})`], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `load exited non-zero: ${result.stderr}`);
  assert.ok(
    !/inside circular dependency/i.test(result.stderr || ''),
    `candidates-security-hardening.js emitted a circular-dependency warning on load:\n${result.stderr}`
  );
});

test('candidates-security-hardening.js requires ./focus-generators before ./candidates-dead-code', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const focusGeneratorsIdx = source.indexOf("require('./focus-generators')");
  const deadCodeIdx = source.indexOf("require('./candidates-dead-code')");
  assert.ok(focusGeneratorsIdx !== -1, "expected a require('./focus-generators') line");
  assert.ok(deadCodeIdx !== -1, "expected a require('./candidates-dead-code') line");
  assert.ok(
    focusGeneratorsIdx < deadCodeIdx,
    "candidates-security-hardening.js must require './focus-generators' before './candidates-dead-code' — reverting this order regresses #2908 (verified by temporarily reverting it: the test above fails with the circular-dependency warning)"
  );
});
