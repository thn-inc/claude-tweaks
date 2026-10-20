'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

// #1130: never let an omitted cwd fall through to the spawned subprocess's
// own process.cwd() — that is the test runner's real working directory, and
// when npm test runs from a real checkout, hooks that walk
// .claude-tweaks/pipelines/ from there write fixture events into REAL run
// dirs (the #657 pollution incident). Calls that don't care about cwd get an
// isolated, non-git sandbox instead.
const HOOK_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-archrun-sandbox-'));

function runHook(args, { cwd = HOOK_SANDBOX, env = {} } = {}) {
  try {
    // #1130: `PIPELINE_RUN_DIR: ''` neutralizes any ambient run-dir env var
    // so a call that doesn't explicitly pass one can't resolve against
    // whatever real run happens to be ambient in this test runner's own
    // process.env (e.g. when npm test itself runs inside a /flow-dispatched
    // shell). A caller that needs a run dir still passes it explicitly via
    // `env`, which wins because it spreads last.
    const stdout = execFileSync('node', [HOOKS, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', ...env } });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '' };
  }
}

function runDirFixture(status) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-archrun-')));
  git(['init', '-q', '--initial-branch=main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);

  const runId = '2026-08-14T120000-spec-999';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status }));

  return { root, runDir, runId };
}

test('archive-run: refuses a run with status active, naming close-run as the prerequisite', () => {
  const { root, runDir } = runDirFixture('active');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /close-run/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')));
});

test('archive-run: refuses a run with status interrupted', () => {
  const { root, runDir } = runDirFixture('interrupted');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /interrupted/);
  assert.ok(fs.existsSync(runDir));
});

test('archive-run: refuses a run dir with no run-state.json, naming archiveOrphanedMint', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-archrun-orphan-')));
  git(['init', '-q', '--initial-branch=main'], root);
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-14T120000-spec-orphan');
  fs.mkdirSync(runDir, { recursive: true });
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archiveOrphanedMint/);
});

test('archive-run: archives a clean fixture and prints one moved: line per entry', () => {
  const { root, runDir, runId } = runDirFixture('clean');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /moved: config\.yml/);
  assert.match(result.stdout, /moved: decisions\.md/);
  assert.ok(!fs.existsSync(runDir));
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(path.join(archiveDir, 'config.yml')));
});

test('archive-run: never prints a moved: line for a name absent from the fixture (no hardcoded list)', () => {
  const { root, runDir } = runDirFixture('clean');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  // This fixture never creates manifest.yml/events.jsonl/console.json/staged —
  // a hardcoded fixed-list printer would still claim they were moved.
  assert.doesNotMatch(result.stdout, /moved: manifest\.yml/);
  assert.doesNotMatch(result.stdout, /moved: events\.jsonl/);
  assert.doesNotMatch(result.stdout, /moved: console\.json/);
  assert.doesNotMatch(result.stdout, /moved: staged/);
});

// Regression: a *-sweep-standalone*/*-tidy-standalone* run's decisions.md/
// staged only become git-tracked once their worktree copy has merged AND
// this checkout has pulled that merge (SKILL.md's pr-first Step 7.5) — a
// real window where they exist on disk here but are genuinely untracked.
// The CLI must name the untracked files and point at the actual fix (sync
// this checkout), not the generic 'archival refused — git-mv-failed' a
// human has no way to act on.
test('archive-run: sweep-standalone run with untracked decisions.md/staged refuses audit-untracked, names the files and the fix', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-archrun-standalone-')));
  git(['init', '-q', '--initial-branch=main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);

  const runId = '2026-08-14T120000-sweep-standalone';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n');
  fs.writeFileSync(path.join(runDir, 'staged', 'proposal-1.md'), '# proposal\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'clean' }));

  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — audit-untracked/);
  assert.match(result.stdout, /decisions\.md/);
  assert.match(result.stdout, /staged/);
  assert.match(result.stdout, /sync this checkout with origin/);
  assert.ok(fs.existsSync(runDir), 'run dir must not be touched');
  assert.ok(fs.existsSync(path.join(runDir, 'decisions.md')), 'decisions.md must survive at its original path');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(!fs.existsSync(path.join(archiveDir, 'decisions.md')), 'no half-populated archive dir');
});

// #1130 AC4: the direct CLI verb is wrap-up's own archival route and already
// requires terminal status, but a run parked with a rendered-but-unanswered
// PR console (console.json present, resolved !== true) could still be
// archived by a mistaken direct call — sweeping staged decisions before the
// human answered. Parity with decideArchive's console-unresolved skip.
test('archive-run: refuses a terminal run whose console.json is rendered but unresolved', () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ commentIds: ['IC_x'], prNumber: 5, items: [], resolved: false }));
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-unresolved/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

// #1130: no production path writes `resolved` (console-execution's own
// completion write only stamped `executedAt`) — pinning readConsoleState to
// `resolved === true` alone made this verb's console gate refuse every real
// answered console forever, since close-run had already made the run
// terminal before this verb ever runs. A non-empty `executedAt` with no
// `resolved` field must archive successfully.
test('archive-run: archives a terminal run whose console.json carries executedAt but no resolved field', () => {
  const { root, runDir, runId } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    commentIds: ['IC_x'], prNumber: 5, items: [], executedAt: '2026-08-20T10:00:00Z',
  }));
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(path.join(archiveDir, 'config.yml')));
});

// #1130 AC2: the two-call dispatch handoff shape, walked end-to-end on ONE
// run dir — call 1 (build,test) parks the run with a rendered-but-unanswered
// PR console; between calls the run is closed terminal (close-run) but its
// console is still unanswered, and archival must refuse even though status
// is clean; then the console is executed (executedAt stamped, the only field
// pre-resolved-era writers set) and the same archival call succeeds. This is
// the exact sequence in which the original #657 incident's run was archived
// prematurely.
test('archive-run: parked-dispatch handoff — refuses while the parked console is unanswered, archives after execution stamps executedAt', () => {
  const { root, runDir, runId } = runDirFixture('clean');
  // Call 1 parked: console rendered to the PR, not yet answered.
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ commentIds: ['IC_park'], prNumber: 9, items: [{ id: 'staged-1', kind: 'staged' }] }));
  const refused = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(refused.stdout, /archival refused — console-unresolved/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'parked run must stay in place');

  // Call 2 (or a reconcile console pass) executes the console: executedAt stamped.
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ commentIds: ['IC_park'], prNumber: 9, items: [{ id: 'staged-1', kind: 'staged' }], executedAt: '2026-08-22T12:00:00Z' }));
  const archived = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(archived.stdout, new RegExp(`archived ${runId}`));
  assert.strictEqual(fs.existsSync(runDir), false);
});

// #3668: the fast-lane auto-merge short-circuit
// (wrap-up/auto-merge-short-circuit.md) renders no console and leaves nothing to
// answer, so 'none' is normally safe to archive. Staged items it left behind
// were never shown to a human, though — so that one path refuses while staged/
// holds pending items. Other terminal runs that retain staged/ (in-terminal
// consoles, fleet-approved closes) still archive.
const FAST_LANE_FYI = '- AUTO 19:26:04 — log-decision: Fast-lane auto-merge: issue #3130, assess-agent-autonomy verdict auto-merge, pr-first-merge outcome merged.\n';

test('AC1.1: archive-run refuses a terminal fast-lane run with no console.json and a pending staged/ item, naming it', () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), FAST_LANE_FYI);
  fs.mkdirSync(path.join(runDir, 'staged'));
  fs.writeFileSync(path.join(runDir, 'staged', 'reflect-1.md'), '# proposal\n');
  fs.writeFileSync(path.join(runDir, 'staged', 'wrap-up-skill-1.md'), '# proposal\n');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-never-rendered-staged-pending/);
  assert.match(result.stdout, /staged\/reflect-1\.md/);
  assert.match(result.stdout, /staged\/wrap-up-skill-1\.md/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('AC1.2: archive-run refuses when the only pending items sit under spec-N/staged/', () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), FAST_LANE_FYI);
  fs.mkdirSync(path.join(runDir, 'spec-3375', 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'spec-3375', 'staged', 'review-1.patch'), 'x');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-never-rendered-staged-pending/);
  assert.match(result.stdout, /spec-3375\/staged\/review-1\.patch/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('AC2.1: archive-run still archives a terminal fast-lane run with no console.json and nothing pending', () => {
  const { root, runDir, runId } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), FAST_LANE_FYI);
  fs.mkdirSync(path.join(runDir, 'staged'));
  fs.writeFileSync(path.join(runDir, 'staged', '.DS_Store'), 'x');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(path.join(archiveDir, 'config.yml')));
});

test('archive-run archives a terminal run with retained staged/ items and no fast-lane short-circuit line (#3668 scope)', () => {
  const { root, runDir, runId } = runDirFixture('clean');
  fs.mkdirSync(path.join(runDir, 'staged'));
  fs.writeFileSync(path.join(runDir, 'staged', 'shipped-close-3175.md'), '# proposal\n');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(path.join(archiveDir, 'staged', 'shipped-close-3175.md')));
});

test('cleanup-procedures-execution.md Section B invokes archive-run instead of a hand-run recipe', () => {
  const text = fs.readFileSync(
    path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', 'cleanup-procedures-execution.md'),
    'utf8',
  );
  const bStart = text.indexOf('## B.');
  const cStart = text.indexOf('## C.');
  assert.ok(bStart !== -1 && cStart !== -1, 'Section B/C headings must exist');
  const sectionB = text.slice(bStart, cStart);
  assert.ok(sectionB.includes('hooks.js" archive-run'), 'Section B must invoke the archive-run verb');
  assert.ok(!/\bgit mv\b/.test(sectionB), 'Section B must not hand-run git mv anymore');
  assert.ok(!/\bmv\s+"\$RUN_DIR"/.test(sectionB), 'Section B must not hand-run a raw mv on $RUN_DIR anymore');
});
