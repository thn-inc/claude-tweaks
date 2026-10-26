// tests/release-as-anchor-conformance.test.js — pins #4139: /release's `--as` override anchors on the same
// review-tree check Step 3 runs, so a checkout whose only unpushed commits are reconcile's
// `[reconcile] archive run …` commits passes it, and the override is built with `git commit-tree` on the
// fetched tip, so those archive commits never reach origin. The check and the override are extracted from
// the live SKILL.md and execute.md fences and run against fixture clones of a bare origin, as in
// release-review-tree-check-conformance.test.js. Frozen copies of the pre-fix anchor and commit/push pair
// prove the rows can go red, and the prose facts around the block are pinned with removal proofs.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { originWithTwoClones, FIXTURE_TIMEOUT_MS } = require('./helpers/git-fixtures');

const ROOT = path.join(__dirname, '..');
const SKILL = path.join(ROOT, 'plugin', 'skills', 'release', 'SKILL.md');
const EXECUTE = path.join(ROOT, 'plugin', 'skills', 'release', 'execute.md');
const BRANCH = 'main';
const VERSION = '9.9.9';

// The {branch} and {version} placeholders resolved, as the live fences run them.
function resolveNames(fence) {
  return fence.split('{branch}').join(BRANCH).split('{version}').join(VERSION);
}

// The first bash fence in `text` containing `needle`, placeholders resolved; `where` names the region in the failure message.
function bashFenceContaining(text, needle, where) {
  const fences = [...text.matchAll(/```bash\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const fence = fences.find((f) => f.includes(needle));
  assert.ok(fence, `extraction pattern is out of sync: no ${where} bash fence contains "${needle}"`);
  return resolveNames(fence);
}

// Step 3's review-tree check, extracted as release-review-tree-check-conformance.test.js does.
function stepThreeOf(text) {
  const start = text.indexOf('\n## Step 3');
  assert.notEqual(start, -1, 'extraction pattern is out of sync: release/SKILL.md has no "## Step 3" heading');
  const next = text.indexOf('\n## ', start + 1);
  assert.notEqual(next, -1, 'extraction pattern is out of sync: release/SKILL.md has no "## " heading after Step 3');
  return text.slice(start, next);
}

// The check's two calls: the tip fence prints {tip-sha}; the tree check takes it as a placeholder.
function liveCheck() {
  const stepThree = stepThreeOf(readText(SKILL));
  return {
    tip: bashFenceContaining(stepThree, 'rev-parse --verify origin/{branch}', 'Step 3'),
    check: bashFenceContaining(stepThree, 'rev-list --count HEAD..{tip-sha}', 'Step 3'),
  };
}

// The --as paragraph of execute.md, from its lead-in to the poll that follows the override.
function overrideBlockOf(text) {
  const start = text.indexOf('`--as {version}` — push the override');
  assert.notEqual(start, -1, 'extraction pattern is out of sync: execute.md has no "--as {version}" push-the-override paragraph');
  const next = text.indexOf('Then poll for the re-render', start);
  assert.notEqual(next, -1, 'extraction pattern is out of sync: execute.md has no "Then poll for the re-render" after the --as block');
  return text.slice(start, next);
}

// The commit-tree fence ({tip-sha} left as a placeholder) and the push fence ({sha} left as a placeholder).
function liveOverride() {
  const block = overrideBlockOf(readText(EXECUTE));
  return {
    block,
    commitTree: bashFenceContaining(block, 'git -C "$RUN_ROOT" commit-tree', '--as'),
    push: bashFenceContaining(block, '{sha}:refs/heads/', '--as'),
  };
}

function withFixture(prefix, body) {
  const fx = originWithTwoClones(prefix);
  try {
    body(fx);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// One fence run from `work` as $RUN_ROOT.
function runFence(fence, fx) {
  return spawnSync('bash', ['-c', fence], { env: { ...fx.env, RUN_ROOT: fx.work }, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS });
}

// The check's two calls as Step 3 runs them: the tip fence, then the tree check with the printed sha pasted in.
function runCheck(fences, fx) {
  const first = runFence(fences.tip, fx);
  if (first.status !== 0) return { status: first.status, stderr: first.stderr, tip: null };
  const tip = first.stdout.trim();
  const second = runFence(fences.check.split('{tip-sha}').join(tip), fx);
  return { status: second.status, stderr: second.stderr, tip };
}

// The whole --as paragraph: the check, commit-tree on the printed tip, then the push of its printed sha.
function runOverride(fx, fences, ov) {
  const checked = runCheck(fences, fx);
  if (checked.status !== 0) return { checked };
  const built = runFence(ov.commitTree.split('{tip-sha}').join(checked.tip), fx);
  if (built.status !== 0) return { checked, built };
  const sha = built.stdout.trim();
  const pushed = runFence(ov.push.split('{sha}').join(sha), fx);
  return { checked, built, sha, pushed };
}

const originDir = (fx) => path.join(fx.root, 'origin.git');
const originTip = (fx) => fx.run(originDir(fx), ['rev-parse', BRANCH]).trim();
const localTip = (fx) => fx.run(fx.work, ['rev-parse', BRANCH]).trim();
const isAncestor = (fx, ancestor, descendant) => spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: fx.work, env: fx.env, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS }).status === 0;

function pushUpstream(fx) {
  fx.commit(fx.other, 'upstream.txt');
  fx.run(fx.other, ['push', '-q', 'origin', BRANCH]);
}

// A reconcile-shaped commit: one file under .claude-tweaks/pipelines/, committed locally and not pushed.
function runDirCommit(fx, n) {
  const dir = path.join(fx.work, '.claude-tweaks', 'pipelines', 'archive', 'r1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'x.md'), `archive ${n}\n`);
  fx.run(fx.work, ['add', '.claude-tweaks/pipelines']);
  fx.run(fx.work, ['commit', '-q', '-m', `[reconcile] archive run r1 ${n}`]);
  return fx.run(fx.work, ['rev-parse', 'HEAD']).trim();
}

const ACCEPTED = [
  ['equal to origin', () => []],
  ['two run-dir-only commits ahead', (fx) => [runDirCommit(fx, 1), runDirCommit(fx, 2)]],
];

for (const [label, arrange] of ACCEPTED) {
  test(`accepted: ${label} passes; origin/main gains one override commit on the tip, the local branch does not move, no archive commit reaches origin`, () => {
    const fences = liveCheck();
    const ov = liveOverride();
    withFixture('release-as-anchor-', (fx) => {
      const archive = arrange(fx);
      const tipBefore = originTip(fx);
      const localBefore = localTip(fx);
      const r = runOverride(fx, fences, ov);
      assert.equal(r.checked.status, 0, `the review-tree check must pass: ${r.checked.stderr}`);
      assert.equal(r.built?.status, 0, `commit-tree must run: ${r.built?.stderr}`);
      assert.equal(r.pushed.status, 0, `the push must land: ${r.pushed.stderr}`);
      assert.equal(originTip(fx), r.sha, 'origin/main must be the override commit');
      assert.equal(fx.run(originDir(fx), ['log', '-1', '--format=%P', BRANCH]).trim(), tipBefore, 'the override\'s only parent must be the pre-run origin sha');
      assert.match(fx.run(originDir(fx), ['log', '-1', '--format=%B', BRANCH]), /^Release-As: 9\.9\.9$/m, 'the override must carry the Release-As trailer');
      assert.equal(localTip(fx), localBefore, 'the local main must not move');
      fx.run(fx.work, ['fetch', '-q', 'origin', BRANCH]);
      for (const sha of archive) assert.equal(isAncestor(fx, sha, 'origin/main'), false, `archive commit ${sha} must not be reachable from origin/main`);
      assert.doesNotMatch(fx.run(originDir(fx), ['ls-tree', '--name-only', BRANCH]), /^\.claude-tweaks$/m, 'origin must carry no .claude-tweaks entry');
    });
  });
}

test('after the override lands, the checkout with archive commits rebases onto it as the reviewed-tip comparison does and passes the review-tree check again', () => {
  const fences = liveCheck();
  const ov = liveOverride();
  withFixture('release-as-anchor-rebase-', (fx) => {
    runDirCommit(fx, 1);
    runDirCommit(fx, 2);
    const r = runOverride(fx, fences, ov);
    assert.equal(r.pushed.status, 0, `the push must land: ${r.pushed.stderr}`);
    assert.notEqual(runCheck(fences, fx).status, 0, 'before the pull the checkout is one commit behind, so the check must stop');
    fx.run(fx.work, ['pull', '--rebase', '--no-autostash', 'origin', BRANCH]);
    const again = runCheck(fences, fx);
    assert.equal(again.status, 0, `after the rebase the check must pass: ${again.stderr}`);
    assert.equal(again.tip, r.sha, 'the printed tip must be the override commit');
  });
});

const STOPPED = [
  ['behind origin', (fx) => pushUpstream(fx)],
  ['diverged: a run-dir commit plus an upstream push', (fx) => { runDirCommit(fx, 1); pushUpstream(fx); }],
  ['a commit outside run dirs', (fx) => { runDirCommit(fx, 1); fx.commit(fx.work, 'src.txt'); }],
  ['wrong branch', (fx) => fx.run(fx.work, ['switch', '-c', 'feature'])],
];

for (const [label, arrange] of STOPPED) {
  test(`stops: ${label} — the check exits non-zero, no override is built, origin/main is unchanged`, () => {
    const fences = liveCheck();
    const ov = liveOverride();
    withFixture('release-as-anchor-stop-', (fx) => {
      arrange(fx);
      const tipBefore = originTip(fx);
      const r = runOverride(fx, fences, ov);
      assert.notEqual(r.checked.status, 0, 'expected the review-tree check to exit non-zero');
      assert.equal(r.built, undefined, 'no override may be built past a failed check');
      assert.equal(originTip(fx), tipBefore, 'origin/main must not move');
    });
  });
}

// The pre-fix anchor, frozen: the HEAD-equals-origin comparison that stopped every checkout with a local commit ahead.
const OLD_ANCHOR = 'git -C "$RUN_ROOT" rev-parse HEAD origin/{branch}';
// The pre-fix override pair, frozen: a commit on HEAD, then a push of the branch.
const OLD_PAIR = [
  'git -C "$RUN_ROOT" commit --allow-empty -m "chore: release {version}" -m "Release-As: {version}"',
  'git -C "$RUN_ROOT" push origin {branch}',
];

test('go-red: the pre-fix HEAD-equals-origin anchor stops the run-dir-only-ahead row', () => {
  withFixture('release-as-anchor-old-anchor-', (fx) => {
    runDirCommit(fx, 1);
    runDirCommit(fx, 2);
    const printed = runFence(resolveNames(OLD_ANCHOR), fx);
    assert.equal(printed.status, 0, `the frozen anchor must run: ${printed.stderr}`);
    const [head, tip] = printed.stdout.trim().split('\n');
    assert.notEqual(head, tip, 'go-red: the pre-fix equality must see HEAD and origin/main differ, so this row stops under it');
  });
});

test('go-red: the pre-fix commit --allow-empty and push pair puts an archive commit on origin', () => {
  withFixture('release-as-anchor-old-pair-', (fx) => {
    const archive = [runDirCommit(fx, 1), runDirCommit(fx, 2)];
    for (const cmd of OLD_PAIR) {
      const r = runFence(resolveNames(cmd), fx);
      assert.equal(r.status, 0, `the frozen pre-fix command must run: ${cmd}\n${r.stderr}`);
    }
    fx.run(fx.work, ['fetch', '-q', 'origin', BRANCH]);
    assert.ok(archive.some((sha) => isAncestor(fx, sha, 'origin/main')), 'go-red: the pre-fix pair must land an archive commit on origin/main, so the no-archive-on-origin assertion can go red');
  });
});

// Each pattern must match exactly once in the --as block; the fact it names is missing once it is gone.
const PRESENT = [
  [/Run SKILL\.md Step 3's review-tree check, its two calls unchanged/, 'the block cites SKILL.md Step 3\'s review-tree check'],
  [/under the prefix `stopped before the override:`/, 'failures are reported under the prefix `stopped before the override:`'],
  [/without Step 3's `switch` recovery/, 'the failure path drops Step 3\'s switch recovery'],
  [/git -C "\$RUN_ROOT" commit-tree \{tip-sha\}\^\{tree\} -p \{tip-sha\} -m /, 'the commit is built with commit-tree on {tip-sha}'],
  [/with `\{tip-sha\}` as its sole parent/, 'the prose states that {tip-sha} is the sole parent'],
  [/`\^\{tree\}` is git's peel syntax, not a placeholder/, 'the prose states that ^{tree} is git\'s peel syntax'],
  [/is `failed` with nothing pushed: an empty `\{sha\}` would turn the push below into `git push origin :refs\/heads\/\{branch\}`/, 'a commit-tree failure or empty {sha} stops before the push, which would delete the branch'],
  [/git -C "\$RUN_ROOT" push origin \{sha\}:refs\/heads\/\{branch\}/, 'the push sends {sha} to refs/heads/{branch}'],
];
const ABSENT = [
  [/rev-parse HEAD origin\/\{branch\}/, 'no HEAD-equals-origin comparison', 'git -C "$RUN_ROOT" rev-parse HEAD origin/{branch}'],
  [/commit --allow-empty/, 'no commit --allow-empty', 'git -C "$RUN_ROOT" commit --allow-empty -m "x"'],
  [/status --porcelain/, 'no dirty-anchor check', 'git -C "$RUN_ROOT" status --porcelain'],
];

function violatedFacts(text) {
  return [
    ...PRESENT.filter(([p]) => !p.test(text)).map(([, fact]) => fact),
    ...ABSENT.filter(([p]) => p.test(text)).map(([, fact]) => fact),
  ];
}

test('the --as block states every fact, each present fact exactly once', () => {
  const { block } = liveOverride();
  assert.deepEqual(violatedFacts(block), []);
  for (const [pattern, fact] of PRESENT) {
    const count = (block.match(new RegExp(pattern.source, 'g')) || []).length;
    assert.equal(count, 1, `"${fact}" must match exactly once in the --as block, matched ${count}`);
  }
});

test('each --as fact can go red on its own (discrimination proof)', () => {
  const { block } = liveOverride();
  for (const [pattern, fact] of PRESENT) {
    const doctored = block.replace(pattern, '');
    assert.notEqual(doctored, block, `anchor text for "${fact}" not found — proof cannot discriminate`);
    assert.deepEqual(violatedFacts(doctored), [fact], `removing only "${fact}" must turn exactly that assertion red`);
  }
  for (const [, fact, sample] of ABSENT) {
    assert.deepEqual(violatedFacts(`${block}\n${sample}\n`), [fact], `adding only the ${fact} form must turn exactly that assertion red`);
  }
});
