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

// The Step 3 `bash` fence containing `needle`, with {branch} resolved to `main`.
function stepThreeFence(stepThree, needle) {
  const fences = [...stepThree.matchAll(/```bash\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const fence = fences.find((f) => f.includes(needle));
  assert.ok(fence, `extraction pattern is out of sync: no Step 3 bash fence contains "${needle}"`);
  return fence.split('{branch}').join(BRANCH);
}

// The check's first call: fetch, then resolve origin/{branch} once and print it.
function tipFence(stepThree) {
  return stepThreeFence(stepThree, 'rev-parse --verify origin/{branch}');
}

// The check's second call: the tree check, {tip-sha} left as a placeholder for the printed sha.
function checkFence(stepThree) {
  return stepThreeFence(stepThree, 'rev-list --count HEAD..{tip-sha}');
}

// Both calls of the live Step 3 check.
function liveCheck() {
  const stepThree = stepThreeOf(readText(SKILL));
  return { tip: tipFence(stepThree), check: checkFence(stepThree) };
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

// Result of one fence run from `work` as $RUN_ROOT.
function runFence(fence, fx) {
  return spawnSync('bash', ['-c', fence], { env: { ...fx.env, RUN_ROOT: fx.work }, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS });
}

// Runs the check's two calls the way Step 3 does: the tip fence, then the tree check with the printed sha
// pasted in for {tip-sha}. `between` runs after the first call (a sibling's move landing between the two).
// Returns the failing call's result, or the tree check's, plus the printed tip.
function runCheckResult({ tip, check }, fx, between) {
  const first = runFence(tip, fx);
  if (first.status !== 0) return { ...first, tip: null };
  const printed = first.stdout.trim();
  if (between) between(fx);
  return { ...runFence(check.split('{tip-sha}').join(printed), fx), tip: printed, tipStdout: first.stdout };
}

// Exit status of the two-call check.
function runCheck(fences, fx, between) {
  return runCheckResult(fences, fx, between).status;
}

// The sha `work` currently has for origin/{BRANCH}.
function originSha(fx) {
  return fx.run(fx.work, ['rev-parse', `origin/${BRANCH}`]).trim();
}

// A sibling's commit outside run dirs, its push, and this checkout's fetch: origin/{BRANCH} moves under `work`.
function siblingMove(fx) {
  fx.commit(fx.other, 'race.txt');
  fx.run(fx.other, ['push', '-q', 'origin', BRANCH]);
  fx.run(fx.work, ['fetch', '-q', 'origin', BRANCH]);
}

// The tree check with `clause`'s {tip-sha} replaced by `ref` (go-red: that clause re-reads the ref).
function rereadClause(check, clause, ref) {
  assert.ok(check.includes(clause), `anchor text "${clause}" not found — proof cannot discriminate`);
  return check.replace(clause, () => clause.split('{tip-sha}').join(ref));
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
    const fences = liveCheck();
    withFixture('release-review-tree-', (fx) => {
      arrange(fx);
      const status = runCheck(fences, fx);
      if (passes) assert.equal(status, 0, `expected exit 0, got ${status}`);
      else assert.notEqual(status, 0, 'expected a non-zero exit, got 0');
    });
  });
}

test('AC1.1: the first call prints exactly the origin/{BRANCH} sha, as its only stdout line, and the tree check passes on it', () => {
  const fences = liveCheck();
  withFixture('release-review-tree-tip-', (fx) => {
    const expected = originSha(fx);
    const result = runCheckResult(fences, fx);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status} (stderr: ${result.stderr})`);
    assert.equal(result.tipStdout, `${expected}\n`, 'the first call\'s stdout must be exactly the tip sha, one line');
  });
});

test('AC1.2: the tree check reads only the printed sha, never origin/{BRANCH}', () => {
  const { check } = liveCheck();
  assert.ok(check.includes('{tip-sha}'), 'the tree check must compare against the pasted {tip-sha}');
  assert.doesNotMatch(check, /origin\//, 'the tree check must not read origin/{branch}: a sibling fetch would move it under the check');
  // Go-red: a clause re-reading the ref is caught.
  const doctored = rereadClause(check, 'diff --quiet {tip-sha} HEAD', `origin/${BRANCH}`);
  assert.match(doctored, /origin\//, 'go-red: a re-read of origin/{branch} must be visible to the assertion');
});

test('AC1.2: a sibling move between the two calls leaves the check passing and the recorded tip at the pre-move sha', () => {
  const fences = liveCheck();
  withFixture('release-review-tree-race-', (fx) => {
    const pre = originSha(fx);
    const result = runCheckResult(fences, fx, siblingMove);
    const moved = originSha(fx);
    assert.notEqual(moved, pre, 'fixture must have moved origin/main between the calls');
    assert.equal(result.status, 0, `expected exit 0, got ${result.status} (stderr: ${result.stderr})`);
    assert.equal(result.tip, pre, 'the recorded tip must be the sha the tree check compared HEAD against, resolved before the move');
  });
});

// Each clause that compares against the tip is its own pin: re-reading origin/{BRANCH} in either one alone
// turns the same move into a stop.
for (const [label, clause] of [
  ['the behind count', 'rev-list --count HEAD..{tip-sha}'],
  ['the tree diff', 'diff --quiet {tip-sha} HEAD'],
]) {
  test(`AC1.2: go-red: ${label} re-reading origin/{BRANCH} instead of the printed sha fails the same move`, () => {
    const fences = liveCheck();
    const doctored = { ...fences, check: rereadClause(fences.check, clause, `origin/${BRANCH}`) };
    withFixture('release-review-tree-race-go-red-', (fx) => {
      assert.notEqual(runCheck(doctored, fx, siblingMove), 0, `go-red: ${label} against the moved origin/{branch} must stop the check (non-zero exit)`);
    });
  });
}

test('AC3.1: go-red: dropping the pathspec exclusion stops the run-dir-only row', () => {
  const fences = liveCheck();
  const exclusion = " -- ':!.claude-tweaks/pipelines'";
  const doctored = { ...fences, check: fences.check.replace(exclusion, '') };
  assert.notEqual(doctored.check, fences.check, `anchor text "${exclusion.trim()}" not found — proof cannot discriminate`);
  withFixture('release-review-tree-nopath-', (fx) => {
    runDirCommit(fx, 1);
    runDirCommit(fx, 2);
    assert.notEqual(runCheck(doctored, fx), 0, 'without the pathspec exclusion the run-dir-only row must stop (non-zero exit)');
  });
});

test('AC3.1: go-red: dropping the behind-count clause passes the run-dir-only-behind row', () => {
  const fences = liveCheck();
  const countClause = `git -C "$RUN_ROOT" rev-list --count HEAD..{tip-sha} | grep -qx 0 \\\n  && `;
  assert.ok(fences.check.includes(countClause), 'anchor text for the behind-count clause not found — proof cannot discriminate');
  const doctored = { ...fences, check: fences.check.replace(countClause, '') };
  assert.notEqual(doctored.check, fences.check, 'dropping the behind-count clause must change the fence');
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
