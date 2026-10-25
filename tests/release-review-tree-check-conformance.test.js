// tests/release-review-tree-check-conformance.test.js — pins #4012: /release Step 3 refused to run the
// whole-branch review whenever the local branch was even one commit ahead of origin/{branch}. reconcile's
// `[reconcile] archive run …` commits land on the local branch unpushed and move only files under
// .claude-tweaks/pipelines/, which never ships, so the check now compares trees with that path excluded
// and still requires the branch to be neither behind nor diverged. The check is extracted from the live
// SKILL.md fence and executed against fixture clones of a bare origin (extract-and-run form), and the
// stop-line and marker facts around it are pinned with go-red proofs.
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
const BRANCH = 'main';

function stepThreeOf(text) {
  const start = text.indexOf('\n## Step 3');
  assert.notEqual(start, -1, 'extraction pattern is out of sync: release/SKILL.md has no "## Step 3" heading');
  const next = text.indexOf('\n## ', start + 1);
  assert.notEqual(next, -1, 'extraction pattern is out of sync: release/SKILL.md has no "## " heading after Step 3');
  return text.slice(start, next);
}

// The `bash` fence of Step 3 that carries the ahead-count check, with {branch} resolved to `main`.
function checkFence(stepThree) {
  const fences = [...stepThree.matchAll(/```bash\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const fence = fences.find((f) => f.includes('rev-list --count "HEAD..$TIP"'));
  assert.ok(fence, 'extraction pattern is out of sync: no Step 3 bash fence contains "rev-list --count \\"HEAD..$TIP\\""');
  return fence.split('{branch}').join(BRANCH);
}

// Runs body against a fresh fixture and always removes it afterwards.
function withFixture(prefix, body) {
  const fx = originWithTwoClones(prefix);
  try {
    body(fx);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// Result of the check run from `work` as $RUN_ROOT.
function runCheckResult(fence, fx) {
  return spawnSync('bash', ['-c', fence], { env: { ...fx.env, RUN_ROOT: fx.work }, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS });
}

// Exit status of the check run from `work` as $RUN_ROOT.
function runCheck(fence, fx) {
  return runCheckResult(fence, fx).status;
}

// A sibling's commit outside run dirs, its push, and this checkout's fetch, as bash clauses for the fence.
function siblingMoveClauses(fx) {
  return [
    `git -C "${fx.other}" add race.txt`,
    `git -C "${fx.other}" commit -q -m race`,
    `git -C "${fx.other}" push -q origin ${BRANCH}`,
    `git -C "$RUN_ROOT" fetch -q origin ${BRANCH}`,
  ].map((c) => ` \\\n  && ${c}`).join('');
}

// Injects the sibling move between `$TIP`'s assignment and the final clause (`echo "$TIP"` unless
// `finalClause` replaces it), so the sibling move lands inside the same bash run.
function raceFence(fence, fx, finalClause = 'echo "$TIP"') {
  const anchor = ' \\\n  && echo "$TIP"';
  assert.ok(fence.includes(anchor), 'anchor text for the final echo not found — race proof cannot inject');
  return fence.replace(anchor, () => `${siblingMoveClauses(fx)} \\\n  && ${finalClause}`);
}

// Injects the sibling move right after `$TIP` is resolved, so it lands before the tree comparisons. With
// `diffRef`, the tree diff's `"$TIP"` is replaced by that ref (go-red).
function moveAfterTipFence(fence, fx, diffRef) {
  const tipClause = `TIP=$(git -C "$RUN_ROOT" rev-parse --verify origin/${BRANCH})`;
  const diffClause = 'git -C "$RUN_ROOT" diff --quiet "$TIP" HEAD';
  assert.ok(fence.includes(tipClause), 'anchor text for the TIP assignment not found — proof cannot discriminate');
  assert.ok(fence.includes(diffClause), 'anchor text for the tree diff not found — proof cannot discriminate');
  const injected = fence.replace(tipClause, () => `${tipClause}${siblingMoveClauses(fx)}`);
  return diffRef === undefined ? injected : injected.replace(diffClause, () => `git -C "$RUN_ROOT" diff --quiet ${diffRef} HEAD`);
}

// A reconcile-shaped commit: one file under .claude-tweaks/pipelines/, committed locally and not pushed.
function runDirCommit(fx, n) {
  const dir = path.join(fx.work, '.claude-tweaks', 'pipelines', 'archive', 'r1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'x.md'), `archive ${n}\n`);
  fx.run(fx.work, ['add', '.claude-tweaks/pipelines']);
  fx.run(fx.work, ['commit', '-q', '-m', `[reconcile] archive run r1 ${n}`]);
}

// Advances origin/{BRANCH} from the other clone, so `work` falls behind it.
function pushUpstream(fx) {
  fx.commit(fx.other, 'upstream.txt');
  fx.run(fx.other, ['push', '-q', 'origin', BRANCH]);
}

// Advances origin/{BRANCH} with a run-dir-only commit (origin's own archive commit, pushed from another
// machine). The pathspec-excluded tree diff is empty here, so only the behind-count clause can stop `work`.
function pushRunDirUpstream(fx) {
  const dir = path.join(fx.other, '.claude-tweaks', 'pipelines', 'archive', 'r2');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'y.md'), 'upstream archive\n');
  fx.run(fx.other, ['add', '.claude-tweaks/pipelines']);
  fx.run(fx.other, ['commit', '-q', '-m', '[reconcile] archive run r2']);
  fx.run(fx.other, ['push', '-q', 'origin', BRANCH]);
}

const ROWS = [
  ['AC1.1: equal to origin passes', () => {}, true],
  ['AC1.1: run-dir-only commits ahead, 0 behind, passes', (fx) => { runDirCommit(fx, 1); runDirCommit(fx, 2); }, true],
  ['AC2.1: behind origin stops', (fx) => pushUpstream(fx), false],
  ['AC2.1: diverged run-dir-only stops', (fx) => { runDirCommit(fx, 1); pushUpstream(fx); }, false],
  ['AC2.1: behind origin by run-dir-only commits stops', (fx) => pushRunDirUpstream(fx), false],
  ['AC2.2: a commit outside run dirs stops', (fx) => { runDirCommit(fx, 1); fx.commit(fx.work, 'src.txt'); }, false],
  ['AC2.1: wrong branch stops', (fx) => fx.run(fx.work, ['switch', '-c', 'feature']), false],
  // origin unreachable: the fetch fails, and the check must stop rather than compare stale refs.
  ['AC2.1: a failed fetch stops', (fx) => fx.run(fx.work, ['remote', 'set-url', 'origin', path.join(fx.root, 'missing.git')]), false],
];

// One test per row, so a failing row does not hide the rest.
for (const [label, arrange, passes] of ROWS) {
  test(label, () => {
    const fence = checkFence(stepThreeOf(readText(SKILL)));
    withFixture('release-review-tree-', (fx) => {
      arrange(fx);
      const status = runCheck(fence, fx);
      if (passes) assert.equal(status, 0, `expected exit 0, got ${status}`);
      else assert.notEqual(status, 0, 'expected a non-zero exit, got 0');
    });
  });
}

test('AC1.1: a passing check prints exactly the origin/{BRANCH} sha it compared against, as its only stdout line', () => {
  const fence = checkFence(stepThreeOf(readText(SKILL)));
  withFixture('release-review-tree-tip-', (fx) => {
    const expected = fx.run(fx.work, ['rev-parse', `origin/${BRANCH}`]).trim();
    const result = runCheckResult(fence, fx);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status} (stderr: ${result.stderr})`);
    assert.equal(result.stdout, `${expected}\n`, 'stdout must be exactly the tip sha, one line');
  });
});

test('AC1.2: a sibling move between the tip resolution and the echo leaves the printed tip at the pre-move sha', () => {
  const fence = checkFence(stepThreeOf(readText(SKILL)));
  withFixture('release-review-tree-race-', (fx) => {
    const pre = fx.run(fx.work, ['rev-parse', `origin/${BRANCH}`]).trim();
    fs.writeFileSync(path.join(fx.other, 'race.txt'), 'race\n');
    const result = runCheckResult(raceFence(fence, fx), fx);
    const moved = fx.run(fx.work, ['rev-parse', `origin/${BRANCH}`]).trim();
    assert.notEqual(moved, pre, 'fixture must have moved origin/main inside the run');
    assert.equal(result.status, 0, `expected exit 0, got ${result.status} (stderr: ${result.stderr})`);
    assert.equal(result.stdout.trim(), pre, 'the check must print the sha it resolved before the sibling move');
  });
});

test('AC1.2: go-red: re-reading origin/{BRANCH} after the tree check prints the moved sha', () => {
  const fence = checkFence(stepThreeOf(readText(SKILL)));
  withFixture('release-review-tree-race-reread-', (fx) => {
    const pre = fx.run(fx.work, ['rev-parse', `origin/${BRANCH}`]).trim();
    fs.writeFileSync(path.join(fx.other, 'race.txt'), 'race\n');
    const doctored = raceFence(fence, fx, `git -C "$RUN_ROOT" rev-parse origin/${BRANCH}`);
    const result = runCheckResult(doctored, fx);
    const moved = fx.run(fx.work, ['rev-parse', `origin/${BRANCH}`]).trim();
    assert.notEqual(moved, pre, 'fixture must have moved origin/main inside the run');
    assert.equal(result.stdout.trim(), moved, 'go-red: a second rev-parse records the moved sha, not the one the tree check compared');
    assert.notEqual(result.stdout.trim(), pre);
  });
});

test('AC1.2: the tree diff compares HEAD against the resolved tip: a sibling move before the diff leaves the check passing', () => {
  const fence = checkFence(stepThreeOf(readText(SKILL)));
  withFixture('release-review-tree-diff-', (fx) => {
    const pre = fx.run(fx.work, ['rev-parse', `origin/${BRANCH}`]).trim();
    fs.writeFileSync(path.join(fx.other, 'race.txt'), 'race\n');
    const result = runCheckResult(moveAfterTipFence(fence, fx), fx);
    const moved = fx.run(fx.work, ['rev-parse', `origin/${BRANCH}`]).trim();
    assert.notEqual(moved, pre, 'fixture must have moved origin/main inside the run');
    assert.equal(result.status, 0, `expected exit 0, got ${result.status} (stderr: ${result.stderr})`);
    assert.equal(result.stdout.trim(), pre, 'the tree diff must compare HEAD against the pre-move tip, which equals HEAD');
  });
});

test('AC1.2: go-red: diffing origin/{BRANCH} instead of the resolved tip fails the same move', () => {
  const fence = checkFence(stepThreeOf(readText(SKILL)));
  withFixture('release-review-tree-diff-go-red-', (fx) => {
    fs.writeFileSync(path.join(fx.other, 'race.txt'), 'race\n');
    const doctored = moveAfterTipFence(fence, fx, `origin/${BRANCH}`);
    assert.ok(doctored.includes(`diff --quiet origin/${BRANCH} HEAD`), 'go-red anchor for the doctored tree diff not found');
    const status = runCheck(doctored, fx);
    assert.notEqual(status, 0, 'go-red: a tree diff against the moved origin/{branch} must stop the check (non-zero exit)');
  });
});

test('AC3.1: go-red: dropping the pathspec exclusion stops the run-dir-only row', () => {
  const fence = checkFence(stepThreeOf(readText(SKILL)));
  const exclusion = " -- ':!.claude-tweaks/pipelines'";
  const doctored = fence.replace(exclusion, '');
  assert.notEqual(doctored, fence, `anchor text "${exclusion.trim()}" not found — proof cannot discriminate`);
  withFixture('release-review-tree-nopath-', (fx) => {
    runDirCommit(fx, 1);
    runDirCommit(fx, 2);
    assert.notEqual(runCheck(doctored, fx), 0, 'without the pathspec exclusion the run-dir-only row must stop (non-zero exit)');
  });
});

test('AC3.1: go-red: dropping the behind-count clause passes the run-dir-only-behind row', () => {
  const fence = checkFence(stepThreeOf(readText(SKILL)));
  const countClause = `[ "$(git -C "$RUN_ROOT" rev-list --count "HEAD..$TIP")" = 0 ] \\\n  && `;
  assert.ok(fence.includes(countClause), 'anchor text for the behind-count clause not found — proof cannot discriminate');
  const doctored = fence.replace(countClause, '');
  assert.notEqual(doctored, fence, 'dropping the behind-count clause must change the fence');
  withFixture('release-review-tree-nocount-', (fx) => {
    pushRunDirUpstream(fx);
    assert.equal(runCheck(doctored, fx), 0, 'without the behind-count clause the run-dir-only-behind row must pass (exit 0)');
  });
});

// Each pattern must match exactly once in the Step 3 slice; the fact it names is missing once it is gone.
const STOP_FACTS = [
  [/review tree is not origin\/\{branch\} \(\{ahead\} ahead, \{behind\} behind\)/, 'the stop line names the ahead and behind counts'],
  [/git -C "\$RUN_ROOT" pull --rebase origin \{branch\}/, 'the recovery pulls with --rebase onto origin/{branch}'],
  [/bare .git push origin \{branch\}./, 'the recovery pushes from the main checkout with a bare git push'],
  [/rev-list --left-right --count HEAD\.\.\.origin\/\{branch\}/, 'the counts come from rev-list --left-right --count'],
  [/switch \{branch\}/, 'the wrong-branch recovery switches back to {branch}'],
  [/review tree is not origin\/\{branch\} \(on \{current\}\)/, 'the wrong-branch stop line names the current branch'],
  [/review tree is not origin\/\{branch\} \(\{ahead\} ahead, 0 behind — changes outside run dirs\)/, 'the tree-differs stop line names the changes outside run dirs'],
  [/list the files with `git -C "\$RUN_ROOT" diff --name-only origin\/\{branch\} HEAD -- ':!\.claude-tweaks\/pipelines'`/, 'the tree-differs case lists the changed files with diff --name-only'],
  [/Print no push command for this case/, 'the tree-differs case prints no push command'],
  [/the push only once `git -C "\$RUN_ROOT" diff --name-only origin\/\{branch\} HEAD -- ':!\.claude-tweaks\/pipelines'` prints nothing after the rebase/, 'the behind case pushes only when nothing outside run dirs is ahead after the rebase'],
  [/A failed fetch, or any other git error the check prints to stderr[\s\S]{0,80}reports that stderr verbatim/, 'a failed fetch or other git error reports git stderr verbatim, not the counts line'],
];

// The tree-differs bullet itself, from its stop line to the end of that list item.
function treeDiffersBullet(stepThree) {
  const m = stepThree.match(/^- Nothing behind[^\n]*$/m);
  if (!m) throw new Error('extraction pattern is out of sync: no "- Nothing behind" bullet in Step 3');
  return m[0];
}

function missingStopFacts(text) {
  return STOP_FACTS.filter(([pattern]) => !pattern.test(text)).map(([, fact]) => fact);
}

test('AC2.3/AC3.1: stop line names counts and recovery commands', () => {
  const stepThree = stepThreeOf(readText(SKILL));
  assert.deepEqual(missingStopFacts(stepThree), [], 'Step 3 must state every stop-line fact');
  for (const [pattern, fact] of STOP_FACTS) {
    const count = (stepThree.match(new RegExp(pattern.source, 'g')) || []).length;
    assert.equal(count, 1, `"${fact}" must match exactly once in the Step 3 slice, matched ${count}`);
  }
});

test('AC2.3/AC3.1: each stop-line fact can actually go red on its own (discrimination proof)', () => {
  const stepThree = stepThreeOf(readText(SKILL));
  for (const [pattern, fact] of STOP_FACTS) {
    const doctored = stepThree.replace(pattern, '');
    assert.notEqual(doctored, stepThree, `anchor text for "${fact}" not found — proof cannot discriminate`);
    assert.deepEqual(missingStopFacts(doctored), [fact], `removing only "${fact}" must turn exactly that assertion red`);
  }
});

test('AC2.3: the tree-differs recovery carries no push command', () => {
  const bullet = treeDiffersBullet(stepThreeOf(readText(SKILL)));
  assert.doesNotMatch(bullet, /git push/, 'the changes-outside-run-dirs recovery must not tell anyone to push them');
  const doctored = bullet.replace('Print no push command for this case.', 'Then publish them with a bare `git push origin {branch}`.');
  assert.notEqual(doctored, bullet, 'go-red anchor "Print no push command for this case." not found');
  assert.match(doctored, /git push/, 'go-red: a push added to the bullet must be visible to the assertion');
});

test('marker line keeps {k} and adds the two-sha clause', () => {
  const stepThree = stepThreeOf(readText(SKILL));
  assert.ok(
    stepThree.includes('## /review marker: {k} existing lines{; review tree HEAD {head-sha} is origin/{branch} {tip-sha} plus run-dir-only commits}. Reversibility: n/a (marker).'),
    'Step 3 marker line must keep "## /review marker: {k} existing lines" and add the optional "{; review tree HEAD {head-sha} is origin/{branch} {tip-sha} plus run-dir-only commits}" clause',
  );
});
