'use strict';
// In-process (#5375): the `archive-run` and `close-run` calls go through hooks.js's
// run(argv, deps) via runCli. Real-process coverage is the four AC9.1 smoke tests
// (each family's success twin and its unknown-flag refusal), each marked with its reason.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { readText } = require('./helpers/read-skill');
const { cleanGitEnv, writeIdentity } = require('./helpers/git-fixtures');
const { runCli, spawnCli } = require('./helpers/run-cli');
const { appendGitConfigEnv } = require('../tools/run-tests');
const { formatEntry } = require('../plugin/bin/lib/log-decision/append');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: cleanGitEnv() });
}

// #1130: never let an omitted cwd fall through to the spawned subprocess's
// own process.cwd() — that is the test runner's real working directory, and
// when npm test runs from a real checkout, hooks that walk
// .claude-tweaks/pipelines/ from there write fixture events into REAL run
// dirs (the #657 pollution incident). Calls that don't care about cwd get an
// isolated, non-git sandbox instead.
const HOOK_SANDBOX = scratchDir('ct-archrun-sandbox-');
// #5375 ledger row 2: the archive-run and close-run calls below run in this
// process, so a deps.cwd() -> process.cwd() regression in hooks.js would resolve
// the test runner's own working directory (a real checkout under npm test) and
// write archive/{runId}/ there before any assertion fails. Pinning this file's
// process to the non-git sandbox keeps such a regression's writes in a throwaway
// directory; every path this file reads is absolute, and runCli restores this
// cwd after each call.
process.chdir(HOOK_SANDBOX);

// The complete env a hooks.js call sees. #1130: `PIPELINE_RUN_DIR: ''`
// neutralizes any ambient run-dir env var so a call that doesn't explicitly
// pass one can't resolve against whatever real run happens to be ambient in
// this test runner's own process.env (e.g. when npm test itself runs inside a
// /flow-dispatched shell). A caller that needs a run dir still passes it
// explicitly via `env`, which wins because it spreads last.
function hookEnv(env = {}) {
  return { ...cleanGitEnv(), PIPELINE_RUN_DIR: '', ...env };
}

// -> Promise<{ code, stdout, stderr }>
function runHook(args, { cwd = HOOK_SANDBOX, env = {} } = {}) {
  return runCli(HOOKS, args, { cwd, env: hookEnv(env) });
}

function runDirFixture(status) {
  const root = fs.realpathSync(scratchDir('ct-archrun-'));
  git(['init', '-q', '--initial-branch=main'], root);
  writeIdentity(root, { name: 'Test', email: 'test@example.com' });
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

test('archive-run: refuses a run with status active, naming close-run as the prerequisite', async () => {
  const { root, runDir } = runDirFixture('active');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /close-run/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')));
});

test('archive-run: refuses a run with status interrupted', async () => {
  const { root, runDir } = runDirFixture('interrupted');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /interrupted/);
  assert.ok(fs.existsSync(runDir));
});

test('archive-run: refuses a run dir with no run-state.json, naming archiveOrphanedMint', async () => {
  const root = fs.realpathSync(scratchDir('ct-archrun-orphan-'));
  git(['init', '-q', '--initial-branch=main'], root);
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-14T120000-spec-orphan');
  fs.mkdirSync(runDir, { recursive: true });
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archiveOrphanedMint/);
});

test('archive-run: archives a clean fixture and prints one moved: line per entry', async () => {
  const { root, runDir, runId } = runDirFixture('clean');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /moved: config\.yml/);
  assert.match(result.stdout, /moved: decisions\.md/);
  assert.ok(!fs.existsSync(runDir));
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(path.join(archiveDir, 'config.yml')));
});

test('archive-run: never prints a moved: line for a name absent from the fixture (no hardcoded list)', async () => {
  const { root, runDir } = runDirFixture('clean');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  // This fixture never creates manifest.yml/events.jsonl/console.json/staged —
  // a hardcoded fixed-list printer would still claim they were moved.
  assert.doesNotMatch(result.stdout, /moved: manifest\.yml/);
  assert.doesNotMatch(result.stdout, /moved: events\.jsonl/);
  assert.doesNotMatch(result.stdout, /moved: console\.json/);
  assert.doesNotMatch(result.stdout, /moved: staged/);
});

// #5555: the typed verb reaches archiveRunDir, so a run it archives that was not yet `clean`
// (a state with no status passes the verb's active/interrupted refusal) gets phase rows and one token-pass spawn.
test('archive-run: a not-yet-clean run gets timing.json phase rows and exactly one recorded token-pass spawn', async () => {
  const atClose = require('../plugin/bin/lib/timing/at-close');
  const T = require('./helpers/close-timing');
  const { root, runDir, runId } = runDirFixture(undefined);
  T.writeEvents(runDir);
  const spawned = [];
  const result = await T.withStub(atClose, 'spawnTokenPass', (dir) => { spawned.push(dir); return { spawned: true, reason: 'stubbed' }; },
    () => runHook(['archive-run', '--run', runDir], { cwd: root }));
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.match(result.stdout, /moved: events\.jsonl/);
  T.assertPhaseRows(T.readTiming(archiveDir));
  assert.deepEqual(spawned, [archiveDir]);
});

// Regression: a *-sweep-standalone*/*-tidy-standalone* run's decisions.md/
// staged only become git-tracked once their worktree copy has merged AND
// this checkout has pulled that merge (SKILL.md's pr-first Step 7.5) — a
// real window where they exist on disk here but are genuinely untracked.
// The CLI must name the untracked files and point at the actual fix (sync
// this checkout), not the generic 'archival refused — git-mv-failed' a
// human has no way to act on.
test('archive-run: sweep-standalone run with untracked decisions.md/staged refuses audit-untracked, names the files and the fix', async () => {
  const root = fs.realpathSync(scratchDir('ct-archrun-standalone-'));
  git(['init', '-q', '--initial-branch=main'], root);
  writeIdentity(root, { name: 'Test', email: 'test@example.com' });
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);

  const runId = '2026-08-14T120000-sweep-standalone';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n');
  fs.writeFileSync(path.join(runDir, 'staged', 'proposal-1.md'), '# proposal\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'clean' }));

  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
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
// human answered. Parity with decideArchiveCore's console-unresolved skip.
test('archive-run: refuses a terminal run whose console.json is rendered but unresolved', async () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ commentIds: ['IC_x'], prNumber: 5, items: [], resolved: false }));
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-unresolved/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

// #1130: no production path writes `resolved` (console-execution's own
// completion write only stamped `executedAt`) — pinning readConsoleState to
// `resolved === true` alone made this verb's console gate refuse every real
// answered console forever, since close-run had already made the run
// terminal before this verb ever runs. A non-empty `executedAt` with no
// `resolved` field must archive successfully.
test('archive-run: archives a terminal run whose console.json carries executedAt but no resolved field', async () => {
  const { root, runDir, runId } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    commentIds: ['IC_x'], prNumber: 5, items: [], executedAt: '2026-08-20T10:00:00Z',
  }));
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
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

test('AC6: archive-run refuses a resolved console holding a keep-staged item (console-residue)', async () => {
  const { root, runDir } = runDirFixture('clean');
  residueConsole(runDir);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue \(1 unresolved item\(s\) no human has reviewed; review them, then run console-residue\.js --ack --run /);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('AC2: archive-run refuses a resolved console holding a pending item', async () => {
  const { root, runDir } = runDirFixture('clean');
  residueConsole(runDir, { resolution: 'pending' });
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('archive-run archives a residue console once a human has acknowledged it', async () => {
  const { root, runDir, runId } = runDirFixture('clean');
  residueConsole(runDir, { extra: { residueAcknowledgedAt: '2026-10-24T10:00:00Z' } });
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'config.yml')));
});

test('archive-run refuses when only a spec-N console holds residue', async () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true, items: [] }));
  residueConsole(runDir, { dir: path.join(runDir, 'spec-12') });
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue \(1 unresolved item\(s\)/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('archive-run refuses when there is no top-level console.json and only a spec-N console holds a keep-staged item', async () => {
  const { root, runDir } = runDirFixture('clean');
  residueConsole(runDir, { dir: path.join(runDir, 'spec-12') });
  assert.strictEqual(fs.existsSync(path.join(runDir, 'console.json')), false, 'fixture: no top-level console.json');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue \(1 unresolved item\(s\)/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('archive-run refuses when a spec-N console.json is unreadable (fails closed)', async () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true, items: [] }));
  fs.mkdirSync(path.join(runDir, 'spec-12'));
  fs.writeFileSync(path.join(runDir, 'spec-12', 'console.json'), '{not json');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue/);
  // --ack skips an unparseable console, so it is no remedy here: name the file to repair.
  assert.ok(result.stdout.includes(`repair or remove ${path.join(runDir, 'spec-12', 'console.json')}, then re-run archive-run`), result.stdout);
  assert.doesNotMatch(result.stdout, /--ack/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('archive-run names both remedies when residue items and an unreadable console.json both block', async () => {
  const { root, runDir } = runDirFixture('clean');
  residueConsole(runDir);
  fs.mkdirSync(path.join(runDir, 'spec-12'));
  fs.writeFileSync(path.join(runDir, 'spec-12', 'console.json'), '{not json');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
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

test('AC1.1: archive-run refuses an executed PR console holding a filing-failed item, naming it', async () => {
  const { root, runDir } = runDirFixture('clean');
  prConsole(runDir, [['1', 'executed'], ['f1', 'filing-failed']]);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue \(1 unresolved item\(s\) no human has reviewed; review them, then run console-residue\.js --ack --run .*\) — unresolved: f1 \(filing-failed\)\n$/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('AC1.1: console-residue.js --ack clears a filing-failed PR console and archive-run then archives', async () => {
  const { root, runDir } = runDirFixture('clean');
  prConsole(runDir, [['f1', 'filing-failed']]);
  execFileSync('node', [path.join(__dirname, '..', 'plugin', 'bin', 'console-residue.js'), '--ack', '--run', runDir], { cwd: root, encoding: 'utf8' });
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
});

test('AC2.1: archive-run archives an executed PR console with only executed/dropped items', async () => {
  const { root, runDir } = runDirFixture('clean');
  prConsole(runDir, [['1', 'executed'], ['d1', 'dropped']]);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
});

// #4170: a planned can't-tell filing with no filed line in decisions.md is `filing-pending` residue;
// the refusal names the default-selection `console-filings.js` re-run, and logging the filed line clears it.
function plannedFilingConsole(runDir, { filed = false } = {}) {
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    resolved: true,
    mode: 'auto-resolve',
    items: [{ id: 'tiebreak:aaaaaaaaaaaa', section: 'Low-confidence findings', resolution: 'filed', reason: 'r' }],
    filings: [{ item: 'tiebreak:aaaaaaaaaaaa', fingerprint: 'consolefinding-0123abcd', title: 't' }],
  }));
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '## /wrap-up\n' + (filed
    ? '- AUTO 10:00:00 — Queue write: tiebreak:aaaaaaaaaaaa filed as #501 (work-fingerprint consolefinding-0123abcd). Reversibility: n/a.\n'
    : ''));
}

test('AC3.1: archive-run refuses a console whose can\'t-tell filings never ran, naming the default-selection console-filings.js re-run', async () => {
  const { root, runDir } = runDirFixture('clean');
  plannedFilingConsole(runDir);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue \(1 unresolved item\(s\) no human has reviewed; re-run the planned filing\(s\): console-filings\.js --run ".*" --existing <issues\.json> --out-dir <dir> --digest-comments <comments\.json>, then file each printed `file` entry and log it as '\{item\} filed as #\{n\} \(work-fingerprint \{fp\}\)', hand-log any `logFailures` item as '\{item\} already filed as #\{n\} \(work-fingerprint \{fp\}\)' \(the CLI logs each `deduped` entry itself; a `drop` item's re-run logs its digested line instead\), via log-decision\.js `--run` that console's dir, per wrap-up\/review-console\.md's Can't-tell filings; review them, then run console-residue\.js --ack --run .*\) — unresolved: tiebreak:aaaaaaaaaaaa \(filing-pending\)\n$/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('archive-run refuses a console whose can\'t-tell digest entries never ran, naming the digest re-run (#4679)', async () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    resolved: true,
    mode: 'auto-resolve',
    items: [{ id: 'tiebreak:bbbbbbbbbbbb', section: 'Low-confidence findings', resolution: 'digested', reason: 'r' }],
    digests: [{ item: 'tiebreak:bbbbbbbbbbbb', fingerprint: 'consolefinding-4567ef01' }],
  }));
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '## /wrap-up\n');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue \(1 unresolved item\(s\) no human has reviewed; re-run the planned digest entries: console-filings\.js --run ".*" --existing <issues\.json> --out-dir <dir> --digest-comments <comments\.json>, then post each printed digest line .*; review them, then run console-residue\.js --ack --run .*\) — unresolved: tiebreak:bbbbbbbbbbbb \(digest-pending\)\n$/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('archive-run names the one re-run once for a console holding both a pending filing and a pending digest entry (#4679)', async () => {
  const { root, runDir } = runDirFixture('clean');
  plannedFilingConsole(runDir);
  const cj = JSON.parse(fs.readFileSync(path.join(runDir, 'console.json'), 'utf8'));
  cj.items.push({ id: 'tiebreak:bbbbbbbbbbbb', section: 'Low-confidence findings', resolution: 'digested', reason: 'r' });
  cj.digests = [{ item: 'tiebreak:bbbbbbbbbbbb', fingerprint: 'consolefinding-4567ef01' }];
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify(cj));
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue \(2 unresolved item\(s\)/);
  assert.strictEqual(result.stdout.split('console-filings.js --run').length, 2, `the command prints once: ${result.stdout}`);
  assert.match(result.stdout, /the same re-run also settles the planned digest entries/);
});

test('AC4.1: archive-run archives once the planned filing\'s filed line is logged', async () => {
  const { root, runDir } = runDirFixture('clean');
  plannedFilingConsole(runDir, { filed: true });
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
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
test('archive-run: parked-dispatch handoff — refuses while the parked console is unanswered, archives after execution stamps executedAt', async () => {
  const { root, runDir, runId } = runDirFixture('clean');
  // Call 1 parked: console rendered to the PR, not yet answered.
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ commentIds: ['IC_park'], prNumber: 9, items: [{ id: 'staged-1', kind: 'staged' }] }));
  const refused = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(refused.stdout, /archival refused — console-unresolved/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'parked run must stay in place');

  // Call 2 (or a reconcile console pass) executes the console: executedAt stamped.
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ commentIds: ['IC_park'], prNumber: 9, items: [{ id: 'staged-1', kind: 'staged' }], executedAt: '2026-08-22T12:00:00Z' }));
  const archived = await runHook(['archive-run', '--run', runDir], { cwd: root });
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

test('AC1.1: archive-run refuses a terminal fast-lane run with no console.json and a pending staged/ item, naming it', async () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), FAST_LANE_FYI);
  fs.mkdirSync(path.join(runDir, 'staged'));
  fs.writeFileSync(path.join(runDir, 'staged', 'reflect-1.md'), '# proposal\n');
  fs.writeFileSync(path.join(runDir, 'staged', 'wrap-up-skill-1.md'), '# proposal\n');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-never-rendered-staged-pending/);
  assert.match(result.stdout, /staged\/reflect-1\.md/);
  assert.match(result.stdout, /staged\/wrap-up-skill-1\.md/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('AC1.2: archive-run refuses when the only pending items sit under spec-N/staged/', async () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), FAST_LANE_FYI);
  fs.mkdirSync(path.join(runDir, 'spec-3375', 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'spec-3375', 'staged', 'review-1.patch'), 'x');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-never-rendered-staged-pending/);
  assert.match(result.stdout, /spec-3375\/staged\/review-1\.patch/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('AC2.1: archive-run still archives a terminal fast-lane run with no console.json and nothing pending', async () => {
  const { root, runDir, runId } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), FAST_LANE_FYI);
  fs.mkdirSync(path.join(runDir, 'staged'));
  fs.writeFileSync(path.join(runDir, 'staged', '.DS_Store'), 'x');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
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

test('#3740 bundle gate: archive-run refuses a terminal bundle run with no console.json and a pending staged/ item, naming it', async () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), BUNDLE_GATE);
  fs.mkdirSync(path.join(runDir, 'staged'));
  fs.writeFileSync(path.join(runDir, 'staged', 'reflect-1.md'), '# proposal\n');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-never-rendered-staged-pending/);
  assert.match(result.stdout, /\(an auto-merge path — the wrap-up short-circuit or the dispatch bundle Auto-merge gate — rendered no console; pending: staged\/reflect-1\.md/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('#3740 bundle gate: archive-run refuses when the only pending item sits under spec-N/staged/', async () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), BUNDLE_GATE);
  fs.mkdirSync(path.join(runDir, 'spec-3741', 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'spec-3741', 'staged', 'review-1.patch'), 'x');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-never-rendered-staged-pending/);
  assert.match(result.stdout, /spec-3741\/staged\/review-1\.patch/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('#3740 bundle gate: archive-run still archives a terminal bundle run with nothing pending', async () => {
  const { root, runDir, runId } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), BUNDLE_GATE);
  fs.mkdirSync(path.join(runDir, 'staged'));
  fs.writeFileSync(path.join(runDir, 'staged', '.DS_Store'), 'x');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(path.join(archiveDir, 'config.yml')));
});

test('#3740 bundle gate: archive-run still archives a terminal bundle run that has no staged/ directory at all', async () => {
  const { root, runDir, runId } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), BUNDLE_GATE);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'config.yml')));
});

test('#3740 bundle gate: archive-run refuses a local-merge group-line run with a pending staged/ item', async () => {
  const { root, runDir } = runDirFixture('clean');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), BUNDLE_GROUP);
  fs.mkdirSync(path.join(runDir, 'staged'));
  fs.writeFileSync(path.join(runDir, 'staged', 'reflect-1.md'), '# proposal\n');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-never-rendered-staged-pending/);
  assert.match(result.stdout, /staged\/reflect-1\.md/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('archive-run archives a terminal run with retained staged/ items and no fast-lane short-circuit line (#3668 scope)', async () => {
  const { root, runDir, runId } = runDirFixture('clean');
  fs.mkdirSync(path.join(runDir, 'staged'));
  fs.writeFileSync(path.join(runDir, 'staged', 'shipped-close-3175.md'), '# proposal\n');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
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

test('AC8.1: archive-run refuses a terminal run whose findings artifact lists an id with no tiebreak verdict line', async () => {
  const { root, runDir } = runDirFixture('clean');
  writeFindings(runDir, [tbFinding(TB_ID)]);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — tiebreak-coverage-missing \(1 listed finding\(s\) have no tiebreak verdict line: abc123def456\)/);
  assert.match(result.stdout, /delete review-findings\.json if the run predates the tiebreak/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('AC8.1: archive-run refuses a malformed findings artifact under tiebreak-artifact-invalid', async () => {
  const { root, runDir } = runDirFixture('clean');
  writeFindings(runDir, '{ not json');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — tiebreak-artifact-invalid \(review-findings\.json is present but unreadable or malformed\)/);
  assert.doesNotMatch(result.stdout, /tiebreak-coverage-missing/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('AC8.1: archive-run archives a run where every listed finding has a tiebreak verdict line', async () => {
  const { root, runDir, runId } = runDirFixture('clean');
  writeFindings(runDir, [tbFinding(TB_ID)]);
  fs.writeFileSync(path.join(runDir, 'decisions.md'), `- AUTO 10:00:00 — Tiebreak tiebreak:${TB_ID}: digested.\n`);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'review-findings.json')));
});

test('AC8.1: archive-run archives a run with no findings artifact exactly as before', async () => {
  const { root, runDir } = runDirFixture('clean');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /tiebreak/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
});

test('archive-run enforces a findings artifact inside spec-N/ of a multi-spec run, prefixing the id', async () => {
  const { root, runDir } = runDirFixture('clean');
  writeFindings(path.join(runDir, 'spec-3945'), [tbFinding(TB_ID)]);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /tiebreak-coverage-missing \(1 listed finding\(s\) have no tiebreak verdict line: spec-3945\/abc123def456\)/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('tiebreak refusals are evaluated after the console-unresolved guard', async () => {
  const { root, runDir } = runDirFixture('clean');
  writeFindings(runDir, [tbFinding(TB_ID)]);
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ commentIds: ['IC_x'], prNumber: 5, items: [], resolved: false }));
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /console-unresolved/);
  assert.doesNotMatch(result.stdout, /tiebreak-/);
});

test('the #3668 staged-pending refusal wins over a tiebreak refusal when a run trips both', async () => {
  for (const [body, tiebreakReason] of [[[tbFinding(TB_ID)], 'tiebreak-coverage-missing'], ['{ not json', 'tiebreak-artifact-invalid']]) {
    const { root, runDir } = runDirFixture('clean');
    fs.writeFileSync(path.join(runDir, 'decisions.md'), FAST_LANE_FYI);
    fs.mkdirSync(path.join(runDir, 'staged'));
    fs.writeFileSync(path.join(runDir, 'staged', 'reflect-1.md'), '# proposal\n');
    writeFindings(runDir, body);
    const both = await runHook(['archive-run', '--run', runDir], { cwd: root });
    assert.match(both.stdout, /archival refused — console-never-rendered-staged-pending/, tiebreakReason);
    assert.doesNotMatch(both.stdout, /tiebreak-/, tiebreakReason);
    assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
    // The same run trips the tiebreak refusal once the staged item is settled, so the fixture trips both.
    fs.rmSync(path.join(runDir, 'staged', 'reflect-1.md'));
    const tiebreakOnly = await runHook(['archive-run', '--run', runDir], { cwd: root });
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

test('AC1.1: archive-run refuses an auto-merge run with an unfiled can\'t-tell finding', async () => {
  const { root, runDir } = cantTellRun();
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — cant-tell-unfiled \(1 can't-tell finding\(s\) an auto-merge path never filed: tiebreak:0123456789ab\) — file the run's can't-tell findings/);
  assert.match(result.stdout, /, then re-run archive-run\n$/);
  // The printed hint is paste-ready: the real run dir, never the `{run-dir}` placeholder.
  assert.ok(result.stdout.includes(`console-filings.js --run "${runDir}"; a spec-N/-prefixed id is filed and logged with --run "${runDir}/spec-N"`), result.stdout);
  assert.ok(!result.stdout.includes('{run-dir}'), result.stdout);
  assert.equal(result.code, 0);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('archive-run archives the same run once its finding has a filed line', async () => {
  const { root, runDir, runId } = cantTellRun();
  const deps = { readFile: (p) => fs.readFileSync(p, 'utf8'), readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } } };
  const [{ fingerprint }] = require('../plugin/bin/lib/console/finding-outcomes').unfiledCantTell({ runDir, deps });
  // review-console.md's created filed line, built by the real producer (log-decision.js's formatEntry).
  const filed = formatEntry({
    status: 'AUTO', now: new Date(2026, 7, 14, 10, 1, 0), step: 'Queue write', reversibility: 'n/a',
    text: `tiebreak:${CANT_TELL_ID} filed as #501 (work-fingerprint ${fingerprint})`,
  });
  fs.appendFileSync(path.join(runDir, 'decisions.md'), `${filed}\n`);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'config.yml')));
});

test('archive-run: a rendered console turns the can\'t-tell guard off', async () => {
  const { root, runDir, runId } = cantTellRun();
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ commentIds: ['IC_x'], prNumber: 5, items: [], resolved: true, executedAt: '2026-08-14T12:00:00Z' }));
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /cant-tell-unfiled/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'config.yml')));
});

test('archive-run: a Review Console terminal decision line turns the can\'t-tell guard off', async () => {
  const { root, runDir, runId } = cantTellRun();
  // review-console-interactive.md's terminal-decision log line, built by the real producer.
  const terminal = formatEntry({ status: 'AUTO', now: new Date(2026, 7, 14, 10, 2, 0), step: 'Review Console', text: 'terminal decision approve-all', reversibility: 'n/a' });
  fs.appendFileSync(path.join(runDir, 'decisions.md'), `${terminal}\n`);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /cant-tell-unfiled/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'config.yml')));
});

test('#4773 #4834: archive-run refuses an undeclared flag (--dry-run) on stderr with exit 1, before any move or commit', async () => {
  const argOrders = [
    (runDir) => ['--run', runDir, '--dry-run'],
    (runDir) => ['--dry-run', '--run', runDir],
  ];
  for (const buildArgs of argOrders) {
    const { root, runDir, runId } = runDirFixture('clean');
    const headBefore = git(['rev-parse', 'HEAD'], root);
    const result = await runHook(['archive-run', ...buildArgs(runDir)], { cwd: root });
    assert.strictEqual(result.code, 1);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(result.stderr, "claude-tweaks: archive-run: unknown flag '--dry-run'\nclaude-tweaks: usage: archive-run [--run <dir>]\n");
    assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must stay in place');
    assert.ok(!fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId)), 'nothing archived');
    assert.strictEqual(git(['rev-parse', 'HEAD'], root), headBefore, 'no commit');
  }
});

// #3721: archive-run reports the commit it made on the main checkout's branch.
function trackedRunFixture() {
  const fx = runDirFixture('clean');
  fs.mkdirSync(path.join(fx.runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(fx.runDir, 'work', '999-spec.md'), '# 999\n');
  git(['add', path.join('.claude-tweaks', 'pipelines', fx.runId, 'work', '999-spec.md')], fx.root);
  git(['commit', '-q', '-m', 'materialize #999'], fx.root);
  return fx;
}

function addBareOrigin(root, branch = 'main') {
  const bare = fs.realpathSync(scratchDir('ct-archrun-origin-'));
  git(['init', '-q', '--bare'], bare);
  git(['remote', 'add', 'origin', bare], root);
  git(['push', '-q', '-u', 'origin', branch], root);
  return bare;
}

const COMMITTED = /^claude-tweaks: committed [0-9a-f]{7,} on \S+ \((not pushed — \d+ ahead of \S+|no upstream configured|push state unknown)\)$/m;

test('#3721 AC2.1: tracked work prints the committed line', async () => {
  const { root, runDir } = trackedRunFixture();
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, COMMITTED);
  assert.match(result.stdout, /\(no upstream configured\)$/m);
  const sha = git(['rev-parse', '--short', 'HEAD'], root).trim();
  assert.match(result.stdout, new RegExp(`^claude-tweaks: committed ${sha} on main \\(`, 'm'));
});

test('#3721 AC2.2: an untracked-only run prints no committed line', async () => {
  const { root, runDir } = runDirFixture('clean');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /^claude-tweaks: archived /m, 'the verb ran and archived');
  assert.doesNotMatch(result.stdout, /committed/);
});

test('#3721 AC3.1: a branch tracking an upstream at the pre-archive commit reports 1 ahead', async () => {
  const { root, runDir } = trackedRunFixture();
  addBareOrigin(root);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /\(not pushed — 1 ahead of origin\/main\)$/m);
});

test('#3721 upstream ref gone reports push state unknown', async () => {
  const { root, runDir } = trackedRunFixture();
  addBareOrigin(root);
  git(['update-ref', '-d', 'refs/remotes/origin/main'], root);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /\(push state unknown\)$/m);
  assert.strictEqual(result.code, 0);
});

test('#3721 detached HEAD reads no upstream configured', async () => {
  const { root, runDir } = trackedRunFixture();
  git(['checkout', '-q', '--detach'], root);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, / on detached \(no upstream configured\)$/m);
});

test('#3721 a real branch named detached keeps its push state', async () => {
  const { root, runDir } = trackedRunFixture();
  git(['checkout', '-q', '-b', 'detached'], root);
  addBareOrigin(root, 'detached');
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, / on detached \(not pushed — 1 ahead of origin\/detached\)$/m);
});

test('#3721 a tag named like the branch keeps the plain name and push state', async () => {
  const { root, runDir } = trackedRunFixture();
  addBareOrigin(root);
  git(['tag', 'main'], root);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, / on main \(not pushed — 1 ahead of origin\/main\)$/m);
});

test('#3721 invoked from a linked worktree names the main checkout\'s branch', async () => {
  const { root, runDir } = trackedRunFixture();
  addBareOrigin(root);
  const holder = fs.realpathSync(scratchDir('ct-archrun-wt-'));
  const wt = path.join(holder, 'wt');
  git(['worktree', 'add', '-q', '-b', 'other', wt], root);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: wt });
  // Pins that hooks.js probes from mainRoot: probing from the linked worktree would name `other` and no upstream.
  assert.match(result.stdout, / on main \(not pushed — 1 ahead of origin\/main\)$/m);
});

test('#3721 a refusal after the commit prints the refusal and the committed line', async () => {
  const { root, runDir } = trackedRunFixture();
  fs.writeFileSync(path.join(runDir, 'tracked-stray.md'), 'oops\n');
  git(['add', path.relative(root, path.join(runDir, 'tracked-stray.md'))], root);
  git(['commit', '-q', '-m', 'accidentally track a stray file'], root);
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — tracked-entry/);
  assert.match(result.stdout, COMMITTED);
  assert.strictEqual(result.code, 0);
});

// AC10.1 (#5375): the archive path's git children run through plugin/bin/lib/hooks/git-exec.js with
// repoPinnedEnv(), which drops GIT_DIR by design (#4178), so an env-only GIT_DIR fixture cannot steer
// them. This pins the injected cwd instead: a relative --run resolves against it, and the committed
// line names the branch of the repo it names, not the test process's own checkout.
test('AC10.1: archive-run resolves a relative --run against the injected cwd and names that repo\'s branch', async () => {
  const { root, runDir, runId } = trackedRunFixture();
  git(['checkout', '-q', '-b', 'ct-cwd-only'], root);
  const result = await runHook(['archive-run', '--run', path.join('.claude-tweaks', 'pipelines', runId)], { cwd: root });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`^claude-tweaks: archived ${runId}$`, 'm'));
  const sha = git(['rev-parse', '--short', 'HEAD'], root).trim();
  assert.match(result.stdout, new RegExp(`^claude-tweaks: committed ${sha} on ct-cwd-only \\(no upstream configured\\)$`, 'm'));
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
});

// AC10.1 (#5375): repoPinnedEnv() strips only the four repo-pointing variables, so a variable git still honours
// reaches the archive path's git children only through the injected env. The archive commit's author name pins
// archiveRunDir's children; an upstream configured only through GIT_CONFIG_* pins archiveCommitLine's push-state
// probe. Neither value is in this process's environment or the fixture's git config.
test('AC10.1: archive-run starts the archive commit and its push-state probe with the injected env', async () => {
  const { root, runDir, runId } = trackedRunFixture();
  const bare = fs.realpathSync(scratchDir('ct-archrun-origin-'));
  git(['init', '-q', '--bare'], bare);
  git(['remote', 'add', 'origin', bare], root);
  git(['push', '-q', 'origin', 'main'], root);
  // #5768: the upstream is appended to the runner's inherited GIT_CONFIG_* entries, so its maintenance-off
  // entries stay in place; only the GIT_CONFIG_* keys are kept, so hookEnv's removal of GIT_DIR and its
  // siblings is not undone by spreading the whole process.env over it.
  const withUpstream = appendGitConfigEnv(process.env, [['branch.main.remote', 'origin'], ['branch.main.merge', 'refs/heads/main']]);
  const env = {
    GIT_AUTHOR_NAME: 'ct-env-only-author',
    ...Object.fromEntries(Object.entries(withUpstream).filter(([k]) => /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(k))),
  };
  const result = await runHook(['archive-run', '--run', runDir], { cwd: root, env });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`^claude-tweaks: archived ${runId}$`, 'm'));
  assert.equal(git(['log', '-1', '--format=%an %s', 'HEAD'], root).trim(), `ct-env-only-author [reconcile] archive run ${runId}`);
  assert.match(result.stdout, /^claude-tweaks: committed [0-9a-f]{7,} on main \(not pushed — 1 ahead of origin\/main\)$/m);
});

// Real process: the archive-run family's success smoke test (AC9.1), twinned with the same archival in-process.
test('AC3.1 AC9.1: archive-run on a clean fixture through runCli and spawnCli prints the same moved: lines and exit 0', async () => {
  const inProcess = runDirFixture('clean');
  const spawned = runDirFixture('clean');
  const a = await runHook(['archive-run', '--run', inProcess.runDir], { cwd: inProcess.root });
  const b = spawnCli(HOOKS, ['archive-run', '--run', spawned.runDir], { cwd: spawned.root, env: hookEnv() });
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual(a, {
    code: 0, stdout: `moved: config.yml\nmoved: decisions.md\nmoved: run-state.json\nclaude-tweaks: archived ${inProcess.runId}\n`, stderr: '',
  });
  for (const f of [inProcess, spawned]) {
    assert.ok(!fs.existsSync(f.runDir), 'run dir must be moved');
    assert.ok(fs.existsSync(path.join(f.root, '.claude-tweaks', 'pipelines', 'archive', f.runId, 'config.yml')));
  }
});

// Every archive-run refusal but the flag guard's prints on stdout and exits 0.
test('archive-run on an active run refuses on stdout with exit 0 naming close-run', async () => {
  const { root, runDir, runId } = runDirFixture('active');
  const r = await runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.deepStrictEqual(r, {
    code: 0, stdout: `claude-tweaks: ${runId} is active — not archived; run close-run first (or let the owning session finish)\n`, stderr: '',
  });
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must stay in place');
});

// Real process: the archive-run family's refusal smoke test (AC9.1) — the script entry's non-zero exit and stderr.
test('AC9.1: node hooks.js archive-run --dry-run exits 1 naming the unknown flag', () => {
  const { root, runDir, runId } = runDirFixture('clean');
  const headBefore = git(['rev-parse', 'HEAD'], root);
  const r = spawnCli(HOOKS, ['archive-run', '--run', runDir, '--dry-run'], { cwd: root, env: hookEnv() });
  assert.deepStrictEqual(r, {
    code: 1, stdout: '', stderr: "claude-tweaks: archive-run: unknown flag '--dry-run'\nclaude-tweaks: usage: archive-run [--run <dir>]\n",
  });
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must stay in place');
  assert.ok(!fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId)), 'nothing archived');
  assert.strictEqual(git(['rev-parse', 'HEAD'], root), headBefore, 'no commit');
});

// close-run (#5375): a session id and plugin root pinned for both routes, so the stdout bytes are fixed.
const CLOSE_ENV = { CLAUDE_CODE_SESSION_ID: 'archive-run-verb-test', CLAUDE_PLUGIN_ROOT: '/ct-plugin-root' };

// An active run in a throwaway repo, stamped by the real record-worktree writer for CLOSE_ENV's session and
// bound to a scratch worktree path, with a work/ file so close-run prints its archive-run hint (the run path).
async function recordedRunFixture() {
  const fx = runDirFixture('active');
  const wt = fs.realpathSync(scratchDir('ct-archrun-closewt-'));
  fs.mkdirSync(path.join(fx.runDir, 'work'));
  fs.writeFileSync(path.join(fx.runDir, 'work', '999-spec.md'), '# 999\n');
  const stamp = await runHook(['record-worktree', '--run', fx.runDir, wt], { cwd: fx.root, env: CLOSE_ENV });
  assert.equal(stamp.code, 0, stamp.stderr + stamp.stdout);
  return { ...fx, wt };
}

// Real process: the close-run family's success smoke test (AC9.1), twinned with the same close in-process.
test('AC3.1 AC9.1: close-run on a recorded run through runCli and spawnCli returns the same code and stdout', async () => {
  const inProcess = await recordedRunFixture();
  const spawned = await recordedRunFixture();
  const a = await runHook(['close-run', '--run', inProcess.runDir], { cwd: inProcess.root, env: CLOSE_ENV });
  const b = spawnCli(HOOKS, ['close-run', '--run', spawned.runDir], { cwd: spawned.root, env: hookEnv(CLOSE_ENV) });
  const shape = (r, f) => ({ code: r.code, stdout: r.stdout.split(f.runDir).join('<run>'), stderr: r.stderr });
  assert.deepStrictEqual(shape(a, inProcess), shape(b, spawned));
  const id = inProcess.runId;
  assert.deepStrictEqual(shape(a, inProcess), {
    code: 0,
    stderr: '',
    stdout: `claude-tweaks: closing run ${id} with no recorded wrap-up invocation — expected if wrap-up was run manually `
      + '(typed slash commands leave no ledger event); otherwise consider /claude-tweaks:wrap-up before closing. '
      + 'Event recorded: close-without-wrapup.\n'
      + `claude-tweaks: run ${id} still holds un-archived work/ content — expected at this point in the normal wrap-up `
      + 'sequence (close-run always runs before archive-run); archival is still pending and will happen via the next '
      + 'routine reconcile pass, or you can archive it now: node "/ct-plugin-root/bin/hooks.js" archive-run --run "<run>"\n',
  });
  for (const f of [inProcess, spawned]) {
    const state = JSON.parse(fs.readFileSync(path.join(f.runDir, 'run-state.json'), 'utf8'));
    assert.equal(state.status, 'clean');
    assert.equal(state.worktree, null);
    assert.equal(state.worktreeAtClose, f.wt);
  }
});

// The verb prints this refusal on stdout, so the exact stderr is empty.
test('close-run with an unusable --run exits 1 on stdout naming the --run value', async () => {
  const { root, runDir } = runDirFixture('active');
  const state = path.join(runDir, 'run-state.json');
  const before = fs.readFileSync(state, 'utf8');
  const missing = path.join(root, 'no-such-run');
  const r = await runHook(['close-run', '--run', missing], { cwd: root });
  assert.deepStrictEqual(r, { code: 1, stdout: `claude-tweaks: --run path rejected: ${missing} — run not closed\n`, stderr: '' });
  assert.equal(fs.readFileSync(state, 'utf8'), before, 'run-state.json must not move');
});

// Real process: the close-run family's refusal smoke test (AC9.1) — the script entry's non-zero exit and stderr.
test('AC9.1: node hooks.js close-run --bogus exits 1 naming the unknown flag', () => {
  const { root, runDir } = runDirFixture('active');
  const state = path.join(runDir, 'run-state.json');
  const before = fs.readFileSync(state, 'utf8');
  const r = spawnCli(HOOKS, ['close-run', '--run', runDir, '--bogus'], { cwd: root, env: hookEnv() });
  assert.deepStrictEqual(r, {
    code: 1, stdout: '', stderr: "claude-tweaks: close-run: unknown flag '--bogus'\nclaude-tweaks: usage: close-run [--run <dir>]\n",
  });
  assert.equal(fs.readFileSync(state, 'utf8'), before, 'run-state.json must not move');
});
