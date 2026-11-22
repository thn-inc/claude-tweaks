'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const { extractFingerprint } = require('../../../plugin/bin/lib/issues/record');
const { sweepCli } = require('../../helpers/health-sweep-cli');
const { cleanGitEnv } = require('../../helpers/git-fixtures');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'code-health.js');

function tmp() {
  return scratchDir('codehealth-vf-');
}

// In-process (#5381), with the file-protocol-only git guard and a throwaway real cwd — see tests/helpers/health-sweep-cli.js.
function runValidateFindings(root, findingsFile, extraArgs = [], opts = {}) {
  return sweepCli(CLI, ['validate-findings', findingsFile, '--root', root, ...extraArgs], opts);
}

function validFinding(overrides = {}) {
  return {
    criterion: 'simplification',
    areaId: 'src/api',
    anchor: 'src/api/user.js#getUser',
    severity: 'medium',
    confidence: 'high',
    likelihood: 'medium',
    effort: 'medium',
    title: 'getUser is a passthrough',
    evidence: 'getUser delegates directly to UserRepository.find with no added logic.',
    suggestedApproach: 'Inline the call or add caching.',
    acceptance: 'getUser adds caching or is removed.',
    ...overrides,
  };
}

test('validate-findings: valid finding emits one payload on stdout', () => {
  const root = tmp();
  const f = validFinding({ severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));

  const result = runValidateFindings(root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-basic']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);

  const payloads = JSON.parse(result.stdout);
  assert.ok(Array.isArray(payloads), 'stdout must be a JSON array');
  assert.strictEqual(payloads.length, 1, 'expected 1 payload');
  assert.ok(payloads[0].title === f.title, 'title mismatch');
  assert.ok(Array.isArray(payloads[0].labels), 'labels must be an array');
  assert.ok(payloads[0].labels.includes('by:code-health'), 'missing by:code-health label');
  assert.ok(payloads[0].labels.includes('ready'), 'missing ready label (born-ready)');
  assert.ok(payloads[0].labels.some((l) => l.startsWith('risk:')), 'missing risk:<tier> label');
  assert.ok(payloads[0].labels.some((l) => l.startsWith('size:')), 'missing size:<tier> label');
  assert.strictEqual(payloads[0].type, 'task', 'type must be task');
  assert.ok(payloads[0].body.includes('<!-- work-fingerprint: codehealth-'), 'fingerprint marker missing');
});

test('validate-findings: malformed finding is dropped with a stderr reason, valid ones survive', () => {
  const root = tmp();
  const malformed = { criterion: 'simplification', severity: 'medium' }; // missing required fields
  const good = validFinding({
    criterion: 'dead-code', anchor: 'src/util.js#trimPath', title: 'trimPath is unused', severity: 'high',
  });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([malformed, good]));

  const result = runValidateFindings(root, findingsFile, ['--slice', 'src/util', '--run-id', 'r-malformed']);
  assert.strictEqual(result.status, 0);

  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'only the valid finding should survive');
  assert.ok(result.stderr.includes('dropped'), `expected "dropped" in stderr: ${result.stderr}`);
});

test('validate-findings: --dry-run emits payloads but does not write cache', () => {
  const root = tmp();
  const f = validFinding({ severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));

  const result = runValidateFindings(root, findingsFile, ['--dry-run']);
  assert.strictEqual(result.status, 0);

  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1);
  assert.strictEqual(
    fs.existsSync(path.join(root, '.claude-tweaks', 'code-health', 'cache.json')),
    false,
    'cache must not be written in dry-run',
  );
});

test('validate-findings: finding already open in issue index is skipped (dedup)', () => {
  const root = tmp();
  const f = validFinding({ severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));

  // First run to learn the fingerprint.
  const firstResult = runValidateFindings(root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-dedup-1']);
  const firstPayloads = JSON.parse(firstResult.stdout);
  assert.strictEqual(firstPayloads.length, 1);
  const fp = firstPayloads[0].body.match(/<!--\s*work-fingerprint:\s*(codehealth-[0-9a-f]{8})\s*-->/)[1];

  // Build an issue index pretending the fingerprint is already open.
  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([{ number: 1, state: 'open', labels: ['by:code-health'], fingerprint: fp }]));

  const secondResult = runValidateFindings(
    root, findingsFile, ['--issues', issuesFile, '--slice', 'src/api', '--run-id', 'r-dedup-2'],
  );
  assert.strictEqual(secondResult.status, 0);
  const secondPayloads = JSON.parse(secondResult.stdout);
  assert.strictEqual(secondPayloads.length, 0, 'open finding must be skipped (dedup)');
});

test('validate-findings: a wontfix-labelled match is suppressed AND persisted to cache as wontfix', () => {
  const root = tmp();
  const f = validFinding({ severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));

  // First run to learn the fingerprint.
  const firstResult = runValidateFindings(root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-wontfix-1']);
  const firstPayloads = JSON.parse(firstResult.stdout);
  const fp = firstPayloads[0].body.match(/<!--\s*work-fingerprint:\s*(codehealth-[0-9a-f]{8})\s*-->/)[1];

  // Build an issue index pretending the matching issue was closed wontfix.
  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([{ number: 7, state: 'closed', labels: ['by:code-health', 'wontfix'], fingerprint: fp }]));

  const secondResult = runValidateFindings(
    root, findingsFile, ['--issues', issuesFile, '--slice', 'src/api', '--run-id', 'r-wontfix-2'],
  );
  assert.strictEqual(secondResult.status, 0, `stderr: ${secondResult.stderr}`);
  const secondPayloads = JSON.parse(secondResult.stdout);
  assert.strictEqual(secondPayloads.length, 0, 'wontfix match must be suppressed, not re-filed');

  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'code-health', 'cache.json'), 'utf8'));
  assert.strictEqual(cache[fp].status, 'wontfix', 'wontfix suppression must be persisted to cache so the offline (gh-unavailable) dedup fallback can find it');
  assert.strictEqual(cache[fp].issue, 7);
});

test('validate-findings: a cache-only wontfix (no gh issue index) still suppresses on a later run', () => {
  const root = tmp();
  const f = validFinding({ severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));

  const firstResult = runValidateFindings(root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-cache-wontfix-1']);
  const firstPayloads = JSON.parse(firstResult.stdout);
  const fp = firstPayloads[0].body.match(/<!--\s*work-fingerprint:\s*(codehealth-[0-9a-f]{8})\s*-->/)[1];

  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([{ number: 7, state: 'closed', labels: ['wontfix'], fingerprint: fp }]));
  runValidateFindings(root, findingsFile, ['--issues', issuesFile, '--slice', 'src/api', '--run-id', 'r-cache-wontfix-2']);

  // Third run with NO issues file (simulating gh being unavailable) must still suppress,
  // because the cache alone now carries status:'wontfix' for this fingerprint.
  const thirdResult = runValidateFindings(root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-cache-wontfix-3']);
  assert.strictEqual(thirdResult.status, 0, `stderr: ${thirdResult.stderr}`);
  const thirdPayloads = JSON.parse(thirdResult.stdout);
  assert.strictEqual(thirdPayloads.length, 0, 'cache-only wontfix must suppress re-filing even when gh/issue-index is unavailable');
});

test('validate-findings: malformed --issues file warns on stderr and falls back to cache-only dedup', () => {
  const root = tmp();
  const f = validFinding({ severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));
  const badIssuesFile = path.join(root, 'bad-issues.json');
  fs.writeFileSync(badIssuesFile, 'not valid json{{{');

  const result = runValidateFindings(root, findingsFile, ['--issues', badIssuesFile, '--slice', 'src/api', '--run-id', 'r-bad-issues']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('could not read or parse --issues file'), `expected a warning in stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'must still file the finding, just without issue-based dedup');
});

test('validate-findings: a malformed --issues array element (e.g. null) is skipped, not a crash', () => {
  const root = tmp();
  const f = validFinding({ severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));
  const issuesFile = path.join(root, 'issues-with-null.json');
  fs.writeFileSync(issuesFile, JSON.stringify([null, { number: 1, state: 'open', labels: [], fingerprint: 'zzz' }]));

  const result = runValidateFindings(root, findingsFile, ['--issues', issuesFile, '--slice', 'src/api', '--run-id', 'r-null-issue']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('skipping malformed issue entry'), `expected a skip warning in stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'the well-formed finding must still file despite a malformed --issues entry');
});

test('validate-findings: exits non-zero when findings file is missing', () => {
  const root = tmp();
  const result = runValidateFindings(
    root, path.join(root, 'nonexistent.json'), ['--slice', 'src/api', '--run-id', 'r-missing-file'],
  );
  assert.strictEqual(result.status, 1, 'should exit 1 for missing/unparsable findings file');
  assert.ok(result.stderr.includes('could not read or parse'), `expected file-read error in stderr: ${result.stderr}`);
});

test('validate-findings: writes cache after a non-dry-run', () => {
  const root = tmp();
  const f = validFinding();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));

  const result = runValidateFindings(root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-cache']);
  assert.strictEqual(result.status, 0);
  assert.ok(
    fs.existsSync(path.join(root, '.claude-tweaks', 'code-health', 'cache.json')),
    'cache must be written after a non-dry-run',
  );
});

// P2 additions: confidence-floor gate
const { applyConfidenceFloor } = require('../../../plugin/bin/lib/code-health/validate-finding');

test('applyConfidenceFloor passes a high-confidence finding for a high-floor criterion', () => {
  const result = applyConfidenceFloor({ confidence: 'high' }, 'high');
  assert.strictEqual(result.pass, true);
});

test('applyConfidenceFloor drops a medium-confidence finding for a high-floor criterion', () => {
  const result = applyConfidenceFloor({ confidence: 'medium' }, 'high');
  assert.strictEqual(result.pass, false);
  assert.ok(result.reason.includes('below floor'));
});

test('applyConfidenceFloor drops a low-confidence finding for a medium-floor criterion', () => {
  const result = applyConfidenceFloor({ confidence: 'low' }, 'medium');
  assert.strictEqual(result.pass, false);
});

test('applyConfidenceFloor passes a low-confidence finding for a low-floor criterion', () => {
  const result = applyConfidenceFloor({ confidence: 'low' }, 'low');
  assert.strictEqual(result.pass, true);
});

test('applyConfidenceFloor passes when criterionFloor is undefined (no floor set)', () => {
  const result = applyConfidenceFloor({ confidence: 'low' }, undefined);
  assert.strictEqual(result.pass, true);
});

// ── Cursor + run-log persistence (Commit 1) ──────────────────────────────────
//
// Cursors and run-logs are now durable (health-state branch), not local disk
// (readRuns/recordRun no longer exist — see bin/lib/code-health/cache.js).
// The write path (gh api blob/tree/commit/ref calls) requires a real
// GitHub-hosted remote + gh auth to actually persist, which this sandboxed
// test's tmp root doesn't have — cmdValidateFindings's writeDurableState call
// is wrapped in a try/catch specifically so that failure is non-fatal (see
// bin/code-health.js's step-4 comment), so what's left to verify here at the
// CLI level is that a real run with --slice still succeeds and still emits
// its payload/cache side effects even when durable persistence can't
// complete. That means NONE of the tests below ever actually invoke the
// writeDurableState mutator (they all fail its `git fetch origin
// health-state` first, same as every test in this file) — despite an earlier
// version of this comment implying full coverage existed elsewhere. What IS
// exercised for real, without gh, via a locally-seeded health-state branch:
// the read side of cursor/run persistence, in
// tests/bin-lib/code-health/cli-nextslice.test.js (cursors) and
// tests/bin-lib/code-health/churn-v2.test.js (runs); and the write path's own
// git/gh mechanics (blob/tree/commit/ref calls), via trivial synthetic
// mutators, in tests/bin-lib/health-core/durable-state.test.js's fake-runner
// tests. Neither of those covers the actual per-run merge semantics
// (selective per-swept-area cursor update, remembered-delta merge, run
// append) that cmdValidateFindings's mutator performs — that logic is now
// extracted as the pure buildValidateFindingsUpdate (bin/lib/code-health/cache.js)
// and unit tested directly in
// tests/bin-lib/code-health/build-validate-findings-update.test.js.
test('validate-findings: a real run with --slice still succeeds when durable persistence cannot complete', () => {
  const root = tmp();
  // Use areaId '.' so the slice path is root itself (which exists).
  const f = validFinding({ areaId: '.', anchor: 'index.js#module', severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  // Write a source file so contentHash has something to hash.
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = 1;\n');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));

  const result = runValidateFindings(root, findingsFile, ['--slice', '.', '--run-id', 'test-run-1']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);

  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'high severity must still file even though durable persistence is unreachable here');

  // cursors.json/runs/ are no longer written to local disk at all.
  assert.strictEqual(
    fs.existsSync(path.join(root, '.claude-tweaks', 'code-health', 'cursors.json')),
    false,
    'cursors are durable now — no local cursors.json is ever written',
  );
});

// REGRESSION: writeCache(root, cache) used to be unguarded by a try/catch,
// unlike the immediately-following writeDurableState call (which is
// explicitly wrapped and treated as non-fatal — cache.json's own header
// comment describes it as "rebuildable from `gh issue list`", so a local
// write failure must not crash the whole run before payloads are emitted.
// Force writeCache to throw by putting a plain FILE where the cache's parent
// directory (.claude-tweaks/code-health/) needs to exist, so
// fs.mkdirSync(..., { recursive: true }) fails with ENOTDIR.
test('validate-findings: a real run still emits payloads on stdout when the local cache write fails (unwritable cache dir)', () => {
  const root = tmp();
  const f = validFinding({ areaId: '.', anchor: 'index.js#module', severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = 1;\n');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));

  // Pre-create .claude-tweaks/code-health as a FILE, not a directory, so
  // writeCache's mkdirSync(dirname(cachePath), { recursive: true }) throws.
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'code-health'), 'not a directory');

  const result = runValidateFindings(root, findingsFile, ['--slice', '.', '--run-id', 'test-run-cache-fail']);
  assert.strictEqual(result.status, 0, `must not crash: stderr=${result.stderr}`);

  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'payload must still be emitted even though the local cache write failed');
  assert.ok(
    result.stderr.includes('cache write failed') || result.stderr.includes('non-fatal'),
    `expected a non-fatal warning about the cache write failure in stderr: ${result.stderr}`,
  );
});

test('validate-findings: --dry-run with --slice writes neither cursors nor cache', () => {
  const root = tmp();
  const f = validFinding({ areaId: '.', anchor: 'index.js#module' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = 1;\n');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));

  const result = runValidateFindings(root, findingsFile, ['--slice', '.', '--run-id', 'test-run-2', '--dry-run']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);

  assert.strictEqual(
    fs.existsSync(path.join(root, '.claude-tweaks', 'code-health', 'cursors.json')),
    false,
    'cursors.json must NOT be written in dry-run',
  );
  assert.strictEqual(
    fs.existsSync(path.join(root, '.claude-tweaks', 'code-health', 'cache.json')),
    false,
    'cache.json must NOT be written in dry-run',
  );
});

// The original version of this test recorded a slice via validate-findings
// (a real write through writeDurableState) and then asserted next-slice
// skipped it (a real read through readDurableState) — proving the two
// commands round-trip through the same persisted cursor. That write leg now
// requires a real GitHub-hosted remote + gh auth (see the comment above),
// which isn't available in this sandboxed suite, so the round-trip can't be
// exercised end-to-end here. The read leg (next-slice skipping a slice whose
// durable cursor already shows an unchanged hash) is still verified for real,
// without gh, via a locally-seeded health-state branch: see
// 'next-slice returns null when the only slice has an unchanged hash' in
// tests/bin-lib/code-health/cli-nextslice.test.js.

// ── Risk filter (min-risk) ────────────────────────────────────────────────────

test('validate-findings: default min-risk is high — a medium finding is remembered, not filed', () => {
  const root = tmp();
  const f = validFinding({ severity: 'medium' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));

  const result = runValidateFindings(root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-med']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 0, 'medium severity must not file under the default (high) threshold');

  // 'remember' decisions no longer touch the local cache.json at all — they
  // move to the durable remembered store (bin/lib/code-health/cache.js's
  // readDurableState/writeDurableState). Local cache.json stays empty for a
  // remembered-only run.
  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'code-health', 'cache.json'), 'utf8'));
  assert.deepStrictEqual(cache, {}, 'a remembered finding must not be persisted to the local cache.json');
});

test('validate-findings: high severity still files under the default threshold', () => {
  const root = tmp();
  const f = validFinding({ severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));

  const result = runValidateFindings(root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-high']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'high severity must file under the default threshold');
});

test('validate-findings: --min-risk medium lowers the bar and files a medium-risk finding', () => {
  const root = tmp();
  const f = validFinding({ severity: 'medium', likelihood: 'medium' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));

  const result = runValidateFindings(
    root, findingsFile,
    ['--slice', 'src/api', '--run-id', 'r-min-med', '--min-risk', 'medium'],
  );
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'medium-risk finding must file when --min-risk medium is passed');
});

// ── Persistence hardening: --slice required for a real run ──────────────────

test('validate-findings: exits 2 when --slice is missing on a non-dry-run call', () => {
  const root = tmp();
  const f = validFinding({ severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));

  const result = runValidateFindings(root, findingsFile, ['--run-id', 'r-no-slice']);
  assert.strictEqual(result.status, 2, `expected exit 2, got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('--slice'), `expected --slice mentioned in stderr: ${result.stderr}`);
});

test('validate-findings: --dry-run without --slice still succeeds (preview mode unaffected)', () => {
  const root = tmp();
  const f = validFinding({ severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));

  const result = runValidateFindings(root, findingsFile, ['--dry-run']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1);
});

// ── Guard against unrecognized --min-risk values ──────────────────────────────

test('validate-findings: exits 2 when --min-risk is an unrecognized value', () => {
  const root = tmp();
  const f = validFinding({ severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));
  const result = runValidateFindings(
    root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-bad-sev', '--min-risk', 'hgih'],
  );
  assert.strictEqual(result.status, 2, `expected exit 2, got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('--min-risk'), `expected --min-risk mentioned in stderr: ${result.stderr}`);
});

test('validate-findings: a recognized --min-risk value still works normally', () => {
  const root = tmp();
  const f = validFinding({ severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));
  const result = runValidateFindings(
    root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-good-sev', '--min-risk', 'low'],
  );
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'high-risk finding must still file with a valid --min-risk value');
});

// Regression: the guard used `!(value in RISK_RANK)` against the plain
// object literal { high, medium, low }. `in` walks the prototype chain, so
// any Object.prototype property name (constructor, toString,
// hasOwnProperty, ...) passed validation as if it were a real risk tier —
// then RISK_RANK['constructor'] read the Object constructor function
// instead of a number, the rank comparison was never true, and every
// finding (including a risk: "high" one) silently resolved to 'remember'
// instead of 'file'.
test('validate-findings: exits 2 when --min-risk is an Object.prototype property name', () => {
  const root = tmp();
  const f = validFinding({ severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));
  const result = runValidateFindings(
    root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-proto-pollution', '--min-risk', 'constructor'],
  );
  assert.strictEqual(result.status, 2, `expected exit 2, got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('--min-risk'), `expected --min-risk mentioned in stderr: ${result.stderr}`);
});

// #1700: gh-absent (MCP) transport dedup. The GitHub MCP server's read path strips every
// `<!-- ... -->` span from a fetched issue body (the same sanitization
// `_shared/pr-early-run-lifecycle.md` documents for PR reads, extended to issue reads) — before
// the fix, this left `extractFingerprint` with nothing to match on an MCP-fetched body, so
// `loadIssueIndex` built an index with every fingerprint null and a re-encountered finding
// re-filed as a duplicate on every gh-absent (cloud Routine) firing. This test builds the
// `--issues` index the way the real GATHER OPEN ISSUES step's gh-absent MCP projection would —
// from a body with every HTML-comment span stripped, recovering the fingerprint via the
// plain-text `work-fingerprint:` companion line only — and proves the second firing suppresses
// the identical finding instead of re-filing it.
test('validate-findings: gh-absent MCP transport — an HTML-comment-stripped body still dedups via the plain-text work-fingerprint companion (#1700)', () => {
  const root = tmp();
  const f = validFinding({ severity: 'high' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));

  // First run (gh-present shape, unstripped) to learn the real filed body.
  const firstResult = runValidateFindings(root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-mcp-1']);
  const firstPayloads = JSON.parse(firstResult.stdout);
  assert.strictEqual(firstPayloads.length, 1);
  const filedBody = firstPayloads[0].body;
  const fp = extractFingerprint(filedBody);
  assert.ok(fp, 'the filed body must carry an extractable fingerprint');

  // Simulate the gh-absent MCP projection step: every HTML-comment span is stripped from the
  // fetched body -- only the plain-text companion line survives.
  const mcpStrippedBody = filedBody.replace(/<!--[\s\S]*?-->\n?/g, '');
  assert.ok(!mcpStrippedBody.includes('<!--'), 'test fixture must actually simulate HTML-comment stripping');
  const projectedFingerprint = extractFingerprint(mcpStrippedBody);
  assert.strictEqual(
    projectedFingerprint, fp,
    'extractFingerprint must recover the same fingerprint from the MCP-stripped body via the plain-text companion',
  );

  // Build the { number, state, labels, fingerprint } shape the GATHER OPEN ISSUES step writes
  // for --issues, using the fingerprint recovered from the stripped body -- never the
  // pre-known one, since that would exercise nothing new.
  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([
    { number: 42, state: 'open', labels: ['by:code-health'], fingerprint: projectedFingerprint },
  ]));

  // A second firing of the identical finding against the gh-absent-shaped index must be
  // suppressed rather than re-filed.
  const secondResult = runValidateFindings(
    root, findingsFile, ['--issues', issuesFile, '--slice', 'src/api', '--run-id', 'r-mcp-2'],
  );
  assert.strictEqual(secondResult.status, 0, `stderr: ${secondResult.stderr}`);
  const secondPayloads = JSON.parse(secondResult.stdout);
  assert.strictEqual(
    secondPayloads.length, 0,
    'identical finding must be suppressed, not re-filed, once dedup uses the MCP-recovered fingerprint',
  );
});

// Real-process pin of the script entry (#5381): a dry-run success prints the payload array on
// stdout and the run summary on stderr, byte-identical before and after the entry conversion.
test('AC7.1: validate-findings --dry-run on a valid finding exits 0 and prints the payload array (real process)', () => {
  const { spawnCli } = require('../../helpers/run-cli');
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding({ severity: 'high' })]));

  const env = { ...cleanGitEnv(process.env), LC_ALL: 'C', LANG: 'C' };
  const r = spawnCli(CLI, ['validate-findings', findingsFile, '--root', root, '--dry-run', '--run-id', 'fixed-run'], { env, cwd: root });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(
    r.stdout,
    '[\n  {\n    "title": "getUser is a passthrough",\n    "body": "**Criterion:** simplification | **Risk:** high | **Severity:** high | **Likelihood:** medium | **Effort:** medium | **Confidence:** high | **Area:** src/api\\n\\n## Current State\\n\\nAnchor: `src/api/user.js#getUser`\\n\\ngetUser delegates directly to UserRepository.find with no added logic.\\n\\n## Deliverables\\n\\nInline the call or add caching.\\n\\n## Acceptance Criteria\\n\\ngetUser adds caching or is removed.\\n\\n## Release Note\\n\\nNo user-visible change — internal code-quality fix.\\n\\n## Technical Approach\\n\\n### Key Files\\n\\n- `src/api/user.js` — address the finding at this anchor\\n\\n_Filed by `/claude-tweaks:code-health`. Close to resolve; label `wontfix` to suppress future reports of this finding._\\n\\n<!-- work-fingerprint: codehealth-a7f87202 -->\\nwork-fingerprint: codehealth-a7f87202",\n    "labels": [\n      "by:code-health",\n      "risk:high",\n      "size:medium",\n      "ready"\n    ],\n    "type": "task"\n  }\n]\n',
  );
  // Only the CLI-owned summary line is pinned; git's own stderr text varies by version, locale and checkout.
  assert.ok(
    r.stderr.split('\n').includes('[code-health] validate-findings fixed-run: 1 valid finding(s), 1 payload(s) after dedup'),
    `expected the summary line in stderr: ${r.stderr}`,
  );
});

// ── in-process entry (#5381) ────────────────────────────────────────────────

// No --root, and a findings path relative to the injected cwd: the root and the findings file
// both resolve against it. A non-dry-run with --slice '.' writes cache.json under the root, so
// the cache landing in the injected cwd proves the root default too.
test('AC8.1: validate-findings without --root and with a relative findings path reads and writes under the injected cwd', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(root, 'findings.json'), JSON.stringify([validFinding({ areaId: '.', anchor: 'index.js#module', severity: 'high' })]));

  const result = sweepCli(CLI, ['validate-findings', 'findings.json', '--slice', '.', '--run-id', 'r-cwd'], { cwd: root });
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(JSON.parse(result.stdout).length, 1);
  assert.ok(
    fs.existsSync(path.join(root, '.claude-tweaks', 'code-health', 'cache.json')),
    'the cache must be written under the injected cwd, the default root',
  );
});

// The exit code is returned, never read from or written to process.exitCode.
test('AC2.1: validate-findings returns 0 on a valid findings file when process.exitCode is already 1', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding({ severity: 'high' })]));

  const prior = process.exitCode;
  process.exitCode = 1;
  let result;
  try {
    result = runValidateFindings(root, findingsFile, ['--dry-run']);
  } finally {
    process.exitCode = prior;
  }
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.ok(Array.isArray(payloads), 'stdout must be a JSON array');
  assert.strictEqual(payloads.length, 1);
});

// env-only fixture: resolveReadCommit's git child sees the injected env, so a GIT_DIR that only
// the injected env carries (root itself is not a repo) decides the Verified-as-of: line. The
// fixture's own setup git calls and the injected env are stripped of the ambient git variables.
test('validate-findings stamps Verified-as-of from the injected env: GIT_DIR names the repo, root is not one', () => {
  const root = tmp(); // not a git repo
  const repo = tmp();
  const setup = { env: cleanGitEnv(process.env) };
  execFileSync('git', ['init', '-q'], { cwd: repo, ...setup });
  execFileSync('git', ['-C', repo, '-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '--allow-empty', '-m', 'seed'], setup);
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8', ...setup }).trim();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding({ severity: 'high' })]));

  const result = runValidateFindings(root, findingsFile, ['--dry-run'], { env: { GIT_DIR: path.join(repo, '.git') } });
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const [payload] = JSON.parse(result.stdout);
  assert.ok(payload.body.includes(`Verified-as-of: ${sha}`), `expected the injected repo's HEAD ${sha}, got body:\n${payload.body}`);
});

test('AC5.1: an --issues file in gh\'s raw shape — a CLOSED match with no wontfix label reopens and is cached as regressed', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding({ severity: 'high' })]));
  const first = runValidateFindings(root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-raw-reopen-1']);
  const fp = JSON.parse(first.stdout)[0].body.match(/<!--\s*work-fingerprint:\s*(codehealth-[0-9a-f]{8})\s*-->/)[1];

  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([{
    number: 8, state: 'CLOSED', fingerprint: fp,
    labels: [{ id: 'LA_1', name: 'by:code-health', color: 'ededed', description: '' }],
  }]));
  const second = runValidateFindings(root, findingsFile, ['--issues', issuesFile, '--slice', 'src/api', '--run-id', 'r-raw-reopen-2']);
  assert.strictEqual(second.status, 0, `stderr: ${second.stderr}`);
  assert.strictEqual(JSON.parse(second.stdout).length, 1, 'a closed non-wontfix match must emit a reopen payload');
  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'code-health', 'cache.json'), 'utf8'));
  assert.strictEqual(cache[fp].status, 'regressed');
  assert.strictEqual(cache[fp].issue, 8);
});

test('AC5.2: an --issues file in gh\'s raw shape — a wontfix label object suppresses and is cached as wontfix', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding({ severity: 'high' })]));
  const first = runValidateFindings(root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-raw-wontfix-1']);
  const fp = JSON.parse(first.stdout)[0].body.match(/<!--\s*work-fingerprint:\s*(codehealth-[0-9a-f]{8})\s*-->/)[1];

  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([{
    number: 7, state: 'CLOSED', fingerprint: fp,
    labels: [{ id: 'LA_1', name: 'by:code-health' }, { id: 'LA_2', name: 'wontfix' }],
  }]));
  const second = runValidateFindings(root, findingsFile, ['--issues', issuesFile, '--slice', 'src/api', '--run-id', 'r-raw-wontfix-2']);
  assert.strictEqual(second.status, 0, `stderr: ${second.stderr}`);
  assert.strictEqual(JSON.parse(second.stdout).length, 0, 'a wontfix label object must suppress');
  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'code-health', 'cache.json'), 'utf8'));
  assert.strictEqual(cache[fp].status, 'wontfix');
  assert.strictEqual(cache[fp].issue, 7);
});
