'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { arrivedPart, GitError } = require('../../../plugin/bin/lib/release-tip/check.js');
const { originWithTwoClones } = require('../../helpers/git-fixtures.js');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const runner = (cwd, env) => (args) => spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true });

// One range per call: the fixture's current HEAD is the base, then each
// message lands as its own commit (optionally writing `files` with it), and
// the new HEAD is the tip.
function withRange(messages, fn, { files = {} } = {}) {
  const fx = originWithTwoClones('release-tip-arrived-');
  try {
    const git = runner(fx.work, fx.env);
    const head = () => git(['rev-parse', 'HEAD']).stdout.trim();
    const base = head();
    messages.forEach((msg, i) => {
      fs.writeFileSync(path.join(fx.work, `f${i}`), msg);
      fx.run(fx.work, ['add', `f${i}`]);
      for (const [name, text] of Object.entries(files)) {
        fs.writeFileSync(path.join(fx.work, name), text);
        fx.run(fx.work, ['add', name]);
      }
      fx.run(fx.work, ['commit', '-q', '-m', msg]);
    });
    return fn({ git, base, tip: head() });
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

test('chore-only range is none', () => {
  withRange(['chore: x', 'chore: x'], ({ git, base, tip }) => {
    const r = arrivedPart({ git, base, tip, preMajor: false });
    assert.strictEqual(r.part, 'none');
    assert.strictEqual(r.shas.length, 2);
    assert.strictEqual(r.base, base);
    assert.strictEqual(r.tip, tip);
    assert.ok(r.shas.every((s) => /^[0-9a-f]{40}$/.test(s)));
  });
});

test('feat is minor; fix is patch; feat! is major; a BREAKING CHANGE: footer is major', () => {
  const cases = [
    [['chore: x', 'feat: y'], 'minor'],
    [['chore: x', 'fix: y'], 'patch'],
    [['feat!: y'], 'major'],
    [['fix: y\n\nBREAKING CHANGE: z'], 'major'],
  ];
  for (const [messages, expected] of cases) {
    withRange(messages, ({ git, base, tip }) => {
      assert.strictEqual(arrivedPart({ git, base, tip, preMajor: false }).part, expected, messages.join(' | '));
    });
  }
});

test('pre-major softens a breaking marker to minor by default', () => {
  withRange(['feat!: y'], ({ git, base, tip }) => {
    assert.strictEqual(arrivedPart({ git, base, tip, preMajor: true }).part, 'minor');
  });
});

test('pre-major with bump-minor-pre-major false stays major', () => {
  withRange(['feat!: y'], ({ git, base, tip }) => {
    assert.strictEqual(arrivedPart({ git, base, tip, preMajor: true }).part, 'major');
  }, { files: { 'release-please-config.json': '{"bump-minor-pre-major": false}' } });
});

test('a --no-ff merge range follows every parent: the side commit counts, not just the merge subject', () => {
  const fx = originWithTwoClones('release-tip-arrived-');
  try {
    const git = runner(fx.work, fx.env);
    const base = git(['rev-parse', 'HEAD']).stdout.trim();
    fx.run(fx.work, ['checkout', '-q', '-b', 'side']);
    fs.writeFileSync(path.join(fx.work, 'side.txt'), 'x');
    fx.run(fx.work, ['add', 'side.txt']);
    fx.run(fx.work, ['commit', '-q', '-m', 'feat!: side']);
    fx.run(fx.work, ['checkout', '-q', 'main']);
    fx.run(fx.work, ['merge', '--no-ff', '-q', '-m', 'Merge branch side', 'side']);
    const tip = git(['rev-parse', 'HEAD']).stdout.trim();
    const r = arrivedPart({ git, base, tip, preMajor: false });
    assert.strictEqual(r.part, 'major', 'a first-parent walk would see only the unconventional merge subject');
    assert.strictEqual(r.shas.length, 2);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('real range from the 2026-10-24 release', (t) => {
  const git = runner(REPO_ROOT, process.env);
  const base = '1813941ecfe019b89307ea75526f2c863ffb5e1e';
  const tip = '0ecde186ccb4a2d176d86f359699b006014852e6';
  if (git(['cat-file', '-e', `${base}^{commit}`]).status !== 0 || git(['cat-file', '-e', `${tip}^{commit}`]).status !== 0) {
    t.skip('the release range is not in this clone (shallow)');
    return;
  }
  const r = arrivedPart({ git, base, tip, preMajor: false });
  assert.strictEqual(r.part, 'minor');
  assert.strictEqual(r.shas.length, 5);
});

test('GitError reads as a spawn failure when git never ran, and as an exit otherwise', () => {
  const spawnFailure = new GitError(['log'], null, 'spawn git ENOENT');
  assert.match(spawnFailure.message, /could not be spawned: spawn git ENOENT/);
  assert.doesNotMatch(spawnFailure.message, /exited/);
  assert.match(new GitError(['log'], 128, 'fatal: bad\n').message, /exited 128: fatal: bad$/);
});

test('unresolvable base throws GitError', () => {
  withRange(['feat: y'], ({ git, tip }) => {
    assert.throws(
      () => arrivedPart({ git, base: 'no-such-ref-4152', tip, preMajor: false }),
      (err) => err instanceof GitError
        && err.args[0] === 'log'
        && err.status !== 0
        && /no-such-ref-4152/.test(err.stderr),
    );
  });
});
