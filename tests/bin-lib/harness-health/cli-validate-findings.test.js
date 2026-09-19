'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { seedDurableState } = require('../health-core/seed-durable-state');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'harness-health.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-health-vf-')); }

function runValidateFindings(root, findingsFile, extraArgs = []) {
  return spawnSync('node', [CLI, 'validate-findings', findingsFile, '--root', root, ...extraArgs], { encoding: 'utf8' });
}

// recordRun/readRuns (local-disk run-log persistence) were removed by the
// health-state migration — run history now lives on the durable
// health-state branch (bin/lib/health-core/durable-state.js), not local
// disk. Its write path (gh api blob/tree/commit/ref calls) requires live
// GitHub credentials; the read path is pure git plumbing (fetch + show), so
// it's exercised for real below via a local bare git remote seeded directly
// with runs.json (no gh/network needed) — the same technique
// tests/bin-lib/harness-health/cli-next-target.test.js's seedDurableCursors
// uses for cursors, and tests/bin-lib/code-health/churn-v2.test.js uses for
// its own runs.json.
function seedDurableRuns(root, runs) {
  const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-health-vf-bare-'));
  execFileSync('git', ['init', '--bare', '-q', bareDir]);
  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-health-vf-seed-'));
  execFileSync('git', ['init', '-q', seedDir]);
  execFileSync('git', ['-C', seedDir, 'checkout', '-q', '-b', 'health-state']);
  fs.mkdirSync(path.join(seedDir, 'harness-health'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'harness-health', 'runs.json'), JSON.stringify(runs));
  execFileSync('git', ['-C', seedDir, 'add', '-A']);
  execFileSync(
    'git',
    ['-C', seedDir, '-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'seed'],
  );
  execFileSync('git', ['-C', seedDir, 'push', '-q', bareDir, 'health-state']);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', bareDir], { cwd: root });
}

function validFinding(overrides = {}) {
  return {
    kind: 'patch',
    target: 'auth',
    assetType: 'skill',
    category: 'drift',
    section: 'Key Patterns',
    classification: 'restructural',
    confidence: 'high',
    reversibility: 'med',
    description: 'Stale example path',
    oldString: 'See `src/auth/login.js`.',
    newString: 'See `src/auth/session.js`.',
    reason: 'login.js was renamed to session.js.',
    ...overrides,
  };
}

test('validate-findings: valid finding emits one payload on stdout', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);

  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1);
  assert.ok(payloads[0].labels.includes('by:harness-health'));
  assert.ok(payloads[0].labels.includes('ready'));
  assert.ok(payloads[0].labels.includes('risk:medium'), 'restructural finding must carry risk:medium');
  assert.ok(payloads[0].labels.includes('size:high'), 'restructural finding must carry size:high');
  assert.strictEqual(payloads[0].type, 'task');
  assert.ok(payloads[0].body.includes('<!-- work-fingerprint: harnesshealth-'));
  assert.ok(!payloads[0].body.includes('harness-health-fingerprint'), 'legacy marker must not be emitted');
});

test('validate-findings: malformed finding is dropped with a stderr reason, valid ones survive', () => {
  const root = tmp();
  const malformed = { kind: 'patch', target: 'auth' }; // missing required fields
  const good = validFinding({ target: 'billing', description: 'other issue' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([malformed, good]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'billing', '--kind', 'skill']);
  assert.strictEqual(result.status, 0);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1);
  assert.ok(result.stderr.includes('dropped'));
});

test('validate-findings: --dry-run emits payloads but writes no state', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const result = runValidateFindings(root, findingsFile, ['--dry-run', '--target', 'auth', '--kind', 'skill', '--gap-scan']);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(JSON.parse(result.stdout).length, 1);
  assert.strictEqual(fs.existsSync(path.join(root, '.claude-tweaks', 'harness-health', 'cache.json')), false);
  assert.strictEqual(fs.existsSync(path.join(root, '.claude-tweaks', 'harness-health', 'cursors.json')), false);
});

// ── Persistence hardening: --target+--kind or --gap-scan required for a real run ──
//
// buildValidateFindingsUpdate only patches an audit cursor when target AND
// kind are both present (or when gapScan is set) — see
// bin/lib/harness-health/cache.js. Without a hard gate, a non-dry-run call
// that omits all three (a flag typo, or a skill-prompt drift) used to still
// write the run record and dedup cache correctly but never advance any
// cursor, so that target would be perpetually re-selected as stale/overdue.
// Mirrors bin/code-health.js's own --slice hard-gate for validate-findings.

test('validate-findings: exits 2 when neither --target/--kind nor --gap-scan is given on a non-dry-run call', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([]));

  const result = runValidateFindings(root, findingsFile);
  assert.strictEqual(result.status, 2, `expected exit 2, got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('--target') && result.stderr.includes('--gap-scan'),
    `expected the gate message in stderr: ${result.stderr}`);
});

test('validate-findings: exits 2 when --target is given without --kind on a non-dry-run call', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'auth']);
  assert.strictEqual(result.status, 2, `expected exit 2, got ${result.status}. stderr: ${result.stderr}`);
});

test('validate-findings: --dry-run without --target/--kind/--gap-scan still succeeds (preview mode unaffected)', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const result = runValidateFindings(root, findingsFile, ['--dry-run']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(JSON.parse(result.stdout).length, 1);
});

// Cursors are now durable (health-state branch), not local disk — a bare
// tmp() root (no git remote at all) means the CLI's writeDurableState call
// necessarily fails its `git fetch origin health-state` first. That failure
// is non-fatal (see bin/harness-health.js's cmdValidateFindings persistence
// block), so what's provable at the CLI level here is that the run still
// succeeds and never writes a local cursors.json, regardless of
// --target/--kind or --gap-scan. The actual cursor-set semantics (namespaced
// key set, gap-scan cursor set, unrelated cursor keys preserved) are unit
// tested directly against the pure mutator in
// tests/bin-lib/harness-health/build-validate-findings-update.test.js; the
// read side (a durable cursor round-tripping back out via next-target) is
// exercised for real via a locally-seeded health-state branch in
// tests/bin-lib/harness-health/cli-next-target.test.js.
test('validate-findings: --target <id> --kind <kind> still succeeds when durable persistence cannot complete, no local cursors.json is ever written', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([])); // an empty array is valid — still attempts the audit-cursor write

  const result = runValidateFindings(root, findingsFile, ['--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(
    fs.existsSync(path.join(root, '.claude-tweaks', 'harness-health', 'cursors.json')),
    false,
    'cursors are durable now — no local cursors.json is ever written',
  );
});

test('validate-findings: --gap-scan still succeeds when durable persistence cannot complete, no local cursors.json is ever written', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([]));

  const result = runValidateFindings(root, findingsFile, ['--gap-scan']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(
    fs.existsSync(path.join(root, '.claude-tweaks', 'harness-health', 'cursors.json')),
    false,
    'cursors are durable now — no local cursors.json is ever written',
  );
});

test('validate-findings: a finding already open in the issue index is skipped (dedup)', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const first = runValidateFindings(root, findingsFile, ['--target', 'auth', '--kind', 'skill']);
  const firstPayloads = JSON.parse(first.stdout);
  const fp = firstPayloads[0].body.match(/<!--\s*work-fingerprint:\s*(harnesshealth-[0-9a-f]{8})\s*-->/)[1];

  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([{ number: 1, state: 'open', labels: ['by:harness-health'], fingerprint: fp }]));

  const second = runValidateFindings(root, findingsFile, ['--issues', issuesFile, '--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(JSON.parse(second.stdout).length, 0, 'open finding must be skipped');
});

test('validate-findings: a malformed --issues file degrades gracefully with a stderr warning, not a hard failure', () => {
  const root = tmp();
  const f = validFinding();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));
  const badIssuesFile = path.join(root, 'bad-issues.json');
  fs.writeFileSync(badIssuesFile, 'not valid json{{{');

  const result = runValidateFindings(root, findingsFile, ['--issues', badIssuesFile, '--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('could not read or parse --issues file'), `expected a warning in stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'must still file the finding, just without issue-based dedup');
});

test('validate-findings: a malformed --issues array element (e.g. null) is skipped, not a crash', () => {
  const root = tmp();
  const f = validFinding();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));
  const issuesFile = path.join(root, 'issues-with-null.json');
  fs.writeFileSync(issuesFile, JSON.stringify([null, { number: 1, state: 'open', labels: [], fingerprint: 'zzz' }]));

  const result = runValidateFindings(root, findingsFile, ['--issues', issuesFile, '--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('skipping malformed issue entry'), `expected a skip warning in stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'the well-formed finding must still file despite a malformed --issues entry');
});

test('validate-findings: exits non-zero when the findings file is missing', () => {
  const root = tmp();
  const result = runValidateFindings(root, path.join(root, 'nonexistent.json'), ['--target', 'auth', '--kind', 'skill']);
  assert.notStrictEqual(result.status, 0);
});

// ── declined marks must survive a fresh (different) container ──
//
// bin/lib/health-core/mark.js's readDurableState/writeDurableState wiring
// (now enabled for harness-health.js's cmdMark) persists a "declined" mark
// to the health-state branch, not just the local gitignored cache.json — but
// that's only half the fix: cmdValidateFindings also has to read it back.
// This test proves the read/merge side (mergeDeclinedIntoCache, wired into
// cmdValidateFindings's readCache) genuinely works end-to-end by seeding the
// health-state branch directly (bypassing `mark`'s own `gh api` write path,
// which needs real GitHub credentials this sandboxed test doesn't have) and
// confirming a *fresh* root — no local cache.json for this fingerprint at
// all, simulating a different, since-recycled scheduled-Routine container —
// still suppresses it, unlike cli-mark.test.js's same-container coverage.
test('validate-findings: a fingerprint declined only on the durable health-state branch (simulating a different, since-recycled Routine container) is still suppressed', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  // Compute the real fingerprint the same way a first run would, without
  // touching git at all yet (bare tmp root => no remote, dry-run writes nothing).
  const first = runValidateFindings(root, findingsFile, ['--dry-run', '--target', 'auth', '--kind', 'skill']);
  const fp = JSON.parse(first.stdout)[0].body.match(/<!--\s*work-fingerprint:\s*(harnesshealth-[0-9a-f]{8})\s*-->/)[1];

  seedDurableState(root, 'harness-health', 'declined.json', { [fp]: { lastSeenMs: Date.now() } }, 'harness-health-vf-declined');

  const second = runValidateFindings(root, findingsFile, ['--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(second.status, 0, `stderr: ${second.stderr}`);
  assert.strictEqual(
    JSON.parse(second.stdout).length,
    0,
    'a durably-declined finding must be suppressed even though this root has no local cache.json for it',
  );
});

// ── --min-confidence: hold sub-floor findings instead of filing them ──

test('validate-findings: --min-confidence med holds a confidence: low finding, never emits its payload', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding({ confidence: 'low' })]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'auth', '--kind', 'skill', '--min-confidence', 'med']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(JSON.parse(result.stdout).length, 0, 'a below-floor finding must never emit a payload');
  assert.ok(result.stderr.includes('1 remembered'), `expected a remembered count in stderr: ${result.stderr}`);
});

test('validate-findings: --min-confidence med still files a confidence: high finding', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding({ confidence: 'high' })]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'auth', '--kind', 'skill', '--min-confidence', 'med']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(JSON.parse(result.stdout).length, 1, 'a confidence: high finding must clear a med floor');
});

test('validate-findings: without --min-confidence, a confidence: low finding still files (backward compatible default)', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding({ confidence: 'low' })]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(JSON.parse(result.stdout).length, 1, 'omitting the flag must preserve the pre-existing no-floor behavior');
});

test('validate-findings: exits 2 for an unrecognized --min-confidence value', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'auth', '--kind', 'skill', '--min-confidence', 'bogus']);
  assert.strictEqual(result.status, 2, `expected exit 2, got ${result.status}. stderr: ${result.stderr}`);
});

test('churn-report: prints "no run logs found" when no runs exist', () => {
  const root = tmp();
  const result = spawnSync('node', [CLI, 'churn-report', '--root', root], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('no run logs found'));
});

// A real validate-findings run's own attempt to persist its run record can no
// longer be observed by re-reading local disk (run history is durable now —
// see seedDurableRuns's comment above) — a bare tmp() root has no git remote
// at all, so that write necessarily fails its `git fetch origin
// health-state` first, non-fatally. What's exercised for real here instead
// is churn-report's read side against a directly-seeded health-state branch,
// mirroring tests/bin-lib/code-health/churn-v2.test.js.
test('churn-report: a seeded durable run history prints a table row', () => {
  const root = tmp();
  seedDurableRuns(root, [
    { runId: 'run-1', runAt: '2026-01-01T00:00:00.000Z', fingerprints: ['harnesshealth-aaaa0001'] },
  ]);

  const result = spawnSync('node', [CLI, 'churn-report', '--root', root], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('run-1'));
});

test('validate-findings: a finding matching a closed non-wontfix issue is reopened, not dropped', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const first = runValidateFindings(root, findingsFile, ['--target', 'auth', '--kind', 'skill']);
  const firstPayloads = JSON.parse(first.stdout);
  const fp = firstPayloads[0].body.match(/<!--\s*work-fingerprint:\s*(harnesshealth-[0-9a-f]{8})\s*-->/)[1];

  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([{ number: 9, state: 'closed', labels: ['by:harness-health'], fingerprint: fp }]));

  const second = runValidateFindings(root, findingsFile, ['--issues', issuesFile, '--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(second.status, 0, `stderr: ${second.stderr}`);
  const payloads = JSON.parse(second.stdout);
  assert.strictEqual(payloads.length, 1, 'a regressed finding must still emit a payload, not be silently dropped');

  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'harness-health', 'cache.json'), 'utf8'));
  assert.strictEqual(cache[fp].status, 'regressed');
  assert.strictEqual(cache[fp].issue, 9);
});

// recordRun's local-disk failure-injection scenario (blocking the runs
// directory with a regular file) no longer applies — run history is durable
// now, with no local runs directory at all. What replaces it: a bare tmp()
// root has no git remote, so writeDurableState's own `git fetch origin
// health-state` necessarily fails here too, and cmdValidateFindings's
// persistence block must treat that the same way — non-fatal, payload still
// emitted, a clear stderr message, and no local cursors.json/runs/ ever
// written.
test('validate-findings: a real run still succeeds and emits its payload when durable persistence cannot complete', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const result = runValidateFindings(root, findingsFile, ['--run-id', 'test-run-1', '--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(result.status, 0, `expected non-fatal exit, got stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'payload must still emit despite the persistence failure');
  assert.ok(
    result.stderr.includes('health-state persistence failed after retries'),
    `expected a health-state persistence warning in stderr, got: ${result.stderr}`,
  );
  assert.strictEqual(
    fs.existsSync(path.join(root, '.claude-tweaks', 'harness-health', 'cursors.json')),
    false,
    'cursors are durable now — no local cursors.json is ever written',
  );
});

// ── Premise-check threading end-to-end (#2621) ──────────────────────────────

test('validate-findings: a patch finding against a real target file carries a Premise-check: line resolvable to that file', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth\n\nSee `src/auth/login.js`.\n');
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1);
  const expectedPath = path.join(root, '.claude', 'skills', 'auth.md');
  assert.ok(
    payloads[0].body.includes(`Premise-check: ! grep -qF -- 'See \`src/auth/session.js\`.' '${expectedPath}'`),
    `expected a Premise-check: line anchored on the resolved target path, got body:\n${payloads[0].body}`,
  );
});

test('validate-findings: a patch finding against an unresolvable target carries no Premise-check: line', () => {
  const root = tmp();
  // No .claude/skills/auth.md on disk — the target can't resolve to a path.
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1);
  assert.ok(!payloads[0].body.includes('Premise-check:'), 'must degrade to no line, not a wrong one');
});
