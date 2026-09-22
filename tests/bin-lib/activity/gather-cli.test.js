'use strict';
// tests/bin-lib/activity/gather-cli.test.js — #2757: activity-gather.js's exit-code contract
// via run(argv, deps), with every side effect injected.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../../plugin/bin/activity-gather');

const NOW = new Date('2026-09-22T10:00:00Z');

function deps(overrides = {}) {
  const out = { stdout: [], stderr: [], written: {} };
  const d = {
    runner: (args) => {
      if (args[0] === 'repo' && args[1] === 'view') return args[2] + '\n';
      if (args[0] === 'api' && args[1] === 'user') return 'octocat\n';
      if (args[0] === 'api') return '[[]]';
      if (args[0] === 'pr' && args[1] === 'list') return '[]';
      if (args[0] === 'issue' && args[1] === 'list') return '[]';
      if (args[0] === 'search' && args[1] === 'prs') return '[]';
      throw new Error('unexpected ' + args.join(' '));
    },
    ghAvailable: () => true,
    ghAuthOk: () => true,
    remoteUrl: () => 'https://github.com/acme/widgets.git\n',
    writeFile: (p, text) => { out.written[p] = text; },
    stdout: (s) => out.stdout.push(s),
    stderr: (s) => out.stderr.push(s),
    now: NOW,
    ...overrides,
  };
  return { d, out };
}

test('--help exits 0 before any probe', () => {
  const { d, out } = deps({ ghAvailable: () => { throw new Error('must not probe'); } });
  assert.equal(run(['--help'], d), 0);
  assert.match(out.stdout.join(''), /usage: activity-gather\.js/);
});

test('happy path: resolves actor and repo, writes facts.json, exits 0', () => {
  const { d, out } = deps();
  assert.equal(run(['--period', '7d', '--out', 'facts.json'], d), 0);
  const facts = JSON.parse(out.written['facts.json']);
  assert.equal(facts.actor, 'octocat');
  assert.deepEqual(facts.repos, ['acme/widgets']);
  assert.deepEqual(facts.period, { from: '2026-09-15', to: '2026-09-22', preset: '7d' });
  assert.deepEqual(facts.failures, []);
});

test('exit 1: missing --out, missing --period, unknown flag, bad period, host-qualified --repo', () => {
  for (const argv of [['--period', '7d'], ['--out', 'f.json'], ['--period', '7d', '--out', 'f.json', '--bogus'],
    ['--period', 'yesterday', '--out', 'f.json'], ['--period', '7d', '--out', 'f.json', '--repo', 'ghe.example.com/acme/widgets']]) {
    const { d, out } = deps();
    assert.equal(run(argv, d), 1, argv.join(' '));
    assert.ok(out.stderr.join('').length > 0);
  }
  const { d, out } = deps();
  run(['--period', 'yesterday', '--out', 'f.json'], d);
  assert.match(out.stderr.join(''), /1d\|7d\|14d\|month\|quarter\|<from>\.\.<to>/);
});

test('exit 1: a colon-host --repo entry and a leading-hyphen --repo entry are both rejected', () => {
  for (const repo of ['ghe.example.com:acme/widgets', '-evil/x']) {
    const { d, out } = deps();
    assert.equal(run(['--period', '7d', '--out', 'f.json', '--repo', repo], d), 1, repo);
    assert.match(out.stderr.join(''), /expected owner\/name/);
  }
});

test('exit 1: a --repo list with a blank entry or a ./.. name is rejected — never a silent drop or an uncaught throw', () => {
  for (const repo of [',', 'acme/a,,acme/b', ' , ', 'acme/..', 'acme/.']) {
    const { d, out } = deps();
    assert.equal(run(['--period', '7d', '--out', 'f.json', '--repo', repo, '--actor', 'octocat'], d), 1, repo);
    assert.match(out.stderr.join(''), /expected owner\/name/);
  }
});

test('exit 1: a --actor value that is not GitHub-login-shaped is rejected', () => {
  const { d, out } = deps();
  assert.equal(run(['--period', '7d', '--out', 'f.json', '--actor', 'a b'], d), 1);
  assert.match(out.stderr.join(''), /must be a GitHub login/);
});

test('exit 2: gh absent relays the probe message; gh auth failure relays stderr verbatim', () => {
  const a = deps({ ghAvailable: () => false });
  assert.equal(run(['--period', '7d', '--out', 'f.json'], a.d), 2);
  assert.match(a.out.stderr.join(''), /gh is not installed/);
  const b = deps({ ghAuthOk: () => { const e = new Error('auth failed'); e.stderr = 'You are not logged into any GitHub hosts.'; throw e; } });
  assert.equal(run(['--period', '7d', '--out', 'f.json'], b.d), 2);
  assert.match(b.out.stderr.join(''), /You are not logged into any GitHub hosts\./);
});

test('exit 2: no --repo and origin unreadable or unparsable', () => {
  const a = deps({ remoteUrl: () => { throw new Error('fatal: not a git repository'); } });
  assert.equal(run(['--period', '7d', '--out', 'f.json'], a.d), 2);
  const b = deps({ remoteUrl: () => 'garbage\n' });
  assert.equal(run(['--period', '7d', '--out', 'f.json'], b.d), 2);
});

test('exit 3 only when every query failed; a partial gather exits 0 with failures[] populated', () => {
  const allFail = deps({ runner: (args) => {
    if (args[0] === 'repo' && args[1] === 'view') return args[2] + '\n';
    if (args[0] === 'api' && args[1] === 'user') return 'octocat';
    throw new Error('boom');
  } });
  assert.equal(run(['--period', '7d', '--out', 'f.json'], allFail.d), 3);
  const partial = deps({ runner: (args) => {
    if (args[0] === 'repo' && args[1] === 'view') return args[2] + '\n';
    if (args[0] === 'api' && args[1] === 'user') return 'octocat';
    if (args[0] === 'pr' && args.includes('merged')) throw new Error('HTTP 503');
    if (args[0] === 'api') return '[[]]';
    if (args[0] === 'pr' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'list') return '[]';
    if (args[0] === 'search' && args[1] === 'prs') return '[]';
    throw new Error('unexpected ' + args.join(' '));
  } });
  assert.equal(run(['--period', '7d', '--out', 'f.json'], partial.d), 0);
  const facts = JSON.parse(partial.out.written['f.json']);
  assert.deepEqual(facts.failures.map((f) => f.query), ['merged_prs']);
});

test('--actor and --repo overrides skip the user probe and origin read', () => {
  const { d, out } = deps({ remoteUrl: () => { throw new Error('must not read origin'); }, runner: (args) => {
    if (args[0] === 'repo' && args[1] === 'view') return args[2] + '\n';
    if (args[0] === 'api' && args[1] === 'user') throw new Error('must not probe user');
    if (args[0] === 'api') return '[[]]';
    if (args[0] === 'pr' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'list') return '[]';
    if (args[0] === 'search' && args[1] === 'prs') return '[]';
    throw new Error('unexpected ' + args.join(' '));
  } });
  assert.equal(run(['--period', '2026-09-01..2026-09-14', '--out', 'f.json', '--actor', 'hubot', '--repo', 'acme/a,acme/b'], d), 0);
  const facts = JSON.parse(out.written['f.json']);
  assert.equal(facts.actor, 'hubot');
  assert.deepEqual(facts.repos, ['acme/a', 'acme/b']);
});

test('exit-code precedence: a bad period is rejected before any gh probe', () => {
  const { d, out } = deps({ ghAvailable: () => false });
  assert.equal(run(['--period', 'yesterday', '--out', 'f.json'], d), 1);
  assert.match(out.stderr.join(''), /1d\|7d\|14d\|month\|quarter\|<from>\.\.<to>/);
});

test('exit 2: a non-github.com origin is rejected rather than silently mis-slugged', () => {
  const { d, out } = deps({ remoteUrl: () => 'git@ghe.example.com:acme/widgets.git\n' });
  assert.equal(run(['--period', '7d', '--out', 'f.json'], d), 2);
  assert.match(out.stderr.join(''), /ghe\.example\.com/);
});

test('exit 1: --repo "" is a usage error, not a silent origin fallback', () => {
  const { d, out } = deps({ remoteUrl: () => { throw new Error('must not read origin'); } });
  assert.equal(run(['--period', '7d', '--out', 'f.json', '--repo', ''], d), 1);
  assert.ok(out.stderr.join('').length > 0);
});

test('per-repo total failure: all 6 queries failing on one of two repos is still a partial (exit 0); failing on both is exit 3', () => {
  const partial = deps({ runner: (args) => {
    if (args[0] === 'repo' && args[1] === 'view') return args[2] + '\n';
    if (args[0] === 'api' && args[1] === 'user') return 'octocat\n';
    if (args.some((a) => a.includes('acme/a'))) throw new Error('boom');
    if (args[0] === 'api') return '[[]]';
    if (args[0] === 'pr' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'list') return '[]';
    if (args[0] === 'search' && args[1] === 'prs') return '[]';
    throw new Error('unexpected ' + args.join(' '));
  } });
  assert.equal(run(['--period', '7d', '--out', 'f.json', '--repo', 'acme/a,acme/b'], partial.d), 0);
  const facts = JSON.parse(partial.out.written['f.json']);
  assert.equal(facts.failures.length, 6);

  const total = deps({ runner: (args) => {
    if (args[0] === 'repo' && args[1] === 'view') return args[2] + '\n';
    if (args[0] === 'api' && args[1] === 'user') return 'octocat\n';
    throw new Error('boom');
  } });
  assert.equal(run(['--period', '7d', '--out', 'f.json', '--repo', 'acme/a,acme/b'], total.d), 3);
});

test('canonicalizes a renamed repo: search-backed queries run under the redirect target', () => {
  const calls = [];
  const { d, out } = deps({ runner: (args) => {
    calls.push(args);
    if (args[0] === 'repo' && args[1] === 'view') return args[2] === 'acme/old' ? 'acme/new\n' : args[2] + '\n';
    if (args[0] === 'api' && args[1] === 'user') return 'octocat\n';
    if (args[0] === 'api') return '[[]]';
    if (args[0] === 'pr' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'list') return '[]';
    if (args[0] === 'search' && args[1] === 'prs') return '[]';
    throw new Error('unexpected ' + args.join(' '));
  } });
  assert.equal(run(['--period', '7d', '--out', 'f.json', '--repo', 'acme/old'], d), 0);
  const facts = JSON.parse(out.written['f.json']);
  assert.deepEqual(facts.repos, ['acme/new']);
  const nonViewCalls = calls.filter((a) => !(a[0] === 'repo' && a[1] === 'view'));
  for (const a of nonViewCalls) {
    for (const el of a) assert.ok(!String(el).includes('acme/old'), `argv element "${el}" must not carry acme/old`);
  }
  assert.match(out.stderr.join(''), /acme\/old redirects to acme\/new/);
});

test('canonicalization failure: gh repo view throwing exits 2', () => {
  const { d, out } = deps({ runner: (args) => {
    if (args[0] === 'repo' && args[1] === 'view') throw new Error('HTTP 404: Not Found');
    if (args[0] === 'api' && args[1] === 'user') return 'octocat\n';
    if (args[0] === 'api') return '[[]]';
    return '[]';
  } });
  assert.equal(run(['--period', '7d', '--out', 'f.json'], d), 2);
  assert.match(out.stderr.join(''), /not found or not accessible/);
});

test('--repo acme/old,acme/new both canonicalizing to acme/new de-duplicates to one repo', () => {
  const calls = [];
  const { d, out } = deps({ runner: (args) => {
    calls.push(args);
    if (args[0] === 'repo' && args[1] === 'view') return 'acme/new\n';
    if (args[0] === 'api') return '[[]]';
    if (args[0] === 'pr' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'list') return '[]';
    if (args[0] === 'search' && args[1] === 'prs') return '[]';
    throw new Error('unexpected ' + args.join(' '));
  } });
  assert.equal(run(['--period', '7d', '--out', 'f.json', '--repo', 'acme/old,acme/new', '--actor', 'hubot'], d), 0);
  const facts = JSON.parse(out.written['f.json']);
  assert.deepEqual(facts.repos, ['acme/new']);
  const nonViewCalls = calls.filter((a) => !(a[0] === 'repo' && a[1] === 'view'));
  assert.equal(nonViewCalls.length, 6);
});
