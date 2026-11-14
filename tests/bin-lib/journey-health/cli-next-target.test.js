const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { STUB_SKIP } = require('../../helpers/path-stub');
const { sweepCli } = require('../../helpers/health-sweep-cli');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'journey-health.js');

// In-process (#5380), with the file-protocol-only git guard — see tests/helpers/health-sweep-cli.js.
const cli = (argv, opts) => sweepCli(CLI, argv, opts);

function runNextTarget(args, root, opts = {}) {
  const res = cli(['next-target', ...args, '--root', root], opts);
  assert.strictEqual(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'journey-health-cli-next-')); }

// Wraps `git` with a logging shim on a PATH handed to the in-process call, so a test can count
// how many times the CLI shells out to git (fetch/show), without needing a real GitHub-hosted
// remote. The stub dir goes ahead of the real PATH in the injected env only; the test process's
// own process.env.PATH is never touched (installStub would), so a CLI that ignored its injected
// env would run the real git and log nothing — the test would fail. Mirrors
// tests/bin-lib/harness-health/cli-next-target.test.js's makeGitSpy.
function makeGitSpy() {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-health-nt-gitspy-'));
  const logFile = path.join(logDir, 'git-calls.log');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-health-nt-gitstub-'));
  const shim = path.join(stubDir, 'git');
  fs.writeFileSync(shim, `#!/bin/sh\necho "$@" >> "${logFile}"\nexec "${realGit}" "$@"\n`);
  fs.chmodSync(shim, 0o755); // root-safe: exec-bit stub, not a denial simulation
  return { logFile, env: { ...process.env, PATH: stubDir + path.delimiter + process.env.PATH } };
}

// Seeds a real local `origin` remote with a health-state branch so
// readDurableState's `git fetch origin health-state` succeeds for real,
// without needing live GitHub credentials. Mirrors
// tests/bin-lib/harness-health/cli-next-target.test.js's seedDurableCursors.
function seedDurableCursors(root, cursors) {
  const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-health-nt-bare-'));
  execFileSync('git', ['init', '--bare', '-q', bareDir]);
  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-health-nt-seed-'));
  execFileSync('git', ['init', '-q', seedDir]);
  execFileSync('git', ['-C', seedDir, 'checkout', '-q', '-b', 'health-state']);
  fs.mkdirSync(path.join(seedDir, 'journey-health'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'journey-health', 'cursors.json'), JSON.stringify(cursors));
  execFileSync('git', ['-C', seedDir, 'add', '-A']);
  execFileSync(
    'git',
    ['-C', seedDir, '-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'seed'],
  );
  execFileSync('git', ['-C', seedDir, 'push', '-q', bareDir, 'health-state']);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', bareDir], { cwd: root });
}

function writeJourney(root, name) {
  const dir = path.join(root, 'docs', 'journeys');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.md`), `---\nfiles:\n  - src/${name}.tsx\n---\n\n# ${name}\n`, 'utf8');
  const filePath = path.join(root, 'src', `${name}.tsx`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '', 'utf8');
}

test('next-target returns null target and coverageScanDue:true when no journeys exist yet', () => {
  const root = tmp();
  const result = runNextTarget([], root);
  assert.strictEqual(result.target, null);
  assert.strictEqual(result.coverageScanDue, true);
});

test('next-target defaults to the light tier and force-picks a never-audited journey', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow');
  const result = runNextTarget([], root);
  assert.strictEqual(result.target.id, 'checkout-flow');
  assert.strictEqual(result.target.why, 'stale');
});

test('next-target --target bypasses selection with why: "manual"', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow');
  writeJourney(root, 'signup-flow');
  const result = runNextTarget(['--target', 'signup-flow'], root);
  assert.strictEqual(result.target.id, 'signup-flow');
  assert.strictEqual(result.target.why, 'manual');
});

test('next-target --tier deep uses the deep-tier cursor field', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow');
  const result = runNextTarget(['--tier', 'deep'], root);
  assert.strictEqual(result.target.id, 'checkout-flow');
  assert.strictEqual(result.target.why, 'stale');
});

test('next-target --budget 2 does not repeat the same deleted-file journey across multiple targets', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow');
  writeJourney(root, 'signup-flow');
  fs.rmSync(path.join(root, 'src', 'checkout-flow.tsx'));
  const result = runNextTarget(['--budget', '2'], root);
  assert.strictEqual(result.targets.length, 2);
  const ids = result.targets.map((t) => t.id).sort();
  assert.deepStrictEqual(ids, ['checkout-flow', 'signup-flow']);
  assert.strictEqual(result.targets.find((t) => t.id === 'checkout-flow').why, 'deleted-file');
});

// ─── Phase 0 acknowledgement across runs (#131) ─────────────────────────────

test('next-target skips a deleted-file journey whose durable cursor already records that missing set (#131)', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow');
  writeJourney(root, 'signup-flow');
  fs.rmSync(path.join(root, 'src', 'checkout-flow.tsx'));
  seedDurableCursors(root, {
    'checkout-flow': { lastLightAuditMs: Date.now(), deletedFileSig: 'src/checkout-flow.tsx' },
  });
  const result = runNextTarget([], root);
  // Pre-fix this was checkout-flow with why: 'deleted-file', on every run forever.
  assert.strictEqual(result.target.id, 'signup-flow');
  assert.strictEqual(result.target.why, 'stale');
});

test('four next-target -> validate-findings cycles against a permanently broken journey audit all four journeys (#131)', () => {
  const root = tmp();
  const ids = ['a-flow', 'b-flow', 'c-flow', 'd-flow'];
  for (const id of ids) writeJourney(root, id);
  // a-flow's declared file is deleted and never fixed. It sorts first, so
  // pre-fix Phase 0 returned it on every one of these four runs and the other
  // three journeys were never audited at all.
  fs.rmSync(path.join(root, 'src', 'a-flow.tsx'));
  seedDurableCursors(root, {});
  // commit-tree (writeDurableState's write path) needs a committer identity.
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'test']);

  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, '[]');

  const audited = [];
  for (let run = 0; run < ids.length; run++) {
    const target = runNextTarget([], root).target;
    assert.ok(target, `run ${run} selected nothing at all`);
    audited.push(target.id);
    // The real Step 5 light-tier call — the one that records the cursor,
    // including the deleted-file acknowledgement. It runs even with zero
    // findings, which is exactly why the acknowledgement lands.
    const validated = cli([
      'validate-findings', findingsFile, '--root', root,
      '--tier', 'light', '--target', target.id, '--run-id', `run-${run}`,
    ]);
    assert.strictEqual(validated.status, 0, validated.stderr);
  }

  assert.deepStrictEqual(audited, ids, 'the rotation must reach every journey, not re-pick the broken one');
});

test('next-target (default no --target path) fetches durable state exactly once, not twice', { skip: STUB_SKIP }, () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow');
  seedDurableCursors(root, {});
  const { logFile, env } = makeGitSpy();
  const res = cli(['next-target', '--root', root], { env });
  assert.strictEqual(res.status, 0, res.stderr);
  const log = fs.readFileSync(logFile, 'utf8');
  const fetchCalls = log.split('\n').filter((line) => /(^|\s)fetch(\s|$)/.test(line)).length;
  assert.strictEqual(
    fetchCalls,
    1,
    'cmdNextTarget must call readDurableState exactly once per invocation (a second call would double the git fetch/show round-trips)',
  );
});

// No --root: the root defaults to the cwd the call was given (the injected one, never the test process's).
test('next-target without --root selects from the injected cwd', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow');
  const res = cli(['next-target'], { cwd: root });
  assert.strictEqual(res.status, 0, res.stderr);
  const result = JSON.parse(res.stdout);
  assert.strictEqual(result.target.id, 'checkout-flow');
  assert.strictEqual(result.target.why, 'stale');
});

// Two sequential in-process calls against two different fixture roots: nothing the first call
// left in the process (cwd, env, module state) leaks into the second one's answer.
test('two sequential in-process next-target calls on different roots each answer for their own root', () => {
  const fixture = (journey) => {
    const root = tmp();
    writeJourney(root, journey);
    return root;
  };
  const first = runNextTarget([], fixture('alpha'));
  const second = runNextTarget([], fixture('beta'));
  assert.strictEqual(first.target.id, 'alpha');
  assert.strictEqual(second.target.id, 'beta');
});
