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
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { STUB_SKIP, installStub } = require('./helpers/path-stub');
const { _resetGhHostCache } = require('../plugin/bin/lib/repo-resolve');
const { composePrEarlyBody } = require('../plugin/bin/lib/flow/pr-body');

const REPO_ROOT = path.join(__dirname, '..');
const BIN = path.join(REPO_ROOT, 'plugin', 'bin');
const GHE_ORIGIN = 'https://acme.ghe.com/acme/widgets.git';
const DOTCOM_ORIGIN = 'https://github.com/acme/widgets.git';
const RUN_ID = '2026-10-31T000001-record-7';

// Canned gh answers, keyed "<arg1>-<arg2>".
const CANNED = {
  'pr-view': JSON.stringify({ body: composePrEarlyBody({ runId: RUN_ID, specSummary: 'Summary.', target: '#7', nextStep: 'test', fixesLines: [] }) }),
  'issue-view': JSON.stringify({
    number: 7,
    title: 'Fix the widget',
    body: '## Overview\n\nFixes the widget.\n\n## Release Note\n\nThe widget works.\n',
    labels: [{ name: 'type:bug' }],
    issueType: null,
  }),
  'api-graphql': JSON.stringify({ data: {} }),
  'repo-view': 'main',
};

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore', windowsHide: true });
}

// A temp repo with `origin` set and a pr-first run dir whose run-state.json
// carries pr.number 7 (the minimal fixture pr-checklist.js's run() reads).
function makeRepo(t, origin) {
  const repo = fs.realpathSync(tmp(t, 'ct-gh-seam-repo-'));
  git(repo, ['init', '-q']);
  git(repo, ['remote', 'add', 'origin', origin]);
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ pr: { number: 7 } }));
  return { repo, runDir };
}

// Installs the fake gh; returns the log reader. The stub logs one line per
// spawn, then prints the canned answer for its first two args (`canned`
// replaces CANNED entries by key for one case).
function installFakeGh(t, canned = {}) {
  const dir = tmp(t, 'ct-gh-seam-fake-');
  for (const [key, text] of Object.entries({ ...CANNED, ...canned })) fs.writeFileSync(path.join(dir, `${key}.json`), text);
  const log = path.join(dir, 'gh.log');
  const restore = installStub('gh', [
    '#!/bin/sh',
    `printf 'GH_HOST=%s ARGS=%s\\n' "\${GH_HOST-unset}" "$*" >> '${log}'`,
    'if [ "$1" = "--version" ]; then echo "gh version 2.0.0"; exit 0; fi',
    'if [ "$1 $2" = "pr edit" ]; then cat >/dev/null; fi',
    `f='${dir}'/"$1-$2.json"`,
    'if [ -f "$f" ]; then cat "$f"; fi',
    'exit 0',
    '',
  ].join('\n'));
  t.after(restore);
  return () => joinSpawnLines(fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
}

// One entry per spawn: an argv value with newlines (a comment body) spills onto
// continuation lines, which carry no `GH_HOST=` prefix, so they rejoin their spawn.
function joinSpawnLines(raw) {
  const joined = [];
  for (const line of raw) {
    if (line.startsWith('GH_HOST=') || joined.length === 0) joined.push(line);
    else joined[joined.length - 1] += ` ${line}`;
  }
  return joined;
}

function childEnv() {
  const env = { ...process.env };
  delete env.GH_HOST;
  return env;
}

// In-process cases read process.env directly: GH_HOST is removed for the
// case and restored after it, and the per-cwd host memo starts empty.
function withoutGhHost(t) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'GH_HOST');
  const saved = process.env.GH_HOST;
  delete process.env.GH_HOST;
  _resetGhHostCache();
  t.after(() => {
    if (had) process.env.GH_HOST = saved;
    else delete process.env.GH_HOST;
    _resetGhHostCache();
  });
}

// The seam's once-per-host stderr note, captured for an in-process case so it
// stays out of the runner's output; any other stderr write passes through.
const SEAM_NOTE = 'claude-tweaks: resolved repo acme.ghe.com/acme/widgets (host: acme.ghe.com) — gh calls get GH_HOST=acme.ghe.com\n';
function captureSeamNotes(t) {
  const write = process.stderr.write;
  const notes = [];
  process.stderr.write = function capture(chunk, ...rest) {
    if (String(chunk).startsWith('claude-tweaks: resolved repo ')) { notes.push(String(chunk)); return true; }
    return write.call(this, chunk, ...rest);
  };
  const restore = () => { process.stderr.write = write; };
  t.after(restore);
  return { notes, restore };
}

function node(cwd, args) {
  return execFileSync(process.execPath, args, { cwd, env: childEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

// `--version` is the ghAvailable probe in repo-resolve.js: local, no network.
function networkLines(lines) {
  return lines.filter((l) => !/ ARGS=--version$/.test(l));
}

// The argv part of a recorded gh spawn line.
function argsOf(line) {
  return line.slice(line.indexOf(' ARGS=') + 6);
}

function escapeHost(host) {
  return host.replace(/\./g, '\\.');
}

// The argv alone routes the call to the host (a host-qualified --repo or a --hostname),
// whatever GH_HOST the call was spawned with.
function argvReachesHost(line, host) {
  const args = argsOf(line);
  const h = escapeHost(host);
  return new RegExp(`(?:^| )(?:-R|--repo)[ =]${h}/`).test(args) || new RegExp(`(?:^| )--hostname[ =]${h}(?: |$)`).test(args);
}

// The argv merely names the host: argvReachesHost, or a REST path `repos/{host}/…`.
// A path does not route (gh sends it to the GH_HOST/github.com default), so this is
// only for the GH_HOST-exported case, where routing is the user's own value and the
// check only has to show the spec kept the host. list-claims/claim-store put a
// host-qualified slug into a REST path, a pre-existing defect tracked in #4988.
function argvNamesHost(line, host) {
  return argvReachesHost(line, host) || new RegExp(`^api repos/${escapeHost(host)}/`).test(argsOf(line));
}

function reachesHost(line, host) {
  return line.startsWith(`GH_HOST=${host} `) || argvReachesHost(line, host);
}

function assertEveryLineReaches(lines, host) {
  const net = networkLines(lines);
  assert.ok(net.length >= 1, `expected at least one network-bound gh call, log:\n${lines.join('\n')}`);
  for (const line of net) assert.ok(reachesHost(line, host), `gh call did not reach ${host}: ${line}`);
}

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
const RELEASE_GATE_DEPS = { env: {}, readFile: () => { throw new Error('ENOENT'); } };
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
  const result = await releaseMerged({ cwd: repo, gateDeps: RELEASE_GATE_DEPS });
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

// Fix round 1: a bare `--repo owner/name` means github.com (Decision Q2). The
// author-association lookup threads no --hostname for github.com, so on a GHE
// origin the seam used to send it to the origin host while `issue view --repo`
// reached github.com: one record read from two hosts.
const MATERIALIZE_RECORD = JSON.stringify({
  number: 7,
  title: 'Fix the widget',
  body: [
    'Surface: backend',
    'Premise-check: true',
    '',
    '## Current State',
    'The widget is broken.',
    '',
    '## Deliverables',
    '- [ ] fix the widget',
    '',
    '## Acceptance Criteria',
    '1. The widget works',
    '',
    '## Release Note',
    'The widget works.',
  ].join('\n'),
  labels: [{ name: 'ceremony:standard' }],
  url: 'https://github.com/acme/widgets/issues/7',
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

// #4933: the origin-host gate, one behavior table for every gh CLI that derives
// its repo from `origin`. CLI_TABLE row: { cli: path under plugin/bin, argv: the
// smallest argv that passes the CLI's own input validation ({runDir} is replaced
// by the case's run dir), setup?: (repo) => void, acceptsRepo: the CLI takes
// --repo, typedRepoLines?: (line) => boolean (AC6.1 asserts host reachability
// only on the lines it selects; default every network line), canned?: gh answers
// replacing CANNED entries for the row's cases, hostnameLines?: (line) => boolean
// (every AC4.1 case requires --hostname only on the `gh api` lines it selects;
// default every `gh api` line -- a CLI whose GraphQL calls thread no host selects its
// REST calls), printsResolutionNote?: the CLI
// prints a repoResolutionNote (AC7.2 then requires `{cli}: resolved repo ...
// acme.ghe.com` on stderr), variant?: a suffix on the test titles when one CLI has
// several rows }. describeOriginGate(row)
// registers every case for one row, so a later task adds a CLI by adding a row.
const UNKNOWN_HOST = 'git.corp.invalid';
const NOT_KNOWN_MSG = 'is not a known GitHub host';

// Runs one CLI against a temp repo whose origin is `origin`. The child env has no
// GH_HOST unless `ghHost` sets one, carries an enterprise token (which admits no
// host by itself), and an empty per-case gh config dir (`hostsYml` writes its
// hosts.yml). GIT_ALLOW_PROTOCOL=file keeps git-CAS fetches off the network.
function runGated(t, row, { origin, extraArgs = [], ghHost, hostsYml }) {
  const readLog = installFakeGh(t, row.canned);
  const { repo, runDir } = makeRepo(t, origin);
  if (row.setup) row.setup(repo);
  const cfgDir = tmp(t, 'ct-gh-seam-cfg-');
  if (hostsYml !== undefined) fs.writeFileSync(path.join(cfgDir, 'hosts.yml'), hostsYml);
  const env = childEnv();
  delete env.GH_REPO;
  delete env.CLAUDE_CODE_SESSION_ID; // no session-scoped record snapshot (backlog-grant-gate.js)
  env.GH_ENTERPRISE_TOKEN = 't';
  env.GH_CONFIG_DIR = cfgDir;
  env.GIT_ALLOW_PROTOCOL = 'file';
  if (ghHost !== undefined) env.GH_HOST = ghHost;
  const argv = [...row.argv.map((a) => a.replace('{runDir}', runDir)), ...extraArgs];
  const r = spawnSync(process.execPath, [path.join(BIN, row.cli), ...argv], { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  return { status: r.status, stderr: r.stderr || '', lines: readLog() };
}

// Every `--repo`/`-R` value in the recorded gh argv.
function repoValues(lines) {
  const values = [];
  for (const line of lines) {
    for (const m of argsOf(line).matchAll(/(?:^| )(?:-R|--repo)[ =](\S+)/g)) values.push(m[1]);
  }
  return values;
}

function describeOriginGate(row) {
  const name = row.cli;
  const title = row.variant ? `${name} [${row.variant}]` : name;
  const opts = { skip: STUB_SKIP };

  test(`AC2.1 ${title}: refused on an unknown origin host (AC3.1: no bare-slug fallback)`, opts, (t) => {
    const r = runGated(t, row, { origin: `https://${UNKNOWN_HOST}/o/r.git` });
    const log = r.lines.join('\n');
    // Every gated CLI refuses with exit 2; fetch-sub-issues' exit 4 means "REST fallback" to its callers.
    assert.equal(r.status, 2, `expected exit 2, got ${r.status}; stderr:\n${r.stderr}`);
    assert.ok(r.stderr.includes(UNKNOWN_HOST), `stderr does not name ${UNKNOWN_HOST}:\n${r.stderr}`);
    assert.ok(r.stderr.includes(`GH_HOST=${UNKNOWN_HOST}`), `stderr does not suggest GH_HOST=${UNKNOWN_HOST}:\n${r.stderr}`);
    assert.deepEqual(networkLines(r.lines), [], `gh was called beyond --version:\n${log}`);
    assert.ok(!log.includes(UNKNOWN_HOST), `a gh call names ${UNKNOWN_HOST}:\n${log}`);
    assert.ok(!repoValues(r.lines).includes('o/r'), `a gh call carries a bare --repo o/r:\n${log}`);
  });

  // argvOnly: the exported GH_HOST prefixes every log line, so the host must be
  // proven by the argv (the CLI's host-qualified slug), never by that prefix. In
  // every case the `gh api` lines hostnameLines selects carry `--hostname {host}`
  // (a GH_HOST env prefix does not stand in for it), and any `--hostname` on any
  // other line names the host too.
  const passThrough = [
    ['an acme.ghe.com origin', 'acme.ghe.com', { origin: 'https://acme.ghe.com/o/r.git' }],
    ['a hosts.yml-key origin', 'ghes.corp.invalid', { origin: 'https://ghes.corp.invalid/o/r.git', hostsYml: 'ghes.corp.invalid:\n' }],
    [`a ${UNKNOWN_HOST} origin with GH_HOST exported`, UNKNOWN_HOST, { origin: `https://${UNKNOWN_HOST}/o/r.git`, ghHost: UNKNOWN_HOST }, true],
  ];
  for (const [label, host, caseOpts, argvOnly] of passThrough) {
    test(`AC4.1 ${title}: ${label} keeps the host-qualified repo`, opts, (t) => {
      const r = runGated(t, row, caseOpts);
      const log = r.lines.join('\n');
      assert.ok(!r.stderr.includes(NOT_KNOWN_MSG), `refused:\n${r.stderr}`);
      const net = networkLines(r.lines);
      if (argvOnly) {
        assert.ok(net.length >= 1, `expected at least one network-bound gh call, log:\n${log}`);
        assert.ok(net.some((l) => argvNamesHost(l, host)), `no gh call names ${host} in its argv, log:\n${log}`);
      } else {
        assertEveryLineReaches(r.lines, host);
      }
      for (const line of net.filter((l) => / ARGS=api /.test(l) && (!row.hostnameLines || row.hostnameLines(l)))) {
        assert.ok(new RegExp(` --hostname ${escapeHost(host)}(?: |$)`).test(line), `gh api call lacks --hostname ${host}: ${line}`);
      }
      for (const line of net) {
        for (const m of argsOf(line).matchAll(/(?:^| )--hostname[ =](\S+)/g)) assert.equal(m[1], host, `--hostname value: ${line}`);
      }
      for (const value of repoValues(r.lines)) assert.equal(value, `${host}/o/r`, `--repo value:\n${log}`);
    });
  }

  test(`AC5.1 ${title}: an exported GH_HOST naming another host is not refused and the slug is bare`, opts, (t) => {
    const r = runGated(t, row, { origin: `https://${UNKNOWN_HOST}/o/r.git`, ghHost: 'github.com' });
    const log = r.lines.join('\n');
    assert.ok(!r.stderr.includes(NOT_KNOWN_MSG), `refused:\n${r.stderr}`);
    assert.ok(networkLines(r.lines).length >= 1, `expected at least one network-bound gh call, log:\n${log}`);
    assert.ok(!log.includes(UNKNOWN_HOST), `a gh call names ${UNKNOWN_HOST}:\n${log}`);
    for (const value of repoValues(r.lines)) assert.equal(value, 'o/r', `--repo value:\n${log}`);
  });

  if (row.acceptsRepo) {
    test(`AC6.1 ${title}: a typed --repo ${UNKNOWN_HOST}/o/r is not refused and goes to ${UNKNOWN_HOST} as typed`, opts, (t) => {
      const typed = `${UNKNOWN_HOST}/o/r`;
      const r = runGated(t, row, { origin: `https://${UNKNOWN_HOST}/o/r.git`, extraArgs: ['--repo', typed] });
      assert.ok(!r.stderr.includes(NOT_KNOWN_MSG), `refused:\n${r.stderr}`);
      const net = networkLines(r.lines);
      assert.ok(net.length >= 1, `expected at least one network-bound gh call, log:\n${r.lines.join('\n')}`);
      const selected = row.typedRepoLines ? net.filter(row.typedRepoLines) : net;
      assert.ok(selected.length >= 1, `typedRepoLines selected no line, log:\n${r.lines.join('\n')}`);
      for (const line of selected) assert.ok(reachesHost(line, UNKNOWN_HOST), `gh call did not reach ${UNKNOWN_HOST}: ${line}`);
      for (const value of repoValues(r.lines)) assert.equal(value, typed, `--repo value:\n${r.lines.join('\n')}`);
    });
  }

  test(`AC7.1 ${title}: a github.com. origin normalizes to the bare slug`, opts, (t) => {
    const r = runGated(t, row, { origin: 'https://github.com./o/r.git' });
    const log = r.lines.join('\n');
    assert.ok(!r.stderr.includes(NOT_KNOWN_MSG), `refused:\n${r.stderr}`);
    assert.ok(networkLines(r.lines).length >= 1, `expected at least one network-bound gh call, log:\n${log}`);
    for (const value of repoValues(r.lines)) assert.equal(value, 'o/r', `--repo value:\n${log}`);
    assert.ok(!log.includes('--hostname'), `a gh call carries --hostname:\n${log}`);
    assert.ok(!r.stderr.includes('resolved repo'), `unexpected resolution note:\n${r.stderr}`);
    for (const line of r.lines) assert.ok(line.startsWith('GH_HOST=unset '), `GH_HOST set on github.com: ${line}`);
  });

  test(`AC7.2 ${title}: an ACME.ghe.com. origin normalizes to acme.ghe.com`, opts, (t) => {
    const r = runGated(t, row, { origin: 'https://ACME.ghe.com./o/r.git' });
    const log = r.lines.join('\n');
    assert.ok(!r.stderr.includes(NOT_KNOWN_MSG), `refused:\n${r.stderr}`);
    const net = networkLines(r.lines);
    assert.ok(net.length >= 1, `expected at least one network-bound gh call, log:\n${log}`);
    for (const value of repoValues(r.lines)) assert.equal(value, 'acme.ghe.com/o/r', `--repo value:\n${log}`);
    for (const line of net.filter((l) => / ARGS=api /.test(l))) {
      assert.ok(/ --hostname acme\.ghe\.com(?: |$)/.test(line) || line.startsWith('GH_HOST=acme.ghe.com '), `gh api call does not name acme.ghe.com: ${line}`);
    }
    assert.ok(!/ACME|ghe\.com\./.test(log), `a gh call carries the un-normalized host:\n${log}`);
    const notes = r.stderr.split('\n').filter((l) => l.includes('resolved repo'));
    for (const note of notes) {
      assert.ok(note.includes('acme.ghe.com') && !/ACME|ghe\.com\./.test(note), `resolution note does not name acme.ghe.com: ${note}`);
    }
    // printsResolutionNote: the CLI's own repoResolutionNote line (not the seam's
    // `claude-tweaks: resolved repo` note) must be there.
    if (row.printsResolutionNote) {
      assert.ok(notes.some((l) => l.startsWith(`${name}: resolved repo `)), `${name} printed no resolution note naming acme.ghe.com:\n${r.stderr}`);
    }
  });
}

// preflight-records.js reads work-links from the project policy when no flag gives it.
function writeWorkLinksPolicy(value) {
  return (repo) => fs.writeFileSync(path.join(repo, '.claude-tweaks', 'policy.yml'), `work-links: ${value}\n`);
}

function writeJsonFile(name, value) {
  return (repo) => fs.writeFileSync(path.join(repo, name), JSON.stringify(value));
}

// backlog-grant-gate.js: the policy and initial commit grantGateLines uses.
function setupGrantGate(repo) {
  git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(repo, ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-q', '-m', 'init']);
  fs.writeFileSync(path.join(repo, '.claude-tweaks', 'policy.yml'),
    'autonomy: unattended\ngrant-origination-enabled: true\nwork-links: native\nintegration-branch: main\n');
}

// fetch-sub-issues.js: answers both the schema probe (subIssues present) and the
// batch (no `i7` alias, so parent 7 lands in `retry`).
const FETCH_SUB_ISSUES_GRAPHQL = JSON.stringify({ data: { __type: { fields: [{ name: 'subIssues' }] }, repository: {} } });

// stuck-open-prs.js: candidate #1 (alias `i1`) is open with no closing PR.
const STUCK_OPEN_PRS_GRAPHQL = JSON.stringify({ data: { repository: { i1: { state: 'OPEN', closedByPullRequestsReferences: { nodes: [] }, timelineItems: { nodes: [] } } } } });

const CLI_TABLE = [
  { cli: 'materialize.js', argv: ['7', '--run-dir', '{runDir}'], acceptsRepo: true, printsResolutionNote: true, canned: { 'issue-view': MATERIALIZE_RECORD } },
  { cli: 'compose-subject.js', argv: ['7', '--tag', 'human-approved'], acceptsRepo: true },
  { cli: 'release-claim.js', argv: ['7', '--run', '{runDir}', '--reason', 'done'], acceptsRepo: true },
  { cli: 'repair-claim.js', argv: ['7', '--run', '{runDir}', '--mode', 'release', '--reason', 'unreadable'], acceptsRepo: true },
  { cli: 'preflight-records.js', variant: 'work-links: body-text', argv: ['7'], setup: writeWorkLinksPolicy('body-text'), acceptsRepo: true, printsResolutionNote: true },
  { cli: 'preflight-records.js', variant: 'work-links: native', argv: ['7'], setup: writeWorkLinksPolicy('native'), acceptsRepo: true, printsResolutionNote: true },
  { cli: 'parent-gate.js', argv: ['--sub-issue', '7', '--work-links', 'body-text', '--risk-floor', 'high'], acceptsRepo: false },
  { cli: 'resolved-refusal.js', argv: ['7'], acceptsRepo: true },
  { cli: 'link-records.js', argv: ['--parent', '7', '--subs', '8'], acceptsRepo: true },
  // fetch-sub-issues.js: the canned graphql answer serves the schema probe and the
  // batch (parent 7 absent from `repository` -> retry), so --resolve-retries reaches
  // the REST call too. Off github.com every one of the three carries --hostname (the
  // probe and the batch through withGraphqlHost, #4806), so no hostnameLines narrows it.
  { cli: 'fetch-sub-issues.js', argv: ['7', '--resolve-retries'], acceptsRepo: true, canned: { 'api-graphql': FETCH_SUB_ISSUES_GRAPHQL } },
  // backlog-grant-gate.js reads origin only under work-links: native. Its typed --repo
  // re-routes the native calls only (nativeRunnerFor); the issue lists keep following
  // the origin through the seam. It sends no --repo at all, so AC6.1's "--repo as typed"
  // loop is vacuous for this row: that case's proof rests on the native lines
  // (typedRepoLines) reaching the typed host.
  { cli: 'backlog-grant-gate.js', argv: [], setup: setupGrantGate, acceptsRepo: true, typedRepoLines: (l) => / ARGS=api (?:graphql|--paginate) /.test(l), hostnameLines: (l) => / ARGS=api --paginate /.test(l), canned: { 'api-graphql': '{"data":{"__type":{"fields":[]}}}', 'issue-list': '[{"number":1,"state":"CLOSED","labels":[]}]' } },
  { cli: 'apply-refine-labels.js', argv: ['actions.json'], setup: writeJsonFile('actions.json', [{ issue: 7, addLabels: ['ready'] }]), acceptsRepo: true },
  // --dry-run keeps file-feedback to its one repo-addressed read (the dedup search).
  { cli: 'file-feedback.js', argv: ['--drafts', 'drafts.json', '--dry-run'], setup: writeJsonFile('drafts.json', [{ title: 'T', body: 'B', fingerprintBasis: { component: 'c', summary: 's' } }]), acceptsRepo: true, canned: { 'issue-list': '[]' } },
  // list-claims.js: its one REST call carries a host-qualified slug in the path
  // (`repos/{host}/o/r/...`) and no --hostname -- list-claims/claim-store's pre-existing
  // defect, tracked in #4988 -- so the AC4.1 cases cannot require --hostname.
  { cli: 'list-claims.js', argv: [], acceptsRepo: true, hostnameLines: () => false },
  // resolve-blockers.js / resolve-linked-prs.js (lib/number-list-cli.js): both print a
  // repoResolutionNote.
  { cli: 'resolve-blockers.js', argv: ['7'], acceptsRepo: true, printsResolutionNote: true },
  { cli: 'resolve-foreign-blockers.js', argv: ['other/repo#5'], acceptsRepo: true, printsResolutionNote: true },
  { cli: 'resolve-linked-prs.js', argv: ['7'], acceptsRepo: true, printsResolutionNote: true },
  // stuck-open-prs.js (#4951): one granted candidate whose batched linked-PR read finds no
  // open PR, so the read is its one network-bound gh call and no per-record read follows.
  { cli: 'stuck-open-prs.js', argv: ['--records', 'records.json'], setup: writeJsonFile('records.json', [{ number: 1, state: 'OPEN', title: 'R', createdAt: '2026-10-01T08:00:00Z', labels: [{ name: 'auto:build' }] }]), acceptsRepo: false, canned: { 'api-graphql': STUCK_OPEN_PRS_GRAPHQL } },
];

for (const row of CLI_TABLE) describeOriginGate(row);

// #4794 Task 5: archive-merged and reap-merged file their residue escalation against the
// origin-derived repo. The runner is injected, so the argv it records is what `gh` would
// have been sent: a host-qualified --repo off github.com, the bare slug on it, and nothing
// at all through a refused origin (an SSH alias).
const RESIDUE_GATE_DEPS = { env: {}, readFile: () => { throw new Error('ENOENT'); } };
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

// Every argv carries `--repo <slug>` as adjacent elements, exactly once.
function assertRepoFlag(calls, slug) {
  assert.ok(calls.length >= 1, 'expected at least one gh call through the runner');
  for (const argv of calls) {
    const hits = argv.map((a, i) => (a === '--repo' && argv[i + 1] === slug ? i : -1)).filter((i) => i >= 0);
    assert.equal(hits.length, 1, `expected exactly one adjacent "--repo ${slug}" in ${JSON.stringify(argv)}`);
    assert.equal(argv.filter((a) => a === '--repo').length, 1, `more than one --repo in ${JSON.stringify(argv)}`);
  }
}

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
  const result = archiveMerged({ cwd: root, runner, gateDeps: RESIDUE_GATE_DEPS });
  assert.ok(result.skipped.some((s) => s.runDir === dir && s.reason === 'no-branch'), JSON.stringify(result));
  return { calls, root, dir };
}

test('AC1.1: archiveMerged on a *.ghe.com origin escalates structurally-stuck residue with --repo acme.ghe.com/acme/widgets', { skip: STUB_SKIP }, (t) => {
  const { calls } = archiveEscalation(t, GHE_ORIGIN);
  assertRepoFlag(calls, 'acme.ghe.com/acme/widgets');
});

test('AC2.1: archiveMerged on a github.com origin escalates with --repo acme/widgets', { skip: STUB_SKIP }, (t) => {
  const { calls } = archiveEscalation(t, DOTCOM_ORIGIN);
  assertRepoFlag(calls, 'acme/widgets');
});

test('#4794: archiveMerged on an SSH-alias origin escalates nothing — the runner sees no call', { skip: STUB_SKIP }, (t) => {
  const { calls } = archiveEscalation(t, 'git@github-work:acme/widgets.git');
  assert.deepEqual(calls, []);
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
    const result = reapMerged({ cwd: root, runner, prStates, gateDeps: RESIDUE_GATE_DEPS });
    assert.equal(result.skipped[0] && result.skipped[0].reason, 'removal-failed', `pass ${i + 1}: ${JSON.stringify(result)}`);
  }
  return { calls, root };
}

test('AC1.1: reapMerged on a *.ghe.com origin escalates removal-failed residue with the host-qualified --repo', { skip: STUB_SKIP }, (t) => {
  const { calls } = reapEscalation(t, GHE_ORIGIN);
  assertRepoFlag(calls, 'acme.ghe.com/acme/widgets');
});

test('AC2.1: reapMerged on a github.com origin escalates removal-failed residue with --repo acme/widgets', { skip: STUB_SKIP }, (t) => {
  const { calls } = reapEscalation(t, DOTCOM_ORIGIN);
  assertRepoFlag(calls, 'acme/widgets');
});

test('#4794: reapMerged on an SSH-alias origin escalates nothing and records unknown-host', { skip: STUB_SKIP }, (t) => {
  const { listResidueFailures } = require('../plugin/bin/lib/reconcile/cache');
  const { calls, root } = reapEscalation(t, 'git@github-work:acme/widgets.git');
  assert.deepEqual(calls, []);
  const entry = listResidueFailures(root).find((f) => f.reason === 'removal-failed');
  assert.ok(entry, 'expected a removal-failed residue entry');
  assert.ok(entry.lastResidueError && entry.lastResidueError.reason.startsWith('unknown-host ('), JSON.stringify(entry));
});
