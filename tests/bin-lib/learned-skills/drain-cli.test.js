'use strict';
// learned-skills-pr.js drain (#6112): the verb resolves the two levers, reads the repo only when gh is
// there, and prints the library's one JSON line. The library, the policy read and gh are all injected.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cli = require('../../../plugin/bin/learned-skills-pr.js');
const { drain } = require('../../../plugin/bin/lib/learned-skills/drain.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const repoResolve = require('../../../plugin/bin/lib/repo-resolve.js');
const { realDeps: libDeps } = require('../../../plugin/bin/lib/learned-skills/learned-skills.js');

const DIR = '/main/.claude-tweaks/pipelines/run-1';
const RESULT = { merged: [3], armed: [], leftOpen: [], conflicting: [] };

function harness(extra = {}) {
  const out = [];
  const err = [];
  const calls = { lib: [], libOverrides: [], repoView: 0, policy: [] };
  const deps = {
    cwd: () => '/main',
    resolveTarget: () => ({ ok: true, dir: DIR }),
    resolvePolicy: (dir) => { calls.policy.push(dir); return { autoMerge: true, mergeVerification: 'wait' }; },
    ghAvailable: () => true,
    repoView: () => { calls.repoView++; return 'o/r\n'; },
    drainLib: (opts, overrides) => { calls.lib.push(opts); calls.libOverrides.push(overrides); return RESULT; },
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...extra,
  };
  return { deps, out, err, calls };
}

test('drain prints the library JSON and passes the resolved levers, own PR and repo', () => {
  const h = harness();
  const code = cli.run(['drain', '--run', DIR, '--integration-branch', 'main', '--own-pr', '7'], h.deps);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(h.out.join('')), RESULT);
  assert.deepEqual(h.calls.lib, [{ runDir: DIR, integrationBranch: 'main', ownPr: 7, autoMerge: true, mergeVerification: 'wait', repo: 'o/r' }]);
  assert.deepEqual(h.calls.policy, [DIR]);
});

test('an explicit --repo skips the repo read', () => {
  const h = harness();
  assert.equal(cli.run(['drain', '--run', DIR, '--integration-branch', 'main', '--repo', 'x/y'], h.deps), 0);
  assert.equal(h.calls.repoView, 0);
  assert.equal(h.calls.lib[0].repo, 'x/y');
  assert.equal(h.calls.lib[0].ownPr, undefined);
});

test('--own-pr that is not a positive integer is exit 2', () => {
  for (const bad of ['abc', '0', '07', '-3', '1.5']) {
    const h = harness();
    assert.equal(cli.run(['drain', '--run', DIR, '--integration-branch', 'main', '--own-pr', bad], h.deps), 2, bad);
    assert.equal(h.calls.lib.length, 0);
  }
});

test('a missing --integration-branch or --run is exit 2', () => {
  assert.equal(cli.run(['drain', '--run', DIR], harness().deps), 2);
  assert.equal(cli.run(['drain', '--integration-branch', 'main'], harness().deps), 2);
});

test('a refused --run is exit 2 and the library never runs', () => {
  const h = harness({ resolveTarget: () => ({ ok: false, reason: 'unanchored' }) });
  assert.equal(cli.run(['drain', '--run', DIR, '--integration-branch', 'main'], h.deps), 2);
  assert.equal(h.calls.lib.length, 0);
});

test('a library throw is exit 1 with the drain-failed stderr line', () => {
  const h = harness({ drainLib: () => { throw new Error('gh pr list failed'); } });
  assert.equal(cli.run(['drain', '--run', DIR, '--integration-branch', 'main'], h.deps), 1);
  assert.match(h.err.join(''), /learned-skills-pr\.js: drain failed: gh pr list failed/);
  assert.equal(h.out.join(''), '');
});

test('a repo-read failure is exit 1 and the library never runs', () => {
  const h = harness({ repoView: () => { throw new Error('no remote'); } });
  assert.equal(cli.run(['drain', '--run', DIR, '--integration-branch', 'main'], h.deps), 1);
  assert.match(h.err.join(''), /drain failed: could not read the repository: no remote/);
  assert.equal(h.calls.lib.length, 0);
});

test('without gh: no repo read, the library prints its no-gh result, exit 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-cli-'));
  try {
    const h = harness({ ghAvailable: () => false, drainLib: drain, resolveTarget: () => ({ ok: true, dir }) });
    h.deps.repoView = () => { throw new Error('repo must not be read'); };
    const code = cli.run(['drain', '--run', dir, '--integration-branch', 'main', '--own-pr', '7'], h.deps);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(h.out.join('')), { merged: [], armed: [], leftOpen: [{ pr: 7, reason: 'no-gh' }], conflicting: [] });
    const decisions = fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8');
    assert.match(decisions, /PR #7 left open \(no-gh\)/);
    assert.match(decisions, /learned-skills-auto-merge=true/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'learned-skills', 'drain.json'), 'utf8')), { pr: 7, outcome: 'left-open', reason: 'no-gh' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a false lever never reads gh or the repo: the library reports disabled even when the repo read would fail', () => {
  const h = harness({
    resolvePolicy: () => ({ autoMerge: false, mergeVerification: 'wait' }),
    ghAvailable: () => { throw new Error('gh must not be probed'); },
    repoView: () => { throw new Error('repo must not be read'); },
    drainLib: drain,
  });
  assert.equal(cli.run(['drain', '--run', DIR, '--integration-branch', 'main', '--own-pr', '7'], h.deps), 0);
  assert.deepEqual(JSON.parse(h.out.join('')), { merged: [], armed: [], leftOpen: [], conflicting: [], disabled: true });
  assert.equal(h.err.join(''), '');
});

test('realDeps wiring: ghAvailable and resolvePolicy are the real helpers, repoView asks gh for nameWithOwner', () => {
  assert.equal(cli.realDeps.ghAvailable, repoResolve.ghAvailable);
  assert.equal(cli.realDeps.resolvePolicy, cli.defaultResolvePolicy);
  assert.equal(cli.realDeps.drainLib, drain);
  const real = libDeps.gh;
  const seen = [];
  libDeps.gh = (args) => { seen.push(args); return 'o/r\n'; };
  try {
    assert.equal(cli.realDeps.repoView(), 'o/r\n');
  } finally {
    libDeps.gh = real;
  }
  assert.deepEqual(seen, [['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']]);
});

test('without gh the library is called with ghAvailable false', () => {
  const h = harness({ ghAvailable: () => false });
  assert.equal(cli.run(['drain', '--run', DIR, '--integration-branch', 'main', '--own-pr', '7'], h.deps), 0);
  assert.equal(h.calls.libOverrides[0].ghAvailable(), false);
  assert.equal(h.calls.repoView, 0);
});

test('AC4.1 (code): a resolved false lever gives the library autoMerge false', () => {
  const h = harness({ resolvePolicy: () => ({ autoMerge: false, mergeVerification: 'wait' }) });
  assert.equal(cli.run(['drain', '--run', DIR, '--integration-branch', 'main'], h.deps), 0);
  assert.equal(h.calls.lib[0].autoMerge, false);
});

test('a non-boolean autoMerge from the policy seam is treated as off', () => {
  const h = harness({ resolvePolicy: () => ({ autoMerge: 'true', mergeVerification: 'wait' }) });
  cli.run(['drain', '--run', DIR, '--integration-branch', 'main'], h.deps);
  assert.equal(h.calls.lib[0].autoMerge, false);
});

test('drain is in the usage text', () => {
  assert.match(cli.USAGE, /learned-skills-pr\.js drain --run/);
});

test('the default policy reader turns a failing resolve-policy call into off', () => {
  assert.deepEqual(cli.defaultResolvePolicy('/x', () => { throw new Error('exit 1'); }), { autoMerge: false, mergeVerification: '' });
  assert.deepEqual(cli.defaultResolvePolicy('/nonexistent-run-dir-6112'), { autoMerge: false, mergeVerification: '' });
});

test('the default policy reader reads two lines and treats only the literal true as on', () => {
  const cases = [['true\nmerge-when-green\n', true, 'merge-when-green'], ['false\nwait\n', false, 'wait'], ['True\r\nwait\r\n', false, 'wait'], ['yes\noff\n', false, 'off'], ['', false, '']];
  for (const [stdout, autoMerge, mergeVerification] of cases) {
    const seen = [];
    const got = cli.defaultResolvePolicy('/x', (cmd, args) => { seen.push(args); return stdout; });
    assert.deepEqual(got, { autoMerge, mergeVerification }, JSON.stringify(stdout));
    assert.deepEqual(seen[0].slice(-4), ['--run', '/x', '--values', 'learned-skills-auto-merge,merge-verification']);
  }
});
