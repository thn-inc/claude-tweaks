// tests/read-claims-cli.test.js — in-process tests for bin/read-claims.js's
// run(argv, deps) (#4818), mirroring tests/list-claims-cli.test.js's deps
// injection. The git runner is faked with a dispatch table over the git
// subcommands the CLI issues, except the one real-git round trip at the end,
// which spawns the CLI against a temp bare origin holding a claims-registry
// branch.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { run } = require('../plugin/bin/read-claims');

const NOW = Date.parse('2026-11-01T12:00:00Z');
const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'read-claims.js');

// Blob content keyed by issue number.
const BLOBS = {
  3: JSON.stringify({ issueNumber: 3, claimedAt: '2026-11-01T11:00:00Z', runId: 'r3' }), // live
  5: JSON.stringify({ issueNumber: 5, claimedAt: '2026-10-01T00:00:00Z', ttlHours: 1, runId: 'r5' }), // stale
  8: JSON.stringify({ issueNumber: 8, claimedAt: '2026-10-01T00:00:00Z', released: true }), // tombstone
  9: 'not json {', // unreadable
};

// `git cat-file --batch`: one `{sha} {type} {size}` header, the content, a newline per object.
function catFile(input, contentBySha) {
  const shas = Buffer.from(input).toString('utf8').split('\n').filter(Boolean);
  return Buffer.concat(shas.map((sha) => {
    const body = contentBySha[sha];
    if (body === undefined) return Buffer.from(`${sha} missing\n`);
    return Buffer.from(`${sha} blob ${Buffer.byteLength(body)}\n${body}\n`);
  }));
}

function fakeGit(overrides = {}, blobs = BLOBS) {
  const calls = [];
  const lsTree = Object.keys(blobs).map((n) => `100644 blob sha${n}\tclaims/issue-${n}.json\0`).join('');
  const contentBySha = Object.fromEntries(Object.entries(blobs).map(([n, c]) => [`sha${n}`, c]));
  const handlers = {
    fetch: () => '',
    'rev-parse': () => 'tip-sha\n',
    'ls-tree': () => lsTree,
    'cat-file': (args, opts) => catFile(opts.input, contentBySha),
    'update-ref': () => '',
    ...overrides,
  };
  const runner = (args, opts = {}) => {
    calls.push(args);
    const handler = handlers[args[0]];
    if (!handler) throw new Error(`unexpected git ${args[0]}`);
    return handler(args, opts);
  };
  return { runner, calls };
}

function harness(git) {
  const out = { stdout: [], stderr: [] };
  const deps = {
    runner: git.runner,
    now: () => NOW,
    stdout: (s) => out.stdout.push(s),
    stderr: (s) => out.stderr.push(s),
  };
  return { out, deps };
}

const rowsOf = (out) => out.stdout.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const REGISTRY_ROW = { number: null, state: 'could-not-read', reason: 'transport-failure' };

// The scratch ref is the refspec's destination in the fetch call.
function scratchRefOf(calls) {
  const fetch = calls.find((c) => c[0] === 'fetch');
  const refspec = fetch[3];
  return refspec.slice(refspec.indexOf(':') + 1);
}

test('a registry read that fails on transport is one could-not-read registry row, exit 3, no terminator (#4818)', () => {
  const git = fakeGit({ fetch: () => { throw new Error('HTTP 403 ... rate limit'); } });
  const { out, deps } = harness(git);
  assert.equal(run([], deps), 3);
  assert.deepEqual(rowsOf(out), [REGISTRY_ROW]);
  assert.match(out.stderr.join(''), /read-claims\.js: could not read claims-registry/);
});

test('a fetch timeout carries timedOut: true on the registry row', () => {
  const err = Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' });
  const { out, deps } = harness(fakeGit({ fetch: () => { throw err; } }));
  assert.equal(run([], deps), 3);
  assert.deepEqual(rowsOf(out), [{ ...REGISTRY_ROW, timedOut: true }]);
});

test('an ls-tree failure is the registry row, exit 3 — no blob rows, no terminator', () => {
  const { out, deps } = harness(fakeGit({ 'ls-tree': () => { throw new Error('fatal: unable to read tree'); } }));
  assert.equal(run([], deps), 3);
  assert.deepEqual(rowsOf(out), [REGISTRY_ROW]);
  assert.match(out.stderr.join(''), /could not read claims-registry: transport-failure/);
});

test('an ls-tree timeout carries timedOut: true on the registry row', () => {
  const err = Object.assign(new Error('spawnSync git ETIMEDOUT'), { killed: true });
  const { out, deps } = harness(fakeGit({ 'ls-tree': () => { throw err; } }));
  assert.equal(run([], deps), 3);
  assert.deepEqual(rowsOf(out), [{ ...REGISTRY_ROW, timedOut: true }]);
});

test('a cat-file --batch failure reads every listed claim as could-not-read, then the terminator, exit 0', () => {
  const git = fakeGit({ 'cat-file': () => { throw new Error('fatal: cat-file died'); } });
  const { out, deps } = harness(git);
  assert.equal(run([], deps), 0);
  assert.deepEqual(rowsOf(out), [
    ...[3, 5, 8, 9].map((n) => ({ number: n, state: 'could-not-read', reason: 'transport-failure' })),
    { number: null, state: 'complete', count: 4 },
  ]);
});

test('happy path: live, stale, tombstone and unreadable blobs classify to their states, then the terminator', () => {
  const { out, deps } = harness(fakeGit());
  assert.equal(run([], deps), 0);
  assert.deepEqual(rowsOf(out), [
    { number: 3, state: 'live', claimedAt: '2026-11-01T11:00:00Z' },
    { number: 5, state: 'stale', claimedAt: '2026-10-01T00:00:00Z' },
    { number: 8, state: 'tombstone', claimedAt: '2026-10-01T00:00:00Z' },
    { number: 9, state: 'unreadable' },
    { number: null, state: 'complete', count: 4 },
  ]);
});

test('a registry with no claims-registry branch is an empty registry: exit 0, the terminator with count 0', () => {
  const git = fakeGit({ fetch: () => { throw new Error("fatal: couldn't find remote ref claims-registry"); } });
  const { out, deps } = harness(git);
  assert.equal(run([], deps), 0);
  assert.deepEqual(rowsOf(out), [{ number: null, state: 'complete', count: 0 }]);
  assert.deepEqual(out.stderr, []);
});

test('the scratch ref is deleted after a successful read', () => {
  const git = fakeGit();
  const { deps } = harness(git);
  run([], deps);
  const ref = scratchRefOf(git.calls);
  assert.match(ref, /^refs\/claims-scan-read\//);
  assert.deepEqual(git.calls.filter((c) => c[0] === 'update-ref'), [['update-ref', '-d', ref]]);
});

test('the scratch ref is deleted when rev-parse fails, and the failure is the registry row', () => {
  const git = fakeGit({ 'rev-parse': () => { throw new Error('fatal: bad revision'); } });
  const { out, deps } = harness(git);
  assert.equal(run([], deps), 3);
  assert.deepEqual(rowsOf(out), [REGISTRY_ROW]);
  const ref = scratchRefOf(git.calls);
  assert.deepEqual(git.calls.filter((c) => c[0] === 'update-ref'), [['update-ref', '-d', ref]]);
});

test('--help prints usage, exit 0, git never called', () => {
  const git = fakeGit();
  const { out, deps } = harness(git);
  assert.equal(run(['--help'], deps), 0);
  assert.match(out.stdout.join(''), /usage: read-claims\.js/);
  assert.equal(git.calls.length, 0);
});

test('an unknown flag is a malformed invocation: exit 1, git never called', () => {
  const git = fakeGit();
  const { out, deps } = harness(git);
  assert.equal(run(['--bogus'], deps), 1);
  assert.match(out.stderr.join(''), /unknown argument: --bogus/);
  assert.equal(git.calls.length, 0);
});

test('--remote with no value is a malformed invocation: exit 1, git never called', () => {
  const git = fakeGit();
  const { out, deps } = harness(git);
  assert.equal(run(['--remote'], deps), 1);
  assert.equal(run(['--remote', ''], deps), 1);
  assert.equal(git.calls.length, 0);
  assert.match(out.stderr.join(''), /--remote needs a remote name/);
});

test('real git: a temp origin with two live claim blobs reads as two rows and the terminator through the spawned CLI', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'read-claims-cli-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const git = (args, cwd = work) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  git(['init', '--bare', '-q', origin], root);
  git(['clone', '-q', origin, work], root);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['checkout', '-q', '--orphan', 'claims-registry']);
  fs.mkdirSync(path.join(work, 'claims'));
  const claimedAt = new Date().toISOString();
  const claim = JSON.stringify({ issueNumber: 7, claimedAt, runId: 'r7' }, null, 2);
  fs.writeFileSync(path.join(work, 'claims', 'issue-7.json'), claim);
  fs.writeFileSync(path.join(work, 'claims', 'issue-9.json'), claim);
  git(['add', 'claims']);
  git(['commit', '-q', '-m', 'seed claims']);
  git(['push', '-q', 'origin', 'claims-registry']);

  const child = spawnSync(process.execPath, [CLI], { cwd: work, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const rows = child.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(rows, [
    { number: 7, state: 'live', claimedAt },
    { number: 9, state: 'live', claimedAt },
    { number: null, state: 'complete', count: 2 },
  ]);
});
