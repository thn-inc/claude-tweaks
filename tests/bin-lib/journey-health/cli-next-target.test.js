const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'journey-health.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'journey-health-cli-next-')); }

// Wraps `git` with a logging shim on PATH so a test can count how many times
// the CLI shells out to git (fetch/show), without needing a real GitHub-hosted
// remote. Mirrors tests/bin-lib/harness-health/cli-next-target.test.js's
// makeGitSpy.
function makeGitSpy() {
  const spyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-health-nt-gitspy-'));
  const logFile = path.join(spyDir, 'git-calls.log');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(
    path.join(spyDir, 'git'),
    `#!/bin/sh\necho "$@" >> "${logFile}"\nexec "${realGit}" "$@"\n`,
  );
  fs.chmodSync(path.join(spyDir, 'git'), 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  return logFile;
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
  const raw = execFileSync('node', [CLI, 'next-target', '--root', root], { encoding: 'utf8' });
  const result = JSON.parse(raw);
  assert.strictEqual(result.target, null);
  assert.strictEqual(result.coverageScanDue, true);
});

test('next-target defaults to the light tier and force-picks a never-audited journey', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow');
  const raw = execFileSync('node', [CLI, 'next-target', '--root', root], { encoding: 'utf8' });
  const result = JSON.parse(raw);
  assert.strictEqual(result.target.id, 'checkout-flow');
  assert.strictEqual(result.target.why, 'stale');
});

test('next-target --target bypasses selection with why: "manual"', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow');
  writeJourney(root, 'signup-flow');
  const raw = execFileSync('node', [CLI, 'next-target', '--target', 'signup-flow', '--root', root], { encoding: 'utf8' });
  const result = JSON.parse(raw);
  assert.strictEqual(result.target.id, 'signup-flow');
  assert.strictEqual(result.target.why, 'manual');
});

test('next-target --tier deep uses the deep-tier cursor field', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow');
  const raw = execFileSync('node', [CLI, 'next-target', '--tier', 'deep', '--root', root], { encoding: 'utf8' });
  const result = JSON.parse(raw);
  assert.strictEqual(result.target.id, 'checkout-flow');
  assert.strictEqual(result.target.why, 'stale');
});

test('next-target --budget 2 does not repeat the same deleted-file journey across multiple targets', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow');
  writeJourney(root, 'signup-flow');
  fs.rmSync(path.join(root, 'src', 'checkout-flow.tsx'));
  const raw = execFileSync('node', [CLI, 'next-target', '--budget', '2', '--root', root], { encoding: 'utf8' });
  const result = JSON.parse(raw);
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
  const raw = execFileSync('node', [CLI, 'next-target', '--root', root], { encoding: 'utf8' });
  const result = JSON.parse(raw);
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
    const target = JSON.parse(execFileSync('node', [CLI, 'next-target', '--root', root], { encoding: 'utf8' })).target;
    assert.ok(target, `run ${run} selected nothing at all`);
    audited.push(target.id);
    // The real Step 5 light-tier call — the one that records the cursor,
    // including the deleted-file acknowledgement. It runs even with zero
    // findings, which is exactly why the acknowledgement lands.
    execFileSync('node', [
      CLI, 'validate-findings', findingsFile, '--root', root,
      '--tier', 'light', '--target', target.id, '--run-id', `run-${run}`,
    ], { encoding: 'utf8' });
  }

  assert.deepStrictEqual(audited, ids, 'the rotation must reach every journey, not re-pick the broken one');
});

test('next-target (default no --target path) fetches durable state exactly once, not twice', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow');
  seedDurableCursors(root, {});
  const logFile = makeGitSpy();
  execFileSync('node', [CLI, 'next-target', '--root', root], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${path.dirname(logFile)}:${process.env.PATH}` },
  });
  const log = fs.readFileSync(logFile, 'utf8');
  const fetchCalls = log.split('\n').filter((line) => /(^|\s)fetch(\s|$)/.test(line)).length;
  assert.strictEqual(
    fetchCalls,
    1,
    'cmdNextTarget must call readDurableState exactly once per invocation (a second call would double the git fetch/show round-trips)',
  );
});
