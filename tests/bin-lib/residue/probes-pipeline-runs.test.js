const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { probePipelineRuns } = require('../../../plugin/bin/lib/residue/probes/pipeline-runs');
const { archiveRunDir } = require('../../../plugin/bin/lib/reconcile/archive-merged');
const { filterResultsByScope } = require('../../../plugin/bin/lib/residue/scope-filter');

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'residue-pipeline-runs-'));
  fs.mkdirSync(path.join(root, '.git')); // mainCheckoutRoot needs a repo marker
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive'), { recursive: true });
  return root;
}

function writeRun(root, name, state) {
  const dir = path.join(root, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(dir, { recursive: true });
  if (state !== null) {
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state));
  }
  return dir;
}

test('an un-archived clean run dir is reported with remedy auto', () => {
  const root = makeFixture();
  writeRun(root, '2026-01-01T000000-spec-1', { status: 'clean' });
  const { ran, findings } = probePipelineRuns({ cwd: root });
  assert.strictEqual(ran, true);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].kind, 'pipeline-run');
  assert.strictEqual(findings[0].remedy, 'auto');
  // No attribution inputs supplied -> nothing is provably this run's own (#1118).
  assert.strictEqual(findings[0].scope, 'observed');
  assert.match(findings[0].subject, /2026-01-01T000000-spec-1/);
});

// #1118 supersedes the #1011 audit that used to pin the opposite here:
// observed live during record #706's wrap-up, a `--scope blast-radius`
// sweep returned 6 un-archived clean run dirs belonging to OTHER records —
// exactly the cross-session noise residue-sweep.md documents blast-radius
// as excluding. A clean run dir is only this run's own blast radius when
// it can be attributed to the invoking run; sibling orphans stay visible
// under --scope repo (/tidy's sweep).
test('a clean run dir not attributable to the invoking run is observed (#1118)', () => {
  const root = makeFixture();
  writeRun(root, '2026-01-01T000000-record-999', { status: 'clean', worktree: path.join(root, 'elsewhere') });
  const { findings } = probePipelineRuns({ cwd: root, runId: '2026-01-02T000000-record-1118', worktreeRoot: root });
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].scope, 'observed');
});

test('a clean run dir whose name equals the invoking runId is blast-radius', () => {
  const root = makeFixture();
  writeRun(root, '2026-01-01T000000-record-1118', { status: 'clean' });
  const { findings } = probePipelineRuns({ cwd: root, runId: '2026-01-01T000000-record-1118' });
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].scope, 'blast-radius');
});

test('a clean run dir whose run-state worktree matches the invoking worktree root is blast-radius', () => {
  const root = makeFixture();
  // root sits under os.tmpdir(): on macOS that is a /var -> /private/var
  // symlink, so this test only passes when the probe realpaths BOTH sides.
  writeRun(root, '2026-01-01T000000-spec-7', { status: 'clean', worktree: root });
  const { findings } = probePipelineRuns({ cwd: root, worktreeRoot: root });
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].scope, 'blast-radius');
});

// Record #1118's acceptance criterion, end to end through the CLI's own
// filter: one attributable dir, one sibling dir — blast-radius keeps only
// the invoking run's own; repo scope still sees both, untouched.
test('AC #1118: blast-radius keeps only the attributable run dir; repo scope keeps both', () => {
  const root = makeFixture();
  writeRun(root, '2026-01-01T000000-record-1118', { status: 'clean', worktree: root });
  writeRun(root, '2026-01-01T000000-record-999', { status: 'clean', worktree: path.join(root, 'elsewhere') });
  const result = probePipelineRuns({ cwd: root, runId: '2026-01-01T000000-record-1118', worktreeRoot: root });
  assert.strictEqual(result.findings.length, 2);

  const [blast] = filterResultsByScope([result], 'blast-radius');
  assert.strictEqual(blast.findings.length, 1);
  assert.match(blast.findings[0].subject, /record-1118/);

  const [repo] = filterResultsByScope([result], 'repo');
  assert.strictEqual(repo.findings.length, 2);
});

test('a non-clean run dir is not reported', () => {
  const root = makeFixture();
  writeRun(root, '2026-01-01T000000-spec-2', { status: 'interrupted' });
  const { findings } = probePipelineRuns({ cwd: root });
  assert.deepStrictEqual(findings, []);
});

test('a run dir with no run-state.json is not reported', () => {
  const root = makeFixture();
  writeRun(root, '2026-01-01T000000-spec-3', null);
  const { findings } = probePipelineRuns({ cwd: root });
  assert.deepStrictEqual(findings, []);
});

test('the archive/ directory itself is never reported', () => {
  const root = makeFixture();
  // archive/ already exists from makeFixture(); it does not match RUN_ID_RE
  // and must never be treated as a candidate run dir.
  const { findings } = probePipelineRuns({ cwd: root });
  assert.deepStrictEqual(findings, []);
});

test('no .claude-tweaks/pipelines directory at all is a clean run with no findings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'residue-pipeline-runs-empty-'));
  fs.mkdirSync(path.join(root, '.git'));
  const { ran, findings } = probePipelineRuns({ cwd: root });
  assert.strictEqual(ran, true);
  assert.deepStrictEqual(findings, []);
});

test('a genuine readdir failure (not ENOENT) reports ran: false, not a clean sweep', () => {
  const root = makeFixture();
  // Replace the pipelines dir with a file so readdirSync fails with ENOTDIR
  // (not ENOENT) — the same "real error, not absence" shape as EACCES/EIO.
  fs.rmSync(path.join(root, '.claude-tweaks', 'pipelines'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'pipelines'), 'not a directory');
  const { ran, reason, findings } = probePipelineRuns({ cwd: root });
  assert.strictEqual(ran, false);
  assert.match(reason, /could not read \.claude-tweaks\/pipelines/);
  assert.deepStrictEqual(findings, []);
});

test('the flagged remedy is mechanically applicable: archiveRunDir moves a flagged dir under archive/', () => {
  const root = makeFixture();
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', root, 'commit', '--allow-empty', '-q', '-m', 'init']);

  const dir = writeRun(root, '2026-01-01T000000-spec-9', { status: 'clean' });

  const before = probePipelineRuns({ cwd: root });
  assert.strictEqual(before.findings.length, 1, 'the fixture must be flagged before remediation');

  const result = archiveRunDir(root, dir);
  assert.strictEqual(result.ok, true, `archiveRunDir failed: ${result.reason}`);

  const archivedPath = path.join(root, '.claude-tweaks', 'pipelines', 'archive', '2026-01-01T000000-spec-9');
  assert.strictEqual(fs.existsSync(archivedPath), true, 'the run dir must sit under archive/ after remediation');
  assert.strictEqual(fs.existsSync(dir), false, 'the original (un-archived) path must no longer exist');

  const after = probePipelineRuns({ cwd: root });
  assert.deepStrictEqual(after.findings, [], 'the archived dir must no longer be flagged');
});

// #1328: a status: clean finding must not be auto-archived while a live
// sibling session still holds its recorded worktree — cross-check against
// scope.worktrees (git worktree list --porcelain, already resolved by
// ../scope.js) rather than blindly assigning remedy: 'auto'. Both fixture
// scope values are constructed directly, per the record's own Acceptance
// Criteria, rather than shelling out to real git.
test('#1328: a clean run dir whose recorded worktree is currently locked downgrades to remedy record', () => {
  const root = makeFixture();
  const worktreePath = path.join(root, 'locked-worktree');
  fs.mkdirSync(worktreePath);
  writeRun(root, '2026-01-01T000000-spec-10', { status: 'clean', worktree: worktreePath });

  const scope = {
    ran: true,
    reason: null,
    worktrees: [
      { path: worktreePath, branch: 'worktree-dispatch-record-1328', locked: true, lockReason: 'claude session foo (pid 999999999)' },
    ],
  };
  const { findings } = probePipelineRuns({ cwd: root, scope });
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].remedy, 'record');
  assert.match(findings[0].evidence, /locked/);
});

test('#1328: a clean run dir whose worktree is null keeps remedy auto (no scope)', () => {
  const root = makeFixture();
  writeRun(root, '2026-01-01T000000-spec-11', { status: 'clean' });
  const { findings } = probePipelineRuns({ cwd: root });
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].remedy, 'auto');
});

test('#1328: a clean run dir whose worktree does not match any locked scope entry keeps remedy auto', () => {
  const root = makeFixture();
  const worktreePath = path.join(root, 'unlocked-worktree');
  fs.mkdirSync(worktreePath);
  writeRun(root, '2026-01-01T000000-spec-12', { status: 'clean', worktree: worktreePath });

  const scope = {
    ran: true,
    reason: null,
    worktrees: [
      { path: worktreePath, branch: 'worktree-dispatch-record-1328', locked: false, lockReason: null },
    ],
  };
  const { findings } = probePipelineRuns({ cwd: root, scope });
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].remedy, 'auto');
});

// #4138: a clean `*-tidy-standalone` / `*-sweep-standalone` run dir that still
// holds staged items is still approvable — `/claude-tweaks:tidy --approve`
// finds it by name glob under pipelines/, never under archive/, and archives
// it itself. The probe must leave it in place rather than flag it remedy: auto.
function writeStaged(dir, names) {
  fs.mkdirSync(path.join(dir, 'staged'), { recursive: true });
  for (const name of names) fs.writeFileSync(path.join(dir, 'staged', name), 'proposal');
}

test('#4138: a clean tidy-standalone run dir with a non-empty staged/ is not reported', () => {
  const root = makeFixture();
  const dir = writeRun(root, '2026-01-01T000000-tidy-standalone', { status: 'clean' });
  writeStaged(dir, ['01-close-issue.md']);
  const { ran, findings } = probePipelineRuns({ cwd: root });
  assert.strictEqual(ran, true);
  assert.deepStrictEqual(findings, []);
});

test('#4138: a clean sweep-standalone run dir with a non-empty staged/ is not reported', () => {
  const root = makeFixture();
  const dir = writeRun(root, '2026-01-01T000000-sweep-standalone', { status: 'clean' });
  writeStaged(dir, ['01-close-issue.md']);
  const { findings } = probePipelineRuns({ cwd: root });
  assert.deepStrictEqual(findings, []);
});

test('#4138 control: a clean tidy-standalone run dir with an empty or absent staged/ keeps remedy auto', () => {
  const root = makeFixture();
  writeStaged(writeRun(root, '2026-01-01T000000-tidy-standalone', { status: 'clean' }), []);
  writeRun(root, '2026-01-02T000000-tidy-standalone', { status: 'clean' });
  const { findings } = probePipelineRuns({ cwd: root });
  assert.strictEqual(findings.length, 2);
  assert.ok(findings.every((f) => f.remedy === 'auto'));
});

test('#4138 control: a clean non-tidy/sweep run dir with a non-empty staged/ is still reported', () => {
  const root = makeFixture();
  writeStaged(writeRun(root, '2026-01-01T000000-dream-standalone', { status: 'clean' }), ['01-proposal.md']);
  writeStaged(writeRun(root, '2026-01-01T000000-record-42', { status: 'clean' }), ['01-proposal.md']);
  const { findings } = probePipelineRuns({ cwd: root });
  assert.strictEqual(findings.length, 2);
  assert.ok(findings.every((f) => f.remedy === 'auto'));
});
