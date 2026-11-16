'use strict';
// #4505 AC1/AC2: the gh host seam end to end. Each case runs the real code
// against a temp git repo whose origin is a GitHub Enterprise Cloud host
// (acme.ghe.com) or github.com, with a fake `gh` on PATH that logs the
// GH_HOST it was spawned with plus its argv. GH_HOST is removed from every
// spawned env (and from process.env for the in-process cases), so a shell
// that exports it cannot decide the outcome (AC4 suppresses injection then).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { STUB_SKIP, installStub } = require('./helpers/path-stub');
const { gateOriginRepo } = require('../plugin/bin/lib/repo-resolve');
const {
  GHE_ORIGIN, DOTCOM_ORIGIN, RUN_ID, BIN, tmp, git, makeRepo, installFakeGh, joinSpawnLines, childEnv, withoutGhHost, SEAM_NOTE, captureSeamNotes, node, networkLines, argsOf, argvReachesHost, reachesHost, assertEveryLineReaches, MATERIALIZE_RECORD, UNKNOWN_HOST, NOT_KNOWN_MSG, gatedEnv, runGated, repoValues, describeOriginGate, writeJsonFile, CLI_TABLE,
} = require('./helpers/gh-host-seam');

// The #4933 origin-gate table is split across this file (the first rows) and
// gh-host-seam-behavior-origin-gate.test.js (the rest), balanced by run time.

test('AC1.1: pr-checklist.js on a *.ghe.com origin sends gh pr view to the enterprise host', { skip: STUB_SKIP }, (t) => {
  const readLog = installFakeGh(t);
  const { repo, runDir } = makeRepo(t, GHE_ORIGIN);
  node(repo, [path.join(BIN, 'pr-checklist.js'), '--run', runDir, '--phase', 'build']);
  const lines = readLog();
  assert.ok(lines.some((l) => / ARGS=pr view 7 /.test(l)), `no gh pr view call, log:\n${lines.join('\n')}`);
  assertEveryLineReaches(lines, 'acme.ghe.com');
});

test('AC1.1: compose-subject.js on a *.ghe.com origin sends its issue view to the enterprise host', { skip: STUB_SKIP }, (t) => {
  const readLog = installFakeGh(t);
  const { repo } = makeRepo(t, GHE_ORIGIN);
  node(repo, [path.join(BIN, 'compose-subject.js'), '7', '--tag', 'human-approved']);
  const lines = readLog();
  assertEveryLineReaches(lines, 'acme.ghe.com');
  // Decision Q2: the host-qualified --repo names the host itself, so the seam
  // injects nothing. Dropping the host from the slug turns this red.
  const view = lines.filter((l) => / ARGS=issue view 7 /.test(l));
  assert.equal(view.length, 1, `expected one gh issue view call, log:\n${lines.join('\n')}`);
  assert.match(view[0], /^GH_HOST=unset ARGS=issue view 7 --repo acme\.ghe\.com\/acme\/widgets /);
});

test('AC1.1: wrap-up-engine verify\'s gh runner reaches the enterprise host', { skip: STUB_SKIP }, (t) => {
  const readLog = installFakeGh(t);
  const { repo } = makeRepo(t, GHE_ORIGIN);
  withoutGhHost(t);
  const { defaultGh } = require('../plugin/bin/lib/wrap-up/engine-verify');
  const stderr = captureSeamNotes(t);
  defaultGh(['api', 'graphql', '-f', 'query=q'], repo);
  stderr.restore();
  assert.deepEqual(readLog(), ['GH_HOST=acme.ghe.com ARGS=api graphql -f query=q']);
  assert.deepEqual(stderr.notes, [SEAM_NOTE]);
});

test('AC1.1: the wrap-up pack\'s gh probe reaches the enterprise host', { skip: STUB_SKIP }, async (t) => {
  const readLog = installFakeGh(t);
  const { repo, runDir } = makeRepo(t, GHE_ORIGIN);
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '## Work records\n\nwork-backend: github-issues\n');
  fs.writeFileSync(path.join(runDir, 'work', '7-spec.md'), '---\nrecord: 7\n---\n');
  withoutGhHost(t);
  const { gatherPack } = require('../plugin/bin/lib/wrap-up/pack');
  const stderr = captureSeamNotes(t);
  const pack = await gatherPack({ runDir, cwd: repo, only: ['recordLabels'] });
  stderr.restore();
  assert.deepEqual(stderr.notes, [SEAM_NOTE]); // two gh calls, one host: one note
  assert.deepEqual(pack.recordLabels.value, { 7: ['type:bug'] }, JSON.stringify(pack.recordLabels));
  const lines = readLog();
  // The recordLabels probe's own gh call (async execBounded path) and the
  // integration-branch ladder's `gh repo view` (sync defaultGhSync path).
  const own = lines.filter((l) => / ARGS=(?:issue view 7 --json labels|repo view )/.test(l));
  assert.equal(own.length, 2, `expected the issue view and repo view calls, log:\n${lines.join('\n')}`);
  for (const line of own) assert.ok(line.startsWith('GH_HOST=acme.ghe.com '), `gh call did not reach acme.ghe.com: ${line}`);
});

test('AC2.1: on a github.com origin the fake gh sees GH_HOST unset', { skip: STUB_SKIP }, (t) => {
  const readLog = installFakeGh(t);
  const { repo, runDir } = makeRepo(t, DOTCOM_ORIGIN);
  node(repo, [path.join(BIN, 'pr-checklist.js'), '--run', runDir, '--phase', 'build']);
  const lines = networkLines(readLog());
  assert.ok(lines.some((l) => / ARGS=pr view 7 /.test(l)), `no gh pr view call, log:\n${lines.join('\n')}`);
  for (const line of lines) assert.ok(line.startsWith('GH_HOST=unset '), `GH_HOST injected on github.com: ${line}`);
});

// #4794 Task 4: releaseMerged gates its origin and binds all three of its gh runners
// (ghApi, ghApiAsync, ghRunner) to the repo root, so process.cwd() decides nothing. The
// stub answers one live issue-7 claim, a CLOSED issue and the release writes, so the pass
// reaches every runner: the tree listing and label DELETE (ghApi), the issue-state read
// (ghApiAsync) and the tombstone PUT (ghRunner).
// The shared gate deps: no exported GH_HOST and no readable gh hosts.yml, so the origin alone decides the gate's verdict.
const GATE_DEPS = { env: {}, readFile: () => { throw new Error('ENOENT'); } };
const CLAIMS_TREE_ARGV = 'api repos/acme/widgets/git/trees/claims-registry?recursive=1 -q {truncated: .truncated, entries: [.tree[] | select(.type == "blob" and (.path | startswith("claims/"))) | {name: (.path | split("/") | last), sha: .sha}]}';

function installReleaseGh(t) {
  const dir = tmp(t, 'ct-gh-seam-release-');
  const log = path.join(dir, 'gh.log');
  const claim = JSON.stringify({ runId: 'run-x', sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h' });
  fs.writeFileSync(path.join(dir, 'tree.json'), JSON.stringify({ truncated: false, entries: [{ name: 'issue-7.json', sha: 'live-sha' }] }));
  fs.writeFileSync(path.join(dir, 'blob.json'), JSON.stringify({ content: claim, sha: 'live-sha' }));
  const restore = installStub('gh', [
    '#!/bin/sh',
    `printf 'GH_HOST=%s ARGS=%s\\n' "\${GH_HOST-unset}" "$*" >> '${log}'`,
    'case "$*" in',
    '  --version*) echo "gh version 2.0.0" ;;',
    `  "api repos/"*"/git/trees/claims-registry"*) cat '${path.join(dir, 'tree.json')}' ;;`,
    `  "api repos/"*"/contents/claims/issue-7.json?ref="*) cat '${path.join(dir, 'blob.json')}' ;;`,
    '  "api repos/"*"/issues/7 "*) echo CLOSED ;;',
    '  "api --method "*) echo "{}" ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'));
  t.after(restore);
  return () => joinSpawnLines(fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
}

async function releaseLines(t, origin) {
  const readLog = installReleaseGh(t);
  const { repo } = makeRepo(t, origin);
  withoutGhHost(t);
  const stderr = captureSeamNotes(t);
  const { releaseMerged } = require('../plugin/bin/lib/reconcile/release-merged');
  const result = await releaseMerged({ cwd: repo, gateDeps: GATE_DEPS });
  stderr.restore();
  assert.equal(result.failure, undefined, JSON.stringify(result));
  assert.equal(result.released.length, 1, `expected the issue-closed release, got ${JSON.stringify(result)}`);
  return readLog();
}

test('AC1.1 (#4794): releaseMerged on a *.ghe.com origin sends every gh call to the origin host, whatever process.cwd() is', { skip: STUB_SKIP }, async (t) => {
  const lines = await releaseLines(t, GHE_ORIGIN);
  assertEveryLineReaches(lines, 'acme.ghe.com');
  const has = (re) => lines.some((l) => re.test(argsOf(l)));
  assert.ok(has(/^api repos\/acme\/widgets\/git\/trees\/claims-registry/), `no tree listing (ghApi), log:\n${lines.join('\n')}`);
  assert.ok(has(/^api repos\/acme\/widgets\/issues\/7 /), `no issue-state read (ghApiAsync), log:\n${lines.join('\n')}`);
  assert.ok(has(/^api --method PUT repos\/acme\/widgets\/contents\/claims\/issue-7\.json /), `no tombstone PUT (ghRunner), log:\n${lines.join('\n')}`);
  assert.ok(has(/^api --method DELETE repos\/acme\/widgets\/issues\/7\/labels\/bot%3Ain-progress/), `no label DELETE, log:\n${lines.join('\n')}`);
});

test('AC2.1 (#4794): releaseMerged on a github.com origin leaves GH_HOST unset and argv unchanged', { skip: STUB_SKIP }, async (t) => {
  const lines = await releaseLines(t, DOTCOM_ORIGIN);
  const net = networkLines(lines);
  assert.ok(net.length >= 4, `expected the release's gh calls, log:\n${lines.join('\n')}`);
  for (const line of net) assert.ok(line.startsWith('GH_HOST=unset '), `GH_HOST injected on github.com: ${line}`);
  assert.deepEqual(net.filter((l) => /^api repos\/acme\/widgets\/git\/trees\//.test(argsOf(l))).map(argsOf), [CLAIMS_TREE_ARGV]);
});

// #4794 Task 6: pr-state's bulk screen reads origin through the gate. Its GraphQL pair stays the
// bare owner/name split (a host-qualified slug would put the host in `owner`), and the host comes
// from the call's cwd binding, so the screen reaches the origin host whatever process.cwd() is.
test('AC1.1 (#4794): pr-state\'s bulk PR screen on a *.ghe.com origin reaches the origin host with a bare owner/name pair', { skip: STUB_SKIP }, (t) => {
  const readLog = installFakeGh(t, { 'api-graphql': JSON.stringify({ data: { repository: { b0: null } } }) });
  const { repo } = makeRepo(t, GHE_ORIGIN);
  withoutGhHost(t);
  const stderr = captureSeamNotes(t);
  const { resolvePrStatesBulk } = require('../plugin/bin/lib/reconcile/pr-state');
  const result = resolvePrStatesBulk(repo, ['feature'], { gateDeps: GATE_DEPS });
  stderr.restore();
  assert.ok(result instanceof Map, `expected the screen's Map, got ${JSON.stringify(result)}`);
  const lines = networkLines(readLog());
  assert.equal(lines.length, 1, `expected one network-bound gh call, log:\n${lines.join('\n')}`);
  assert.ok(lines[0].startsWith('GH_HOST=acme.ghe.com '), `bulk screen did not reach acme.ghe.com: ${lines[0]}`);
  assert.match(argsOf(lines[0]), /^api graphql -f owner=acme -f name=widgets -f query=/);
});

// #4794 Task 7: prune-remote and archive-branches gate their origin, then screen their in-scope
// branches in one `gh api graphql` call that follows the repo root's origin host (the GraphQL
// owner/name pair is the bare split, never the host-qualified slug). The fake gh answers the
// graphql key with an empty result, which is enough: only the spawn's host and argv are asserted.

function screenFixture(t, origin) {
  const readLog = installFakeGh(t);
  const { repo } = makeRepo(t, origin);
  withoutGhHost(t);
  git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-q', '-m', 'init']);
  return { repo, readLog };
}

function screenCalls(lines) {
  return lines.filter((l) => / ARGS=api graphql /.test(l));
}

function pruneRemoteLines(t, origin) {
  const { repo, readLog } = screenFixture(t, origin);
  git(repo, ['update-ref', 'refs/remotes/origin/worktree-x', 'HEAD']);
  const stderr = captureSeamNotes(t);
  const { pruneRemote } = require('../plugin/bin/lib/reconcile/prune-remote');
  const result = pruneRemote({ cwd: repo, integration: 'main', skipFetch: true, dryRun: true, gateDeps: GATE_DEPS });
  stderr.restore();
  assert.notEqual(result.failure, 'unknown-host', JSON.stringify(result));
  return readLog();
}

function archiveBranchesLines(t, origin) {
  const { repo, readLog } = screenFixture(t, origin);
  git(repo, ['branch', 'worktree-x']);
  const stderr = captureSeamNotes(t);
  const { archiveBranches } = require('../plugin/bin/lib/reconcile/archive-branches');
  const result = archiveBranches({ cwd: repo, integration: 'main', dryRun: true, gateDeps: GATE_DEPS });
  stderr.restore();
  assert.equal(result.failure, null, JSON.stringify(result));
  assert.ok(!result.entries.some((e) => e.reason === 'unknown-host'), JSON.stringify(result));
  return readLog();
}

// The argv pr-state.js's resolvePrStatesBulk hands its runner for one chunk of `branches`, as the
// fake gh logs it: the recorded line is `"$*"`, so elements are space-joined and a newline inside
// the GraphQL query rejoins as a space (joinSpawnLines). Taken from the real function through an
// injected runner, so AC2.1 compares the spawned argv whole against what the code builds, never
// a restated copy of the query.
function expectedScreenLogArgs(branches) {
  const { resolvePrStatesBulk } = require('../plugin/bin/lib/reconcile/pr-state');
  let built = null;
  resolvePrStatesBulk(process.cwd(), branches, { repoSlug: 'acme/widgets', runner: (args) => { built = args; return '{}'; } });
  assert.ok(Array.isArray(built), 'resolvePrStatesBulk handed its runner no argv');
  return built.join(' ').replace(/\n/g, ' ');
}

// Both callers screen exactly the one in-scope branch their fixture creates (`worktree-x`).
function assertBareScreen(lines) {
  const screens = screenCalls(lines);
  assert.equal(screens.length, 1, `expected one bulk screen call, log:\n${lines.join('\n')}`);
  assert.deepStrictEqual(argsOf(screens[0]), expectedScreenLogArgs(['worktree-x']));
  assert.doesNotMatch(screens[0], /acme\.ghe\.com\/acme\/widgets/);
}

test('AC1.1: prune-remote on a *.ghe.com origin screens its in-scope remote branches on the origin host with a bare owner/name pair', { skip: STUB_SKIP }, (t) => {
  const lines = pruneRemoteLines(t, GHE_ORIGIN);
  assertEveryLineReaches(lines, 'acme.ghe.com');
  assertBareScreen(lines);
});

test('AC2.1: prune-remote on a github.com origin leaves GH_HOST unset and its screen argv unchanged', { skip: STUB_SKIP }, (t) => {
  const lines = pruneRemoteLines(t, 'git@github.com:acme/widgets.git');
  const net = networkLines(lines);
  assert.ok(net.length >= 1, `expected the screen call, log:\n${lines.join('\n')}`);
  for (const line of net) assert.ok(line.startsWith('GH_HOST=unset '), `GH_HOST injected on github.com: ${line}`);
  assertBareScreen(lines);
});

test('AC1.1: archive-branches on a *.ghe.com origin screens its candidate branches on the origin host with a bare owner/name pair', { skip: STUB_SKIP }, (t) => {
  const lines = archiveBranchesLines(t, GHE_ORIGIN);
  assertEveryLineReaches(lines, 'acme.ghe.com');
  assertBareScreen(lines);
});

test('AC2.1: archive-branches on a github.com origin leaves GH_HOST unset and its screen argv unchanged', { skip: STUB_SKIP }, (t) => {
  const lines = archiveBranchesLines(t, 'git@github.com:acme/widgets.git');
  const net = networkLines(lines);
  assert.ok(net.length >= 1, `expected the screen call, log:\n${lines.join('\n')}`);
  for (const line of net) assert.ok(line.startsWith('GH_HOST=unset '), `GH_HOST injected on github.com: ${line}`);
  assertBareScreen(lines);
});

function materializeLines(t, origin) {
  const readLog = installFakeGh(t, { 'issue-view': MATERIALIZE_RECORD });
  const { repo, runDir } = makeRepo(t, origin);
  node(repo, [path.join(BIN, 'materialize.js'), '7', '--run-dir', runDir, '--repo', 'acme/widgets']);
  const lines = networkLines(readLog());
  assert.ok(lines.some((l) => / ARGS=issue view 7 --repo acme\/widgets /.test(l)), `no gh issue view call, log:\n${lines.join('\n')}`);
  assert.ok(lines.some((l) => / ARGS=api repos\/acme\/widgets\/issues\/7 --jq \.author_association$/.test(l)), `no author-association call, log:\n${lines.join('\n')}`);
  return lines;
}

test('AC1.1 (#4795): materialize.js --repo owner/name on a *.ghe.com origin sends every gh call to github.com', { skip: STUB_SKIP }, (t) => {
  const lines = materializeLines(t, GHE_ORIGIN);
  for (const line of lines) assert.ok(line.startsWith('GH_HOST=github.com '), `gh call did not reach github.com: ${line}`);
});

test('fix round 1: materialize.js --repo owner/name on a github.com origin leaves GH_HOST unset', { skip: STUB_SKIP }, (t) => {
  const lines = materializeLines(t, DOTCOM_ORIGIN);
  for (const line of lines) assert.ok(line.startsWith('GH_HOST=unset '), `GH_HOST set on github.com: ${line}`);
});

// Final review item 7: backlog-grant-gate.js's nativeRunnerFor. A bare `--repo
// owner/name` means github.com, and nativeRunnerFor hands that host to ghOptions's
// per-call `explicitHost` (#4795), so its owner/repo-addressed native calls (the
// schema probe, the REST sub-issue retry) carry GH_HOST=github.com, while the
// issue lists read cwd's own repo, take no `explicitHost`, and keep the origin
// host. An exported GH_HOST reaches every call unchanged (AC4).
function grantGateLines(t, extraEnv = {}) {
  const dir = tmp(t, 'ct-gh-seam-fake-');
  const log = path.join(dir, 'gh.log');
  t.after(installStub('gh', [
    '#!/bin/sh',
    `printf 'GH_HOST=%s ARGS=%s\\n' "\${GH_HOST-unset}" "$*" >> '${log}'`,
    'case "$*" in',
    '  --version) echo "gh version 2.0.0" ;;',
    `  *parent-issue*) echo '[{"number":1}]' ;;`,
    `  "api graphql"*) echo '{"data":{"__type":{"fields":[]}}}' ;;`,
    '  "api --paginate"*) ;;',
    "  *) echo '[]' ;;",
    'esac',
    'exit 0',
    '',
  ].join('\n')));
  const { repo } = makeRepo(t, GHE_ORIGIN);
  git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(repo, ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-q', '-m', 'init']);
  fs.writeFileSync(path.join(repo, '.claude-tweaks', 'policy.yml'),
    'autonomy: unattended\ngrant-origination-enabled: true\nwork-links: native\nintegration-branch: main\n');
  const env = { ...childEnv(), ...extraEnv };
  delete env.CLAUDE_CODE_SESSION_ID; // no session-scoped record snapshot
  execFileSync(process.execPath, [path.join(BIN, 'backlog-grant-gate.js'), '--repo', 'acme/widgets'],
    { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const lines = networkLines(fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
  const native = lines.filter((l) => / ARGS=api (?:graphql|--paginate repos\/acme\/widgets\/issues\/1\/sub_issues) /.test(l));
  const lists = lines.filter((l) => / ARGS=issue list /.test(l));
  assert.equal(native.length, 2, `expected the schema probe and the REST retry, log:\n${lines.join('\n')}`);
  assert.equal(lists.length, 3, `expected the --state all, ready and parent-issue lists, log:\n${lines.join('\n')}`);
  return { native, lists };
}

test('final review: backlog-grant-gate.js --repo owner/name on a *.ghe.com origin sends its native calls to github.com, its issue lists to the origin host', { skip: STUB_SKIP }, (t) => {
  const { native, lists } = grantGateLines(t);
  for (const line of native) assert.ok(line.startsWith('GH_HOST=github.com '), `native call did not reach github.com: ${line}`);
  for (const line of lists) assert.ok(line.startsWith('GH_HOST=acme.ghe.com '), `issue list did not reach the origin host: ${line}`);
});

test('final review: backlog-grant-gate.js leaves an exported GH_HOST on every call', { skip: STUB_SKIP }, (t) => {
  const { native, lists } = grantGateLines(t, { GH_HOST: 'mine.example' });
  for (const line of [...native, ...lists]) assert.ok(line.startsWith('GH_HOST=mine.example '), `exported GH_HOST overridden: ${line}`);
});

for (const row of CLI_TABLE.slice(0, 6)) describeOriginGate(row);

// #4794 Task 5: archive-merged and reap-merged file their residue escalation against the
// origin-derived repo. The runner is injected, so the argv it records is what `gh` would
// have been sent: a host-qualified --repo off github.com, the bare slug on it, and nothing
// at all through a refused origin (an SSH alias).
const ESCALATION_ISSUE_URL = 'https://acme.ghe.com/acme/widgets/issues/101';

function recordingRunner() {
  const calls = [];
  const runner = (argv) => {
    calls.push(argv);
    if (argv[0] === 'issue' && argv[1] === 'list') return '[]';
    if (argv[0] === 'issue' && argv[1] === 'create') return ESCALATION_ISSUE_URL;
    return '';
  };
  return { calls, runner };
}

function committedRepo(t, origin) {
  const { repo } = makeRepo(t, origin);
  fs.rmSync(path.join(repo, '.claude-tweaks'), { recursive: true, force: true });
  git(repo, ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-q', '-m', 'init']);
  return repo;
}

// AC2.1 pins today's argv, so each recorded call is compared whole, not for one flag: the dedup
// search is the exact argv escalate-residue.js's findResidueDuplicate sends, and the create call is
// its `issue create --repo <slug> --title <title> --body <body> --label bug` -- ten elements, so a
// flag the seam adds anywhere (`--hostname github.com`) fails. A body the caller cannot derive
// (reap's carries a timestamp and the removal's error text) is only required to be one string.
function assertEscalationArgv(calls, slug, { title, body }) {
  assert.ok(calls.length >= 1, 'expected at least one gh call through the runner');
  for (const argv of calls) {
    if (argv[1] === 'list') {
      assert.deepStrictEqual(argv, ['issue', 'list', '--repo', slug, '--state', 'all', '--json', 'number,title,body,createdAt,state', '--limit', '10000']);
      continue;
    }
    assert.equal(argv[1], 'create', `unexpected gh call ${JSON.stringify(argv)}`);
    assert.equal(argv.length, 10, `unexpected issue create argv ${JSON.stringify(argv)}`);
    assert.deepStrictEqual(argv.slice(0, 7), ['issue', 'create', '--repo', slug, '--title', title, '--body']);
    if (body === undefined) assert.equal(typeof argv[7], 'string');
    else assert.deepStrictEqual(argv[7], body);
    assert.deepStrictEqual(argv.slice(8), ['--label', 'bug']);
  }
  assert.ok(calls.some((argv) => argv[1] === 'create'), 'expected the escalation to file an issue');
}

const { structurallyStuckBody } = require('../plugin/bin/lib/reconcile/escalate-residue');
const STUCK_TITLE = 'reconcile: structurally-stuck run directories';
// The title escalateResidue files for the locked worktree reapEscalation sets up (its realpath is the target).
const reapTitle = (root) => `reconcile: removal-failed stuck on ${fs.realpathSync(path.join(root, '.claude', 'worktrees', 'issue-1'))}`;

// One structurally-stuck run dir (worktree gone, no branch) one failure short of the
// escalation threshold, so the pass's own trackStuckSkip crosses it.
function archiveEscalation(t, origin) {
  const { archiveMerged, STRUCTURALLY_STUCK_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { RESIDUE_ESCALATE_THRESHOLD, recordResidueFailure } = require('../plugin/bin/lib/reconcile/cache');
  const root = fs.realpathSync(committedRepo(t, origin));
  withoutGhHost(t);
  const dir = path.join(root, '.claude-tweaks', 'pipelines', '2026-01-01T000000-stuck-a-4794');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: path.join(root, 'long-gone'), sessionId: 'sess-1' }));
  const backdated = new Date(Date.now() - STRUCTURALLY_STUCK_TTL_MS * 2);
  fs.utimesSync(dir, backdated, backdated);
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD - 1; i++) recordResidueFailure(root, 'structurally-stuck', dir, { lastError: 'stuck at no-branch' });
  const { calls, runner } = recordingRunner();
  const result = archiveMerged({ cwd: root, runner, gateDeps: GATE_DEPS });
  assert.ok(result.skipped.some((s) => s.runDir === dir && s.reason === 'no-branch'), JSON.stringify(result));
  return { calls, root, dir };
}

test('AC1.1: archiveMerged on a *.ghe.com origin escalates structurally-stuck residue with --repo acme.ghe.com/acme/widgets', { skip: STUB_SKIP }, (t) => {
  const { calls, dir } = archiveEscalation(t, GHE_ORIGIN);
  assertEscalationArgv(calls, 'acme.ghe.com/acme/widgets', { title: STUCK_TITLE, body: structurallyStuckBody([dir]) });
});

test('AC2.1: archiveMerged on a github.com origin escalates with --repo acme/widgets', { skip: STUB_SKIP }, (t) => {
  const { calls, dir } = archiveEscalation(t, DOTCOM_ORIGIN);
  assertEscalationArgv(calls, 'acme/widgets', { title: STUCK_TITLE, body: structurallyStuckBody([dir]) });
});

test('#4794: archiveMerged on an SSH-alias origin escalates nothing — the runner sees no call', { skip: STUB_SKIP }, (t) => {
  const { listResidueFailures } = require('../plugin/bin/lib/reconcile/cache');
  const { calls, root } = archiveEscalation(t, 'git@github-work:acme/widgets.git');
  assert.deepEqual(calls, []);
  const entry = listResidueFailures(root).find((f) => f.reason === 'structurally-stuck');
  assert.ok(entry && entry.lastResidueError && entry.lastResidueError.reason.startsWith('unknown-host ('), JSON.stringify(entry));
});

// A merged-PR worktree locked so `git worktree remove` refuses it, RESIDUE_ESCALATE_THRESHOLD passes.
function reapEscalation(t, origin) {
  const { reapMerged } = require('../plugin/bin/lib/reconcile/reap-merged');
  const { RESIDUE_ESCALATE_THRESHOLD } = require('../plugin/bin/lib/reconcile/cache');
  const root = fs.realpathSync(committedRepo(t, origin));
  withoutGhHost(t);
  const wtPath = path.join(root, '.claude', 'worktrees', 'issue-1');
  git(root, ['worktree', 'add', '-q', '-b', 'worktree-issue-1', wtPath]);
  git(root, ['worktree', 'lock', wtPath, '--reason', 'stuck']);
  const prStates = { byBranch: () => ({ number: 9, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }) };
  const { calls, runner } = recordingRunner();
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    const result = reapMerged({ cwd: root, runner, prStates, gateDeps: GATE_DEPS });
    assert.equal(result.skipped[0] && result.skipped[0].reason, 'removal-failed', `pass ${i + 1}: ${JSON.stringify(result)}`);
  }
  return { calls, root };
}

test('AC1.1: reapMerged on a *.ghe.com origin escalates removal-failed residue with the host-qualified --repo', { skip: STUB_SKIP }, (t) => {
  const { calls, root } = reapEscalation(t, GHE_ORIGIN);
  assertEscalationArgv(calls, 'acme.ghe.com/acme/widgets', { title: reapTitle(root) });
});

test('AC2.1: reapMerged on a github.com origin escalates removal-failed residue with --repo acme/widgets', { skip: STUB_SKIP }, (t) => {
  const { calls, root } = reapEscalation(t, DOTCOM_ORIGIN);
  assertEscalationArgv(calls, 'acme/widgets', { title: reapTitle(root) });
});

test('#4794: reapMerged on an SSH-alias origin escalates nothing and records unknown-host', { skip: STUB_SKIP }, (t) => {
  const { listResidueFailures } = require('../plugin/bin/lib/reconcile/cache');
  const { calls, root } = reapEscalation(t, 'git@github-work:acme/widgets.git');
  assert.deepEqual(calls, []);
  const entry = listResidueFailures(root).find((f) => f.reason === 'removal-failed');
  assert.ok(entry, 'expected a removal-failed residue entry');
  assert.ok(entry.lastResidueError && entry.lastResidueError.reason.startsWith('unknown-host ('), JSON.stringify(entry));
});

// #4794 Task 9: sibling-sessions' claim reader reads its origin through the gate and binds the
// contents-API read to the hook's `cwd`, not process.cwd(). The child's own cwd is a fresh
// directory outside the repo (no origin), so a reader that follows process.cwd() reaches the
// wrong host. The fake gh answers the contents read with one live claim.
const SIBLING_SESSIONS = path.join(BIN, 'lib', 'hooks', 'sibling-sessions.js');
const CLAIM_CONTENTS_KEY = 'api-repos/acme/widgets/contents/claims/issue-7.json?ref=claims-registry';

function nodeEval(t, cwd, script, envOpts = {}) {
  return execFileSync(process.execPath, ['-e', script], { cwd, env: gatedEnv(t, envOpts), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

function siblingClaimRead(t, origin) {
  const live = JSON.stringify({ runId: 'run-live-7', sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h' });
  const readLog = installFakeGh(t, { [CLAIM_CONTENTS_KEY]: JSON.stringify({ content: live, sha: 's1' }) });
  const { repo } = makeRepo(t, origin);
  const outside = fs.realpathSync(tmp(t, 'ct-gh-seam-outside-'));
  const script = `process.stdout.write(JSON.stringify(require(${JSON.stringify(SIBLING_SESSIONS)}).findLiveClaim('#7', { cwd: ${JSON.stringify(repo)}, sessionId: 'other' })))`;
  const stdout = nodeEval(t, outside, script);
  return { stdout, lines: readLog() };
}

test('AC1.1 (#4794): sibling-sessions\' claim read on a *.ghe.com origin reaches the origin host from any process.cwd()', { skip: STUB_SKIP }, (t) => {
  const { stdout, lines } = siblingClaimRead(t, GHE_ORIGIN);
  assertEveryLineReaches(lines, 'acme.ghe.com');
  assert.match(stdout, /"runId":"run-live-7"/, stdout);
});

test('AC2.1 (#4794): sibling-sessions\' claim read on a github.com origin is today\'s contents read, GH_HOST unset', { skip: STUB_SKIP }, (t) => {
  const { stdout, lines } = siblingClaimRead(t, DOTCOM_ORIGIN);
  for (const line of networkLines(lines)) assert.ok(line.startsWith('GH_HOST=unset '), `GH_HOST injected on github.com: ${line}`);
  assert.ok(networkLines(lines).some((l) => /^api repos\/acme\/widgets\/contents\/claims\/issue-7\.json\?ref=claims-registry/.test(argsOf(l))), JSON.stringify(lines));
  assert.match(stdout, /"runId":"run-live-7"/, stdout);
});

test('#4794: sibling-sessions on an SSH-alias origin sends no gh call', { skip: STUB_SKIP }, (t) => {
  const { stdout, lines } = siblingClaimRead(t, 'git@github-work:acme/widgets.git');
  assert.deepEqual(networkLines(lines), []);
  assert.equal(stdout, 'null');
});

// #4794 Task 15: teardown-run's remote-ref delete through the real defaultGhApiDelete, after
// hooks-teardown-run.test.js's AC16 shape (run-state pr.branch set, no worktree recorded). It
// takes its host from the gate's spec, so the one DELETE carries `--hostname` for the origin host.
function teardownRemoteRef(t, origin) {
  const { teardownRun } = require('../plugin/bin/lib/hooks/teardown-run');
  const readLog = installFakeGh(t);
  const { repo, runDir } = makeRepo(t, origin);
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active', worktree: null, sessionId: 'me',
    pr: { number: 7, url: 'https://github.com/acme/widgets/pull/7', branch: 'feat-branch' },
  }));
  withoutGhHost(t);
  captureSeamNotes(t);
  const result = teardownRun(runDir, { mode: 'merged', sessionId: 'me' });
  assert.ok(fs.existsSync(repo));
  return { result, lines: readLog() };
}

test('AC1.1 (#4794): teardown-run on a *.ghe.com origin sends its remote-ref delete to the origin host', { skip: STUB_SKIP }, (t) => {
  const { result, lines } = teardownRemoteRef(t, GHE_ORIGIN);
  assert.match(result.lines.join('\n'), /remote ref: deleted refs\/heads\/feat-branch/);
  const net = networkLines(lines);
  assert.equal(net.length, 1, lines.join('\n'));
  assert.ok(reachesHost(net[0], 'acme.ghe.com'), net[0]);
  assert.equal(argsOf(net[0]).split(' --hostname acme.ghe.com').length - 1, 1, `--hostname acme.ghe.com exactly once: ${net[0]}`);
  assert.match(argsOf(net[0]), /^api --method DELETE repos\/acme\/widgets\/git\/refs\/heads\/feat-branch /);
});

// #4794 Task 12: claim-targets.js gates its origin to refuse only; its repo still comes from
// `gh repo view`, so it joins ORIGIN_GATED but not CLI_TABLE (no origin-derived slug in its
// argv). The fake gh answers the repo, one TTL-expired claim blob for RUN_ID (the contents
// read, through the nested key) and a marked same-repo PR on the case's host. GIT_ALLOW_PROTOCOL=file
// (gatedEnv) makes the git-CAS leg fail fast, so the read takes the contents API.
const CT_STALE_CLAIM = JSON.stringify({ runId: RUN_ID, sessionId: 's1', claimedAt: new Date(Date.now() - 100 * 3600 * 1000).toISOString(), ttlHours: 72, host: 'h' });
const CT_PR_LIST_ARGV = 'pr list --repo acme/widgets --state open --json url,body,isCrossRepository --limit 1000';

function claimTargetsRow(prHost) {
  const pr = { url: `https://${prHost}/acme/widgets/pull/12`, body: `## Spec\n<!-- claude-tweaks-run: ${RUN_ID} -->\n`, isCrossRepository: false };
  return {
    cli: 'claim-targets.js',
    argv: ['--run-id', '2026-11-04T000002-record-7', '--targets', '7'],
    canned: {
      'repo-view': 'acme/widgets',
      [CLAIM_CONTENTS_KEY]: JSON.stringify({ content: CT_STALE_CLAIM, sha: 's1' }),
      'pr-list': JSON.stringify([pr]),
    },
  };
}

test('AC1.1: claim-targets.js on a *.ghe.com origin lists open PRs on the origin host and stops the stale claim in flight', { skip: STUB_SKIP }, (t) => {
  const r = runGated(t, claimTargetsRow('acme.ghe.com'), { origin: GHE_ORIGIN });
  assert.equal(r.status, 3, `expected exit 3 (in flight); stderr:\n${r.stderr}`);
  assertEveryLineReaches(r.lines, 'acme.ghe.com');
  const list = r.lines.filter((l) => / ARGS=pr list /.test(l));
  assert.equal(list.length, 1, `expected one pr list call, log:\n${r.lines.join('\n')}`);
  assert.match(argsOf(list[0]), /^pr list --repo acme\.ghe\.com\/acme\/widgets /);
  assert.deepEqual(repoValues(list), ['acme.ghe.com/acme/widgets']);
});

test('AC2.1: claim-targets.js on a github.com origin keeps today\'s pr list argv', { skip: STUB_SKIP }, (t) => {
  const r = runGated(t, claimTargetsRow('github.com'), { origin: DOTCOM_ORIGIN });
  assert.equal(r.status, 3, `expected exit 3 (in flight); stderr:\n${r.stderr}`);
  for (const line of r.lines) assert.ok(line.startsWith('GH_HOST=unset '), `GH_HOST injected on github.com: ${line}`);
  const list = r.lines.filter((l) => / ARGS=pr list /.test(l));
  assert.deepEqual(list.map(argsOf), [CT_PR_LIST_ARGV]);

  // Review Focus 7: a GH_HOST naming github.com keeps the bare --repo and the same match.
  const exported = runGated(t, claimTargetsRow('github.com'), { origin: DOTCOM_ORIGIN, ghHost: 'github.com' });
  assert.equal(exported.status, 3, `GH_HOST=github.com: expected exit 3; stderr:\n${exported.stderr}`);
  assert.deepEqual(exported.lines.filter((l) => / ARGS=pr list /.test(l)).map(argsOf), [CT_PR_LIST_ARGV]);
});

test('#4794: claim-targets.js on an unknown or SSH-alias origin exits 2 unknown-host and calls no gh', { skip: STUB_SKIP }, (t) => {
  for (const origin of [`https://${UNKNOWN_HOST}/o/r.git`, 'git@github-work:acme/widgets.git']) {
    const refusal = gateOriginRepo(origin, GATE_DEPS).refusal;
    assert.ok(refusal, `${origin}: the gate must refuse it`);
    const r = runGated(t, claimTargetsRow('github.com'), { origin });
    assert.equal(r.status, 2, `${origin}: expected exit 2; stderr:\n${r.stderr}`);
    assert.deepEqual(networkLines(r.lines), [], `${origin}: gh was called beyond --version (not even repo view):\n${r.lines.join('\n')}`);
    assert.ok(r.stderr.startsWith('claim-targets: unknown-host — '), `${origin}: stderr:\n${r.stderr}`);
    assert.ok(r.stderr.includes(refusal), `${origin}: stderr lacks the gate's refusal text:\n${r.stderr}`);
    if (origin.startsWith('git@')) {
      assert.match(r.stderr, /GH_HOST=github\.com/);
      assert.doesNotMatch(r.stderr, /GH_HOST=github-work/);
    }
  }
  const opted = runGated(t, claimTargetsRow(UNKNOWN_HOST), { origin: `https://${UNKNOWN_HOST}/o/r.git`, ghHost: UNKNOWN_HOST });
  assert.ok(!opted.stderr.includes(NOT_KNOWN_MSG), `an exported GH_HOST opts in, but it was refused:\n${opted.stderr}`);
  assert.equal(opted.status, 3, `GH_HOST=${UNKNOWN_HOST}: expected exit 3 (in flight on that host); stderr:\n${opted.stderr}`);
});

// #4794 Task 13: stale-claim-pr.js calls the gate directly (no repo-resolve helper in between). Its
// one open-PR listing and its PR-url match share one host. The claim file is a stale claim blob for
// RUN_ID; the fake gh answers the listing with a marked PR on the case's host.
const STALE_CLAIM_PR_LIST_ARGV = 'pr list --repo acme/widgets --state open --json url,body,isCrossRepository --limit 1000';

function staleClaimPrRow(prHost) {
  const pr = { url: `https://${prHost}/acme/widgets/pull/12`, body: `## Spec\n<!-- claude-tweaks-run: ${RUN_ID} -->\n`, isCrossRepository: false };
  return {
    cli: 'stale-claim-pr.js',
    argv: ['--claim-file', 'claim.json'],
    setup: writeJsonFile('claim.json', { runId: RUN_ID, claimedAt: '2026-10-31T00:00:00Z' }),
    canned: { 'pr-list': JSON.stringify([pr]) },
  };
}

const runStaleClaimPr = (t, prHost, caseOpts) => runGated(t, staleClaimPrRow(prHost), caseOpts);

test('AC1.1: stale-claim-pr.js on a *.ghe.com origin lists open PRs on the origin host and matches its marked PR', { skip: STUB_SKIP }, (t) => {
  const r = runStaleClaimPr(t, 'acme.ghe.com', { origin: GHE_ORIGIN });
  assert.equal(r.status, 0, `stderr:\n${r.stderr}`);
  assertEveryLineReaches(r.lines, 'acme.ghe.com');
  const list = r.lines.filter((l) => / ARGS=pr list /.test(l));
  assert.deepEqual(repoValues(list), ['acme.ghe.com/acme/widgets']);
  assert.equal(JSON.parse(r.stdout).match, true, r.stdout);
  assert.equal(JSON.parse(r.stdout).link, 'https://acme.ghe.com/acme/widgets/pull/12');
});

test('AC2.1: stale-claim-pr.js on a github.com origin keeps today\'s pr list argv', { skip: STUB_SKIP }, (t) => {
  const r = runStaleClaimPr(t, 'github.com', { origin: DOTCOM_ORIGIN });
  assert.equal(r.status, 0, `stderr:\n${r.stderr}`);
  assert.deepEqual(networkLines(r.lines), [`GH_HOST=unset ARGS=${STALE_CLAIM_PR_LIST_ARGV}`]);
  assert.equal(JSON.parse(r.stdout).match, true, r.stdout);
});

// #5218: drive.js (lib/driver/steps.js, ORIGIN_GATED) gates its origin in the policy step, so it
// joins ORIGIN_GATED but not CLI_TABLE: that table asserts a refusal as exit 2 with the gate's
// text on stderr, while the driver reports one as a fatal `refused` final line on stdout and exits
// 1, and its pass-through legs run the claim, worktree and worker steps, which the table's
// fixtures cannot stand in for. The policy file pins the integration branch, so the policy step
// reaches the origin gate in a repo with no origin/HEAD. A canned empty `issue view` answer ends
// a pass-through run at the fetch step, so its one gh call is the host-routing proof.
const driveRow = (canned = {}) => ({
  cli: 'drive.js',
  argv: ['#7'],
  setup: (repo) => fs.writeFileSync(path.join(repo, '.claude-tweaks', 'policy.yml'), 'integration-branch: main\n'),
  canned: { 'issue-view': '{}', ...canned },
});
const finalLineOf = (stdout) => JSON.parse(stdout.trim().split('\n').pop());

test('#5218: drive.js on an unknown or SSH-alias origin refuses at the policy step (exit 1) and calls no gh', { skip: STUB_SKIP }, (t) => {
  for (const origin of [`https://${UNKNOWN_HOST}/o/r.git`, 'git@github-work:acme/widgets.git']) {
    const refusal = gateOriginRepo(origin, GATE_DEPS).refusal;
    assert.ok(refusal, `${origin}: the gate must refuse it`);
    const r = runGated(t, driveRow(), { origin });
    assert.equal(r.status, 1, `${origin}: expected exit 1; stderr:\n${r.stderr}\nstdout:\n${r.stdout}`);
    const final = finalLineOf(r.stdout);
    assert.deepEqual([final.stop.step, final.outcome], ['policy', 'refused'], origin);
    assert.ok(final.stop.detail.includes(refusal), `${origin}: the final line lacks the gate's refusal text:\n${r.stdout}`);
    assert.deepEqual(networkLines(r.lines), [], `${origin}: gh was called beyond --version:\n${r.lines.join('\n')}`);
  }
  const opted = runGated(t, driveRow(), { origin: `https://${UNKNOWN_HOST}/o/r.git`, ghHost: UNKNOWN_HOST });
  assert.ok(!opted.stdout.includes(NOT_KNOWN_MSG), `an exported GH_HOST opts in, but it was refused:\n${opted.stdout}`);
});

test('#5218: drive.js on a *.ghe.com origin reads the record from the origin host; on github.com it keeps the bare slug', { skip: STUB_SKIP }, (t) => {
  const ghe = runGated(t, driveRow(), { origin: GHE_ORIGIN });
  const view = ghe.lines.filter((l) => / ARGS=issue view /.test(l));
  assert.equal(view.length, 1, `expected one issue view call, log:\n${ghe.lines.join('\n')}\nstdout:\n${ghe.stdout}`);
  assert.ok(reachesHost(view[0], 'acme.ghe.com'), view[0]);
  assert.deepEqual(repoValues(view), ['acme.ghe.com/acme/widgets']);
  const dotcom = runGated(t, driveRow(), { origin: DOTCOM_ORIGIN });
  assert.deepEqual(repoValues(dotcom.lines.filter((l) => / ARGS=issue view /.test(l))), ['acme/widgets']);
  for (const line of dotcom.lines) assert.ok(line.startsWith('GH_HOST=unset '), `GH_HOST injected on github.com: ${line}`);
});

test('#4794: stale-claim-pr.js on an unknown or SSH-alias origin reports unknown-host at exit 0 and calls no gh', { skip: STUB_SKIP }, (t) => {
  for (const origin of [`https://${UNKNOWN_HOST}/o/r.git`, 'git@github-work:acme/widgets.git']) {
    const refusal = gateOriginRepo(origin, GATE_DEPS).refusal;
    assert.ok(refusal, `${origin}: the gate must refuse it`);
    const r = runStaleClaimPr(t, 'github.com', { origin });
    assert.equal(r.status, 0, `${origin}: stderr:\n${r.stderr}`);
    assert.deepEqual(JSON.parse(r.stdout), { match: false, link: null, failure: `unknown-host: ${refusal}` }, origin);
    assert.equal(r.stderr, `stale-claim-pr.js: ${refusal}\n`, origin);
    assert.deepEqual(networkLines(r.lines), [], `${origin}: gh was called beyond --version:\n${r.lines.join('\n')}`);
  }
});

// #4794 Task 16: a whole reconcile pass (`hooks.js reconcile`, the unscoped CLI call) on a GHE origin
// with no GH_HOST exported. The fake gh answers the claims tree listing with an empty registry, `pr view`
// with a failure and the PR-state confirm's GraphQL probe with a NOT_FOUND body, and anything else with
// `[]`. The fixture drives one call of every kind whose host the pass derives itself: release-merged's
// tree listing (a `repos/…` path, host from the cwd binding), archive's by-number PR-state confirm (a
// GraphQL pair, host from the call's cwd), and the structurally-stuck run dir's residue escalation,
// whose host rides `--repo` (the host-qualified slug), not the environment: it is the call a bare-slug
// pass leaves on github.com even from the repo's own cwd. GIT_ALLOW_PROTOCOL=file makes the pass's
// `git fetch` of the https origin fail at once instead of prompting or reaching the network.
const PR_NOT_FOUND_BODY = JSON.stringify({ data: { repository: { pullRequest: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'pullRequest'], message: 'no PR' }] });

function installReconcileGh(t) {
  const dir = tmp(t, 'ct-gh-seam-pass-');
  const log = path.join(dir, 'gh.log');
  const restore = installStub('gh', [
    '#!/bin/sh',
    `printf 'GH_HOST=%s ARGS=%s\\n' "\${GH_HOST-unset}" "$*" >> '${log}'`,
    'case "$*" in',
    '  --version*) echo "gh version 2.0.0" ;;',
    '  "api repos/"*"/git/trees/claims-registry"*) echo \'{"truncated":false,"entries":[]}\' ;;',
    '  "pr view"*) exit 1 ;;',
    `  "api graphql"*) echo '${PR_NOT_FOUND_BODY}'; exit 1 ;;`,
    '  *) echo "[]" ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'));
  t.after(restore);
  return () => joinSpawnLines(fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
}

function reconcilePassFixture(t, origin) {
  const { RESIDUE_ESCALATE_THRESHOLD, recordResidueFailure } = require('../plugin/bin/lib/reconcile/cache');
  const { STRUCTURALLY_STUCK_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { STATUS_FILENAME } = require('../plugin/bin/lib/reconcile/background-spawn');
  const repo = fs.realpathSync(tmp(t, 'ct-gh-seam-pass-repo-'));
  git(repo, ['init', '-q']);
  git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(repo, ['remote', 'add', 'origin', origin]);
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '## Work records\n\nwork-backend: github-issues\nwork-types: labels\n');
  git(repo, ['add', 'CLAUDE.md']);
  git(repo, ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
  // The pass resolves its integration branch from origin/HEAD (a fetch of the https origin cannot supply it).
  git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(repo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  // reap's PR screen: a worktree branch to look up.
  git(repo, ['worktree', 'add', '-q', '-b', 'worktree-issue-1', path.join(repo, '.claude', 'worktrees', 'issue-1')]);
  // archive's by-number PR confirm and escalation: a stuck run dir (worktree gone, no branch, a stamped
  // PR the fake gh does not know), one failure short of the threshold.
  const dir = path.join(repo, '.claude-tweaks', 'pipelines', '2026-01-01T000000-stuck-a-4794');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: path.join(repo, 'long-gone'), sessionId: 'sess-1', pr: { number: 7 } }));
  const backdated = new Date(Date.now() - STRUCTURALLY_STUCK_TTL_MS * 2);
  fs.utimesSync(dir, backdated, backdated);
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD - 1; i++) recordResidueFailure(repo, 'structurally-stuck', dir, { lastError: 'stuck at pr-not-found' });
  // A fresh background-status stamp keeps the CLI from spawning its detached janitorial pass.
  fs.writeFileSync(path.join(repo, '.claude-tweaks', STATUS_FILENAME), JSON.stringify({ completedAt: Date.now() }));
  return repo;
}

// Returns the fake gh's log lines for one `hooks.js reconcile` child run from the repo.
function reconcilePassLines(t, { origin, env = {} }) {
  const readLog = installReconcileGh(t);
  const repo = reconcilePassFixture(t, origin);
  const passEnv = { ...gatedEnv(t, {}), GIT_TERMINAL_PROMPT: '0', ...env };
  const r = spawnSync(process.execPath, [path.join(BIN, 'hooks.js'), 'reconcile', '--json'], { cwd: repo, env: passEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  assert.equal(r.status, 0, `reconcile exited ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  return readLog();
}

// Every gh call on a GHE origin reaches the host; the calls whose host rides `--repo` (the residue
// escalation's issue list and create) carry the host-qualified slug rather than a bare one that only
// an injected GH_HOST would route.
function assertPassReaches(lines, host) {
  assertEveryLineReaches(lines, host);
  const has = (re) => networkLines(lines).some((l) => re.test(argsOf(l)));
  assert.ok(has(/^api repos\/acme\/widgets\/git\/trees\/claims-registry/), `no release-merged tree listing, log:\n${lines.join('\n')}`);
  assert.ok(has(/^api graphql -f owner=acme -f name=widgets -F number=7 /), `no PR-state confirm, log:\n${lines.join('\n')}`);
  const repoFlagged = networkLines(lines).filter((l) => /(?:^| )(?:-R|--repo)[ =]/.test(argsOf(l)));
  assert.ok(repoFlagged.length >= 1, `no residue-escalation call carried --repo, log:\n${lines.join('\n')}`);
  for (const line of repoFlagged) assert.ok(argvReachesHost(line, host), `--repo value is not host-qualified: ${line}`);
}

test('AC1.1: a whole reconcile pass (hooks.js reconcile) on a *.ghe.com origin sends every gh call to the origin host', { skip: STUB_SKIP }, (t) => {
  assertPassReaches(reconcilePassLines(t, { origin: GHE_ORIGIN }), 'acme.ghe.com');
});

test('#4794: a whole reconcile pass on a *.ghe.com origin with GH_HOST exported empty sends every gh call to the origin host', { skip: STUB_SKIP }, (t) => {
  // An empty GH_HOST is no opt-in: release-merged's seam-wrapped calls and the host-qualified residue --repo agree.
  assertPassReaches(reconcilePassLines(t, { origin: 'https://acme.ghe.com/acme/widgets.git', env: { GH_HOST: '' } }), 'acme.ghe.com');
});

test('AC1.1: a whole reconcile pass on a credentialed https://oauth2@acme.ghe.com origin sends every gh call to the origin host', { skip: STUB_SKIP }, (t) => {
  assertPassReaches(reconcilePassLines(t, { origin: 'https://oauth2@acme.ghe.com/acme/widgets.git' }), 'acme.ghe.com');
});
