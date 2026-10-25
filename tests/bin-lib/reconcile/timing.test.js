// tests/bin-lib/reconcile/timing.test.js — the AsyncLocalStorage-scoped timing
// collector reconcile() (#4032) uses to report per-check and per-subprocess cost.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createTimings, withTimings, timePhaseSync, timePhase, recordSubprocess,
  commandFamily, execFileSyncTimed, summarizeTimings,
} = require('../../../plugin/bin/lib/reconcile/timing');

test('commandFamily: git skips -C/-c pairs', () => {
  assert.equal(commandFamily('git', ['-C', '/x y', '-c', 'a=b', 'worktree', 'list', '--porcelain']), 'git worktree');
});

test('commandFamily: gh pr/issue keep two words', () => {
  assert.equal(commandFamily('gh', ['pr', 'view', '12', '--json', 'x']), 'gh pr view');
  assert.equal(commandFamily('gh', ['issue', 'list', '--repo', 'o/r']), 'gh issue list');
});

test('commandFamily: gh api graphql and REST resource', () => {
  assert.equal(commandFamily('gh', ['api', 'graphql', '-f', 'q=1']), 'gh api graphql');
  assert.equal(commandFamily('gh', ['api', 'repos/o/r/contents/claims/issue-3.json?ref=claims-registry']), 'gh api contents');
  assert.equal(commandFamily('gh', ['api', 'repos/o/r/git/trees/claims-registry?recursive=1']), 'gh api git/trees');
  assert.equal(commandFamily('gh', ['api', 'rate_limit', '-q', '.x']), 'gh api rate_limit');
});

test('commandFamily: gh api skips value-taking flags before the endpoint', () => {
  assert.equal(commandFamily('gh', ['api', '-X', 'PUT', '/repos/o/r/pulls/3/merge']), 'gh api pulls');
});

test('commandFamily: a non-git, non-gh executable is its own basename', () => {
  assert.equal(commandFamily('/usr/bin/node', ['-e', '1']), 'node');
});

test('recordSubprocess outside a store is a no-op', () => {
  assert.doesNotThrow(() => recordSubprocess('git', ['status'], 5));
  assert.deepEqual(summarizeTimings(createTimings()).phases, {});
});

test('phases accumulate ms and subprocess buckets', () => {
  const t = createTimings();
  withTimings(t, () => {
    timePhaseSync('archive', () => {
      recordSubprocess('gh', ['pr', 'view', '1'], 30);
      recordSubprocess('gh', ['pr', 'view', '2'], 50);
    });
  });
  const { phases } = summarizeTimings(t);
  assert.deepEqual(phases.archive.subprocesses['gh pr view'], { count: 2, ms: 80, maxMs: 50 });
  assert.equal(phases.archive.subprocessCount, 2);
  assert.equal(phases.archive.subprocessMs, 80);
  assert.equal(typeof phases.archive.ms, 'number');
});

test('timePhaseSync restores the previous phase and returns the callback value', () => {
  const t = createTimings();
  withTimings(t, () => {
    assert.equal(timePhaseSync('a', () => 42), 42);
    recordSubprocess('git', ['fetch'], 1);
  });
  const { phases } = summarizeTimings(t);
  assert.equal(phases.setup.subprocesses['git fetch'].count, 1, 'a call after a phase lands back in setup');
  assert.equal(phases.a.subprocessCount, 0);
});

test('timePhaseSync still records the phase when the callback throws', () => {
  const t = createTimings();
  withTimings(t, () => {
    assert.throws(() => timePhaseSync('boom', () => { throw new Error('x'); }), /x/);
  });
  assert.ok(summarizeTimings(t).phases.boom);
});

test('async phases isolate concurrent stores', async () => {
  const a = createTimings();
  const b = createTimings();
  await Promise.all([
    withTimings(a, () => timePhase('p', async () => {
      await new Promise((r) => setTimeout(r, 5));
      recordSubprocess('gh', ['pr', 'view', '1'], 1);
    })),
    withTimings(b, () => timePhase('p', async () => {
      await new Promise((r) => setTimeout(r, 1));
      recordSubprocess('git', ['fetch'], 1);
    })),
  ]);
  assert.deepEqual(Object.keys(summarizeTimings(a).phases.p.subprocesses), ['gh pr view']);
  assert.deepEqual(Object.keys(summarizeTimings(b).phases.p.subprocesses), ['git fetch']);
});

test('execFileSyncTimed records a failing call and rethrows', () => {
  const t = createTimings();
  withTimings(t, () => {
    timePhaseSync('x', () => {
      assert.throws(() => execFileSyncTimed('git', ['definitely-not-a-subcommand'], { stdio: 'ignore', windowsHide: true }));
    });
  });
  assert.equal(summarizeTimings(t).phases.x.subprocesses['git definitely-not-a-subcommand'].count, 1);
});

test('execFileAsyncTimed records its spawn in the active phase, failures included', async () => {
  const { execFileAsyncTimed } = require('../../../plugin/bin/lib/reconcile/timing');
  const t = createTimings();
  await withTimings(t, () => timePhase('y', async () => {
    const { stdout } = await execFileAsyncTimed('git', ['--version'], { encoding: 'utf8' });
    assert.match(stdout, /^git version/);
    await assert.rejects(() => execFileAsyncTimed('git', ['definitely-not-a-subcommand'], {}));
  }));
  const { phases } = summarizeTimings(t);
  assert.equal(phases.y.subprocesses.git.count, 1, '`git --version` has no subcommand, so it buckets as bare `git`');
  assert.equal(phases.y.subprocesses['git definitely-not-a-subcommand'].count, 1, 'a failing async call is recorded too');
  assert.equal(phases.y.subprocessCount, 2);
});

test('commandFamily: git skips --no-optional-locks and other bare global flags before the subcommand', () => {
  assert.equal(commandFamily('git', ['-C', '/x', '--no-optional-locks', 'status', '--porcelain']), 'git status');
  assert.equal(commandFamily('git', ['--no-pager', '-C', '/x', 'log']), 'git log');
  assert.equal(commandFamily('git', ['--git-dir', '/g', '--work-tree', '/w', 'rev-parse']), 'git rev-parse');
  assert.equal(commandFamily('git', ['--git-dir=/g', 'rev-parse']), 'git rev-parse');
  assert.equal(commandFamily('git', ['-C', '/x']), 'git', 'no subcommand at all');
});

// A recorder fault must never replace the call's own result or error: these
// run in a `finally`, on the never-break-a-session path.
function throwingTimings() {
  const t = createTimings();
  const boom = () => { throw new Error('recorder fault'); };
  t.phases = { get: boom, set: boom };
  return t;
}

test('a throwing recorder does not mask a successful execFileSyncTimed result', () => {
  const out = withTimings(throwingTimings(), () => execFileSyncTimed('git', ['--version'], { encoding: 'utf8' }));
  assert.match(out, /^git version/);
});

test('a throwing recorder does not replace the original spawn error', () => {
  withTimings(throwingTimings(), () => {
    assert.throws(
      () => execFileSyncTimed('git', ['definitely-not-a-subcommand'], { stdio: 'ignore' }),
      (e) => !/recorder fault/.test(e.message) && typeof e.status === 'number',
    );
  });
});

test('a throwing recorder does not mask execFileAsyncTimed or a timed phase result', async () => {
  const { execFileAsyncTimed } = require('../../../plugin/bin/lib/reconcile/timing');
  const out = await withTimings(throwingTimings(), () => timePhase('p', async () => {
    const { stdout } = await execFileAsyncTimed('git', ['--version'], { encoding: 'utf8' });
    return stdout;
  }));
  assert.match(out, /^git version/);
  assert.equal(withTimings(throwingTimings(), () => timePhaseSync('p', () => 7)), 7);
});

test('runGit under a store with a throwing recorder still returns git\'s answer', async () => {
  const { runGit, runGitAsync } = require('../../../plugin/bin/lib/hooks/git-exec');
  const sync = withTimings(throwingTimings(), () => runGit(['--version'], process.cwd()));
  assert.equal(sync.failure, null);
  assert.match(sync.stdout, /^git version/);
  const asyncR = await withTimings(throwingTimings(), () => runGitAsync(['--version'], process.cwd()));
  assert.equal(asyncR.failure, null);
});

test('execFileSyncTimed outside a store runs the command and returns its output', () => {
  const out = execFileSyncTimed('git', ['--version'], { encoding: 'utf8', windowsHide: true });
  assert.match(out, /^git version/);
});
