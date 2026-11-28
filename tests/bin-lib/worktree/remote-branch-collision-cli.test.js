'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');
const { originWithTwoClones } = require('../../helpers/git-fixtures');

// #5589: the CLI over the module's checkAdoptedBranch, called by
// plugin/skills/build/adopted-branch-collision-check.md. The module's own
// behaviour is pinned in remote-branch-collision.test.js; these cases pin what the
// CLI adds: argv parsing, empty-value handling, --repo host pinning, the one-line
// output, and the 0/1/2 exit codes.

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'remote-branch-collision.js');
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const exitWith = (status) => Object.assign(new Error(`exit ${status}`), { status });

// One fake git per case. `head` is how `merge-base --is-ancestor <sha> HEAD`
// answers: 'ancestor' (exit 0), 'not' (exit 1), 'unknown' (exit 128).
const checkGit = ({ ls, head, fetchFails = false, priorAncestor = true }) => {
  const git = (args) => {
    git.calls += 1;
    if (args[0] === 'ls-remote') {
      if (ls === 'throw') throw exitWith(128);
      return ls === 'absent' ? '' : `${SHA_A}\trefs/heads/b\n`;
    }
    if (args[0] === 'fetch') {
      if (fetchFails) throw exitWith(128);
      return '';
    }
    if (args[0] === 'merge-base' && args[3] === 'HEAD') {
      if (head === 'ancestor') return '';
      throw exitWith(head === 'not' ? 1 : 128);
    }
    if (args[0] === 'merge-base' && args[2] === SHA_B && args[3] === SHA_A) {
      if (priorAncestor) return '';
      throw exitWith(1);
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  git.calls = 0;
  return git;
};
const countingGh = (prs) => {
  const gh = () => { gh.calls += 1; return JSON.stringify(prs); };
  gh.calls = 0;
  return gh;
};
const throwingGh = () => {
  const gh = () => { gh.calls += 1; throw new Error('gh down'); };
  gh.calls = 0;
  return gh;
};
const countingPin = () => {
  const pin = (spec) => { pin.specs.push(spec); };
  pin.specs = [];
  return pin;
};
const ref = (number, slug = 'o/r') => ({ number, repository: { name: slug.split('/')[1], owner: { login: slug.split('/')[0] } } });
const closedPr = (over) => ({
  number: 9,
  url: 'https://example.test/pr/9',
  state: 'CLOSED',
  isCrossRepository: false,
  headRefOid: SHA_B,
  closingIssuesReferences: [ref(42)],
  body: '<!-- claude-tweaks-run: 2026-10-21T000000-record-42 -->\nclaude-tweaks-run: 2026-10-21T000000-record-42\n\nFixes #42\n',
  ...over,
});
const priorPr = (n) => closedPr({ closingIssuesReferences: [ref(n)], body: closedPr().body.replace('#42', `#${n}`) });

const call = (argv, deps = {}) => runCliSync(CLI, argv, {
  deps: { git: checkGit({ ls: 'absent' }), gh: countingGh([]), pinGhHost: countingPin(), ...deps },
});
const parsed = (res) => {
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  assert.equal(res.stdout.endsWith('\n'), true);
  assert.equal(res.stdout.split('\n').length, 2, 'exactly one line');
  return JSON.parse(res.stdout);
};

const FOREIGN_CARD = [
  '## Build: Adopted branch collides with an unrelated branch on origin',
  '',
  "`b` already exists on `origin` at `aaaaaaaaa`, and that commit is not in this worktree's history — no PR found for it. Pushing this branch would be rejected non-fast-forward.",
  '',
  "Options: (1) rename this worktree's local branch (`git branch -m b-{suffix}`) and re-run, (2) delete the stale remote branch (`git push origin --delete b`) and re-run, (3) stop and resume the existing remote branch/PR instead.",
].join('\n');
const UNKNOWN_CARD = (reason) => [
  '## Build: Adopted branch collides with an unrelated branch on origin',
  '',
  `\`b\` already exists on \`origin\` at \`aaaaaaaaa\`, and its relation to this worktree's history could not be determined (\`${reason}\`) — no PR found for it. Pushing this branch may be rejected non-fast-forward.`,
  '',
  "Options: (1) rename this worktree's local branch (`git branch -m b-{suffix}`) and re-run, (2) delete the stale remote branch (`git push origin --delete b`) and re-run, (3) stop and resume the existing remote branch/PR instead.",
].join('\n');

test('AC1.1: the CLI prints one line that parses to checkAdoptedBranch\'s object', () => {
  const cases = [
    {
      argv: ['--branch', 'b'],
      deps: { git: checkGit({ ls: 'absent' }) },
      want: { state: 'absent', reason: null, remoteSha: null },
    },
    {
      argv: ['--branch', 'b', '--repo', 'o/r'],
      deps: { git: checkGit({ ls: 'present', head: 'ancestor' }) },
      want: { state: 'mine', reason: null, remoteSha: SHA_A },
    },
    {
      argv: ['--branch', 'b', '--repo', 'o/r'],
      deps: { git: checkGit({ ls: 'present', head: 'not' }) },
      want: { state: 'foreign', reason: null, remoteSha: SHA_A, card: FOREIGN_CARD },
    },
    {
      argv: ['--branch', 'b', '--repo', 'o/r', '--records', '1'],
      deps: { git: checkGit({ ls: 'present', head: 'not' }), gh: countingGh([priorPr(1)]) },
      want: { state: 'prior-attempt', reason: null, remoteSha: SHA_A, pr: { number: 9, url: 'https://example.test/pr/9' } },
    },
    {
      argv: ['--branch', 'b', '--repo', 'o/r', '--records', '1'],
      deps: { git: checkGit({ ls: 'throw' }) },
      want: { state: 'unreachable', reason: 'ls-remote-failed', remoteSha: null },
    },
    {
      argv: ['--branch', 'b', '--repo', 'o/r'],
      deps: { git: checkGit({ ls: 'present', head: 'unknown', fetchFails: true }) },
      want: { state: 'unreachable', reason: 'fetch-failed', remoteSha: SHA_A, card: UNKNOWN_CARD('fetch-failed') },
    },
  ];
  for (const { argv, deps, want } of cases) {
    const out = parsed(call(argv, deps));
    assert.deepEqual(out, want);
    assert.deepEqual(Object.keys(out), Object.keys(want));
  }
});

test('AC2.1: --records "3887,3890" reaches the prior-attempt lookup as [3887, 3890]', () => {
  // Each item must reach the lookup: a parse keeping only the last (or only the first) would fail one run.
  for (const closes of [3890, 3887]) {
    const out = parsed(call(['--branch', 'b', '--repo', 'o/r', '--records', '3887,3890'], {
      git: checkGit({ ls: 'present', head: 'not' }),
      gh: countingGh([priorPr(closes)]),
    }));
    assert.equal(out.state, 'prior-attempt', `a closed PR closing #${closes} must match`);
  }
});

test('AC2.2: an absent or empty --records reaches it as []', () => {
  // The closed PR closes #0, so the old script's `''.split(',').map(Number)` -> [0] would match it
  // and answer prior-attempt; only an empty list leaves the branch foreign.
  for (const records of [['--records', ''], []]) {
    const out = parsed(call(['--branch', 'b', '--repo', 'o/r', ...records], {
      git: checkGit({ ls: 'present', head: 'not' }),
      gh: countingGh([priorPr(0)]),
    }));
    assert.equal(out.state, 'foreign');
  }
});

test('AC2.3: an empty --repo skips the PR lookup as an absent one does', () => {
  for (const repo of [['--repo', ''], []]) {
    const gh = countingGh([]);
    const pin = countingPin();
    const out = parsed(call(['--branch', 'b', ...repo], { git: checkGit({ ls: 'present', head: 'not' }), gh, pinGhHost: pin }));
    assert.equal(out.state, 'foreign');
    assert.equal(gh.calls, 0);
    assert.equal(pin.specs.length, 0);
    assert.match(out.card, /PR status unknown \(lookup failed\)/);
  }
});

test('AC2.3: --repo pins the parsed host once; an unparseable --repo pins nothing but still reaches the module', () => {
  const run = (repo) => {
    const pin = countingPin();
    const seen = [];
    const out = parsed(call(['--branch', 'b', '--repo', repo], {
      pinGhHost: pin,
      checkAdoptedBranch: (opts) => { seen.push(opts.repo); return { state: 'absent', reason: null, remoteSha: null }; },
    }));
    assert.equal(out.state, 'absent');
    assert.deepEqual(seen, [repo]);
    return pin.specs;
  };
  assert.deepEqual(run('o/r'), [{ host: 'github.com', owner: 'o', repo: 'r' }]);
  assert.deepEqual(run('ghe.example.com/o/r'), [{ host: 'ghe.example.com', owner: 'o', repo: 'r' }]);
  assert.deepEqual(run('nope'), []);
});

test('AC2.4: a --records item that is not a positive integer exits 2', () => {
  for (const records of ['38x', '0', '3887,', ' 3887', '-1']) {
    const res = call(['--branch', 'b', '--repo', 'o/r', '--records', records]);
    assert.equal(res.code, 2, records);
    assert.equal(res.stdout, '', records);
    assert.match(res.stderr, /^remote-branch-collision\.js:/, records);
    assert.match(res.stderr, /usage:/, records);
  }
});

test('AC3.1: a malformed call exits 2 with a usage line and empty stdout', () => {
  const bad = [
    [],
    ['--branch'],
    ['--branch', '--repo', 'o/r'],
    ['--branch', 'a', '--branch', 'b'],
    ['--branch', 'a', 'extra'],
    ['--branch', 'a', '--nope', 'x'],
    ['--branch', 'a', 'constructor', 'x'],
    ['extra'],
  ];
  for (const argv of bad) {
    const git = checkGit({ ls: 'absent' });
    const res = call(argv, { git });
    assert.equal(res.code, 2, JSON.stringify(argv));
    assert.equal(res.stdout, '', JSON.stringify(argv));
    assert.match(res.stderr, /^remote-branch-collision\.js:/, JSON.stringify(argv));
    assert.match(res.stderr, /usage:/, JSON.stringify(argv));
    assert.equal(git.calls, 0, JSON.stringify(argv));
  }
});

test('AC3.1: a flag followed by another flag is "needs a value", not an unknown argument', () => {
  // Without the guard, `--repo` would be taken as the branch and `o/r` would fail as an unknown
  // argument: still exit 2, so only the message tells the two apart.
  const res = call(['--branch', '--repo', 'o/r']);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /--branch needs a value/);
});

test('AC3.1: an empty --branch is passed to the module', () => {
  const git = checkGit({ ls: 'absent' });
  const out = parsed(call(['--branch', ''], { git }));
  assert.deepEqual(out, { state: 'unreachable', reason: 'invalid-branch-name', remoteSha: null });
  assert.equal(git.calls, 0);
});

test('AC3.2: a module that throws exits 1 with empty stdout', () => {
  const res = call(['--branch', 'b'], { checkAdoptedBranch: () => { throw new Error('boom'); } });
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, 'claude-tweaks: remote-branch-collision: boom\n');
});

test('a gh failure on the PR lookup still prints a card', () => {
  const gh = throwingGh();
  const out = parsed(call(['--branch', 'b', '--repo', 'o/r'], { git: checkGit({ ls: 'present', head: 'not' }), gh }));
  assert.equal(gh.calls > 0, true);
  assert.equal(out.state, 'foreign');
  assert.match(out.card, /PR status unknown \(lookup failed\)/);
});

test('--help prints usage, exits 0 and never reads cwd', () => {
  let cwdCalls = 0;
  for (const flag of ['--help', '-h']) {
    const res = runCliSync(CLI, [flag], {
      deps: { git: checkGit({ ls: 'absent' }), gh: countingGh([]), pinGhHost: countingPin(), cwd: () => { cwdCalls += 1; return process.cwd(); } },
    });
    assert.equal(res.code, 0);
    assert.match(res.stdout, /^usage: remote-branch-collision\.js/);
    assert.equal(res.stderr, '');
  }
  assert.equal(cwdCalls, 0);
});

test('spawnCli smoke: the script entry prints absent for a branch not on a real origin', (t) => {
  const r = originWithTwoClones('remote-branch-collision-cli-');
  t.after(() => fs.rmSync(r.root, { recursive: true, force: true }));
  const res = spawnCli(CLI, ['--branch', 'worktree-record-1'], { cwd: r.work, env: { ...r.env } });
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stdout, '{"state":"absent","reason":null,"remoteSha":null}\n');
});

test('spawnCli smoke: a malformed call exits 2', () => {
  const res = spawnCli(CLI, [], { env: { ...process.env } });
  assert.equal(res.code, 2);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /usage:/);
});
