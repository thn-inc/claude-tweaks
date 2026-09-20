'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {
  computeMergeSizeOverflow,
  MergeSizeProbeError,
  CEILING_ELIGIBLE,
} = require(path.join(__dirname, '..', '..', 'plugin', 'bin', 'lib', 'merge-size-probe.js'));
const { CEILING_BYTES } = require(path.join(__dirname, '..', '..', 'plugin', 'bin', 'lib', 'skill-audit', 'context-cost.js'));

const TREE = 'a'.repeat(40);

// A fake git runner keyed by the subcommand (argv[0]). Records calls.
function fakeGit(handlers) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    const handler = handlers[args[0]];
    if (!handler) throw new Error(`unexpected git ${args.join(' ')}`);
    return handler(args);
  };
  git.calls = calls;
  return git;
}

test('CEILING_ELIGIBLE matches SKILL.md at any depth and skills/_shared/*.md, nothing else', () => {
  assert.ok(CEILING_ELIGIBLE.test('plugin/skills/build/SKILL.md'));
  assert.ok(CEILING_ELIGIBLE.test('SKILL.md'));
  assert.ok(CEILING_ELIGIBLE.test('plugin/skills/_shared/pr-early-run-lifecycle.md'));
  assert.ok(!CEILING_ELIGIBLE.test('plugin/skills/build/plan-audit.md'));
  assert.ok(!CEILING_ELIGIBLE.test('docs/plugin-structure.md'));
  assert.ok(!CEILING_ELIGIBLE.test('plugin/skills/_shared/README.txt'));
});

test('no eligible touched files short-circuits without calling merge-tree at all', () => {
  const git = fakeGit({
    diff: () => 'docs/plugin-structure.md\nplugin/bin/hooks.js\n',
  });
  const out = computeMergeSizeOverflow({ integrationBranch: 'main' }, { git });
  assert.deepStrictEqual(out, { mergedTree: null, measured: [], overflow: [] });
  assert.ok(!git.calls.some((c) => c[0] === 'merge-tree'), 'merge-tree must not run with nothing to measure');
});

test('happy path: measures every eligible touched file at the merged tree, no overflow', () => {
  const git = fakeGit({
    diff: () => 'plugin/skills/build/SKILL.md\ndocs/plugin-structure.md\n',
    'merge-tree': () => `${TREE}\n`,
    show: (args) => (args[1] === `${TREE}:plugin/skills/build/SKILL.md` ? 'x'.repeat(500) : ''),
  });
  const out = computeMergeSizeOverflow({ integrationBranch: 'main', headRef: 'feature' }, { git });
  assert.strictEqual(out.mergedTree, TREE);
  assert.deepStrictEqual(out.measured, [{ path: 'plugin/skills/build/SKILL.md', bytes: 500 }]);
  assert.deepStrictEqual(out.overflow, []);
});

test('a file measured over the 40 KB ceiling at the merged tree lands in overflow with its excess', () => {
  const over = 'x'.repeat(CEILING_BYTES + 250);
  const git = fakeGit({
    diff: () => 'plugin/skills/_shared/big.md\n',
    'merge-tree': () => `${TREE}\n`,
    show: () => over,
  });
  const out = computeMergeSizeOverflow({ integrationBranch: 'main' }, { git });
  assert.strictEqual(out.overflow.length, 1);
  assert.strictEqual(out.overflow[0].path, 'plugin/skills/_shared/big.md');
  assert.strictEqual(out.overflow[0].bytes, CEILING_BYTES + 250);
  assert.strictEqual(out.overflow[0].over, 250);
});

test('a file exactly at the ceiling is not overflow (boundary agrees with context-cost.js)', () => {
  const atCeiling = 'x'.repeat(CEILING_BYTES);
  const git = fakeGit({
    diff: () => 'SKILL.md\n',
    'merge-tree': () => `${TREE}\n`,
    show: () => atCeiling,
  });
  const out = computeMergeSizeOverflow({ integrationBranch: 'main' }, { git });
  assert.deepStrictEqual(out.overflow, []);
});

test('a file deleted by the merge (git show throws) is silently absent from measured, not an error', () => {
  const git = fakeGit({
    diff: () => 'plugin/skills/_shared/removed.md\n',
    'merge-tree': () => `${TREE}\n`,
    show: () => { throw new Error("fatal: path 'plugin/skills/_shared/removed.md' does not exist"); },
  });
  const out = computeMergeSizeOverflow({ integrationBranch: 'main' }, { git });
  assert.deepStrictEqual(out.measured, []);
  assert.deepStrictEqual(out.overflow, []);
});

test('a git-show failure unrelated to deletion (e.g. object corruption) throws MergeSizeProbeError, never a false "no overflow"', () => {
  const git = fakeGit({
    diff: () => 'plugin/skills/_shared/damaged.md\n',
    'merge-tree': () => `${TREE}\n`,
    show: () => { throw new Error('fatal: unable to read blob object deadbeef'); },
  });
  assert.throws(
    () => computeMergeSizeOverflow({ integrationBranch: 'main' }, { git }),
    (err) => err instanceof MergeSizeProbeError && /git show .* failed/.test(err.message)
  );
});

test('a real merge conflict (merge-tree exits non-zero) throws MergeSizeProbeError, never a false "no overflow"', () => {
  const git = fakeGit({
    diff: () => 'plugin/skills/build/SKILL.md\n',
    'merge-tree': () => { throw new Error('CONFLICT (content): Merge conflict in plugin/skills/build/SKILL.md'); },
  });
  assert.throws(
    () => computeMergeSizeOverflow({ integrationBranch: 'main' }, { git }),
    (err) => err instanceof MergeSizeProbeError && /merge-tree --write-tree failed/.test(err.message)
  );
});

test('git diff --name-only failure throws MergeSizeProbeError', () => {
  const git = fakeGit({
    diff: () => { throw new Error('fatal: bad revision'); },
  });
  assert.throws(
    () => computeMergeSizeOverflow({ integrationBranch: 'main' }, { git }),
    (err) => err instanceof MergeSizeProbeError && /git diff --name-only failed/.test(err.message)
  );
});

test('an explicit paths override bypasses the diff step entirely', () => {
  const git = fakeGit({
    'merge-tree': () => `${TREE}\n`,
    show: () => 'y'.repeat(10),
  });
  const out = computeMergeSizeOverflow(
    { integrationBranch: 'main', paths: ['plugin/skills/_shared/x.md'] },
    { git }
  );
  assert.deepStrictEqual(out.measured, [{ path: 'plugin/skills/_shared/x.md', bytes: 10 }]);
  assert.ok(!git.calls.some((c) => c[0] === 'diff'), 'diff must not run when paths is given explicitly');
});

test('merge-tree call uses --end-of-options before the branch/ref args (a ref beginning with "-" must not be read as a flag)', () => {
  const git = fakeGit({
    diff: () => 'SKILL.md\n',
    'merge-tree': () => `${TREE}\n`,
    show: () => 'z',
  });
  computeMergeSizeOverflow({ integrationBranch: '-evil', headRef: 'feature' }, { git });
  const call = git.calls.find((c) => c[0] === 'merge-tree');
  assert.deepStrictEqual(call, ['merge-tree', '--write-tree', '--end-of-options', '-evil', 'feature']);
});

test('defaults integrationBranch to main and headRef to HEAD when neither is passed', () => {
  const git = fakeGit({
    diff: () => 'SKILL.md\n',
    'merge-tree': () => `${TREE}\n`,
    show: () => 'z',
  });
  computeMergeSizeOverflow({}, { git });
  const diffCall = git.calls.find((c) => c[0] === 'diff');
  assert.ok(diffCall.includes('main...HEAD'), `expected main...HEAD in ${diffCall}`);
});
