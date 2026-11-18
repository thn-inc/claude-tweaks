'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  RELEASE_STATE_BRANCH, STATE_FILE_RE, MAX_CAS_ATTEMPTS, readStateFile, classifyStateContent, ensureReleaseStateBranch,
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

// Every git argv any test here ran through a recording runner.
const allGitCalls = [];
function recordingRunner(cwd, calls = []) {
  const run = realRunner(cwd);
  return (args, opts) => {
    calls.push(args);
    allGitCalls.push(args);
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
  assert.equal(fetch.length, 4);
  assert.deepEqual(fetch.slice(0, 3), ['fetch', '-q', 'origin']);
  assert.match(fetch[3], /^refs\/heads\/release-state:refs\/release-state-cas\/\d+-\d+-[a-z0-9]*$/);
  const scratch = fetch[3].split(':')[1];
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
  const push = calls.find((args) => args[0] === 'push');
  assert.deepEqual(push, ['push', '--no-verify', 'origin', `${fx.P5}:refs/heads/release-state`, '--force-with-lease=refs/heads/release-state:']);
  assert.equal(gh.calls.length, 0);
  assert.equal(setupGit(['for-each-ref', 'refs/release-state-cas'], fx.cloneA), '', 'the scratch ref is gone');
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

// Last in the file, so every recording runner above has run.
test('store: no push ever names main', () => {
  const pushes = allGitCalls.filter((args) => args[0] === 'push');
  assert.ok(pushes.length >= 3, `expected the bootstrap tests' pushes to be recorded, saw ${pushes.length}`);
  for (const args of pushes) {
    const refspecs = args.filter((a) => a.includes(':refs/heads/') && !a.startsWith('--'));
    assert.equal(refspecs.length, 1, args.join(' '));
    assert.ok(refspecs[0].endsWith(':refs/heads/release-state'), args.join(' '));
    assert.ok(!args.includes('main'), args.join(' '));
  }
});
