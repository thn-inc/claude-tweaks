'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readText } = require('./helpers/read-skill');
const { formatEntry } = require('../plugin/bin/lib/log-decision/append');

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

// #3949: a resolved console that still holds an unresolved item no human has
// reviewed (it stays resolved for the executor, but archival is the last chance
// to surface it) blocks archival until `console-residue.js --ack`.
function residueConsole(runDir, { dir = runDir, resolution = 'keep-staged', extra = {} } = {}) {
  const id = 'review-debate-deviation.md';
  fs.mkdirSync(path.join(dir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'staged', id), '# proposal\n');
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({
    resolved: true, mode: 'auto-resolve', items: [{ id, section: 'Contested findings', resolution, reason: 'r' }], ...extra,
  }));
}

test('AC6: archive-run refuses a resolved console holding a keep-staged item (console-residue)', () => {
  const { root, runDir } = runDirFixture('clean');
  residueConsole(runDir);
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue \(1 unresolved item\(s\) no human has reviewed; review them, then run console-residue\.js --ack --run /);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('AC2: archive-run refuses a resolved console holding a pending item', () => {
  const { root, runDir } = runDirFixture('clean');
  residueConsole(runDir, { resolution: 'pending' });
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('archive-run archives a residue console once a human has acknowledged it', () => {
  const { root, runDir, runId } = runDirFixture('clean');
  residueConsole(runDir, { extra: { residueAcknowledgedAt: '2026-10-24T10:00:00Z' } });
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'config.yml')));
});

test('archive-run refuses when only a spec-N console holds residue', () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true, items: [] }));
  residueConsole(runDir, { dir: path.join(runDir, 'spec-12') });
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue \(1 unresolved item\(s\)/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('archive-run refuses when there is no top-level console.json and only a spec-N console holds a keep-staged item', () => {
  const { root, runDir } = runDirFixture('clean');
  residueConsole(runDir, { dir: path.join(runDir, 'spec-12') });
  assert.strictEqual(fs.existsSync(path.join(runDir, 'console.json')), false, 'fixture: no top-level console.json');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue \(1 unresolved item\(s\)/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('archive-run refuses when a spec-N console.json is unreadable (fails closed)', () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true, items: [] }));
  fs.mkdirSync(path.join(runDir, 'spec-12'));
  fs.writeFileSync(path.join(runDir, 'spec-12', 'console.json'), '{not json');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue/);
  // --ack skips an unparseable console, so it is no remedy here: name the file to repair.
  assert.ok(result.stdout.includes(`repair or remove ${path.join(runDir, 'spec-12', 'console.json')}, then re-run archive-run`), result.stdout);
  assert.doesNotMatch(result.stdout, /--ack/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('archive-run names both remedies when residue items and an unreadable console.json both block', () => {
  const { root, runDir } = runDirFixture('clean');
  residueConsole(runDir);
  fs.mkdirSync(path.join(runDir, 'spec-12'));
  fs.writeFileSync(path.join(runDir, 'spec-12', 'console.json'), '{not json');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue \(1 unresolved item\(s\) no human has reviewed and 1 console\.json file\(s\) could not be read;/);
  assert.match(result.stdout, /console-residue\.js --ack --run /);
  assert.ok(result.stdout.includes(`repair or remove ${path.join(runDir, 'spec-12', 'console.json')}`), result.stdout);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

// #4172: a PR console's failed item (filing-failed / reverse-failed) is residue
// with no staged file behind it — the refusal names the item, and --ack clears it.
function prConsole(runDir, outcomes, extra = {}) {
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    prNumber: 42, commentIds: ['IC_1'], executedAt: '2026-10-25T10:00:00.000Z', resolved: false,
    items: outcomes.map(([id, outcome]) => ({ id, kind: 'staged', summary: id, outcome })), ...extra,
  }));
}

test('AC1.1: archive-run refuses an executed PR console holding a filing-failed item, naming it', () => {
  const { root, runDir } = runDirFixture('clean');
  prConsole(runDir, [['1', 'executed'], ['f1', 'filing-failed']]);
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue \(1 unresolved item\(s\) no human has reviewed; review them, then run console-residue\.js --ack --run .*\) — unresolved: f1 \(filing-failed\)\n$/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('AC1.1: console-residue.js --ack clears a filing-failed PR console and archive-run then archives', () => {
  const { root, runDir } = runDirFixture('clean');
  prConsole(runDir, [['f1', 'filing-failed']]);
  execFileSync('node', [path.join(__dirname, '..', 'plugin', 'bin', 'console-residue.js'), '--ack', '--run', runDir], { cwd: root, encoding: 'utf8' });
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
});

test('AC2.1: archive-run archives an executed PR console with only executed/dropped items', () => {
  const { root, runDir } = runDirFixture('clean');
  prConsole(runDir, [['1', 'executed'], ['d1', 'dropped']]);
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
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

// #3740: the dispatch bundle Auto-merge gate (dispatch/settle-and-merge.md) is a second
// auto-merge path that renders no console, so its pending staged/ items get the same guard.
const BUNDLE_GATE = '- AUTO 10:00:00 — Auto-merge gate: #3740 assess-agent-autonomy verdict auto-merge. Reversibility: n/a.\n'
  + '- AUTO 10:00:01 — Auto-merge gate: #3741 assess-agent-autonomy verdict auto-merge. Reversibility: n/a.\n';
const BUNDLE_GROUP = '- AUTO 10:10:00 — Auto-merge: group [3740, 3741], assess-agent-autonomy verdict auto-merge for every member (see each member\'s RATIONALE). Merge commit: abc1234. Reversibility: high (git revert). [lever: auto-merge-max-lines=400 (default); auto-merge-max-files=10 (default); merge-sensitive-paths=x (default)]\n';

test('#3740 bundle gate: archive-run refuses a terminal bundle run with no console.json and a pending staged/ item, naming it', () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), BUNDLE_GATE);
  fs.mkdirSync(path.join(runDir, 'staged'));
  fs.writeFileSync(path.join(runDir, 'staged', 'reflect-1.md'), '# proposal\n');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-never-rendered-staged-pending/);
  assert.match(result.stdout, /\(an auto-merge path — the wrap-up short-circuit or the dispatch bundle Auto-merge gate — rendered no console; pending: staged\/reflect-1\.md/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('#3740 bundle gate: archive-run refuses when the only pending item sits under spec-N/staged/', () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), BUNDLE_GATE);
  fs.mkdirSync(path.join(runDir, 'spec-3741', 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'spec-3741', 'staged', 'review-1.patch'), 'x');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-never-rendered-staged-pending/);
  assert.match(result.stdout, /spec-3741\/staged\/review-1\.patch/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('#3740 bundle gate: archive-run still archives a terminal bundle run with nothing pending', () => {
  const { root, runDir, runId } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), BUNDLE_GATE);
  fs.mkdirSync(path.join(runDir, 'staged'));
  fs.writeFileSync(path.join(runDir, 'staged', '.DS_Store'), 'x');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(path.join(archiveDir, 'config.yml')));
});

test('#3740 bundle gate: archive-run still archives a terminal bundle run that has no staged/ directory at all', () => {
  const { root, runDir, runId } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), BUNDLE_GATE);
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'config.yml')));
});

test('#3740 bundle gate: archive-run refuses a local-merge group-line run with a pending staged/ item', () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), BUNDLE_GROUP);
  fs.mkdirSync(path.join(runDir, 'staged'));
  fs.writeFileSync(path.join(runDir, 'staged', 'reflect-1.md'), '# proposal\n');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-never-rendered-staged-pending/);
  assert.match(result.stdout, /staged\/reflect-1\.md/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
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
  const text = readText(path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', 'cleanup-procedures-execution.md'));
  const bStart = text.indexOf('## B.');
  const cStart = text.indexOf('## C.');
  assert.ok(bStart !== -1 && cStart !== -1, 'Section B/C headings must exist');
  const sectionB = text.slice(bStart, cStart);
  assert.ok(sectionB.includes('hooks.js" archive-run'), 'Section B must invoke the archive-run verb');
  assert.ok(!/\bgit mv\b/.test(sectionB), 'Section B must not hand-run git mv anymore');
  assert.ok(!/\bmv\s+"\$RUN_DIR"/.test(sectionB), 'Section B must not hand-run a raw mv on $RUN_DIR anymore');
});

// #3945: a run whose review-findings.json lists a finding that has no
// `tiebreak:{id}` verdict line in decisions.md is refused (its unresolved
// finding would be archived unseen); a present-but-unparseable artifact is
// refused under its own reason; full coverage and no artifact archive as before.
const TB_ID = 'abc123def456';

function writeFindings(dir, body) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'review-findings.json'), typeof body === 'string' ? body : JSON.stringify(body));
}

const tbFinding = (id) => ({ id, lens: 'correctness', path: 'src/a.js', line: 3, claim: 'x', reporterSeverity: 'medium', kind: 'contested' });

test('AC8.1: archive-run refuses a terminal run whose findings artifact lists an id with no tiebreak verdict line', () => {
  const { root, runDir } = runDirFixture('clean');
  writeFindings(runDir, [tbFinding(TB_ID)]);
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — tiebreak-coverage-missing \(1 listed finding\(s\) have no tiebreak verdict line: abc123def456\)/);
  assert.match(result.stdout, /delete review-findings\.json if the run predates the tiebreak/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('AC8.1: archive-run refuses a malformed findings artifact under tiebreak-artifact-invalid', () => {
  const { root, runDir } = runDirFixture('clean');
  writeFindings(runDir, '{ not json');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — tiebreak-artifact-invalid \(review-findings\.json is present but unreadable or malformed\)/);
  assert.doesNotMatch(result.stdout, /tiebreak-coverage-missing/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('AC8.1: archive-run archives a run where every listed finding has a tiebreak verdict line', () => {
  const { root, runDir, runId } = runDirFixture('clean');
  writeFindings(runDir, [tbFinding(TB_ID)]);
  fs.writeFileSync(path.join(runDir, 'decisions.md'), `- AUTO 10:00:00 — Tiebreak tiebreak:${TB_ID}: digested.\n`);
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'review-findings.json')));
});

test('AC8.1: archive-run archives a run with no findings artifact exactly as before', () => {
  const { root, runDir } = runDirFixture('clean');
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /tiebreak/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
});

test('archive-run enforces a findings artifact inside spec-N/ of a multi-spec run, prefixing the id', () => {
  const { root, runDir } = runDirFixture('clean');
  writeFindings(path.join(runDir, 'spec-3945'), [tbFinding(TB_ID)]);
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /tiebreak-coverage-missing \(1 listed finding\(s\) have no tiebreak verdict line: spec-3945\/abc123def456\)/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('tiebreak refusals are evaluated after the console-unresolved guard', () => {
  const { root, runDir } = runDirFixture('clean');
  writeFindings(runDir, [tbFinding(TB_ID)]);
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ commentIds: ['IC_x'], prNumber: 5, items: [], resolved: false }));
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /console-unresolved/);
  assert.doesNotMatch(result.stdout, /tiebreak-/);
});

test('the #3668 staged-pending refusal wins over a tiebreak refusal when a run trips both', () => {
  for (const [body, tiebreakReason] of [[[tbFinding(TB_ID)], 'tiebreak-coverage-missing'], ['{ not json', 'tiebreak-artifact-invalid']]) {
    const { root, runDir } = runDirFixture('clean');
    fs.writeFileSync(path.join(runDir, 'decisions.md'), FAST_LANE_FYI);
    fs.mkdirSync(path.join(runDir, 'staged'));
    fs.writeFileSync(path.join(runDir, 'staged', 'reflect-1.md'), '# proposal\n');
    writeFindings(runDir, body);
    const both = runHook(['archive-run', '--run', runDir], { cwd: root });
    assert.match(both.stdout, /archival refused — console-never-rendered-staged-pending/, tiebreakReason);
    assert.doesNotMatch(both.stdout, /tiebreak-/, tiebreakReason);
    assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
    // The same run trips the tiebreak refusal once the staged item is settled, so the fixture trips both.
    fs.rmSync(path.join(runDir, 'staged', 'reflect-1.md'));
    const tiebreakOnly = runHook(['archive-run', '--run', runDir], { cwd: root });
    assert.match(tiebreakOnly.stdout, new RegExp(`archival refused — ${tiebreakReason} `), tiebreakReason);
    assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
  }
});

// #4171: the auto-merge short-circuit renders no console, so a can't-tell finding the run held and
// never filed would be archived unseen. archive-run refuses until each has a filed line.
const CANT_TELL_ID = '0123456789ab';
const CANT_TELL_VERDICT = `- STAGED 10:00:00 — Tiebreak tiebreak:${CANT_TELL_ID}: lens "3a" finding src/a.js:3 console: verdict:cant-tell. Severity: medium. Recommendation: file.\n`;

function cantTellRun() {
  const f = runDirFixture('clean');
  fs.writeFileSync(path.join(f.runDir, 'decisions.md'), FAST_LANE_FYI + CANT_TELL_VERDICT);
  writeFindings(f.runDir, [{ ...tbFinding(CANT_TELL_ID), lens: '3a', kind: 'unconfirmed' }]);
  return f;
}

test('AC1.1: archive-run refuses an auto-merge run with an unfiled can\'t-tell finding', () => {
  const { root, runDir } = cantTellRun();
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — cant-tell-unfiled \(1 can't-tell finding\(s\) an auto-merge path never filed: tiebreak:0123456789ab\) — file the run's can't-tell findings/);
  assert.match(result.stdout, /, then re-run archive-run\n$/);
  // The printed hint is paste-ready: the real run dir, never the `{run-dir}` placeholder.
  assert.ok(result.stdout.includes(`console-filings.js --run "${runDir}"; a spec-N/-prefixed id is filed and logged with --run "${runDir}/spec-N"`), result.stdout);
  assert.ok(!result.stdout.includes('{run-dir}'), result.stdout);
  assert.equal(result.code, 0);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('archive-run archives the same run once its finding has a filed line', () => {
  const { root, runDir, runId } = cantTellRun();
  const deps = { readFile: (p) => fs.readFileSync(p, 'utf8'), readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } } };
  const [{ fingerprint }] = require('../plugin/bin/lib/console/finding-outcomes').unfiledCantTell({ runDir, deps });
  // review-console.md's created filed line, built by the real producer (log-decision.js's formatEntry).
  const filed = formatEntry({
    status: 'AUTO', now: new Date(2026, 7, 14, 10, 1, 0), step: 'Queue write', reversibility: 'n/a',
    text: `tiebreak:${CANT_TELL_ID} filed as #501 (work-fingerprint ${fingerprint})`,
  });
  fs.appendFileSync(path.join(runDir, 'decisions.md'), `${filed}\n`);
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'config.yml')));
});

test('archive-run: a rendered console turns the can\'t-tell guard off', () => {
  const { root, runDir, runId } = cantTellRun();
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ commentIds: ['IC_x'], prNumber: 5, items: [], resolved: true, executedAt: '2026-08-14T12:00:00Z' }));
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /cant-tell-unfiled/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'config.yml')));
});

test('archive-run: a Review Console terminal decision line turns the can\'t-tell guard off', () => {
  const { root, runDir, runId } = cantTellRun();
  // review-console-interactive.md's terminal-decision log line, built by the real producer.
  const terminal = formatEntry({ status: 'AUTO', now: new Date(2026, 7, 14, 10, 2, 0), step: 'Review Console', text: 'terminal decision approve-all', reversibility: 'n/a' });
  fs.appendFileSync(path.join(runDir, 'decisions.md'), `${terminal}\n`);
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /cant-tell-unfiled/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'config.yml')));
});
