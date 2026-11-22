'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const { seedDurableState } = require('../health-core/seed-durable-state');
const { sweepCli } = require('../../helpers/health-sweep-cli');
const { cleanGitEnv } = require('../../helpers/git-fixtures');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'docs-health.js');

function tmp() { return scratchDir('docs-health-vf-'); }

// In-process (#5381), with the file-protocol-only git guard and a throwaway real cwd — see tests/helpers/health-sweep-cli.js.
function runValidateFindings(root, findingsFile, extraArgs = [], opts = {}) {
  return sweepCli(CLI, ['validate-findings', findingsFile, '--root', root, ...extraArgs], opts);
}

function validFinding(overrides = {}) {
  return {
    target: 'decisions/0007-foo',
    assetType: 'doc',
    category: 'staleness',
    section: 'Freshness',
    misleads: 'agent',
    classification: 'restructural',
    confidence: 'high',
    reversibility: 'med',
    description: 'Stated skill count is stale',
    oldString: 'This project ships 12 skills.',
    newString: 'This project ships 14 skills.',
    reason: 'A live count of skills/*/SKILL.md returns 14, not 12.',
    ...overrides,
  };
}

test('validate-findings: valid finding emits one payload on stdout', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'decisions/0007-foo']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);

  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1);
  assert.ok(payloads[0].labels.includes('by:docs-health'));
  assert.ok(payloads[0].labels.includes('ready'));
  assert.ok(payloads[0].labels.includes('risk:medium'));
  assert.ok(payloads[0].labels.includes('size:high'));
  assert.strictEqual(payloads[0].type, 'task');
  assert.ok(payloads[0].body.includes('<!-- work-fingerprint: docshealth-'));
});

test('validate-findings: malformed finding is dropped with a stderr reason, valid ones survive', () => {
  const root = tmp();
  const malformed = { target: 'x' };
  const good = validFinding({ target: 'guides/setup' });
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([malformed, good]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'guides/setup']);
  assert.strictEqual(result.status, 0);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1);
  assert.ok(result.stderr.includes('dropped'));
});

test('validate-findings: --dry-run emits payloads but writes no local cache', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const result = runValidateFindings(root, findingsFile, ['--dry-run', '--target', 'decisions/0007-foo']);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(JSON.parse(result.stdout).length, 1);
  assert.strictEqual(fs.existsSync(path.join(root, '.claude-tweaks', 'docs-health', 'cache.json')), false);
});

test('validate-findings: a finding already open in the issue index is skipped (dedup)', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const first = runValidateFindings(root, findingsFile, ['--target', 'decisions/0007-foo']);
  const firstPayloads = JSON.parse(first.stdout);
  const fp = firstPayloads[0].body.match(/<!--\s*work-fingerprint:\s*(docshealth-[0-9a-f]{8})\s*-->/)[1];

  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([{ number: 1, state: 'open', labels: ['by:docs-health'], fingerprint: fp }]));

  const second = runValidateFindings(root, findingsFile, ['--issues', issuesFile, '--target', 'decisions/0007-foo']);
  assert.strictEqual(JSON.parse(second.stdout).length, 0, 'open finding must be skipped');
});

test('validate-findings: a malformed --issues file degrades gracefully with a stderr warning, not a hard failure', () => {
  const root = tmp();
  const f = validFinding();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([f]));
  const badIssuesFile = path.join(root, 'bad-issues.json');
  fs.writeFileSync(badIssuesFile, 'not valid json{{{');

  const result = runValidateFindings(root, findingsFile, ['--issues', badIssuesFile, '--target', 'decisions/0007-foo']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
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

  const result = runValidateFindings(root, findingsFile, ['--issues', issuesFile, '--target', 'decisions/0007-foo']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('skipping malformed issue entry'), `expected a skip warning in stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'the well-formed finding must still file despite a malformed --issues entry');
});

test('validate-findings: exits non-zero when the findings file is missing', () => {
  const root = tmp();
  const result = runValidateFindings(root, path.join(root, 'nonexistent.json'), ['--target', 'decisions/0007-foo']);
  assert.notStrictEqual(result.status, 0);
});

// ── Persistence hardening: --target required for a real run ──
//
// buildValidateFindingsUpdate only patches an audit cursor when target is
// present — see bin/lib/docs-health/cache.js. Without a hard gate, a
// non-dry-run call that omits it (a flag typo, or a skill-prompt drift) used
// to still write the run record and dedup cache correctly but never advance
// any cursor, so that doc would be perpetually re-selected as stale/overdue.
// Mirrors bin/harness-health.js's own hard-gate for validate-findings.

test('validate-findings: exits 2 when --target is omitted on a non-dry-run call', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([]));

  const result = runValidateFindings(root, findingsFile);
  assert.strictEqual(result.status, 2, `expected exit 2, got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('--target'), `expected the gate message in stderr: ${result.stderr}`);
});

test('validate-findings: --dry-run without --target still succeeds (preview mode unaffected)', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const result = runValidateFindings(root, findingsFile, ['--dry-run']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(JSON.parse(result.stdout).length, 1);
});

test('churn-report: prints "no run logs found" when no runs exist', () => {
  const root = tmp();
  const result = sweepCli(CLI, ['churn-report', '--root', root]);
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('no run logs found'));
});

test('validate-findings: a finding matching a closed non-wontfix issue is reopened, not dropped', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const first = runValidateFindings(root, findingsFile, ['--target', 'decisions/0007-foo']);
  const firstPayloads = JSON.parse(first.stdout);
  const fp = firstPayloads[0].body.match(/<!--\s*work-fingerprint:\s*(docshealth-[0-9a-f]{8})\s*-->/)[1];

  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([{ number: 9, state: 'closed', labels: ['by:docs-health'], fingerprint: fp }]));

  const second = runValidateFindings(root, findingsFile, ['--issues', issuesFile, '--target', 'decisions/0007-foo']);
  assert.strictEqual(second.status, 0, `stderr: ${second.stderr}`);
  const payloads = JSON.parse(second.stdout);
  assert.strictEqual(payloads.length, 1, 'a regressed finding must still emit a payload, not be silently dropped');

  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'docs-health', 'cache.json'), 'utf8'));
  assert.strictEqual(cache[fp].status, 'regressed');
  assert.strictEqual(cache[fp].issue, 9);
});

// ── --min-confidence: sub-threshold findings are remembered, not filed ──

test('validate-findings: --min-confidence high withholds a low-confidence finding from payloads (remembered instead)', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding({ confidence: 'low' })]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'decisions/0007-foo', '--min-confidence', 'high']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 0, 'a low-confidence finding below the floor must not be filed');
});

test('validate-findings: --min-confidence high still files a high-confidence finding', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding({ confidence: 'high' })]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'decisions/0007-foo', '--min-confidence', 'high']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'a finding at or above the floor must still be filed');
});

test('validate-findings: without --min-confidence, a low-confidence finding still files (default file-everything behavior unchanged)', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding({ confidence: 'low' })]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'decisions/0007-foo']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'omitting the flag must preserve today\'s no-floor default');
});

test('validate-findings: --min-confidence <invalid value> exits 2', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'decisions/0007-foo', '--min-confidence', 'bogus']);
  assert.strictEqual(result.status, 2);
  assert.ok(result.stderr.includes('min-confidence'), `expected the gate message in stderr: ${result.stderr}`);
});

test('validate-findings: a below-floor finding is recorded in the local cache as remembered (not staged/dropped)', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding({ confidence: 'low' })]));

  const result = runValidateFindings(root, findingsFile, ['--target', 'decisions/0007-foo', '--min-confidence', 'high']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);

  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'docs-health', 'cache.json'), 'utf8'));
  const entries = Object.values(cache);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].status, 'remembered');
  assert.strictEqual(entries[0].confidence, 'low');
});

// ── declined marks must survive a fresh (different) container ──
//
// bin/lib/health-core/mark.js's readDurableState/writeDurableState wiring
// (now enabled for docs-health.js's cmdMark, mirroring harness-health.js)
// persists a "declined" mark to the health-state branch, not just the local
// gitignored cache.json — but that's only half the fix: cmdValidateFindings
// also has to read it back. This test proves the read/merge side
// (mergeDeclinedIntoCache, wired into cmdValidateFindings's cache read)
// genuinely works end-to-end by seeding the health-state branch directly
// (bypassing `mark`'s own `gh api` write path, which needs real GitHub
// credentials this sandboxed test doesn't have) and confirming a *fresh*
// root — no local cache.json for this fingerprint at all, simulating a
// different, since-recycled scheduled-Routine container — still suppresses it.
test('validate-findings: a fingerprint declined only on the durable health-state branch (simulating a different, since-recycled Routine container) is still suppressed', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  // Compute the real fingerprint the same way a first run would, without
  // touching git at all yet (bare tmp root => no remote, dry-run writes nothing).
  const first = runValidateFindings(root, findingsFile, ['--dry-run', '--target', 'decisions/0007-foo']);
  const fp = JSON.parse(first.stdout)[0].body.match(/<!--\s*work-fingerprint:\s*(docshealth-[0-9a-f]{8})\s*-->/)[1];

  seedDurableState(root, 'docs-health', 'declined.json', { [fp]: { lastSeenMs: Date.now() } }, 'docs-health-vf-declined');

  const second = runValidateFindings(root, findingsFile, ['--target', 'decisions/0007-foo']);
  assert.strictEqual(second.status, 0, `stderr: ${second.stderr}`);
  assert.strictEqual(
    JSON.parse(second.stdout).length,
    0,
    'a durably-declined finding must be suppressed even though this root has no local cache.json for it',
  );
});

test('validate-findings: a real run still succeeds and emits its payload when durable persistence cannot complete', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const result = runValidateFindings(root, findingsFile, ['--run-id', 'test-run-1', '--target', 'decisions/0007-foo']);
  assert.strictEqual(result.status, 0, `expected non-fatal exit, got stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'payload must still emit despite the persistence failure');
  assert.strictEqual(
    fs.existsSync(path.join(root, '.claude-tweaks', 'docs-health', 'cursors.json')),
    false,
    'cursors are durable now — no local cursors.json is ever written',
  );
});

// Real-process pin of the script entry (#5381): the tier refusal's code, stdout and stderr are
// byte-identical before and after the in-process entry conversion.
test('AC7.1: validate-findings --min-confidence bogus --dry-run exits 2 with the tier message (real process)', () => {
  const { spawnCli } = require('../../helpers/run-cli');
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([]));

  const env = { ...cleanGitEnv(process.env), LC_ALL: 'C', LANG: 'C' };
  const r = spawnCli(CLI, ['validate-findings', findingsFile, '--root', root, '--min-confidence', 'bogus', '--dry-run'], { env, cwd: root });
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.stdout, '');
  // Only the CLI-owned refusal line is pinned; git's own stderr text varies by version, locale and checkout.
  assert.ok(
    r.stderr.split('\n').includes('validate-findings: --min-confidence "bogus" is not a recognized confidence tier (must be one of high|med|low) — an unrecognized value would silently file every finding regardless of confidence, defeating the floor.'),
    `expected the tier message in stderr: ${r.stderr}`,
  );
});

// ── in-process entry (#5381) ────────────────────────────────────────────────

// No --root at all: the root is the injected cwd, and the relative findings file and --issues file are
// read under it — the same outcomes as their --root twins above.
test('AC8.1: validate-findings without --root reads relative findings and --issues files under the injected cwd', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'findings.json'), JSON.stringify([validFinding()]));

  // Dry runs first: they write no cache, so only the --issues file can dedup the second one.
  const first = sweepCli(CLI, ['validate-findings', 'findings.json', '--dry-run'], { cwd: root });
  assert.strictEqual(first.status, 0, `stderr: ${first.stderr}`);
  const firstPayloads = JSON.parse(first.stdout);
  assert.strictEqual(firstPayloads.length, 1);
  const fp = firstPayloads[0].body.match(/<!--\s*work-fingerprint:\s*(docshealth-[0-9a-f]{8})\s*-->/)[1];

  fs.writeFileSync(path.join(root, 'issues.json'), JSON.stringify([{ number: 1, state: 'open', labels: ['by:docs-health'], fingerprint: fp }]));
  const second = sweepCli(CLI, ['validate-findings', 'findings.json', '--issues', 'issues.json', '--dry-run'], { cwd: root });
  assert.strictEqual(second.status, 0, `stderr: ${second.stderr}`);
  assert.strictEqual(JSON.parse(second.stdout).length, 0, 'the open issue in the relative --issues file must dedup the finding');

  const third = sweepCli(CLI, ['validate-findings', 'findings.json', '--target', 'decisions/0007-foo'], { cwd: root });
  assert.strictEqual(third.status, 0, `stderr: ${third.stderr}`);
  assert.strictEqual(JSON.parse(third.stdout).length, 1);
  assert.ok(
    fs.existsSync(path.join(root, '.claude-tweaks', 'docs-health', 'cache.json')),
    'the cache must be written under the injected cwd, the default root',
  );
});

// A relative --root is normalized against the injected cwd once, so the cache lands under it and not
// under the process's own cwd.
test('validate-findings --root <relative dir> writes the cache under that dir of the injected cwd', () => {
  const parent = tmp();
  fs.mkdirSync(path.join(parent, 'proj'));
  fs.writeFileSync(path.join(parent, 'proj', 'findings.json'), JSON.stringify([validFinding()]));

  const res = sweepCli(CLI, ['validate-findings', 'proj/findings.json', '--root', 'proj', '--target', 'decisions/0007-foo'], { cwd: parent });
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  assert.strictEqual(JSON.parse(res.stdout).length, 1);
  assert.ok(
    fs.existsSync(path.join(parent, 'proj', '.claude-tweaks', 'docs-health', 'cache.json')),
    'the cache must be written under <injected cwd>/proj',
  );
});

// The error line names the findings file as the caller spelled it, not the joined path.
test('validate-findings prints a relative findings path as written when it cannot be read', () => {
  const root = tmp();
  const res = sweepCli(CLI, ['validate-findings', 'nope.json', '--dry-run'], { cwd: root });
  assert.strictEqual(res.status, 1);
  assert.ok(
    res.stderr.split('\n').includes('validate-findings: could not read or parse findings file: nope.json'),
    `expected the file as written in stderr: ${res.stderr}`,
  );
});

// The exit code is returned, never read from or written to process.exitCode.
test('AC2.1: validate-findings returns 0 on a valid findings file when process.exitCode is already 1', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

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
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));

  const result = runValidateFindings(root, findingsFile, ['--dry-run'], { env: { GIT_DIR: path.join(repo, '.git') } });
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const [payload] = JSON.parse(result.stdout);
  assert.ok(payload.body.includes(`Verified-as-of: ${sha}`), `expected the injected repo's HEAD ${sha}, got body:\n${payload.body}`);
});
