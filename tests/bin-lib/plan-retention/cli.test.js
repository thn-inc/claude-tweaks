'use strict';
// plan-retention.js (#4594): in-process run(argv, deps) tests for the argument
// contract and the deps seam, fixture-repo tests for the real git first-add probe
// (in-process, cwd and env injected), and two spawned smokes for the script entry.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { gitRepo, fixtureGit } = require('../../helpers/git-fixtures');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');
const { run } = require('../../../plugin/bin/plan-retention');
const {
  DECLINE_SOURCE, DECLINE_DESCRIPTION, archiveDeclineFingerprint, firstAddedDate,
} = require('../../../plugin/bin/lib/plan-retention/probe');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'plan-retention.js');
const DECLINED_LEARNING = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'declined-learning.js');
const PLANS_DIR = 'docs/superpowers/plans/';
const P = `${PLANS_DIR}a.md`;
const Q = `${PLANS_DIR}b.md`;

function planPaths(count) {
  return Array.from({ length: count }, (_, i) => `${PLANS_DIR}plan-${String(i).padStart(2, '0')}.md`);
}

function fakeDeps(overrides = {}) {
  const out = [];
  const err = [];
  const deps = {
    git: () => '2026-09-01',
    lookupDecline: () => null,
    today: () => '2026-10-31',
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...overrides,
  };
  return { deps, stdout: () => out.join(''), stderr: () => err.join('') };
}

function invoke(argv, overrides) {
  const { deps, stdout, stderr } = fakeDeps(overrides);
  const code = run(argv, deps);
  return { code, stdout: stdout(), stderr: stderr() };
}

test('malformed invocations exit 2 with usage on stderr and no stdout', () => {
  const cases = [
    [],
    ['--retention', 'sometimes'],
    ['--retention'],
    ['--retention', ''],
    ['--retention', '--cited'],
    ['--bogus', '--retention', 'ask'],
    ['--retention', 'ask', 'notes/x.md'],
    ['--retention', 'keep-forever', P, P],
    ['--retention', 'keep-forever', '--cited', Q, P],
    ['--retention', 'keep-forever', P, '--cited'],
    ['--retention', 'keep-forever', P, '--cited', ''],
    ['--retention', 'ask', '--cited', P, P],
    ['--retention', 'ask', '--retention', 'ask'],
    ['--retention', 'ask', '--retention', 'keep-forever'],
    ['--retention', 'ask', `${PLANS_DIR}../../../etc/passwd`],
    ['--retention', 'ask', `${PLANS_DIR}sub/../../x.md`],
    ['--retention', 'ask', PLANS_DIR],
    ['--retention', 'ask', `${PLANS_DIR}sub/`],
  ];
  for (const argv of cases) {
    const r = invoke(argv);
    assert.equal(r.code, 2, `argv ${JSON.stringify(argv)} exits 2`);
    assert.match(r.stderr, /usage: plan-retention\.js/, `argv ${JSON.stringify(argv)} prints usage`);
    assert.equal(r.stdout, '', `argv ${JSON.stringify(argv)} prints nothing on stdout`);
  }
});

test('a call without --retention exits 2 naming the required flag, not the unknown-value check', () => {
  for (const argv of [[], [P]]) {
    const r = invoke(argv);
    assert.equal(r.code, 2, `argv ${JSON.stringify(argv)} exits 2`);
    assert.match(r.stderr, /--retention is required/, `argv ${JSON.stringify(argv)} names the required flag`);
    assert.equal(r.stdout, '');
  }
});

test('--help prints usage and calls no deps', () => {
  const boom = () => { throw new Error('deps must not be called'); };
  const out = [];
  const code = run(['--help'], {
    git: boom, lookupDecline: boom, today: boom,
    stdout: (s) => out.push(s),
    stderr: boom,
  });
  assert.equal(code, 0);
  assert.match(out.join(''), /usage: plan-retention\.js/);
});

test('a git probe that fails or prints a non-date reads as uncommitted and keeps', () => {
  const probes = {
    null: () => null,
    throws: () => { throw new Error('git exploded'); },
    garbage: () => 'not a date',
  };
  for (const [name, git] of Object.entries(probes)) {
    const r = invoke(['--retention', 'keep-forever', P], { git });
    assert.equal(r.code, 0, name);
    const [row] = JSON.parse(r.stdout).plans;
    assert.equal(row.firstAdded, 'uncommitted', name);
    assert.equal(row.route, 'keep', name);
  }
});

test('a failed git run is named on stderr, a plan git has no add commit for is not', () => {
  for (const git of [() => null, () => { throw new Error('git exploded'); }]) {
    const r = invoke(['--retention', 'keep-forever', P, Q], { git });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /git failed for 2 of 2 plan\(s\); read as uncommitted and kept/);
    assert.equal(r.stdout.trim().split('\n').length, 1, 'stdout stays one JSON line');
  }
  for (const git of [() => '', () => 'not a date']) {
    const r = invoke(['--retention', 'keep-forever', P], { git });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, '', 'an empty or non-date answer is not a git failure');
  }
  const mixed = invoke(['--retention', 'keep-forever', P, Q], { git: (args) => (args.includes(P) ? null : '2026-09-01') });
  assert.match(mixed.stderr, /git failed for 1 of 2 plan\(s\)/);
});

test('firstAddedDate passes the plan literally after --literal-pathspecs', () => {
  const calls = [];
  const date = firstAddedDate(`${PLANS_DIR}*.md`, (args) => { calls.push(args); return '2026-09-01\n'; });
  assert.deepEqual(calls, [['--literal-pathspecs', 'log', '--diff-filter=A', '--format=%cs', '-1', '--', `${PLANS_DIR}*.md`]]);
  assert.equal(date, '2026-09-01');
});

test('firstAddedDate reads empty output as uncommitted', () => {
  assert.equal(firstAddedDate(P, () => ''), 'uncommitted');
});

test('the output line carries the documented keys in order', () => {
  const r = invoke(['--retention', 'keep-forever', P]);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout.trim().split('\n').length, 1, 'one JSON line');
  const parsed = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(parsed), ['retention', 'today', 'cutoffDays', 'threshold', 'citationCheck', 'citationCandidates', 'decline', 'plans']);
  assert.equal(parsed.cutoffDays, 7);
  assert.equal(parsed.threshold, 30);
  assert.equal(parsed.retention, 'keep-forever');
  assert.equal(parsed.today, '2026-10-31');
});

test('--cited reaches routePlans as the cited set', () => {
  const plans = planPaths(32);
  const cited = [plans[3], plans[17]];
  const r = invoke(['--retention', 'keep-forever', '--cited', cited[0], '--cited', cited[1], ...plans]);
  assert.equal(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.citationCheck, false);
  for (const row of parsed.plans) {
    if (cited.includes(row.plan)) {
      assert.equal(row.cited, true);
      assert.equal(row.route, 'keep');
    } else {
      assert.equal(row.cited, false);
      assert.equal(row.route, 'prune-archive');
    }
  }
  assert.equal(parsed.plans.filter((row) => row.route === 'prune-archive').length, 30);
});

test('the decline lookup receives the archive fingerprint and a live decline keeps every plan', () => {
  const plans = planPaths(30);
  const seen = [];
  const r = invoke(['--retention', 'keep-forever', ...plans], {
    lookupDecline: (fp) => { seen.push(fp); return { declinedAt: '2026-10-01T00:00:00.000Z' }; },
  });
  assert.equal(r.code, 0);
  assert.deepEqual(seen, [archiveDeclineFingerprint()]);
  const parsed = JSON.parse(r.stdout);
  assert.deepEqual(parsed.decline, { live: true, error: null });
  assert.ok(parsed.plans.every((row) => row.route === 'keep'));
});

test('a throwing decline lookup is reported and keeps every plan, still exit 0', () => {
  const plans = planPaths(30);
  const r = invoke(['--retention', 'keep-forever', ...plans], {
    lookupDecline: () => { throw new Error('store unreadable'); },
  });
  assert.equal(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.deepEqual(parsed.decline, { live: false, error: 'store unreadable' });
  assert.ok(parsed.plans.every((row) => row.route === 'keep'));
});

test('the decline fingerprint is the one declined-learning.js lookup computes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-retention-fp-'));
  try {
    const out = execFileSync(process.execPath, [DECLINED_LEARNING, 'lookup', '--source', DECLINE_SOURCE], {
      cwd: dir, encoding: 'utf8', input: JSON.stringify({ description: DECLINE_DESCRIPTION }),
    });
    assert.equal(JSON.parse(out).fingerprint, archiveDeclineFingerprint());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A fixture repo: `old` plans committed 30 days ago in one commit, `recent` plans
// in a second commit dated now, `untracked` plans left uncommitted.
// `modifyOld` edits the first old plan in the recent commit, so its latest-touching commit is new
// while its first-add commit is 30 days ago.
function planRepo({ old = 0, recent = 0, untracked = 0, modifyOld = false }) {
  const repo = gitRepo();
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  };
  const git = (args, extraEnv = {}) => fixtureGit(['-C', repo, ...args], { env: { ...env, ...extraEnv }, stdio: 'ignore' });
  const write = (prefix, count) => {
    fs.mkdirSync(path.join(repo, PLANS_DIR), { recursive: true });
    return Array.from({ length: count }, (_, i) => {
      const plan = `${PLANS_DIR}${prefix}-${String(i).padStart(2, '0')}.md`;
      fs.writeFileSync(path.join(repo, plan), `# ${plan}\n`);
      return plan;
    });
  };
  const oldPlans = write('old', old);
  if (old > 0) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    git(['add', '--', PLANS_DIR]);
    git(['commit', '-q', '-m', 'old plans'], { GIT_AUTHOR_DATE: thirtyDaysAgo, GIT_COMMITTER_DATE: thirtyDaysAgo });
  }
  const recentPlans = write('recent', recent);
  if (modifyOld) fs.appendFileSync(path.join(repo, oldPlans[0]), 'edited after the first add\n');
  if (recent > 0 || modifyOld) {
    git(['add', '--', PLANS_DIR]);
    git(['commit', '-q', '-m', 'recent plans']);
  }
  const untrackedPlans = write('untracked', untracked);
  return { repo, oldPlans, recentPlans, untrackedPlans };
}

// The CLI in-process with the fixture as its working directory; returns the parsed output line.
function cliJson(repo, args, env = { ...process.env }) {
  const r = runCliSync(CLI, args, { cwd: repo, env });
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('AC1.1: 30 past-cutoff plans and 1 within-cutoff plan under keep-forever', () => {
  const { repo, oldPlans, recentPlans } = planRepo({ old: 30, recent: 1 });
  try {
    // real process: proves the script entry, exit 0 and the JSON line on stdout
    const res = spawnCli(CLI, ['--retention', 'keep-forever', ...oldPlans, ...recentPlans], { cwd: repo });
    assert.equal(res.code, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.plans.filter((row) => row.route === 'prune-archive').length, 30);
    for (const plan of oldPlans) assert.equal(parsed.plans.find((row) => row.plan === plan).route, 'prune-archive');
    assert.equal(parsed.plans.find((row) => row.plan === recentPlans[0]).route, 'keep');
    assert.equal(parsed.citationCheck, true);
    assert.equal(parsed.citationCandidates.length, 30);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// The only test that runs realDeps.lookupDecline against a store on disk: record-decline (still a real
// process: declined-learning.js has no run until #5385) writes the entry into the fixture repo's own
// store (the main checkout's, resolved from the cwd), and the in-process CLI, given that cwd, must read it back.
test('a decline recorded in the real store keeps all 30 past-cutoff plans, and an empty store archives them', () => {
  const { repo, oldPlans } = planRepo({ old: 30 });
  try {
    const before = cliJson(repo, ['--retention', 'keep-forever', ...oldPlans]);
    assert.deepEqual(before.decline, { live: false, error: null });
    assert.equal(before.plans.filter((row) => row.route === 'prune-archive').length, 30);

    execFileSync(process.execPath, [DECLINED_LEARNING, 'record-decline', '--source', DECLINE_SOURCE], {
      cwd: repo, encoding: 'utf8', input: JSON.stringify({ description: DECLINE_DESCRIPTION, reason: 'noise' }),
    });
    const after = cliJson(repo, ['--retention', 'keep-forever', ...oldPlans]);
    assert.deepEqual(after.decline, { live: true, error: null });
    assert.ok(after.plans.every((row) => row.route === 'keep'));
    assert.equal(after.citationCheck, true, 'the citation check is still requested while a decline is live');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC2.1: 29 past-cutoff plans all keep and report citationCheck false', () => {
  const { repo, oldPlans } = planRepo({ old: 29 });
  try {
    const parsed = cliJson(repo, ['--retention', 'keep-forever', ...oldPlans]);
    assert.equal(parsed.plans.length, 29);
    assert.ok(parsed.plans.every((row) => row.pastCutoff === true && row.firstAdded !== 'uncommitted'));
    assert.ok(parsed.plans.every((row) => row.route === 'keep'));
    assert.equal(parsed.citationCheck, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a plan modified after it was added still reads its first-add date (--diff-filter=A)', () => {
  const { repo, oldPlans, recentPlans } = planRepo({ old: 30, recent: 1, modifyOld: true });
  try {
    const parsed = cliJson(repo, ['--retention', 'keep-forever', ...oldPlans, ...recentPlans]);
    const modified = parsed.plans.find((row) => row.plan === oldPlans[0]);
    assert.equal(modified.firstAdded, new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
    assert.equal(modified.pastCutoff, true);
    assert.equal(parsed.plans.filter((row) => row.route === 'prune-archive').length, 30);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC3.1: an uncommitted plan keeps under keep-forever and ask', () => {
  const { repo, recentPlans, untrackedPlans } = planRepo({ recent: 1, untracked: 1 });
  try {
    for (const retention of ['keep-forever', 'ask']) {
      const parsed = cliJson(repo, ['--retention', retention, ...recentPlans, ...untrackedPlans]);
      const untracked = parsed.plans.find((row) => row.plan === untrackedPlans[0]);
      assert.equal(untracked.firstAdded, 'uncommitted', retention);
      assert.equal(untracked.route, 'keep', retention);
      const committed = parsed.plans.find((row) => row.plan === recentPlans[0]);
      assert.equal(committed.route, retention === 'ask' ? 'prune-ask' : 'keep', retention);
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a malformed invocation exits 2 with usage on stderr and nothing on stdout', () => {
  // real process: proves the script entry's non-zero exit code and stderr
  const res = spawnCli(CLI, ['--retention', 'sometimes']);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /unknown retention value: sometimes/);
  assert.match(res.stderr, /usage: plan-retention\.js/);
  assert.equal(res.stdout, '');
});

test('AC3.1: plan-retention reads the working directory and its git child\'s env from the injected cwd and env', () => {
  const old = planRepo({ old: 30 });
  const other = planRepo({ recent: 1 });
  const args = ['--retention', 'keep-forever', ...old.oldPlans];
  const archived = (parsed) => parsed.plans.filter((row) => row.route === 'prune-archive').length;
  try {
    // injected env: the cwd is repo `other` (no old plans), GIT_DIR names `old`'s repository, so
    // the first-add dates follow `old`
    assert.equal(archived(cliJson(other.repo, args)), 0, 'without GIT_DIR the plans read as uncommitted');
    const viaEnv = cliJson(other.repo, args, { ...process.env, GIT_DIR: path.join(old.repo, '.git') });
    assert.equal(archived(viaEnv), 30, 'the git child read the injected GIT_DIR');
    assert.ok(viaEnv.plans.every((row) => row.firstAdded !== 'uncommitted'));

    // injected cwd: the test process stays in the checkout, the output follows the fixture
    assert.notEqual(old.repo, process.cwd());
    assert.equal(archived(cliJson(old.repo, args)), 30, 'the git child ran in the injected cwd');
  } finally {
    fs.rmSync(old.repo, { recursive: true, force: true });
    fs.rmSync(other.repo, { recursive: true, force: true });
  }
});
