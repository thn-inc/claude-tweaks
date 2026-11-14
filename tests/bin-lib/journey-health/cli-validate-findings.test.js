const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { seedDurableState } = require('../health-core/seed-durable-state');
const { spawnCli } = require('../../helpers/run-cli');
const { sweepCli } = require('../../helpers/health-sweep-cli');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'journey-health.js');

// In-process (#5380), with the file-protocol-only git guard — see tests/helpers/health-sweep-cli.js.
const cli = (argv, opts) => sweepCli(CLI, argv, opts);

// An in-process call that must exit 0; returns its stdout.
function cliOut(argv, opts) {
  const res = cli(argv, opts);
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  return res.stdout;
}

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'journey-health-cli-validate-')); }

function finding(overrides = {}) {
  return {
    journey: 'checkout-flow', category: 'drift', section: 'self-review',
    description: 'Persona is a placeholder', reason: 'Step 2 has no named persona',
    confidence: 'high', severity: 'high', recommendation: 'Run /claude-tweaks:journeys checkout-flow',
    ...overrides,
  };
}

// recordRun/readRuns (local-disk run-log persistence) were removed by the
// health-state migration — run history now lives on the durable
// health-state branch (bin/lib/health-core/durable-state.js), not local
// disk. Its write path (gh api blob/tree/commit/ref calls) requires live
// GitHub credentials; the read path is pure git plumbing (fetch + show), so
// it's exercised for real below via a local bare git remote seeded directly
// with runs.json (no gh/network needed) — the same technique
// tests/bin-lib/harness-health/cli-validate-findings.test.js's
// seedDurableRuns uses.
function seedDurableRuns(root, runs) {
  const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-health-vf-bare-'));
  execFileSync('git', ['init', '--bare', '-q', bareDir]);
  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-health-vf-seed-'));
  execFileSync('git', ['init', '-q', seedDir]);
  execFileSync('git', ['-C', seedDir, 'checkout', '-q', '-b', 'health-state']);
  fs.mkdirSync(path.join(seedDir, 'journey-health'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'journey-health', 'runs.json'), JSON.stringify(runs));
  execFileSync('git', ['-C', seedDir, 'add', '-A']);
  execFileSync(
    'git',
    ['-C', seedDir, '-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'seed'],
  );
  execFileSync('git', ['-C', seedDir, 'push', '-q', bareDir, 'health-state']);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', bareDir], { cwd: root });
}

test('validate-findings files a brand-new valid finding and succeeds when durable persistence cannot complete', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding()]));
  const result = cli(['validate-findings', findingsFile, '--target', 'checkout-flow', '--tier', 'light', '--root', root]);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1);
  assert.strictEqual(payloads[0].journey, 'checkout-flow');
  assert.ok(payloads[0].labels.includes('by:journey-health'));
  assert.ok(payloads[0].labels.includes('ready'));
  assert.ok(payloads[0].labels.includes('risk:high'), 'default fixture finding is severity high');
  assert.ok(payloads[0].labels.includes('size:medium'));
  assert.strictEqual(payloads[0].type, 'task');
  assert.ok(payloads[0].body.includes('<!-- work-fingerprint: journeyhealth-'));
  assert.ok(!payloads[0].body.includes('journey-health-fingerprint'), 'legacy marker must not be emitted');
  assert.strictEqual(
    fs.existsSync(path.join(root, '.claude-tweaks', 'journey-health', 'cursors.json')),
    false,
    'cursors are durable now — no local cursors.json is ever written',
  );
});

test('validate-findings drops an invalid finding and reports 0 payloads', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding({ category: 'bogus' })]));
  const raw = cliOut(['validate-findings', findingsFile, '--target', 'checkout-flow', '--root', root]);
  assert.deepStrictEqual(JSON.parse(raw), []);
});

test('validate-findings --dry-run does not write cursor or cache state', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding()]));
  cliOut(['validate-findings', findingsFile, '--target', 'checkout-flow', '--dry-run', '--root', root]);
  assert.strictEqual(fs.existsSync(path.join(root, '.claude-tweaks', 'journey-health', 'cursors.json')), false);
  assert.strictEqual(fs.existsSync(path.join(root, '.claude-tweaks', 'journey-health', 'cache.json')), false);
});

// Cursors are now durable (health-state branch), not local disk — a bare
// tmp() root (no git remote at all) means the CLI's writeDurableState call
// necessarily fails its `git fetch origin health-state` first. That failure
// is non-fatal (see bin/journey-health.js's cmdValidateFindings persistence
// block), so what's provable at the CLI level here is that the run still
// succeeds and never writes a local cursors.json, regardless of
// --coverage-scan. The actual cursor-set semantics (per-journey light/deep
// merge, coverage-scan cursor set, unrelated cursor keys preserved) are unit
// tested directly against the pure mutator in
// tests/bin-lib/journey-health/build-validate-findings-update.test.js.
test('validate-findings --coverage-scan still succeeds when durable persistence cannot complete, no local cursors.json is ever written', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding({ category: 'coverage', section: 'coverage' })]));
  const result = cli(['validate-findings', findingsFile, '--coverage-scan', '--root', root]);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(
    fs.existsSync(path.join(root, '.claude-tweaks', 'journey-health', 'cursors.json')),
    false,
    'cursors are durable now — no local cursors.json is ever written',
  );
});

test('a finding marked declined is suppressed by a later validate-findings run on the same fingerprint', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding()]));
  const first = JSON.parse(cliOut(['validate-findings', findingsFile, '--target', 'checkout-flow', '--root', root]));
  assert.strictEqual(first.length, 1, 'first run must file the finding');
  const fp = first[0].id;
  cliOut(['mark', fp, 'declined', '--root', root]);
  const second = JSON.parse(cliOut(['validate-findings', findingsFile, '--target', 'checkout-flow', '--root', root]));
  assert.strictEqual(second.length, 0, 'declined finding must be suppressed on the next run');
});

test('validate-findings exits non-zero for a missing findings file argument', () => {
  const root = tmp();
  const result = cli(['validate-findings', '--root', root]);
  assert.notStrictEqual(result.status, 0);
});

// ── Persistence hardening: --target or --coverage-scan required for a real run ──
//
// buildValidateFindingsUpdate only patches an audit cursor when target is
// present, or sets __coverageScan when coverageScan is set — see
// bin/lib/journey-health/cache.js. Without a hard gate, a non-dry-run call
// that omits both (a flag typo, or a caller path that forgets to thread the
// journey id through) used to still write the run record and dedup cache
// correctly but never advance any cursor, so that journey would be
// perpetually re-selected as stale/overdue. Mirrors
// bin/harness-health.js's own hard-gate for validate-findings.

test('validate-findings: exits 2 when neither --target nor --coverage-scan is given on a non-dry-run call', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([]));

  const result = cli(['validate-findings', findingsFile, '--root', root]);
  assert.strictEqual(result.status, 2, `expected exit 2, got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('--target') && result.stderr.includes('--coverage-scan'),
    `expected the gate message in stderr: ${result.stderr}`);
});

test('validate-findings: --dry-run without --target/--coverage-scan still succeeds (preview mode unaffected)', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding()]));

  const result = cli(['validate-findings', findingsFile, '--dry-run', '--root', root]);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(JSON.parse(result.stdout).length, 1);
});

test('validate-findings: a finding matching a closed non-wontfix issue is reopened, not dropped', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding()]));

  const first = cli(['validate-findings', findingsFile, '--target', 'checkout-flow', '--root', root]);
  const firstPayloads = JSON.parse(first.stdout);
  const fp = firstPayloads[0].body.match(/<!--\s*work-fingerprint:\s*(journeyhealth-[0-9a-f]{8})\s*-->/)[1];

  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([{ number: 9, state: 'closed', labels: ['by:journey-health'], fingerprint: fp }]));

  const second = cli(['validate-findings', findingsFile, '--target', 'checkout-flow', '--root', root, '--issues', issuesFile]);
  assert.strictEqual(second.status, 0, `stderr: ${second.stderr}`);
  const payloads = JSON.parse(second.stdout);
  assert.strictEqual(payloads.length, 1, 'a regressed finding must still emit a payload, not be silently dropped');

  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'journey-health', 'cache.json'), 'utf8'));
  assert.strictEqual(cache[fp].status, 'regressed');
  assert.strictEqual(cache[fp].issue, 9);
});

test('validate-findings: a malformed --issues array element (e.g. null) is skipped, not a crash', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding()]));
  const issuesFile = path.join(root, 'issues-with-null.json');
  fs.writeFileSync(issuesFile, JSON.stringify([null, { number: 1, state: 'open', labels: [], fingerprint: 'zzz' }]));

  const result = cli(['validate-findings', findingsFile, '--target', 'checkout-flow', '--root', root, '--issues', issuesFile]);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('skipping malformed issue entry'), `expected a skip warning in stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'the well-formed finding must still file despite a malformed --issues entry');
});

// A real validate-findings run's own attempt to persist its run record can no
// longer be observed by re-reading local disk (run history is durable now —
// see seedDurableRuns's comment above) — a bare tmp() root has no git remote
// at all, so that write necessarily fails its `git fetch origin
// health-state` first, non-fatally, with a clear stderr message.
test('validate-findings: a real run still succeeds and emits its payload when durable persistence cannot complete', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding()]));

  const result = cli(['validate-findings', findingsFile, '--target', 'checkout-flow', '--root', root, '--run-id', 'test-run-1']);
  assert.strictEqual(result.status, 0, `expected non-fatal exit, got stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.strictEqual(payloads.length, 1, 'payload must still emit despite the persistence failure');
  assert.ok(
    result.stderr.includes('health-state persistence failed after retries'),
    `expected a health-state persistence warning in stderr, got: ${result.stderr}`,
  );
  assert.strictEqual(
    fs.existsSync(path.join(root, '.claude-tweaks', 'journey-health', 'cursors.json')),
    false,
    'cursors are durable now — no local cursors.json is ever written',
  );
});

// ── --min-confidence floor ──
//
// Opt-in only: omitting the flag keeps today's unconditional-filing
// behavior (see the fixture-default test at the top of this file). Passing
// it holds back any finding whose confidence ranks below the threshold,
// for this run only (journey-health has no `remembered` cache tier).

test('validate-findings --min-confidence high: a med-confidence finding is held back, not filed', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding({ confidence: 'med' })]));
  const result = cli(['validate-findings', findingsFile, '--target', 'checkout-flow', '--root', root, '--min-confidence', 'high']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.deepStrictEqual(JSON.parse(result.stdout), []);
  assert.ok(result.stderr.includes('held back'), `expected a held-back notice in stderr: ${result.stderr}`);
});

test('validate-findings --min-confidence med: a high-confidence finding still files', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding({ confidence: 'high' })]));
  const result = cli(['validate-findings', findingsFile, '--target', 'checkout-flow', '--root', root, '--min-confidence', 'med']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(JSON.parse(result.stdout).length, 1);
});

test('validate-findings: an unrecognized --min-confidence value exits 2', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding()]));
  const result = cli(['validate-findings', findingsFile, '--target', 'checkout-flow', '--root', root, '--min-confidence', 'bogus']);
  assert.strictEqual(result.status, 2, `expected exit 2, got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('--min-confidence'), `expected the flag named in stderr: ${result.stderr}`);
});

test('churn-report: prints "no run logs found" when no runs exist', () => {
  const root = tmp();
  const result = cli(['churn-report', '--root', root]);
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('no run logs found'));
});

// churn-report's own read side (readDurableState(root).runs, no longer
// readRuns(root)) against a directly-seeded health-state branch, mirroring
// tests/bin-lib/harness-health/cli-validate-findings.test.js's equivalent
// test.
test('churn-report: a seeded durable run history prints a table row', () => {
  const root = tmp();
  seedDurableRuns(root, [
    { runId: 'run-1', runAt: '2026-01-01T00:00:00.000Z', fingerprints: ['journeyhealth-aaaa0001'] },
  ]);

  const result = cli(['churn-report', '--root', root]);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('run-1'));
});

// ── declined marks must survive a fresh (different) container ──
//
// bin/lib/health-core/mark.js's readDurableState/writeDurableState wiring
// (now enabled for journey-health.js's cmdMark, mirroring harness-health.js)
// persists a "declined" mark to the health-state branch, not just the local
// gitignored cache.json — but that's only half the fix: cmdValidateFindings
// also has to read it back. This test proves the read/merge side
// (mergeDeclinedIntoCache, wired into cmdValidateFindings's readCache)
// genuinely works end-to-end by seeding the health-state branch directly
// (bypassing `mark`'s own `gh api` write path, which needs real GitHub
// credentials this sandboxed test doesn't have) and confirming a *fresh*
// root — no local cache.json for this fingerprint at all, simulating a
// different, since-recycled scheduled-Routine container — still suppresses it.
test('validate-findings: a fingerprint declined only on the durable health-state branch (simulating a different, since-recycled Routine container) is still suppressed', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding()]));

  // Compute the real fingerprint the same way a first run would, without
  // touching git at all yet (bare tmp root => no remote, dry-run writes nothing).
  const first = cli(['validate-findings', findingsFile, '--dry-run', '--target', 'checkout-flow', '--tier', 'light', '--root', root]);
  const fp = JSON.parse(first.stdout)[0].body.match(/<!--\s*work-fingerprint:\s*(journeyhealth-[0-9a-f]{8})\s*-->/)[1];

  seedDurableState(root, 'journey-health', 'declined.json', { [fp]: { lastSeenMs: Date.now() } }, 'journey-health-vf-declined');

  const second = cli(['validate-findings', findingsFile, '--target', 'checkout-flow', '--tier', 'light', '--root', root]);
  assert.strictEqual(second.status, 0, `stderr: ${second.stderr}`);
  assert.strictEqual(
    JSON.parse(second.stdout).length,
    0,
    'a durably-declined finding must be suppressed even though this root has no local cache.json for it',
  );
});

// Proves the refusal path's exit code survives the real entry: the same unrecognized
// --min-confidence goes through run() in-process and through the script as a child, with
// the same env, and both must refuse with 2 and the same stderr (#5380).
test('validate-findings --min-confidence bogus: the in-process run and the script entry both refuse with 2 and the same stderr', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding()]));
  // The same env for both halves, with the file-protocol-only git guard sweepCli also applies
  // (tests/helpers/health-sweep-cli.js); this refusal returns before any git call.
  const env = { ...process.env, GIT_ALLOW_PROTOCOL: 'file' };
  const argv = ['validate-findings', findingsFile, '--root', root, '--min-confidence', 'bogus', '--dry-run'];

  const inProcess = sweepCli(CLI, argv, { env, cwd: root });
  const spawned = spawnCli(CLI, argv, { env, cwd: root });

  assert.strictEqual(inProcess.status, 2);
  assert.strictEqual(spawned.code, 2);
  assert.strictEqual(spawned.stderr, inProcess.stderr);
  assert.match(spawned.stderr, /--min-confidence "bogus" is not a recognized confidence tier/);
});

// ── in-process entry (#5380) ────────────────────────────────────────────────

// No --root, and a findings path relative to the injected cwd: the root and the findings file
// both resolve against it. A real (non-dry-run) run writes its dedup cache under the root, so
// the cache appearing under the injected cwd is what shows the root was that cwd.
test('validate-findings without --root and with a relative findings path reads and writes under the injected cwd', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'findings.json'), JSON.stringify([finding()]));

  const result = cli(['validate-findings', 'findings.json', '--target', 'checkout-flow'], { cwd: root });
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(JSON.parse(result.stdout).length, 1);
  assert.ok(
    fs.existsSync(path.join(root, '.claude-tweaks', 'journey-health', 'cache.json')),
    'the dedup cache must land under the injected cwd',
  );
});

// AC2.1 / AC2.2: the exit code is returned, never read from or written to process.exitCode.
test('validate-findings returns 0 and prints its payloads while process.exitCode is already non-zero', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding()]));

  const prior = process.exitCode;
  process.exitCode = 1;
  let result;
  try {
    result = cli(['validate-findings', findingsFile, '--root', root, '--dry-run']);
  } finally {
    process.exitCode = prior;
  }
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const payloads = JSON.parse(result.stdout);
  assert.ok(Array.isArray(payloads));
  assert.strictEqual(payloads.length, 1);
});

// Env-only fixture: the effect of the git child the CLI starts for Verified-as-of is observable
// only when the injected env reaches it. The tests' own process environment holds no GIT_DIR.
test('validate-findings stamps Verified-as-of from the injected env: GIT_DIR names the repo, root is not one', () => {
  const root = tmp(); // not a git repo
  const repo = tmp();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['-C', repo, '-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '--allow-empty', '-m', 'seed']);
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([finding()]));

  const result = cli(['validate-findings', findingsFile, '--root', root, '--dry-run'], { env: { GIT_DIR: path.join(repo, '.git') } });
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const [payload] = JSON.parse(result.stdout);
  assert.ok(payload.body.includes(`Verified-as-of: ${sha}`), `expected the injected repo's HEAD ${sha}, got body:\n${payload.body}`);
});
