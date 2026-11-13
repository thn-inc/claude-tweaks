const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CLI, REPO_ROOT, runExpectingFailure } = require('./cli-helpers');

test('omitting --base exits 2 with the usage message on stderr', () => {
  const error = runExpectingFailure([]);
  assert.strictEqual(error.status, 2);
  assert.match(error.stderr, /usage: residue\.js --base <commit-ish>/);
});

// #1781: --own-pr parses as an integer and threads through to the forge
// probe's `ownPr` result field.
test('#1781: --own-pr 42 parses and is not itself an open PR here, so ownPr is null', () => {
  const out = execFileSync('node', [CLI, '--base', 'HEAD', '--no-suite', '--json', '--own-pr', '42'], {
    cwd: REPO_ROOT, encoding: 'utf8',
  });
  const parsed = JSON.parse(out);
  // results[2] is the forge probe (worktrees, branches, forge, suite, release, pipeline-runs, artifacts).
  assert.ok(Object.prototype.hasOwnProperty.call(parsed.results[2], 'ownPr'), 'forge result carries an ownPr field');
});

test('#1781: a non-integer --own-pr value is rejected with the usage error', () => {
  const error = runExpectingFailure(['--base', 'HEAD', '--own-pr', 'not-a-number']);
  assert.strictEqual(error.status, 2);
  assert.match(error.stderr, /--own-pr must be an integer/);
});

// End-to-end through the CLI's own env-var wiring (bin/residue.js's
// PIPELINE_RUN_DIR -> runId basename), not just the probe function directly
// (tests/bin-lib/residue/probes-pipeline-runs.test.js already covers that) —
// #1118.
test('PIPELINE_RUN_DIR env attributes only that run dir under --scope blast-radius (#1118)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'residue-cli-pipeline-runs-'));
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', root, 'commit', '--allow-empty', '-q', '-m', 'init']);

  const pipelinesDir = path.join(root, '.claude-tweaks', 'pipelines');
  const ownRunDir = path.join(pipelinesDir, '2026-01-01T000000-record-1118');
  const siblingRunDir = path.join(pipelinesDir, '2026-01-01T000000-record-999');
  fs.mkdirSync(ownRunDir, { recursive: true });
  fs.mkdirSync(siblingRunDir, { recursive: true });
  fs.writeFileSync(path.join(ownRunDir, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  fs.writeFileSync(path.join(siblingRunDir, 'run-state.json'), JSON.stringify({ status: 'clean' }));

  const out = execFileSync('node', [CLI, '--base', 'HEAD', '--scope', 'blast-radius', '--json', '--no-suite'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PIPELINE_RUN_DIR: ownRunDir },
  });
  const parsed = JSON.parse(out);
  const pipelineRunFindings = parsed.results.flatMap((r) => r.findings).filter((f) => f.kind === 'pipeline-run');
  assert.strictEqual(pipelineRunFindings.length, 1, `expected exactly one attributable pipeline-run finding, got ${JSON.stringify(pipelineRunFindings)}`);
  // The length check above already excludes the sibling dir: it can only be
  // the one finding or an extra one, and this pins which of the two it is.
  assert.match(pipelineRunFindings[0].subject, /record-1118/, 'the sibling run dir must not be attributed to this run');
});

// #1281: runner()'s execFileSync call set no `maxBuffer`, so it silently
// inherited Node's 1 MiB default; probeRelease's `git show HEAD:CHANGELOG.md`
// is the one call through that seam that reads a file this repo's own
// CHANGELOG.md (~268KB and growing) could plausibly outgrow. A >1 MiB
// CHANGELOG.md used to overflow the default buffer, get swallowed by
// runner()'s bare `catch { return null; }`, and read as an ordinary
// `reason: 'could not read CHANGELOG.md or docs/shipped-versions.tsv at
// HEAD'` degraded probe rather than a distinguishable failure. Confirmed red
// against the pre-fix runner(): this exact fixture reproduced that reason.
test('probeRelease reads a >1 MiB CHANGELOG.md at HEAD without silently overflowing the default maxBuffer (#1281)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'residue-cli-maxbuffer-'));
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test']);

  // #2257: probeRelease no longer reads a plugin manifest at all — it needs
  // a .release-please-manifest.json BOOTSTRAP commit (its own `git log
  // --diff-filter=A` anchor) as a separate, earlier commit from the
  // CHANGELOG/tag one below, so the probe's own bootstrap-commit lookup has
  // something real to find.
  fs.writeFileSync(path.join(root, '.release-please-manifest.json'), JSON.stringify({ '.': '9.9.0' }));
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'bootstrap release-please']);

  // '# padding\n' is 10 bytes; 150,000 repeats is ~1.43 MiB, comfortably past
  // execFileSync's 1 MiB default so a real overflow (not a near-miss) is
  // what this fixture exercises.
  const changelog = '# padding\n'.repeat(150000) + '## v9.9.9 — test release\n';
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), changelog);
  assert.ok(Buffer.byteLength(changelog) > 1024 * 1024, 'fixture CHANGELOG.md must actually exceed the 1 MiB default');

  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'release v9.9.9']);
  execFileSync('git', ['-C', root, 'tag', 'v9.9.9']);

  const out = execFileSync('node', [CLI, '--base', 'HEAD', '--no-suite', '--json'], {
    cwd: root, encoding: 'utf8',
  });
  const parsed = JSON.parse(out);
  const overflowReason = /could not read CHANGELOG\.md or the v\* tag list at HEAD/;
  assert.ok(
    !parsed.results.some((r) => typeof r.reason === 'string' && overflowReason.test(r.reason)),
    `probeRelease must not silently fail to read a >1 MiB CHANGELOG.md, got results: ${JSON.stringify(parsed.results)}`,
  );
  assert.ok(
    !parsed.results.flatMap((r) => r.findings).some((f) => f.kind === 'release'),
    'the v9.9.9 tag and its CHANGELOG heading are both present, so a successful read reports zero release findings',
  );
});
