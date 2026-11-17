'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const lib = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { createGitReads } = require(path.join(lib, 'verify', 'git-reads.js'));
const { realGit } = require(path.join(lib, 'verify', 'baseline.js'));
const { gitDir } = require(path.join(lib, 'verify', 'report.js'));
const { gitLocations } = require(path.join(lib, 'verify', 'impact.js'));

const COMBINED = ['rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir', '--verify', '-q', 'HEAD'];
const STATUS = ['--no-optional-locks', 'status', '--porcelain'];
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// A fake exec that records calls and answers by argv shape; `handlers` is an
// array of [argv, answer] pairs, where an answer is a value, a thrown-error
// marker (see `thrown`), or a function of the calls so far.
function fake(handlers) {
  const calls = [];
  const execImpl = (file, args, opts = {}) => {
    calls.push({ file, args, cwd: opts.cwd, opts });
    for (const [match, answer] of handlers) {
      if (same(args, match)) {
        const v = typeof answer === 'function' ? answer(calls) : answer;
        if (v instanceof Error || (v && v.__throw)) throw Object.assign(new Error('git failed'), v.__throw || v);
        return v;
      }
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  return { execImpl, calls };
}
const seq = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };
const thrown = (props) => ({ __throw: props });
const rootAnswer = '/r\n.git\n.git\nabc\n';

test('locations asks one combined rev-parse per directory', () => {
  const { execImpl, calls } = fake([[COMBINED, rootAnswer]]);
  const reads = createGitReads({ execImpl, env: {} });
  const a = reads.locations('/r');
  const b = reads.locations('/r');
  assert.equal(calls.length, 1);
  assert.deepStrictEqual(calls[0].args, COMBINED);
  assert.equal(calls[0].file, 'git');
  assert.equal(calls[0].opts.windowsHide, true);
  const expected = { toplevel: '/r', gitDir: path.resolve('/r', '.git'), commonDir: path.resolve('/r', '.git'), head: 'abc' };
  assert.deepStrictEqual(a, expected);
  assert.deepStrictEqual(b, expected);
});

test('locations keys on directory and env', () => {
  const { execImpl, calls } = fake([[COMBINED, rootAnswer]]);
  const reads = createGitReads({ execImpl, env: {} });
  reads.locations('/r');
  reads.locations('/r/sub');
  assert.equal(calls.length, 2);
  reads.locations('/r');
  assert.equal(calls.length, 2, 'the same directory twice is one call');
  const other = createGitReads({ execImpl, env: { GIT_DIR: 'x' } });
  other.locations('/r');
  assert.equal(calls.length, 3, 'a second instance with another env asks for itself');
});

test('every git call carries the directory and the instance env', () => {
  const env = { GIT_AUTHOR_NAME: 'e' };
  const ok = fake([[COMBINED, rootAnswer], [STATUS, '']]);
  const reads = createGitReads({ execImpl: ok.execImpl, env });
  reads.treeState('/r');
  assert.equal(ok.calls.length, 2);
  for (const c of ok.calls) {
    assert.equal(c.cwd, '/r', c.args.join(' '));
    assert.strictEqual(c.opts.env, env, c.args.join(' '));
  }
  const bare = fake([
    [COMBINED, thrown({ status: 128, stdout: '' })],
    [['rev-parse', '--git-dir'], '.\n'],
    [['rev-parse', '--show-toplevel'], '/b\n'],
    [['rev-parse', '--git-common-dir'], '.\n'],
    [['rev-parse', 'HEAD'], 'abc\n'],
  ]);
  createGitReads({ execImpl: bare.execImpl, env }).locations('/b');
  assert.equal(bare.calls.length, 5);
  for (const c of bare.calls) {
    assert.equal(c.cwd, '/b', c.args.join(' '));
    assert.strictEqual(c.opts.env, env, c.args.join(' '));
  }
});

test('an empty output line is a null value, not a missing line', () => {
  const { execImpl, calls } = fake([[COMBINED, '\n.git\n.git\nabc\n']]);
  assert.deepStrictEqual(createGitReads({ execImpl, env: {} }).locations('/r'), {
    toplevel: null, gitDir: path.resolve('/r', '.git'), commonDir: path.resolve('/r', '.git'), head: 'abc',
  });
  assert.equal(calls.length, 1, 'no fallback calls');
  const headless = fake([[COMBINED, '/r\n.git\n.git\n\n']]);
  assert.equal(createGitReads({ execImpl: headless.execImpl, env: {} }).locations('/r').head, null);
  assert.equal(headless.calls.length, 1);
  // An empty git-dir / common-dir line is null, not path.resolve(cwd, '') (which would quietly be the cwd).
  const noDirs = fake([[COMBINED, '/r\n\n\nabc\n']]);
  const answer = createGitReads({ execImpl: noDirs.execImpl, env: {} }).locations('/r');
  assert.strictEqual(answer.gitDir, null);
  assert.strictEqual(answer.commonDir, null);
  assert.equal(noDirs.calls.length, 1);
});

test('a live env object that changes between reads is a different key', () => {
  const { execImpl, calls } = fake([[COMBINED, rootAnswer]]);
  const env = { GIT_DIR: 'a' };
  const reads = createGitReads({ execImpl, env });
  reads.locations('/r');
  reads.locations('/r');
  assert.equal(calls.length, 1);
  env.GIT_DIR = 'b';
  reads.locations('/r');
  assert.equal(calls.length, 2, 'process.env is live: a changed GIT_DIR must not be served the old answer');
});

test('treeState reuses the head from locations and runs status once', () => {
  const { execImpl, calls } = fake([[COMBINED, rootAnswer], [STATUS, '']]);
  const reads = createGitReads({ execImpl, env: {} });
  reads.locations('/r');
  assert.deepStrictEqual(reads.treeState('/r'), { sha: 'abc', dirty: false });
  reads.treeState('/r');
  assert.equal(calls.filter((c) => same(c.args, STATUS)).length, 1);
  assert.equal(calls.length, 2);
});

test('treeState reads dirty from non-empty status and null from a throw', () => {
  const dirty = fake([[COMBINED, rootAnswer], [STATUS, '?? x\n']]);
  assert.deepStrictEqual(createGitReads({ execImpl: dirty.execImpl, env: {} }).treeState('/r'), { sha: 'abc', dirty: true });
  const broken = fake([[COMBINED, rootAnswer], [STATUS, thrown({ status: 128 })]]);
  assert.deepStrictEqual(createGitReads({ execImpl: broken.execImpl, env: {} }).treeState('/r'), { sha: 'abc', dirty: null });
});

test('invalidate makes the next read ask git again (stale-read guard)', () => {
  const { execImpl } = fake([
    [COMBINED, seq('/r\n.git\n.git\naaa\n', '/r\n.git\n.git\nbbb\n')],
    [STATUS, seq('', '?? x\n')],
  ]);
  const reads = createGitReads({ execImpl, env: {} });
  assert.deepStrictEqual(reads.treeState('/r'), { sha: 'aaa', dirty: false });
  assert.deepStrictEqual(reads.treeState('/r'), { sha: 'aaa', dirty: false });
  reads.invalidate();
  assert.deepStrictEqual(reads.treeState('/r'), { sha: 'bbb', dirty: true });
  assert.equal(reads.locations('/r').head, 'bbb');
});

test('unborn HEAD gives locations and a null tree state without status', () => {
  const { execImpl, calls } = fake([[COMBINED, thrown({ status: 1, stdout: '/r\n.git\n.git\n' })]]);
  const reads = createGitReads({ execImpl, env: {} });
  assert.deepStrictEqual(reads.locations('/r'), {
    toplevel: '/r', gitDir: path.resolve('/r', '.git'), commonDir: path.resolve('/r', '.git'), head: null,
  });
  assert.deepStrictEqual(reads.treeState('/r'), { sha: null, dirty: null });
  assert.equal(calls.filter((c) => c.args.includes('status')).length, 0);
  assert.equal(calls.length, 1);
});

test('outside a checkout costs two calls and answers null', () => {
  const { execImpl, calls } = fake([
    [COMBINED, thrown({ status: 128, stdout: '' })],
    [['rev-parse', '--git-dir'], thrown({ status: 128 })],
  ]);
  const reads = createGitReads({ execImpl, env: {} });
  assert.deepStrictEqual(reads.locations('/x'), { toplevel: null, gitDir: null, commonDir: null, head: null });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].opts.stdio, undefined, 'the fallback keeps today\'s inherited stderr');
});

test('bare repo falls back per question', () => {
  const { execImpl } = fake([
    [COMBINED, thrown({ status: 128, stdout: '' })],
    [['rev-parse', '--git-dir'], '.\n'],
    [['rev-parse', '--show-toplevel'], thrown({ status: 128 })],
    [['rev-parse', '--git-common-dir'], '.\n'],
    [['rev-parse', 'HEAD'], 'abc\n'],
  ]);
  const reads = createGitReads({ execImpl, env: {} });
  assert.deepStrictEqual(reads.locations('/bare'), {
    toplevel: null, gitDir: path.resolve('/bare', '.'), commonDir: path.resolve('/bare', '.'), head: 'abc',
  });
});

test('a throw that is not an unborn HEAD takes the fallback even with status 1', () => {
  // status 1 with a different line count is not the unborn shape.
  const { execImpl, calls } = fake([
    [COMBINED, thrown({ status: 1, stdout: '/r\n' })],
    [['rev-parse', '--git-dir'], thrown({ status: 128 })],
  ]);
  assert.deepStrictEqual(createGitReads({ execImpl, env: {} }).locations('/r'),
    { toplevel: null, gitDir: null, commonDir: null, head: null });
  assert.equal(calls.length, 2);
});

test('real git agrees with today\'s readers', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-reads-')));
  try {
    const run = (args) => String(execFileSync('git', args, {
      cwd: dir, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    }));
    run(['init', '-q']);
    fs.writeFileSync(path.join(dir, 'f.txt'), 'x\n');
    run(['add', 'f.txt']);
    run(['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'one']);
    const got = createGitReads().locations(dir);
    assert.deepStrictEqual(got, {
      toplevel: realGit(dir).repoRoot(),
      gitDir: gitDir(execFileSync, dir),
      commonDir: gitLocations({ cwd: dir }).commonDir,
      head: run(['rev-parse', 'HEAD']).trim(),
    });
    assert.deepStrictEqual(createGitReads().treeState(dir), { sha: got.head, dirty: false });
    fs.writeFileSync(path.join(dir, 'g.txt'), 'y\n');
    assert.deepStrictEqual(createGitReads().treeState(dir), { sha: got.head, dirty: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
