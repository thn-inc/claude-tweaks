// tests/review-step1-5-verifiedhead-gate.test.js — #2003: pins Step 1.5's `/flow` pipeline
// branch (code-mode-steps.md) as gating its proceed/re-trigger decision on `verifiedHead`,
// not bare `match` — the design #1923 already shipped (a scoped pass on a dirtied tree
// satisfies verification instead of forcing a full re-trigger forever). This record adds only
// the missing conformance pin; no behavior change.
//
// Per skill-prose-conformance-tests' frozen-fixture convention, the pre-#1923 control below is
// a hand-built string literal (never read from git history) reproducing the *shape* of what
// Step 1.5 read before #1923 shipped `verifiedHead`: a bare scope-blind `match` field, with no
// `verifiedHead` distinction at all. A pattern naming `verifiedHead` correctly does NOT match
// this control, proving the pin can go red.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CODE_MODE_STEPS = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'review', 'code-mode-steps.md'), 'utf8');

// Hand-built pre-#1923 control (not read from git history): Step 1.5's `/flow` pipeline branch
// gated on the strict, scope-blind `match` field alone -- no `verifiedHead` field existed yet.
const PRE_1923_STEP_1_5_FLOW_BRANCH = `Check for \`TEST_PASSED=true\` in pipeline context. If present, add one belt-and-braces read of the runner's own artifact (#1921) -- \`node "\${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --stamp-status\` (one plain command; prints \`{present, sha, head, dirty, scope, fullSha, match, reportPath, legacy}\`, exit 0 always). \`match: true\` -> proceed to Step 2. \`match: false\` with \`TEST_PASSED=true\` is reported, never silently accepted: "TEST_PASSED set but the runner stamp does not match HEAD ({stamp-sha} vs {head}) -- re-running \`/claude-tweaks:test\`", then re-trigger \`/claude-tweaks:test\` once and re-check.`;

function assertPinned(pattern, message) {
  assert.match(CODE_MODE_STEPS, pattern, message);
  assert.doesNotMatch(PRE_1923_STEP_1_5_FLOW_BRANCH, pattern, `${message} (must NOT match the pre-#1923 match-only control — proves the pattern can go red)`);
}

test("Step 1.5's /flow pipeline branch gates the proceed decision on verifiedHead: true, not bare match", () => {
  assertPinned(/verifiedHead: true[\s\S]{0,260}proceed to Step 2/, 'verifiedHead: true routes to proceed');
});

test("Step 1.5's /flow pipeline branch gates the re-trigger decision on verifiedHead: false (with TEST_PASSED=true), not bare match: false", () => {
  assertPinned(/`verifiedHead: false` with `TEST_PASSED=true` is reported, never silently accepted/, 'verifiedHead: false + TEST_PASSED=true is the reported/re-trigger condition');
});

test("Step 1.5's runner-stamp read prints a verifiedHead field distinct from bare match", () => {
  assertPinned(/\{present, sha, head, dirty, scope, fullSha, match, verifiedHead, reportPath, legacy\}/, 'the printed stamp-status envelope carries both match and verifiedHead as distinct fields');
});

test("Step 1.5 states why match alone is insufficient (would re-trigger a scoped run forever), citing #1923", () => {
  assertPinned(/match` alone would re-trigger a scoped run forever, #1923/, 'cites the #1923 rationale for gating on verifiedHead instead of match');
});

test("Step 1.5's own Gate table rows key on verifiedHead for both the pipeline proceed and re-trigger outcomes", () => {
  assert.match(CODE_MODE_STEPS, /`TEST_PASSED=true` \(pipeline\) \+ runner stamp `verifiedHead: true` \| Proceed to Step 2/, 'Gate table proceed row keys on verifiedHead: true');
  assert.match(CODE_MODE_STEPS, /`TEST_PASSED=true` \(pipeline\) \+ runner stamp `verifiedHead: false` \| Report it/, 'Gate table re-trigger row keys on verifiedHead: false');
});
