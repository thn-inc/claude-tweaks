// tests/design-wrapper-caller-precheck.test.js — #657: pins the caller-side pre-check that
// lets `/claude-tweaks:test` and `/claude-tweaks:review` decide, via `bin/design-detect.js`
// (the wrapper's own deterministic Layers 1-3 twin), whether `/claude-tweaks:design-wrapper`
// would no-op — before ever invoking Skill(claude-tweaks:design-wrapper) and paying for its
// SKILL.md load. Two things pinned: (1) the shared contract lives once in
// `_shared/design-wrapper-handling.md` and both callers cite it rather than restating the
// bash invocation; (2) a live run of the actual CLI against this repo's own CLAUDE.md (which
// carries no `design-integration:` field) reproduces the exact synthetic backend-only scenario
// the record's Acceptance Criteria names, proving the pre-check would really skip the
// Skill() call rather than merely asserting prose intent.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const read = (...p) => readText(path.join(SKILLS, ...p));

const HANDLING = read('_shared', 'design-wrapper-handling.md');
const DESIGN_GATE = read('test', 'design-gate.md');
const REVIEW_STEPS = read('review', 'code-mode-steps.md');
const DESIGN_DETECT_CLI = path.join(ROOT, 'plugin', 'bin', 'design-detect.js');

test('design-wrapper-handling.md defines the Caller-side pre-check section, citing the real CLI path', () => {
  assert.match(HANDLING, /^## Caller-side pre-check/m);
  assert.match(HANDLING, /bin\/design-detect\.js.*--mode <mode>/);
  assert.match(HANDLING, /"decision":\s*"skip"/);
  assert.match(HANDLING, /"decision":\s*"proceed"/);
});

test("test/design-gate.md's Invocation cites the shared pre-check instead of restating it, with --mode test", () => {
  assert.match(DESIGN_GATE, /Caller-side pre-check/);
  assert.match(DESIGN_GATE, /--mode test/);
  assert.doesNotMatch(
    DESIGN_GATE,
    /node\s+"\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/design-detect\.js"/,
    'the bash invocation itself lives once in design-wrapper-handling.md — design-gate.md should cite it, not restate the command',
  );
});

test("review/code-mode-steps.md's Step 6.5 Invocation cites the shared pre-check, with --mode review", () => {
  assert.match(REVIEW_STEPS, /Caller-side pre-check/);
  assert.match(REVIEW_STEPS, /--mode review/);
});

test('live: the CLI skips on this project\'s own synthetic backend-only scenario (AC1)', () => {
  // This repo's own CLAUDE.md carries no `design-integration:` field (only an unrelated
  // `diagram-suggestions:` key under the same "## Design integration" heading) — the exact
  // "backend surface, no design-integration field" scenario the record's first Acceptance
  // Criterion names. A live run against the real CLI (no stubbing) proves the pre-check would
  // really return decision: "skip" for it, not just that the prose claims it would.
  const out = execFileSync(
    process.execPath,
    [DESIGN_DETECT_CLI, '--mode', 'test', '--surface', 'backend', '--files', ''],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const result = JSON.parse(out);
  assert.equal(result.decision, 'skip');
  assert.equal(result.reason, 'design integration not configured (run /claude-tweaks:init to enable)');
});

test('live: the CLI proceeds for a frontend surface even with this project\'s own CLAUDE.md (AC2, first half)', () => {
  // AC2 requires the short-circuit to never suppress a genuinely frontend-surfaced record.
  // Layer 1 needs the kill-switch enabled (this project's own CLAUDE.md has no
  // design-integration field, so it's passed explicitly here) and Layer 3 needs at least one
  // trigger-extension file in the changed set — an empty --files list would itself fail Layer 3
  // regardless of surface, which is not what this test is proving.
  const out = execFileSync(
    process.execPath,
    [DESIGN_DETECT_CLI, '--mode', 'test', '--surface', 'web', '--files', 'src/components/Foo.tsx', '--design-integration', 'enabled'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const result = JSON.parse(out);
  assert.equal(result.decision, 'proceed');
});

test('live: the CLI still skips a backend surface even when design-integration is explicitly enabled (AC2, second half — never a broader heuristic)', () => {
  const out = execFileSync(
    process.execPath,
    [DESIGN_DETECT_CLI, '--mode', 'test', '--surface', 'backend', '--files', '', '--design-integration', 'enabled'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const result = JSON.parse(out);
  assert.equal(result.decision, 'skip');
  assert.equal(result.reason, 'non-frontend spec (surface declared)');
});
