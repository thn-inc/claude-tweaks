// tests/release-reviewed-tip-conformance.test.js — pins #4041: /release Step 5 merged whatever
// origin/{branch} held at merge time, so a commit that landed after Step 3's whole-branch review shipped
// unreviewed. Step 3 now records the reviewed tip in its marker line, and Step 5 compares origin/{branch}
// with it immediately before the merge, runs a delta review per move, and holds the release once the
// integration branch has moved more than the `release-tip-moves` policy key allows. This suite pins the
// key's schema row, then extracts the comparison from the live execute.md fence and executes it against
// fixture clones of a bare origin (extract-and-run form), and pins the prose around it with go-red proofs.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');
const { readText } = require('./helpers/read-skill');
const { originWithTwoClones, FIXTURE_TIMEOUT_MS } = require('./helpers/git-fixtures');

const ROOT = path.join(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'plugin', 'skills', 'release');
const SKILL = path.join(RELEASE_DIR, 'SKILL.md');
const EXECUTE = path.join(RELEASE_DIR, 'execute.md');
const CONSOLE = path.join(RELEASE_DIR, 'console.md');
const BOOKKEEPING = path.join(RELEASE_DIR, 'bookkeeping.md');
const POLICY_SCHEMA_DOC = path.join(ROOT, 'plugin', 'skills', '_shared', 'policy-schema.md');
const BRANCH = 'main';

test('release-tip-moves is an advanced merge-safety integer defaulting to 2', () => {
  const row = POLICY_KEYS.find((r) => r.key === 'release-tip-moves');
  assert.ok(row, 'release-tip-moves missing from POLICY_KEYS');
  assert.equal(row.type, 'integer');
  assert.equal(row.default, 2);
  assert.equal(row.min, 0, '0 means "hold on the first move", so the floor is 0, not unset');
  assert.equal(row.category, 'merge-safety');
  assert.equal(row.tier, 'advanced');
});

// The `bash` fence of execute.md that compares origin/{branch} with the reviewed tip, with {branch}
// resolved to `main` and {reviewed-tip} to the given sha.
function comparisonFence(executeText, reviewedTip) {
  const fences = [...executeText.matchAll(/```bash\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const fence = fences.find((f) => f.includes('rev-parse origin/{branch})" = "{reviewed-tip}"'));
  assert.ok(fence, 'extraction pattern is out of sync: no execute.md bash fence contains \'rev-parse origin/{branch})" = "{reviewed-tip}"\'');
  return fence.split('{branch}').join(BRANCH).split('{reviewed-tip}').join(reviewedTip);
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

// The reviewed tip: what origin/main is in `work` after Step 3's fetch.
function reviewedTipOf(fx) {
  fx.run(fx.work, ['fetch', '-q', 'origin', BRANCH]);
  return fx.run(fx.work, ['rev-parse', `origin/${BRANCH}`]).trim();
}

// Status and stderr of the comparison run from `work` as $RUN_ROOT.
function runComparison(fence, fx) {
  const result = spawnSync('bash', ['-c', fence], { env: { ...fx.env, RUN_ROOT: fx.work }, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS });
  return { status: result.status, stderr: result.stderr };
}

// Advances origin/{BRANCH} from the other clone, after the reviewed tip was read.
function pushUpstream(fx) {
  fx.commit(fx.other, 'upstream.txt');
  fx.run(fx.other, ['push', '-q', 'origin', BRANCH]);
}

// Advances origin/{BRANCH} with a run-dir-only commit. Any move counts: only a review can clear it.
function pushRunDirUpstream(fx) {
  const dir = path.join(fx.other, '.claude-tweaks', 'pipelines', 'archive', 'r2');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'y.md'), 'upstream archive\n');
  fx.run(fx.other, ['add', '.claude-tweaks/pipelines']);
  fx.run(fx.other, ['commit', '-q', '-m', '[reconcile] archive run r2']);
  fx.run(fx.other, ['push', '-q', 'origin', BRANCH]);
}

test('AC1.1: an unmoved origin/{branch} exits 0', () => {
  withFixture('release-reviewed-tip-', (fx) => {
    const tip = reviewedTipOf(fx);
    const { status, stderr } = runComparison(comparisonFence(readText(EXECUTE), tip), fx);
    assert.equal(status, 0, `expected exit 0, got ${status} (stderr: ${stderr})`);
  });
});

test('AC1.1: a moved origin/{branch} exits non-zero with empty stderr', () => {
  withFixture('release-reviewed-tip-', (fx) => {
    const tip = reviewedTipOf(fx);
    pushUpstream(fx);
    const { status, stderr } = runComparison(comparisonFence(readText(EXECUTE), tip), fx);
    assert.notEqual(status, 0, 'expected a non-zero exit, got 0');
    assert.equal(stderr, '', 'a move is a silent non-zero: stderr is reserved for a comparison that could not run');
  });
});

test('AC1.1: a run-dir-only commit on origin/{branch} still counts as a move', () => {
  withFixture('release-reviewed-tip-', (fx) => {
    const tip = reviewedTipOf(fx);
    pushRunDirUpstream(fx);
    const { status } = runComparison(comparisonFence(readText(EXECUTE), tip), fx);
    assert.notEqual(status, 0, 'any move counts, run-dir-only included: expected a non-zero exit, got 0');
  });
});

test('AC1.1: a failed fetch exits non-zero with non-empty stderr', () => {
  withFixture('release-reviewed-tip-', (fx) => {
    const tip = reviewedTipOf(fx);
    fx.run(fx.work, ['remote', 'set-url', 'origin', path.join(fx.root, 'missing.git')]);
    const { status, stderr } = runComparison(comparisonFence(readText(EXECUTE), tip), fx);
    assert.notEqual(status, 0, 'a comparison that could not run must not read as unmoved');
    assert.notEqual(stderr, '', 'a failed fetch must leave its own error on stderr for the report');
  });
});

test('AC1.2: go-red: dropping the compare clause lets the moved row exit 0', () => {
  withFixture('release-reviewed-tip-nocompare-', (fx) => {
    const tip = reviewedTipOf(fx);
    const fence = comparisonFence(readText(EXECUTE), tip);
    const clause = ` \\\n  && [ "$(git -C "$RUN_ROOT" rev-parse origin/${BRANCH})" = "${tip}" ]`;
    assert.ok(fence.includes(clause), 'anchor text for the compare clause not found — proof cannot discriminate');
    const doctored = fence.replace(clause, '');
    assert.notEqual(doctored, fence, 'dropping the compare clause must change the fence');
    pushUpstream(fx);
    assert.notEqual(runComparison(fence, fx).status, 0, 'the real fence must stop on a move');
    assert.equal(runComparison(doctored, fx).status, 0, 'without the compare clause the moved row must pass (exit 0)');
  });
});

test('AC1.2: go-red: dropping the fetch compares a stale ref, so the moved row exits 0', () => {
  const stopsOnMove = (mutate) => {
    let status;
    withFixture('release-reviewed-tip-nofetch-', (fx) => {
      const tip = reviewedTipOf(fx);
      const fence = mutate(comparisonFence(readText(EXECUTE), tip));
      pushUpstream(fx);
      status = runComparison(fence, fx).status;
    });
    return status;
  };
  const fetchClause = `git -C "$RUN_ROOT" fetch --quiet origin ${BRANCH} \\\n  && `;
  const real = comparisonFence(readText(EXECUTE), 'x');
  assert.ok(real.includes(fetchClause), 'anchor text for the fetch clause not found — proof cannot discriminate');
  assert.notEqual(stopsOnMove((f) => f), 0, 'the real fence must stop on a move');
  assert.equal(stopsOnMove((f) => f.replace(fetchClause, '')), 0, 'without the fetch the moved row compares a stale origin/{branch} and passes (exit 0)');
});

test('go-red: without --quiet a move leaves fetch output on stderr, so it would read as a git error', () => {
  const moveStderr = (mutate) => {
    let stderr;
    withFixture('release-reviewed-tip-quiet-', (fx) => {
      const tip = reviewedTipOf(fx);
      const fence = mutate(comparisonFence(readText(EXECUTE), tip));
      pushUpstream(fx);
      stderr = runComparison(fence, fx).stderr;
    });
    return stderr;
  };
  const real = comparisonFence(readText(EXECUTE), 'x');
  assert.ok(real.includes(' --quiet'), 'anchor text " --quiet" not found — proof cannot discriminate');
  assert.equal(moveStderr((f) => f), '', 'the real fence keeps a move silent');
  assert.notEqual(moveStderr((f) => f.replace(' --quiet', '')), '', 'without --quiet the moved row must leave the ref-update summary on stderr');
});

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DELTA_MARKER = 'AUTO {HH:MM:SS} — Step 5: origin/{branch} moved {reviewed-short} → {tip-short} ({n} commits) before the merge — move {m} of {bound}; delta review starting, base {reviewed-tip}..{branch} at reviewed tip {tip-sha}; ## /review marker: {k} existing lines. Reversibility: n/a (marker).';

// The new block of execute.md, from its heading to the Merge heading.
function blockOf(executeText) {
  const start = executeText.indexOf('**Reviewed-tip comparison');
  assert.notEqual(start, -1, 'extraction pattern is out of sync: execute.md has no "**Reviewed-tip comparison" block');
  const end = executeText.indexOf('**Merge.**', start);
  assert.notEqual(end, -1, 'extraction pattern is out of sync: execute.md has no "**Merge.**" paragraph after the block');
  return executeText.slice(start, end);
}

// [label, source, pattern]: each pattern must match exactly once in its source. `block` is the new
// execute.md block, `execute` the whole file, `skill` and `console` the whole files.
const FACTS = [
  ['skill', 'the Step 3 marker carries the unbraced `at reviewed tip {tip-sha};` and keeps the optional review-tree clause',
    /whole-branch review starting, base \{base\}\.\.\{branch\} at reviewed tip \{tip-sha\}; ## \/review marker: \{k\} existing lines\{; review tree HEAD \{head-sha\} is origin\/\{branch\} \{tip-sha\} plus run-dir-only commits\}\. Reversibility: n\/a \(marker\)\./],
  ['skill', '{tip-sha} is rev-parse origin/{branch}, read after the check passes',
    /`\{tip-sha\}` is the full 40-hex `git -C "\$RUN_ROOT" rev-parse origin\/\{branch\}`, read right after the check above passes/],
  ['skill', 'Step 8 HELD names `integration branch kept moving`',
    /and `integration branch kept moving`, where/],
  ['console', 'console.md names the reviewed-tip comparison among the HELD stops',
    /the reviewed-tip comparison's two stops/],
  ['execute', 'the --as path advances the reviewed tip to the Release-As commit only when its parent is the reviewed tip',
    /the reviewed tip advances to the `Release-As:` commit only when `\{sha\}\^` equals the reviewed tip/],
  ['execute', 'the --as advance is logged',
    /Step 5: reviewed tip advanced to this run's Release-As commit \{short\} \(parent is the reviewed tip\); at reviewed tip \{sha\}\. Reversibility: n\/a\./],
  ['block', 'the comparison reads the last recorded reviewed tip, never re-derived',
    /Read `\{reviewed-tip\}` from the last line[^\n]*`decisions\.md`[^\n]*`at reviewed tip`[^\n]*never re-derived/],
  ['block', 'no recorded tip is `failed`, reason `no reviewed tip recorded`',
    /`failed`, reason `no reviewed tip recorded`/],
  ['block', 'a failed fetch is `failed`, stderr verbatim',
    /a failed fetch[^\n]*`failed`[^\n]*stderr[^\n]*verbatim/],
  ['block', 'an unmoved branch is logged and merges',
    /Step 5: origin\/\{branch\} still at reviewed tip \{short\}; merging\./],
  ['block', 'the move count is the number of lines carrying the delta marker\'s `origin/{branch} moved {reviewed-short} →` form',
    /the number of lines in the `## \/release` block[^\n]*that carry `origin\/\{branch\} moved \{reviewed-short\} →`/],
  ['block', '`release-tip-moves` is read with resolve-policy.js --values',
    /resolve-policy\.js" --run "\{run-dir\}" --values release-tip-moves/],
  ['block', 'past the bound the run is `HELD`, reason `integration branch kept moving`',
    /`HELD`, reason `integration branch kept moving`/],
  ['block', 'the bound stop stages release-held.md through stage-item.js',
    /stage-item\.js" --run "\{run-dir\}" --id release-held --file/],
  ['block', 'the bound stop lists the arrived commits with git log --first-parent --oneline',
    /git -C "\$RUN_ROOT" log --first-parent --oneline \{step3-tip\}\.\.origin\/\{branch\}/],
  ['block', 'the bound stop suggests holding merges',
    /suggest[^\n]*holding merges/],
  ['block', 'the delta brings $RUN_ROOT to the tip with pull --rebase --no-autostash',
    /git -C "\$RUN_ROOT" pull --rebase --no-autostash origin \{branch\}/],
  ['block', 'the branch is asserted before the pull: anything but {branch} is `failed` with Step 3\'s wrong-branch stop line, nothing pulled',
    /First assert the anchor is still on the integration branch: `git -C "\$RUN_ROOT" rev-parse --abbrev-ref HEAD` must equal `\{branch\}`\. Anything else is `failed`[^\n]*Step 3's wrong-branch stop line[^\n]*nothing is pulled/],
  ['block', 'the delta re-runs Step 3\'s review-tree check and a failure is `failed` with Step 3\'s stop lines',
    /re-run SKILL\.md Step 3's review-tree check[^\n]*`failed`[^\n]*Step 3's stop lines/],
  ['block', 'the new tip\'s test gate is the review\'s own Step 1.5',
    /the review's own Step 1\.5/],
  ['block', 'the delta marker line',
    new RegExp(escapeRe(DELTA_MARKER))],
  ['block', 'the delta invokes review base:{reviewed-tip} and classifies only the lines after its marker by Step 3\'s table',
    /`\/claude-tweaks:review base:\{reviewed-tip\}`[^\n]*classify only the lines[^\n]*Step 3's[^\n]*table/],
  ['block', 'a review that did not complete is a stop, not a pass',
    /`failed`, reason `delta review did not complete`/],
  ['block', 'a `review: blocking` delta routes to console.md\'s gate (unchanged rules) and then `HELD`',
    /`review: blocking`[^\n]*console\.md[^\n]*`--allow-blocking`[^\n]*`--train`[^\n]*`HELD`/],
  ['block', 'a clean or findings delta re-enters at the PR-check gate',
    /`review: clean` or `review: findings[^\n]*re-enter at the PR-check gate/],
  ['block', 'the remaining window is the merge call itself',
    /the remaining window is the merge call itself/],
  ['block', 'the bound step ties {bound} to the resolved RELEASE_TIP_MOVES',
    /`\{bound\}` in this block's log lines is the resolved `RELEASE_TIP_MOVES`/],
  ['block', 'an unreadable release-tip-moves fails closed as `failed`, reason `release-tip-moves unreadable`',
    /exits non-zero or prints nothing[^\n]*fail closed[^\n]*`failed`, reason `release-tip-moves unreadable`, nothing merged/],
  ['block', 'Step 8\'s HELD summary prints the arrived-commit list for the bound stop',
    /Step 8's HELD summary also prints that `git log` output, the arrived commits, under its gate-and-staged-path line/],
  ['skill', 'SKILL.md Step 8 prints the arrived-commit list beneath the HELD staged-path line',
    /For `integration branch kept moving`, the list of arrived commits \(`execute\.md`'s bound step\) prints beneath that line/],
  ['block', 'every release-held.md the block composes carries the --as warning (the Release-As commit is already on {branch})',
    /Every `release-held\.md` this block composes carries one more line when `--as` was given: the `Release-As:` commit is already on `\{branch\}`, so re-run without pushing a second override/],
  ['block', 'a run-dir-only move gets its own step 3a',
    /\*\*3a\. A run-dir-only move does not count\.\*\*/],
  ['block', 'the run-dir-only check is a tree diff outside .claude-tweaks/pipelines',
    /diff --quiet \{reviewed-tip\} origin\/\{branch\} -- ':!\.claude-tweaks\/pipelines'/],
  ['block', 'a run-dir-only move is not counted, runs no review, advances the reviewed tip and re-compares',
    /Exit `0` — every arrived commit is run-dir-only: do not count it toward the bound and run no review\. Advance the reviewed tip instead[^\n]*go back to 1 and compare again/],
  ['block', 'the run-dir-only advance line carries `at reviewed tip {tip-sha}` and is not a counted move line',
    /by run-dir-only commits \(\{n\} commits, nothing outside \.claude-tweaks\/pipelines\); no review, not counted; at reviewed tip \{tip-sha\}\./],
  ['block', 'the re-entry derives a bump part from the arrived commits',
    /On that re-entry, derive the bump part from the arrived commits too/],
  ['block', 'the arrived commits are read as `git log --format=%B {reviewed-tip}..{tip-sha}`',
    /git -C "\$RUN_ROOT" log --format=%B \{reviewed-tip\}\.\.\{tip-sha\}/],
  ['block', 'the arrived part: `!` or a BREAKING CHANGE footer is major, feat minor, anything else patch',
    /a `!` after a subject's type, or a `BREAKING CHANGE:` footer, is major; `feat` is minor; anything else is patch/],
  ['block', 'delta 5 re-gates on the higher of the arrived part and the title\'s part',
    /Delta 5 re-gates on the higher of that part and the title's part/],
  ['block', 'a major from the arrived commits takes delta 5\'s HELD path with a reason naming the arrived commits',
    /takes delta 5's `re-rendered to a major after the console` HELD path, with the reason named `re-rendered to a major after the console — from the arrived commits \{shas\}, the release PR title still reads v\{title-version\}`/],
  ['skill', 'SKILL.md Step 5 summary mentions the reviewed-tip comparison',
    /it also compares `origin\/\{branch\}` with the tip Step 3 reviewed: a move runs a delta review, and more moves than `release-tip-moves` allows is `HELD`/],
  ['skill', 'SKILL.md Step 8 says the blocking delta re-fires the existing `review: blocking` gate',
    /re-fires the existing `review: blocking` gate on the delta range/],
  ['skill', 'SKILL.md Step 8 `failed` names an unreadable release-tip-moves',
    /an unreadable `release-tip-moves`/],
  ['console', 'console.md says the merge never happens (not that Step 5 never runs) under HELD',
    /The merge never happens and Step 8's summary reads `HELD`\./],
  ['bookkeeping', 'bookkeeping.md defines the HELD no-Step-6/7 rule over every no-merge stop',
    /or one of Step 5's stops that merge nothing/],
  ['schemaDoc', 'the policy-schema.md row states the 0 floor',
    /Floor `0`: it holds on the first move\./],
];

function sources() {
  const execute = readText(EXECUTE);
  return { skill: readText(SKILL), console: readText(CONSOLE), bookkeeping: readText(BOOKKEEPING), schemaDoc: readText(POLICY_SCHEMA_DOC), execute, block: blockOf(execute) };
}

function missingFacts(srcs) {
  return FACTS.filter(([source, , pattern]) => !pattern.test(srcs[source])).map(([, fact]) => fact);
}

test('AC2.1/AC3.1: every reviewed-tip prose fact is present exactly once', () => {
  const srcs = sources();
  assert.deepEqual(missingFacts(srcs), [], 'release prose must state every reviewed-tip fact');
  for (const [source, fact, pattern] of FACTS) {
    const count = (srcs[source].match(new RegExp(pattern.source, 'g')) || []).length;
    assert.equal(count, 1, `"${fact}" must match exactly once in ${source}, matched ${count}`);
  }
});

test('AC2.1/AC3.1: each reviewed-tip prose fact can actually go red on its own (discrimination proof)', () => {
  const srcs = sources();
  for (const [source, fact, pattern] of FACTS) {
    const doctored = srcs[source].replace(pattern, '');
    assert.notEqual(doctored, srcs[source], `anchor text for "${fact}" not found — proof cannot discriminate`);
    assert.ok(!pattern.test(doctored), `removing "${fact}" must turn its own assertion red`);
  }
});

// Phrases that claimed the gh-absent stop was the only, or the third, non-Step-4 HELD reason, or that HELD
// is a Step-4-only word. Once delta 5's major re-render and the reviewed-tip stops exist, they are false.
const STALE_HELD_PHRASES = [
  ['execute', 'the one `HELD` that is not a Step 4 HARD-GATE'],
  ['execute', 'names it as the third reason for the word'],
  ['skill', 'A third reason carries the same word'],
  ['skill', 'A fourth, `integration branch kept moving`'],
  ['skill', 'beside those two HARD-GATEs'],
  ['console', 'the only other `HELD` reason'],
  ['console', 'Step 5 never runs and Step 8\'s summary reads'],
  ['bookkeeping', 'A HARD-GATE fires at Step 4, before Step 5 ever runs'],
];

function staleHeldPhrases(srcs) {
  return STALE_HELD_PHRASES.filter(([source, phrase]) => srcs[source].includes(phrase)).map(([, phrase]) => phrase);
}

test('no stale ordinal or "the one HELD" claim survives in execute.md, SKILL.md, console.md or bookkeeping.md', () => {
  const srcs = sources();
  assert.deepEqual(staleHeldPhrases(srcs), [], 'a stale HELD-reason phrase is still present');
  for (const [source, phrase] of STALE_HELD_PHRASES) {
    const reintroduced = { ...srcs, [source]: `${srcs[source]}\n${phrase}\n` };
    assert.deepEqual(staleHeldPhrases(reintroduced), [phrase], `go-red: re-adding "${phrase}" must be caught by the check`);
  }
});

// The four Step 5 stops that merge nothing, as Step 8's HELD bullet must name them.
const STEP5_HELD_REASONS = [
  ['gh-absent Transport stop', /pr-first with no `gh` on `PATH`/],
  ['delta 5 major re-render', /delta 5's re-render to a major/],
  ['blocking delta review', /a `review: blocking` delta review/],
  ['integration branch kept moving', /`integration branch kept moving`/],
];

function missingHeldReasons(bullet) {
  return STEP5_HELD_REASONS.filter(([, pattern]) => !pattern.test(bullet)).map(([reason]) => reason);
}

test('SKILL.md Step 8 HELD bullet names every Step 5 HELD stop', () => {
  const m = readText(SKILL).match(/^- \*\*`HELD`\*\*[^\n]*$/m);
  assert.ok(m, 'extraction pattern is out of sync: no "- **`HELD`**" bullet in SKILL.md');
  const bullet = m[0];
  assert.deepEqual(missingHeldReasons(bullet), [], 'the HELD bullet must name all four Step 5 stops');
  for (const [reason, pattern] of STEP5_HELD_REASONS) {
    const doctored = bullet.replace(pattern, '');
    assert.notEqual(doctored, bullet, `anchor text for "${reason}" not found — proof cannot discriminate`);
    assert.deepEqual(missingHeldReasons(doctored), [reason], `removing only "${reason}" must turn exactly that assertion red`);
  }
});

test('the Step 3 marker stays one line and its tip clause matches the sibling pin', () => {
  const lines = readText(SKILL).split('\n').filter((l) => l.includes('whole-branch review starting'));
  assert.equal(lines.length, 1, 'the Step 3 marker must be exactly one line');
  assert.ok(
    lines[0].includes('{; review tree HEAD {head-sha} is origin/{branch} {tip-sha} plus run-dir-only commits}'),
    'the marker line must keep the optional review-tree clause #4012 pins',
  );
});

test('placement: the comparison block sits after delta 5 and before Merge', () => {
  const text = readText(EXECUTE);
  const delta5 = text.indexOf('re-rendered to a major after the console');
  const block = text.indexOf('**Reviewed-tip comparison');
  const merge = text.indexOf('**Merge.**');
  assert.ok(delta5 !== -1 && block !== -1 && merge !== -1, 'placement anchors missing');
  assert.ok(delta5 < block, 'the comparison block must come after delta 5');
  assert.ok(block < merge, 'the comparison block must come before the Merge paragraph');
});

// The `bash` fence of execute.md that compares the trees outside run dirs, resolved like comparisonFence.
function runDirOnlyFence(executeText, reviewedTip) {
  const fences = [...executeText.matchAll(/```bash\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const fence = fences.find((f) => f.includes('diff --quiet {reviewed-tip} origin/{branch}'));
  assert.ok(fence, 'extraction pattern is out of sync: no execute.md bash fence contains \'diff --quiet {reviewed-tip} origin/{branch}\'');
  return fence.split('{branch}').join(BRANCH).split('{reviewed-tip}').join(reviewedTip);
}

// Status of the run-dir-only check once the upstream moved: 0 means every arrived commit is run-dir-only.
function runDirOnlyStatus(fx, fence) {
  fx.run(fx.work, ['fetch', '-q', 'origin', BRANCH]);
  return runComparison(fence, fx).status;
}

test('3a: a run-dir-only move exits 0 and a move touching code exits 1', () => {
  for (const [name, push, expected] of [['run-dir-only', pushRunDirUpstream, 0], ['code', pushUpstream, 1]]) {
    withFixture('release-reviewed-tip-rundir-', (fx) => {
      const tip = reviewedTipOf(fx);
      push(fx);
      const status = runDirOnlyStatus(fx, runDirOnlyFence(readText(EXECUTE), tip));
      assert.equal(status, expected, `${name} move: expected exit ${expected}, got ${status}`);
    });
  }
});

test('3a: go-red: without the run-dir pathspec a run-dir-only move reads as a code move', () => {
  withFixture('release-reviewed-tip-rundir-nopath-', (fx) => {
    const tip = reviewedTipOf(fx);
    const fence = runDirOnlyFence(readText(EXECUTE), tip);
    const pathspec = " -- ':!.claude-tweaks/pipelines'";
    assert.ok(fence.includes(pathspec), 'anchor text for the pathspec not found — proof cannot discriminate');
    pushRunDirUpstream(fx);
    assert.equal(runDirOnlyStatus(fx, fence), 0, 'the real fence must call a run-dir-only move run-dir-only');
    assert.equal(runDirOnlyStatus(fx, fence.replace(pathspec, '')), 1, 'without the pathspec the same move must exit 1');
  });
});

// The log-line templates in the block that carry the literal the bound step says to count, so a log line
// that drifts into the move count turns this red.
function countedMoveLines(block) {
  const literal = block.match(/that carry `(origin\/\{branch\} moved \{reviewed-short\} →)`/);
  assert.ok(literal, 'extraction pattern is out of sync: the bound step names no counted literal');
  return block.split('\n').filter((l) => /^(AUTO|STAGED) \{HH:MM:SS\}/.test(l) && l.includes(literal[1]));
}

test('move count: only the delta marker carries the counted literal', () => {
  const block = blockOf(readText(EXECUTE));
  const counted = countedMoveLines(block);
  assert.equal(counted.length, 1, `exactly one log line may carry the counted literal, found ${counted.length}`);
  assert.ok(counted[0].includes('delta review starting'), 'the one counted line must be the delta marker');
  for (const [name, from] of [
    ['terminal STAGED line', 'origin/{branch} moved past the reviewed tip'],
    ['run-dir-only advance line', 'origin/{branch} advanced {reviewed-short} →'],
  ]) {
    const drifted = block.replace(from, 'origin/{branch} moved {reviewed-short} →');
    assert.notEqual(drifted, block, `go-red anchor for the ${name} not found`);
    assert.equal(countedMoveLines(drifted).length, 2, `go-red: a ${name} carrying the literal must be counted`);
  }
});

test('placement: 3a sits between the exit classification and the bound; the branch assertion precedes the pull', () => {
  const block = blockOf(readText(EXECUTE));
  const at = (s) => {
    const i = block.indexOf(s);
    assert.notEqual(i, -1, `placement anchor missing: ${s}`);
    return i;
  };
  assert.ok(at('**3. Classify the exit.**') < at('**3a.') && at('**3a.') < at('**4. The bound.**'), '3a must sit between steps 3 and 4');
  assert.ok(at('rev-parse --abbrev-ref HEAD` must equal `{branch}`') < at('pull --rebase --no-autostash origin {branch}'), 'the branch assertion must precede the pull');
});

test('byte guard: release/SKILL.md stays under 49,500 bytes', () => {
  const size = fs.statSync(SKILL).size;
  assert.ok(size < 49500, `release/SKILL.md is ${size} bytes; the budget is 49,500`);
});
