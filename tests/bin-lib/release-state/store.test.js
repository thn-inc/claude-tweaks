'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  RELEASE_STATE_BRANCH, STATE_FILE_RE, MAX_CAS_ATTEMPTS, readStateFile, classifyStateContent, ensureReleaseStateBranch,
  writeStateFile, createStateFile,
} = require('../../../plugin/bin/lib/release-state/store');
const {
  makeLine, commitRawState, realRunner, setupGit,
} = require('./fixtures');

const FILE = 'reviewed-through.json';
const BLOB = 'b'.repeat(40);
const CONTENTS_Q = '{content: (.content | @base64d), sha: .sha}';
const CONTENTS_PATH = `repos/o/r/contents/${FILE}?ref=release-state`;
const BRANCH_PATH = 'repos/o/r/branches/release-state';

const ok = (stdout = '') => ({ stdout, failure: null, status: null });
const notFound = () => ({
  stdout: null, failure: null, status: 404, error: 'Not Found (HTTP 404)',
});
const failed = (failure, status = null) => ({
  stdout: null, failure, status, error: `gh api failed: ${failure}`,
});

// A fake ghApi that records every call and throws on any shape no route names, so a wrong
// endpoint fails loudly instead of passing silently. A route key is the path argument, or
// `METHOD path` for a call that starts with `--method`; a route value is a result or a
// function of the argv.
function fakeGh(routes = {}) {
  const calls = [];
  const ghApi = (args) => {
    calls.push(args);
    const key = args[0] === '--method' ? `${args[1]} ${args[2]}` : args[0];
    if (!(key in routes)) throw new Error(`unexpected ${args.join(' ')}`);
    const route = routes[key];
    return typeof route === 'function' ? route(args) : route;
  };
  return { ghApi, calls };
}

// The ghApi of a git-leg test: any call is a failure, and the count is the proof of none.
function noGh() {
  return fakeGh();
}

// A real git runner in `cwd` that records every argv it runs into `calls`.
function recordingRunner(cwd, calls = []) {
  const run = realRunner(cwd);
  return (args, opts) => {
    calls.push(args);
    return run(args, opts);
  };
}

function contentsAnswer(content, sha = BLOB) {
  return ok(JSON.stringify({ content, sha }));
}

test('AC4.1: a branchless remote reads absent with branchMissing, on the git leg', () => {
  const fx = makeLine();
  const gh = noGh();
  const r = readStateFile({ ghApi: gh.ghApi, gitRunner: recordingRunner(fx.cloneA) }, 'o/r', FILE);
  assert.deepEqual(r, {
    state: 'absent', branchMissing: true, via: 'git', lease: null,
  });
  assert.equal(gh.calls.length, 0);
});

test('AC4.1: a branchless remote reads absent with branchMissing, on the contents leg', () => {
  const gh = fakeGh({
    [CONTENTS_PATH]: notFound(),
    [BRANCH_PATH]: notFound(),
    'repos/o/r': ok('o/r\n'),
  });
  const r = readStateFile({ ghApi: gh.ghApi }, 'o/r', FILE);
  assert.deepEqual(r, {
    state: 'absent', branchMissing: true, via: 'contents-api', lease: null,
  });
});

test('AC4.1: a missing file on an existing branch reads absent without branchMissing, on the contents leg', () => {
  const gh = fakeGh({
    [CONTENTS_PATH]: notFound(),
    [BRANCH_PATH]: ok('release-state\n'),
  });
  const r = readStateFile({ ghApi: gh.ghApi }, 'o/r', FILE);
  assert.deepEqual(r, {
    state: 'absent', branchMissing: false, via: 'contents-api', lease: null,
  });
  assert.equal(gh.calls.length, 2);
});

test('AC4.1: a missing file on an existing branch reads absent with the tip as its lease, on the git leg', () => {
  const fx = makeLine();
  const tip = commitRawState(fx, fx.cloneB, 'other.json', '{}');
  const gh = noGh();
  const r = readStateFile({ ghApi: gh.ghApi, gitRunner: recordingRunner(fx.cloneA) }, 'o/r', FILE);
  assert.deepEqual(r, {
    state: 'absent', branchMissing: false, via: 'git', lease: tip,
  });
  assert.equal(gh.calls.length, 0);
});

test('AC5.1: an inaccessible repo is unreadable, never absent', () => {
  const gh = fakeGh({
    [CONTENTS_PATH]: notFound(),
    [BRANCH_PATH]: notFound(),
    'repos/o/r': notFound(),
  });
  const r = readStateFile({ ghApi: gh.ghApi }, 'o/r', FILE);
  assert.equal(r.state, 'unreadable');
  assert.equal(r.failure, 'repo-unconfirmed');
  assert.equal(gh.calls.length, 3);
});

test('AC5.1: a repo that answers as another repository is unreadable, never absent', () => {
  const gh = fakeGh({
    [CONTENTS_PATH]: notFound(),
    [BRANCH_PATH]: notFound(),
    'repos/o/r': ok('o/elsewhere\n'),
  });
  const r = readStateFile({ ghApi: gh.ghApi }, 'o/r', FILE);
  assert.equal(r.state, 'unreadable');
  assert.equal(r.failure, 'repo-unconfirmed');
});

test('AC5.1: a branch read or repo read that fails is unreadable with that failure', () => {
  const branchFails = fakeGh({ [CONTENTS_PATH]: notFound(), [BRANCH_PATH]: failed('network-failure') });
  const a = readStateFile({ ghApi: branchFails.ghApi }, 'o/r', FILE);
  assert.equal(a.state, 'unreadable');
  assert.equal(a.failure, 'network-failure');
  const repoFails = fakeGh({
    [CONTENTS_PATH]: notFound(), [BRANCH_PATH]: notFound(), 'repos/o/r': failed('permission-denied', 403),
  });
  const b = readStateFile({ ghApi: repoFails.ghApi }, 'o/r', FILE);
  assert.equal(b.state, 'unreadable');
  assert.equal(b.failure, 'permission-denied');
});

test('AC5.1: a branch read answering a status with no failure is unreadable, never absent', () => {
  for (const status of [409, 422]) {
    const gh = fakeGh({
      [CONTENTS_PATH]: notFound(),
      [BRANCH_PATH]: { stdout: null, failure: null, status, error: `HTTP ${status}` },
    });
    const r = readStateFile({ ghApi: gh.ghApi }, 'o/r', FILE);
    assert.equal(r.state, 'unreadable', String(status));
    assert.equal(r.failure, `http-${status}`);
    assert.equal(gh.calls.length, 2, 'no repo read follows');
  }
});

test('AC5.1: auth, 5xx, rate limit and gh-absent are unreadable', () => {
  const cases = [
    failed('permission-denied', 403), failed('network-failure'), failed('secondary-rate-limit', 403), failed('gh-absent'),
  ];
  for (const answer of cases) {
    const gh = fakeGh({ [CONTENTS_PATH]: answer });
    const r = readStateFile({ ghApi: gh.ghApi }, 'o/r', FILE);
    assert.equal(r.state, 'unreadable', answer.failure);
    assert.equal(r.failure, answer.failure);
    assert.equal(gh.calls.length, 1, `${answer.failure}: no branch read follows`);
  }
});

test('AC5.1: a contents answer that is not a {content, sha} object is unreadable', () => {
  for (const stdout of ['not json', '"a string"', '{"sha":"abc"}', '{"content":"{}"}', 'null', '{"error":"x"}']) {
    const gh = fakeGh({ [CONTENTS_PATH]: ok(stdout) });
    const r = readStateFile({ ghApi: gh.ghApi }, 'o/r', FILE);
    assert.equal(r.state, 'unreadable', stdout);
    assert.equal(r.failure, 'malformed-answer', stdout);
  }
});

test('AC8.2: malformed JSON and a non-object are unreadable but keep the lease, on the contents leg', () => {
  const malformed = readStateFile({ ghApi: fakeGh({ [CONTENTS_PATH]: contentsAnswer('{') }).ghApi }, 'o/r', FILE);
  assert.equal(malformed.state, 'unreadable');
  assert.equal(malformed.failure, 'malformed-json');
  assert.equal(malformed.content, '{');
  assert.equal(malformed.lease, BLOB);
  assert.equal(malformed.via, 'contents-api');
  for (const content of ['[1]', 'null', '"x"', '7']) {
    const r = readStateFile({ ghApi: fakeGh({ [CONTENTS_PATH]: contentsAnswer(content) }).ghApi }, 'o/r', FILE);
    assert.equal(r.state, 'unreadable', content);
    assert.equal(r.failure, 'not-an-object', content);
    assert.equal(r.content, content);
    assert.equal(r.lease, BLOB);
  }
});

test('AC8.2: malformed JSON and a non-object are unreadable but keep the lease, on the git leg', () => {
  const fx = makeLine();
  const gh = noGh();
  const deps = { ghApi: gh.ghApi, gitRunner: recordingRunner(fx.cloneA) };
  const tip = commitRawState(fx, fx.cloneB, FILE, '{');
  const malformed = readStateFile(deps, 'o/r', FILE);
  assert.equal(malformed.state, 'unreadable');
  assert.equal(malformed.failure, 'malformed-json');
  assert.equal(malformed.content, '{');
  assert.equal(malformed.lease, tip);
  assert.equal(malformed.via, 'git');
  const arrayTip = commitRawState(fx, fx.cloneB, FILE, '[1]');
  const array = readStateFile(deps, 'o/r', FILE);
  assert.equal(array.failure, 'not-an-object');
  assert.equal(array.content, '[1]');
  assert.equal(array.lease, arrayTip);
  assert.equal(gh.calls.length, 0);
});

test('classifyStateContent: one verdict per byte shape, the lease and via carried through', () => {
  const lease = 'c'.repeat(40);
  assert.deepEqual(classifyStateContent('{"a":1}\n', { lease, via: 'git' }), {
    state: 'present', content: '{"a":1}\n', value: { a: 1 }, lease, via: 'git',
  });
  for (const [content, failure] of [['', 'malformed-json'], ['{', 'malformed-json'], ['{} {}', 'malformed-json'], ['[]', 'not-an-object'], ['null', 'not-an-object'], ['1', 'not-an-object']]) {
    const r = classifyStateContent(content, { lease, via: 'contents-api' });
    assert.equal(r.state, 'unreadable', JSON.stringify(content));
    assert.equal(r.failure, failure, JSON.stringify(content));
    assert.equal(r.content, content);
    assert.equal(r.lease, lease);
    assert.equal(r.via, 'contents-api');
    assert.equal(typeof r.reason, 'string');
  }
});

test('store: a present file returns content, parsed value and lease on both legs', () => {
  const fx = makeLine();
  const content = '{"version":1}\n';
  const tip = commitRawState(fx, fx.cloneB, FILE, content);
  const git = readStateFile({ ghApi: noGh().ghApi, gitRunner: recordingRunner(fx.cloneA) }, 'o/r', FILE);
  assert.deepEqual(git, {
    state: 'present', content, value: { version: 1 }, lease: tip, via: 'git',
  });
  const contents = readStateFile({ ghApi: fakeGh({ [CONTENTS_PATH]: contentsAnswer(content) }).ghApi }, 'o/r', FILE);
  assert.deepEqual(contents, {
    state: 'present', content, value: { version: 1 }, lease: BLOB, via: 'contents-api',
  });
});

test('store: a git transport failure falls back to the contents API', () => {
  const gh = fakeGh({ [CONTENTS_PATH]: contentsAnswer('{"a":1}') });
  const gitRunner = () => { throw new Error('fatal: unable to access \'https://example.invalid/o/r.git/\': Could not resolve host'); };
  const r = readStateFile({ ghApi: gh.ghApi, gitRunner }, 'o/r', FILE);
  assert.equal(r.state, 'present');
  assert.equal(r.via, 'contents-api');
  assert.equal(r.lease, BLOB);
  assert.equal(gh.calls.length, 1);
});

test('store: argv', () => {
  // The contents read and the branch and repo reads that settle a 404.
  const gh = fakeGh({
    [CONTENTS_PATH]: notFound(),
    [BRANCH_PATH]: notFound(),
    'repos/o/r': ok('o/r'),
  });
  readStateFile({ ghApi: gh.ghApi }, 'o/r', FILE);
  assert.deepEqual(gh.calls[0], [CONTENTS_PATH, '-q', CONTENTS_Q]);
  assert.deepEqual(gh.calls[1], [BRANCH_PATH, '-q', '.name']);
  assert.deepEqual(gh.calls[2], ['repos/o/r', '-q', '.full_name']);
  for (const args of gh.calls) {
    assert.ok(!args.includes('-f') && !args.includes('-F'), `a read never carries -f/-F: ${args.join(' ')}`);
  }

  // The git read: fetch into a per-call scratch ref, resolve it, show the file at the tip,
  // and delete the scratch ref afterwards.
  const fx = makeLine();
  const tip = commitRawState(fx, fx.cloneB, FILE, '{}');
  const calls = [];
  readStateFile({ ghApi: noGh().ghApi, gitRunner: recordingRunner(fx.cloneA, calls) }, 'o/r', FILE);
  const fetch = calls.find((args) => args[0] === 'fetch');
  assert.equal(fetch.length, 6);
  assert.deepEqual(fetch.slice(0, 5), ['fetch', '-q', '--no-tags', '--no-write-fetch-head', 'origin']);
  assert.match(fetch[5], /^refs\/heads\/release-state:refs\/release-state-cas\/\d+-\d+-[a-z0-9]*$/);
  assert.equal(fs.existsSync(path.join(fx.cloneA, '.git', 'FETCH_HEAD')), false, 'the read never writes FETCH_HEAD');
  const scratch = fetch[5].split(':')[1];
  assert.deepEqual(calls.find((args) => args[0] === 'rev-parse'), ['rev-parse', scratch]);
  assert.deepEqual(calls.find((args) => args[0] === 'show'), ['show', `${tip}:${FILE}`]);
  assert.deepEqual(calls.find((args) => args[0] === 'update-ref'), ['update-ref', '-d', scratch]);
  assert.equal(setupGit(['for-each-ref', 'refs/release-state-cas'], fx.cloneA), '', 'the scratch ref is gone');
});

test('store: a host-qualified slug or a bad file name throws TypeError', () => {
  const gh = noGh();
  const deps = { ghApi: gh.ghApi };
  assert.throws(() => readStateFile(deps, 'ghe.example.com/o/r', FILE), TypeError);
  assert.throws(() => readStateFile(deps, 'o', FILE), TypeError);
  assert.throws(() => readStateFile(deps, 'o/..', FILE), TypeError);
  assert.throws(() => ensureReleaseStateBranch(deps, 'ghe.example.com/o/r'), TypeError);
  for (const name of ['../x.json', 'a/b.json', 'main', '-x.json', 'X.json', 'a.json.bak', '']) {
    assert.throws(() => readStateFile(deps, 'o/r', name), TypeError, name);
  }
  assert.equal(gh.calls.length, 0, 'a caller bug never reaches the transport');
  assert.ok(STATE_FILE_RE.test(FILE));
});

test('store: the exported constants are the contract values', () => {
  assert.equal(RELEASE_STATE_BRANCH, 'release-state');
  assert.equal(MAX_CAS_ATTEMPTS, 3);
});

test('ensureReleaseStateBranch: creates the branch from the default tip, on the git leg', () => {
  const fx = makeLine();
  const gh = noGh();
  const calls = [];
  const r = ensureReleaseStateBranch({ ghApi: gh.ghApi, gitRunner: recordingRunner(fx.cloneA, calls) }, 'o/r');
  assert.deepEqual(r, { ok: true, created: true, via: 'git' });
  assert.equal(setupGit(['rev-parse', 'refs/heads/release-state'], fx.originDir), fx.P5);
  const fetch = calls.find((args) => args[0] === 'fetch');
  assert.deepEqual(fetch.slice(0, 5), ['fetch', '-q', '--no-tags', '--no-write-fetch-head', 'origin']);
  assert.match(fetch[5], /^HEAD:refs\/release-state-cas\/\d+-\d+-[a-z0-9]*$/);
  assert.equal(fs.existsSync(path.join(fx.cloneA, '.git', 'FETCH_HEAD')), false, 'the bootstrap never writes FETCH_HEAD');
  const push = calls.find((args) => args[0] === 'push');
  assert.deepEqual(push, ['push', '--no-verify', 'origin', `${fx.P5}:refs/heads/release-state`, '--force-with-lease=refs/heads/release-state:']);
  assert.equal(gh.calls.length, 0);
  assert.equal(setupGit(['for-each-ref', 'refs/release-state-cas'], fx.cloneA), '', 'the scratch ref is gone');
});

test('store: a read and a bootstrap leave no tag in the clone when the origin has tags', () => {
  // A fetch that stores into a ref auto-follows tags pointing at what it fetched; the store's
  // fetches pass --no-tags, so they never write refs/tags/* into the user's clone.
  const fx = makeLine();
  setupGit(['tag', 'v1.0.0', fx.P5], fx.originDir);
  const ensured = ensureReleaseStateBranch({ ghApi: noGh().ghApi, gitRunner: recordingRunner(fx.cloneA) }, 'o/r');
  assert.equal(ensured.ok, true);
  assert.equal(setupGit(['for-each-ref', 'refs/tags'], fx.cloneA), '', 'the bootstrap fetched no tag');
  const tip = commitRawState(fx, fx.cloneB, FILE, '{}');
  setupGit(['tag', 'v2.0.0', tip], fx.originDir);
  const read = readStateFile({ ghApi: noGh().ghApi, gitRunner: recordingRunner(fx.cloneA) }, 'o/r', FILE);
  assert.equal(read.state, 'present');
  assert.equal(setupGit(['for-each-ref', 'refs/tags'], fx.cloneA), '', 'the read fetched no tag');
});

test('ensureReleaseStateBranch: bootstraps from a non-main default branch', () => {
  const fx = makeLine({ branch: 'trunk' });
  const r = ensureReleaseStateBranch({ ghApi: noGh().ghApi, gitRunner: recordingRunner(fx.cloneA) }, 'o/r');
  assert.deepEqual(r, { ok: true, created: true, via: 'git' });
  assert.equal(setupGit(['rev-parse', 'refs/heads/release-state'], fx.originDir), fx.P5);
});

test('ensureReleaseStateBranch: a lost create race on the git leg is created:false when the branch now exists', () => {
  const fx = makeLine();
  const run = recordingRunner(fx.cloneA);
  let raced = false;
  const gitRunner = (args, opts) => {
    if (args[0] === 'push' && !raced) {
      raced = true;
      commitRawState(fx, fx.cloneB, 'other.json', '{}');
    }
    return run(args, opts);
  };
  const r = ensureReleaseStateBranch({ ghApi: noGh().ghApi, gitRunner }, 'o/r');
  assert.deepEqual(r, { ok: true, created: false, via: 'git' });
});

test('ensureReleaseStateBranch: a git failure falls back to the contents API, and both reasons survive a double failure', () => {
  const gitRunner = () => { throw new Error('fatal: unable to access the remote'); };
  const gh = fakeGh({
    'repos/o/r': ok('main\n'),
    'repos/o/r/git/ref/heads/main': ok('d'.repeat(40)),
    'POST repos/o/r/git/refs': ok(''),
  });
  assert.deepEqual(ensureReleaseStateBranch({ ghApi: gh.ghApi, gitRunner }, 'o/r'), { ok: true, created: true, via: 'contents-api' });
  const refused = fakeGh({ 'repos/o/r': failed('permission-denied', 403) });
  const r = ensureReleaseStateBranch({ ghApi: refused.ghApi, gitRunner }, 'o/r');
  assert.equal(r.ok, false);
  assert.match(r.reason, /^git: .*unable to access.*; contents-api: /);
  assert.equal('transient' in r, false);
});

test('ensureReleaseStateBranch: creates the branch from the default tip, on the contents leg', () => {
  const tip = 'e'.repeat(40);
  const gh = fakeGh({
    'repos/o/r': ok('main\n'),
    'repos/o/r/git/ref/heads/main': ok(`${tip}\n`),
    'POST repos/o/r/git/refs': ok(''),
  });
  const r = ensureReleaseStateBranch({ ghApi: gh.ghApi }, 'o/r');
  assert.deepEqual(r, { ok: true, created: true, via: 'contents-api' });
  assert.deepEqual(gh.calls, [
    ['repos/o/r', '-q', '.default_branch'],
    ['repos/o/r/git/ref/heads/main', '-q', '.object.sha'],
    ['--method', 'POST', 'repos/o/r/git/refs', '-f', 'ref=refs/heads/release-state', '-f', `sha=${tip}`],
  ]);
});

test('ensureReleaseStateBranch: a default branch with a slash or a space is encoded per segment', () => {
  const gh = fakeGh({
    'repos/o/r': ok('rel/a b\n'),
    'repos/o/r/git/ref/heads/rel/a%20b': ok('f'.repeat(40)),
    'POST repos/o/r/git/refs': ok(''),
  });
  assert.equal(ensureReleaseStateBranch({ ghApi: gh.ghApi }, 'o/r').ok, true);
});

test('ensureReleaseStateBranch: a 422 whose branch re-read is clean is created:false', () => {
  const gh = fakeGh({
    'repos/o/r': ok('main'),
    'repos/o/r/git/ref/heads/main': ok('a'.repeat(40)),
    'POST repos/o/r/git/refs': { ...notFound(), status: 422, error: 'Validation failed (HTTP 422)' },
    [BRANCH_PATH]: ok('release-state'),
  });
  assert.deepEqual(ensureReleaseStateBranch({ ghApi: gh.ghApi }, 'o/r'), { ok: true, created: false, via: 'contents-api' });
});

test('ensureReleaseStateBranch: a 422 whose branch re-read 404s is a refusal', () => {
  const gh = fakeGh({
    'repos/o/r': ok('main'),
    'repos/o/r/git/ref/heads/main': ok('a'.repeat(40)),
    'POST repos/o/r/git/refs': { ...notFound(), status: 422, error: 'Validation failed: a ruleset forbids it (HTTP 422)' },
    [BRANCH_PATH]: notFound(),
  });
  const r = ensureReleaseStateBranch({ ghApi: gh.ghApi }, 'o/r');
  assert.equal(r.ok, false);
  assert.match(r.reason, /ruleset forbids it/);
  assert.equal('transient' in r, false);
});

test('ensureReleaseStateBranch: a network failure is transient, a permission refusal is not', () => {
  const net = ensureReleaseStateBranch({ ghApi: fakeGh({ 'repos/o/r': failed('network-failure') }).ghApi }, 'o/r');
  assert.equal(net.ok, false);
  assert.equal(net.transient, true);
  assert.equal(net.failure, 'network-failure');
  const denied = ensureReleaseStateBranch({ ghApi: fakeGh({ 'repos/o/r': failed('permission-denied', 403) }).ghApi }, 'o/r');
  assert.equal(denied.ok, false);
  assert.equal('transient' in denied, false);
});

// ---- compare-and-set writes ----

const OLD = '{"version":1,"sha":"1"}\n';
const NEW = '{"version":1,"sha":"2"}\n';
const OTHER = '{"version":1,"sha":"3"}\n';
const MSG = 'Advance reviewed-through';
const PUT = `PUT repos/o/r/contents/${FILE}`;
const rejected = (status) => ({
  stdout: null, failure: null, status, error: `Validation failed (HTTP ${status})`,
});
const showAtOrigin = (fx, spec) => realRunner(fx.originDir)(['show', spec]);
const putArgs = (content, sha = null) => [
  '--method', 'PUT', `repos/o/r/contents/${FILE}`,
  '-f', `message=${MSG}`, '-f', `content=${Buffer.from(content, 'utf8').toString('base64')}`, '-f', 'branch=release-state',
  ...(sha ? ['-f', `sha=${sha}`] : []),
];
const transportDown = () => new Error("fatal: unable to access 'https://example.invalid/o/r.git/': Could not resolve host");

test('AC4.1: the first write on a branchless remote creates the branch, then the file', () => {
  const fx = makeLine();
  const gh = noGh();
  const r = createStateFile({ ghApi: gh.ghApi, gitRunner: recordingRunner(fx.cloneA) }, 'o/r', FILE, { content: NEW, message: MSG });
  assert.deepEqual(r, { ok: true, created: true, via: 'git' });
  assert.equal(showAtOrigin(fx, `release-state:${FILE}`), NEW);
  assert.equal(setupGit(['rev-parse', 'refs/heads/release-state^'], fx.originDir), fx.P5);
  assert.equal(setupGit(['log', '-1', '--format=%s', 'refs/heads/release-state'], fx.originDir), MSG);
  assert.equal(gh.calls.length, 0);
  assert.equal(setupGit(['for-each-ref', 'refs/release-state-cas'], fx.cloneA), '', 'the scratch ref is gone');
});

test('AC4.1: the first write on a branchless remote creates the branch, then the file, on the contents leg', () => {
  // The branch is read and created before the first PUT, so no PUT ever names a
  // branch that is not there.
  const tip = 'e'.repeat(40);
  const gh = fakeGh({
    [PUT]: ok(''),
    [BRANCH_PATH]: notFound(),
    'repos/o/r': ok('main\n'),
    'repos/o/r/git/ref/heads/main': ok(tip),
    'POST repos/o/r/git/refs': ok(''),
  });
  const r = createStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, { content: NEW, message: MSG });
  assert.deepEqual(r, { ok: true, created: true, via: 'contents-api' });
  assert.deepEqual(gh.calls, [
    [BRANCH_PATH, '-q', '.name'],
    ['repos/o/r', '-q', '.default_branch'],
    ['repos/o/r/git/ref/heads/main', '-q', '.object.sha'],
    ['--method', 'POST', 'repos/o/r/git/refs', '-f', 'ref=refs/heads/release-state', '-f', `sha=${tip}`],
    putArgs(NEW),
  ]);
});

test('createStateFile: a branch read that cannot answer is that failure, with no PUT and no creation', () => {
  for (const answer of [failed('network-failure'), failed('permission-denied', 403), { stdout: null, failure: null, status: 409, error: 'HTTP 409' }]) {
    const gh = fakeGh({ [BRANCH_PATH]: answer });
    const r = createStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, { content: NEW, message: MSG });
    assert.equal(r.ok, false, JSON.stringify(answer));
    assert.equal(r.failure, answer.failure || `http-${answer.status}`);
    assert.equal(typeof r.reason, 'string');
    assert.deepEqual(gh.calls, [[BRANCH_PATH, '-q', '.name']], 'the branch read alone: no PUT, no branch creation');
  }
});

test('createStateFile: a branch that goes missing after the check is created once, and the PUT lands', () => {
  const tip = 'e'.repeat(40);
  let branchReads = 0;
  let puts = 0;
  const gh = fakeGh({
    [BRANCH_PATH]: () => { branchReads += 1; return branchReads === 1 ? ok('release-state') : notFound(); },
    [PUT]: () => { puts += 1; return puts === 1 ? rejected(404) : ok(''); },
    [CONTENTS_PATH]: notFound(),
    'repos/o/r': (args) => (args[2] === '.full_name' ? ok('o/r\n') : ok('main\n')),
    'repos/o/r/git/ref/heads/main': ok(tip),
    'POST repos/o/r/git/refs': ok(''),
  });
  const r = createStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, { content: NEW, message: MSG });
  assert.deepEqual(r, { ok: true, created: true, via: 'contents-api' });
  assert.equal(puts, 2);
  assert.equal(gh.calls.filter((args) => args[0] === '--method' && args[1] === 'POST').length, 1);
});

test('createStateFile: an existing file is {exists:true} on both legs', () => {
  const fx = makeLine();
  const tip = commitRawState(fx, fx.cloneB, FILE, OLD);
  const calls = [];
  const git = createStateFile({ ghApi: noGh().ghApi, gitRunner: recordingRunner(fx.cloneA, calls) }, 'o/r', FILE, { content: NEW, message: MSG });
  assert.deepEqual(git, { ok: false, exists: true });
  assert.equal(setupGit(['rev-parse', 'refs/heads/release-state'], fx.originDir), tip, 'nothing was pushed');
  assert.equal(calls.some((args) => args[0] === 'push' || args[0] === 'commit-tree'), false, 'no commit was built');

  const gh = fakeGh({ [PUT]: rejected(422), [CONTENTS_PATH]: contentsAnswer(OLD), [BRANCH_PATH]: ok('release-state') });
  const contents = createStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, { content: NEW, message: MSG });
  assert.deepEqual(contents, { ok: false, exists: true });
  assert.deepEqual(gh.calls[0], [BRANCH_PATH, '-q', '.name'], 'the branch is confirmed first');
  assert.deepEqual(gh.calls[1], putArgs(NEW), 'a create sends no sha');
});

test('createStateFile: a 422 whose re-read equals our content is ok (self-write)', () => {
  const gh = fakeGh({ [PUT]: rejected(422), [CONTENTS_PATH]: contentsAnswer(NEW), [BRANCH_PATH]: ok('release-state') });
  const r = createStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, { content: NEW, message: MSG });
  assert.deepEqual(r, { ok: true, created: true, via: 'contents-api' });
});

test('createStateFile: a rejected PUT whose re-read finds the file absent on an existing branch is a refusal, never exists', () => {
  const gh = fakeGh({ [PUT]: rejected(422), [CONTENTS_PATH]: notFound(), [BRANCH_PATH]: ok('release-state') });
  const r = createStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, { content: NEW, message: MSG });
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'put-rejected');
  assert.equal('exists' in r, false);
  assert.match(r.reason, /Validation failed/);
});

test('createStateFile: a git contest settled by a fresh read retries, and a raced creator makes it {exists:true}', () => {
  const fx = makeLine();
  commitRawState(fx, fx.cloneB, 'seed.json', '{}');
  const run = recordingRunner(fx.cloneA);
  let raced = false;
  const gitRunner = (args, opts) => {
    if (args[0] === 'push' && !raced) {
      raced = true;
      commitRawState(fx, fx.cloneB, FILE, OTHER);
    }
    return run(args, opts);
  };
  const r = createStateFile({ ghApi: noGh().ghApi, gitRunner, sleep: () => {} }, 'o/r', FILE, { content: NEW, message: MSG });
  assert.deepEqual(r, { ok: false, exists: true });
  assert.equal(showAtOrigin(fx, `release-state:${FILE}`), OTHER);
});

test('createStateFile: a git transport failure falls back to a contents-API create', () => {
  const fx = makeLine();
  commitRawState(fx, fx.cloneB, 'seed.json', '{}');
  const run = realRunner(fx.cloneA);
  const gitRunner = (args, opts) => {
    if (args[0] === 'push') throw transportDown();
    return run(args, opts);
  };
  const gh = fakeGh({ [PUT]: ok(''), [BRANCH_PATH]: ok('release-state') });
  const r = createStateFile({ ghApi: gh.ghApi, gitRunner }, 'o/r', FILE, { content: NEW, message: MSG });
  assert.deepEqual(r, { ok: true, created: true, via: 'contents-api' });
  assert.deepEqual(gh.calls, [[BRANCH_PATH, '-q', '.name'], putArgs(NEW)]);
});

test('createStateFile: a branch that cannot be created is that failure, with no write attempted', () => {
  const gh = fakeGh({
    [BRANCH_PATH]: notFound(),
    'repos/o/r': failed('permission-denied', 403),
  });
  const r = createStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, { content: NEW, message: MSG });
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'branch-uncreatable');
  assert.match(r.reason, /contents-api: /);
  assert.equal(gh.calls.filter((args) => args[0] === '--method' && args[1] === 'PUT').length, 0, 'no PUT');
});

test('writeStateFile: a stale lease after an unrelated file changed retries and lands', () => {
  const fx = makeLine();
  commitRawState(fx, fx.cloneB, FILE, OLD);
  const calls = [];
  const run = recordingRunner(fx.cloneA, calls);
  let raced = false;
  const gitRunner = (args, opts) => {
    if (args[0] === 'push' && !raced) {
      raced = true;
      commitRawState(fx, fx.cloneB, 'merge-pause.json', '{"paused":true}');
    }
    return run(args, opts);
  };
  const sleeps = [];
  const gh = noGh();
  const deps = { ghApi: gh.ghApi, gitRunner, sleep: (ms) => sleeps.push(ms) };
  const read = readStateFile(deps, 'o/r', FILE);
  const r = writeStateFile(deps, 'o/r', FILE, {
    content: NEW, lease: read.lease, via: read.via, expectedContent: read.content, message: MSG,
  });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'git');
  assert.match(r.commitSha, /^[0-9a-f]{40}$/);
  assert.equal(calls.filter((args) => args[0] === 'push').length, 2);
  assert.equal(sleeps.length, 1);
  assert.equal(showAtOrigin(fx, `release-state:${FILE}`), NEW);
  assert.equal(showAtOrigin(fx, 'release-state:merge-pause.json'), '{"paused":true}');
  assert.equal(setupGit(['rev-parse', 'refs/heads/release-state'], fx.originDir), r.commitSha);
  assert.equal(gh.calls.length, 0);
});

test('writeStateFile: a stale lease after this file changed is {conflict:true}', () => {
  const fx = makeLine();
  commitRawState(fx, fx.cloneB, FILE, OLD);
  const run = recordingRunner(fx.cloneA);
  let raced = false;
  const gitRunner = (args, opts) => {
    if (args[0] === 'push' && !raced) {
      raced = true;
      commitRawState(fx, fx.cloneB, FILE, OTHER);
    }
    return run(args, opts);
  };
  const sleeps = [];
  const gh = noGh();
  const deps = { ghApi: gh.ghApi, gitRunner, sleep: (ms) => sleeps.push(ms) };
  const read = readStateFile(deps, 'o/r', FILE);
  const r = writeStateFile(deps, 'o/r', FILE, {
    content: NEW, lease: read.lease, via: read.via, expectedContent: read.content, message: MSG,
  });
  assert.deepEqual(r, { ok: false, conflict: true });
  assert.equal(sleeps.length, 0);
  assert.equal(showAtOrigin(fx, `release-state:${FILE}`), OTHER, 'the competitor stands');
  assert.equal(gh.calls.length, 0, 'a genuine contest is never retried over the other transport');
});

test('writeStateFile: a git write whose branch vanished after the rejected push is branchMissing', () => {
  const fx = makeLine();
  commitRawState(fx, fx.cloneB, FILE, OLD);
  const run = recordingRunner(fx.cloneA);
  let raced = false;
  const gitRunner = (args, opts) => {
    if (args[0] === 'push' && !raced) {
      raced = true;
      setupGit(['push', '-q', '--force', 'origin', ':refs/heads/release-state'], fx.cloneB);
    }
    return run(args, opts);
  };
  const deps = { ghApi: noGh().ghApi, gitRunner, sleep: () => {} };
  const read = readStateFile(deps, 'o/r', FILE);
  const r = writeStateFile(deps, 'o/r', FILE, {
    content: NEW, lease: read.lease, via: read.via, expectedContent: read.content, message: MSG,
  });
  assert.deepEqual(r, { ok: false, branchMissing: true });
});

test('writeStateFile: a spurious contest on every attempt ends on the contents API with a fresh lease', () => {
  const fx = makeLine();
  commitRawState(fx, fx.cloneB, FILE, OLD);
  const run = recordingRunner(fx.cloneA);
  let n = 0;
  const gitRunner = (args, opts) => {
    if (args[0] === 'push') {
      n += 1;
      commitRawState(fx, fx.cloneB, `noise-${n}.json`, '{}');
    }
    return run(args, opts);
  };
  const gh = fakeGh({ [CONTENTS_PATH]: contentsAnswer(OLD, 'd'.repeat(40)), [PUT]: ok('') });
  const deps = { ghApi: gh.ghApi, gitRunner, sleep: () => {} };
  const read = readStateFile(deps, 'o/r', FILE);
  const r = writeStateFile(deps, 'o/r', FILE, {
    content: NEW, lease: read.lease, via: read.via, expectedContent: read.content, message: MSG,
  });
  assert.deepEqual(r, { ok: true, via: 'contents-api' });
  assert.equal(n, MAX_CAS_ATTEMPTS);
  assert.deepEqual(gh.calls[gh.calls.length - 1], putArgs(NEW, 'd'.repeat(40)));
});

test('writeStateFile: a git transport failure falls back to a contents-API PUT carrying the fresh blob sha, never the git tip', () => {
  const fx = makeLine();
  const tip = commitRawState(fx, fx.cloneB, FILE, OLD);
  const run = realRunner(fx.cloneA);
  const gitRunner = (args, opts) => {
    if (args[0] === 'push') throw transportDown();
    return run(args, opts);
  };
  const fresh = 'f'.repeat(40);
  const gh = fakeGh({ [CONTENTS_PATH]: contentsAnswer(OLD, fresh), [PUT]: ok('') });
  const deps = { ghApi: gh.ghApi, gitRunner };
  const read = readStateFile(deps, 'o/r', FILE);
  assert.equal(read.lease, tip);
  assert.equal(gh.calls.length, 0);
  const r = writeStateFile(deps, 'o/r', FILE, {
    content: NEW, lease: read.lease, via: read.via, expectedContent: read.content, message: MSG,
  });
  assert.deepEqual(r, { ok: true, via: 'contents-api' });
  assert.deepEqual(gh.calls[0], [CONTENTS_PATH, '-q', CONTENTS_Q]);
  assert.deepEqual(gh.calls[1], putArgs(NEW, fresh));
  assert.ok(gh.calls[1].includes('--method') && gh.calls[1].includes('PUT'));
  assert.ok(gh.calls[1].includes('branch=release-state'));
  assert.equal(gh.calls[1].some((a) => a.includes(tip)), false, 'the git tip is never a contents-API lease');
});

test('writeStateFile: after a git failure, a fresh read that differs from expectedContent is {conflict:true} with no PUT', () => {
  const fx = makeLine();
  commitRawState(fx, fx.cloneB, FILE, OLD);
  const calls = [];
  const run = recordingRunner(fx.cloneA, calls);
  const gitRunner = (args, opts) => {
    if (args[0] === 'push') {
      calls.push(args);
      throw transportDown();
    }
    return run(args, opts);
  };
  // Read first, so the tip's objects are in clone A and the injected push failure, not an
  // unknown-object failure at `read-tree`, is what routes the write to the contents API.
  const read = readStateFile({ ghApi: noGh().ghApi, gitRunner }, 'o/r', FILE);
  assert.equal(read.via, 'git');
  for (const answer of [contentsAnswer(OTHER, 'f'.repeat(40)), notFound()]) {
    const gh = fakeGh({ [CONTENTS_PATH]: answer, [BRANCH_PATH]: ok('release-state') });
    const pushesBefore = calls.filter((args) => args[0] === 'push').length;
    const r = writeStateFile({ ghApi: gh.ghApi, gitRunner }, 'o/r', FILE, {
      content: NEW, lease: read.lease, via: read.via, expectedContent: read.content, message: MSG,
    });
    assert.deepEqual(r, { ok: false, conflict: true });
    assert.equal(calls.filter((args) => args[0] === 'push').length, pushesBefore + 1, 'the push was attempted');
    assert.equal(gh.calls.some((args) => args[0] === '--method'), false, 'no PUT');
  }
});

test('writeStateFile: after a git failure, a fresh read equal to our content is the self-write, ok with no PUT', () => {
  const fx = makeLine();
  commitRawState(fx, fx.cloneB, FILE, OLD);
  const calls = [];
  const run = recordingRunner(fx.cloneA, calls);
  const gitRunner = (args, opts) => {
    if (args[0] === 'push') {
      calls.push(args);
      throw transportDown();
    }
    return run(args, opts);
  };
  const read = readStateFile({ ghApi: noGh().ghApi, gitRunner }, 'o/r', FILE);
  assert.equal(read.via, 'git');
  const gh = fakeGh({ [CONTENTS_PATH]: contentsAnswer(NEW) });
  const r = writeStateFile({ ghApi: gh.ghApi, gitRunner }, 'o/r', FILE, {
    content: NEW, lease: read.lease, via: read.via, expectedContent: read.content, message: MSG,
  });
  assert.deepEqual(r, { ok: true, via: 'contents-api' });
  assert.equal(calls.filter((args) => args[0] === 'push').length, 1, 'the push was attempted');
  assert.equal(gh.calls.length, 1);
});

test('writeStateFile: a git-leased write with no gitRunner reads fresh over the contents API rather than reuse the tip', () => {
  const tip = 'a'.repeat(40);
  const fresh = 'f'.repeat(40);
  const gh = fakeGh({ [CONTENTS_PATH]: contentsAnswer(OLD, fresh), [PUT]: ok('') });
  const r = writeStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, {
    content: NEW, lease: tip, via: 'git', expectedContent: OLD, message: MSG,
  });
  assert.deepEqual(r, { ok: true, via: 'contents-api' });
  assert.deepEqual(gh.calls[1], putArgs(NEW, fresh));
});

test('writeStateFile: a contents-API lease goes straight to a PUT carrying it', () => {
  const gh = fakeGh({ [PUT]: ok('') });
  const r = writeStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, {
    content: NEW, lease: BLOB, via: 'contents-api', expectedContent: OLD, message: MSG,
  });
  assert.deepEqual(r, { ok: true, via: 'contents-api' });
  assert.deepEqual(gh.calls, [putArgs(NEW, BLOB)]);
});

test('writeStateFile: a contents-API lease is never used on the git leg, even with a gitRunner', () => {
  const gitRunner = () => { throw new Error('the git leg must not run for a contents-API lease'); };
  const gh = fakeGh({ [PUT]: ok('') });
  const r = writeStateFile({ ghApi: gh.ghApi, gitRunner }, 'o/r', FILE, {
    content: NEW, lease: BLOB, via: 'contents-api', expectedContent: OLD, message: MSG,
  });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'contents-api');
});

test('writeStateFile: contents-API 409/422 settle by re-read', () => {
  const lease = 'c'.repeat(40);
  const args = {
    content: NEW, lease: BLOB, via: 'contents-api', expectedContent: OLD, message: MSG,
  };
  for (const status of [404, 409, 422]) {
    const self = fakeGh({ [PUT]: rejected(status), [CONTENTS_PATH]: contentsAnswer(NEW, lease) });
    assert.deepEqual(writeStateFile({ ghApi: self.ghApi }, 'o/r', FILE, args), { ok: true, via: 'contents-api' }, `${status} self-write`);

    const other = fakeGh({ [PUT]: rejected(status), [CONTENTS_PATH]: contentsAnswer(OTHER, lease) });
    assert.deepEqual(writeStateFile({ ghApi: other.ghApi, sleep: () => {} }, 'o/r', FILE, args), { ok: false, conflict: true }, `${status} other content`);

    const denied = fakeGh({ [PUT]: rejected(status), [CONTENTS_PATH]: failed('permission-denied', 403) });
    const d = writeStateFile({ ghApi: denied.ghApi }, 'o/r', FILE, args);
    assert.equal(d.ok, false, `${status} denied`);
    assert.equal(d.failure, 'permission-denied');
    assert.equal(typeof d.reason, 'string');
    assert.equal('conflict' in d, false);

    const gone = fakeGh({
      [PUT]: rejected(status), [CONTENTS_PATH]: notFound(), [BRANCH_PATH]: notFound(), 'repos/o/r': ok('o/r\n'),
    });
    assert.deepEqual(writeStateFile({ ghApi: gone.ghApi }, 'o/r', FILE, args), { ok: false, branchMissing: true }, `${status} branch missing`);

    const removed = fakeGh({ [PUT]: rejected(status), [CONTENTS_PATH]: notFound(), [BRANCH_PATH]: ok('release-state') });
    assert.deepEqual(writeStateFile({ ghApi: removed.ghApi }, 'o/r', FILE, args), { ok: false, conflict: true }, `${status} file removed`);
  }
});

test('writeStateFile: a PUT failure that is not a rejection is that failure', () => {
  const args = {
    content: NEW, lease: BLOB, via: 'contents-api', expectedContent: OLD, message: MSG,
  };
  for (const failure of ['secondary-rate-limit', 'network-failure', 'permission-denied']) {
    const gh = fakeGh({ [PUT]: failed(failure, failure === 'network-failure' ? null : 403) });
    const r = writeStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, args);
    assert.equal(r.ok, false, failure);
    assert.equal(r.failure, failure);
    assert.equal(typeof r.reason, 'string');
    assert.equal(gh.calls.length, 1, 'a failure that is not a rejection is not settled by a re-read');
  }
});

test('writeStateFile: a failing contents re-read after a git failure is that failure, with no PUT', () => {
  const gh = fakeGh({ [CONTENTS_PATH]: failed('network-failure') });
  const r = writeStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, {
    content: NEW, lease: 'a'.repeat(40), via: 'git', expectedContent: OLD, message: MSG,
  });
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'network-failure');
  assert.equal(gh.calls.length, 1);
});

test('store: invalid content and message are refused before any call', () => {
  const gh = noGh();
  const calls = [];
  const gitRunner = (args) => { calls.push(args); throw new Error('no git call may happen'); };
  const deps = { ghApi: gh.ghApi, gitRunner };
  const base = {
    content: NEW, lease: BLOB, via: 'contents-api', expectedContent: OLD, message: MSG,
  };
  const cases = [
    [{ content: 'undefined' }, 'invalid-content'],
    [{ content: '[]' }, 'invalid-content'],
    [{ content: 'null' }, 'invalid-content'],
    [{ content: '' }, 'invalid-content'],
    [{ content: undefined }, 'invalid-content'],
    [{ message: 'fix #12' }, 'invalid-message'],
    [{ message: 'a\nb' }, 'invalid-message'],
    [{ message: 'a\rb' }, 'invalid-message'],
    [{ message: 'x'.repeat(201) }, 'invalid-message'],
    [{ message: '' }, 'invalid-message'],
    [{ message: undefined }, 'invalid-message'],
  ];
  for (const [override, failure] of cases) {
    const w = writeStateFile(deps, 'o/r', FILE, { ...base, ...override });
    assert.equal(w.ok, false);
    assert.equal(w.failure, failure, JSON.stringify(override));
    assert.equal(typeof w.reason, 'string');
    const c = createStateFile(deps, 'o/r', FILE, { content: base.content, message: base.message, ...override });
    assert.equal(c.ok, false);
    assert.equal(c.failure, failure, JSON.stringify(override));
  }
  assert.equal(gh.calls.length, 0);
  assert.equal(calls.length, 0);
  const edge = fakeGh({ [PUT]: ok('') });
  const long = 'x'.repeat(200);
  assert.equal(writeStateFile({ ghApi: edge.ghApi }, 'o/r', FILE, { ...base, message: long }).ok, true, 'a 200-char message is accepted');
});

test('store: a bad slug, file name, via or lease is a TypeError before any call', () => {
  const gh = noGh();
  const deps = { ghApi: gh.ghApi };
  const base = {
    content: NEW, lease: BLOB, via: 'contents-api', expectedContent: OLD, message: MSG,
  };
  assert.throws(() => writeStateFile(deps, 'ghe.example.com/o/r', FILE, base), TypeError);
  assert.throws(() => writeStateFile(deps, 'o/r', '../x.json', base), TypeError);
  assert.throws(() => writeStateFile(deps, 'o/r', FILE, { ...base, via: 'ftp' }), TypeError);
  assert.throws(() => writeStateFile(deps, 'o/r', FILE, { ...base, lease: null }), TypeError);
  assert.throws(() => createStateFile(deps, 'ghe.example.com/o/r', FILE, base), TypeError);
  assert.throws(() => createStateFile(deps, 'o/r', 'main', base), TypeError);
  assert.equal(gh.calls.length, 0);
});

test('createStateFile: a branch still missing after one creation is branch-uncreatable, never a bare branchMissing', () => {
  const gh = fakeGh({
    [PUT]: rejected(404),
    [CONTENTS_PATH]: notFound(),
    [BRANCH_PATH]: notFound(),
    'repos/o/r': (args) => (args[2] === '.full_name' ? ok('o/r\n') : ok('main\n')),
    'repos/o/r/git/ref/heads/main': ok('e'.repeat(40)),
    'POST repos/o/r/git/refs': ok(''),
  });
  const r = createStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, { content: NEW, message: MSG });
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'branch-uncreatable');
  assert.equal(typeof r.reason, 'string');
  assert.equal('branchMissing' in r, false);
  assert.equal(gh.calls.filter((args) => args[0] === '--method' && args[1] === 'PUT').length, 1, 'one creation before the PUT, no second one');
  assert.equal(gh.calls.filter((args) => args[0] === '--method' && args[1] === 'POST').length, 1);
});

test('writeStateFile: a git lease that is not a commit sha is a TypeError, never an argument to git', () => {
  const calls = [];
  const gitRunner = (args) => { calls.push(args); throw new Error('no git call may happen'); };
  const gh = noGh();
  const base = {
    content: NEW, via: 'git', expectedContent: OLD, message: MSG,
  };
  for (const lease of ['--upload-pack=x', '-x', 'HEAD', 'main', 'A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), `${'a'.repeat(40)} `, 'a'.repeat(64 + 1)]) {
    assert.throws(() => writeStateFile({ ghApi: gh.ghApi, gitRunner }, 'o/r', FILE, { ...base, lease }), TypeError, lease);
  }
  assert.equal(calls.length, 0);
  assert.equal(gh.calls.length, 0);
  // A SHA-1 and a SHA-256 commit id pass the shape check; a blob sha is not checked as a commit.
  for (const lease of ['a'.repeat(40), 'a'.repeat(64)]) {
    const ok1 = fakeGh({ [CONTENTS_PATH]: contentsAnswer(OLD, 'f'.repeat(40)), [PUT]: ok('') });
    assert.equal(writeStateFile({ ghApi: ok1.ghApi }, 'o/r', FILE, { ...base, lease }).ok, true, lease);
  }
  const put = fakeGh({ [PUT]: ok('') });
  assert.equal(writeStateFile({ ghApi: put.ghApi }, 'o/r', FILE, { ...base, via: 'contents-api', lease: 'not-a-sha-but-a-blob-lease' }).ok, true);
});

test('writeStateFile: a missing expectedContent is a TypeError, never a contest', () => {
  const gh = noGh();
  for (const expectedContent of [undefined, null, 5, {}]) {
    assert.throws(() => writeStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, {
      content: NEW, lease: BLOB, via: 'contents-api', expectedContent, message: MSG,
    }), TypeError, String(expectedContent));
  }
  assert.equal(gh.calls.length, 0);
});

test('writeStateFile: a contents-API 409 whose re-read is unchanged retries the PUT with the fresh blob sha', () => {
  const fresh = 'c'.repeat(40);
  let puts = 0;
  const gh = fakeGh({
    [PUT]: () => { puts += 1; return puts === 1 ? rejected(409) : ok(''); },
    [CONTENTS_PATH]: contentsAnswer(OLD, fresh),
  });
  const sleeps = [];
  const r = writeStateFile({ ghApi: gh.ghApi, sleep: (ms) => sleeps.push(ms) }, 'o/r', FILE, {
    content: NEW, lease: BLOB, via: 'contents-api', expectedContent: OLD, message: MSG,
  });
  assert.deepEqual(r, { ok: true, via: 'contents-api' });
  assert.equal(sleeps.length, 1);
  const sent = gh.calls.filter((args) => args[0] === '--method' && args[1] === 'PUT');
  assert.deepEqual(sent, [putArgs(NEW, BLOB), putArgs(NEW, fresh)]);
});

test('writeStateFile: a contents-API rejection whose re-read shows other content is a conflict with one PUT and no retry', () => {
  // The PUT would succeed on a second try (with the competitor's blob sha as the lease), so a
  // retry here would silently overwrite the competitor: the lost update the lease prevents.
  for (const status of [409, 422]) {
    let puts = 0;
    const gh = fakeGh({
      [PUT]: () => { puts += 1; return puts === 1 ? rejected(status) : ok(''); },
      [CONTENTS_PATH]: contentsAnswer(OTHER, 'c'.repeat(40)),
    });
    const sleeps = [];
    const r = writeStateFile({ ghApi: gh.ghApi, sleep: (ms) => sleeps.push(ms) }, 'o/r', FILE, {
      content: NEW, lease: BLOB, via: 'contents-api', expectedContent: OLD, message: MSG,
    });
    assert.deepEqual(r, { ok: false, conflict: true }, String(status));
    assert.equal(puts, 1, `${status}: exactly one PUT`);
    assert.equal(sleeps.length, 0, `${status}: no backoff`);
  }
});

test('writeStateFile: a contents-API rejection that stays unchanged is a conflict after MAX_CAS_ATTEMPTS PUTs', () => {
  const gh = fakeGh({ [PUT]: rejected(409), [CONTENTS_PATH]: contentsAnswer(OLD, 'c'.repeat(40)) });
  const sleeps = [];
  const r = writeStateFile({ ghApi: gh.ghApi, sleep: (ms) => sleeps.push(ms) }, 'o/r', FILE, {
    content: NEW, lease: BLOB, via: 'contents-api', expectedContent: OLD, message: MSG,
  });
  assert.deepEqual(r, { ok: false, conflict: true });
  assert.equal(gh.calls.filter((args) => args[0] === '--method' && args[1] === 'PUT').length, MAX_CAS_ATTEMPTS);
  assert.equal(sleeps.length, MAX_CAS_ATTEMPTS - 1);
});

test('writeStateFile: the scratch index is removed after a successful write and after a failed one', () => {
  const prefix = `release-state-index-${process.pid}-`;
  const leftovers = () => fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith(prefix));
  assert.deepEqual(leftovers(), []);
  const fx = makeLine();
  commitRawState(fx, fx.cloneB, FILE, OLD);
  const run = recordingRunner(fx.cloneA);
  const read = readStateFile({ ghApi: noGh().ghApi, gitRunner: run }, 'o/r', FILE);
  const written = writeStateFile({ ghApi: noGh().ghApi, gitRunner: run }, 'o/r', FILE, {
    content: NEW, lease: read.lease, via: 'git', expectedContent: read.content, message: MSG,
  });
  assert.equal(written.ok, true);
  assert.deepEqual(leftovers(), [], 'removed after a success');

  const seen = [];
  const failing = (args, opts) => {
    if (args[0] === 'push') {
      seen.push(leftovers().length);
      throw transportDown();
    }
    return run(args, opts);
  };
  const read2 = readStateFile({ ghApi: noGh().ghApi, gitRunner: failing }, 'o/r', FILE);
  const gh = fakeGh({ [CONTENTS_PATH]: contentsAnswer(OTHER, 'f'.repeat(40)) });
  const failed = writeStateFile({ ghApi: gh.ghApi, gitRunner: failing }, 'o/r', FILE, {
    content: OLD, lease: read2.lease, via: 'git', expectedContent: read2.content, message: MSG,
  });
  assert.deepEqual(failed, { ok: false, conflict: true });
  assert.deepEqual(seen, [1], 'the index existed when the push failed');
  assert.deepEqual(leftovers(), [], 'removed after a failure');
});

// Drives its own pushes: the branch bootstrap's create-only push, a create's and an update's
// leased pushes, and a bootstrap that loses to an existing branch.
test('store: no push ever names main', () => {
  const fx = makeLine();
  const calls = [];
  const gitRunner = recordingRunner(fx.cloneA, calls);
  const deps = { ghApi: noGh().ghApi, gitRunner, sleep: () => {} };
  assert.deepEqual(createStateFile(deps, 'o/r', FILE, { content: OLD, message: MSG }), { ok: true, created: true, via: 'git' });
  const read = readStateFile(deps, 'o/r', FILE);
  assert.equal(read.state, 'present');
  assert.deepEqual(writeStateFile(deps, 'o/r', FILE, {
    content: NEW, lease: read.lease, via: read.via, expectedContent: read.content, message: MSG,
  }), { ok: true, via: 'git', commitSha: setupGit(['rev-parse', 'refs/heads/release-state'], fx.originDir) });
  assert.deepEqual(ensureReleaseStateBranch(deps, 'o/r'), { ok: true, created: false, via: 'git' });

  const pushes = calls.filter((args) => args[0] === 'push');
  const leases = pushes.map((args) => args.find((a) => a.startsWith('--force-with-lease=')));
  assert.equal(leases.filter((l) => l === '--force-with-lease=refs/heads/release-state:').length, 2, 'two create-only bootstrap pushes');
  assert.equal(leases.filter((l) => /^--force-with-lease=refs\/heads\/release-state:[0-9a-f]{40}$/.test(l)).length, 2, 'two leased state pushes');
  for (const args of pushes) {
    const refspecs = args.filter((a) => a.includes(':refs/heads/') && !a.startsWith('--'));
    assert.equal(refspecs.length, 1, args.join(' '));
    assert.ok(refspecs[0].endsWith(':refs/heads/release-state'), args.join(' '));
    assert.ok(!args.includes('main'), args.join(' '));
    assert.ok(args.includes('--no-verify'), `a state push passes --no-verify: ${args.join(' ')}`);
    assert.ok(args.some((a) => a.startsWith('--force-with-lease=refs/heads/release-state:')), args.join(' '));
  }
});

// Drives its own PUTs: a create (no sha), a contents-API update, an update whose git lease
// takes the fresh-read path, a create on a missing branch, and the re-PUTs of an unchanged
// rejection.
test('store: every PUT carries branch=release-state', () => {
  const gh = fakeGh({
    [BRANCH_PATH]: ok('release-state'),
    [CONTENTS_PATH]: contentsAnswer(OLD),
    [PUT]: ok(''),
  });
  const update = {
    content: NEW, expectedContent: OLD, message: MSG,
  };
  assert.equal(createStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, { content: NEW, message: MSG }).ok, true);
  assert.equal(writeStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, { ...update, lease: BLOB, via: 'contents-api' }).ok, true);
  assert.equal(writeStateFile({ ghApi: gh.ghApi }, 'o/r', FILE, { ...update, lease: 'a'.repeat(40), via: 'git' }).ok, true);
  const branchless = fakeGh({
    [PUT]: ok(''),
    [BRANCH_PATH]: notFound(),
    'repos/o/r': ok('main\n'),
    'repos/o/r/git/ref/heads/main': ok('e'.repeat(40)),
    'POST repos/o/r/git/refs': ok(''),
  });
  assert.equal(createStateFile({ ghApi: branchless.ghApi }, 'o/r', FILE, { content: NEW, message: MSG }).ok, true);
  const unchanged = fakeGh({ [PUT]: rejected(409), [CONTENTS_PATH]: contentsAnswer(OLD) });
  assert.deepEqual(writeStateFile({ ghApi: unchanged.ghApi, sleep: () => {} }, 'o/r', FILE, { ...update, lease: BLOB, via: 'contents-api' }), { ok: false, conflict: true });

  const puts = [...gh.calls, ...branchless.calls, ...unchanged.calls].filter((args) => args[0] === '--method' && args[1] === 'PUT');
  assert.equal(puts.length, 4 + MAX_CAS_ATTEMPTS, 'every PUT driven above was recorded');
  assert.ok(puts.some((args) => !args.some((a) => a.startsWith('sha='))) && puts.some((args) => args.includes(`sha=${BLOB}`)), 'both a create and a leased PUT');
  for (const args of puts) {
    assert.equal(args.filter((a) => a === 'branch=release-state').length, 1, args.join(' '));
  }
});
